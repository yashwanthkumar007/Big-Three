from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

RESOURCE_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "users": {
        "required": [
            "username",
            "email",
            "firstName",
            "lastName",
            "accountType",
            "accountStatus",
            "createdAt",
        ],
        "optional": [
            "id",
            "company",
            "lastLogin",
            "passwordExpiry",
            "emailNotificationEnabled",
            "password",
        ],
        "types": {
            "id": str,
            "username": str,
            "email": str,
            "firstName": str,
            "lastName": str,
            "accountType": str,
            "accountStatus": str,
            "company": str,
            "lastLogin": (type(None), str),
            "passwordExpiry": (type(None), str),
            "createdAt": str,
            "emailNotificationEnabled": bool,
            "password": str,
        },
    },
    "projects": {
        "required": ["name", "status", "createdAt"],
        "optional": ["id", "description", "ownerId", "updatedAt"],
        "types": {
            "id": str,
            "name": str,
            "description": str,
            "status": str,
            "ownerId": str,
            "createdAt": str,
            "updatedAt": str,
        },
    },
    "documents": {
        "required": ["name", "projectId", "status", "createdAt"],
        "optional": ["id", "fileName", "fileUrl", "version", "updatedAt"],
        "types": {
            "id": str,
            "name": str,
            "projectId": str,
            "fileName": str,
            "fileUrl": str,
            "status": str,
            "version": str,
            "createdAt": str,
            "updatedAt": str,
        },
    },
    "inspections": {
        "required": ["documentId", "status", "createdAt"],
        "optional": ["id", "projectId", "ownerId", "configuration", "updatedAt"],
        "types": {
            "id": str,
            "projectId": str,
            "documentId": str,
            "ownerId": str,
            "status": str,
            "configuration": dict,
            "createdAt": str,
            "updatedAt": str,
        },
    },
    "results": {
        "required": ["inspectionId", "status", "createdAt"],
        "optional": ["id", "documentId", "summary", "findings", "updatedAt"],
        "types": {
            "id": str,
            "inspectionId": str,
            "documentId": str,
            "status": str,
            "summary": dict,
            "findings": list,
            "createdAt": str,
            "updatedAt": str,
        },
    },
    "violations": {
        "required": ["resultId", "type", "createdAt"],
        "optional": ["id", "page", "severity", "description", "coordinates"],
        "types": {
            "id": str,
            "resultId": str,
            "type": str,
            "page": int,
            "severity": str,
            "description": str,
            "coordinates": dict,
            "createdAt": str,
        },
    },
    "coordinates": {
        "required": ["entityType", "entityId", "x", "y", "width", "height"],
        "optional": ["id", "page", "createdAt"],
        "types": {
            "id": str,
            "entityType": str,
            "entityId": str,
            "x": (int, float),
            "y": (int, float),
            "width": (int, float),
            "height": (int, float),
            "page": int,
            "createdAt": str,
        },
    },
    "review-status": {
        "required": ["inspectionId", "status", "updatedAt"],
        "optional": ["id", "reviewerId", "notes"],
        "types": {
            "id": str,
            "inspectionId": str,
            "reviewerId": str,
            "status": str,
            "notes": str,
            "updatedAt": str,
        },
    },
    "audit-metadata": {
        "required": ["resourceType", "resourceId", "action", "createdAt"],
        "optional": ["id", "actorId", "details"],
        "types": {
            "id": str,
            "resourceType": str,
            "resourceId": str,
            "actorId": str,
            "action": str,
            "details": dict,
            "createdAt": str,
        },
    },
}


def get_resource_schema(resource: str) -> Dict[str, Any]:
    key = resource.lower().strip()
    if key not in RESOURCE_SCHEMAS:
        raise ValueError(f"Unsupported resource '{resource}'")
    return deepcopy(RESOURCE_SCHEMAS[key])


def _is_valid_type(value: Any, expected: Any) -> bool:
    if isinstance(expected, tuple):
        return any(isinstance(value, item) for item in expected)
    return isinstance(value, expected)


def normalize_resource_payload(resource: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    schema = get_resource_schema(resource)
    normalized = dict(payload)
    # Only persist fields declaredin the resource schema — strips incidental client
    # fields (e.g. `confirmPassword`, `currentPassword`, `newPassword`) so sensitive
    # secrets are never written to the database. Schema-known allowed fields
    # (required + optional) only.
    allowed = set(schema.get("required", [])) | set(schema.get("optional", []))
    normalized = {field: value for field, value in payload.items() if field in allowed and value is not None}
    # Defense-in-depth: never persist auth/secret fields even if declared elsewhere.
    # Note: `password` is allowed if it's in the schema (for user creation/login).
    normalized.pop("confirmPassword", None)
    normalized.pop("currentPassword", None)
    normalized.pop("newPassword", None)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if "id" in schema["optional"] and "id" not in normalized:
        normalized["id"] = str(uuid4())

    if "createdAt" in schema["required"] and "createdAt" not in normalized:
        normalized["createdAt"] = timestamp

    if "updatedAt" in schema["required"] and "updatedAt" not in normalized:
        normalized["updatedAt"] = timestamp

    return normalized


def validate_resource_payload(resource: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized = normalize_resource_payload(resource, payload)
    schema = get_resource_schema(resource)
    required = schema["required"]
    missing = [field for field in required if field not in normalized]
    if missing:
        raise ValueError(f"Missing required fields for '{resource}': {', '.join(missing)}")

    for field, value in normalized.items():
        expected = schema["types"].get(field)
        if expected is None:
            continue
        if value is None:
            continue
        if not _is_valid_type(value, expected):
            raise ValueError(f"Field '{field}' for '{resource}' must be of type {expected}")

    return normalized
