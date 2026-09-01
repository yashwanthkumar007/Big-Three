import os
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class AzureSettings:
    cosmos_endpoint: str
    cosmos_database_name: str
    storage_account_name: str
    storage_container_prefix: str = "medinspect"
    managed_identity_client_id: Optional[str] = None
    cosmos_account_key: Optional[str] = None
    storage_account_key: Optional[str] = None
    storage_endpoint_suffix: str = "core.windows.net"

    def has_secret_values(self) -> bool:
        return any(
            value is not None and value.strip() not in ("", "<set-me>")
            for value in (
                self.cosmos_account_key,
                self.storage_account_key,
            )
        )

    @property
    def storage_endpoint(self) -> str:
        return f"https://{self.storage_account_name}.blob.{self.storage_endpoint_suffix}"


def _get_env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value is None:
        return default
    stripped = value.strip()
    return stripped or default


def get_azure_settings() -> AzureSettings:
    return AzureSettings(
        cosmos_endpoint=_get_env("AZURE_COSMOS_ENDPOINT") or "",
        cosmos_database_name=_get_env("AZURE_COSMOS_DATABASE_NAME") or "medinspect-db",
        storage_account_name=_get_env("AZURE_STORAGE_ACCOUNT_NAME") or "",
        storage_container_prefix=_get_env("AZURE_STORAGE_CONTAINER_PREFIX") or "medinspect",
        managed_identity_client_id=_get_env("AZURE_MANAGED_IDENTITY_CLIENT_ID"),
        cosmos_account_key=_get_env("AZURE_COSMOS_ACCOUNT_KEY"),
        storage_account_key=_get_env("AZURE_STORAGE_ACCOUNT_KEY"),
        storage_endpoint_suffix=_get_env("AZURE_STORAGE_ENDPOINT_SUFFIX") or "core.windows.net",
    )


def get_azure_env_overrides() -> Dict[str, Any]:
    settings = get_azure_settings()
    return {
        "AZURE_COSMOS_ENDPOINT": settings.cosmos_endpoint,
        "AZURE_COSMOS_DATABASE_NAME": settings.cosmos_database_name,
        "AZURE_STORAGE_ACCOUNT_NAME": settings.storage_account_name,
        "AZURE_STORAGE_CONTAINER_PREFIX": settings.storage_container_prefix,
        "AZURE_MANAGED_IDENTITY_CLIENT_ID": settings.managed_identity_client_id,
    }
