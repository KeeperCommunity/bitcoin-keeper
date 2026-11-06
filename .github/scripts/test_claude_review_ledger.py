"""Offline payment-ledger regressions; no network or paid requests are made."""

import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "claude_review_ledger_test_subject", Path(__file__).with_name("claude_review_ledger.py")
)
ledger_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ledger_module)
FLOW_SPEC = importlib.util.spec_from_file_location(
    "claude_review_flow_test_fixtures", Path(__file__).with_name("test_claude_review.py")
)
flow = importlib.util.module_from_spec(FLOW_SPEC)
FLOW_SPEC.loader.exec_module(flow)

REPO = flow.REPO
HEAD = flow.HEAD
BASE = flow.BASE
NEXT_HEAD = flow.NEXT_HEAD
NEXT_BASE = flow.NEXT_BASE
KEY = flow.STATE_KEY
EPOCH = "1" * 32
APP_ID = 5313951
STATE_REPO = ledger_module.STATE_REPOSITORY
STATE_REPO_ID = 1416741877
STATE_BRANCH = ledger_module.STATE_BRANCH
ROOT = f"/repos/{STATE_REPO}"


def claim(request="comment-123", head=HEAD, base=BASE):
    return {"request": request, "head": head, "base": base,
            "status": "started", "run": "12345"}


def legacy_record(number=1, head=None, base=None, pr=7049):
    return dict(claim(f"audit-{number:040x}", head, base), id=f"{number:032x}",
                pr=pr, reservation="3.00", legacy=True)


