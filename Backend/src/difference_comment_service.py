"""User comment persistence for individual inspection differences.

User-entered comments (e.g. replacing a \"Comment1\" placeholder) belong to a
specific inspection/difference and are persisted in Cosmos DB. They NEVER
modify the global Setup Levels and Comments configuration.

Container "difference-comments" holds one document per (inspection, difference):

    {
        "id": "<inspectionId>__<differenceId>",
        "inspectionId": "...",
        "differenceId": <int>,
        "configuredComment": "Comment1",
        "userComment": "Verified against approved artwork.",
        "domain": "difference-comments",
        "updatedAt": "...",
        "updatedBy": "<email>"
    }
"""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from src.audit_service import log_from_authenticated_user
from src.audit_constants import (
    DIFFERENCE_COMMENT_ADDED,
    DIFFERENCE_COMMENT_UPDATED,
    APPLICATION_MEDINSPECT,
    MODULE_TEXT_INSPECTION,
    STATUS_SUCCESS,
)
from src.azure_service import cosmos_get_document, cosmos_query_documents, cosmos_upsert_document
from src.logger import logger

COMMENTS_CONTAINER = "difference-comments"

MAX_COMMENT_LENGTH = 500


def _doc_id(inspection_id: str, difference_id: int) -> str:
    return f"{inspection_id}__{difference_id}"


def get_difference_comments(inspection_id: str) -> List[Dict[str, Any]]:
    """Return all saved user comments for a given inspection (newest friendly)."""
    try:
        documents = cosmos_query_documents(
            COMMENTS_CONTAINER,
            {
                "query": "SELECT * FROM c WHERE c.inspectionId = @ins",
                "parameters": [{"name": "ins", "value": inspection_id}],
            },
        )
    except Exception as exc:
        logger.error("[DIFF-COMMENT] Failed to read comments for %s: %s", inspection_id, exc)
        return []
    return [doc for doc in documents if doc]


def get_difference_comment(inspection_id: str, difference_id: int) -> Optional[Dict[str, Any]]:
    try:
        doc = cosmos_get_document(COMMENTS_CONTAINER, _doc_id(inspection_id, difference_id))
    except Exception:
        return None
    return doc if doc and doc.get("inspectionId") else None


def upsert_difference_comment(
    *,
    inspection_id: str,
    difference_id: int,
    configured_comment: str,
    user_comment: str,
    authenticated_user: dict,
) -> Dict[str, Any]:
    """Persist a user comment for a specific difference and audit the change."""
    previous = get_difference_comment(inspection_id, difference_id)
    previous_comment = (previous or {}).get("userComment") or ""
    new_comment = user_comment.strip()[:MAX_COMMENT_LENGTH]

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    document = {
        "id": _doc_id(inspection_id, difference_id),
        "inspectionId": inspection_id,
        "differenceId": int(difference_id),
        "configuredComment": configured_comment,
        "userComment": new_comment,
        "updatedAt": timestamp,
        "updatedBy": str(authenticated_user.get("email", "")),
    }

    try:
        cosmos_upsert_document(COMMENTS_CONTAINER, document)
    except Exception as exc:
        logger.error("[DIFF-COMMENT] Failed to persist comment for %s/%s: %s", inspection_id, difference_id, exc)
        raise

    event = DIFFERENCE_COMMENT_UPDATED if previous else DIFFERENCE_COMMENT_ADDED
    action = "Update Difference Comment" if previous else "Add Difference Comment"
    log_from_authenticated_user(
        event=event,
        action=action,
        application=APPLICATION_MEDINSPECT,
        module=MODULE_TEXT_INSPECTION,
        authenticated_user=authenticated_user,
        status=STATUS_SUCCESS,
        description=f"Comment {'updated' if previous else 'added'} for difference {difference_id} in inspection {inspection_id}.",
        entity_type="Difference",
        entity_id=inspection_id,
        inspection_id=inspection_id,
        changes={"comment": {"from": previous["userComment"] if previous else None, "to": new_comment}},
        metadata={"differenceId": int(difference_id), "configuredComment": configured_comment},
    )
    return document