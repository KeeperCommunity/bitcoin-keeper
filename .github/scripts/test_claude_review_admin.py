"""Offline administrator setup regressions; no network, credentials or provider."""

import base64
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


admin = load("claude_admin_subject", "claude_review_admin.py")
fixtures = load("claude_admin_state_fixtures", "test_claude_review_ledger.py")
WORKFLOW_SHA = "d" * 40
KEY = "offline-state-key-that-never-leaves-tests"


def environment():
    return {"GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_REPOSITORY": admin.REPOSITORY,
            "GITHUB_REF": "refs/heads/sprint", "GITHUB_SHA": WORKFLOW_SHA,
            "GITHUB_ACTOR": "original-admin", "GITHUB_TRIGGERING_ACTOR": "rerun-admin",
            "KEEPER_CLAUDE_REVIEW_ENABLED": "false", "KEEPER_CLAUDE_STATE_KEY": KEY,
            "KEEPER_CLAUDE_LEDGER_EPOCH": admin.EPOCH,
            "KEEPER_CLAUDE_LEDGER_APP_ID": str(admin.APP_ID),
            "KEEPER_CLAUDE_API_KEY_PRESENT": "true"}


def manifest():
    return json.loads(Path(__file__).with_name("claude_review_legacy.json").read_text())


class FakeCodeAPI:
    def __init__(self):
        self.calls = []
        self.permissions = {"original-admin": "admin", "rerun-admin": "admin"}
        self.sha = WORKFLOW_SHA
        self.bad_environment = False

    def request(self, origin, path, body=None, method=None, query=None):
        self.calls.append((origin, path, copy.deepcopy(body), method, query))
        if origin != "github" or body is not None or method is not None:
            raise AssertionError("Administrator code client is read-only and provider-free")
        if "/collaborators/" in path:
            return {"permission": self.permissions.get(path.split("/")[-2], "read")}
        if path.endswith("/git/ref/heads/sprint"):
            return {"ref": "refs/heads/sprint", "object": {"type": "commit", "sha": self.sha}}
        if path.endswith("/environments/keeper-claude-review"):
            return {"deployment_branch_policy": {"protected_branches": False,
                                                  "custom_branch_policies": not self.bad_environment}}
        if path.endswith("/deployment-branch-policies"):
            return {"total_count": 1, "branch_policies": [{"name": "sprint", "type": "branch"}]}
        raise AssertionError("Unexpected administrator code request")


