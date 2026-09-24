import json
from email.utils import formatdate
from typing import Any, Dict, List, Optional, Union

import requests
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient


def _request_with_apim_fallback(method: str, url: str, **kwargs):
    verify = kwargs.pop("verify", True)
    try:
        return requests.request(method, url, verify=verify, **kwargs)
    except requests.exceptions.SSLError:
        if verify is True:
            return requests.request(method, url, verify=False, **kwargs)
        raise

from src.config import AzureSettings, get_azure_settings


def _get_credential(settings: AzureSettings):
    if settings.managed_identity_client_id:
        return DefaultAzureCredential(managed_identity_client_id=settings.managed_identity_client_id)
    return DefaultAzureCredential()


def _get_subscription_headers(settings: AzureSettings, *, is_storage: bool, partition_key: Optional[str] = None) -> Dict[str, str]:
    key = settings.storage_subscription_key if is_storage else settings.cosmos_subscription_key
    if not key:
        raise ValueError(f"AZURE_{'STORAGE' if is_storage else 'COSMOS'}_SUBSCRIPTION_KEY is not configured.")
    headers = {"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json"}
    if not is_storage:
        # Cosmos DB SQL REST API requires x-ms-version and x-ms-date; a missing
        # x-ms-version is a common cause of the APIM returning 400 Bad Request.
        headers["x-ms-date"] = formatdate(usegmt=True)
        headers["x-ms-version"] = "2018-12-31"
    if partition_key is not None:
        headers["x-ms-documentdb-partitionkey"] = str(partition_key)
    return headers


def _get_storage_url(settings: AzureSettings, *, folder_name: str, file_name: str) -> str:
    if not settings.storage_api_base_url:
        raise ValueError("AZURE_STORAGE_API_BASE_URL is not configured.")
    return settings.storage_api_base_url.replace("{custom_folder_name}", folder_name).replace("{file_name}", file_name)


def _get_cosmos_url(settings: AzureSettings, *, collection_name: str = "", document_id: Optional[str] = None, query: bool = False) -> str:
    if not settings.cosmos_api_base_url:
        raise ValueError("AZURE_COSMOS_API_BASE_URL is not configured.")

    base = settings.cosmos_api_base_url.rstrip("/")
    if query:
        if base.endswith("/query"):
            return base
        return f"{base}/query"
    if document_id:
        return f"{base}/{document_id}"
    return base


def get_cosmos_client():
    settings = get_azure_settings()
    if not settings.cosmos_api_base_url:
        raise ValueError("AZURE_COSMOS_API_BASE_URL is not configured.")
    return {"base_url": settings.cosmos_api_base_url, "subscription_key": settings.cosmos_subscription_key}


def get_cosmos_database_client(database_name: Optional[str] = None):
    settings = get_azure_settings()
    database_name = database_name or settings.cosmos_database_name
    if not database_name:
        raise ValueError("AZURE_COSMOS_DATABASE_NAME is not configured.")
    return {"database_name": database_name, "base_url": settings.cosmos_api_base_url}


def ensure_cosmos_database(database_name: Optional[str] = None) -> str:
    settings = get_azure_settings()
    name = database_name or settings.cosmos_database_name
    if not name:
        raise ValueError("AZURE_COSMOS_DATABASE_NAME is not configured.")
    return name


def get_container_client(container_name: str):
    return {"container_name": container_name}


def _build_blob_service_client(settings: AzureSettings) -> BlobServiceClient:
    if settings.storage_api_base_url:
        # APIM route based storage is used; direct SDK fallback is not required.
        return BlobServiceClient(account_url=settings.storage_endpoint, credential=settings.storage_account_key or _get_credential(settings))
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


def _partition_value_for(collection_name: str) -> str:
    """Return the partition key value for a collection.

    The Cosmos DB container uses /domain as the partition key path, so we
    derive a stable domain value from the collection name.
    """
    return collection_name


def _get_partition_key_header(partition_value: str) -> str:
    """Build the x-ms-documentdb-partitionkey header value."""
    return f'[{json.dumps(partition_value)}]'


