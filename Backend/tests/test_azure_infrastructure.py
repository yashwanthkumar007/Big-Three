import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class AzureInfrastructureConfigTests(unittest.TestCase):
    def test_environment_settings_are_loaded_without_hardcoded_secrets(self):
        os.environ["AZURE_COSMOS_ENDPOINT"] = "https://example-cosmos.documents.azure.com:443/"
        os.environ["AZURE_COSMOS_DATABASE_NAME"] = "medinspect-db"
        os.environ["AZURE_STORAGE_ACCOUNT_NAME"] = "medinspectstorage"

        from src.config import AzureSettings, get_azure_settings

        settings = get_azure_settings()

        self.assertIsInstance(settings, AzureSettings)
        self.assertEqual(settings.cosmos_endpoint, "https://example-cosmos.documents.azure.com:443/")
        self.assertEqual(settings.cosmos_database_name, "medinspect-db")
        self.assertEqual(settings.storage_account_name, "medinspectstorage")

        self.assertFalse(settings.has_secret_values())


if __name__ == "__main__":
    unittest.main()