class FakeStateAPI(fixtures.FakeStateAPI):
    def __init__(self):
        super().__init__(activated=False)
        self.tip = None
        self.main = admin.INITIAL_MAIN
        self.blobs = {}
        self.trees = {}
        self.bad_ack_path = None
        self.state_error = None
        self.race_main = False
        self.race_state = False
        self.uncertain_marker = False
        self.details[1]["bypass_actors"][0]["actor_id"] = admin.APP_ID
        raw = b"Public metadata-only ledger.\n"
        readme_sha = admin._object_sha("blob", raw)
        self.blobs[readme_sha] = raw
        entries = [{"path": "README.md", "type": "blob", "mode": "100644", "sha": readme_sha}]
        tree_sha = admin._tree_sha(entries)
        self.trees[tree_sha] = {"sha": tree_sha, "tree": entries, "truncated": False}
        self.commits[admin.INITIAL_MAIN] = {"sha": admin.INITIAL_MAIN,
                                           "tree": {"sha": tree_sha}, "parents": [], "message": "README"}

    def request(self, origin, path, body=None, method=None, query=None):
        self.calls.append((origin, path, copy.deepcopy(body), method, copy.deepcopy(query)))
        if origin != "github":
            raise AssertionError("Administrator must never request an Anthropic endpoint")
        if path == admin.STATE_ROOT + "/git/ref/heads/main":
            return {"ref": "refs/heads/main", "object": {"type": "commit", "sha": self.main}}
        if path == admin.STATE_ROOT + "/git/ref/heads/" + admin.ledger_module.STATE_BRANCH:
            if self.state_error is not None:
                raise admin.APIHTTPError("github", self.state_error)
            if self.tip is None:
                raise admin.APIHTTPError("github", 404)
            return {"ref": admin.STATE_REF, "object": {"type": "commit", "sha": self.tip}}
        if path == admin.STATE_ROOT + "/git/blobs" and method == "POST":
            raw = base64.b64decode(body["content"], validate=True)
            sha = admin._object_sha("blob", raw)
            self.blobs[sha] = raw
            return {"sha": "0" * 40 if self.bad_ack_path == path else sha}
        if path == admin.STATE_ROOT + "/git/trees" and method == "POST":
            entries = copy.deepcopy(self.trees[body["base_tree"]]["tree"]) if "base_tree" in body else []
            entries.extend(copy.deepcopy(body["tree"]))
            sha = admin._tree_sha(entries)
            response = {"sha": sha, "tree": entries, "truncated": False}
            self.trees[sha] = response
            return {"sha": "0" * 40} if self.bad_ack_path == path else copy.deepcopy(response)
        if path.startswith(admin.STATE_ROOT + "/git/trees/"):
            return copy.deepcopy(self.trees[path.rsplit("/", 1)[1]])
        if path == admin.STATE_ROOT + "/git/commits" and method == "POST":
            sha = hashlib.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()
            response = {"sha": sha, "message": body["message"], "tree": {"sha": body["tree"]},
                        "parents": [{"sha": value} for value in body["parents"]]}
            self.commits[sha] = response
            for entry in self.trees[body["tree"]]["tree"]:
                if entry["path"] == admin.ledger_module.STATE_FILE:
                    raw = self.blobs[entry["sha"]]
                    self.files[sha] = {"type": "file", "path": entry["path"], "sha": entry["sha"],
                                       "encoding": "base64", "size": len(raw),
                                       "content": base64.b64encode(raw).decode()}
            if self.bad_ack_path == path:
                return dict(response, parents=[{"sha": "f" * 40}])
            return copy.deepcopy(response)
        if path == admin.STATE_ROOT + "/git/refs" and method == "POST":
            if self.race_state:
                self.tip = "e" * 40
            if self.tip is not None:
                raise admin.APIHTTPError("github", 422)
            if body["ref"] != admin.STATE_REF:
                raise AssertionError("Bootstrap may create only the fixed state ref")
            self.tip = body["sha"]
            return {"ref": admin.STATE_REF, "object": {"type": "commit", "sha":
                    "f" * 40 if self.bad_ack_path == path else self.tip}}
        if path == admin.STATE_ROOT + "/git/refs/heads/main" and method == "PATCH":
            if body.get("force") is not False:
                raise AssertionError("Checkpoint ref must never be forced")
            if self.race_main:
                self.main = "e" * 40
            parents = self.commits[body["sha"]]["parents"]
            if parents != [{"sha": self.main}]:
                raise admin.APIHTTPError("github", 422)
            self.main = body["sha"]
            if self.uncertain_marker:
                raise TimeoutError("Untrusted echoed credentials must not appear in output")
            return {"ref": "refs/heads/main", "object": {"type": "commit", "sha":
                    "f" * 40 if self.bad_ack_path == path else self.main}}
        if path == admin.STATE_ROOT + "/contents/" + admin.CHECKPOINT_FILE:
            commit = self.commits[query["ref"]]
            entries = self.trees[commit["tree"]["sha"]]["tree"]
            entry = next((entry for entry in entries if entry["path"] == admin.CHECKPOINT_FILE), None)
            if entry is None:
                raise admin.APIHTTPError("github", 404)
            raw = self.blobs[entry["sha"]]
            return {"type": "file", "path": admin.CHECKPOINT_FILE, "sha": entry["sha"],
                    "encoding": "base64", "size": len(raw), "content": base64.b64encode(raw).decode()}
        return super().request(origin, path, body, method, query)

    def mutations(self):
        return [call for call in self.calls if call[3] in {"POST", "PATCH", "PUT", "DELETE"}]

    def ref_mutations(self):
        return [call for call in self.mutations() if "/git/refs" in call[1]]


