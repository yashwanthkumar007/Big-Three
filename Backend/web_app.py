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
import uuid
from datetime import datetime, timezone
from flask import Flask, request, jsonify, send_from_directory, render_template_string

sys.path.append(os.path.dirname(__file__))
from src.inspection_registry import get_inspection_config
from src.pipelines.report_builder import build_report, render_page
from src.email_service import send_inspection_report_email
from src.azure_service import (
    cosmos_delete_document,
    cosmos_get_document,
    cosmos_query_documents,
    cosmos_upsert_document,
    download_blob,
    get_backend_infrastructure_status,
    upload_blob,
)
from src.logger import logger
from src.resource_schema import normalize_resource_payload, validate_resource_payload

app = Flask(__name__)

# Default users to seed into Cosmos DB on startup
DEFAULT_USERS = [
    {
        "id": "user_admin_001",
        "username": "Admin",
        "email": "admin@viatris.com",
        "firstName": "Admin",
        "lastName": "User",
        "accountType": "Administrator",
        "accountStatus": "Active",
        "company": "Viatris",
        "domain": "users",
        "password": "Admin@123",
        "emailNotificationEnabled": True,
    },
    {
        "id": "user_regular_001",
        "username": "User",
        "email": "user@viatris.com",
        "firstName": "Regular",
        "lastName": "User",
        "accountType": "User",
        "accountStatus": "Active",
        "company": "Viatris",
        "domain": "users",
        "password": "User@123",
        "emailNotificationEnabled": True,
    },
]


def seed_default_users():
    """Seed default users into Cosmos DB if they don't already exist."""
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for user in DEFAULT_USERS:
        try:
            # Check if user already exists by email
            existing = cosmos_query_documents(
                "users",
                {
                    "query": "SELECT * FROM c WHERE LOWER(c.email) = LOWER(@email)",
                    "parameters": [{"name": "@email", "value": user["email"]}],
                },
            )
            if existing:
                logger.info(f"User {user['email']} already exists, skipping.")
                continue
            # Create the user
            payload = {**user, "createdAt": timestamp, "lastLogin": None}
            cosmos_upsert_document("users", payload)
            logger.info(f"Seeded user: {user['email']}")
        except Exception as exc:
            logger.warning(f"Failed to seed user {user['email']}: {exc}")

UPLOAD_ROOT = os.path.join("webapp_uploads")
OUTPUT_ROOT = os.path.join("webapp_outputs")
os.makedirs(UPLOAD_ROOT, exist_ok=True)
os.makedirs(OUTPUT_ROOT, exist_ok=True)


@app.route("/")
def index():
    return render_template_string(INDEX_HTML)


@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify({
        "status": "ok",
        "service": "medinspect-backend",
        "azure": get_backend_infrastructure_status(),
    })


@app.route("/api/seed", methods=["POST"])
def api_seed_users():
    """Manually trigger seeding of default users into Cosmos DB."""
    try:
        seed_default_users()
        # Verify users were created
        users = cosmos_query_documents("users")
        return jsonify({
            "status": "ok",
            "message": "Seed completed successfully",
            "userCount": len(users),
            "users": [{"email": u.get("email"), "username": u.get("username")} for u in users],
        }), 200
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


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

    try:
        result = cosmos_upsert_document(resource, validated)
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


def _purge_stale_sessions(sessions: list) -> list:
    """Delete and drop sessions whose last activity exceeded the inactivity
    limit (i.e. past logins, not current users)."""
    now_ts = time.time()
    fresh: list = []
    for session in sessions:
        last_activity = _parse_timestamp(session.get("lastActivity") or session.get("loginTime"))
        if last_activity and (now_ts - last_activity) > SESSION_INACTIVITY_LIMIT_SECONDS:
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
                _delete_session_record(existing.get("sessionId", ""))
                fresh[fresh.index(existing)] = session
                newest_by_email[email_key] = session
            else:
                _delete_session_record(session.get("sessionId", ""))
    return fresh


