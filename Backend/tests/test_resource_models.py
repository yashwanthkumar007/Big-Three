import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.resource_models import get_resource_model, get_seed_payload


class ResourceModelTests(unittest.TestCase):
    def test_users_model_contains_seed_and_index(self):
        model = get_resource_model("users")
        self.assertIn("username", model["example"])
        self.assertGreater(len(model["indexes"]), 0)

    def test_seed_payload_is_generated_for_results(self):
        payload = get_seed_payload("results", identifier="result_seed_1")
        self.assertEqual(payload["id"], "result_seed_1")
        self.assertIn("findings", payload)


if __name__ == "__main__":
    unittest.main()
