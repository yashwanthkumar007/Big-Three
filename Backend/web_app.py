"""
Text Inspection web app.

Flow:
  1. Upload Master PDF, upload Sample PDF — both preview side-by-side
     immediately, fit-to-screen with zoom in/out controls.
  2. Click Inspect once both are uploaded.
  3. Results appear in a bottom panel: each finding shows Master value,
     Sample value, and the comment (same "Change: X should be Y as in
     the original" / "Missing in sample" / "Extra text in sample" text
     the backend already generates). Click a finding to highlight it —
     only the side(s) that actually have a box light up (Insertion =
     Sample only, Deletion = Master only, Change/Location = both).
     Hover over a highlight box to see its comment as a tooltip.

Run:
    python web_app.py
Then open http://127.0.0.1:5000 in your browser.
"""

import os
import re
import sys
import threading
import uuid
from datetime import datetime, timezone
from flask import Flask, request, jsonify, send_from_directory, render_template_string

sys.path.append(os.path.dirname(__file__))
from src.inspection_registry import get_inspection_config
from src.pipelines.report_builder import build_report, render_page
from src.pipelines.comparison_pipeline import run_crop_text_inspection
import pandas as pd
from src.email_service import send_inspection_report_email
from src.azure_service import (
    cosmos_delete_document,
    cosmos_get_document,

    cosmos_query_documents,
    cosmos_upsert_document,
    delete_blob,
    download_blob,
    get_backend_infrastructure_status,
    upload_blob,
)
from src.logger import logger
from src.password_utils import hash_password, is_password_hashed, verify_password
from src.resource_schema import normalize_resource_payload, validate_resource_payload
from src.audit_service import log_from_authenticated_user, AUDIT_LOGS_CONTAINER
from src.setup_config_service import get_setup_config, update_setup_config
from src.difference_comment_service import (
    get_difference_comments,
    upsert_difference_comment,
)
from src.audit_constants import (
    LOGIN_SUCCESS,
    LOGIN_FAILED,
    LOGOUT,
    SESSION_EXPIRED,
    SESSION_TERMINATED,
    USER_CREATED,
    USER_UPDATED,
    USER_DELETED,
    ACCOUNT_TYPE_CHANGED,
    USER_ENABLED,
    USER_DISABLED,
    FILE_UPLOADED,
    FILE_SUBMITTED,
    INSPECTION_CREATED,
    INSPECTION_STARTED,
    INSPECTION_COMPLETED,
    INSPECTION_FAILED,
    INSPECTION_CANCELLED,
    INSPECTION_VIEWED,
    CROP_INSPECTION_COMPLETED,
    CROP_INSPECTION_FAILED,
    DIFFERENCE_VIEWED,
    DIFFERENCE_LEVEL_CHANGED,
    DIFFERENCE_STATUS_CHANGED,
    DIFFERENCE_COMMENT_ADDED,
    DIFFERENCE_COMMENT_UPDATED,
    REPORT_CREATED,
    REPORT_VIEWED,
    REPORT_DOWNLOADED,
    SYSTEM_SETTINGS_UPDATED,
    PROFILE_CREATED,
    PROFILE_UPDATED,
    PROFILE_DELETED,
    APPLICATION_MEDINSPECT,
    MODULE_AUTHENTICATION,
    MODULE_USER_MANAGEMENT,
    MODULE_TEXT_INSPECTION,
    MODULE_REPORT,
    MODULE_SYSTEM_SETUP,
    MODULE_AUDIT_TRAIL,
    STATUS_SUCCESS,
    STATUS_FAILED,
    STATUS_WARNING,
)

app = Flask(__name__)

UPLOAD_ROOT = os.path.join("webapp_uploads")
OUTPUT_ROOT = os.path.join("webapp_outputs")
os.makedirs(UPLOAD_ROOT, exist_ok=True)
os.makedirs(OUTPUT_ROOT, exist_ok=True)

# The upload-time preview is ONLY a fit-to-screen thumbnail shown before an
# inspection runs — the React client renders the PDF itself via pdf.js and
# (in the legacy embedded client) the finding highlight boxes are drawn on
# the separate 150-DPI page images produced by /api/inspect, NOT on this
# preview. So this preview does NOT need REPORT_DPI precision. Rendering it
# at 150 DPI on large-format artwork PDFs (full page.get_pixmap + PNG encode
# of a multi-thousand-pixel image) is the dominant cost of the "upload"
# request, taking tens of seconds before the frontend can proceed. Capping
# it at a lower DPI keeps the same response fields (image/width/height, used
# only for the pre-inspection fit-to-screen display) while cutting the render
# work by roughly (150/PREVIEW_DPI)^2 — a large, safe speedup.
PREVIEW_DPI = 72


@app.route("/")
def index():
    # PATCHED_INDEX_HTML = original INDEX_HTML plus the Crop Compare UI
    # (styles + script) injected before </body>. Falls back to the plain
    # original HTML if the crop block isn't defined (e.g. partial import).
    html = PATCHED_INDEX_HTML if "PATCHED_INDEX_HTML" in globals() else INDEX_HTML
    return render_template_string(html)


@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify({
        "status": "ok",
        "service": "medinspect-backend",
        "azure": get_backend_infrastructure_status(),
    })


@app.route("/api/azure/health", methods=["GET"])
def api_azure_health():
    try:
        payload = get_backend_infrastructure_status()
        return jsonify(payload), 200 if payload.get("ready") else 503
    except Exception as exc:  # pragma: no cover - defensive guard for runtime env issues
        return jsonify({"status": "error", "ready": False, "error": str(exc)}), 503


ALLOWED_RESOURCE_TYPES = {
    "users",
    "projects",
    "documents",
    "inspections",
    "results",
    "violations",
    "coordinates",
    "review-status",
    "audit-metadata",
}


