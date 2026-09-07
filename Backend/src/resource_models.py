from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Optional

RESOURCE_MODELS: Dict[str, Dict[str, Any]] = {
    "users": {
        "resource": "users",
        "description": "Application users and role assignments.",
        "key_fields": ["id", "username", "email"],
        "indexes": [
            {"name": "idx_users_username", "fields": ["username"], "unique": True},
            {"name": "idx_users_email", "fields": ["email"], "unique": True},
            {"name": "idx_users_account_status", "fields": ["accountStatus"]},
        ],
        "example": {
            "id": "user_1001",
            "username": "demo.user",
            "email": "demo.user@medinspect.ai",
            "firstName": "Demo",
            "lastName": "User",
            "accountType": "User",
            "accountStatus": "Active",
            "company": "MedInspect",
            "lastLogin": "2026-09-02T10:30:00Z",
            "passwordExpiry": "2026-12-02T00:00:00Z",
            "createdAt": "2026-09-02T09:00:00Z",
            "emailNotificationEnabled": True,
        },
    },
    "projects": {
        "resource": "projects",
        "description": "Top-level customer or study projects.",
        "key_fields": ["id", "name"],
        "indexes": [
            {"name": "idx_projects_name", "fields": ["name"]},
            {"name": "idx_projects_owner", "fields": ["ownerId"]},
        ],
        "example": {
            "id": "project_2001",
            "name": "Viatris Q3 Packaging Review",
            "description": "Packaging comparison for the Q3 campaign.",
            "status": "active",
            "ownerId": "user_1001",
            "createdAt": "2026-09-02T09:05:00Z",
            "updatedAt": "2026-09-02T09:10:00Z",
        },
    },
    "documents": {
        "resource": "documents",
        "description": "Project documents stored for review and inspection.",
        "key_fields": ["id", "projectId", "name"],
        "indexes": [
            {"name": "idx_documents_project", "fields": ["projectId"]},
            {"name": "idx_documents_status", "fields": ["status"]},
        ],
        "example": {
            "id": "doc_3001",
            "projectId": "project_2001",
            "name": "Master Label Artwork",
            "fileName": "master-label-artwork.pdf",
            "fileUrl": "/storage/master-label-artwork.pdf",
            "status": "approved",
            "version": "v1.2",
            "createdAt": "2026-09-02T09:20:00Z",
            "updatedAt": "2026-09-02T09:25:00Z",
        },
    },
    "inspections": {
        "resource": "inspections",
        "description": "Inspection runs against document pairs.",
        "key_fields": ["id", "documentId", "status"],
        "indexes": [
            {"name": "idx_inspections_document", "fields": ["documentId"]},
            {"name": "idx_inspections_owner", "fields": ["ownerId"]},
            {"name": "idx_inspections_status", "fields": ["status"]},
        ],
        "example": {
            "id": "inspection_4001",
            "projectId": "project_2001",
            "documentId": "doc_3001",
            "ownerId": "user_1001",
            "status": "completed",
            "configuration": {"inspectionType": "text", "filters": {"case": True}},
            "createdAt": "2026-09-02T09:30:00Z",
            "updatedAt": "2026-09-02T09:45:00Z",
        },
    },
    "results": {
        "resource": "results",
        "description": "Inspection results and match statistics.",
        "key_fields": ["id", "inspectionId"],
        "indexes": [
            {"name": "idx_results_inspection", "fields": ["inspectionId"]},
            {"name": "idx_results_status", "fields": ["status"]},
        ],
        "example": {
            "id": "result_5001",
            "inspectionId": "inspection_4001",
            "documentId": "doc_3001",
            "status": "completed",
            "summary": {"totalFindings": 3, "critical": 1, "major": 1, "minor": 1},
            "findings": [
                {"id": "f_1", "type": "Change", "page": 1, "master": "A", "sample": "B", "comment": "Mismatch detected"}
            ],
            "createdAt": "2026-09-02T09:46:00Z",
            "updatedAt": "2026-09-02T09:50:00Z",
        },
    },
    "violations": {
        "resource": "violations",
        "description": "Detailed violations generated from inspection findings.",
        "key_fields": ["id", "resultId"],
        "indexes": [
            {"name": "idx_violations_result", "fields": ["resultId"]},
            {"name": "idx_violations_severity", "fields": ["severity"]},
        ],
        "example": {
            "id": "violation_6001",
            "resultId": "result_5001",
            "type": "Change",
            "page": 1,
            "severity": "major",
            "description": "Label text differs from approved artwork.",
            "coordinates": {"x": 120, "y": 220, "width": 180, "height": 24},
            "createdAt": "2026-09-02T09:47:00Z",
        },
    },
    "coordinates": {
        "resource": "coordinates",
        "description": "Bounding box coordinates for review overlays.",
        "key_fields": ["id", "entityType", "entityId"],
        "indexes": [
            {"name": "idx_coordinates_entity", "fields": ["entityType", "entityId"]},
            {"name": "idx_coordinates_page", "fields": ["page"]},
        ],
        "example": {
            "id": "coord_7001",
            "entityType": "violation",
            "entityId": "violation_6001",
            "x": 120,
            "y": 220,
            "width": 180,
            "height": 24,
            "page": 1,
            "createdAt": "2026-09-02T09:47:30Z",
        },
    },
    "review-status": {
        "resource": "review-status",
        "description": "Current review workflow state for each inspection.",
        "key_fields": ["id", "inspectionId"],
        "indexes": [
            {"name": "idx_review_status_inspection", "fields": ["inspectionId"]},
            {"name": "idx_review_status_reviewer", "fields": ["reviewerId"]},
        ],
        "example": {
            "id": "review_8001",
            "inspectionId": "inspection_4001",
            "reviewerId": "user_1001",
            "status": "approved",
            "notes": "No critical issues remain.",
            "updatedAt": "2026-09-02T09:55:00Z",
        },
    },
    "audit-metadata": {
        "resource": "audit-metadata",
        "description": "Audit trail for resource create/update/delete activity.",
        "key_fields": ["id", "resourceType", "resourceId"],
        "indexes": [
            {"name": "idx_audit_resource", "fields": ["resourceType", "resourceId"]},
            {"name": "idx_audit_actor", "fields": ["actorId"]},
        ],
        "example": {
            "id": "audit_9001",
            "resourceType": "results",
            "resourceId": "result_5001",
            "actorId": "user_1001",
            "action": "create",
            "details": {"source": "inspection-service", "message": "Result stored successfully"},
            "createdAt": "2026-09-02T09:51:00Z",
        },
    },
}


def get_resource_model(resource: str) -> Dict[str, Any]:
    key = resource.lower().strip()
    if key not in RESOURCE_MODELS:
        raise ValueError(f"Unsupported resource '{resource}'")
    return deepcopy(RESOURCE_MODELS[key])


def list_resource_models() -> Dict[str, Dict[str, Any]]:
    return {name: deepcopy(model) for name, model in RESOURCE_MODELS.items()}


def get_seed_payload(resource: str, *, identifier: Optional[str] = None) -> Dict[str, Any]:
    model = get_resource_model(resource)
    payload = deepcopy(model["example"])
    if identifier:
        payload["id"] = identifier
    return payload