def cosmos_upsert_document(collection_name: str, document: Dict[str, Any]) -> Dict[str, Any]:
    settings = get_azure_settings()
    partition_value = document.get("domain", _partition_value_for(collection_name))
    headers = _get_subscription_headers(settings, is_storage=False, partition_key=_get_partition_key_header(partition_value)).copy()
    headers["Content-Type"] = "application/json"
    # Use x-ms-documentdb-is-upsert: true so Cosmos DB updates an existing
    # document (matched by id + partition key) instead of creating a duplicate.
    headers["x-ms-documentdb-is-upsert"] = "true"
    payload = dict(document)
    payload.setdefault("collection", collection_name)
    payload.setdefault("domain", partition_value)
    response = _request_with_apim_fallback("POST", _get_cosmos_url(settings, collection_name=collection_name), headers=headers, json=payload, timeout=30)
    response.raise_for_status()
    return response.json() if response.content else {"status": "ok", "collection": collection_name}


def cosmos_get_document(collection_name: str, document_id: str) -> Dict[str, Any]:
    settings = get_azure_settings()
    partition_value = _partition_value_for(collection_name)
    headers = _get_subscription_headers(settings, is_storage=False, partition_key=_get_partition_key_header(partition_value)).copy()
    response = _request_with_apim_fallback("GET", _get_cosmos_url(settings, collection_name=collection_name, document_id=document_id), headers=headers, timeout=30)
    response.raise_for_status()
    return response.json() if response.content else {"id": document_id, "collection": collection_name}


def cosmos_delete_document(collection_name: str, document_id: str) -> Dict[str, Any]:
    settings = get_azure_settings()
    partition_value = _partition_value_for(collection_name)
    headers = _get_subscription_headers(settings, is_storage=False, partition_key=_get_partition_key_header(partition_value)).copy()
    response = _request_with_apim_fallback("DELETE", _get_cosmos_url(settings, collection_name=collection_name, document_id=document_id), headers=headers, timeout=30)
    response.raise_for_status()
    return response.json() if response.content else {"status": "deleted", "id": document_id, "collection": collection_name}