def git_blob_sha(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


class FakeStateAPI:
    """Contents CAS and Git ancestry double for the public metadata-only ledger."""

    def __init__(self, activated=True):
        self.calls = []
        self.counter = 0
        self.commits = {}
        self.files = {}
        self.fail_paths = set()
        self.fail_write = False
        self.uncertain_write = False
        self.conflict = False
        self.bad_acknowledgement = False
        self.bad_write_parent = False
        self.contents_overrides = {}
        self.installation = {"total_count": 1,
                             "repositories": [{"id": STATE_REPO_ID, "full_name": STATE_REPO, "private": False,
                                               "visibility": "public"}]}
        self.repository = {"id": STATE_REPO_ID, "full_name": STATE_REPO, "private": False, "visibility": "public",
                           "fork": False, "archived": False, "disabled": False}
        self.source_repository = {"full_name": REPO, "private": False, "visibility": "public"}
        self.rulesets = [
            {"id": 1, "target": "branch", "enforcement": "active", "source_type": "Repository"},
            {"id": 2, "target": "branch", "enforcement": "active", "source_type": "Repository"},
        ]
        condition = {"ref_name": {"include": [f"refs/heads/{STATE_BRANCH}"], "exclude": []}}
        self.details = {
            1: {"id": 1, "target": "branch", "enforcement": "active",
                "conditions": copy.deepcopy(condition),
                "bypass_actors": [{"actor_id": APP_ID, "actor_type": "Integration", "bypass_mode": "always"}],
                "rules": [{"type": "creation"}, {"type": "update"}]},
            2: {"id": 2, "target": "branch", "enforcement": "active",
                "conditions": copy.deepcopy(condition), "bypass_actors": [],
                "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}]},
        }
        self.effective = [{"type": rule["type"], "ruleset_id": ruleset_id}
                          for ruleset_id, detail in self.details.items() for rule in detail["rules"]]
        document = ledger_module.initial_document(REPO, EPOCH, KEY)
        self.tip = self.commit(document, [])
        self.initial_tip = self.tip
        if activated:
            document.update(production_verified=True, revision=1, parent_commit=self.tip)
            document = ledger_module.signed_document(document, KEY, REPO, EPOCH)
            self.tip = self.commit(document, [self.tip])

    def commit(self, document, parents):
        raw = ledger_module.canonical(document).encode()
        self.counter += 1
        sha = hashlib.sha1((str(self.counter) + json.dumps(parents)).encode() + raw).hexdigest()
        self.commits[sha] = {"sha": sha, "parents": [{"sha": parent} for parent in parents]}
        self.files[sha] = {"type": "file", "path": ledger_module.STATE_FILE,
                           "sha": git_blob_sha(raw), "encoding": "base64", "size": len(raw),
                           "content": base64.b64encode(raw).decode()}
        return sha

    def document(self):
        return json.loads(base64.b64decode(self.files[self.tip]["content"]))

    def replace_document(self, document, signed=False):
        """Administrator-like fixture mutation of authenticated contents at the tip."""
        if signed:
            document = ledger_module.signed_document(document, KEY, REPO, EPOCH)
        raw = ledger_module.canonical(document).encode()
        self.files[self.tip].update(content=base64.b64encode(raw).decode(), size=len(raw), sha=git_blob_sha(raw))

    def request(self, origin, path, body=None, method=None, query=None):
        self.calls.append((origin, path, copy.deepcopy(body), method, copy.deepcopy(query)))
        if origin != "github":
            raise AssertionError("The state client must never call a paid/model endpoint")
        if path in self.fail_paths:
            raise RuntimeError("Offline API failure containing an untrusted response body")
        if path == "/installation/repositories":
            return copy.deepcopy(self.installation)
        if path == ROOT:
            return copy.deepcopy(self.repository)
        if path == f"/repos/{REPO}":
            return copy.deepcopy(self.source_repository)
        if path == ROOT + "/rulesets":
            return copy.deepcopy(self.rulesets)
        if path.startswith(ROOT + "/rulesets/"):
            return copy.deepcopy(self.details[int(path.rsplit("/", 1)[1])])
        if path == ROOT + f"/rules/branches/{STATE_BRANCH}":
            return copy.deepcopy(self.effective)
        if path == ROOT + f"/git/ref/heads/{STATE_BRANCH}":
            return {"ref": f"refs/heads/{STATE_BRANCH}", "object": {"type": "commit", "sha": self.tip}}
        if path.startswith(ROOT + "/git/commits/"):
            return copy.deepcopy(self.commits[path.rsplit("/", 1)[1]])
        if path == ROOT + f"/contents/{ledger_module.STATE_FILE}":
            if body is None:
                result = copy.deepcopy(self.files[query["ref"]])
                result.update(copy.deepcopy(self.contents_overrides))
                return result
            if method != "PUT" or body.get("branch") != STATE_BRANCH:
                raise AssertionError("Unexpected state mutation")
            if self.fail_write:
                raise RuntimeError("Offline failed write")
            if self.conflict or body["sha"] != self.files[self.tip]["sha"]:
                raise RuntimeError("Offline Contents API 409 compare-and-swap conflict")
            document = json.loads(base64.b64decode(body["content"]))
            parents = ["f" * 40] if self.bad_write_parent else [self.tip]
            self.tip = self.commit(document, parents)
            if self.uncertain_write:
                raise TimeoutError("Write might have succeeded; do not retry")
            return {"commit": {"sha": self.tip},
                    "content": {"sha": "0" * 40 if self.bad_acknowledgement else self.files[self.tip]["sha"]}}
        raise AssertionError(f"Unexpected protected-state request: {path} {method}")

    def writes(self):
        return [call for call in self.calls if call[3] == "PUT"]


class LedgerBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeStateAPI()
        self.subject = ledger_module.Ledger(self.api, REPO, EPOCH, KEY, APP_ID)

    def make_ledger(self, api=None, **kwargs):
        return ledger_module.Ledger(api or self.api, kwargs.get("repo", REPO),
                                    kwargs.get("epoch", EPOCH), kwargs.get("key", KEY),
                                    kwargs.get("app_id", APP_ID))

    def test_matching_substitute_app_and_scoped_installation_cannot_replace_pinned_identity(self):
        self.assertEqual(ledger_module.STATE_APP_ID, 5313951)
        for substitute in (1, APP_ID + 1, str(APP_ID), float(APP_ID), True, None):
            with self.subTest(app_id=substitute):
                state_api = FakeStateAPI()
                # The substitute has the correct repository scope and a matching
                # bypass rule. Neither can override the trusted App identity.
                state_api.details[1]["bypass_actors"][0]["actor_id"] = substitute
                api = flow.FakeAPI()
                with self.assertRaisesRegex(ledger_module.LedgerError, "pinned State App identity"):
                    ledger = ledger_module.Ledger(state_api, REPO, EPOCH, KEY, substitute)
                    flow.reviewer.Reviewer(api, REPO, 7049, "12345", ledger=ledger).review()
                self.assertEqual(state_api.calls, [])
                self.assertEqual(state_api.writes(), [])
                self.assertEqual(api.paid_calls(), [])

    def test_atomic_claim_is_durable_before_completion_and_full_cost_is_retained(self):
        claim_id = self.subject.reserve(7049, claim())
        record = self.subject.states(7049)[0]
        self.assertEqual(record["id"], claim_id)
        self.assertEqual(record["reservation"], "3.00")
        self.assertEqual(record["status"], "started")
        self.subject.complete(7049, claim_id, "complete")
        complete = self.subject.states(7049)[0]
        self.assertEqual(complete["status"], "complete")
        self.assertEqual(complete["reservation"], "3.00")
        self.assertEqual(self.api.document()["revision"], 3)
        self.assertEqual(len(self.api.writes()), 2)
        writes = self.api.writes()
        self.assertNotEqual(writes[0][2]["sha"], writes[1][2]["sha"])
        self.assertTrue(all(call[4]["ref"] in self.api.commits for call in self.api.calls
                            if "/contents/" in call[1] and call[2] is None))

    def test_deleting_pr_comments_cannot_affect_authoritative_deduplication(self):
        claim_id = self.subject.reserve(7049, claim("auto"))
        self.subject.complete(7049, claim_id, "complete")
        self.assertEqual(len(self.subject.states(7049)), 1)
        with self.assertRaises(ledger_module.LedgerError):
            self.subject.reserve(7049, claim("auto", NEXT_HEAD))
        self.assertEqual(len(self.api.writes()), 2)
        self.assertFalse(any("issues" in call[1] for call in self.api.calls))

    def test_manual_requests_cannot_exceed_two_attempts_for_exact_head(self):
        for request in ("comment-123", "comment-124"):
            claim_id = self.subject.reserve(7049, claim(request))
            self.subject.complete(7049, claim_id, "incomplete")
        with self.assertRaisesRegex(ledger_module.LedgerError, "head review budget exhausted"):
            self.subject.reserve(7049, claim("comment-125", base=NEXT_BASE))
        self.assertEqual(len(self.subject.states(7049)), 2)
        self.assertTrue(all(record["reservation"] == "3.00" for record in self.subject.states(7049)))

    def test_new_heads_do_not_reset_three_attempt_per_pr_limit(self):
        for request, head in (("comment-123", HEAD), ("comment-124", NEXT_HEAD), ("comment-125", "2" * 40)):
            claim_id = self.subject.reserve(7049, claim(request, head))
            self.subject.complete(7049, claim_id, "stale")
        with self.assertRaisesRegex(ledger_module.LedgerError, "PR review budget exhausted"):
            self.subject.reserve(7049, claim("comment-126", "3" * 40))
        self.assertEqual(len(self.subject.states(7049)), 3)
        self.subject.reserve(7050, claim("comment-126", "3" * 40))
        self.assertEqual(len(self.subject.states(7050)), 1)

    def test_same_request_cannot_replay_even_after_head_and_base_change(self):
        self.subject.reserve(7049, claim())
        with self.assertRaisesRegex(ledger_module.LedgerError, "already reserved"):
            self.subject.reserve(7049, claim(head=NEXT_HEAD, base=NEXT_BASE))
        self.assertEqual(len(self.api.writes()), 1)

    def test_complete_head_base_pair_is_reused_by_new_manual_command(self):
        claim_id = self.subject.reserve(7049, claim())
        self.subject.complete(7049, claim_id, "complete")
        with self.assertRaisesRegex(ledger_module.LedgerError, "already reserved"):
            self.subject.reserve(7049, claim("comment-124"))
        self.assertEqual(len(self.api.writes()), 2)

    def test_api_key_rotation_preserves_state_key_history_and_reservations(self):
        self.subject.reserve(7049, claim("auto"))
        reloaded = self.make_ledger()
        self.assertEqual(reloaded.states(7049), self.subject.states(7049))
        with self.assertRaises(ledger_module.LedgerError):
            reloaded.reserve(7049, claim("auto", NEXT_HEAD))
        self.assertEqual(len(self.api.writes()), 1)

    def test_empty_orphan_bootstrap_is_readable_but_not_authorized_for_payment(self):
        api = FakeStateAPI(activated=False)
        subject = self.make_ledger(api)
        self.assertEqual(subject.states(7049), [])
        self.assertFalse(api.document()["production_verified"])
        with self.assertRaisesRegex(ledger_module.LedgerError, "production security verification"):
            subject.reserve(7049, claim())
        self.assertEqual(api.writes(), [])

    def test_unverified_imported_legacy_history_is_preserved_but_cannot_pay(self):
        document = self.api.document()
        document["attempts"] = [dict(claim(f"audit-{n:040x}"), id=f"{n:032x}", pr=7049,
                                     reservation="3.00", status="complete") for n in range(1, 5)]
        document["revision"] = 8
        document["production_verified"] = False
        self.api.replace_document(document, signed=True)
        self.assertEqual(len(self.subject.states(7049)), 4)
        with self.assertRaises(ledger_module.LedgerError):
            self.subject.reserve(7049, claim("comment-126", NEXT_HEAD))
        self.assertEqual(self.api.writes(), [])

    def test_migrated_history_over_limit_is_readable_and_refuses_new_spending(self):
        document = self.api.document()
        document["attempts"] = [dict(claim(f"audit-{n:040x}"), id=f"{n:032x}", pr=7049,
                                     reservation="3.00", status="complete") for n in range(1, 5)]
        document["revision"] = 9
        self.api.replace_document(document, signed=True)
        self.assertEqual(len(self.subject.states(7049)), 4)
        with self.assertRaisesRegex(ledger_module.LedgerError, "PR review budget exhausted"):
            self.subject.reserve(7049, claim("comment-126", NEXT_HEAD))
        self.assertEqual(self.api.writes(), [])
        self.subject.reserve(7050, claim())
        self.assertEqual(len(self.subject.states(7050)), 1)

    def test_missing_branch_or_file_fails_closed_without_initialization(self):
        for path in (ROOT + f"/git/ref/heads/{STATE_BRANCH}", ROOT + "/contents/ledger.json"):
            with self.subTest(path=path):
                api = FakeStateAPI()
                subject = self.make_ledger(api)
                api.fail_paths.add(path)
                with self.assertRaises(ledger_module.LedgerError):
                    subject.reserve(7049, claim())
                self.assertEqual(api.writes(), [])

    def test_corrupt_state_signature_or_wrong_epoch_requires_recovery(self):
        changes = [{"signature": "0" * 64}, {"epoch": "2" * 32}, {"repository": "attacker/repo"},
                   {"production_verified": "true"}, {"revision": 0}, {"unexpected": "field"}]
        for change in changes:
            with self.subTest(change=change):
                api = FakeStateAPI()
                subject = self.make_ledger(api)
                document = api.document()
                document.update(change)
                api.replace_document(document, signed=True if "signature" not in change else False)
                with self.assertRaises(ledger_module.LedgerError):
                    subject.reserve(7049, claim())
                self.assertEqual(api.writes(), [])

    def test_missing_short_or_rotated_signing_key_does_not_reset_state(self):
        for key in ("", "x" * 31, "rotated-independent-state-signing-key"):
            with self.subTest(length=len(key)):
                with self.assertRaises(ledger_module.LedgerError):
                    self.make_ledger(key=key).reserve(7049, claim())
        self.assertEqual(self.api.writes(), [])

    def test_public_ledger_installation_token_single_repo_scope_is_required(self):
        invalid = [
            {"total_count": 0, "repositories": []},
            {"total_count": 2, "repositories": [{"id": STATE_REPO_ID, "full_name": STATE_REPO, "private": False,
                                                "visibility": "public"}]},
            {"total_count": True, "repositories": [{"id": STATE_REPO_ID, "full_name": STATE_REPO, "private": False,
                                                   "visibility": "public"}]},
            {"total_count": 1, "repositories": [{"id": STATE_REPO_ID, "full_name": REPO, "private": False,
                                                "visibility": "public"}]},
            {"total_count": 1, "repositories": [{"id": STATE_REPO_ID, "full_name": STATE_REPO, "private": True,
                                                "visibility": "private"}]},
            {"total_count": 1, "repositories": [{"id": STATE_REPO_ID, "full_name": STATE_REPO, "private": False}]},
            {"total_count": 1, "repositories": [{"id": STATE_REPO_ID, "full_name": STATE_REPO, "private": 0,
                                                "visibility": "public"}]},
            {"total_count": 1, "repositories": [{"id": STATE_REPO_ID, "full_name": STATE_REPO, "private": False,
                                                "visibility": "internal"}]},
            {"total_count": 1, "repositories": [{"id": STATE_REPO_ID, "full_name": STATE_REPO, "private": False,
                                                "visibility": "public"},
                                               {"full_name": REPO, "private": False,
                                                "visibility": "public"}]},
            {"total_count": 1, "repositories": {}},
            {"total_count": 1, "repositories": [None]},
            {"total_count": 1, "repositories": [{"id": STATE_REPO_ID + 1, "full_name": STATE_REPO,
                                                "private": False, "visibility": "public"}]},
            {"total_count": 1, "repositories": [{"id": True, "full_name": STATE_REPO,
                                                "private": False, "visibility": "public"}]},
            {"total_count": 1, "repositories": [{"id": str(STATE_REPO_ID), "full_name": STATE_REPO,
                                                "private": False, "visibility": "public"}]},
            {"total_count": 1, "repositories": [{"full_name": STATE_REPO,
                                                "private": False, "visibility": "public"}]},
        ]
        for installation in invalid:
            with self.subTest(installation=installation):
                api = FakeStateAPI()
                api.installation = installation
                with self.assertRaises(ledger_module.LedgerError):
                    self.make_ledger(api)
                self.assertEqual(api.writes(), [])

    def test_ledger_metadata_must_identify_active_public_nonfork_repository(self):
        changes = [{"id": STATE_REPO_ID + 1}, {"id": True}, {"id": str(STATE_REPO_ID)},
                   {"full_name": REPO}, {"private": True}, {"private": 0},
                   {"visibility": "private"}, {"visibility": "internal"},
                   {"fork": True}, {"fork": None}, {"archived": True},
                   {"archived": 0}, {"disabled": True}, {"disabled": None}]
        for change in changes:
            with self.subTest(change=change):
                api = FakeStateAPI()
                api.repository.update(change)
                with self.assertRaises(ledger_module.LedgerError):
                    self.make_ledger(api)
                self.assertEqual(api.writes(), [])
        for field in ("id", "full_name", "private", "visibility", "fork", "archived", "disabled"):
            with self.subTest(missing=field):
                api = FakeStateAPI()
                del api.repository[field]
                with self.assertRaises(ledger_module.LedgerError):
                    self.make_ledger(api)
                self.assertEqual(api.writes(), [])

    def test_public_source_identity_and_visibility_are_required(self):
        changes = [{"full_name": "attacker/repository"}, {"private": True}, {"private": 0},
                   {"visibility": "private"}, {"visibility": "internal"}, {"visibility": None}]
        for change in changes:
            with self.subTest(change=change):
                api = FakeStateAPI()
                api.source_repository.update(change)
                with self.assertRaises(ledger_module.LedgerError):
                    self.make_ledger(api)
                self.assertEqual(api.writes(), [])
        for field in ("full_name", "private", "visibility"):
            with self.subTest(missing=field):
                api = FakeStateAPI()
                del api.source_repository[field]
                with self.assertRaises(ledger_module.LedgerError):
                    self.make_ledger(api)
                self.assertEqual(api.writes(), [])

    def test_unreadable_source_metadata_fails_closed_before_ledger_writes(self):
        api = FakeStateAPI()
        api.fail_paths.add(f"/repos/{REPO}")
        with self.assertRaises(ledger_module.LedgerError):
            self.make_ledger(api)
        self.assertEqual(api.writes(), [])

    def test_visibility_and_app_scope_are_rechecked_before_public_state_write(self):
        mutations = [lambda api: api.source_repository.update(private=True, visibility="private"),
                     lambda api: api.repository.update(private=True, visibility="private"),
                     lambda api: api.installation.update(total_count=2),
                     lambda api: api.repository.update(id=STATE_REPO_ID + 1),
                     lambda api: api.installation["repositories"][0].update(id=STATE_REPO_ID + 1)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                api = FakeStateAPI()
                subject = self.make_ledger(api)
                mutate(api)
                with self.assertRaises(ledger_module.LedgerError):
                    subject.reserve(7049, claim())
                self.assertEqual(api.writes(), [])
                self.assertEqual(api.document()["attempts"], [])

    def test_source_turning_private_cannot_publish_completion_metadata(self):
        claim_id = self.subject.reserve(7049, claim())
        self.api.source_repository.update(private=True, visibility="private")
        with self.assertRaises(ledger_module.LedgerError):
            self.subject.complete(7049, claim_id, "complete")
        self.assertEqual(len(self.api.writes()), 1)
        self.assertEqual(self.api.document()["attempts"][0]["status"], "started")
        self.assertEqual(self.api.document()["attempts"][0]["reservation"], "3.00")

    def test_unreadable_rulesets_or_missing_effective_rules_refuse_payment(self):
        mutations = [lambda api: api.rulesets.clear(),
                     lambda api: api.details[1].update(enforcement="disabled"),
                     lambda api: api.details[2].update(enforcement="evaluate"),
                     lambda api: api.effective.pop(),
                     lambda api: api.details[1]["conditions"]["ref_name"].update(include=["~ALL"]),
                     lambda api: api.details[2]["conditions"]["ref_name"].update(exclude=["~DEFAULT_BRANCH"])]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                api = FakeStateAPI()
                mutate(api)
                with self.assertRaises(ledger_module.LedgerError):
                    self.make_ledger(api)
                self.assertEqual(api.writes(), [])

    def test_only_state_app_can_create_update_and_nobody_can_delete_force_push(self):
        invalid = [
            (1, [{"actor_id": APP_ID + 1, "actor_type": "Integration", "bypass_mode": "always"}]),
            (1, [{"actor_id": APP_ID, "actor_type": "Integration", "bypass_mode": "pull_request"}]),
            (1, [{"actor_id": APP_ID, "actor_type": "Integration", "bypass_mode": "always"},
                 {"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}]),
            (2, [{"actor_id": APP_ID, "actor_type": "Integration", "bypass_mode": "always"}]),
        ]
        for ruleset_id, actors in invalid:
            with self.subTest(ruleset_id=ruleset_id, actors=actors):
                api = FakeStateAPI()
                api.details[ruleset_id]["bypass_actors"] = actors
                with self.assertRaises(ledger_module.LedgerError):
                    self.make_ledger(api)
                self.assertEqual(api.writes(), [])

    def test_missing_or_malformed_bypass_metadata_is_not_no_bypass(self):
        for ruleset_id in (1, 2):
            for actors in (None, {}, "", "none"):
                with self.subTest(ruleset=ruleset_id, actors=actors):
                    api = FakeStateAPI()
                    api.details[ruleset_id]["bypass_actors"] = actors
                    with self.assertRaises(ledger_module.LedgerError):
                        self.make_ledger(api)
                    self.assertEqual(api.writes(), [])
            with self.subTest(ruleset=ruleset_id, missing=True):
                api = FakeStateAPI()
                del api.details[ruleset_id]["bypass_actors"]
                with self.assertRaises(ledger_module.LedgerError):
                    self.make_ledger(api)
                self.assertEqual(api.writes(), [])

    def test_protection_is_rechecked_immediately_before_atomic_claim_write(self):
        self.api.details[2]["bypass_actors"] = [
            {"actor_id": APP_ID, "actor_type": "Integration", "bypass_mode": "always"}]
        with self.assertRaises(ledger_module.LedgerError):
            self.subject.reserve(7049, claim())
        self.assertEqual(self.api.writes(), [])

    def test_signed_old_document_copied_into_new_commit_is_rejected_as_replay(self):
        old_document = self.api.document()
        self.subject.reserve(7049, claim())
        self.api.tip = self.api.commit(old_document, [self.api.tip])
        with self.assertRaisesRegex(ledger_module.LedgerError, "parent mismatch"):
            self.subject.reserve(7049, claim("comment-124"))
        self.assertEqual(len(self.api.writes()), 1)

    def test_cas_conflict_does_not_retry_or_consume_a_new_authorized_request(self):
        self.api.conflict = True
        with self.assertRaisesRegex(ledger_module.LedgerError, "no payment or automatic retry"):
            self.subject.reserve(7049, claim())
        self.assertEqual(len(self.api.writes()), 1)
        self.assertEqual(self.subject.states(7049), [])

    def test_uncertain_write_retains_reservation_and_never_retries(self):
        self.api.uncertain_write = True
        with self.assertRaisesRegex(ledger_module.LedgerError, "no payment or automatic retry"):
            self.subject.reserve(7049, claim())
        self.assertEqual(len(self.api.writes()), 1)
        self.assertEqual(self.subject.states(7049)[0]["reservation"], "3.00")
        self.api.uncertain_write = False
        with self.assertRaises(ledger_module.LedgerError):
            self.subject.reserve(7049, claim())
        self.assertEqual(len(self.api.writes()), 1)

    def test_bad_write_acknowledgement_and_parent_prevent_claim_authorization(self):
        for flag in ("bad_acknowledgement", "bad_write_parent"):
            with self.subTest(flag=flag):
                api = FakeStateAPI()
                subject = self.make_ledger(api)
                setattr(api, flag, True)
                with self.assertRaises(ledger_module.LedgerError):
                    subject.reserve(7049, claim())
                self.assertEqual(len(api.writes()), 1)

    def test_invalid_contents_identity_encoding_and_size_fail_closed(self):
        bad = [{"type": "symlink"}, {"path": "other.json"}, {"encoding": "utf8"},
               {"sha": "main"}, {"size": True}, {"size": 0}, {"size": 900_001},
               {"content": "!invalid base64!"}, {"size": 1}]
        for change in bad:
            with self.subTest(change=change):
                api = FakeStateAPI()
                subject = self.make_ledger(api)
                api.contents_overrides = change
                with self.assertRaises(ledger_module.LedgerError):
                    subject.reserve(7049, claim())
                self.assertEqual(api.writes(), [])

    def test_malformed_signed_attempts_and_counter_mismatch_are_not_empty_state(self):
        invalid = [{"id": "not-an-id"}, {"pr": True}, {"request": "comment-0"},
                   {"request": "comment-1; echo secret"}, {"head": "main"}, {"base": "0" * 39},
                   {"status": "approved"}, {"run": "0"}, {"reservation": "0.01"},
                   {"extra": "attacker-controlled"}]
        for changes in invalid:
            with self.subTest(changes=changes):
                api = FakeStateAPI()
                subject = self.make_ledger(api)
                document = api.document()
                record = dict(claim(), id="a" * 32, pr=7049, reservation="3.00")
                record.update(changes)
                document.update(attempts=[record], revision=2)
                api.replace_document(document, signed=True)
                with self.assertRaises(ledger_module.LedgerError):
                    subject.reserve(7049, claim("comment-124"))
                self.assertEqual(api.writes(), [])
        self.subject.reserve(7049, claim())
        document = self.api.document()
        document["attempts"].clear()
        self.api.replace_document(document, signed=True)
        with self.assertRaisesRegex(ledger_module.LedgerError, "counters"):
            self.subject.reserve(7049, claim("comment-124"))
        self.assertEqual(len(self.api.writes()), 1)

    def test_combined_ruleset_with_app_bypass_cannot_protect_deletion_or_force_push(self):
        api = FakeStateAPI()
        api.details[1]["rules"].extend(api.details[2]["rules"])
        api.rulesets = [api.rulesets[0]]
        api.effective = [{"type": rule["type"], "ruleset_id": 1} for rule in api.details[1]["rules"]]
        with self.assertRaises(ledger_module.LedgerError):
            self.make_ledger(api)
        self.assertEqual(api.writes(), [])

    def test_missing_or_duplicate_claim_cannot_refund_or_overwrite_terminal_history(self):
        claim_id = self.subject.reserve(7049, claim())
        with self.assertRaises(ledger_module.LedgerError):
            self.subject.complete(7050, claim_id, "complete")
        with self.assertRaises(ledger_module.LedgerError):
            self.subject.complete(7049, "f" * 32, "complete")
        self.assertEqual(self.subject.states(7049)[0]["reservation"], "3.00")
        document = self.api.document()
        document["attempts"].append(copy.deepcopy(document["attempts"][0]))
        document["revision"] += 1
        self.api.replace_document(document, signed=True)
        with self.assertRaisesRegex(ledger_module.LedgerError, "Duplicate"):
            self.subject.states(7049)
        self.assertEqual(len(self.api.writes()), 1)

    def test_terminal_states_are_immutable_and_completion_is_idempotent(self):
        claim_id = self.subject.reserve(7049, claim())
        self.subject.complete(7049, claim_id, "incomplete")
        self.subject.complete(7049, claim_id, "incomplete")
        with self.assertRaises(ledger_module.LedgerError):
            self.subject.complete(7049, claim_id, "complete")
        self.assertEqual(len(self.api.writes()), 2)
        self.assertEqual(self.subject.states(7049)[0]["reservation"], "3.00")


class LegacyReservationTests(unittest.TestCase):
    def imported_api(self, records, activate=False):
        api = FakeStateAPI(activated=False)
        document = ledger_module.imported_document(REPO, EPOCH, KEY, records)
        api.tip = api.commit(document, [])
        if activate:
            document.update(production_verified=True, revision=document["revision"] + 1,
                            parent_commit=api.tip)
            document = ledger_module.signed_document(document, KEY, REPO, EPOCH)
            api.tip = api.commit(document, [api.tip])
        return api, ledger_module.Ledger(api, REPO, EPOCH, KEY, APP_ID)

    def test_populated_import_is_signed_inactive_v2_orphan_with_no_fabricated_commits(self):
        records = [legacy_record(number) for number in range(1, 5)]
        api, subject = self.imported_api(records)
        document = api.document()
        self.assertEqual(document["version"], 2)
        self.assertEqual(document["revision"], 4)
        self.assertIsNone(document["parent_commit"])
        self.assertFalse(document["production_verified"])
        self.assertEqual(api.commits[api.tip]["parents"], [])
        self.assertEqual(subject.states(7049), records)
        self.assertTrue(all(record["head"] is None and record["base"] is None and
                            record["status"] == "started" and record["reservation"] == "3.00"
                            for record in document["attempts"]))
        with self.assertRaisesRegex(ledger_module.LedgerError, "production security verification"):
            subject.reserve(7049, claim())
        self.assertEqual(api.writes(), [])

    def test_import_helper_rejects_normal_mutable_or_malformed_legacy_records(self):
        invalid = [[], [dict(claim(), id="1" * 32, pr=7049, reservation="3.00")]]
        for changes in ({"legacy": False}, {"legacy": 1}, {"request": "auto"},
                        {"request": "comment-123"}, {"request": "audit-main"},
                        {"status": "complete"}, {"status": "incomplete"}, {"status": "stale"},
                        {"head": "main"}, {"base": "b" * 39}, {"pr": True}, {"run": "0"},
                        {"reservation": "0.00"}, {"unexpected": "field"}):
            invalid.append([dict(legacy_record(), **changes)])
        invalid.append([legacy_record(), legacy_record()])
        invalid.append([legacy_record(), dict(legacy_record(2), request=legacy_record()["request"])])
        for records in invalid:
            with self.subTest(records=records):
                with self.assertRaises(ledger_module.LedgerError):
                    ledger_module.imported_document(REPO, EPOCH, KEY, records)

    def test_unknown_legacy_head_counts_against_every_prospective_head(self):
        api, subject = self.imported_api([legacy_record(), legacy_record(2)], activate=True)
        for head in (HEAD, NEXT_HEAD, "3" * 40):
            with self.subTest(head=head):
                with self.assertRaisesRegex(ledger_module.LedgerError, "head review budget exhausted"):
                    subject.reserve(7049, claim(head=head))
        self.assertEqual(len(subject.states(7049)), 2)
        self.assertEqual(api.writes(), [])

    def test_legacy_reservations_count_toward_pr_cap_even_with_known_different_heads(self):
        records = [legacy_record(number, head=f"{number:040x}") for number in range(1, 4)]
        api, subject = self.imported_api(records, activate=True)
        with self.assertRaisesRegex(ledger_module.LedgerError, "PR review budget exhausted"):
            subject.reserve(7049, claim(head=HEAD))
        self.assertEqual(api.writes(), [])
        subject.reserve(7050, claim())
        self.assertEqual(len(subject.states(7050)), 1)

    def test_unknown_base_cannot_supply_a_completed_review_or_be_completed(self):
        record = legacy_record(head=HEAD)
        api, subject = self.imported_api([record], activate=True)
        for status in ("complete", "incomplete", "stale"):
            with self.subTest(status=status):
                with self.assertRaisesRegex(ledger_module.LedgerError, "permanently started"):
                    subject.complete(7049, record["id"], status)
        self.assertEqual(api.writes(), [])
        self.assertFalse(flow.reviewer.already_attempted(subject.states(7049), "comment-123", HEAD, BASE))
        claim_id = subject.reserve(7049, claim())
        subject.complete(7049, claim_id, "complete")
        self.assertEqual(subject.states(7049)[0], record)
        self.assertEqual(subject.states(7049)[1]["base"], BASE)
        self.assertNotIn("legacy", subject.states(7049)[1])
        with self.assertRaisesRegex(ledger_module.LedgerError, "head review budget exhausted"):
            subject.reserve(7049, claim("comment-124", base=NEXT_BASE))
        self.assertEqual(len(api.writes()), 2)

    def test_runtime_cannot_create_legacy_records_or_normal_records_with_unknown_commits(self):
        api = FakeStateAPI()
        subject = ledger_module.Ledger(api, REPO, EPOCH, KEY, APP_ID)
        for state in (dict(claim(), legacy=True), claim(head=None), claim(base=None)):
            with self.subTest(state=state):
                with self.assertRaises(ledger_module.LedgerError):
                    subject.reserve(7049, state)
        self.assertEqual(api.writes(), [])
        self.assertEqual(subject.states(7049), [])

    def test_v1_document_fails_closed_without_automatic_migration_or_reset(self):
        api = FakeStateAPI()
        subject = ledger_module.Ledger(api, REPO, EPOCH, KEY, APP_ID)
        document = api.document()
        document["version"] = 1
        api.replace_document(document, signed=True)
        for operation in (lambda: subject.states(7049), lambda: subject.reserve(7049, claim())):
            with self.assertRaisesRegex(ledger_module.LedgerError, "wrong-generation"):
                operation()
        self.assertEqual(api.document()["version"], 1)
        self.assertEqual(api.writes(), [])

    def test_copied_populated_root_and_nonlegacy_or_activated_orphans_are_rejected(self):
        for invalid in ("copied", "normal", "activated"):
            with self.subTest(invalid=invalid):
                api, subject = self.imported_api([legacy_record()])
                document = api.document()
                parents = []
                if invalid == "copied":
                    parents = [api.tip]
                elif invalid == "normal":
                    document["attempts"] = [dict(claim(), id="a" * 32, pr=7049, reservation="3.00")]
                else:
                    document.update(production_verified=True, revision=2)
                document = ledger_module.signed_document(document, KEY, REPO, EPOCH)
                api.tip = api.commit(document, parents)
                with self.assertRaises(ledger_module.LedgerError):
                    subject.states(7049)
                self.assertEqual(api.writes(), [])

    def test_invalid_write_is_validated_before_any_protected_api_call(self):
        for invalid in ("version", "null_normal_head", "terminal_legacy", "revision"):
            with self.subTest(invalid=invalid):
                api = FakeStateAPI()
                subject = ledger_module.Ledger(api, REPO, EPOCH, KEY, APP_ID)
                document = api.document()
                if invalid == "version":
                    document["version"] = 1
                elif invalid == "null_normal_head":
                    document["attempts"].append(dict(claim(head=None), id="a" * 32,
                                                     pr=7049, reservation="3.00"))
                elif invalid == "terminal_legacy":
                    document["attempts"].append(dict(legacy_record(), status="complete"))
                else:
                    document["revision"] = 900
                calls_before = len(api.calls)
                with self.assertRaises(ledger_module.LedgerError):
                    subject._write(document, api.tip, api.files[api.tip]["sha"])
                self.assertEqual(len(api.calls), calls_before)
                self.assertEqual(api.writes(), [])

    def test_unknown_legacy_debt_blocks_actual_review_without_paid_messages(self):
        state_api, ledger = self.imported_api([legacy_record(), legacy_record(2)], activate=True)
        api = flow.FakeAPI()
        subject = flow.reviewer.Reviewer(api, REPO, 7049, "12345", ledger=ledger)
        with self.assertRaisesRegex(ledger_module.LedgerError, "head review budget exhausted"):
            subject.review("comment-123", HEAD)
        self.assertEqual(api.paid_calls(), [])
        self.assertEqual(state_api.writes(), [])


class RealLedgerReviewBoundaryTests(unittest.TestCase):
    def test_each_invalid_payment_boundary_results_in_zero_messages_calls(self):
        failures = ["bootstrap", "missing", "signature", "scope", "state-private", "state-recreated", "source-private",
                    "source-identity", "source-unreadable", "protection", "cas", "uncertain", "replay"]
        for failure in failures:
            with self.subTest(failure=failure):
                api = flow.FakeAPI()
                state_api = FakeStateAPI(activated=failure != "bootstrap")
                if failure == "scope":
                    state_api.installation["total_count"] = 2
                elif failure == "state-private":
                    state_api.repository.update(private=True, visibility="private")
                elif failure == "state-recreated":
                    state_api.repository["id"] = STATE_REPO_ID + 1
                elif failure == "source-private":
                    state_api.source_repository.update(private=True, visibility="private")
                elif failure == "source-identity":
                    state_api.source_repository["full_name"] = "attacker/repository"
                elif failure == "source-unreadable":
                    state_api.fail_paths.add(f"/repos/{REPO}")
                with self.assertRaises((ledger_module.LedgerError, flow.reviewer.ReviewError)):
                    subject_ledger = ledger_module.Ledger(state_api, REPO, EPOCH, KEY, APP_ID)
                    if failure == "missing":
                        state_api.fail_paths.add(ROOT + "/contents/ledger.json")
                    elif failure == "signature":
                        document = state_api.document()
                        document["signature"] = "0" * 64
                        state_api.replace_document(document)
                    elif failure == "protection":
                        state_api.details[2]["bypass_actors"] = [{"actor_id": APP_ID,
                            "actor_type": "Integration", "bypass_mode": "always"}]
                    elif failure == "cas":
                        state_api.conflict = True
                    elif failure == "uncertain":
                        state_api.uncertain_write = True
                    elif failure == "replay":
                        state_api.tip = state_api.commit(state_api.document(), [state_api.tip])
                    subject = flow.reviewer.Reviewer(api, REPO, 7049, "12345", ledger=subject_ledger)
                    subject.review()
                self.assertEqual(api.paid_calls(), [])
                self.assertFalse(any(call[0] != "github" for call in state_api.calls))

    def test_source_turning_private_after_collection_cannot_send_prompt_to_token_counter(self):
        api = flow.FakeAPI()
        state_api = FakeStateAPI()
        ledger = ledger_module.Ledger(state_api, REPO, EPOCH, KEY, APP_ID)
        subject = flow.reviewer.Reviewer(api, REPO, 7049, "12345", ledger=ledger)
        original_collect = subject.collect

        def collect_then_make_private(pr):
            prompt = original_collect(pr)
            state_api.source_repository.update(private=True, visibility="private")
            return prompt

        with patch.object(subject, "collect", side_effect=collect_then_make_private):
            with self.assertRaises((ledger_module.LedgerError, flow.reviewer.ReviewError)):
                subject.review()
        self.assertFalse(any(call[0] == "anthropic" for call in api.calls))
        self.assertEqual(state_api.writes(), [])
        self.assertEqual(api.comments, [])

    def test_source_turning_private_during_failed_preparation_withholds_diagnostic_metadata(self):
        api = flow.FakeAPI()
        state_api = FakeStateAPI()
        ledger = ledger_module.Ledger(state_api, REPO, EPOCH, KEY, APP_ID)
        subject = flow.reviewer.Reviewer(api, REPO, 7049, "12345", ledger=ledger)

        def fail_collection_after_privacy_change(pr):
            state_api.source_repository.update(private=True, visibility="private")
            raise flow.reviewer.ReviewError("Missing patch containing private filename")

        with patch.object(subject, "collect", side_effect=fail_collection_after_privacy_change):
            with self.assertRaises((ledger_module.LedgerError, flow.reviewer.ReviewError)):
                subject.review()
        self.assertFalse(any(call[0] == "anthropic" for call in api.calls))
        self.assertEqual(state_api.writes(), [])
        self.assertEqual(api.comments, [])

    def test_source_turning_private_during_counting_makes_no_paid_call_or_state_write(self):
        api = flow.FakeAPI()
        state_api = FakeStateAPI()
        ledger = ledger_module.Ledger(state_api, REPO, EPOCH, KEY, APP_ID)
        subject = flow.reviewer.Reviewer(api, REPO, 7049, "12345", ledger=ledger)
        api.on_count = lambda: state_api.source_repository.update(private=True, visibility="private")
        with self.assertRaises((ledger_module.LedgerError, flow.reviewer.ReviewError)):
            subject.review()
        self.assertEqual(api.paid_calls(), [])
        self.assertEqual(state_api.writes(), [])
        self.assertEqual(state_api.document()["attempts"], [])
        self.assertEqual(api.comments, [])

    def test_source_turning_private_after_reservation_preserves_claim_without_paying(self):
        api = flow.FakeAPI()
        state_api = FakeStateAPI()
        ledger = ledger_module.Ledger(state_api, REPO, EPOCH, KEY, APP_ID)
        subject = flow.reviewer.Reviewer(api, REPO, 7049, "12345", ledger=ledger)
        original_reserve = ledger.reserve

        def reserve_then_make_private(*args, **kwargs):
            claim_id = original_reserve(*args, **kwargs)
            state_api.source_repository.update(private=True, visibility="private")
            return claim_id

        with patch.object(ledger, "reserve", side_effect=reserve_then_make_private):
            with self.assertRaises((ledger_module.LedgerError, flow.reviewer.ReviewError)):
                subject.review()
        self.assertEqual(api.paid_calls(), [])
        self.assertEqual(api.comments, [])
        self.assertEqual(len(state_api.writes()), 1)
        record = state_api.document()["attempts"][0]
        self.assertEqual(record["status"], "started")
        self.assertEqual(record["reservation"], "3.00")

    def test_source_turning_private_during_review_preserves_payment_and_withholds_findings(self):
        api = flow.FakeAPI()
        state_api = FakeStateAPI()
        ledger = ledger_module.Ledger(state_api, REPO, EPOCH, KEY, APP_ID)
        subject = flow.reviewer.Reviewer(api, REPO, 7049, "12345", ledger=ledger)
        api.on_paid = lambda: state_api.source_repository.update(private=True, visibility="private")
        with self.assertRaises((ledger_module.LedgerError, flow.reviewer.ReviewError)):
            subject.review()
        self.assertEqual(len(api.paid_calls()), 1)
        self.assertEqual(api.comments, [])
        self.assertEqual(len(state_api.writes()), 1)
        record = state_api.document()["attempts"][0]
        self.assertEqual(record["status"], "started")
        self.assertEqual(record["reservation"], "3.00")

    def test_actual_review_flow_enforces_head_and_pr_limits_on_repeated_manual_retries(self):
        api = flow.FakeAPI()
        api.paid_response = dict(flow.completed_response(), stop_reason="max_tokens")
        state_api = FakeStateAPI()
        ledger = ledger_module.Ledger(state_api, REPO, EPOCH, KEY, APP_ID)
        subject = flow.reviewer.Reviewer(api, REPO, 7049, "12345", ledger=ledger)
        for request in ("comment-123", "comment-124"):
            with self.assertRaises(flow.reviewer.ReviewError):
                subject.review(request, HEAD)
        api.pr["base"]["sha"] = NEXT_BASE
        with self.assertRaisesRegex(ledger_module.LedgerError, "head review budget exhausted"):
            subject.review("comment-125", HEAD)
        api.pr["head"]["sha"] = NEXT_HEAD
        with self.assertRaises(flow.reviewer.ReviewError):
            subject.review("comment-126", NEXT_HEAD)
        api.pr["head"]["sha"] = "3" * 40
        with self.assertRaisesRegex(ledger_module.LedgerError, "PR review budget exhausted"):
            subject.review("comment-127", "3" * 40)
        self.assertEqual(len(api.paid_calls()), 3)
        self.assertEqual([record["reservation"] for record in ledger.states(7049)],
                         ["3.00", "3.00", "3.00"])
        self.assertTrue(all(record["status"] == "incomplete" for record in ledger.states(7049)))

    def test_completion_write_failure_retains_started_claim_and_blocks_automatic_repayment(self):
        api = flow.FakeAPI()
        state_api = FakeStateAPI()
        ledger = ledger_module.Ledger(state_api, REPO, EPOCH, KEY, APP_ID)
        subject = flow.reviewer.Reviewer(api, REPO, 7049, "12345", ledger=ledger)
        api.on_paid = lambda: setattr(state_api, "fail_write", True)
        with self.assertRaises(flow.reviewer.ReviewError):
            subject.review()
        state_api.fail_write = False
        self.assertEqual(len(api.comments), 1)
        self.assertEqual(ledger.states(7049)[0]["status"], "started")
        self.assertEqual(ledger.states(7049)[0]["reservation"], "3.00")
        self.assertIn("no paid call", subject.review())
        self.assertEqual(len(api.paid_calls()), 1)

    def test_real_ledger_history_survives_comment_deletion_and_api_key_rotation(self):
        api = flow.FakeAPI()
        state_api = FakeStateAPI()
        ledger = ledger_module.Ledger(state_api, REPO, EPOCH, KEY, APP_ID)
        subject = flow.reviewer.Reviewer(api, REPO, 7049, "12345", ledger=ledger)
        self.assertEqual(subject.review(), "complete")
        api.comments.clear()
        api.anthropic_key = "rotated-offline-api-key"
        self.assertIn("no paid call", subject.review())
        self.assertEqual(len(api.paid_calls()), 1)
        self.assertEqual(ledger.states(7049)[0]["reservation"], "3.00")


if __name__ == "__main__":
    unittest.main()
