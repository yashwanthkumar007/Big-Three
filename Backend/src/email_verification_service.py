"""
Email verification service.

Shared by BOTH admin-triggered and user-triggered verification — one
mechanism, one database field, one token flow.

Design:
  - Verification status lives on the user document in Cosmos DB
    ("users" container):  email_verified (bool), emailVerifiedAt (ISO str).
    Existing users WITHOUT the field are treated as Unverified — no user is
    marked verified automatically and login behaviour is unchanged.
  - Single-use, time-limited tokens are stored in their own Cosmos
    container ("email-verification-tokens"). Only a SHA-256 hash of the raw
    token is persisted — the raw token exists only inside the emailed link.
  - Raw token: secrets.token_urlsafe(32) (cryptographically secure,
    ~256 bits of entropy), unrelated to user id / email / timestamps.
  - Requesting a new token invalidates the user's previous unused tokens,
    so only the LATEST link ever works.
  - Simple resend cooldown (per user) prevents email flooding.
"""

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from src.azure_service import cosmos_query_documents, cosmos_upsert_document
from src.logger import logger

TOKENS_CONTAINER = "email-verification-tokens"
USERS_CONTAINER = "users"

# Token lifetime (hours). Configurable for dev/production.
TOKEN_TTL_HOURS = float(os.getenv("EMAIL_VERIFICATION_TOKEN_TTL_HOURS", "24"))

# Minimum seconds between verification emails for the same user.
RESEND_COOLDOWN_SECONDS = int(os.getenv("EMAIL_VERIFICATION_RESEND_COOLDOWN", "60"))


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _iso_to_epoch(value: Optional[str]) -> float:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def is_email_verified(user: Optional[dict]) -> bool:
    """True only when the user document explicitly says so. Users stored
    before this feature (missing field) are treated as Unverified."""
    return bool(user and user.get("email_verified") is True)


def _invalidate_active_tokens(user_id: str) -> None:
    """Marks every unused token of this user as superseded so only the
    newest link can ever be accepted."""
    try:
        docs = cosmos_query_documents(
            TOKENS_CONTAINER,
            {
                "query": (
                    "SELECT * FROM c WHERE c.userId = @uid AND "
                    "NOT IS_DEFINED(c.usedAt)"
                ),
                "parameters": [{"name": "@uid", "value": user_id}],
            },
        ) or []
    except Exception as exc:
        logger.warning("[EMAIL-VERIFY] token invalidation query failed: %s", exc)
        return
    for doc in docs:
        try:
            doc["usedAt"] = _utc_now_iso()
            doc["usedReason"] = "superseded"
            cosmos_upsert_document(TOKENS_CONTAINER, doc)
        except Exception as exc:
            logger.warning("[EMAIL-VERIFY] token invalidation failed: %s", exc)
def _last_token_created_epoch(user_id: str) -> float:
    try:
        docs = cosmos_query_documents(
            TOKENS_CONTAINER,
            {
                "query": (
                    "SELECT * FROM c WHERE c.userId = @uid "
                    "ORDER BY c.createdAt DESC"
                ),
                "parameters": [{"name": "@uid", "value": user_id}],
            },
        ) or []
    except Exception as exc:
        logger.warning("[EMAIL-VERIFY] cooldown query failed: %s", exc)
        return 0.0
    return _iso_to_epoch(docs[0].get("createdAt")) if docs else 0.0


def resend_cooldown_active(user_id: str) -> int:
    """Returns the remaining cooldown seconds (0 = can send now)."""
    last = _last_token_created_epoch(user_id)
    if last <= 0:
        return 0
    elapsed = datetime.now(timezone.utc).timestamp() - last
    return max(0, int(RESEND_COOLDOWN_SECONDS - elapsed))


def create_verification(user: dict) -> Tuple[str, str]:
    """Creates a single-use verification token for the user.

    Returns (raw_token, expires_at_iso). The raw token is NEVER stored —
    only its SHA-256 hash goes into the database.
    """
    # Only the latest token may be accepted.
    _invalidate_active_tokens(user.get("id", ""))

    raw_token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(hours=TOKEN_TTL_HOURS)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )

    document = {
        "id": uuid.uuid4().hex,
        "domain": TOKENS_CONTAINER,  # Cosmos partition key
        "tokenHash": _token_hash(raw_token),
        "userId": user.get("id", ""),
        "userEmail": user.get("email", ""),
        "createdAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expiresAt": expires_at,
    }
    cosmos_upsert_document(TOKENS_CONTAINER, document)
    logger.info(
        "[EMAIL-VERIFY] verification token created for user=%s expires=%s",
        user.get("email", ""), expires_at,
    )
    return raw_token, expires_at


def consume_verification(raw_token: str) -> dict:
    """Validates and consumes an emailed verification token.

    Returns:
        {"status": "success", "email": ..., "userId": ...}
        {"status": "invalid"}    — unknown / already used / tampered
        {"status": "expired"}    — known token past its expiry
    """
    if not raw_token or len(raw_token) > 512:
        return {"status": "invalid"}

    token_hash = _token_hash(raw_token)
    try:
        docs = cosmos_query_documents(
            TOKENS_CONTAINER,
            {
                "query": "SELECT * FROM c WHERE c.tokenHash = @hash",
                "parameters": [{"name": "@hash", "value": token_hash}],
            },
        ) or []
    except Exception as exc:
        logger.error("[EMAIL-VERIFY] token lookup failed: %s", exc)
        return {"status": "invalid"}

    if not docs:
        return {"status": "invalid"}

    record = docs[0]

    if record.get("usedAt"):
        return {"status": "invalid"}

    if _iso_to_epoch(record.get("expiresAt")) < datetime.now(timezone.utc).timestamp():
        return {"status": "expired"}

    # Single use — burn the token BEFORE the user update so a replay during
    # the write window can never double-consume.
    try:
        record["usedAt"] = _utc_now_iso()
        record["usedReason"] = "verified"
        cosmos_upsert_document(TOKENS_CONTAINER, record)
    except Exception as exc:
        logger.error("[EMAIL-VERIFY] failed to consume token: %s", exc)
        return {"status": "invalid"}

    user_id = record.get("userId", "")
    try:
        users = cosmos_query_documents(
            USERS_CONTAINER,
            {
                "query": "SELECT * FROM c WHERE c.id = @uid",
                "parameters": [{"name": "@uid", "value": user_id}],
            },
        ) or []
    except Exception as exc:
        logger.error("[EMAIL-VERIFY] user lookup failed for %s: %s", user_id, exc)
        return {"status": "invalid"}

    if not users:
        return {"status": "invalid"}

    user = users[0]
    user["email_verified"] = True
    user["emailVerifiedAt"] = _utc_now_iso()
    try:
        cosmos_upsert_document(USERS_CONTAINER, user)
    except Exception as exc:
        logger.error("[EMAIL-VERIFY] user update failed for %s: %s", user_id, exc)
        return {"status": "invalid"}

    logger.info("[EMAIL-VERIFY] email verified for user=%s", user.get("email", ""))
    return {
        "status": "success",
        "email": user.get("email", ""),
        "userId": user_id,
    }