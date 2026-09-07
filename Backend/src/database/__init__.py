"""Reusable database layer for MedInspectAI.

Cosmos DB stores metadata. Azure Blob Storage stores binary content.
All access goes through repositories built on the existing
``src.azure_service`` connection layer, which is initialised once per
process (APIM REST based, with direct SDK fallback where configured).

Containers (logical entities) in the application database:
    users, projects, documents, inspections, results,
    violations, coordinates, reviewstatus, audit

Only two roles exist: "user" and "administrator".
"""

from src.database.repositories import (
    AuditRepository,
    CoordinateRepository,
    DocumentRepository,
    InspectionRepository,
    ProjectRepository,
    RepositoryError,
    ResultRepository,
    ReviewStatusRepository,
    UserRepository,
    ViolationRepository,
    get_repository,
)

__all__ = [
    "AuditRepository",
    "CoordinateRepository",
    "DocumentRepository",
    "InspectionRepository",
    "ProjectRepository",
    "RepositoryError",
    "ResultRepository",
    "ReviewStatusRepository",
    "UserRepository",
    "ViolationRepository",
    "get_repository",
]
