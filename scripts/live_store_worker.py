"""Protected driver's private child. No CLI can supply runtime authorization.

The child obtains each authorization response from its live Node parent, whose
same-process SDK capabilities are revalidated before responding. It inherits
only its operation's store credential, never the Node parent's reader tokens.
"""
import importlib.util
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

import live_store_adapters as live


def worker_module():
    spec = importlib.util.spec_from_file_location("release_guard", Path(__file__).with_name("cloud_release_worker.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def unpack_upload(archive, private):
    with zipfile.ZipFile(archive) as source:
        live.demand(len(source.infolist()) == 1 and source.infolist()[0].filename == "receipt.json"
                    and 0 < source.infolist()[0].file_size <= 16384, "LIVE_UPLOAD_RECEIPT_SIZE")
    target = private / "upload-receipt"
    target.mkdir(mode=0o700)
    worker_module().safe_unzip(archive, target, exact_names=["receipt.json"])
    raw = (target / "receipt.json").read_bytes()
    live.demand(len(raw) <= 16384, "LIVE_UPLOAD_RECEIPT_SIZE")
    return json.loads(raw)


def parent_authorizer():
    sequence = 0
    def authorize(request):
        nonlocal sequence
        sequence += 1
        print(json.dumps({"kind": "authorize", "sequence": sequence, "request": request}), flush=True)
        line = sys.stdin.buffer.readline(16385)
        live.demand(0 < len(line) <= 16384, "LIVE_PARENT_UNAVAILABLE")
        response = json.loads(line)
        live.demand(set(response) == {"sequence", "authorized", "authorizationExpiresAt"}
                    and response["sequence"] == sequence and response["authorized"] is True, "LIVE_PARENT_DENIED")
        deadline = datetime.datetime.fromisoformat(response["authorizationExpiresAt"].replace("Z", "+00:00"))
        live.demand(deadline > datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2),
                    "LIVE_PARENT_AUTHORIZATION_BUDGET")
        return True
    return authorize


def provider_token(root, provider, credentials=None):
    result = subprocess.run(["node", str(root / "scripts/store-token.cjs"), provider],
                            cwd=root, env={**os.environ, **(credentials or {})},
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90, check=False)
    live.demand(result.returncode == 0 and len(result.stdout) <= 32768, "LIVE_STORE_AUTHENTICATION")
    value = json.loads(result.stdout)
    live.demand(set(value) == {"token"} and isinstance(value["token"], str), "LIVE_STORE_TOKEN")
    return value["token"]


def execute(context, root, private):
    request, provider, upload = context["request"], context["provider"], context["uploadReceipt"]
    live.demand(os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted",
                "LIVE_HOSTED_RUNTIME")
    live.demand(os.environ.get("KEEPER_EXPECTED_CERT_SHA256") == request["identitySha256"] and
                os.environ.get("KEEPER_EXPECTED_CONFIG_SHA256") == request["configSha256"], "LIVE_PROTECTED_IDENTITIES")
    credential_names = (("KEEPER_ASC_KEY_ID", "KEEPER_ASC_ISSUER_ID", "KEEPER_ASC_KEY_BASE64")
                        if request["operation"].startswith("ios-") else ("KEEPER_PLAY_SERVICE_ACCOUNT",))
    credentials = {name: os.environ.pop(name) for name in credential_names if name in os.environ}
    authorize = parent_authorizer()
    live.demand(authorize(provider) is True, "LIVE_PARENT_DENIED")
    ios = request["operation"].startswith("ios-")
    artifact = private / "input" / ("release.ipa" if ios else "release.aab")
    guard = worker_module()
    guard.verify_artifact(artifact, request, root, private)
    live.demand(guard.digest(artifact) == request["artifactSha256"], "LIVE_ARTIFACT_CHANGED")
    guard.run(["git", "diff", "HEAD", "--exit-code"], cwd=root)
    api = live.StoreAPI("ios" if ios else "play", provider_token(root, "ios" if ios else "play", credentials))
    credentials.clear()
    mode = json.loads(request["liveParameters"])["mode"]
    if mode == "inspect":
        if ios:
            result = live.plan_ios(api, provider, upload)
        else:
            live.demand(authorize(provider) is True, "LIVE_PARENT_DENIED")
            edit_id = api("POST", live.PLAY_ROOT, {})["id"]
            try:
                result = live.plan_play(api, provider, upload, edit_id)
            finally:
                live.delete_edit(api, edit_id)
    else:
        result = (live.execute_ios if ios else live.execute_play)(api, provider, upload, authorize)
    live.demand(guard.digest(artifact) == request["artifactSha256"], "LIVE_ARTIFACT_CHANGED")
    output = Path(os.environ["RUNNER_TEMP"]) / "keeper-release-output"
    output.mkdir(mode=0o700)
    receipt = {**result, "schema": 1, "sourceSha": request["sourceSha"], "driverSha": request["driverSha"],
               "version": request["version"], "build": request["build"], "artifactSha256": request["artifactSha256"],
               "identitySha256": request["identitySha256"], "configSha256": request["configSha256"],
               "uploadRunId": upload["runId"], "uploadRunAttempt": upload["runAttempt"],
               "uploadedReceiptArtifactId": request["artifactId"], "mode": mode,
               "physicalAcceptance": "NOT_RUN_NOT_WAIVED", "publicReleaseReady": False}
    receipt.update(guard.repository_receipt(request))
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps({"kind": "result", "value": result}), flush=True)


def main():
    try:
        if len(sys.argv) == 4 and sys.argv[1] == "unpack-upload":
            print(json.dumps(unpack_upload(Path(sys.argv[2]), Path(sys.argv[3]))))
            return 0
        live.demand(len(sys.argv) == 4, "LIVE_CHILD_ARGUMENTS")
        context_path, root, private = map(Path, sys.argv[1:])
        live.demand(context_path.stat().st_size <= 32768, "LIVE_CHILD_CONTEXT")
        execute(json.loads(context_path.read_text()), root, private)
        return 0
    except Exception:
        print("Live store operation incomplete; inspect actual provider state before any resumption.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
