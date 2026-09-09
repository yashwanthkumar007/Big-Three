"""
Central Audit Service for MedInspect.

This service provides a single point for creating audit log records.
It ensures that all audit records are created with consistent structure
and that authenticated identity is always derived from the backend context,
never from frontend-supplied values.

Architecture:
    Business Operation
          ↓
    auditService.log(...)
          ↓
    AuditLogs Cosmos DB container
"""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from flask import request

from src.azure_service import cosmos_upsert_document
from src.logger import logger

# AuditLogs container name in Cosmos DB
AUDIT_LOGS_CONTAINER = "audit-logs"


def _get_client_ip() -> Optional[str]:
    """
    Capture the client IP address from the request.

    If the backend is behind a proxy/load balancer, the real client IP
    may be in the X-Forwarded-For header. Falls back to remote_addr.
    Returns None if the IP cannot be determined reliably.
    """
    try:
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()

        real_ip = request.headers.get("X-Real-Ip")
        if real_ip:
            return real_ip.strip()

        if request.remote_addr:
            return request.remote_addr
    except Exception:
        pass
    return None


def _get_user_agent() -> Optional[str]:
    """Capture the User-Agent header from the request."""
    try:
        return request.headers.get("User-Agent")
    except Exception:
        return None


def log(
    *,
    event: str,
    action: str,
    application: str,
    module: str,
    user_id: str,
    email: str,
    account_type: str,
    status: str = "Success",
    description: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    inspection_id: Optional[str] = None,
    file_id: Optional[str] = None,
    file_name: Optional[str] = None,
    master_file_name: Optional[str] = None,
    sample_file_name: Optional[str] = None,
    session_id: Optional[str] = None,
    changes: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Create an audit log record in Cosmos DB.

    This is the single point for creating audit records. It derives
    request metadata (IP, User-Agent) from the backend context and
    constructs a complete audit record.

    Args:
        event: The audit event type (e.g., LOGIN_SUCCESS, FILE_UPLOADED)
        action: The specific action performed (e.g., "Login", "File Upload")
        application: The application name (e.g., "MedInspect")
        module: The module where the action occurred (e.g., "Authentication")
        user_id: The authenticated user's ID (from backend context)
        email: The authenticated user's email (from backend context)
        account_type: The authenticated user's accountType (from backend context)
        status: The outcome status (Success, Failed, Warning)
        description: Human-readable description of the action
        entity_type: The type of entity affected (e.g., "Inspection", "User")
        entity_id: The ID of the entity affected
        inspection_id: The inspection ID if applicable
        file_id: The file ID if applicable
        file_name: The file name if applicable
        master_file_name: The master file name if applicable
        sample_file_name: The sample file name if applicable
        session_id: The session ID if applicable
        changes: Before/after changes for update operations
        metadata: Additional structured metadata

    Returns:
        The created audit record, or None if creation failed
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    record = {
        "id": str(uuid.uuid4()),
        "userId": user_id,
        "email": email,
        "accountType": account_type,
        "timestamp": timestamp,
        "event": event,
        "action": action,
        "application": application,
        "module": module,
        "status": status,
        "domain": AUDIT_LOGS_CONTAINER,  # partition key
    }

    # Add optional fields only when they have values
    if description:
        record["description"] = description
    if entity_type:
        record["entityType"] = entity_type
    if entity_id:
        record["entityId"] = entity_id
    if inspection_id:
        record["inspectionId"] = inspection_id
    if file_id:
        record["fileId"] = file_id
    if file_name:
        record["fileName"] = file_name
    if master_file_name:
        record["masterFileName"] = master_file_name
    if sample_file_name:
        record["sampleFileName"] = sample_file_name
    if session_id:
        record["sessionId"] = session_id
    if changes:
        record["changes"] = changes
    if metadata:
        record["metadata"] = metadata

    # Capture request metadata from backend context
    ip_address = _get_client_ip()
    if ip_address:
        record["ipAddress"] = ip_address

    user_agent = _get_user_agent()
    if user_agent:
        record["userAgent"] = user_agent

    try:
        cosmos_upsert_document(AUDIT_LOGS_CONTAINER, record)
        logger.info("[AUDIT] %s - %s by %s (%s)", event, action, email, account_type)
        return record
    except Exception as exc:
        logger.error("[AUDIT] Failed to create audit record for %s: %s", event, exc)
        return None


def log_from_authenticated_user(
    *,
    event: str,
    action: str,
    application: str,
    module: str,
    authenticated_user: dict,
    status: str = "Success",
    description: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    inspection_id: Optional[str] = None,
    file_id: Optional[str] = None,
    file_name: Optional[str] = None,
    master_file_name: Optional[str] = None,
    sample_file_name: Optional[str] = None,
    session_id: Optional[str] = None,
    changes: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Convenience wrapper for log() that extracts identity from an authenticated user dict.

    This is the preferred way to create audit records when you already have
    the authenticated user object from _authenticated_identity().

    Args:
        authenticated_user: The user dict from the backend authentication context
                           (must contain 'id', 'email', 'accountType')
        Other args: Same as log()

    Returns:
        The created audit record, or None if creation failed
    """
    return log(
        event=event,
        action=action,
        application=application,
        module=module,
        user_id=str(authenticated_user.get("id", "")),
        email=str(authenticated_user.get("email", "")),
        account_type=str(authenticated_user.get("accountType", "User")),
        status=status,
        description=description,
        entity_type=entity_type,
        entity_id=entity_id,
        inspection_id=inspection_id,
        file_id=file_id,
        file_name=file_name,
        master_file_name=master_file_name,
        sample_file_name=sample_file_name,
        session_id=session_id,
        changes=changes,
        metadata=metadata,
    )
