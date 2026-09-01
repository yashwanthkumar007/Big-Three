from typing import Any, Dict, List, Optional, Union

from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient

from src.config import AzureSettings, get_azure_settings


def _get_credential(settings: AzureSettings):
    if settings.managed_identity_client_id:
        return DefaultAzureCredential(managed_identity_client_id=settings.managed_identity_client_id)
    return DefaultAzureCredential()


def get_cosmos_client():
    settings = get_azure_settings()
    if not settings.cosmos_endpoint:
        raise ValueError("AZURE_COSMOS_ENDPOINT is not configured.")

    try:
        from azure.cosmos import CosmosClient
    except ImportError as exc:  # pragma: no cover - dependency safety
        raise RuntimeError("azure-cosmos is not installed.") from exc

    if settings.cosmos_account_key:
        return CosmosClient(settings.cosmos_endpoint, credential=settings.cosmos_account_key)

    return CosmosClient(settings.cosmos_endpoint, credential=_get_credential(settings))


def get_cosmos_database_client(database_name: Optional[str] = None):
    settings = get_azure_settings()
    database_name = database_name or settings.cosmos_database_name
    if not database_name:
        raise ValueError("AZURE_COSMOS_DATABASE_NAME is not configured.")
    return get_cosmos_client().get_database_client(database_name)


def ensure_cosmos_database(database_name: Optional[str] = None) -> str:
    database = get_cosmos_database_client(database_name)
    return database.database_name


def get_container_client(container_name: str):
    from azure.cosmos import ContainerProxy

    database = get_cosmos_database_client()
    container = database.get_container_client(container_name)
    if not isinstance(container, ContainerProxy):
        return container
    return container


def _build_blob_service_client(settings: AzureSettings) -> BlobServiceClient:
    if not settings.storage_account_name:
        raise ValueError("AZURE_STORAGE_ACCOUNT_NAME is not configured.")

    if settings.storage_account_key:
        return BlobServiceClient(
            account_url=settings.storage_endpoint,
            credential=settings.storage_account_key,
        )

    credential = DefaultAzureCredential(managed_identity_client_id=settings.managed_identity_client_id)
    return BlobServiceClient(
        account_url=settings.storage_endpoint,
        credential=credential,
    )


def get_backend_infrastructure_status() -> Dict[str, Any]:
    settings = get_azure_settings()
    config_ok = bool(settings.cosmos_endpoint and settings.storage_account_name and settings.cosmos_database_name)
    payload: Dict[str, Any] = {
        "status": "configured" if config_ok else "missing-config",
        "ready": False,
        "cosmos": {
            "endpoint": bool(settings.cosmos_endpoint),
            "database": settings.cosmos_database_name,
            "configured": bool(settings.cosmos_endpoint and settings.cosmos_database_name),
        },
        "storage": {
            "account": settings.storage_account_name,
            "configured": bool(settings.storage_account_name),
            "endpoint": settings.storage_endpoint if settings.storage_account_name else "",
            "container_prefix": settings.storage_container_prefix,
        },
    }

    if not config_ok:
        return payload

    try:
        _build_blob_service_client(settings)
        payload["ready"] = True
        payload["storage"]["blob_connectivity"] = "ok"
    except Exception as exc:  # pragma: no cover - environment-dependent runtime check
        payload["status"] = "error"
        payload["storage"]["blob_connectivity"] = f"error: {exc}"

    try:
        from azure.cosmos import CosmosClient

        if settings.cosmos_account_key:
            client = CosmosClient(settings.cosmos_endpoint, credential=settings.cosmos_account_key)
        else:
            credential = DefaultAzureCredential(managed_identity_client_id=settings.managed_identity_client_id)
            client = CosmosClient(settings.cosmos_endpoint, credential=credential)

        client.get_database_client(settings.cosmos_database_name)
        payload["cosmos"]["connectivity"] = "ok"
        payload["ready"] = True
    except Exception as exc:  # pragma: no cover - environment-dependent runtime check
        payload["status"] = "error"
        payload["cosmos"]["connectivity"] = f"error: {exc}"

    return payload


def upload_blob(container_name: str, blob_name: str, data: Union[bytes, str], content_type: Optional[str] = None) -> str:
    settings = get_azure_settings()
    client = _build_blob_service_client(settings)
    blob_client = client.get_blob_client(container=container_name, blob=blob_name)
    if isinstance(data, str):
        data = data.encode("utf-8")
    blob_client.upload_blob(data, overwrite=True, content_settings=None if content_type is None else {"content_type": content_type})
    return blob_client.url


def download_blob(container_name: str, blob_name: str) -> bytes:
    settings = get_azure_settings()
    client = _build_blob_service_client(settings)
    blob_client = client.get_blob_client(container=container_name, blob=blob_name)
    return blob_client.download_blob().readall()


def list_storage_containers() -> List[str]:
    settings = get_azure_settings()
    client = _build_blob_service_client(settings)
    return [container.name for container in client.list_containers(include_metadata=False)]


def ensure_storage_containers() -> List[str]:
    settings = get_azure_settings()
    client = _build_blob_service_client(settings)
    required = [
        "master-files",
        "sample-files",
        "ai-files",
        "doc-docx",
        "xls-xlsx",
        "rendered-pages",
        "difference-images",
        "reports",
    ]
    existing = set(list_storage_containers())
    created: List[str] = []
    for name in required:
        container_name = f"{settings.storage_container_prefix}-{name}"
        if container_name not in existing:
            client.create_container(container_name)
            created.append(container_name)
    return created