@app.route("/api/<resource>", methods=["GET", "POST"])
def api_resource_collection(resource):
    if resource not in ALLOWED_RESOURCE_TYPES:
        return jsonify({"error": f"Unsupported resource '{resource}'"}), 404

    if request.method == "GET":
        try:
            data = cosmos_query_documents(resource)
            return jsonify(data), 200
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object body required."}), 400

    payload = normalize_resource_payload(resource, payload)

    try:
        validated = validate_resource_payload(resource, payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    # Hash plaintext passwords on user creation. Already-hashed values are
    # left untouched.
    if resource == "users" and isinstance(validated.get("password"), str) and not is_password_hashed(validated["password"]):
        validated["password"] = hash_password(validated["password"])

    try:
        result = cosmos_upsert_document(resource, validated)

        # Audit user management events
        if resource == "users":
            account_type = validated.get("accountType", "User")
            # Get the admin who performed this action (from authenticated context)
            admin_user, admin_error = _authenticated_identity()
            if admin_error:
                return admin_error
            log_from_authenticated_user(
                event=USER_CREATED,
                action="Create User",
                application=APPLICATION_MEDINSPECT,
                module=MODULE_USER_MANAGEMENT,
                authenticated_user=admin_user,
                status=STATUS_SUCCESS,
                description=f"User created. Email={validated.get('email', '')}; Account Type={account_type}",
                entity_type="User",
                entity_id=result.get("id", ""),
                metadata={
                    "newUserEmail": validated.get("email", ""),
                    "newAccountType": account_type,
                    "newAccountStatus": validated.get("accountStatus", "Active"),
                    "createdUserId": result.get("id", ""),
                },
            )

        return jsonify(result), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
import time

# Server-side active-session registry
# ---------------------------------------------------------------------------
# Sessions created by /api/auth/login are stored here (Cosmos DB "sessions"
# container when available, in-memory fallback otherwise). This is the single
# source of truth for the Logged-in Users page: every login from ANY
# browser/machine is recorded server-side together with the real IP, browser
# and operating system captured from the login request.
#
# Authorization for listing/terminating sessions is based ONLY on the
# authenticated user's accountType resolved from the server-side database —
# NEVER on the email address or any value sent by the frontend.
# ---------------------------------------------------------------------------

# A session is considered expired when it has been inactive for longer than
# the frontend session timeout (30 minutes). Expired/superseded sessions are
# DELETED from the database so the Logged-in Users page only ever shows
# currently logged-in users — never past logins.
SESSION_INACTIVITY_LIMIT_SECONDS = 30 * 60

_IN_MEMORY_SESSIONS: dict = {}


def _parse_timestamp(value) -> float:
    """Parse an ISO timestamp to epoch seconds; returns 0.0 when unparseable."""
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _delete_session_record(session_id: str) -> None:
    """Delete a session record from the database (Cosmos or in-memory)."""
    if not session_id:
        return
    try:
        cosmos_delete_document("sessions", session_id)
    except Exception:
        pass
    _IN_MEMORY_SESSIONS.pop(session_id, None)


def _log_session_ended(session, *, event, action, description, reason):
    """Write an audit record for a session that ended OTHER than through the
    explicit /api/auth/logout endpoint - i.e. superseded by a new login,
    expired by inactivity, or removed as a duplicate. Best-effort."""
    try:
        user = {
            "id": session.get("userId", ""),
            "email": session.get("email", ""),
            "accountType": session.get("accountType", "User"),
        }
        session_id = session.get("sessionId", "")
        log_from_authenticated_user(
            event=event,
            action=action,
            application=APPLICATION_MEDINSPECT,
            module=MODULE_AUTHENTICATION,
            authenticated_user=user,
            status=STATUS_SUCCESS,
            description=description,
            entity_type="Session",
            entity_id=session_id,
            session_id=session_id,
            metadata={
                "logoutReason": reason,
                "loginTime": session.get("loginTime", ""),
                "lastActivity": session.get("lastActivity", ""),
            },
        )
    except Exception as exc:
        logger.warning(
            "[AUDIT] Could not log session end (%s) for %s: %s",
            reason, session.get("email", ""), exc,
        )


def _purge_stale_sessions(sessions: list) -> list:
    """Delete and drop sessions whose last activity exceeded the inactivity
    limit (i.e. past logins, not current users). Each expired session is
    recorded in the audit trail as SESSION_EXPIRED so silently abandoned
    sessions still show up as auto-logouts."""
    now_ts = time.time()
    fresh: list = []
    for session in sessions:
        last_activity = _parse_timestamp(session.get("lastActivity") or session.get("loginTime"))
        if last_activity and (now_ts - last_activity) > SESSION_INACTIVITY_LIMIT_SECONDS:
            _log_session_ended(
                session,
                event=SESSION_EXPIRED,
                action="Auto Logout",
                description="Session expired due to inactivity (automatic logout).",
                reason="timeout",
            )
            _delete_session_record(session.get("sessionId", ""))
            continue
        fresh.append(session)
    return fresh


def _dedupe_sessions(sessions: list) -> list:
    """Keep only the NEWEST session per user (case-insensitive email) and
    delete every older duplicate from the database, so a user always has
    exactly one active session — their current one."""
    newest_by_email: dict = {}
    fresh: list = []
    for session in sessions:
        email_key = str(session.get("email", "")).lower()
        existing = newest_by_email.get(email_key)
        if existing is None:
            newest_by_email[email_key] = session
            fresh.append(session)
        else:
            # Keep the newer loginTime; delete the older duplicate.
            if str(session.get("loginTime", "")) > str(existing.get("loginTime", "")):
                _log_session_ended(
                    existing,
                    event=SESSION_TERMINATED,
                    action="Session Superseded",
                    description="Previous session superseded by a newer login.",
                    reason="superseded",
                )
                _delete_session_record(existing.get("sessionId", ""))
                fresh[fresh.index(existing)] = session
                newest_by_email[email_key] = session
            else:
                _log_session_ended(
                    session,
                    event=SESSION_TERMINATED,
                    action="Session Superseded",
                    description="Previous session superseded by a newer login.",
                    reason="superseded",
                )
                _delete_session_record(session.get("sessionId", ""))
    return fresh


def _purge_superseded_sessions(email: str, exclude_session_id: str = "") -> None:
    """Delete ALL existing sessions belonging to a user (case-insensitive
    email match) so each user has exactly ONE active session: whenever they
    log in again, the previous session record is removed from the database.

    exclude_session_id: the sessionId of the NEW login being recorded. The
    bookkeeping thread runs in parallel with the synchronous upsert of the
    new session record, so without this exclusion the purge query can see
    (and delete) the brand-new session — which made the user disappear from
    the Logged-in Users page immediately after login.
    """
    if not email:
        return
    lowered = email.lower()
    try:
        existing = cosmos_query_documents(
            "sessions",
            {"query": "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email)",
             "parameters": [{"name": "@email", "value": email}]},
        )
    except Exception:
        existing = list(_IN_MEMORY_SESSIONS.values())
    for session in existing:
        if str(session.get("email", "")).lower() == lowered:
            if exclude_session_id and session.get("sessionId") == exclude_session_id:
                continue  # never purge the session being created right now
            _log_session_ended(
                session,
                event=SESSION_TERMINATED,
                action="Session Superseded",
                description="Previous session superseded by a new login.",
                reason="superseded",
            )
            _delete_session_record(session.get("sessionId", ""))


def parse_browser_from_user_agent(user_agent: str) -> str:
    """Best-effort browser name from the User-Agent header."""
    ua = user_agent or ""
    if "Edg/" in ua:
        return "Edge"
    if "OPR/" in ua or "Opera" in ua:
        return "Opera"
    if "Chrome" in ua:
        return "Chrome"
    if "Firefox" in ua:
        return "Firefox"
    if "Safari" in ua:
        return "Safari"
    return "Unknown Browser"


def parse_os_from_user_agent(user_agent: str) -> str:
    """Best-effort operating-system name from the User-Agent header."""
    ua = user_agent or ""
    if "Windows NT 10.0" in ua:
        return "Windows 10/11"
    if "Windows" in ua:
        return "Windows"
    if "Android" in ua:
        return "Android"
    if "iPhone" in ua or "iPad" in ua:
        return "iOS"
    if "Mac OS X" in ua or "Macintosh" in ua:
        return "macOS"
    if "CrOS" in ua:
        return "Chrome OS"
    if "Linux" in ua:
        return "Linux"
    return "Unknown OS"


def _list_sessions() -> list:
    """Return all active session records (Cosmos first, in-memory fallback)."""
    sessions: list = []
    try:
        sessions = cosmos_query_documents("sessions", {"query": "SELECT * FROM c"})
    except Exception:
        sessions = []
    combined = list(sessions)
    combined.extend(_IN_MEMORY_SESSIONS.values())
    active = [s for s in combined if s.get("sessionStatus", "Active") == "Active"]
    active = _purge_stale_sessions(active)
    active = _dedupe_sessions(active)
    active.sort(key=lambda s: s.get("loginTime", ""), reverse=True)
    return active


def _find_session_by_id(session_id: str):
    """Find a session record by its server-issued sessionId."""
    if not session_id:
        return None
    for session in _list_sessions():
        if session.get("sessionId") == session_id:
            return session
    return None


def _authenticated_identity(*, require_admin: bool = False):
    """Resolve the authenticated user from the server-side database.

    The frontend sends its identity in the X-User-Email header (the app uses
    mock tokens). The accountType used for authorization is ALWAYS read from
    the server-side database record — never from any client-sent role value
    and never inferred from the email address itself.
    """
    caller_email = request.headers.get("X-User-Email", "").strip().lower()
    if not caller_email:
        return None, (jsonify({"error": "X-User-Email header is required."}), 400)
    try:
        users = cosmos_query_documents(
            "users",
            {
                # Case-insensitive: the stored email may differ in casing from
                # the authenticated identity header (login identifier only).
                "query": "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email)",
                "parameters": [{"name": "@email", "value": caller_email}],
            },
        )
    except Exception as exc:
        return None, (jsonify({"error": str(exc)}), 500)
    if not users:
        return None, (jsonify({"error": "User not found."}), 404)
    if require_admin:
        account_type = str(users[0].get("accountType", "User")).strip().lower()
        if account_type != "administrator":
            return None, (jsonify({"error": "Administrator access required."}), 403)
    return users[0], None


def _authenticated_user_and_error():
    """Administrator-only identity resolution (accountType-based)."""
    return _authenticated_identity(require_admin=True)

def _authenticated_user_and_error():
    """Resolve the authenticated user from the server-side database.

    The frontend sends its identity in the X-User-Email header (the app uses
    mock tokens). The accountType used for authorization is ALWAYS read from
    the server-side database record — never from any client-sent role value
    and never inferred from the email address itself.
    """
    caller_email = request.headers.get("X-User-Email", "").strip().lower()
    if not caller_email:
        return None, (jsonify({"error": "X-User-Email header is required."}), 400)
    try:
        users = cosmos_query_documents(
            "users",
            {
                # Case-insensitive: the stored email may differ in casing from
                # the authenticated identity header (login identifier only).
                "query": "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email)",
                "parameters": [{"name": "@email", "value": caller_email}],
            },
        )
    except Exception as exc:
        return None, (jsonify({"error": str(exc)}), 500)
    if not users:
        return None, (jsonify({"error": "User not found."}), 404)
    account_type = str(users[0].get("accountType", "User")).strip().lower()
    if account_type != "administrator":
        return None, (jsonify({"error": "Administrator access required."}), 403)
    return users[0], None


def _session_entry_to_client(session: dict) -> dict:
    """Shape a server session record for the Logged-in Users page."""
    name_parts = [session.get("firstName", ""), session.get("lastName", "")]
    return {
        "id": session.get("sessionId", session.get("id", "")),
        "user": session.get("username")
        or " ".join(part for part in name_parts if part)
        or session.get("email", ""),
        "email": session.get("email", ""),
        "accountType": session.get("accountType", "User"),
        "sessionId": session.get("sessionId", ""),
        "loginTime": session.get("loginTime", ""),
        "lastActivity": session.get("lastActivity", session.get("loginTime", "")),
        "ipAddress": session.get("ipAddress", ""),
        "browser": session.get("browser", ""),
        "operatingSystem": session.get("operatingSystem", ""),
        "sessionStatus": session.get("sessionStatus", "Active"),
    }



@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    """Authenticate a user against Cosmos DB.

    Expects JSON body: { "email": "...", "password": "..." }
    Queries Cosmos DB for the user by email and validates the password.
    Updates lastLogin timestamp on successful login.
    Returns the user document (without password) on success.
    """
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""

    if not email or not password:
        return jsonify({"error": "email and password are required."}), 400

    try:
        users = cosmos_query_documents(
            "users",
            {
                # Case-insensitive match: emails may be stored capitalized
                # (e.g. YashwanthKumar@viatris.com) but the login form lowercases
                # its input. Email is only a login identifier here.
                "query": "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email)",
                "parameters": [{"name": "@email", "value": email}],
            },
        )
        if not users:
            # LOGIN_FAILED: user not found
            log_from_authenticated_user(
                event=LOGIN_FAILED,
                action="Login",
                application=APPLICATION_MEDINSPECT,
                module=MODULE_AUTHENTICATION,
                authenticated_user={
                    "id": str(uuid.uuid4()),
                    "email": email,
                    "accountType": "Unknown",
                },
                status=STATUS_FAILED,
                description="Login failed. Invalid email or password.",
                metadata={"reason": "User not found", "attemptedEmail": email},
            )
            return jsonify({"error": "Invalid email or password."}), 401

        user = users[0]
        # Validate password against the stored password field.
        # Stored values are werkzeug hashes; legacy plaintext values are still
        # accepted and transparently upgraded to a hash on successful login.
        password_ok, needs_rehash = verify_password(user.get("password"), password)
        if not password_ok:
            # LOGIN_FAILED: wrong password
            log_from_authenticated_user(
                event=LOGIN_FAILED,
                action="Login",
                application=APPLICATION_MEDINSPECT,
                module=MODULE_AUTHENTICATION,
                authenticated_user=user,
                status=STATUS_FAILED,
                description="Login failed. Invalid email or password.",
                metadata={"reason": "Invalid password", "attemptedEmail": email},
            )
            return jsonify({"error": "Invalid email or password."}), 401

        # ------------------------------------------------------------------
        # Server-side session registry: record THIS login as an active session.
        # The session id is generated and stored SERVER-SIDE so the Logged-in
        # Users page reflects every logged-in user across all browsers/machines,
        # with IP/browser/OS captured from the actual login request.
        # Authorization fields (accountType) come from the DB user document,
        # never from the request payload.
        # ------------------------------------------------------------------

        # PERFORMANCE: the session record itself is written synchronously
        # (the login response references it), but the non-critical
        # bookkeeping — purging the user's previous session(s), updating
        # lastLogin (incl. legacy password re-hash), and the LOGIN_SUCCESS
        # audit record — runs on a background thread. None of these affect
        # the login decision or the response payload; making them async
        # removes 3-5 sequential Cosmos/APIM round-trips from the critical
        # path. Any failure inside them is already handled gracefully.
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        session_id = "sess_{}".format(uuid.uuid4().hex)

        def _finish_login_bookkeeping():
            try:
                stored_user = {**user, "lastLogin": timestamp}
                if needs_rehash:
                    # Upgrade legacy plaintext password to a salted hash
                    stored_user["password"] = hash_password(password)
                cosmos_upsert_document("users", stored_user)
            except Exception:
                pass  # Non-critical: login succeeds even if lastLogin update fails

            # ONE ACTIVE SESSION PER USER: delete any previous session record
            # for this user so past logins never appear on the Logged-in
            # Users page.
            try:
                _purge_superseded_sessions(user.get("email", ""), exclude_session_id=session_id)
            except Exception:
                pass

            # LOGIN_SUCCESS: record successful login
            try:
                log_from_authenticated_user(
                    event=LOGIN_SUCCESS,
                    action="Login",
                    application=APPLICATION_MEDINSPECT,
                    module=MODULE_AUTHENTICATION,
                    authenticated_user=user,
                    status=STATUS_SUCCESS,
                    description="Successful login.",
                    session_id=session_id,
                )
            except Exception:
                pass

        threading.Thread(
            target=_finish_login_bookkeeping, name="login-bookkeeping", daemon=True
        ).start()

        ip_address = (
            request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or request.remote_addr
            or "Unknown"
        )
        user_agent = request.headers.get("User-Agent", "")
        session_record = {
            "id": session_id,
            "sessionId": session_id,
            "userId": user.get("id", ""),
            "email": user.get("email", ""),
            "firstName": user.get("firstName", ""),
            "lastName": user.get("lastName", ""),
            "username": user.get("username", ""),
            "accountType": user.get("accountType", "User"),
            "ipAddress": ip_address,
            "browser": parse_browser_from_user_agent(user_agent),
            "operatingSystem": parse_os_from_user_agent(user_agent),
            "loginTime": timestamp,
            "lastActivity": timestamp,
            "sessionStatus": "Active",
            "domain": "sessions",
        }
        try:
            cosmos_upsert_document("sessions", session_record)
        except Exception:
            # Cosmos unavailable -> keep the session in a server-side in-memory
            # registry so the Logged-in Users page still works locally.
            _IN_MEMORY_SESSIONS[session_id] = session_record

        # Return user data without the password field
        user_data = {k: v for k, v in user.items() if k != "password"}
        user_data["lastLogin"] = timestamp
        user_data["sessionId"] = session_id
        user_data["loginTime"] = timestamp

        # (LOGIN_SUCCESS audit record is written on the background
        # bookkeeping thread above — see _finish_login_bookkeeping.)

        return jsonify(user_data), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    """Delete the CURRENT session from the database on logout.

    The session to delete is identified by the server-issued sessionId in
    the X-Session-Id header — never by the email address. After this call
    the session no longer appears on the Logged-in Users page.

    The X-Logout-Reason header distinguishes WHY the session ended:
    "user" (intentional logout by the user, default) or "timeout"
    (automatic logout after session expiry). Both are recorded in the
    audit trail with different events so administrators can tell them apart.
    """
    session_id = request.headers.get("X-Session-Id", "").strip()
    logout_reason = (request.headers.get("X-Logout-Reason") or "user").strip().lower()
    if logout_reason not in ("user", "timeout"):
        logout_reason = "user"
    if not session_id:
        return jsonify({"loggedOut": False, "error": "Missing X-Session-Id header."}), 400
    existing = _find_session_by_id(session_id)
    if not existing:
        return jsonify({"loggedOut": True, "sessionId": session_id, "note": "Session not found; nothing to delete."}), 200

    # LOGOUT (intentional) / SESSION_EXPIRED (auto timeout): record BEFORE
    # deleting the session record so the user identity is still available.
    if logout_reason == "timeout":
        log_from_authenticated_user(
            event=SESSION_EXPIRED,
            action="Auto Logout",
            application=APPLICATION_MEDINSPECT,
            module=MODULE_AUTHENTICATION,
            authenticated_user=existing,
            status=STATUS_SUCCESS,
            description="Session expired due to inactivity (automatic logout).",
            session_id=session_id,
            metadata={"logoutReason": "timeout", "loginTime": existing.get("loginTime", "")},
        )
    else:
        log_from_authenticated_user(
            event=LOGOUT,
            action="Logout",
            application=APPLICATION_MEDINSPECT,
            module=MODULE_AUTHENTICATION,
            authenticated_user=existing,
            status=STATUS_SUCCESS,
            description="User logged out successfully.",
            session_id=session_id,
            metadata={"logoutReason": "user", "loginTime": existing.get("loginTime", "")},
        )

    _delete_session_record(session_id)
    return jsonify({"loggedOut": True, "sessionId": session_id}), 200


@app.route("/api/settings/system-information", methods=["GET"])
def api_system_information():
    """Application information shown on the System Setup page.

    The number of users is DYNAMIC: it is the live count of registered
    users in the database, so it updates automatically whenever a new
    user account is created or removed.
    """
    user_count = 0
    try:
        users = cosmos_query_documents("users", {"query": "SELECT * FROM c"})
        user_count = len(users or [])
    except Exception:
        user_count = 0

    return jsonify({
        "applicationVersion": "1.0.0",
        "companyName": "Viatris",
        "licenseType": "INTERNAL",
        "numberOfUsers": user_count,
        "ssoEnabled": False,
        "restApiAuthenticationType": "TOKEN",
    }), 200


@app.route("/api/setup/levels-comments", methods=["GET"])
def api_get_setup_levels_comments():
    """Return the current Setup Levels and Comments configuration.

    Any authenticated user may read it (normal users need it to review
    differences), but only administrators can update it (see the PUT route).
    ADMIN is authenticated via the X-User-Email header resolved server-side.
    """
    _, error = _authenticated_identity()
    if error:
        return error
    try:
        return jsonify(get_setup_config()), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/setup/levels-comments", methods=["PUT"])
def api_update_setup_levels_comments():
    """Administrator-only update of Setup Levels and Comments.

    The caller's accountType is resolved from the server-side database
    (accountType = "administrator"), never from the frontend payload. Normal
    users receive 403. Default Level 1/2 and Default Comment 1 are immutable.
    """
    admin_user, error = _authenticated_identity(require_admin=True)
    if error:
        return error

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object body required."}), 400

    try:
        config = update_setup_config(payload, admin_user)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify(config), 200


@app.route("/api/inspections/<inspection_id>/comments", methods=["GET"])
def api_inspection_difference_comments(inspection_id: str):
    """Return persisted user comments for an inspection (owner-verified)."""
    caller, error = _authenticated_identity()
    if error:
        return error

    try:
        inspection_record = _get_inspection_record(inspection_id)
    except Exception as exc:
        logger.error("[DIFF-COMMENT] Load failed for %s: %s", inspection_id, exc)
        return jsonify({"error": "Failed to load the inspection."}), 500
    if not inspection_record:
        return jsonify({"error": "Inspection not found."}), 404
    if inspection_record.get("userId") != caller.get("id", ""):
        return jsonify({"error": "You do not have access to this inspection."}), 403

    return jsonify(get_difference_comments(inspection_id)), 200


@app.route("/api/inspections/<inspection_id>/differences/<int:difference_id>/comment", methods=["PUT"])
def update_inspection_difference_comment(inspection_id: str, difference_id: int):
    """Persist a user comment on a specific difference (owner-verified).

    This does NOT touch the global Setup Levels and Comments configuration.
    """
    caller, error = _authenticated_identity()
    if error:
        return error

    try:
        inspection_record = _get_inspection_record(inspection_id)
    except Exception as exc:
        logger.error("[DIFF-COMMENT] Load failed for %s: %s", inspection_id, exc)
        return jsonify({"error": "Failed to load the inspection."}), 500
    if not inspection_record:
        return jsonify({"error": "Inspection not found."}), 404
    if inspection_record.get("userId") != caller.get("id", ""):
        return jsonify({"error": "You do not have access to this inspection."}), 403

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object body required."}), 400

    user_comment = str(payload.get("userComment") or "").strip()
    configured_comment = str(payload.get("configuredComment") or "")[:500]

    try:
        document = upsert_difference_comment(
            inspection_id=inspection_id,
            difference_id=difference_id,
            configured_comment=configured_comment,
            user_comment=user_comment,
            authenticated_user=caller,
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    return jsonify(document), 200


@app.route("/api/sessions", methods=["GET"])
def api_list_sessions():
    """List active login sessions (administrator-only, accountType-based).

    The caller's accountType is read from the server-side database record for
    the authenticated identity (X-User-Email) — never from the email string
    itself and never from any client-supplied role value.
    """
    _, error = _authenticated_user_and_error()
    if error:
        return error

    sessions = _list_sessions()
    return jsonify([_session_entry_to_client(s) for s in sessions]), 200


@app.route("/api/sessions/<session_id>", methods=["DELETE"])
def api_terminate_session(session_id: str):
    """Terminate another user's active session (administrator-only).

    The caller's accountType is resolved server-side from the database.
    The caller's OWN session cannot be terminated: the current session is
    identified by the server-issued session id sent in the X-Session-Id
    header — never by comparing email addresses.
    """
    admin_user, error = _authenticated_user_and_error()
    if error:
        return error

    caller_session_id = request.headers.get("X-Session-Id", "").strip()
    if session_id == caller_session_id:
        return jsonify({"error": "Cannot terminate your own current session."}), 400

    existing = _find_session_by_id(session_id)
    if not existing:
        return jsonify({"error": "Session not found."}), 404

    # SESSION_TERMINATED: record before deleting the session record.
    # The admin's identity comes from the authenticated backend context;
    # the target session info comes from the session record being deleted.
    log_from_authenticated_user(
        event=SESSION_TERMINATED,
        action="Terminate Session",
        application=APPLICATION_MEDINSPECT,
        module=MODULE_USER_MANAGEMENT,
        authenticated_user=admin_user,
        status=STATUS_SUCCESS,
        description="Session terminated by administrator.",
        session_id=session_id,
        entity_type="Session",
        entity_id=session_id,
        metadata={
            "targetUserId": existing.get("userId", ""),
            "targetUserEmail": existing.get("email", ""),
            "targetAccountType": existing.get("accountType", ""),
            "targetSessionId": session_id,
        },
    )

    try:
        cosmos_delete_document("sessions", session_id)
    except Exception:
        _IN_MEMORY_SESSIONS.pop(session_id, None)
    return jsonify({"terminated": True, "sessionId": session_id}), 200


@app.route("/api/users/me", methods=["GET"])
def api_current_user():
    """Return the authenticated user's profile from Cosmos DB.

    The frontend sends the user's email in the X-User-Email header
    (since the mock JWT tokens are not real). The backend queries
    Cosmos DB for the user document with that email.
    """
    user_email = request.headers.get("X-User-Email", "").strip().lower()
    if not user_email:
        return jsonify({"error": "X-User-Email header is required."}), 400

    try:
        # Query Cosmos DB for the user with this email
        users = cosmos_query_documents(
            "users",
            {
                "query": "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email)",
                "parameters": [{"name": "@email", "value": user_email}],
            },
        )
        if not users:
            return jsonify({"error": "User not found."}), 404

        return jsonify(users[0]), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/users/me/password", methods=["PUT"])
def api_change_password():
    """Update the authenticated user's password in Cosmos DB.

    Expects JSON body: { "newPassword": "...", "confirmPassword": "..." }
    """
    user_email = request.headers.get("X-User-Email", "").strip().lower()
    if not user_email:
        return jsonify({"error": "X-User-Email header is required."}), 400

    payload = request.get_json(silent=True) or {}
    new_password = payload.get("newPassword") or ""
    confirm_password = payload.get("confirmPassword") or ""

    if not new_password:
        return jsonify({"error": "newPassword is required."}), 400
    if new_password != confirm_password:
        return jsonify({"error": "Passwords do not match."}), 400
    if len(new_password) < 8:
        return jsonify({"error": "Password must be at least 8 characters long."}), 400

    try:
        # Find the user in Cosmos DB
        users = cosmos_query_documents(
            "users",
            {
                "query": "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email)",
                "parameters": [{"name": "@email", "value": user_email}],
            },
        )
        if not users:
            return jsonify({"error": "User not found."}), 404

        user = users[0]
        user["password"] = hash_password(new_password)

        # Update the user document in Cosmos DB
        cosmos_upsert_document("users", user)
        return jsonify({"status": "ok", "message": "Password updated successfully."}), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/users/me/preferences", methods=["PUT"])
def api_update_preferences():
    """Update the authenticated user's preferences in Cosmos DB.

    Expects JSON body: { "emailNotificationsEnabled": true/false }
    """
    user_email = request.headers.get("X-User-Email", "").strip().lower()
    if not user_email:
        return jsonify({"error": "X-User-Email header is required."}), 400

    payload = request.get_json(silent=True) or {}
    email_notifications = payload.get("emailNotificationsEnabled")
    if email_notifications is None:
        return jsonify({"error": "emailNotificationsEnabled is required."}), 400

    try:
        # Find the user in Cosmos DB
        users = cosmos_query_documents(
            "users",
            {
                "query": "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email)",
                "parameters": [{"name": "@email", "value": user_email}],
            },
        )
        if not users:
            return jsonify({"error": "User not found."}), 404

        user = users[0]
        user["emailNotificationsEnabled"] = bool(email_notifications)

        # Update the user document in Cosmos DB
        result = cosmos_upsert_document("users", user)
        return jsonify({"emailNotificationsEnabled": result.get("emailNotificationsEnabled", bool(email_notifications))}), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/<resource>/<resource_id>", methods=["GET", "PUT", "DELETE"])
def api_resource_item(resource, resource_id):
    if resource not in ALLOWED_RESOURCE_TYPES:
        return jsonify({"error": f"Unsupported resource '{resource}'"}), 404

    if request.method == "GET":
        try:
            item = cosmos_get_document(resource, resource_id)
            return jsonify(item), 200
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    if request.method == "DELETE":
        try:
            # For user deletions, capture user info before deleting for audit
            deleted_user_info = None
            if resource == "users":
                try:
                    deleted_user_info = cosmos_get_document(resource, resource_id)
                except Exception:
                    pass

            result = cosmos_delete_document(resource, resource_id)

            # Audit user deletion
            if resource == "users" and deleted_user_info:
                # Get the admin who performed this action (from authenticated context)
                admin_user, admin_error = _authenticated_identity()
                if admin_error:
                    return admin_error
                log_from_authenticated_user(
                    event=USER_DELETED,
                    action="Delete User",
                    application=APPLICATION_MEDINSPECT,
                    module=MODULE_USER_MANAGEMENT,
                    authenticated_user=admin_user,
                    status=STATUS_SUCCESS,
                    description=f"User deleted. Email={deleted_user_info.get('email', '')}",
                    entity_type="User",
                    entity_id=resource_id,
                    metadata={
                        "deletedUserEmail": deleted_user_info.get("email", ""),
                        "deletedUserId": deleted_user_info.get("id", resource_id),
                        "deletedAccountType": deleted_user_info.get("accountType", ""),
                    },
                )

            return jsonify(result), 200
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    payload = request.get_json(silent=True) or {}
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object body required."}), 400

    payload.setdefault("id", resource_id)
    payload = normalize_resource_payload(resource, payload)
    try:
        validated = validate_resource_payload(resource, payload)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    # For user updates, capture the original user data for change tracking
    original_user = None
    if resource == "users":
        try:
            original_user = cosmos_get_document(resource, resource_id)
        except Exception:
            pass

    # Enforce admin-only authorization for user updates
    if resource == "users":
        admin_user, admin_error = _authenticated_identity(require_admin=True)
        if admin_error:
            return admin_error

    # Hash plaintext passwords on user create/update. Already-hashed values
    # (e.g. round-tripped from the DB) are left untouched.
    if resource == "users" and isinstance(validated.get("password"), str) and not is_password_hashed(validated["password"]):
        validated["password"] = hash_password(validated["password"])

    try:
        result = cosmos_upsert_document(resource, validated)

        # Audit user update
        if resource == "users":
            account_type = validated.get("accountType", "User")
            changes = {}

            # Track account type change
            if original_user and original_user.get("accountType") != account_type:
                changes["accountType"] = {
                    "from": original_user.get("accountType"),
                    "to": account_type,
                }
                log_from_authenticated_user(
                    event=ACCOUNT_TYPE_CHANGED,
                    action="Change Account Type",
                    application=APPLICATION_MEDINSPECT,
                    module=MODULE_USER_MANAGEMENT,
                    authenticated_user=admin_user,
                    status=STATUS_SUCCESS,
                    description=f"Account type changed from {original_user.get('accountType')} to {account_type}. User={validated.get('email', '')}",
                    entity_type="User",
                    entity_id=resource_id,
                    changes=changes,
                )

            # Track account status change
            original_status = original_user.get("accountStatus") if original_user else None
            new_status = validated.get("accountStatus")
            if original_status and new_status and original_status != new_status:
                event_type = USER_ENABLED if new_status == "Active" else USER_DISABLED
                action_text = "Enable User" if new_status == "Active" else "Disable User"
                changes["accountStatus"] = {
                    "from": original_status,
                    "to": new_status,
                }
                log_from_authenticated_user(
                    event=event_type,
                    action=action_text,
                    application=APPLICATION_MEDINSPECT,
                    module=MODULE_USER_MANAGEMENT,
                    authenticated_user=admin_user,
                    status=STATUS_SUCCESS,
                    description=f"User {action_text.lower()}. Email={validated.get('email', '')}; Status changed from {original_status} to {new_status}",
                    entity_type="User",
                    entity_id=resource_id,
                    changes=changes,
                )

            # General user update audit (if no specific change was logged above,
            # or in addition to capture the full update)
            if original_user and not changes:
                log_from_authenticated_user(
                    event=USER_UPDATED,
                    action="Update User",
                    application=APPLICATION_MEDINSPECT,
                    module=MODULE_USER_MANAGEMENT,
                    authenticated_user=admin_user,
                    status=STATUS_SUCCESS,
                    description=f"User updated. Email={validated.get('email', '')}",
                    entity_type="User",
                    entity_id=resource_id,
                )

        return jsonify(result), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ---------------------------------------------------------------------------
# Persistent inspections: Cosmos DB metadata + Azure Blob Storage files
# ---------------------------------------------------------------------------

INSPECTIONS_CONTAINER = "inspections"
# Blob containers must match the names provisioned by
# ensure_storage_containers() in src/azure_service.py — they carry the
# configured storage_container_prefix (e.g. "hackathon-master-files").
from src.azure_service import get_azure_settings

_CONTAINER_PREFIX = get_azure_settings().storage_container_prefix or ""
MASTER_FILES_CONTAINER = f"{_CONTAINER_PREFIX}-master-files".lstrip("-")
SAMPLE_FILES_CONTAINER = f"{_CONTAINER_PREFIX}-sample-files".lstrip("-")

VALID_INSPECTION_STATUSES = {
    "uploaded", "submitted", "processing", "completed", "failed", "cancelled",
}


def _safe_blob_name(name: str) -> str:
    """Sanitize a user-supplied file name for use inside a blob path."""
    base = os.path.basename(name or "file")
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    return safe or "file"


def _new_inspection_id() -> str:
    """Human-readable unique inspection id, e.g. INS-20260904153045-7f3a."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"INS-{stamp}-{uuid.uuid4().hex[:4]}"


def _file_meta(file_id: str, file_obj, blob_path: str, size: int) -> dict:
    original = file_obj.filename or "file"
    return {
        "fileId": file_id,
        "fileName": original,
        "fileType": os.path.splitext(original)[1].lstrip(".").lower(),
        "blobPath": blob_path,
        "size": size,
    }


def _inspection_to_client(record: dict, include_result: bool = False) -> dict:
    """Shape an inspection record for API responses.

    `include_result` is set only for the single-inspection GET — the full
    report (with rendered page images) would make list responses heavy.
    """
    client = {
        "inspectionId": record.get("id", ""),
        "userId": record.get("userId", ""),
        "accountType": record.get("accountType", "User"),
        "inspectionType": record.get("inspectionType", "text"),
        "status": record.get("status", "uploaded"),
        "masterFile": record.get("masterFile"),
        "sampleFile": record.get("sampleFile"),
        "createdAt": record.get("createdAt"),
        "uploadedAt": record.get("uploadedAt"),
        "submittedAt": record.get("submittedAt"),
        "startedAt": record.get("startedAt"),
        "completedAt": record.get("completedAt"),
        "failedReason": record.get("failedReason"),
        "resultId": record.get("resultId"),
        # Full result (with the stored report) is only meaningful on the
        # single-inspection payload; the list keeps it for simplicity since
        # the list query already returns complete records.
        "result": record.get("result"),
    }
    if include_result:
        client["result"] = record.get("result")
    return client


def _get_inspection_record(inspection_id: str):
    """Fetch an inspection record via a parameterized query.

    Uses the query route (proven to work through the APIM Cosmos API)
    instead of the point-read route.
    """
    records = cosmos_query_documents(
        INSPECTIONS_CONTAINER,
        {
            "query": "SELECT * FROM c WHERE c.id = @id AND c.domain = @domain",
            "parameters": [
                {"name": "@id", "value": inspection_id},
                {"name": "@domain", "value": INSPECTIONS_CONTAINER},
            ],
        },
    ) or []
    return records[0] if records else None


def _delete_inspection_record(inspection_id: str) -> None:
    """Soft-delete an inspection record via a reliable upsert.

    The APIM Cosmos gateway does not accept single-document DELETE requests
    (the authorization token signature for the delete verb is rejected), so
    we set a `deleted` flag on the existing record through `upsert`, which is
    the path proven to work. Deleted records are excluded from all reads.
    """
    record = _get_inspection_record(inspection_id)
    if not record:
        raise LookupError(f"Inspection {inspection_id} not found")
    record["deleted"] = True
    record["deletedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cosmos_upsert_document(INSPECTIONS_CONTAINER, record)


def _update_inspection_status(inspection_id: str, **updates) -> dict:
    """Merge status/timestamp updates into an inspection record."""
    record = _get_inspection_record(inspection_id)
    if not record:
        raise LookupError(f"Inspection {inspection_id} not found")
    record.update(updates)
    cosmos_upsert_document(INSPECTIONS_CONTAINER, record)
    return record


@app.route("/api/inspections", methods=["GET", "POST"])
def api_inspections():
    """List the current user's inspections / create a new inspection.

    Ownership is enforced server-side: the userId in every query/filter comes
    from the authenticated identity resolved against the database — never
    from any client-supplied value.
    """
    user, error = _authenticated_identity()
    if error:
        return error
    user_id = user.get("id", "")

    if request.method == "GET":
        try:
            limit = request.args.get("limit", type=int)
            query = {
                "query": "SELECT * FROM c WHERE c.userId = @userId "
                         "AND (NOT IS_DEFINED(c.deleted) OR c.deleted = false) "
                         "ORDER BY c.createdAt DESC",
                "parameters": [{"name": "@userId", "value": user_id}],
            }
            records = cosmos_query_documents(INSPECTIONS_CONTAINER, query) or []
            if limit and limit > 0:
                records = records[:limit]
            return jsonify([_inspection_to_client(r) for r in records]), 200
        except Exception as exc:
            logger.error("[INSPECTIONS] List failed: %s", exc)
            return jsonify({"error": "Failed to load inspections."}), 500

    # POST — create the inspection: metadata in Cosmos, files in Blob Storage
    master = request.files.get("master")
    sample = request.files.get("sample")
    inspection_type = (request.form.get("inspectionType") or "text").strip().lower()
    if not master or not sample:
        return jsonify({"error": "master and sample files are required"}), 400

    inspection_id = _new_inspection_id()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    master_file_id = f"FILE-{uuid.uuid4().hex[:8]}"
    sample_file_id = f"FILE-{uuid.uuid4().hex[:8]}"

    master_blob = (
        f"{inspection_id}-master-{master_file_id}-{_safe_blob_name(master.filename)}"
    )
    sample_blob = (
        f"{inspection_id}-sample-{sample_file_id}-{_safe_blob_name(sample.filename)}"
    )
    # NOTE: blob names are kept flat (no "/" segments) because the configured
    # Azure APIM storage gateway routes a single path segment per blob. The
    # inspectionFiles/…/{master|sample}/… logical structure is achieved via
    # the container split (master-files / sample-files) and the inspectionId
    # prefix on every blob name.

    master_content = master.read()
    sample_content = sample.read()

    try:
        upload_blob(
            MASTER_FILES_CONTAINER, master_blob, master_content,
            content_type=master.mimetype or "application/octet-stream",
        )
        upload_blob(
            SAMPLE_FILES_CONTAINER, sample_blob, sample_content,
            content_type=sample.mimetype or "application/octet-stream",
        )
    except Exception as exc:
        logger.error("[INSPECTIONS] Blob upload failed for %s: %s", inspection_id, exc)
        return jsonify({"error": "Failed to store uploaded files."}), 500

    record = {
        "id": inspection_id,
        "userId": user_id,
        "accountType": str(user.get("accountType", "User")),
        "domain": INSPECTIONS_CONTAINER,  # partition key
        "inspectionType": inspection_type,
        "status": "uploaded",
        "masterFile": _file_meta(master_file_id, master, master_blob, len(master_content)),
        "sampleFile": _file_meta(sample_file_id, sample, sample_blob, len(sample_content)),
        "createdAt": now,
        "uploadedAt": now,
        "submittedAt": None,
        "startedAt": None,
        "completedAt": None,
        "resultId": None,
        "createdBy": user_id,
    }
    # Keep local copies FIRST so the existing inspection engine (which reads
    # from UPLOAD_ROOT) keeps working unchanged — this must happen before the
    # Cosmos write so a Cosmos outage cannot force the frontend to re-upload
    # both PDFs through the legacy /api/upload fallback.
    try:
        session_dir = os.path.join(UPLOAD_ROOT, inspection_id)
        os.makedirs(session_dir, exist_ok=True)
        with open(os.path.join(session_dir, "master.pdf"), "wb") as fh:
            fh.write(master_content)
        with open(os.path.join(session_dir, "sample.pdf"), "wb") as fh:
            fh.write(sample_content)
    except Exception as exc:
        logger.warning("[INSPECTIONS] Local cache write failed for %s: %s", inspection_id, exc)

    try:
        cosmos_upsert_document(INSPECTIONS_CONTAINER, record)
    except Exception as exc:
        # Non-fatal: the files are already stored in Blob Storage and the local
        # engine copies exist, so the inspection can run without re-upload.
        # Only the history listing (Cosmos-backed) is affected. Returning 201
        # here prevents the frontend's ephemeral fallback from uploading the
        # same PDFs a second time through POST /api/upload.
        logger.error(
            "[INSPECTIONS] Cosmos write failed for %s — inspection still usable, "
            "but it will not appear in history until persistence recovers: %s",
            inspection_id, exc,
        )
        record["persisted"] = False
        return jsonify(_inspection_to_client(record)), 201

    # Audit: FILE_UPLOADED for master file
    log_from_authenticated_user(
        event=FILE_UPLOADED,
        action="File Upload",
        application=APPLICATION_MEDINSPECT,
        module=MODULE_TEXT_INSPECTION,
        authenticated_user=user,
        status=STATUS_SUCCESS,
        description=f"Master File uploaded. File={master.filename}",
        entity_type="File",
        entity_id=master_file_id,
        inspection_id=inspection_id,
        file_id=master_file_id,
        file_name=master.filename,
        master_file_name=master.filename,
    )

    # Audit: FILE_UPLOADED for sample file
    log_from_authenticated_user(
        event=FILE_UPLOADED,
        action="File Upload",
        application=APPLICATION_MEDINSPECT,
        module=MODULE_TEXT_INSPECTION,
        authenticated_user=user,
        status=STATUS_SUCCESS,
        description=f"Sample File uploaded. File={sample.filename}",
        entity_type="File",
        entity_id=sample_file_id,
        inspection_id=inspection_id,
        file_id=sample_file_id,
        file_name=sample.filename,
        sample_file_name=sample.filename,
    )

    # Audit: INSPECTION_CREATED
    log_from_authenticated_user(
        event=INSPECTION_CREATED,
        action="Create Inspection",
        application=APPLICATION_MEDINSPECT,
        module=MODULE_TEXT_INSPECTION,
        authenticated_user=user,
        status=STATUS_SUCCESS,
        description=f"Inspection created. Inspection ID={inspection_id}; Type={inspection_type}",
        entity_type="Inspection",
        entity_id=inspection_id,
        inspection_id=inspection_id,
        master_file_name=master.filename,
        sample_file_name=sample.filename,
    )

    return jsonify(_inspection_to_client(record)), 201


@app.route("/api/inspections/<inspection_id>", methods=["GET", "DELETE"])
def api_inspection_by_id(inspection_id: str):
    """Retrieve / delete a single inspection (owner-only).

    The backend verifies that the inspection belongs to the authenticated
    user before returning or deleting it. Another user's inspection is
    never exposed.
    """
    user, error = _authenticated_identity()
    if error:
        return error
    user_id = user.get("id", "")

    try:
        record = _get_inspection_record(inspection_id)
    except Exception as exc:
        logger.error("[INSPECTIONS] Fetch failed for %s: %s", inspection_id, exc)
        return jsonify({"error": "Failed to load the inspection."}), 500

    if not record:
        return jsonify({"error": "Inspection not found."}), 404
    if record.get("userId") != user_id:
        return jsonify({"error": "You do not have access to this inspection."}), 403

    # A soft-deleted inspection behaves as not found for owners too.
    if record.get("deleted") and request.method != "DELETE":
        return jsonify({"error": "Inspection not found."}), 404

    # AUDIT: record that the inspection was viewed (before returning data)
    if request.method == "GET":
        try:
            log_from_authenticated_user(
                event=INSPECTION_VIEWED,
                action="View Inspection",
                application=APPLICATION_MEDINSPECT,
                module=MODULE_TEXT_INSPECTION,
                authenticated_user=user,
                status=STATUS_SUCCESS,
                description=f"Inspection viewed. Inspection ID={inspection_id}",
                entity_type="Inspection",
                entity_id=inspection_id,
                metadata={
                    "inspectionType": record.get("inspectionType", ""),
                    "inspectionStatus": record.get("status", ""),
                    "masterFileName": record.get("masterFile", {}).get("fileName", ""),
                    "sampleFileName": record.get("sampleFile", {}).get("fileName", ""),
                },
            )
        except Exception:
            pass  # Audit failure must never block the view

    if request.method == "DELETE":
        for meta_key in ("masterFile", "sampleFile"):
            meta = record.get(meta_key) or {}
            blob_path = meta.get("blobPath")
            if blob_path:
                container = (
                    MASTER_FILES_CONTAINER if meta_key == "masterFile"
                    else SAMPLE_FILES_CONTAINER
                )
                try:
                    delete_blob(container, blob_path)
                except Exception:
                    pass
        try:
            _delete_inspection_record(inspection_id)
        except Exception as exc:
            logger.error("[INSPECTIONS] Delete failed for %s: %s", inspection_id, exc)
            return jsonify({"error": "Failed to delete the inspection."}), 500
        return jsonify({"deleted": True, "inspectionId": inspection_id}), 200

    return jsonify(_inspection_to_client(record, include_result=True)), 200


@app.route("/api/inspections/<inspection_id>/file", methods=["GET"])
def api_inspection_file(inspection_id: str):
    """Stream an inspection's master/sample file (owner-verified).

    Returns the actual file bytes that were persisted for the inspection so
    the frontend can reconstruct a real File object for the PDF viewer. The
    authenticated user must own the inspection — otherwise nothing is
    returned (403). This is a secure download path: blob storage keys and
    connection strings never reach the browser.
    """
    user, error = _authenticated_identity()
    if error:
        return error
    user_id = user.get("id", "")

    side = request.args.get("side", "")
    if side not in ("master", "sample"):
        return jsonify({"error": "side must be 'master' or 'sample'"}), 400

    try:
        record = _get_inspection_record(inspection_id)
    except Exception as exc:
        logger.error("[INSPECTIONS] file fetch failed for %s: %s", inspection_id, exc)
        return jsonify({"error": "Failed to load the inspection."}), 500

    if not record:
        return jsonify({"error": "Inspection not found."}), 404
    if record.get("userId") != user_id:
        return jsonify({"error": "You do not have access to this inspection."}), 403
    if record.get("deleted"):
        return jsonify({"error": "Inspection not found."}), 404

    # Remap the persisted blob / local engine copy into a file path.
    side_key = "masterFile" if side == "master" else "sampleFile"
    file_meta = record.get(side_key) or {}
    file_name = file_meta.get("fileName") or (f"{side}.pdf")

    # Prefer the local engine copy written at creation time.
    local_path = os.path.join(UPLOAD_ROOT, inspection_id, f"{side}.pdf")
    if os.path.exists(local_path):
        with open(local_path, "rb") as fh:
            data = fh.read()
    else:
        # Fall back to Azure Blob Storage (owner already verified above).
        try:
            blob_path = file_meta.get("blobPath")
            if not blob_path:
                return jsonify({"error": "File is not available."}), 404
            container = (
                MASTER_FILES_CONTAINER if side == "master"
                else SAMPLE_FILES_CONTAINER
            )
            data = download_blob(container, blob_path)
        except Exception as exc:
            logger.error("[INSPECTIONS] blob download failed for %s: %s", inspection_id, exc)
            return jsonify({"error": "File is not available."}), 500

    mime_type = "application/pdf"
    ext = file_name.lower().rsplit(".", 1)[-1] if "." in file_name else ""
    if ext == "docx":
        mime_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    elif ext == "doc":
        mime_type = "application/msword"
    elif ext in ("png", "jpg", "jpeg", "gif", "bmp"):
        mime_type = f"image/{ext}"

    return (
        data,
        200,
        {
            "Content-Type": mime_type,
            "Content-Disposition": f'attachment; filename="{file_name}"',
        },
    )


@app.route("/api/storage/upload", methods=["POST"])
def api_storage_upload():
    folder_name = request.form.get("folder_name") or "uploads"
    file_name = request.form.get("file_name") or "upload.bin"
    file_obj = request.files.get("file")
    if not file_obj:
        return jsonify({"error": "file is required."}), 400

    try:
        content = file_obj.read()
        url = upload_blob(folder_name, file_name, content, content_type=file_obj.mimetype or "application/octet-stream")
        return jsonify({"url": url, "folder": folder_name, "file_name": file_name}), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/storage/download", methods=["GET"])
def api_storage_download():
    folder_name = request.args.get("folder_name") or "uploads"
    file_name = request.args.get("file_name")
    if not file_name:
        return jsonify({"error": "file_name is required."}), 400

    try:
        data = download_blob(folder_name, file_name)
        return data, 200, {"Content-Type": "application/octet-stream"}
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/upload", methods=["POST"])
def api_upload():
    session_id = request.form.get("session_id")
    side = request.form.get("side")
    file = request.files.get("file")

    if not session_id or side not in ("master", "sample") or not file:
        return jsonify({"error": "session_id, side (master/sample), and file are required"}), 400

    session_dir = os.path.join(UPLOAD_ROOT, session_id)
    os.makedirs(session_dir, exist_ok=True)
    pdf_path = os.path.join(session_dir, f"{side}.pdf")
    file.save(pdf_path)

    try:
        t0 = time.perf_counter()
        preview_dir = os.path.join(OUTPUT_ROOT, session_id)
        os.makedirs(preview_dir, exist_ok=True)
        preview_path = os.path.join(preview_dir, f"{side}_preview_p0.png")
        w, h = render_page(pdf_path, 0, preview_path, dpi=PREVIEW_DPI)
        logger.info(
            "[timing] upload preview render (%s): %.2fs at %d DPI (%dx%d)",
            side, time.perf_counter() - t0, PREVIEW_DPI, w, h,
        )
    except Exception as e:
        return jsonify({"error": f"Could not render preview: {str(e)}"}), 500

    return jsonify({
        "side": side,
        "image": f"/images/{session_id}/{side}_preview_p0.png",
        "width": w,
        "height": h,
        "filename": file.filename,
    })


@app.route("/api/inspect", methods=["POST"])
def api_inspect():
    data = request.get_json() or {}
    session_id = data.get("session_id")
    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    # Optional Difference Filter payload — {"<filter key>": bool} matching
    # the frontend Inspection sidebar's Difference Filter checkboxes
    # (case, change, deletion, hyphen, insertion, location, bold, color,
    # fontType, space, size, underline). Disabled checkers are skipped
    # entirely by the backend pipeline so no filtered-out findings are
    # produced or reported. When absent, every type is checked.
    filters = data.get("filters")

    # Determine which inspection pipeline to run.
    # Falls back to "text" for backward compatibility when the
    # front-end doesn't send inspection_type (older clients).
    inspection_type = data.get("inspection_type", "text")

    # Optional persistent inspection linkage. When the frontend sends an
    # inspection_id (created via POST /api/inspections), the lifecycle
    # status/timestamps are tracked in Cosmos DB and the result is stored
    # against that inspection for the owning user.
    inspection_id = (data.get("inspection_id") or "").strip() or None
    inspection_record = None
    if inspection_id:
        caller, auth_error = _authenticated_identity()
        if auth_error:
            return auth_error
        try:
            inspection_record = _get_inspection_record(inspection_id)
        except Exception as exc:
            logger.error("[INSPECT] Load failed for %s: %s", inspection_id, exc)
            return jsonify({"error": "Failed to load the inspection."}), 500
        if not inspection_record:
            return jsonify({"error": "Inspection not found."}), 404
        if inspection_record.get("userId") != caller.get("id", ""):
            return jsonify({"error": "You do not have access to this inspection."}), 403
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        _update_inspection_status(
            inspection_id,
            status="processing",
            submittedAt=inspection_record.get("submittedAt") or now,
            startedAt=now,
            inspectionType=inspection_type,
        )

        # Audit: INSPECTION_STARTED
        master_file_name = inspection_record.get("masterFile", {}).get("fileName", "")
        sample_file_name = inspection_record.get("sampleFile", {}).get("fileName", "")
        log_from_authenticated_user(
            event=INSPECTION_STARTED,
            action="Start Inspection",
            application=APPLICATION_MEDINSPECT,
            module=MODULE_TEXT_INSPECTION,
            authenticated_user=caller,
            status=STATUS_SUCCESS,
            description=f"Inspection started. Inspection ID={inspection_id}; Type={inspection_type}",
            entity_type="Inspection",
            entity_id=inspection_id,
            inspection_id=inspection_id,
            master_file_name=master_file_name,
            sample_file_name=sample_file_name,
        )

    try:
        config = get_inspection_config(inspection_type)
    except ValueError as e:
        if inspection_id:
            _update_inspection_status(
                inspection_id,
                status="failed",
                failedReason="Unknown inspection type.",
                completedAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            )
            # Audit: INSPECTION_FAILED
            log_from_authenticated_user(
                event=INSPECTION_FAILED,
                action="Inspection Failed",
                application=APPLICATION_MEDINSPECT,
                module=MODULE_TEXT_INSPECTION,
                authenticated_user=caller,
                status=STATUS_FAILED,
                description=f"Inspection failed. Inspection ID={inspection_id}; Reason=Unknown inspection type",
                entity_type="Inspection",
                entity_id=inspection_id,
                inspection_id=inspection_id,
            )
        return jsonify({"error": str(e)}), 400

    session_dir = os.path.join(UPLOAD_ROOT, session_id)
    master_path = os.path.join(session_dir, "master.pdf")
    sample_path = os.path.join(session_dir, "sample.pdf")

    if not os.path.exists(master_path) or not os.path.exists(sample_path):
        if inspection_id:
            _update_inspection_status(
                inspection_id,
                status="failed",
                failedReason="Master and sample files are missing.",
                completedAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            )
        return jsonify({"error": "Both Master and Sample must be uploaded first"}), 400

    try:
        result = config.pipeline(master_path, sample_path, filters=filters)
    except Exception as e:
        if inspection_id:
            # Store a safe, generic failure reason — no internal details.
            logger.error("[INSPECT] Pipeline failed for %s: %s", inspection_id, e)
            _update_inspection_status(
                inspection_id,
                status="failed",
                failedReason=f"{config.label} failed during processing.",
                completedAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            )
            # Audit: INSPECTION_FAILED
            log_from_authenticated_user(
                event=INSPECTION_FAILED,
                action="Inspection Failed",
                application=APPLICATION_MEDINSPECT,
                module=MODULE_TEXT_INSPECTION,
                authenticated_user=caller,
                status=STATUS_FAILED,
                description=f"Inspection failed. Inspection ID={inspection_id}; Reason={config.label} failed during processing",
                entity_type="Inspection",
                entity_id=inspection_id,
                inspection_id=inspection_id,
            )
        return jsonify({"error": f"{config.label} failed: {str(e)}"}), 500

    output_dir = os.path.join(OUTPUT_ROOT, session_id)

    try:
        report = build_report(master_path, sample_path, result, output_dir)
    except Exception as e:
        if inspection_id:
            logger.error("[INSPECT] Report rendering failed for %s: %s", inspection_id, e)
            _update_inspection_status(
                inspection_id,
                status="failed",
                failedReason="Report rendering failed.",
                completedAt=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            )
        return jsonify({"error": f"Report rendering failed: {str(e)}"}), 500

    for page in report["pages"]:
        if "master_image" in page:
            page["master_image"] = f"/images/{session_id}/{os.path.basename(page['master_image'])}"
        if "sample_image" in page:
            page["sample_image"] = f"/images/{session_id}/{os.path.basename(page['sample_image'])}"

    report["match_stats"] = result["match_stats"]

    if inspection_id:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        result_id = f"RES-{inspection_id}"
        try:
            _update_inspection_status(
                inspection_id,
                status="completed",
                completedAt=now,
                resultId=result_id,
                result={"resultId": result_id, "report": report},
            )
            # Audit: INSPECTION_COMPLETED
            log_from_authenticated_user(
                event=INSPECTION_COMPLETED,
                action="Inspection Completed",
                application=APPLICATION_MEDINSPECT,
                module=MODULE_TEXT_INSPECTION,
                authenticated_user=caller,
                status=STATUS_SUCCESS,
                description=f"Inspection completed successfully. Inspection ID={inspection_id}",
                entity_type="Inspection",
                entity_id=inspection_id,
                inspection_id=inspection_id,
                metadata={
                    "resultId": result_id,
                    "findingsCount": len(report.get("findings", [])),
                },
            )
        except Exception as exc:
            logger.error("[INSPECT] Result persistence failed for %s: %s", inspection_id, exc)

    return jsonify(report)


@app.route("/api/inspection/share", methods=["POST"])
def api_share_inspection():
    """
    Receives the inspection report PDF as a multipart upload and emails
    it to the recipient as an attachment.

    Form fields:
        recipientEmail   — recipient email address (required, validated)
        sessionId        — inspection session id
        masterFileName   — master file name
        sampleFileName   — sample file name
        reportPdf        — the PDF file attachment
    """
    logger.info("[SHARE REPORT] Request received")

    recipient_email = request.form.get("recipientEmail", "").strip()
    session_id = request.form.get("sessionId", "").strip()
    master_file_name = request.form.get("masterFileName", "").strip()
    sample_file_name = request.form.get("sampleFileName", "").strip()
    report_pdf = request.files.get("reportPdf")

    logger.info("[SHARE REPORT] Recipient: %s", recipient_email)

    # Validate recipient email
    if not recipient_email:
        return jsonify({"error": "Recipient email is required."}), 400

    email_regex = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    if not re.match(email_regex, recipient_email):
        return jsonify({"error": "Please enter a valid email address."}), 400

    # Validate PDF attachment
    if report_pdf is None or report_pdf.filename == "":
        return jsonify({"error": "Report PDF is required."}), 400

    pdf_bytes = report_pdf.read()
    if not pdf_bytes:
        return jsonify({"error": "Report PDF is empty."}), 400

    logger.info("[SHARE REPORT] PDF received")
    logger.info("[SHARE REPORT] PDF size: %d bytes", len(pdf_bytes))

    try:
        send_inspection_report_email(
            recipient_email=recipient_email,
            session_id=session_id or "unknown",
            master_file_name=master_file_name or "Unknown",
            sample_file_name=sample_file_name or "Unknown",
            pdf_bytes=pdf_bytes,
        )
    except ValueError as e:
        # Configuration error — expose the missing variable names so the
        # user knows exactly what to set, but never the credentials themselves
        logger.error("[SHARE REPORT] Email configuration error: %s", e)
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        # SMTP / provider failure — do not expose internal details
        logger.error("[SHARE REPORT] Email sending failed: %s", e)
        return jsonify({"error": "Failed to send the email. Please try again."}), 500

    return jsonify({
        "success": True,
        "message": "Inspection report shared successfully.",
    })


@app.route("/images/<session_id>/<filename>")
def serve_image(session_id, filename):
    return send_from_directory(os.path.join(OUTPUT_ROOT, session_id), filename)


INDEX_HTML = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Text Inspection</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; margin: 0; background: #f4f4f4; }
  header { background: #1a1a1a; color: white; padding: 12px 20px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 18px; margin: 0; }

  .upload-bar { display: flex; gap: 16px; padding: 14px 20px; background: white; border-bottom: 1px solid #ddd; align-items: center; }
  .upload-slot { display: flex; align-items: center; gap: 8px; }
  .upload-slot label { font-weight: 600; font-size: 13px; color: #444; }
  .upload-slot input[type=file] { font-size: 13px; }
  .upload-status { font-size: 12px; color: #2e7d32; }
  #inspectBtn { padding: 8px 20px; background: #d32f2f; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-left: auto; }
  #inspectBtn:disabled { background: #ccc; cursor: not-allowed; }
  #inspectBtn:hover:not(:disabled) { background: #b71c1c; }

  .zoom-bar { display: flex; gap: 20px; align-items: center; padding: 8px 20px; background: #eee; border-bottom: 1px solid #ddd; }
  .zoom-group { display: flex; gap: 6px; align-items: center; }
  .zoom-group .zoom-label { font-size: 12px; font-weight: 600; color: #444; min-width: 55px; }
  .zoom-bar button { padding: 4px 10px; cursor: pointer; }
  .zoom-bar span.zoom-pct { font-size: 12px; color: #555; min-width: 45px; text-align: center; display: inline-block; }

  .previews { display: flex; gap: 0; padding: 4px; background: #ccc; height: 58vh; }
  .preview-col { flex: 1 1 0; min-width: 80px; background: white; overflow: auto; position: relative; }
  .preview-col .label { position: sticky; top: 0; background: #1a1a1a; color: white; padding: 6px 10px; font-size: 12px; z-index: 10; }
  .preview-placeholder { padding: 60px 20px; text-align: center; color: #999; font-size: 14px; }
  .preview-wrap { position: relative; display: inline-block; transform-origin: top left; }
  .preview-wrap img { display: block; }
  .highlight-box { position: absolute; border: 2px solid #d32f2f; background: rgba(211,47,47,0.18); pointer-events: auto; display: none; cursor: help; }

  .col-resize-handle { flex: 0 0 6px; background: #999; cursor: col-resize; position: relative; z-index: 5; }
  .col-resize-handle:hover, .col-resize-handle.dragging { background: #d32f2f; }
  .col-resize-handle::after { content: ''; position: absolute; top: 50%; left: 50%; width: 2px; height: 26px; background: rgba(255,255,255,0.85); transform: translate(-50%, -50%); }

  .drag-handle { height: 10px; background: #d32f2f; cursor: ns-resize; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .drag-handle::before { content: ''; width: 40px; height: 3px; background: rgba(255,255,255,0.7); border-radius: 2px; }

  .results-panel { position: fixed; bottom: 0; left: 0; right: 0; background: white;
                    max-height: 85vh; min-height: 120px; height: 42vh; display: flex; flex-direction: column;
                    transform: translateY(100%); transition: transform 0.2s ease; box-shadow: 0 -4px 12px rgba(0,0,0,0.2); }
  .results-panel.open { transform: translateY(0); }
  .results-panel.dragging { transition: none; }
  .results-header { padding: 10px 16px; background: #1a1a1a; color: white; font-size: 13px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
  .results-header button { background: transparent; border: 1px solid #666; color: white; border-radius: 4px; cursor: pointer; padding: 2px 10px; }
  .results-body { overflow-y: auto; flex: 1; }

  table.findings-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.findings-table thead th { position: sticky; top: 0; background: #263238; color: white; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
  table.findings-table tbody tr { cursor: pointer; border-bottom: 1px solid #eee; }
  table.findings-table tbody tr:nth-child(even) { background: #fafafa; }
  table.findings-table tbody tr:hover { background: #e3f2fd; }
  table.findings-table tbody tr.active { background: #fff3e0; box-shadow: inset 3px 0 0 #d32f2f; }
  table.findings-table td { padding: 7px 10px; vertical-align: top; }
  .type-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: white; }
  .type-Change { background: #f57c00; }
  .type-Insertion { background: #2e7d32; }
  .type-Deletion { background: #c62828; }
  .type-Location { background: #1565c0; }
  .type-badge.grouped { background: #6a1b9a; }
  .val-master { color: #b71c1c; text-decoration: line-through; text-decoration-color: rgba(183,20,20,0.5); }
  .val-sample { color: #2e7d32; font-weight: 600; }
  .comment-cell { color: #666; font-style: italic; max-width: 300px; }
  .findings-list-empty { padding: 10px 20px; color: #666; font-size: 13px; }
  .count-badge { background: #d32f2f; color: white; border-radius: 10px; padding: 1px 7px; font-size: 10px; margin-left: 4px; }
  .status { padding: 10px 20px; color: #666; font-size: 13px; }
</style>
</head>
<body>
<header><h1>Text Inspection</h1></header>

<div class="upload-bar">
  <div class="upload-slot">
    <label>Master PDF:</label>
    <input type="file" id="masterFile" accept="application/pdf" onchange="uploadFile('master')">
    <span class="upload-status" id="masterStatus"></span>
  </div>
  <div class="upload-slot">
    <label>Sample PDF:</label>
    <input type="file" id="sampleFile" accept="application/pdf" onchange="uploadFile('sample')">
    <span class="upload-status" id="sampleStatus"></span>
  </div>
  <button id="inspectBtn" onclick="runInspection()" disabled>Inspect</button>
</div>

<div class="zoom-bar">
  <span>Zoom:</span>
  <button onclick="adjustZoom(-0.1)">-</button>
  <span id="zoomLevel">Fit</span>
  <button onclick="adjustZoom(0.1)">+</button>
  <button onclick="fitZoom()">Fit to screen</button>
</div>

<div class="previews" id="previewsRow">
  <div class="preview-col" id="col-master" style="flex: 1 1 0;">
    <div class="label">MASTER</div>
    <div class="preview-placeholder">Upload a Master PDF to preview it here</div>
  </div>
  <div class="col-resize-handle" id="colResizeHandle" title="Drag to resize"></div>
  <div class="preview-col" id="col-sample" style="flex: 1 1 0;">
    <div class="label">SAMPLE</div>
    <div class="preview-placeholder">Upload a Sample PDF to preview it here</div>
  </div>
</div>

<div class="results-panel" id="resultsPanel">
  <div class="drag-handle" id="resultsDragHandle" title="Drag to resize"></div>
  <div class="results-header">
    <span id="resultsSummary">Results</span>
    <button onclick="closeResults()">Close</button>
  </div>
  <div class="results-body">
    <div id="findingsList"></div>
  </div>
</div>

<script>
const sessionId = 'sess-' + Math.random().toString(36).slice(2) + Date.now();
let uploaded = {master: false, sample: false};
let currentReport = null;
let zoom = 1.0;

async function uploadFile(side) {
  const input = document.getElementById(side + 'File');
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById(side + 'Status');
  statusEl.textContent = 'Uploading...';
  statusEl.style.color = '#666';

  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('side', side);
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', {method: 'POST', body: formData});
    const data = await res.json();
    if (data.error) {
      statusEl.textContent = 'Error: ' + data.error;
      statusEl.style.color = '#d32f2f';
      return;
    }
    statusEl.textContent = '\u2713 ' + data.filename;
    statusEl.style.color = '#2e7d32';
    uploaded[side] = true;

    const col = document.getElementById('col-' + side);
    col.innerHTML = `
      <div class="label">${side.toUpperCase()}</div>
      <div class="preview-wrap" id="wrap-${side}-0" data-natural-width="${data.width}">
        <img src="${data.image}" />
        <div class="highlight-box" id="box-${side}-0"></div>
      </div>
    `;

    document.getElementById('inspectBtn').disabled = !(uploaded.master && uploaded.sample);
    setTimeout(fitZoom, 100);
  } catch (e) {
    statusEl.textContent = 'Upload failed';
    statusEl.style.color = '#d32f2f';
  }
}

async function runInspection() {
  const btn = document.getElementById('inspectBtn');
  btn.disabled = true;
  btn.textContent = 'Inspecting...';

  try {
    const res = await fetch('/api/inspect', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({session_id: sessionId})
    });
    const data = await res.json();
    if (data.error) { alert('Error: ' + data.error); btn.disabled = false; btn.textContent = 'Inspect'; return; }

    currentReport = data;
    renderPreviews(data);
    renderFindings(data);
    document.getElementById('resultsSummary').textContent =
      `${data.findings.length} finding(s) \u2014 matched ${data.match_stats.matched_pairs} pairs, ` +
      `${data.match_stats.unmatched_master} missing in sample, ${data.match_stats.unmatched_sample} extra in sample`;
    document.getElementById('resultsPanel').classList.add('open');
    setTimeout(fitZoom, 100);
  } catch (e) {
    alert('Request failed: ' + e);
  }
  btn.disabled = false;
  btn.textContent = 'Inspect';
}

function renderPreviews(data) {
  const masterCol = document.getElementById('col-master');
  const sampleCol = document.getElementById('col-sample');
  masterCol.innerHTML = '<div class="label">MASTER</div>';
  sampleCol.innerHTML = '<div class="label">SAMPLE</div>';

  data.pages.forEach(page => {
    if (page.master_image) {
      masterCol.innerHTML += `
        <div class="preview-wrap" id="wrap-master-${page.page}" data-natural-width="${page.master_width}">
          <img src="${page.master_image}" />
          <div class="highlight-box" id="box-master-${page.page}"></div>
        </div>`;
    }
    if (page.sample_image) {
      sampleCol.innerHTML += `
        <div class="preview-wrap" id="wrap-sample-${page.page}" data-natural-width="${page.sample_width}">
          <img src="${page.sample_image}" />
          <div class="highlight-box" id="box-sample-${page.page}"></div>
        </div>`;
    }
  });
}

function renderFindings(data) {
  const list = document.getElementById('findingsList');
  if (data.findings.length === 0) {
    list.innerHTML = '<div class="findings-list-empty">No differences found.</div>';
    return;
  }

  const rows = data.findings.map(f => {
    // Strip a trailing "(grouped)" qualifier for the badge's color class,
    // but keep it visible in the label and flag it with a modifier class.
    const isGrouped = /grouped/i.test(f.type);
    const baseType = f.type.replace(/\\s*\\(.*?\\)\\s*/g, '').trim() || 'Change';
    const badgeClass = `type-badge type-${baseType}${isGrouped ? ' grouped' : ''}`;

    return `
    <tr id="finding-${f.id}" onclick="selectFinding(${f.id})">
      <td>
        <span class="${badgeClass}">${escapeHtml(f.type)}</span>
        ${f.group_count ? `<span class="count-badge">${f.group_count}</span>` : ''}
      </td>
      <td class="val-master">${escapeHtml(f.master || '(none)')}</td>
      <td class="val-sample">${escapeHtml(f.sample || '(none)')}</td>
      <td class="comment-cell">${escapeHtml(f.comment)}</td>
    </tr>`;
  }).join('');

  list.innerHTML = `
    <table class="findings-table">
      <thead>
        <tr><th>Type</th><th>Master</th><th>Sample</th><th>Comment</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function selectFinding(id) {
  document.querySelectorAll('#findingsList tbody tr').forEach(el => el.classList.remove('active'));
  document.getElementById('finding-' + id).classList.add('active');

  const finding = currentReport.findings.find(f => f.id === id);
  if (!finding) return;

  document.querySelectorAll('.highlight-box').forEach(b => b.style.display = 'none');

  // Only draw on the side(s) that actually have a box for this finding —
  // Insertion -> Sample only, Deletion -> Master only, Change/Location -> both.
  ['master', 'sample'].forEach(side => {
    const box = finding[side + '_box'];
    const el = document.getElementById(`box-${side}-${finding.page}`);
    if (box && el) {
      el.style.left = box.x + 'px';
      el.style.top = box.y + 'px';
      el.style.width = Math.max(box.width, 4) + 'px';
      el.style.height = Math.max(box.height, 4) + 'px';
      el.style.display = 'block';
      el.title = `${finding.type}: ${finding.comment}`;
      el.scrollIntoView({behavior: 'smooth', block: 'center', inline: 'center'});
    }
  });
}

function closeResults() {
  document.getElementById('resultsPanel').classList.remove('open');
  document.querySelectorAll('.highlight-box').forEach(b => b.style.display = 'none');
}

function adjustZoom(delta) {
  zoom = Math.max(0.1, Math.min(3, zoom + delta));
  applyZoom();
}

function fitZoom() {
  const wraps = document.querySelectorAll('.preview-wrap');
  if (wraps.length === 0) return;
  const containerWidth = document.getElementById('col-master').clientWidth - 20;
  let minRatio = 1.0;
  wraps.forEach(w => {
    const naturalWidth = parseFloat(w.dataset.naturalWidth);
    if (naturalWidth) {
      const ratio = containerWidth / naturalWidth;
      if (ratio < minRatio) minRatio = ratio;
    }
  });
  zoom = minRatio;
  applyZoom();
}

function applyZoom() {
  document.querySelectorAll('.preview-wrap').forEach(w => {
    w.style.transform = `scale(${zoom})`;
  });
  document.getElementById('zoomLevel').textContent = Math.round(zoom * 100) + '%';
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ---- Resizable results panel (drag the red bar at its top edge) ----
(function setupPanelResize() {
  const panel = document.getElementById('resultsPanel');
  const handle = document.getElementById('resultsDragHandle');
  let dragging = false, startY = 0, startHeight = 0;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startY = e.clientY;
    startHeight = panel.getBoundingClientRect().height;
    panel.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = startY - e.clientY; // dragging up (negative clientY delta) grows the panel
    const minH = 120;
    const maxH = window.innerHeight * 0.85;
    const newHeight = Math.min(maxH, Math.max(minH, startHeight + delta));
    panel.style.height = newHeight + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('dragging');
    document.body.style.userSelect = '';
  });
})();

// ---- Resizable Master/Sample columns (drag the vertical bar between them) ----
(function setupColumnResize() {
  const handle = document.getElementById('colResizeHandle');
  const row = document.getElementById('previewsRow');
  const master = document.getElementById('col-master');
  const sample = document.getElementById('col-sample');
  let dragging = false;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = row.getBoundingClientRect();
    let pct = ((e.clientX - rect.left) / rect.width) * 100;
    pct = Math.min(85, Math.max(15, pct)); // keep both sides usable
    master.style.flex = `0 0 ${pct}%`;
    sample.style.flex = `0 0 ${100 - pct}%`;
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    fitZoom(); // recompute fit-to-screen zoom for the new column widths
  });
})();
</script>
</body>
</html>
"""

# ---------------------------------------------------------------------------
# Audit Trail API — Administrator-only access to audit logs
# ---------------------------------------------------------------------------


@app.route("/api/audit-logs", methods=["GET"])
def api_audit_logs():
    """Retrieve audit logs with pagination and filtering (administrator-only).

    Only users with accountType = "administrator" can access this endpoint.
    Normal users receive 403 Forbidden.

    Query parameters:
        page (int): Page number (1-based, default 1)
        limit (int): Items per page (default 50, max 100)
        startDate (str): Filter by start date (ISO 8601)
        endDate (str): Filter by end date (ISO 8601)
        userId (str): Filter by user ID
        accountType (str): Filter by account type
        event (str): Filter by event type
        module (str): Filter by module
        status (str): Filter by status
        inspectionId (str): Filter by inspection ID
        search (str): Search in description, user email, action
    """
    # Enforce administrator-only access on the backend.
    # _authenticated_user_and_error() resolves accountType from the database
    # and returns 403 for non-administrators. This is the single source of
    # truth for admin authorization — never email-based, never frontend-trusted.
    admin_user, error = _authenticated_user_and_error()
    if error:
        return error

    # Parse query parameters
    page = max(1, request.args.get("page", 1, type=int))
    limit = min(100, max(1, request.args.get("limit", 50, type=int)))
    start_date = request.args.get("startDate", "")
    end_date = request.args.get("endDate", "")
    user_id = request.args.get("userId", "")
    account_type = request.args.get("accountType", "")
    event = request.args.get("event", "")
    module = request.args.get("module", "")
    status = request.args.get("status", "")
    inspection_id = request.args.get("inspectionId", "")
    search = request.args.get("search", "")

    # Build the query dynamically
    conditions = ["c.domain = @domain"]
    parameters = [{"name": "@domain", "value": AUDIT_LOGS_CONTAINER}]

    if start_date:
        conditions.append("c.timestamp >= @startDate")
        parameters.append({"name": "@startDate", "value": start_date})

    if end_date:
        conditions.append("c.timestamp <= @endDate")
        parameters.append({"name": "@endDate", "value": end_date})

    if user_id:
        conditions.append("c.userId = @userId")
        parameters.append({"name": "@userId", "value": user_id})

    if account_type:
        conditions.append("c.accountType = @accountType")
        parameters.append({"name": "@accountType", "value": account_type})

    if event:
        conditions.append("c.event = @event")
        parameters.append({"name": "@event", "value": event})

    if module:
        conditions.append("c.module = @module")
        parameters.append({"name": "@module", "value": module})

    if status:
        conditions.append("c.status = @status")
        parameters.append({"name": "@status", "value": status})

    if inspection_id:
        conditions.append("c.inspectionId = @inspectionId")
        parameters.append({"name": "@inspectionId", "value": inspection_id})

    if search:
        conditions.append(
            "(CONTAINS(LOWER(c.description), LOWER(@search)) OR "
            "CONTAINS(LOWER(c.email), LOWER(@search)) OR "
            "CONTAINS(LOWER(c.action), LOWER(@search)))"
        )
        parameters.append({"name": "@search", "value": search})

    where_clause = " AND ".join(conditions)
    query = {
        "query": f"SELECT * FROM c WHERE {where_clause} ORDER BY c.timestamp DESC",
        "parameters": parameters,
    }

    try:
        all_records = cosmos_query_documents(AUDIT_LOGS_CONTAINER, query) or []
        total = len(all_records)

        # Apply pagination
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        paginated_records = all_records[start_idx:end_idx]

        return jsonify({
            "items": paginated_records,
            "page": page,
            "limit": limit,
            "total": total,
        }), 200
    except Exception as exc:
        logger.error("[AUDIT] Failed to retrieve audit logs: %s", exc)
        return jsonify({"error": "Failed to retrieve audit logs."}), 500


@app.route("/api/audit-logs/<log_id>", methods=["GET"])
def api_audit_log_by_id(log_id: str):
    """Retrieve a single audit log by ID (administrator-only).

    Only users with accountType = "administrator" can access this endpoint.
    """
    # Enforce administrator-only access on the backend
    admin_user, error = _authenticated_user_and_error()
    if error:
        return error

    try:
        records = cosmos_query_documents(
            AUDIT_LOGS_CONTAINER,
            {
                "query": "SELECT * FROM c WHERE c.id = @id AND c.domain = @domain",
                "parameters": [
                    {"name": "@id", "value": log_id},
                    {"name": "@domain", "value": AUDIT_LOGS_CONTAINER},
                ],
            },
        )
        if not records:
            return jsonify({"error": "Audit log not found."}), 404

        return jsonify(records[0]), 200
    except Exception as exc:
        logger.error("[AUDIT] Failed to retrieve audit log %s: %s", log_id, exc)
        return jsonify({"error": "Failed to retrieve audit log."}), 500


# ----------------------------------------------------------------------------
# Frontend-initiated activity audit (reviewing / reporting actions)
# ----------------------------------------------------------------------------
# Several auditable actions are performed entirely in the browser (e.g. the
# PDF report is generated client-side; a review level/comment is picked in a
# dropdown; the Difference List window is opened). Those actions never hit a
# business endpoint, so they could not be audited. This endpoint lets the
# frontend record those activities while keeping the audit model secure:
# the authenticated identity (user id / email / accountType) is ALWAYS
# resolved from the backend request context — never from the client payload.
# The event name itself is validated against an allowlist of known events so
# the audit trail stays consistent and tamper-resistant.

# Events the frontend is permitted to record through POST /api/audit/events.
_AUDIT_CLIENT_ALLOWED_EVENTS = {
    DIFFERENCE_VIEWED,
    DIFFERENCE_LEVEL_CHANGED,
    DIFFERENCE_COMMENT_ADDED,
    DIFFERENCE_COMMENT_UPDATED,
    DIFFERENCE_STATUS_CHANGED,
    REPORT_DOWNLOADED,
}


@app.route("/api/audit/events", methods=["POST"])
def api_audit_client_event():
    """Record a frontend-initiated activity event (authenticated user).

    Request body (JSON):
        event (str): one of the allowlisted event names above.
        action (str): Human-readable action verb (e.g. "Select Level").
        module (str): Module name (e.g. "Text Inspection", "Report").
        description (str, optional): Human-readable description.
        inspectionId (str, optional): Related inspection id, if applicable.
        differenceId (int, optional): Related difference id, if applicable.
        metadata (dict, optional): Extra structured context (e.g. the selected
                                   level/comment value).

    Identity is always derived from the backend request context, never from
    the client payload. Returns 401/403 for unauthenticated users.
    """
    caller, error = _authenticated_identity()
    if error:
        return error

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "JSON object body required."}), 400

    event = str(payload.get("event") or "").strip()
    if event not in _AUDIT_CLIENT_ALLOWED_EVENTS:
        return jsonify({"error": f"Event '{event}' is not auditable from the client."}), 400

    action = str(payload.get("action") or "").strip() or "Action"
    module = str(payload.get("module") or "").strip() or MODULE_TEXT_INSPECTION
    description = str(payload.get("description") or "").strip() or None
    inspection_id = str(payload.get("inspectionId") or "").strip() or None
    difference_id = payload.get("differenceId")

    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        metadata = None
    if difference_id is not None:
        metadata = dict(metadata or {})
        metadata.setdefault("differenceId", difference_id)

    try:
        record = log_from_authenticated_user(
            event=event,
            action=action,
            application=APPLICATION_MEDINSPECT,
            module=module,
            authenticated_user=caller,
            status=STATUS_SUCCESS,
            description=description,
            entity_type="Inspection" if inspection_id else None,
            entity_id=inspection_id,
            inspection_id=inspection_id,
            metadata=metadata,
        )
    except Exception as exc:
        logger.error("[AUDIT] Failed to record client event %s: %s", event, exc)
        return jsonify({"error": "Failed to record audit event."}), 500

    if record is None:
        return jsonify({"error": "Failed to record audit event."}), 500

    return jsonify({"success": True, "event": event}), 200




