"""Reusable repository layer over the existing Azure connection services.

Cosmos DB stores metadata; Azure Blob Storage stores binary content.
Repositories talk to Cosmos through ``src.azure_service`` (APIM REST with
optional direct SDK fallback), which is initialised once per process and
reused for every request — one client, never one per request.

Only two user roles exist: "user" and "administrator".
"""

from typing import Any, Dict, List, Optional

from src.azure_service import (
    blob_delete_blob,
    blob_download_blob,
    blob_upload_blob,
    cosmos_delete_document,
    cosmos_query_documents,
    cosmos_read_document,
    cosmos_upsert_document,
)


class RepositoryError(Exception):
    """Raised when the database or storage layer cannot complete an operation."""


VALID_ROLES = ("user", "administrator")

# Logical container names (created lazily by the APIM/SDK layer on first use).
CONTAINERS = {
    "users": "users",
    "projects": "projects",
    "documents": "documents",
    "inspections": "inspections",
    "results": "results",
    "violations": "violations",
    "coordinates": "coordinates",
    "reviewstatus": "reviewstatus",
    "audit": "audit",
}

# Blob path folders — identifiers are always included to prevent collisions.
BLOB_FOLDERS = {
    "master": "master",
    "sample": "sample",
    "ai": "ai",
    "documents": "documents",
    "rendered-pages": "rendered-pages",
    "difference-images": "difference-images",
    "reports": "reports",
}


def blob_path(folder: str, *parts: str) -> str:
    """Build a collision-free blob path, e.g. master/{projectId}/{docId}/{file}."""
    if folder not in BLOB_FOLDERS:
        raise RepositoryError(f"Unknown blob folder: {folder}")
    cleaned = [str(p).strip("/\\") for p in parts if str(p).strip("/\\")]
    if not cleaned:
        raise RepositoryError("Blob path requires at least one identifier part")
    return "/".join([BLOB_FOLDERS[folder], *cleaned])


