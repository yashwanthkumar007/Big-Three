import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.azure_service import _get_cosmos_url, _get_subscription_headers
from src.resource_schema import normalize_resource_payload


class AzureInfrastructureConfigTests(unittest.TestCase):
    def test_environment_settings_are_loaded_without_hardcoded_secrets(self):
        os.environ["AZURE_COSMOS_API_BASE_URL"] = "https://emtech-apim-all-all-poc.azure-api.net/cosmos/docs"
        os.environ["AZURE_COSMOS_SUBSCRIPTION_KEY"] = "demo-cosmos-key"
        os.environ["AZURE_STORAGE_API_BASE_URL"] = "https://emtech-apim-all-all-poc.azure-api.net/storage/hackathon/{custom_folder_name}/{file_name}"
        os.environ["AZURE_STORAGE_SUBSCRIPTION_KEY"] = "demo-storage-key"

        from src.config import AzureSettings, get_azure_settings

        settings = get_azure_settings()

        self.assertIsInstance(settings, AzureSettings)
        self.assertEqual(settings.cosmos_api_base_url, "https://emtech-apim-all-all-poc.azure-api.net/cosmos/docs")
        self.assertEqual(settings.storage_api_base_url, "https://emtech-apim-all-all-poc.azure-api.net/storage/hackathon/{custom_folder_name}/{file_name}")
        self.assertEqual(settings.cosmos_endpoint, "https://emtech-apim-all-all-poc.azure-api.net")
        self.assertEqual(settings.storage_endpoint, "https://emtech-apim-all-all-poc.azure-api.net")
        self.assertEqual(settings.storage_subscription_key, "demo-storage-key")
        self.assertEqual(settings.cosmos_subscription_key, "demo-cosmos-key")
        self.assertTrue(settings.has_secret_values())

    def test_cosmos_route_uses_document_and_query_paths(self):
        from src.config import AzureSettings

        settings = AzureSettings(
            cosmos_api_base_url="https://emtech-apim-all-all-poc.azure-api.net/cosmos/docs",
            cosmos_subscription_key="demo-cosmos-key",
            cosmos_database_name="medinspect-app-db",
        )

        self.assertEqual(
            _get_cosmos_url(settings, collection_name="users"),
            "https://emtech-apim-all-all-poc.azure-api.net/cosmos/docs",
        )
        self.assertEqual(
            _get_cosmos_url(settings, collection_name="users", document_id="abc-123"),
            "https://emtech-apim-all-all-poc.azure-api.net/cosmos/docs/abc-123",
        )
        self.assertEqual(
            _get_cosmos_url(settings, collection_name="users", query=True),
            "https://emtech-apim-all-all-poc.azure-api.net/cosmos/docs/query",
        )

    def test_subscription_headers_include_partition_key(self):
        from src.config import AzureSettings

        settings = AzureSettings(
            cosmos_api_base_url="https://emtech-apim-all-all-poc.azure-api.net/cosmos/docs",
            cosmos_subscription_key="demo-cosmos-key",
        )

        headers = _get_subscription_headers(settings, is_storage=False, partition_key='["users"]')
        self.assertEqual(headers["x-ms-documentdb-partitionkey"], '["users"]')

    def test_user_payload_is_given_cosmos_document_id(self):
        payload = normalize_resource_payload(
            "users",
            {
                "username": "demo.user",
                "email": "demo@example.com",
                "firstName": "Demo",
                "lastName": "User",
                "accountType": "User",
                "accountStatus": "Active",
            },
        )

        self.assertIn("id", payload)
        self.assertTrue(payload["id"])
        self.assertIn("createdAt", payload)


if __name__ == "__main__":
    unittest.main()


if __name__ == "__main__":
    unittest.main()
