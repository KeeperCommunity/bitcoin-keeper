"""Administrator-only, provider-free preflight and one-time inactive legacy import.

This helper never receives the Anthropic key and cannot verify production or buy
reviews. Its fixed bootstrap preserves uncertain historical payment reservations.
"""

import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys


_SPEC = importlib.util.spec_from_file_location(
    "claude_review_admin_trusted_reviewer", Path(__file__).with_name("claude_review.py"))
reviewer = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(reviewer)
API = reviewer.API
APIHTTPError = reviewer.APIHTTPError
Ledger = reviewer.Ledger
ledger_module = reviewer._LEDGER_MODULE

REPOSITORY = "KeeperCommunity/bitcoin-keeper"
EPOCH = "fd24ddf2e3336ed75c3ef376a8a14f8c"
APP_ID = ledger_module.STATE_APP_ID
INITIAL_MAIN = "a330fe03b8169c31e05dabf3401a2a0c41cf17ab"
STATE_ROOT = "/repos/" + ledger_module.STATE_REPOSITORY
STATE_REF = "refs/heads/" + ledger_module.STATE_BRANCH
CHECKPOINT_FILE = "bootstrap-complete.json"
LEGACY_RUNS = {"38207447420", "38207549379", "38207785685", "38212999038",
               "38213428947", "38214221834", "38216234718"}
UNKNOWN_RUNS = {"38207447420", "38207549379", "38207785685"}
SHA = re.compile(r"[0-9a-f]{40}")
LOGIN = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?")


class AdminError(Exception):
    pass