# ============================================================================
# CROP COMPARE FEATURE (merged from crop_web_app.py - that standalone app
# has been retired; everything it added now lives here in web_app.py).
# ============================================================================
# Crop Compare lets a user drag a rectangle on the MASTER preview and run
# run_crop_text_inspection() scoped to just that region + page, for speed.
# Additive only: existing routes/HTML/JS in this file are untouched, the
# crop UI is injected after the original INDEX_HTML via PATCHED_INDEX_HTML
# (served by index() below).

# Every crop query's findings get written here as a CSV, one file per
# query, so you can cross-check results after the fact without re-running
# anything. Kept alongside the existing per-session output folder
# (webapp_outputs/<session_id>/...), matching where build_report() already
# writes rendered page PNGs — same session, same place to look.
CROP_LOG_SUBDIR = "crop_logs"
 
 
def _log_crop_findings(session_id: str, page: int, box: dict, result: dict) -> str:
    """Writes this crop query's findings + the exact region searched to a
    timestamped CSV under webapp_outputs/<session_id>/crop_logs/. Returns
    the path written, or None if there was nothing to log."""
    log_dir = os.path.join(OUTPUT_ROOT, session_id, CROP_LOG_SUBDIR)
    os.makedirs(log_dir, exist_ok=True)
 
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S_%f")
    log_path = os.path.join(log_dir, f"crop_{timestamp}.csv")
 
    findings = result.get("findings", [])
    rows = []
    for f in findings:
        rows.append({
            "id": f["id"], "type": f["type"], "master": f["master"], "sample": f["sample"],
            "comment": f["comment"], "page": f["page"], "source": f.get("source", "pymupdf"),
            "master_box": f.get("master_box"), "sample_box": f.get("sample_box"),
            "query_page": page, "query_box_x": box["x"], "query_box_y": box["y"],
            "query_box_width": box["width"], "query_box_height": box["height"],
        })
 
    df = pd.DataFrame(rows) if rows else pd.DataFrame(
        columns=["id", "type", "master", "sample", "comment", "page", "source",
                 "master_box", "sample_box", "query_page", "query_box_x", "query_box_y",
                 "query_box_width", "query_box_height"]
    )
    df.to_csv(log_path, index=False)
 
    logger.info(
        f"Crop query logged: session={session_id}, page={page}, box={box}, "
        f"{len(findings)} finding(s) -> {log_path}"
    )
    return log_path
 