def _purge_superseded_sessions(email: str) -> None:
    """Delete ALL existing sessions belonging to a user (case-insensitive
    email match) so each user has exactly ONE active session: whenever they
    log in again, the previous session record is removed from the database."""
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
            return jsonify({"error": "Invalid email or password."}), 401

        user = users[0]
        # Validate password against the stored password field
        if user.get("password") != password:
            return jsonify({"error": "Invalid email or password."}), 401

        # Update lastLogin timestamp in Cosmos DB
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        try:
            cosmos_upsert_document("users", {**user, "lastLogin": timestamp})
        except Exception:
            pass  # Non-critical: login succeeds even if lastLogin update fails

        # ------------------------------------------------------------------
        # Server-side session registry: record THIS login as an active session.
        # The session id is generated and stored SERVER-SIDE so the Logged-in
        # Users page reflects every logged-in user across all browsers/machines,
        # with IP/browser/OS captured from the actual login request.
        # Authorization fields (accountType) come from the DB user document,
        # never from the request payload.
        # ------------------------------------------------------------------
        # ------------------------------------------------------------------
        # ONE ACTIVE SESSION PER USER: delete any previous session record
        # for this user from the database before recording the new login,
        # so past logins never appear on the Logged-in Users page.
        # ------------------------------------------------------------------
        _purge_superseded_sessions(user.get("email", ""))

        session_id = "sess_{}".format(uuid.uuid4().hex)
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
        return jsonify(user_data), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    """Delete the CURRENT session from the database on logout.

    The session to delete is identified by the server-issued sessionId in
    the X-Session-Id header — never by the email address. After this call
    the session no longer appears on the Logged-in Users page.
    """
    session_id = request.headers.get("X-Session-Id", "").strip()
    if not session_id:
        return jsonify({"loggedOut": False, "error": "Missing X-Session-Id header."}), 400
    existing = _find_session_by_id(session_id)
    if not existing:
        return jsonify({"loggedOut": True, "sessionId": session_id, "note": "Session not found; nothing to delete."}), 200
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
        user["password"] = new_password

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
            result = cosmos_delete_document(resource, resource_id)
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

    try:
        result = cosmos_upsert_document(resource, validated)
        return jsonify(result), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


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
        preview_dir = os.path.join(OUTPUT_ROOT, session_id)
        os.makedirs(preview_dir, exist_ok=True)
        preview_path = os.path.join(preview_dir, f"{side}_preview_p0.png")
        w, h = render_page(pdf_path, 0, preview_path)
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

    try:
        config = get_inspection_config(inspection_type)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    session_dir = os.path.join(UPLOAD_ROOT, session_id)
    master_path = os.path.join(session_dir, "master.pdf")
    sample_path = os.path.join(session_dir, "sample.pdf")

    if not os.path.exists(master_path) or not os.path.exists(sample_path):
        return jsonify({"error": "Both Master and Sample must be uploaded first"}), 400

    try:
        result = config.pipeline(master_path, sample_path, filters=filters)
    except Exception as e:
        return jsonify({"error": f"{config.label} failed: {str(e)}"}), 500

    output_dir = os.path.join(OUTPUT_ROOT, session_id)

    try:
        report = build_report(master_path, sample_path, result, output_dir)
    except Exception as e:
        return jsonify({"error": f"Report rendering failed: {str(e)}"}), 500

    for page in report["pages"]:
        if "master_image" in page:
            page["master_image"] = f"/images/{session_id}/{os.path.basename(page['master_image'])}"
        if "sample_image" in page:
            page["sample_image"] = f"/images/{session_id}/{os.path.basename(page['sample_image'])}"

    report["match_stats"] = result["match_stats"]
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

if __name__ == "__main__":
    seed_default_users()
    app.run(debug=True, port=5000)
