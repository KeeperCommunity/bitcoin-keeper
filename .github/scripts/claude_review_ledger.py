"""Protected, atomic payment state. PR comments are never authoritative state."""

import base64
import copy
import hashlib
import hmac
import json
import re
import secrets

STATE_REPOSITORY = "KeeperCommunity/KeeperCommunity-keeper-review-ledger"
STATE_REPOSITORY_ID = 1416741877
STATE_APP_ID = 5313951
STATE_BRANCH = "keeper-claude-review-state"
STATE_FILE = "ledger.json"
MAX_LEDGER_BYTES = 900_000
MAX_ATTEMPTS_PER_HEAD = 2
MAX_ATTEMPTS_PER_PR = 3
RESERVATION = "3.00"
SHA = re.compile(r"[0-9a-f]{40}")
HEX32 = re.compile(r"[0-9a-f]{32}")
REQUEST = re.compile(r"auto|comment-[1-9][0-9]*|audit-[0-9a-f]{40}")
WRITE_RULES = {"creation", "update"}
HISTORY_RULES = {"deletion", "non_fast_forward"}
TERMINAL = {"complete", "incomplete", "stale"}


class LedgerError(Exception):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def signed_document(document, signing_key, code_repo, epoch):
    """For offline administrator initialization; this function never writes state."""
    unsigned = dict(document)
    unsigned.pop("signature", None)
    scope = f"{STATE_REPOSITORY}:{STATE_BRANCH}:{code_repo}:{epoch}:"
    signature = hmac.new(signing_key.encode("utf-8"),
                         (scope + canonical(unsigned)).encode("utf-8"),
                         hashlib.sha256).hexdigest()
    return dict(unsigned, signature=signature)


def _validate_configuration(code_repo, epoch, signing_key):
    if (not isinstance(code_repo, str) or
            not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", code_repo) or
            code_repo == STATE_REPOSITORY or not isinstance(epoch, str) or
            not HEX32.fullmatch(epoch) or not isinstance(signing_key, str) or
            len(signing_key) < 32):
        raise LedgerError("Invalid protected payment-ledger configuration")


def initial_document(code_repo, epoch, signing_key):
    """Build an empty v2 orphan bootstrap; history must be migrated before activation."""
    _validate_configuration(code_repo, epoch, signing_key)
    return signed_document({"version": 2, "epoch": epoch, "repository": code_repo,
                            "revision": 0, "parent_commit": None,
                            "production_verified": False, "attempts": []},
                           signing_key, code_repo, epoch)


def imported_document(code_repo, epoch, signing_key, records):
    """Build an offline, inactive v2 orphan preserving uncertain legacy debt."""
    _validate_configuration(code_repo, epoch, signing_key)
    if not isinstance(records, list) or not records:
        raise LedgerError("Legacy import requires nonempty historical reservations")
    ids, requests = set(), set()
    for record in records:
        Ledger._validate_attempt(record)
        if record.get("legacy") is not True:
            raise LedgerError("Orphan imports may contain only permanent legacy reservations")
        request_key = (record["pr"], record["request"])
        if record["id"] in ids or request_key in requests:
            raise LedgerError("Duplicate payment-ledger reservation")
        ids.add(record["id"])
        requests.add(request_key)
    return signed_document({"version": 2, "epoch": epoch, "repository": code_repo,
                            "revision": len(records), "parent_commit": None,
                            "production_verified": False, "attempts": copy.deepcopy(records)},
                           signing_key, code_repo, epoch)