# ---------------------------------------------------------------------
# New endpoint — additive only, no existing route touched.
# ---------------------------------------------------------------------
 
 
def _resolve_crop_files(session_id: str, inspection_id: str, caller):
    """Returns ((master_path, sample_path), None) for a crop run, downloading
    from Blob Storage when the local engine copy is missing. Returns
    (None, error_message) on failure."""
    local_id = session_id or inspection_id
    session_dir = os.path.join(UPLOAD_ROOT, local_id)
    master_path = os.path.join(session_dir, "master.pdf")
    sample_path = os.path.join(session_dir, "sample.pdf")

    if os.path.exists(master_path) and os.path.exists(sample_path):
        return (master_path, sample_path), None

    # Local copies missing - fall back to Blob Storage, but ONLY for a
    # real persisted inspection whose owner matches the caller.
    if not inspection_id:
        return None, "Both Master and Sample must be uploaded first"

    if caller is None:
        return None, "Authentication required."

    try:
        record = _get_inspection_record(inspection_id)
    except Exception as exc:
        logger.error("[CROP] inspection lookup failed for %s: %s", inspection_id, exc)
        return None, "Failed to load the inspection."

    if not record or record.get("deleted"):
        return None, "Inspection not found."
    if record.get("userId") != caller.get("id", ""):
        return None, "You do not have access to this inspection."

    os.makedirs(session_dir, exist_ok=True)
    try:
        for side_key, side, container in (
            ("masterFile", "master", MASTER_FILES_CONTAINER),
            ("sampleFile", "sample", SAMPLE_FILES_CONTAINER),
        ):
            target = os.path.join(session_dir, f"{side}.pdf")
            if os.path.exists(target):
                continue
            blob_path = (record.get(side_key) or {}).get("blobPath")
            if not blob_path:
                return None, f"{side.capitalize()} file is not available."
            with open(target, "wb") as fh:
                fh.write(download_blob(container, blob_path))
    except Exception as exc:
        logger.error("[CROP] blob download failed for %s: %s", inspection_id, exc)
        return None, "Files are not available for this inspection."

    return (master_path, sample_path), None


