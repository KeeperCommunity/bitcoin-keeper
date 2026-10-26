"""Offline real child/adapter flow; native/provider/credential boundaries fake."""
import copy
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

import live_store_worker as worker
from test_live_store_adapters import Apple, Play, inputs


class LiveWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.private = self.root / "private"
        (self.private / "input").mkdir(parents=True)

    def tearDown(self):
        self.temporary.cleanup()

    def context(self, operation, mode="execute"):
        provider, receipt = inputs(operation)
        api = Play() if operation.startswith("play-") else Apple(operation == "ios-release-approved-version")
        if operation.startswith("play-"):
            provider["storeSnapshotSha256"] = api.preview(provider, receipt)["storeSnapshotSha256"]
        else:
            provider["storeSnapshotSha256"] = worker.live.plan_ios(api, provider, receipt)["storeSnapshotSha256"]
        request = {**provider, "driverSha": provider["sourceSha"], "artifactId": "88",
                   "liveParameters": json.dumps({"mode": mode})}
        guard = Mock()
        guard.repository_receipt = worker.worker_module().repository_receipt
        guard.digest.return_value = provider["artifactSha256"]
        return {"request": request, "provider": provider, "uploadReceipt": receipt, "signedReceipt": {}}, api, guard

    def execute(self, context, api, guard, authorize):
        environment = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_TEMP": str(self.root),
                       "KEEPER_EXPECTED_CERT_SHA256": context["request"]["identitySha256"],
                       "KEEPER_EXPECTED_CONFIG_SHA256": context["request"]["configSha256"]}
        with patch.dict(os.environ, environment, clear=True), patch.object(worker, "worker_module", return_value=guard), \
                patch.object(worker, "parent_authorizer", return_value=authorize), \
                patch.object(worker, "provider_token", return_value="synthetic-token") as token, \
                patch.object(worker.live, "StoreAPI", return_value=api), patch("sys.stdout", new_callable=io.StringIO) as output:
            self.last_token = token
            worker.execute(context, self.root, self.private)
        result = json.loads(output.getvalue().splitlines()[-1])
        return result, token

    def test_private_child_receipt_preserves_actual_repository_custody(self):
        context, api, guard = self.context("ios-submit-review")
        context["request"]["repository"] = "KeeperCommunity/bitcoin-keeper-private"
        self.execute(context, api, guard, Mock(return_value=True))
        receipt = json.loads((self.root / "keeper-release-output/receipt.json").read_text())
        self.assertEqual(receipt["repository"], "KeeperCommunity/bitcoin-keeper-private")
        self.assertEqual(receipt["repositoryId"], 839671816)
        self.assertTrue(receipt["repositoryPrivate"])

    def test_all_three_actual_child_adapter_flows_preserve_identity_without_upload_or_sign(self):
        for operation in ("ios-submit-review", "ios-release-approved-version", "play-production-rollout"):
            with self.subTest(operation=operation):
                context, api, guard = self.context(operation)
                authorize = Mock(return_value=True)
                result, token = self.execute(context, api, guard, authorize)
                self.assertEqual(operation, result["value"]["operation"])
                self.assertFalse(result["value"]["publicAvailabilityVerified"])
                self.assertTrue(result["value"]["mutationPerformed"])
                guard.verify_artifact.assert_called_once()
                guard.run.assert_called_once()
                token.assert_called_once()
                self.assertGreaterEqual(authorize.call_count, 2)
                receipt = json.loads((self.root / "keeper-release-output/receipt.json").read_text())
                self.assertEqual(context["request"]["sourceSha"], receipt["sourceSha"])
                self.assertEqual("88", receipt["uploadedReceiptArtifactId"])
                self.assertEqual("123", receipt["uploadRunId"])
                for p in (self.root / "keeper-release-output").iterdir(): p.unlink()
                (self.root / "keeper-release-output").rmdir()

    def test_real_inspection_path_never_performs_publication_mutation(self):
        for operation in ("ios-submit-review", "play-production-rollout"):
            context, api, guard = self.context(operation, "inspect")
            result, _ = self.execute(context, api, guard, Mock(return_value=True))
            self.assertFalse(result["value"]["mutationPerformed"])
            self.assertFalse(any(row[0] in ("PUT", "PATCH") or ":commit" in row[1] for row in api.calls))
            if operation.startswith("play-"): self.assertEqual({}, api.edits)
            for p in (self.root / "keeper-release-output").iterdir(): p.unlink()
            (self.root / "keeper-release-output").rmdir()

    def test_parent_denial_precedes_store_authentication_and_native_verification(self):
        context, api, guard = self.context("ios-submit-review")
        with self.assertRaisesRegex(ValueError, "DENIED"):
            self.execute(context, api, guard, Mock(side_effect=ValueError("DENIED")))
        guard.verify_artifact.assert_not_called()
        self.assertFalse((self.root / "keeper-release-output").exists())

    def test_native_artifact_signature_failure_precedes_store_token(self):
        context, api, guard = self.context("ios-submit-review")
        guard.verify_artifact.side_effect = ValueError("SIGNATURE")
        with self.assertRaisesRegex(ValueError, "SIGNATURE"):
            self.execute(context, api, guard, Mock(return_value=True))
        self.last_token.assert_not_called()
        self.assertEqual([], api.writes())

    def test_private_pipe_rejects_copied_or_wrong_sequence_authorization(self):
        future = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=3)).isoformat()
        for response in ({"sequence": 2, "authorized": True, "authorizationExpiresAt": future},
                         {"sequence": 1, "authorized": False, "authorizationExpiresAt": future},
                         {"sequence": 1, "authorized": True},
                         {"sequence": 1, "authorized": True, "authorizationExpiresAt": "2000-01-01T00:00:00Z"}):
            stdin = Mock(buffer=io.BytesIO((json.dumps(response) + "\n").encode()))
            with patch("sys.stdin", stdin), patch("sys.stdout", new_callable=io.StringIO), self.assertRaises(ValueError):
                worker.parent_authorizer()({"operation": "ios-submit-review"})

    def test_upload_archive_requires_only_one_small_receipt(self):
        for files in ({"receipt.json": "{}"}, {"receipt.json": "{}", "other": "forbidden"}, {"../receipt.json": "{}"}):
            destination = self.root / ("archive-" + str(len(list(self.root.glob('archive-*')))) + ".zip")
            with zipfile.ZipFile(destination, "w") as archive:
                for name, text in files.items(): archive.writestr(name, text)
            private = self.root / (destination.stem + "-private"); private.mkdir()
            if list(files) == ["receipt.json"]:
                self.assertEqual({}, worker.unpack_upload(destination, private))
            else:
                with self.assertRaises(ValueError): worker.unpack_upload(destination, private)

    def test_token_helper_uses_only_existing_node_runtime_and_captures_errors(self):
        result = Mock(returncode=0, stdout=b'{"token":"synthetic"}', stderr=b'private')
        with patch.object(worker.subprocess, "run", return_value=result) as run:
            self.assertEqual("synthetic", worker.provider_token(self.root, "ios"))
            self.assertEqual(["node", str(self.root / "scripts/store-token.cjs"), "ios"], run.call_args.args[0])
        result.returncode = 1
        with patch.object(worker.subprocess, "run", return_value=result), self.assertRaisesRegex(ValueError, "AUTHENTICATION"):
            worker.provider_token(self.root, "play")


if __name__ == "__main__":
    unittest.main()
