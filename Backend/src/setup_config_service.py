"""Setup Levels and Comments configuration service.

The administrator-configurable severity levels and reviewer comments are
persisted in Azure Cosmos DB and are the source of truth for both the
Inspection Result UI and the generated PDF report.

Document model (container "system-settings", id "setup-levels-comments"):

    {
        "id": "setup-levels-comments",
        "type": "setup-levels-comments",
        "levels": { ... },
        "comments": { ... },
        "version": N,
        "updatedAt": "...",
        "updatedBy": "..."
    }

Default Level 1 / Level 2 and Default Comment 1 are IMMUTABLE and always
enforced server-side — they are never overwritten regardless of the payload.
"""

from datetime import datetime, timezone
from typing import Any, Dict

from src.audit_service import log_from_authenticated_user
from src.audit_constants import (
    SETUP_LEVELS_COMMENTS_UPDATED,
    APPLICATION_MEDINSPECT,
    MODULE_SYSTEM_SETUP,
    STATUS_SUCCESS,
)
from src.azure_service import cosmos_get_document, cosmos_upsert_document
from src.logger import logger

# Cosmos DB container holding system-level configuration documents.
SETTINGS_CONTAINER = "system-settings"

SETUP_CONFIG_DOC_ID = "setup-levels-comments"

MAX_CUSTOM_LENGTH = 120

# Reserved default levels — permanently read-only (backend enforced).
DEFAULT_LEVELS = {
    "default1": "None",
    "default2": "Ignore All",
}

# Reserved default comment — permanently read-only (backend enforced).
DEFAULT_COMMENTS = {
    "default1": "Reviewed",
}

# Default (initial) configuration — used only when nothing exists yet.
INITIAL_LEVELS = {
    **DEFAULT_LEVELS,
    "custom1": "Critical",
    "custom2": "Major",
    "custom3": "Minor",
    "custom4": "Not a Defect",
    "custom5": "Fail",
}

INITIAL_COMMENTS = {
    **DEFAULT_COMMENTS,
    "custom1": "Approved",
    "custom2": "To be verified",
    "custom3": "None",
    "custom4": "Comment1",
    "custom5": "Comment2",
    "custom6": "Comment3",
    "custom7": "Comment 4",
    "custom8": "",
    "custom9": "",
    "custom10": "",
}


def _flatten(config: Dict[str, Any]) -> Dict[str, str]:
    """Flatten a config into ``levels.custom1``, ``comments.custom4`` keys."""
    flattened: Dict[str, str] = {}
    for group in ("levels", "comments"):
        for key, value in (config.get(group) or {}).items():
            flattened[f"{group}.{key}"] = str(value)
    return flattened


def _describe_changes(changes: Dict[str, Any]) -> str:
    """Human-readable change list for the audit description."""
    parts = []
    for path, diff in changes.items():
        group, key = path.split(".", 1)
        label = "Level" if group == "levels" else "Comment"
        parts.append(
            f"{key} {label} changed from \"{diff.get('from', '')}\" to \"{diff.get('to', '')}\""
        )
    return "; ".join(parts)
def get_setup_config() -> Dict[str, Any]:
    """Return the current persisted configuration, initializing it if missing."""
    current = None
    try:
        current = cosmos_get_document(SETTINGS_CONTAINER, SETUP_CONFIG_DOC_ID)
    except Exception:
        current = None

    if current and current.get("levels") and current.get("comments"):
        return current

    # Initialize once with defaults (never repeat creation).
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    config = {
        "id": SETUP_CONFIG_DOC_ID,
        "type": "setup-levels-comments",
        "levels": dict(INITIAL_LEVELS),
        "comments": dict(INITIAL_COMMENTS),
        "version": 1,
        "updatedAt": timestamp,
        "updatedBy": "system",
    }
    try:
        cosmos_upsert_document(SETTINGS_CONTAINER, config)
    except Exception as exc:
        logger.error("[SETUP] Failed to initialize setup configuration: %s", exc)
    return config


def _clean_custom(raw: Any, fallback: str) -> str:
    """Trim, enforce a max length, and allow genuine empty custom comments."""
    if not isinstance(raw, str):
        return fallback
    return raw.strip()[:MAX_CUSTOM_LENGTH]


def update_setup_config(payload: Dict[str, Any], authenticated_user: dict) -> Dict[str, Any]:
    """Validate, protect defaults, persist and audit a configuration update.

    Only Custom Levels 1-5 and Custom Comments 1-10 may be changed. The
    reserved defaults are always preserved regardless of the payload.
    """
    current = get_setup_config()

    incoming_levels = payload.get("levels") if isinstance(payload.get("levels"), dict) else {}
    incoming_comments = payload.get("comments") if isinstance(payload.get("comments"), dict) else {}

    next_levels: Dict[str, str] = {}
    for key in INITIAL_LEVELS:
        if key in DEFAULT_LEVELS:
            next_levels[key] = DEFAULT_LEVELS[key]
        else:
            fallback = current.get("levels", {}).get(key, INITIAL_LEVELS[key])
            next_levels[key] = _clean_custom(incoming_levels.get(key), fallback)

    next_comments: Dict[str, str] = {}
    for key in INITIAL_COMMENTS:
        if key in DEFAULT_COMMENTS:
            next_comments[key] = DEFAULT_COMMENTS[key]
        else:
            fallback = current.get("comments", {}).get(key, INITIAL_COMMENTS[key])
            next_comments[key] = _clean_custom(incoming_comments.get(key), fallback)

    next_config = {
        **current,
        "levels": next_levels,
        "comments": next_comments,
    }

    changes = _diff(current, next_config)
    if not changes:
        # No actual change — do not create an unnecessary audit record.
        return next_config

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    next_config["version"] = int(current.get("version") or 1) + 1
    next_config["updatedAt"] = timestamp
    next_config["updatedBy"] = str(authenticated_user.get("email", ""))

    try:
        cosmos_upsert_document(SETTINGS_CONTAINER, next_config)
    except Exception as exc:
        logger.error("[SETUP] Failed to persist setup configuration: %s", exc)
        raise

    log_from_authenticated_user(
        event=SETUP_LEVELS_COMMENTS_UPDATED,
        action="Update Setup Levels and Comments",
        application=APPLICATION_MEDINSPECT,
        module=MODULE_SYSTEM_SETUP,
        authenticated_user=authenticated_user,
        status=STATUS_SUCCESS,
        description=_describe_changes(changes),
        entity_type="Setup Levels and Comments",
        entity_id=SETUP_CONFIG_DOC_ID,
        changes=changes,
        metadata={
            "configVersion": next_config["version"],
            "changedPaths": list(changes.keys()),
        },
    )
    return next_config


def _diff(current: Dict[str, Any], next_config: Dict[str, Any]) -> Dict[str, Any]:
    prev = _flatten(current)
    nxt = _flatten(next_config)
    changes: Dict[str, Any] = {}
    for key in sorted(set(prev) | set(nxt)):
        if prev.get(key) != nxt.get(key):
            changes[key] = {"from": prev.get(key, ""), "to": nxt.get(key, "")}
    return changes