@app.route("/api/crop_inspect", methods=["POST"])
def api_crop_inspect():
    """Runs the crop-scoped Text Inspection.

    PATCHED: accepts either session_id (fresh-run engine session) or
    inspection_id (persisted inspection). For a persisted inspection whose
    local engine copy is missing, the master/sample files are owner-verified
    and downloaded from Blob Storage into webapp_uploads/<inspection_id>/
    first, so Crop Compare works identically for fresh runs and reopened
    stored inspections. Every crop run (fresh OR on a previously executed
    inspection) is written to the audit trail via CROP_INSPECTION_COMPLETED /
    CROP_INSPECTION_FAILED.
    """
    data = request.get_json()
    session_id = data.get("session_id")
    inspection_id = data.get("inspection_id")
    page = data.get("page", 0)
    box = data.get("box")

    # Authenticated identity — used for both persistence resolution and
    # audit trail attribution. Best-effort: a crop run on an already-local
    # session can still complete without a caller (audit is then skipped).
    caller, _auth_error = _authenticated_identity()

    if not session_id and not inspection_id:
        return jsonify({"error": "session_id or inspection_id required"}), 400
    if not box:
        return jsonify({"error": "box required"}), 400

    files, error = _resolve_crop_files(session_id, inspection_id, caller)
    if error:
        if caller:
            log_from_authenticated_user(
                event=CROP_INSPECTION_FAILED,
                action="Crop Inspection Failed",
                application=APPLICATION_MEDINSPECT,
                module=MODULE_TEXT_INSPECTION,
                authenticated_user=caller,
                status=STATUS_FAILED,
                description=f"Crop-scoped inspection could not be run: {error}",
                entity_type="Inspection",
                entity_id=session_id or inspection_id,
                inspection_id=inspection_id or session_id,
                session_id=session_id,
                metadata={
                    "page": page,
                    "pageDisplay": page + 1,
                    "box": box,
                    "error": error,
                },
            )
        return jsonify({"error": error}), 400 if error.startswith("Both") else 403

    master_path, sample_path = files
    run_session_id = session_id or inspection_id

    try:
        result = run_crop_text_inspection(master_path, sample_path, page, box)
    except Exception as e:
        if caller:
            log_from_authenticated_user(
                event=CROP_INSPECTION_FAILED,
                action="Crop Inspection Failed",
                application=APPLICATION_MEDINSPECT,
                module=MODULE_TEXT_INSPECTION,
                authenticated_user=caller,
                status=STATUS_FAILED,
                description=f"Crop-scoped inspection failed: {str(e)}",
                entity_type="Inspection",
                entity_id=run_session_id,
                inspection_id=inspection_id or run_session_id,
                session_id=session_id,
                metadata={
                    "page": page,
                    "pageDisplay": page + 1,
                    "box": box,
                    "error": str(e),
                },
            )
        return jsonify({"error": f"Crop inspection failed: {str(e)}"}), 500

    log_path = _log_crop_findings(run_session_id, page, box, result)
    result["log_file"] = os.path.relpath(log_path, OUTPUT_ROOT) if log_path else None

    # Audit: record every crop inspection run — including those fired on a
    # previously executed (stored) inspection_id — so the audit trail always
    # shows the crop activity.
    if caller:
        log_from_authenticated_user(
            event=CROP_INSPECTION_COMPLETED,
            action="Crop Inspection Completed",
            application=APPLICATION_MEDINSPECT,
            module=MODULE_TEXT_INSPECTION,
            authenticated_user=caller,
            status=STATUS_SUCCESS,
            description=(
                f"Crop-scoped inspection completed on page {page + 1}. "
                f"{len(result.get('findings', []))} finding(s) in region."
            ),
            entity_type="Inspection",
            entity_id=run_session_id,
            inspection_id=inspection_id or run_session_id,
            session_id=session_id,
            metadata={
                "page": page,
                "pageDisplay": page + 1,
                "box": box,
                "findingsCount": len(result.get("findings", [])),
                "matchedPairs": result.get("match_stats", {}).get("matched_pairs"),
                "unmatchedMaster": result.get("match_stats", {}).get("unmatched_master"),
                "unmatchedSample": result.get("match_stats", {}).get("unmatched_sample"),
                "logFile": result.get("log_file"),
                "ranOnPreviouslyExecutedInspection": bool(inspection_id),
            },
        )

    return jsonify(result)
 
 
