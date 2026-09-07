import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse


def _load_local_dotenv() -> None:
    candidates = [
        Path(__file__).resolve().with_name(".env"),
        Path(__file__).resolve().parents[1] / ".env",
        Path.cwd() / ".env",
    ]

    seen = set()
    for candidate in candidates:
        if not candidate.exists() or candidate in seen:
            continue
        seen.add(candidate)
        try:
            with candidate.open("r", encoding="utf-8") as handle:
                for raw_line in handle:
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = [part.strip() for part in line.split("=", 1)]
                    os.environ.setdefault(key, value)
        except OSError:
            continue


_load_local_dotenv()


@dataclass(frozen=True)
class AzureSettings:
    cosmos_api_base_url: str
    cosmos_subscription_key: Optional[str] = None
    cosmos_database_name: str = "medinspect-app-db"
    cosmos_results_database_name: str = "medinspect-results-db"
    storage_api_base_url: str = ""
    storage_subscription_key: Optional[str] = None
    storage_account_name: str = ""
    storage_container_prefix: str = "medinspect"
    managed_identity_client_id: Optional[str] = None
    cosmos_account_key: Optional[str] = None
    storage_account_key: Optional[str] = None
    storage_endpoint_suffix: str = "core.windows.net"

    def has_secret_values(self) -> bool:
        return any(
            value is not None and value.strip() not in ("", "<set-me>")
            for value in (
                self.cosmos_subscription_key,
                self.storage_subscription_key,
                self.cosmos_account_key,
                self.storage_account_key,
            )
        )

    @property
    def cosmos_endpoint(self) -> str:
        if not self.cosmos_api_base_url:
            return ""
        parsed = urlparse(self.cosmos_api_base_url)
        return f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else self.cosmos_api_base_url

    @property
    def storage_endpoint(self) -> str:
        if self.storage_api_base_url:
            parsed = urlparse(self.storage_api_base_url)
            if parsed.scheme and parsed.netloc:
                return f"{parsed.scheme}://{parsed.netloc}"
            return self.storage_api_base_url
        return f"https://{self.storage_account_name}.blob.{self.storage_endpoint_suffix}"


def _get_env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value is None:
        return default
    stripped = value.strip()
    return stripped or default


def get_azure_settings() -> AzureSettings:
    return AzureSettings(
        cosmos_api_base_url=_get_env("AZURE_COSMOS_API_BASE_URL") or _get_env("AZURE_COSMOS_ENDPOINT") or "",
        cosmos_subscription_key=_get_env("AZURE_COSMOS_SUBSCRIPTION_KEY") or _get_env("AZURE_COSMOS_ACCOUNT_KEY"),
        cosmos_database_name=_get_env("AZURE_COSMOS_DATABASE_NAME") or "medinspect-app-db",
        cosmos_results_database_name=_get_env("AZURE_COSMOS_RESULTS_DATABASE_NAME") or "medinspect-results-db",
        storage_api_base_url=_get_env("AZURE_STORAGE_API_BASE_URL") or _get_env("AZURE_STORAGE_ENDPOINT") or "",
        storage_subscription_key=_get_env("AZURE_STORAGE_SUBSCRIPTION_KEY") or _get_env("AZURE_STORAGE_ACCOUNT_KEY"),
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
        "AZURE_COSMOS_API_BASE_URL": settings.cosmos_api_base_url,
        "AZURE_COSMOS_DATABASE_NAME": settings.cosmos_database_name,
        "AZURE_COSMOS_RESULTS_DATABASE_NAME": settings.cosmos_results_database_name,
        "AZURE_STORAGE_API_BASE_URL": settings.storage_api_base_url,
        "AZURE_STORAGE_ACCOUNT_NAME": settings.storage_account_name,
        "AZURE_STORAGE_CONTAINER_PREFIX": settings.storage_container_prefix,
        "AZURE_MANAGED_IDENTITY_CLIENT_ID": settings.managed_identity_client_id,
    }
