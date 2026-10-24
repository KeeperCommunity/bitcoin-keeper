"""Security boundaries for the read-only release inventory; no release actions."""
import contextlib
import importlib.util
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location("inventory", pathlib.Path(__file__).with_name("cloud_release_inventory.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InventoryTests(unittest.TestCase):
    def test_release_secret_is_flagged_without_disclosure_and_debug_is_separate(self):
        text = """signingConfigs {
release {
storePassword 'synthetic-private-secret'
keyAlias 'synthetic-private-alias'
keyPassword System.getenv('KEY_PASSWORD')
}
debug { storePassword 'public-debug-secret' }
}"""
        findings = module.release_credential_literals(text)
        self.assertEqual(findings, [{"field": "storePassword", "line": 3}, {"field": "keyAlias", "line": 4}])
        self.assertNotIn("synthetic-private", json.dumps(findings))
        self.assertNotIn("public-debug", json.dumps(findings))

    def test_unreadable_signing_block_is_unknown(self):
        self.assertIsNone(module.release_credential_literals("release {"))
        self.assertIsNone(module.release_credential_literals("signingConfigs { release { storePassword 'secret'"))

    def test_missing_inventory_is_unknown_not_missing_credentials(self):
        result = module.environment_inventory(None)
        self.assertTrue(all(row["state"] == "UNKNOWN" for row in result))

    def test_named_environment_alone_never_proves_protection(self):
        result = module.environment_inventory({"environments": [{"name": name} for name in module.PROPOSED_ENVIRONMENTS]})
        self.assertTrue(all(row["state"] == "CONFIGURED_NOT_VERIFIED" for row in result))
        self.assertTrue(all(row["independent_reviewers"] == "NOT_VERIFIED" for row in result))

    def test_protection_metadata_never_becomes_release_permission(self):
        result = module.environment_inventory({"environments": [{
            "name": module.PROPOSED_ENVIRONMENTS[0],
            "protection_rules": [{"type": "required_reviewers", "prevent_self_review": True, "reviewers": [{"id": 1}]}],
            "deployment_branch_policy": {"custom_branch_policies": True},
            "unexpected_secret": "never-copy-me",
        }]})
        self.assertEqual(result[0]["independent_reviewers"], "PRESENT")
        self.assertEqual(result[0]["source_restriction"], "RESTRICTION_PRESENT_EXACT_RULES_UNVERIFIED")
        self.assertNotIn("never-copy-me", json.dumps(result))
        self.assertEqual(result[1]["state"], "NOT_CONFIGURED")

    def test_source_identity_and_no_false_execution_or_runtime_claim(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            subprocess.run(["git", "init", "-q", tmp], check=True)
            (root / "example.php").write_text("synthetic-only")
            subprocess.run(["git", "-C", tmp, "add", "example.php"], check=True)
            subprocess.run(["git", "-C", tmp, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture"], check=True)
            result = module.inventory(root)
            self.assertEqual(result["source_sha"], module.git(root, "rev-parse", "HEAD"))
            self.assertEqual(result["source_inventory"]["tracked_php_files"], 1)
            self.assertEqual(result["source_inventory"]["php_exposure"], "NOT_ESTABLISHED")
            self.assertFalse(result["execution_allowed"])
            self.assertEqual(result["credential_custody_and_authorization"], "UNKNOWN_NOT_INSPECTED")

    def test_invalid_metadata_does_not_echo_input_or_exception(self):
        with tempfile.TemporaryDirectory() as tmp:
            metadata = pathlib.Path(tmp) / "input.json"
            metadata.write_text('{"credential":"synthetic-do-not-print"')
            error = io.StringIO()
            with mock.patch.object(sys, "argv", ["inventory", "--environment-metadata", str(metadata)]), contextlib.redirect_stderr(error):
                with self.assertRaises(SystemExit) as raised:
                    module.main()
            self.assertEqual(raised.exception.code, 2)
            self.assertNotIn("synthetic-do-not-print", error.getvalue())
            self.assertNotIn(tmp, error.getvalue())


if __name__ == "__main__":
    unittest.main()
