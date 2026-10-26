"""Controls for rejecting unsafe administrator metadata, without service calls."""
import copy
import json
import unittest
from cloud_release_environment_setup import payload, verify, unique_object


class EnvironmentSetupTests(unittest.TestCase):
    def metadata(self):
        return {"name": "keeper-release-ios", "can_admins_bypass": False,
                "protection_rules": [{"type": "required_reviewers", "prevent_self_review": True,
                                      "reviewers": [{"type": "User", "reviewer": {"id": 123}}]}],
                "deployment_branch_policy": {"protected_branches": True, "custom_branch_policies": False}}

    def test_payload_uses_api_write_shape_and_no_default_reviewer(self):
        p = payload("User", 123)
        self.assertEqual(p["reviewers"], [{"type": "User", "id": 123}])
        self.assertNotIn("protection_rules", p)
        self.assertFalse(p["can_admins_bypass"])
        self.assertTrue(p["prevent_self_review"])
        for invalid in (0, -1, True, "123"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                payload("User", invalid)

    def test_exact_metadata_still_grants_no_execution_or_enforcement(self):
        r = verify(self.metadata(), "keeper-release-ios", "User", 123)
        self.assertTrue(r["metadata_verified"])
        self.assertFalse(r["execution_allowed"])
        self.assertFalse(r["enforcement_verified"])

    def test_default_policy_does_not_require_a_human_reviewer(self):
        self.assertEqual(payload()["reviewers"], [])
        m = self.metadata(); m["protection_rules"] = []
        result = verify(m, "keeper-release-ios")
        self.assertTrue(result["metadata_verified"])
        self.assertFalse(result["human_review_required"])

    def test_unknown_rule_metadata_is_not_an_optional_empty_rule_list(self):
        for rules in (None, {}, "", False):
            m = self.metadata(); m["protection_rules"] = rules
            with self.subTest(rules=rules):
                self.assertFalse(verify(m, "keeper-release-ios")["metadata_verified"])
        m = self.metadata(); del m["protection_rules"]
        self.assertFalse(verify(m, "keeper-release-ios")["metadata_verified"])

    def test_each_required_boundary_rejects(self):
        bad = []
        for key, value in [("name", "Env"), ("can_admins_bypass", True), ("can_admins_bypass", None),
                           ("protection_rules", []), ("deployment_branch_policy", None),
                           ("deployment_branch_policy", {"protected_branches": False, "custom_branch_policies": True})]:
            m = self.metadata(); m[key] = value; bad.append(m)
        for key, value in [("prevent_self_review", False), ("reviewers", []),
                           ("reviewers", [{"type": "User", "reviewer": {"id": 124}}]),
                           ("reviewers", [{"type": "Team", "reviewer": {"id": 123}}]),
                           ("reviewers", [{"type": "User", "reviewer": {"id": True}}])]:
            m = self.metadata(); m["protection_rules"][0][key] = value; bad.append(m)
        m = self.metadata(); m["protection_rules"].append(copy.deepcopy(m["protection_rules"][0])); bad.append(m)
        for m in bad:
            with self.subTest(metadata=m):
                self.assertFalse(verify(m, "keeper-release-ios", "User", 123)["metadata_verified"])

    def test_duplicate_json_key_rejects(self):
        with self.assertRaises(ValueError):
            json.loads('{"can_admins_bypass":true,"can_admins_bypass":false}', object_pairs_hook=unique_object)