def _sha(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise AdminError("Invalid immutable object")
    return value


def _request(api, path, body=None, method=None, query=None):
    # Both API instances have an empty provider key; no provider origin is used.
    return api.request("github", path, body, method=method, query=query)


def _ref(api, branch, missing=False):
    try:
        response = _request(api, STATE_ROOT + "/git/ref/heads/" + branch)
    except APIHTTPError as error:
        if missing and error.origin == "github" and error.status == 404:
            return None
        raise
    if (not isinstance(response, dict) or response.get("ref") != "refs/heads/" + branch or
            not isinstance(response.get("object"), dict) or
            response["object"].get("type") != "commit"):
        raise AdminError("Invalid branch acknowledgement")
    return _sha(response["object"].get("sha"))


def authorize(api, environment):
    """Recheck both original dispatcher and rerun caller without protected keys."""
    if (environment.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or
            environment.get("GITHUB_REPOSITORY") != REPOSITORY or
            environment.get("GITHUB_REF") != "refs/heads/sprint" or
            environment.get("KEEPER_CLAUDE_REVIEW_ENABLED", "") not in {"", "false"}):
        raise AdminError("Inactive administrator workflow context required")
    workflow_sha = _sha(environment.get("GITHUB_SHA"))
    for actor in {environment.get("GITHUB_ACTOR"), environment.get("GITHUB_TRIGGERING_ACTOR")}:
        if not isinstance(actor, str) or not LOGIN.fullmatch(actor):
            raise AdminError("Administrator identity unavailable")
        permission = _request(api, f"/repos/{REPOSITORY}/collaborators/{actor}/permission")
        if not isinstance(permission, dict) or permission.get("permission") != "admin":
            raise AdminError("Both dispatch and rerun actors must remain administrators")
    current = _request(api, f"/repos/{REPOSITORY}/git/ref/heads/sprint")
    if (not isinstance(current, dict) or current.get("ref") != "refs/heads/sprint" or
            not isinstance(current.get("object"), dict) or
            current["object"].get("type") != "commit" or
            current["object"].get("sha") != workflow_sha):
        raise AdminError("Administrator workflow must use the current sprint commit")
    return workflow_sha


def preflight(api, state_api, environment):
    workflow_sha = authorize(api, environment)
    reviewer.check_environment(api, REPOSITORY, environment["GITHUB_REF"])
    key = environment.get("KEEPER_CLAUDE_STATE_KEY", "")
    if (not isinstance(key, str) or len(key) < 32 or
            environment.get("KEEPER_CLAUDE_LEDGER_EPOCH") != EPOCH or
            environment.get("KEEPER_CLAUDE_LEDGER_APP_ID") != str(APP_ID) or
            environment.get("KEEPER_CLAUDE_API_KEY_PRESENT") != "true" or
            environment.get("ANTHROPIC_API_KEY") or environment.get("KEEPER_CLAUDE_API_KEY")):
        raise AdminError("Protected configuration and provider-presence boolean required")
    ledger = Ledger(state_api, REPOSITORY, EPOCH, key, APP_ID)
    tip = _ref(state_api, ledger_module.STATE_BRANCH, missing=True)
    if tip is not None:
        document, observed_tip, _ = ledger._read()
        if observed_tip != tip or document["production_verified"] is not False:
            raise AdminError("Inactive stable payment state required")
    return ledger, tip, workflow_sha


def _manifest(manifest, key):
    fields = {"version", "repository", "epoch", "app_id", "initial_main", "attempts",
              "excluded_no_call_runs", "evidence"}
    if (not isinstance(manifest, dict) or set(manifest) != fields or
            type(manifest["version"]) is not int or manifest["version"] != 1 or
            manifest["repository"] != REPOSITORY or manifest["epoch"] != EPOCH or
            type(manifest["app_id"]) is not int or manifest["app_id"] != APP_ID or
            manifest["initial_main"] != INITIAL_MAIN or
            manifest["excluded_no_call_runs"] != ["38214836557"] or
            not isinstance(manifest["evidence"], dict) or not manifest["evidence"] or
            not isinstance(manifest["attempts"], list) or len(manifest["attempts"]) != 7):
        raise AdminError("Fixed legacy migration manifest required")
    records = manifest["attempts"]
    if ({record.get("run") for record in records if isinstance(record, dict)} != LEGACY_RUNS or
            any(not isinstance(record, dict) or record.get("pr") != 7049 or
                (record.get("run") in UNKNOWN_RUNS and
                 (record.get("head") is not None or record.get("base") is not None))
                for record in records)):
        raise AdminError("All seven uncertain legacy reservations must be preserved")
    return ledger_module.imported_document(REPOSITORY, EPOCH, key, records)


def _object_sha(kind, raw):
    return hashlib.sha1(kind.encode("ascii") + b" " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()


def _blob(api, raw):
    expected = _object_sha("blob", raw)
    response = _request(api, STATE_ROOT + "/git/blobs", {
        "content": base64.b64encode(raw).decode("ascii"), "encoding": "base64"}, method="POST")
    if not isinstance(response, dict) or response.get("sha") != expected:
        raise AdminError("Blob acknowledgement uncertain")
    return expected


def _entries(response):
    if (not isinstance(response, dict) or response.get("truncated") is not False or
            not isinstance(response.get("tree"), list)):
        raise AdminError("Complete bootstrap tree required")
    entries = []
    for entry in response["tree"]:
        if (not isinstance(entry, dict) or entry.get("mode") != "100644" or
                entry.get("type") != "blob" or entry.get("path") not in {
                    "README.md", ledger_module.STATE_FILE, CHECKPOINT_FILE}):
            raise AdminError("Unexpected bootstrap tree entry")
        entries.append({"path": entry["path"], "mode": "100644", "type": "blob",
                        "sha": _sha(entry.get("sha"))})
    if len({entry["path"] for entry in entries}) != len(entries):
        raise AdminError("Duplicate bootstrap tree entry")
    return sorted(entries, key=lambda entry: entry["path"])


def _tree_sha(entries):
    raw = b"".join(b"100644 " + entry["path"].encode("utf-8") + b"\0" +
                   bytes.fromhex(entry["sha"]) for entry in sorted(entries, key=lambda value: value["path"]))
    return _object_sha("tree", raw)


def _tree(api, entries, base_tree=None, expected_entries=None):
    body = {"tree": entries}
    if base_tree is not None:
        body["base_tree"] = base_tree
    complete = expected_entries if expected_entries is not None else entries
    expected = _tree_sha(complete)
    response = _request(api, STATE_ROOT + "/git/trees", body, method="POST")
    if not isinstance(response, dict) or response.get("sha") != expected:
        raise AdminError("Tree acknowledgement uncertain")
    observed = _request(api, STATE_ROOT + "/git/trees/" + expected)
    if observed.get("sha") != expected or _entries(observed) != sorted(complete, key=lambda entry: entry["path"]):
        raise AdminError("Immutable bootstrap tree verification failed")
    return expected


def _verify_commit(response, sha, tree, parents, message):
    if (not isinstance(response, dict) or response.get("sha") != sha or
            response.get("tree", {}).get("sha") != tree or response.get("message") != message or
            not isinstance(response.get("parents"), list) or
            [entry.get("sha") if isinstance(entry, dict) else None for entry in response["parents"]] != parents):
        raise AdminError("Commit acknowledgement uncertain")


def _commit(api, tree, parents, message):
    response = _request(api, STATE_ROOT + "/git/commits", {
        "message": message, "tree": tree, "parents": parents}, method="POST")
    sha = _sha(response.get("sha") if isinstance(response, dict) else None)
    _verify_commit(response, sha, tree, parents, message)
    _verify_commit(_request(api, STATE_ROOT + "/git/commits/" + sha), sha, tree, parents, message)
    return sha


def _verify_ref_ack(response, ref, sha):
    if (not isinstance(response, dict) or response.get("ref") != ref or
            not isinstance(response.get("object"), dict) or
            response["object"].get("type") != "commit" or response["object"].get("sha") != sha):
        raise AdminError("Branch mutation acknowledgement uncertain")


def _initial_state(ledger, expected, expected_tip=None):
    document, tip, blob = ledger._read()
    if (document != expected or (expected_tip is not None and tip != expected_tip) or
            blob != _object_sha("blob", ledger_module.canonical(expected).encode("utf-8"))):
        raise AdminError("Existing state is not the exact inactive initial import; never reset")
    return tip


def _contents(api, path, ref, expected):
    raw = ledger_module.canonical(expected).encode("utf-8")
    response = _request(api, STATE_ROOT + "/contents/" + path, query={"ref": ref})
    if (not isinstance(response, dict) or response.get("type") != "file" or response.get("path") != path or
            response.get("sha") != _object_sha("blob", raw) or response.get("encoding") != "base64" or
            response.get("size") != len(raw) or not isinstance(response.get("content"), str)):
        raise AdminError("Immutable bootstrap checkpoint verification failed")
    try:
        if base64.b64decode(response["content"].replace("\n", ""), validate=True) != raw:
            raise ValueError()
    except ValueError:
        raise AdminError("Invalid bootstrap checkpoint encoding") from None


def _checkpoint(root_sha, workflow_sha):
    return {"version": 1, "repository": REPOSITORY, "epoch": EPOCH, "state_root": root_sha,
            "workflow_sha": workflow_sha, "legacy_records": 7, "production_verified": False}


def initialize(api, state_api, environment, manifest):
    ledger, tip, workflow_sha = preflight(api, state_api, environment)
    document = _manifest(manifest, environment["KEEPER_CLAUDE_STATE_KEY"])
    ledger._validate_document(document, {"parents": []})
    main = _ref(state_api, "main")
    if tip is not None:
        tip = _initial_state(ledger, document, tip)
        if main != INITIAL_MAIN:
            # Never rewrite either branch on a rerun. A known valid checkpoint
            # can be reported without granting production verification.
            checkpoint = _request(state_api, STATE_ROOT + "/contents/" + CHECKPOINT_FILE,
                                  query={"ref": main})
            try:
                prior = json.loads(base64.b64decode(checkpoint["content"].replace("\n", ""), validate=True))
                previous_sha = _sha(prior.get("workflow_sha"))
            except (KeyError, TypeError, ValueError):
                raise AdminError("Main changed; administrator reconciliation required") from None
            _contents(state_api, CHECKPOINT_FILE, main, _checkpoint(tip, previous_sha))
            return "ALREADY_INITIALIZED_INACTIVE"
    elif main != INITIAL_MAIN:
        raise AdminError("Pristine main checkpoint unavailable; never recreate payment state")
    if tip is None:
        raw = ledger_module.canonical(document).encode("utf-8")
        blob = _blob(state_api, raw)
        tree = _tree(state_api, [{"path": ledger_module.STATE_FILE, "mode": "100644",
                                  "type": "blob", "sha": blob}])
        tip = _commit(state_api, tree, [], "Import permanent legacy Claude payment reservations (inactive)")
        # Reconcile live authority, protection and both branch tips immediately
        # before the one-time ref creation. Uncertain writes are never retried.
        authorize(api, environment)
        ledger._verify_boundary()
        if _ref(state_api, "main") != INITIAL_MAIN or _ref(state_api, ledger_module.STATE_BRANCH, True) is not None:
            raise AdminError("Bootstrap boundary changed; no ref creation or reset")
        response = _request(state_api, STATE_ROOT + "/git/refs", {"ref": STATE_REF, "sha": tip}, method="POST")
        _verify_ref_ack(response, STATE_REF, tip)
        _initial_state(ledger, document, tip)
    # A partial previous attempt may finish only this public checkpoint. The
    # protected state branch is never updated, forced, emptied or re-signed.
    if _ref(state_api, "main") != INITIAL_MAIN:
        raise AdminError("Main advanced; checkpoint recovery requires administrator reconciliation")
    initial = _request(state_api, STATE_ROOT + "/git/commits/" + INITIAL_MAIN)
    if not isinstance(initial, dict) or initial.get("sha") != INITIAL_MAIN:
        raise AdminError("Immutable pristine main commit unavailable")
    base_tree = _sha(initial.get("tree", {}).get("sha"))
    base = _request(state_api, STATE_ROOT + "/git/trees/" + base_tree)
    entries = _entries(base)
    if (base.get("sha") != base_tree or len(entries) != 1 or entries[0]["path"] != "README.md" or
            _tree_sha(entries) != base_tree):
        raise AdminError("Pristine README-only main required")
    marker = _checkpoint(tip, workflow_sha)
    marker_blob = _blob(state_api, ledger_module.canonical(marker).encode("utf-8"))
    marker_entry = {"path": CHECKPOINT_FILE, "mode": "100644", "type": "blob", "sha": marker_blob}
    marker_tree = _tree(state_api, [marker_entry], base_tree, entries + [marker_entry])
    marker_commit = _commit(state_api, marker_tree, [INITIAL_MAIN], "Record inactive Claude ledger bootstrap checkpoint")
    authorize(api, environment)
    ledger._verify_boundary()
    _initial_state(ledger, document, tip)
    if _ref(state_api, "main") != INITIAL_MAIN:
        raise AdminError("Main advanced; no checkpoint update")
    # A commit parented only by pristine main plus force:false gives atomic
    # rejection when another writer advances main after the preceding read.
    response = _request(state_api, STATE_ROOT + "/git/refs/heads/main", {
        "sha": marker_commit, "force": False}, method="PATCH")
    _verify_ref_ack(response, "refs/heads/main", marker_commit)
    if _ref(state_api, "main") != marker_commit:
        raise AdminError("Checkpoint acknowledgement uncertain; no automatic retry")
    _contents(state_api, CHECKPOINT_FILE, marker_commit, marker)
    _initial_state(ledger, document, tip)
    return "BOOTSTRAP_COMPLETE_INACTIVE"


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        if len(argv) != 1 or argv[0] not in {"--authorize", "--preflight", "--initialize"}:
            raise AdminError("Select a fixed administrator operation")
        if not os.environ.get("GITHUB_TOKEN"):
            raise AdminError("GitHub authorization unavailable")
        api = API(os.environ["GITHUB_TOKEN"], "")
        if argv[0] == "--authorize":
            authorize(api, os.environ)
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
                output.write("authorized=true\n")
            status = "ADMINISTRATOR_AUTHORIZED_NO_PROVIDER"
        else:
            if not os.environ.get("KEEPER_CLAUDE_LEDGER_TOKEN"):
                raise AdminError("Scoped state token unavailable")
            state_api = API(os.environ["KEEPER_CLAUDE_LEDGER_TOKEN"], "")
            if argv[0] == "--preflight":
                _, tip, _ = preflight(api, state_api, os.environ)
                status = "PREFLIGHT_OK_STATE_NOT_INITIALIZED" if tip is None else "PREFLIGHT_OK_INACTIVE_STATE"
            else:
                path = Path(__file__).with_name("claude_review_legacy.json")
                if path.stat().st_size > 64_000:
                    raise AdminError("Legacy manifest too large")
                status = initialize(api, state_api, os.environ, json.loads(path.read_text(encoding="utf-8")))
        print(status)
        return 0
    except Exception:
        # No API bodies, secret values, signed contents, actor-supplied strings
        # or exception tracebacks are written to the Actions log.
        print("ADMINISTRATOR_SETUP_BLOCKED_NO_PROVIDER_NO_AUTOMATIC_RETRY")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