class BaseRepository:
    """Generic container repository with query/upsert/delete helpers."""

    container: str = ""

    def __init__(self, container: Optional[str] = None) -> None:
        self.container = container or self.container
        if not self.container:
            raise RepositoryError("Container name is required")

    def query(self, query: str, parameters: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
        try:
            return cosmos_query_documents(self.container, query, parameters)
        except Exception as exc:  # Cosmos unavailable etc.
            raise RepositoryError(f"Cosmos query failed on '{self.container}': {exc}") from exc

    def get(self, doc_id: str) -> Optional[Dict[str, Any]]:
        try:
            return cosmos_read_document(self.container, doc_id)
        except Exception as exc:
            raise RepositoryError(f"Cosmos read failed on '{self.container}' id={doc_id}: {exc}") from exc

    def upsert(self, document: Dict[str, Any]) -> Dict[str, Any]:
        if "id" not in document:
            raise RepositoryError("Document requires an 'id' field")
        try:
            return cosmos_upsert_document(self.container, document)
        except Exception as exc:
            raise RepositoryError(f"Cosmos upsert failed on '{self.container}': {exc}") from exc

    def delete(self, doc_id: str) -> None:
        try:
            cosmos_delete_document(self.container, doc_id)
        except Exception as exc:
            raise RepositoryError(f"Cosmos delete failed on '{self.container}' id={doc_id}: {exc}") from exc


_REPOS: Dict[str, BaseRepository] = {}


def get_repository(name: str) -> BaseRepository:
    """Return the shared singleton repository for a logical container."""
    if name not in CONTAINERS:
        raise RepositoryError(f"Unknown repository: {name}")
    if name not in _REPOS:
        _REPOS[name] = BaseRepository(CONTAINERS[name])
    return _REPOS[name]


class UserRepository:
    """Users with exactly two roles: 'user' and 'administrator'."""

    def __init__(self) -> None:
        self._repo = get_repository("users")

    @staticmethod
    def _validate(record: Dict[str, Any]) -> Dict[str, Any]:
        role = (record.get("accountType") or record.get("role") or "user").strip().lower()
        if role not in VALID_ROLES:
            raise RepositoryError(f"Invalid role '{role}'. Allowed roles: {', '.join(VALID_ROLES)}")
        if not record.get("email"):
            raise RepositoryError("User requires an email")
        return record

    def list(self) -> List[Dict[str, Any]]:
        return self._repo.query("SELECT * FROM c ORDER BY c.createdAt DESC")

    def get(self, user_id: str) -> Optional[Dict[str, Any]]:
        return self._repo.get(user_id)

    def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        rows = self._repo.query(
            "SELECT * FROM c WHERE LOWER(c.email) = @email LIMIT 1",
            [{"name": "@email", "value": (email or "").strip().lower()}],
        )
        return rows[0] if rows else None

    def create(self, record: Dict[str, Any]) -> Dict[str, Any]:
        self._validate(record)
        if self.get_by_email(record["email"]):
            raise RepositoryError(f"Email '{record['email']}' already registered")
        return self._repo.upsert(record)

    def update(self, user_id: str, changes: Dict[str, Any]) -> Dict[str, Any]:
        existing = self.get(user_id)
        if not existing:
            raise RepositoryError(f"User not found: {user_id}")
        if "role" in changes or "accountType" in changes:
            self._validate({**existing, **changes})
        merged = {**existing, **changes, "id": user_id}
        merged.pop("updatedAt", None)
        return self._repo.upsert(merged)


class ProjectRepository:
    def __init__(self) -> None:
        self._repo = get_repository("projects")

    def list(self) -> List[Dict[str, Any]]:
        return self._repo.query("SELECT * FROM c ORDER BY c.createdAt DESC")

    def get(self, project_id: str) -> Optional[Dict[str, Any]]:
        return self._repo.get(project_id)

    def upsert(self, record: Dict[str, Any]) -> Dict[str, Any]:
        if not record.get("name"):
            raise RepositoryError("Project requires a name")
        return self._repo.upsert(record)

    def delete(self, project_id: str) -> None:
        self._repo.delete(project_id)


class DocumentRepository:
    """Metadata only — binary content lives in Blob Storage."""

    def __init__(self) -> None:
        self._repo = get_repository("documents")

    def list_by_project(self, project_id: str) -> List[Dict[str, Any]]:
        return self._repo.query(
            "SELECT * FROM c WHERE c.projectId = @pid ORDER BY c.uploadedAt DESC",
            [{"name": "@pid", "value": project_id}],
        )

    def get(self, document_id: str) -> Optional[Dict[str, Any]]:
        return self._repo.get(document_id)

    def upsert(self, record: Dict[str, Any]) -> Dict[str, Any]:
        for field in ("projectId", "fileName", "blobPath"):
            if not record.get(field):
                raise RepositoryError(f"Document requires '{field}'")
        return self._repo.upsert(record)

    def delete(self, document_id: str) -> None:
        self._repo.delete(document_id)


    def get(self, doc_id: str) -> Optional[Dict[str, Any]]:
        try:
            return cosmos_read_document(self.container, doc_id)
        except Exception as exc:
            raise RepositoryError(f"Cosmos read failed on '{self.container}' id={doc_id}: {exc}") from exc

    def save(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        if "id" not in doc:
            raise RepositoryError("Document requires an 'id'")
        try:
            return cosmos_upsert_document(self.container, doc)
        except Exception as exc:
            raise RepositoryError(f"Cosmos upsert failed on '{self.container}': {exc}") from exc

    def delete(self, doc_id: str) -> bool:
        try:
            return cosmos_delete_document(self.container, doc_id)
        except Exception as exc:
            raise RepositoryError(f"Cosmos delete failed on '{self.container}' id={doc_id}: {exc}") from exc