@app.route("/api/crop_logs/<session_id>")
def api_list_crop_logs(session_id):
    """Lists every crop query CSV logged so far for this session, most
    recent first — lets you see the full history of crop queries run
    during testing, not just the latest one."""
    log_dir = os.path.join(OUTPUT_ROOT, session_id, CROP_LOG_SUBDIR)
    if not os.path.isdir(log_dir):
        return jsonify({"logs": []})
    files = sorted(os.listdir(log_dir), reverse=True)
    return jsonify({"logs": files})
 
 
# ---------------------------------------------------------------------
# Inject the Crop Compare UI into the existing page by wrapping the
# original index route's HTML — web_app.py's own "/" route and HTML
# string are never edited, just extended here.
# ---------------------------------------------------------------------
 
CROP_UI_HTML = """
<style>
  #cropBtn { padding: 8px 20px; background: #6a1b9a; color: white; border: none; border-radius: 4px;
             cursor: pointer; font-size: 14px; margin-left: 10px; }
  #cropBtn.active { background: #4a148c; box-shadow: inset 0 0 0 2px #ce93d8; }
  #cropBtn:disabled { background: #ccc; cursor: not-allowed; }
  #cropHint { font-size: 12px; color: #6a1b9a; margin-left: 10px; display: none; }
  #cropHint.show { display: inline; }
 
  .crop-selection-box { position: absolute; border: 2px dashed #6a1b9a; background: rgba(106,27,154,0.12);
                         pointer-events: none; display: none; z-index: 20; }
 
  .crop-results-panel { position: fixed; bottom: 0; left: 0; right: 0; background: white;
                         max-height: 60vh; height: 32vh; display: flex; flex-direction: column;
                         transform: translateY(100%); transition: transform 0.2s ease;
                         box-shadow: 0 -4px 12px rgba(0,0,0,0.25); border-top: 3px solid #6a1b9a; }
  .crop-results-panel.open { transform: translateY(0); }
  .crop-results-header { padding: 10px 16px; background: #4a148c; color: white; font-size: 13px;
                          display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
  .crop-results-header button { background: transparent; border: 1px solid #ce93d8; color: white;
                                 border-radius: 4px; cursor: pointer; padding: 2px 10px; }
  .crop-results-body { overflow-y: auto; flex: 1; }
  .crop-findings-empty { padding: 14px 20px; color: #666; font-size: 13px; }
 
  table.crop-findings-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.crop-findings-table thead th { position: sticky; top: 0; background: #4a148c; color: white;
                                        text-align: left; padding: 8px 10px; font-size: 11px;
                                        text-transform: uppercase; letter-spacing: 0.3px; }
  table.crop-findings-table tbody tr { border-bottom: 1px solid #eee; }
  table.crop-findings-table tbody tr:nth-child(even) { background: #faf5fc; }
  table.crop-findings-table td { padding: 7px 10px; vertical-align: top; }
  .crop-val-master { color: #b71c1c; text-decoration: line-through; text-decoration-color: rgba(183,20,20,0.5); }
  .crop-val-sample { color: #2e7d32; font-weight: 600; }
  .crop-comment-cell { color: #666; font-style: italic; max-width: 300px; }
  .crop-type-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px;
                      font-weight: 700; text-transform: uppercase; color: white; background: #6a1b9a; }
</style>
 
<div class="crop-results-panel" id="cropResultsPanel">
  <div class="crop-results-header">
    <span id="cropResultsSummary">Crop Results</span>
    <button onclick="closeCropResults()">Close</button>
  </div>
  <div class="crop-results-body">
    <div id="cropFindingsList"></div>
  </div>
</div>
 
<script>
(function setupCropFeature() {
  // Wait for the page's existing elements (from web_app.py's own HTML) to exist.
  const inspectBtn = document.getElementById('inspectBtn');
  const cropBtn = document.createElement('button');
  cropBtn.id = 'cropBtn';
  cropBtn.textContent = 'Crop Compare';
  cropBtn.disabled = true;
  inspectBtn.insertAdjacentElement('afterend', cropBtn);
 
  const hint = document.createElement('span');
  hint.id = 'cropHint';
  hint.textContent = 'Drag a rectangle on the MASTER preview \u2192';
  cropBtn.insertAdjacentElement('afterend', hint);
 
  // Mirror the disabled/enabled state of the real Inspect button by
  // polling — avoids touching uploadFile() in web_app.py.
  setInterval(() => {
    cropBtn.disabled = inspectBtn.disabled && !currentReport;
  }, 300);
 
  let cropModeActive = false;
  let dragging = false;
  let dragStartPxNatural = null;
  let currentWrapEl = null;
  let currentPage = 0;
 
  cropBtn.addEventListener('click', () => {
    cropModeActive = !cropModeActive;
    cropBtn.classList.toggle('active', cropModeActive);
    hint.classList.toggle('show', cropModeActive);
  });
 
  function findWrapAndPage(target) {
    const wrap = target.closest('.preview-wrap');
    if (!wrap || !wrap.id.startsWith('wrap-master-')) return null;
    const page = parseInt(wrap.id.replace('wrap-master-', ''), 10);
    return { wrap, page };
  }
 
  function ensureSelectionBox(wrap) {
    let box = wrap.querySelector('.crop-selection-box');
    if (!box) {
      box = document.createElement('div');
      box.className = 'crop-selection-box';
      wrap.appendChild(box);
    }
    return box;
  }
 
  document.getElementById('col-master').addEventListener('mousedown', (e) => {
    if (!cropModeActive) return;
    const found = findWrapAndPage(e.target);
    if (!found) return;
    dragging = true;
    currentWrapEl = found.wrap;
    currentPage = found.page;
 
    const rect = found.wrap.getBoundingClientRect();
    // Natural (unzoomed) pixel space = same DPI=150 space the app already
    // uses for master_box/sample_box.
    dragStartPxNatural = {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    };
 
    // IMPORTANT: .preview-wrap already has a CSS "transform: scale(zoom)"
    // applied to it (see applyZoom() in web_app.py's own JS). Since the
    // selection box is appended AS A CHILD of that wrap, it is already
    // inside the scaled coordinate system — the browser scales it for us.
    // We must therefore position it using NATURAL (unscaled) pixel values
    // here, NOT multiplied by zoom again, or it renders at the wrong
    // place/size (this was the bug: double-scaling pushed it off to a
    // fixed corner).
    const box = ensureSelectionBox(found.wrap);
    box.style.left = dragStartPxNatural.x + 'px';
    box.style.top = dragStartPxNatural.y + 'px';
    box.style.width = '0px';
    box.style.height = '0px';
    box.style.display = 'block';
    e.preventDefault();
  });
 
  window.addEventListener('mousemove', (e) => {
    if (!dragging || !currentWrapEl) return;
    const rect = currentWrapEl.getBoundingClientRect();
    const curX = (e.clientX - rect.left) / zoom;
    const curY = (e.clientY - rect.top) / zoom;
 
    const x0 = Math.min(dragStartPxNatural.x, curX);
    const y0 = Math.min(dragStartPxNatural.y, curY);
    const w = Math.abs(curX - dragStartPxNatural.x);
    const h = Math.abs(curY - dragStartPxNatural.y);
 
    // Same fix as above — natural pixel values only, parent transform
    // handles the zoom scaling automatically.
    const box = ensureSelectionBox(currentWrapEl);
    box.style.left = x0 + 'px';
    box.style.top = y0 + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';
 
    box.dataset.x = x0;
    box.dataset.y = y0;
    box.dataset.w = w;
    box.dataset.h = h;
  });
 
  window.addEventListener('mouseup', async () => {
    if (!dragging) return;
    dragging = false;
    if (!currentWrapEl) return;
 
    const box = currentWrapEl.querySelector('.crop-selection-box');
    if (!box) return;
    const w = parseFloat(box.dataset.w || 0);
    const h = parseFloat(box.dataset.h || 0);
    if (w < 5 || h < 5) {
      box.style.display = 'none';
      return; // too small — treat as an accidental click, not a real crop
    }
 
    const cropBoxPx = {
      x: parseFloat(box.dataset.x),
      y: parseFloat(box.dataset.y),
      width: w,
      height: h,
    };
 
    await runCropInspect(currentPage, cropBoxPx);
  });
 
  async function runCropInspect(page, box) {
    document.getElementById('cropResultsSummary').textContent = 'Running crop inspection...';
    document.getElementById('cropResultsPanel').classList.add('open');
    document.getElementById('cropFindingsList').innerHTML = '<div class="crop-findings-empty">Working...</div>';
 
    try {
      const res = await fetch('/api/crop_inspect', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({session_id: sessionId, page: page, box: box}),
      });
      const data = await res.json();
      if (data.error) {
        document.getElementById('cropResultsSummary').textContent = 'Error';
        document.getElementById('cropFindingsList').innerHTML =
          `<div class="crop-findings-empty">${escapeHtml(data.error)}</div>`;
        return;
      }
      renderCropFindings(data);
    } catch (e) {
      document.getElementById('cropResultsSummary').textContent = 'Request failed';
      document.getElementById('cropFindingsList').innerHTML =
        `<div class="crop-findings-empty">${escapeHtml(String(e))}</div>`;
    }
  }
 
  function renderCropFindings(data) {
    const stats = data.match_stats || {};
    document.getElementById('cropResultsSummary').textContent =
      `Crop: ${data.findings.length} finding(s) in region \u2014 matched ${stats.matched_pairs || 0} pairs, ` +
      `${stats.unmatched_master || 0} missing in sample, ${stats.unmatched_sample || 0} extra in sample` +
      (data.log_file ? `  |  logged: ${data.log_file}` : '');
 
    const list = document.getElementById('cropFindingsList');
    if (!data.findings.length) {
      list.innerHTML = '<div class="crop-findings-empty">No differences found in the cropped region.' +
        (data.log_file ? ` (still logged to ${escapeHtml(data.log_file)})` : '') + '</div>';
      return;
    }
 
    const rows = data.findings.map(f => `
      <tr>
        <td><span class="crop-type-badge">${escapeHtml(f.type)}</span></td>
        <td class="crop-val-master">${escapeHtml(f.master || '(none)')}</td>
        <td class="crop-val-sample">${escapeHtml(f.sample || '(none)')}</td>
        <td class="crop-comment-cell">${escapeHtml(f.comment)}</td>
      </tr>`).join('');
 
    list.innerHTML = `
      <table class="crop-findings-table">
        <thead><tr><th>Type</th><th>Master</th><th>Sample</th><th>Comment</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
 
  window.closeCropResults = function () {
    document.getElementById('cropResultsPanel').classList.remove('open');
  };
})();
</script>
"""
 
# Append the crop UI right before </body> in the existing INDEX_HTML,
# without modifying web_app.py's own INDEX_HTML string.
PATCHED_INDEX_HTML = INDEX_HTML.replace("</body>", CROP_UI_HTML + "\n</body>")


if __name__ == "__main__":
    app.run(debug=True, port=5000)
