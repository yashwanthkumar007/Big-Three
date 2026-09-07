import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.resource_schema import get_resource_schema, validate_resource_payload


class ResourceSchemaTests(unittest.TestCase):
    def test_user_schema_requires_expected_fields(self):
        schema = get_resource_schema("users")
        self.assertIn("username", schema["required"])
        self.assertIn("email", schema["required"])

        payload = {
            "id": "user-123",
            "username": "demo.user",
            "email": "demo@example.com",
            "firstName": "Demo",
            "lastName": "User",
            "accountType": "User",
            "accountStatus": "Active",
            "company": "MedInspect",
            "createdAt": "2026-09-02T00:00:00Z",
            "emailNotificationEnabled": True,
        }
        validated = validate_resource_payload("users", payload)
        self.assertEqual(validated["id"], "user-123")
        self.assertEqual(validated["company"], "MedInspect")

    def test_document_schema_rejects_missing_required_fields(self):
        with self.assertRaises(ValueError):
            validate_resource_payload("documents", {"id": "doc-1"})

    def test_result_schema_accepts_nested_findings(self):
        payload = {
            "id": "result-1",
            "inspectionId": "inspection-42",
            "documentId": "doc-1",
            "status": "completed",
            "summary": {"totalFindings": 3, "critical": 1},
            "findings": [
                {"id": "f-1", "type": "Change", "page": 1, "master": "A", "sample": "B", "comment": "Mismatch"}
            ],
            "createdAt": "2026-09-02T00:00:00Z",
        }
        validated = validate_resource_payload("results", payload)
        self.assertEqual(validated["inspectionId"], "inspection-42")
        self.assertEqual(validated["findings"][0]["type"], "Change")

    def test_users_create_payload_without_created_at_is_normalized(self):
        payload = {
            "username": "new.user",
            "email": "new.user@example.com",
            "firstName": "New",
            "lastName": "User",
            "accountType": "User",
            "accountStatus": "Active",
        }
        validated = validate_resource_payload("users", payload)
        self.assertIn("createdAt", validated)
        self.assertTrue(validated["createdAt"].endswith("Z"))


if __name__ == "__main__":
    unittest.main()