class AdministratorTests(unittest.TestCase):
    def setUp(self):
        self.code = FakeCodeAPI()
        self.state = FakeStateAPI()
        self.env = environment()

    def initialize(self):
        return admin.initialize(self.code, self.state, self.env, manifest())

    def test_original_actor_and_rerun_actor_must_both_currently_be_admin(self):
        for denied in ("original-admin", "rerun-admin"):
            with self.subTest(denied=denied):
                self.code.permissions[denied] = "write"
                with self.assertRaises(admin.AdminError):
                    admin.preflight(self.code, self.state, self.env)
                self.code.permissions[denied] = "admin"
        self.assertEqual(self.state.calls, [])

    def test_wrong_event_repository_ref_and_stale_sprint_commit_fail_closed(self):
        for name, value in (("GITHUB_EVENT_NAME", "pull_request_target"),
                            ("GITHUB_REPOSITORY", "attacker/project"),
                            ("GITHUB_REF", "refs/tags/sprint"),
                            ("GITHUB_SHA", "a" * 40), ("GITHUB_TRIGGERING_ACTOR", "")):
            with self.subTest(name=name), self.assertRaises(admin.AdminError):
                admin.authorize(self.code, dict(self.env, **{name: value}))
        self.assertEqual(self.state.calls, [])

    def test_enabled_or_malformed_flag_rejects_before_environment_access(self):
        for flag in ("true", "False", "0", "false\n"):
            with self.subTest(flag=flag), self.assertRaises(admin.AdminError):
                admin.authorize(self.code, dict(self.env, KEEPER_CLAUDE_REVIEW_ENABLED=flag))
        self.assertEqual(self.code.calls, [])

    def test_preflight_requires_protected_values_and_boolean_not_provider_key(self):
        for name, value in (("KEEPER_CLAUDE_STATE_KEY", "short"),
                            ("KEEPER_CLAUDE_LEDGER_EPOCH", "0" * 32),
                            ("KEEPER_CLAUDE_LEDGER_APP_ID", "1"),
                            ("KEEPER_CLAUDE_API_KEY_PRESENT", "false"),
                            ("KEEPER_CLAUDE_API_KEY_PRESENT", "sk-secret"),
                            ("ANTHROPIC_API_KEY", "sk-secret"),
                            ("KEEPER_CLAUDE_API_KEY", "sk-secret")):
            with self.subTest(name=name, value=value), self.assertRaises(admin.AdminError):
                admin.preflight(self.code, self.state, dict(self.env, **{name: value}))
        self.assertEqual(self.state.calls, [])

    def test_preflight_checks_real_app_rules_environment_and_definitive_absence_without_writes(self):
        _, tip, sha = admin.preflight(self.code, self.state, self.env)
        self.assertIsNone(tip)
        self.assertEqual(sha, WORKFLOW_SHA)
        self.assertTrue(any("/rulesets/" in call[1] for call in self.state.calls))
        self.assertEqual(self.state.mutations(), [])
        self.state.state_error = 403
        with self.assertRaises(admin.APIHTTPError):
            admin.preflight(self.code, self.state, self.env)
        self.assertEqual(self.state.mutations(), [])

    def test_rule_bypass_and_unprotected_environment_are_rejected(self):
        self.state.details[2]["bypass_actors"] = [{"actor_type": "Integration", "actor_id": admin.APP_ID,
                                                  "bypass_mode": "always"}]
        with self.assertRaises(admin.reviewer.LedgerError):
            admin.preflight(self.code, self.state, self.env)
        self.assertEqual(self.state.mutations(), [])
        self.code.bad_environment = True
        with self.assertRaises(admin.reviewer.ReviewError):
            admin.preflight(self.code, self.state, self.env)

    def test_one_time_bootstrap_preserves_all_seven_legacy_claims_and_never_activates(self):
        self.assertEqual(self.initialize(), "BOOTSTRAP_COMPLETE_INACTIVE")
        document = self.state.document()
        self.assertEqual(len(document["attempts"]), 7)
        self.assertEqual({record["run"] for record in document["attempts"]}, admin.LEGACY_RUNS)
        self.assertTrue(all(record["legacy"] and record["status"] == "started" and
                            record["reservation"] == "3.00" for record in document["attempts"]))
        self.assertIs(document["production_verified"], False)
        self.assertIsNone(document["parent_commit"])
        self.assertEqual(self.state.commits[self.state.tip]["parents"], [])
        self.assertEqual(self.state.commits[self.state.main]["parents"], [{"sha": admin.INITIAL_MAIN}])
        self.assertEqual([call[3] for call in self.state.ref_mutations()], ["POST", "PATCH"])
        self.assertTrue(all(call[0] == "github" for call in self.code.calls + self.state.calls))
        self.assertNotIn(KEY, json.dumps(self.state.calls))

    def test_repeat_completed_bootstrap_is_read_only(self):
        self.initialize()
        original_tip, original_main = self.state.tip, self.state.main
        self.state.calls.clear()
        self.assertEqual(self.initialize(), "ALREADY_INITIALIZED_INACTIVE")
        self.assertEqual((self.state.tip, self.state.main), (original_tip, original_main))
        self.assertEqual(self.state.mutations(), [])

    def test_partial_root_can_only_finish_checkpoint_without_rewriting_state(self):
        self.state.race_main = True
        with self.assertRaises(admin.APIHTTPError):
            self.initialize()
        root = self.state.tip
        self.state.main = admin.INITIAL_MAIN
        self.state.race_main = False
        self.state.calls.clear()
        self.assertEqual(self.initialize(), "BOOTSTRAP_COMPLETE_INACTIVE")
        self.assertEqual(self.state.tip, root)
        self.assertEqual([call[3] for call in self.state.ref_mutations()], ["PATCH"])

    def test_existing_main_checkpoint_blocks_recreating_deleted_state(self):
        self.initialize()
        self.state.tip = None
        self.state.calls.clear()
        with self.assertRaises(admin.AdminError):
            self.initialize()
        self.assertEqual(self.state.mutations(), [])

    def test_existing_progressed_or_other_initial_state_cannot_be_reset(self):
        self.initialize()
        doc = self.state.document()
        doc["attempts"].append(dict(doc["attempts"][0], id="f" * 32,
                                    request="audit-" + "f" * 40, run="999"))
        doc["revision"] += 1
        doc = admin.ledger_module.signed_document(doc, KEY, admin.REPOSITORY, admin.EPOCH)
        self.state.replace_document(doc, signed=False)
        self.state.calls.clear()
        with self.assertRaises(admin.AdminError):
            self.initialize()
        self.assertEqual(self.state.mutations(), [])

    def test_invalid_signature_never_becomes_empty_state_or_resets_history(self):
        self.initialize()
        doc = self.state.document()
        doc["signature"] = "0" * 64
        self.state.replace_document(doc, signed=False)
        self.state.calls.clear()
        with self.assertRaises(admin.reviewer.LedgerError):
            self.initialize()
        self.assertEqual(self.state.mutations(), [])

    def test_full_orphan_import_validation_occurs_before_creating_git_objects(self):
        document = admin.ledger_module.imported_document(admin.REPOSITORY, admin.EPOCH, KEY,
                                                         manifest()["attempts"])
        document["revision"] += 1
        document = admin.ledger_module.signed_document(document, KEY, admin.REPOSITORY, admin.EPOCH)
        with patch.object(admin.ledger_module, "imported_document", return_value=document):
            with self.assertRaises(admin.reviewer.LedgerError):
                self.initialize()
        self.assertEqual(self.state.mutations(), [])

    def test_fixed_import_refuses_missing_or_repeated_debt_and_invented_unknown_heads(self):
        for mutate in (lambda data: data["attempts"].pop(),
                       lambda data: data["attempts"].__setitem__(0, copy.deepcopy(data["attempts"][1])),
                       lambda data: data["attempts"][0].update(head="a" * 40),
                       lambda data: data.update(excluded_no_call_runs=[])):
            data = manifest()
            mutate(data)
            with self.assertRaises((admin.AdminError, admin.reviewer.LedgerError)):
                admin.initialize(self.code, self.state, self.env, data)
        self.assertEqual(self.state.mutations(), [])

    def test_authority_is_rechecked_after_object_creation_before_state_ref_creation(self):
        original_request = self.state.request

        def request(origin, path, body=None, method=None, query=None):
            response = original_request(origin, path, body, method, query)
            if path == admin.STATE_ROOT + "/git/commits" and method == "POST":
                self.code.permissions["rerun-admin"] = "read"
            return response

        self.state.request = request
        with self.assertRaises(admin.AdminError):
            self.initialize()
        self.assertEqual(self.state.ref_mutations(), [])
        self.assertIsNone(self.state.tip)

    def test_live_sprint_drift_after_object_creation_prevents_initial_ref_creation(self):
        original_request = self.state.request

        def request(origin, path, body=None, method=None, query=None):
            response = original_request(origin, path, body, method, query)
            if path == admin.STATE_ROOT + "/git/commits" and method == "POST":
                self.code.sha = "a" * 40
            return response

        self.state.request = request
        with self.assertRaises(admin.AdminError):
            self.initialize()
        self.assertEqual(self.state.ref_mutations(), [])

    def test_bad_blob_tree_commit_and_ref_acknowledgements_never_continue(self):
        for path in ("/git/blobs", "/git/trees", "/git/commits", "/git/refs"):
            with self.subTest(path=path):
                self.state = FakeStateAPI()
                self.state.bad_ack_path = admin.STATE_ROOT + path
                with self.assertRaises(admin.AdminError):
                    self.initialize()
                self.assertEqual(self.state.main, admin.INITIAL_MAIN)
                if path != "/git/refs":
                    self.assertIsNone(self.state.tip)

    def test_concurrent_main_update_is_not_overwritten_by_marker(self):
        self.state.race_main = True
        with self.assertRaises(admin.APIHTTPError):
            self.initialize()
        self.assertEqual(self.state.main, "e" * 40)
        self.assertIsNotNone(self.state.tip)
        self.assertIs(self.state.document()["production_verified"], False)

    def test_concurrent_state_creation_is_not_reset_or_forced(self):
        self.state.race_state = True
        with self.assertRaises(admin.APIHTTPError):
            self.initialize()
        self.assertEqual(self.state.tip, "e" * 40)
        self.assertEqual(self.state.main, admin.INITIAL_MAIN)
        self.assertEqual([call[3] for call in self.state.ref_mutations()], ["POST"])

    def test_uncertain_checkpoint_write_does_not_retry_or_touch_state(self):
        self.state.uncertain_marker = True
        with self.assertRaises(TimeoutError):
            self.initialize()
        self.assertEqual([call[3] for call in self.state.ref_mutations()], ["POST", "PATCH"])
        self.assertIs(self.state.document()["production_verified"], False)

    def test_cli_denial_exits_nonzero_without_authorized_output_or_exception_data(self):
        self.code.permissions["rerun-admin"] = "read"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "github-output"
            env = dict(self.env, GITHUB_TOKEN="offline-code-token", GITHUB_OUTPUT=str(output))
            logs = io.StringIO()
            with patch.dict(os.environ, env, clear=True), patch.object(admin, "API", return_value=self.code), \
                    patch("sys.stdout", logs):
                self.assertEqual(admin.main(["--authorize"]), 1)
            self.assertFalse(output.exists())
            self.assertEqual(logs.getvalue(), "ADMINISTRATOR_SETUP_BLOCKED_NO_PROVIDER_NO_AUTOMATIC_RETRY\n")

    def test_cli_authorization_outputs_only_fixed_true_and_never_binds_provider(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "github-output"
            env = dict(self.env, GITHUB_TOKEN="offline-code-token", GITHUB_OUTPUT=str(output))
            with patch.dict(os.environ, env, clear=True), patch.object(admin, "API", return_value=self.code) as api, \
                    patch("sys.stdout", io.StringIO()):
                self.assertEqual(admin.main(["--authorize"]), 0)
            self.assertEqual(output.read_text(), "authorized=true\n")
            api.assert_called_once_with("offline-code-token", "")


if __name__ == "__main__":
    unittest.main()