class Ledger:
    def __init__(self, api, code_repo, epoch, signing_key, app_id):
        _validate_configuration(code_repo, epoch, signing_key)
        if type(app_id) is not int or app_id != STATE_APP_ID:
            raise LedgerError("Protected payment ledger requires the pinned State App identity")
        self.api, self.code_repo, self.epoch = api, code_repo, epoch
        self.signing_key, self.app_id = signing_key, STATE_APP_ID
        self.root = f"/repos/{STATE_REPOSITORY}"
        self._verify_boundary()

    def _request(self, path, body=None, method=None, query=None):
        try:
            return self.api.request("github", path, body, method=method, query=query)
        except Exception:
            # Never expose API bodies, credentials, or retry an uncertain write.
            raise LedgerError("Protected payment-state API unavailable; no payment or automatic retry") from None

    @staticmethod
    def _sha(value):
        if not isinstance(value, str) or not SHA.fullmatch(value):
            raise LedgerError("Invalid protected payment-state commit/blob SHA")
        return value

    def _verify_boundary(self):
        # This endpoint requires an installation access token. A PAT or the
        # ordinary code-repository workflow token cannot satisfy this boundary.
        installation = self._request("/installation/repositories",
                                     query={"per_page": 100, "page": 1})
        repos = installation.get("repositories", []) if isinstance(installation, dict) else []
        if (not isinstance(installation, dict) or type(installation.get("total_count")) is not int or
                installation.get("total_count") != 1 or
                not isinstance(repos, list) or len(repos) != 1 or
                not isinstance(repos[0], dict) or
                type(repos[0].get("id")) is not int or repos[0].get("id") != STATE_REPOSITORY_ID or
                repos[0].get("full_name") != STATE_REPOSITORY or
                repos[0].get("private") is not False or repos[0].get("visibility") != "public"):
            raise LedgerError("State App token must access only the public payment-ledger repository")
        repository = self._request(self.root)
        if (not isinstance(repository, dict) or repository.get("full_name") != STATE_REPOSITORY or
                type(repository.get("id")) is not int or repository.get("id") != STATE_REPOSITORY_ID or
                repository.get("private") is not False or repository.get("visibility") != "public" or
                any(repository.get(field) is not False for field in ("fork", "archived", "disabled"))):
            raise LedgerError("Payment-ledger repository must remain separate, public and active")
        self.verify_public_source()
        self._verify_protection()

    def verify_public_source(self):
        # The narrowly scoped State App can read public repository metadata;
        # a private/inaccessible source fails closed without expanding its scope.
        repository = self._request(f"/repos/{self.code_repo}")
        if (not isinstance(repository, dict) or repository.get("full_name") != self.code_repo or
                repository.get("private") is not False or repository.get("visibility") != "public"):
            raise LedgerError("Public payment state requires a public source repository")

    def _verify_protection(self):
        # The detailed ruleset establishes its bypass actors; the effective
        # branch-rules endpoint proves those restrictions actually cover the ref.
        summaries = self._request(self.root + "/rulesets", query={"per_page": 100, "page": 1})
        if not isinstance(summaries, list) or len(summaries) >= 100:
            raise LedgerError("Cannot completely verify payment-ledger branch protection")
        write_rulesets, history_rulesets = set(), set()
        for summary in summaries:
            if (not isinstance(summary, dict) or summary.get("enforcement") != "active" or
                    summary.get("target") not in {None, "branch"}):
                continue
            ruleset_id = summary.get("id")
            if type(ruleset_id) is not int or ruleset_id <= 0:
                raise LedgerError("Malformed payment-ledger branch ruleset")
            # Inherited rulesets have a different source endpoint. They cannot
            # weaken the required repository-local restriction below.
            if summary.get("source_type") not in {None, "Repository"}:
                continue
            ruleset = self._request(self.root + f"/rulesets/{ruleset_id}")
            if not isinstance(ruleset, dict):
                raise LedgerError("Malformed payment-ledger branch ruleset")
            conditions = ruleset.get("conditions") or {}
            ref = conditions.get("ref_name") or {} if isinstance(conditions, dict) else {}
            rules = ruleset.get("rules", [])
            # GitHub can redact this field for callers without sufficient
            # access. Missing is unknown, never proof of an empty bypass list.
            actors = ruleset.get("bypass_actors")
            exact = (ruleset.get("id") == ruleset_id and ruleset.get("enforcement") == "active" and
                    ruleset.get("target") == "branch" and isinstance(ref, dict) and
                    ref.get("include") == [f"refs/heads/{STATE_BRANCH}"] and ref.get("exclude") == [] and
                    isinstance(actors, list) and isinstance(rules, list))
            if not exact:
                continue
            types = {r.get("type") for r in rules
                     if isinstance(r, dict) and isinstance(r.get("type"), str)}
            if (actors == [{"actor_id": self.app_id, "actor_type": "Integration", "bypass_mode": "always"}] and
                    WRITE_RULES <= types):
                write_rulesets.add(ruleset_id)
            if actors == [] and HISTORY_RULES <= types:
                history_rulesets.add(ruleset_id)
        if not write_rulesets or not history_rulesets:
            raise LedgerError("Payment state requires exact-branch App-only writes and deletion/force-push rules with no bypass")
        effective = self._request(self.root + f"/rules/branches/{STATE_BRANCH}")
        if not isinstance(effective, list):
            raise LedgerError("Cannot verify effective payment-ledger branch rules")
        for qualifying, required in ((write_rulesets, WRITE_RULES), (history_rulesets, HISTORY_RULES)):
            if not any(required <= {r.get("type") for r in effective
                       if isinstance(r, dict) and r.get("ruleset_id") == ruleset_id and
                       isinstance(r.get("type"), str)} for ruleset_id in qualifying):
                raise LedgerError("Payment-ledger creation/update/deletion/force-push restrictions are not effective")

    @staticmethod
    def _validate_attempt(record):
        fields = {"id", "pr", "request", "head", "base", "status", "run", "reservation"}
        legacy = isinstance(record, dict) and record.get("legacy") is True
        if legacy:
            fields.add("legacy")
        if (not isinstance(record, dict) or set(record) != fields or
                not isinstance(record["id"], str) or not HEX32.fullmatch(record["id"]) or
                type(record["pr"]) is not int or record["pr"] <= 0 or
                not isinstance(record["request"], str) or not REQUEST.fullmatch(record["request"]) or
                not isinstance(record["status"], str) or record["status"] not in ({"started"} | TERMINAL) or
                not isinstance(record["run"], str) or not re.fullmatch(r"[1-9][0-9]*", record["run"]) or
                record["reservation"] != RESERVATION):
            raise LedgerError("Malformed signed payment-state attempt")
        if legacy and (not re.fullmatch(r"audit-[0-9a-f]{40}", record["request"]) or
                       record["status"] != "started"):
            raise LedgerError("Legacy reservations require permanent started audit records")
        for field in ("head", "base"):
            if not legacy or record[field] is not None:
                Ledger._sha(record[field])

    def _validate_document(self, document, commit):
        fields = {"version", "epoch", "repository", "revision", "parent_commit",
                  "production_verified", "attempts", "signature"}
        if (not isinstance(document, dict) or set(document) != fields or
                type(document["version"]) is not int or document["version"] != 2 or
                document["epoch"] != self.epoch or document["repository"] != self.code_repo or
                type(document["revision"]) is not int or document["revision"] < 0 or
                type(document["production_verified"]) is not bool or
                not isinstance(document["attempts"], list) or
                not isinstance(document["signature"], str) or
                not re.fullmatch(r"[0-9a-f]{64}", document["signature"])):
            raise LedgerError("Missing, malformed or wrong-generation payment ledger; administrator recovery required")
        expected = signed_document(document, self.signing_key, self.code_repo, self.epoch)
        if not hmac.compare_digest(document["signature"], expected["signature"]):
            raise LedgerError("Payment-ledger signature invalid; administrator recovery required")
        records = document["attempts"]
        ids, requests, auto = set(), set(), set()
        for record in records:
            self._validate_attempt(record)
            request_key = (record["pr"], record["request"])
            if record["id"] in ids or request_key in requests:
                raise LedgerError("Duplicate payment-ledger reservation")
            ids.add(record["id"])
            requests.add(request_key)
            if record["request"] == "auto":
                if record["pr"] in auto:
                    raise LedgerError("Duplicate automatic payment reservation")
                auto.add(record["pr"])
        # Legacy paid history must remain readable even when already over the
        # new caps. Only reserve() enforces caps; migration cannot erase debt.
        if (document["revision"] != len(records) + sum(r["status"] in TERMINAL for r in records) +
                int(document["production_verified"])):
            raise LedgerError("Payment-ledger counters or permanent spending limits invalid")
        parents = commit.get("parents")
        if not isinstance(parents, list):
            raise LedgerError("Payment-ledger commit ancestry unavailable")
        if parents == []:
            if (document["parent_commit"] is not None or document["production_verified"] is not False or
                    any(record.get("legacy") is not True for record in records)):
                raise LedgerError("Initial payment ledger must be an inactive administrator-created legacy orphan")
        elif (len(parents) != 1 or not isinstance(parents[0], dict) or
                document["parent_commit"] is None or
                self._sha(document["parent_commit"]) != self._sha(parents[0].get("sha"))):
            raise LedgerError("Payment-ledger parent mismatch; possible history replay")

    def _read(self):
        ref = self._request(self.root + f"/git/ref/heads/{STATE_BRANCH}")
        obj = ref.get("object") or {} if isinstance(ref, dict) else {}
        if (not isinstance(ref, dict) or ref.get("ref") != f"refs/heads/{STATE_BRANCH}" or
                not isinstance(obj, dict) or obj.get("type") != "commit"):
            raise LedgerError("Protected payment-ledger branch missing or invalid")
        commit_sha = self._sha(obj.get("sha"))
        commit = self._request(self.root + f"/git/commits/{commit_sha}")
        if not isinstance(commit, dict) or commit.get("sha") != commit_sha:
            raise LedgerError("Protected payment-ledger commit unavailable")
        contents = self._request(self.root + f"/contents/{STATE_FILE}", query={"ref": commit_sha})
        if (not isinstance(contents, dict) or contents.get("type") != "file" or
                contents.get("path") != STATE_FILE or contents.get("encoding") != "base64" or
                type(contents.get("size")) is not int or not 0 < contents["size"] <= MAX_LEDGER_BYTES or
                not isinstance(contents.get("content"), str)):
            raise LedgerError("Preinitialized payment ledger missing or too large; administrator recovery required")
        blob_sha = self._sha(contents.get("sha"))
        try:
            raw = base64.b64decode(contents["content"].replace("\n", ""), validate=True)
            if len(raw) != contents["size"]:
                raise ValueError()
            document = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError):
            raise LedgerError("Protected payment-ledger encoding invalid") from None
        self._validate_document(document, commit)
        return document, commit_sha, blob_sha

    def _write(self, document, parent_commit, blob_sha):
        # Every update commits the observed parent into authenticated content.
        # The Contents API's old blob SHA is the atomic compare-and-swap guard.
        self._sha(parent_commit)
        self._sha(blob_sha)
        document = dict(document, parent_commit=parent_commit,
                        revision=document["revision"] + 1)
        document = signed_document(document, self.signing_key, self.code_repo, self.epoch)
        # Reject invalid signed transitions before touching the protected ref.
        self._validate_document(document, {"parents": [{"sha": parent_commit}]})
        raw = canonical(document).encode("utf-8")
        if len(raw) > MAX_LEDGER_BYTES:
            raise LedgerError("Payment ledger exhausted; administrator archival required")
        self._verify_boundary()
        response = self._request(self.root + f"/contents/{STATE_FILE}", {
            "message": "Record permanent Claude review payment reservation",
            "content": base64.b64encode(raw).decode("ascii"),
            "sha": blob_sha, "branch": STATE_BRANCH}, method="PUT")
        acknowledged = response.get("commit") or {} if isinstance(response, dict) else {}
        file = response.get("content") or {} if isinstance(response, dict) else {}
        expected_blob = hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()
        if (not isinstance(acknowledged, dict) or not isinstance(file, dict) or
                file.get("sha") != expected_blob):
            raise LedgerError("Payment reservation acknowledgement uncertain; no payment or automatic retry")
        committed_sha = self._sha(acknowledged.get("sha"))
        commit = self._request(self.root + f"/git/commits/{committed_sha}")
        if not isinstance(commit, dict) or commit.get("sha") != committed_sha:
            raise LedgerError("Payment reservation commit unavailable; no payment or automatic retry")
        self._validate_document(document, commit)
        # Verify the immutable committed file instead of merely trusting a PUT
        # response. A concurrent later reservation may already be the branch tip.
        committed = self._request(self.root + f"/contents/{STATE_FILE}", query={"ref": committed_sha})
        if (not isinstance(committed, dict) or committed.get("type") != "file" or
                committed.get("path") != STATE_FILE or committed.get("sha") != expected_blob):
            raise LedgerError("Payment reservation not durably verified; no payment or automatic retry")
        return document

    @staticmethod
    def _pr(pr):
        if type(pr) is not int or pr <= 0:
            raise LedgerError("Invalid PR for payment state")

    def states(self, pr):
        self._pr(pr)
        document, _, _ = self._read()
        return [copy.deepcopy(r) for r in document["attempts"] if r["pr"] == pr]

    def reserve(self, pr, state):
        self._pr(pr)
        if not isinstance(state, dict) or set(state) != {"request", "head", "base", "status", "run"}:
            raise LedgerError("Invalid paid-review reservation")
        record = dict(state, id=secrets.token_hex(16), pr=pr, reservation=RESERVATION)
        self._validate_attempt(record)
        if record["status"] != "started":
            raise LedgerError("A paid-review claim must start before payment")
        document, parent, blob = self._read()
        if document["production_verified"] is not True:
            raise LedgerError("Reviewer inactive: signed production security verification required before payment")
        records = [r for r in document["attempts"] if r["pr"] == pr]
        if (record["request"] == "auto" and records or
                any(r["request"] == record["request"] or
                    (r["head"] == record["head"] and r["base"] == record["base"] and
                     r["status"] == "complete") for r in records)):
            raise LedgerError("Review already reserved/completed; no paid request")
        if len(records) >= MAX_ATTEMPTS_PER_PR:
            raise LedgerError("Permanent PR review budget exhausted ($9 / 3 attempts); administrator decision required")
        if sum(r["head"] is None or r["head"] == record["head"] for r in records) >= MAX_ATTEMPTS_PER_HEAD:
            raise LedgerError("Permanent head review budget exhausted ($6 / 2 attempts); administrator decision required")
        document["attempts"].append(record)
        self._write(document, parent, blob)
        return record["id"]

    def complete(self, pr, claim_id, status):
        self._pr(pr)
        if (not isinstance(claim_id, str) or not HEX32.fullmatch(claim_id) or
                not isinstance(status, str) or status not in TERMINAL):
            raise LedgerError("Invalid payment-state completion")
        document, parent, blob = self._read()
        matches = [r for r in document["attempts"] if r["pr"] == pr and r["id"] == claim_id]
        if len(matches) != 1:
            raise LedgerError("Paid-review reservation unavailable; no automatic retry")
        record = matches[0]
        if record.get("legacy") is True:
            raise LedgerError("Legacy payment reservations remain permanently started")
        if record["status"] == status:
            return
        if record["status"] != "started":
            raise LedgerError("Terminal payment reservation cannot be rewritten")
        record["status"] = status
        self._write(document, parent, blob)