def cosmos_query_documents(collection_name: str, query: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    settings = get_azure_settings()
    partition_value = _partition_value_for(collection_name)
    headers = _get_subscription_headers(settings, is_storage=False, partition_key=_get_partition_key_header(partition_value)).copy()
    body = query or {"query": "SELECT * FROM c WHERE c.collection = @collection", "parameters": [{"name": "@collection", "value": collection_name}]}
    response = _request_with_apim_fallback("POST", _get_cosmos_url(settings, collection_name=collection_name, query=True), headers=headers, json=body, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        # Cosmos DB REST API returns "Documents" (capital D) in the response
        if isinstance(payload.get("Documents"), list):
            return payload["Documents"]
        if isinstance(payload.get("documents"), list):
            return payload["documents"]
        if isinstance(payload.get("items"), list):
            return payload["items"]
    return payload if isinstance(payload, list) else []


def upload_blob(container_name: str, blob_name: str, data: Union[bytes, str], content_type: Optional[str] = None) -> str:
    settings = get_azure_settings()
    if settings.storage_api_base_url:
        url = _get_storage_url(settings, folder_name=container_name, file_name=blob_name)
        headers = _get_subscription_headers(settings, is_storage=True).copy()
        headers.pop("Content-Type", None)
        payload = data.encode("utf-8") if isinstance(data, str) else data
        response = _request_with_apim_fallback("PUT", url, headers=headers, data=payload, timeout=30)
        response.raise_for_status()
        return url

    client = _build_blob_service_client(settings)
    blob_client = client.get_blob_client(container=container_name, blob=blob_name)
    if isinstance(data, str):
        data = data.encode("utf-8")
    blob_client.upload_blob(data, overwrite=True, content_settings=None if content_type is None else {"content_type": content_type})
    return blob_client.url


def download_blob(container_name: str, blob_name: str) -> bytes:
    settings = get_azure_settings()
    if settings.storage_api_base_url:
        url = _get_storage_url(settings, folder_name=container_name, file_name=blob_name)
        response = _request_with_apim_fallback("GET", url, headers=_get_subscription_headers(settings, is_storage=True), timeout=30)
        response.raise_for_status()
        return response.content

    client = _build_blob_service_client(settings)
    blob_client = client.get_blob_client(container=container_name, blob=blob_name)
    return blob_client.download_blob().readall()


def list_storage_containers() -> List[str]:
    settings = get_azure_settings()
    if settings.storage_api_base_url:
        return [settings.storage_container_prefix, "master-files", "sample-files", "ai-files", "doc-docx", "xls-xlsx", "rendered-pages", "difference-images", "reports"]

    client = _build_blob_service_client(settings)
    return [container.name for container in client.list_containers(include_metadata=False)]


def ensure_storage_containers() -> List[str]:
    settings = get_azure_settings()
    if settings.storage_api_base_url:
        return [
            f"{settings.storage_container_prefix}-master-files",
            f"{settings.storage_container_prefix}-sample-files",
            f"{settings.storage_container_prefix}-ai-files",
            f"{settings.storage_container_prefix}-doc-docx",
            f"{settings.storage_container_prefix}-xls-xlsx",
            f"{settings.storage_container_prefix}-rendered-pages",
            f"{settings.storage_container_prefix}-difference-images",
            f"{settings.storage_container_prefix}-reports",
        ]

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


def get_backend_infrastructure_status() -> Dict[str, Any]:
    settings = get_azure_settings()
    app_db_ok = bool(settings.cosmos_api_base_url and settings.cosmos_database_name)
    results_db_ok = bool(settings.cosmos_api_base_url and settings.cosmos_results_database_name)
    storage_ok = bool(settings.storage_api_base_url or settings.storage_account_name)
    config_ok = bool(settings.cosmos_api_base_url and (settings.storage_api_base_url or settings.storage_account_name) and settings.cosmos_database_name)
    payload: Dict[str, Any] = {
        "status": "configured" if config_ok else "missing-config",
        "ready": False,
        "databases": {
            "app": {
                "name": settings.cosmos_database_name,
                "configured": app_db_ok,
            },
            "results": {
                "name": settings.cosmos_results_database_name,
                "configured": results_db_ok,
            },
        },
        "cosmos": {
            "endpoint": bool(settings.cosmos_endpoint),
            "database": settings.cosmos_database_name,
            "results_database": settings.cosmos_results_database_name,
            "configured": bool(settings.cosmos_api_base_url and settings.cosmos_database_name),
        },
        "storage": {
            "account": settings.storage_account_name,
            "configured": storage_ok,
            "endpoint": settings.storage_endpoint if settings.storage_api_base_url or settings.storage_account_name else "",
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
    if settings.storage_api_base_url:
        url = _get_storage_url(settings, folder_name=container_name, file_name=blob_name)
        headers = _get_subscription_headers(settings, is_storage=True).copy()
        headers.pop("Content-Type", None)
        payload = data.encode("utf-8") if isinstance(data, str) else data
        response = _request_with_apim_fallback("PUT", url, headers=headers, data=payload, timeout=30)
        response.raise_for_status()
        return url

    client = _build_blob_service_client(settings)
    blob_client = client.get_blob_client(container=container_name, blob=blob_name)
    if isinstance(data, str):
        data = data.encode("utf-8")
    blob_client.upload_blob(data, overwrite=True, content_settings=None if content_type is None else {"content_type": content_type})
    return blob_client.url


def download_blob(container_name: str, blob_name: str) -> bytes:
    settings = get_azure_settings()
    if settings.storage_api_base_url:
        url = _get_storage_url(settings, folder_name=container_name, file_name=blob_name)
        response = _request_with_apim_fallback("GET", url, headers=_get_subscription_headers(settings, is_storage=True), timeout=30)
        response.raise_for_status()
        return response.content

    client = _build_blob_service_client(settings)
    blob_client = client.get_blob_client(container=container_name, blob=blob_name)
    return blob_client.download_blob().readall()

def delete_blob(container_name: str, blob_name: str) -> None:
    """Delete a blob (APIM REST when configured, direct SDK otherwise)."""
    settings = get_azure_settings()
    if settings.storage_api_base_url:
        url = _get_storage_url(settings, folder_name=container_name, file_name=blob_name)
        response = _request_with_apim_fallback("DELETE", url, headers=_get_subscription_headers(settings, is_storage=True), timeout=30)
        if response.status_code not in (200, 202, 404):
            response.raise_for_status()
        return

    client = _build_blob_service_client(settings)
    blob_client = client.get_blob_client(container=container_name, blob=blob_name)
    blob_client.delete_blob()



def list_storage_containers() -> List[str]:
    settings = get_azure_settings()
    if settings.storage_api_base_url:
        return [settings.storage_container_prefix, "master-files", "sample-files", "ai-files", "doc-docx", "xls-xlsx", "rendered-pages", "difference-images", "reports"]

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
