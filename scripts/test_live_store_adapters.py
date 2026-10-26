"""Offline provider contracts only. No tokens, store access or signed bytes."""
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
import urllib.error

SPEC = importlib.util.spec_from_file_location("live", Path(__file__).with_name("live_store_adapters.py"))
live = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(live)


def resource(kind, identifier, **attributes):
    return {"type": kind, "id": identifier, "attributes": attributes}


def inputs(operation):
    request = {"operation": operation, "sourceSha": "a" * 40, "artifactSha256": "b" * 64,
               "identitySha256": "c" * 64, "configSha256": "d" * 64, "version": "2.6.5", "build": "628",
               "uploadRunId": "123", "uploadRunAttempt": "1", "appId": "1234",
               "appStoreVersionId": "version-1", "buildId": "build-1", "reviewSubmissionId": "review-1"}
    receipt = {key: request[key] for key in ("sourceSha", "artifactSha256", "identitySha256", "configSha256", "version", "build")}
    receipt.update(schema=1, signatureVerified=True, storeUploaded=True, runId="123", runAttempt=1,
                   operation="testflight-upload" if operation.startswith("ios-") else "play-internal-upload")
    return request, receipt


class Apple:
    def __init__(self, release=False):
        self.calls = []
        self.after_mutation = False
        self.app = resource("apps", "1234", bundleId=live.IOS_APP)
        self.version = resource("appStoreVersions", "version-1", platform="IOS", versionString="2.6.5",
                                releaseType="MANUAL", appVersionState="PENDING_DEVELOPER_RELEASE" if release else "READY_FOR_REVIEW")
        self.build = resource("builds", "build-1", version="628", processingState="VALID", expired=False)
        self.prerelease = resource("preReleaseVersions", "pre-1", version="2.6.5", platform="IOS")
        self.review = resource("reviewSubmissions", "review-1", platform="IOS", state="READY_FOR_REVIEW")
        self.items = [resource("reviewSubmissionItems", "item-1")]
        self.items[0]["relationships"] = {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": "version-1"}},
                                          "appEvent": {"data": None}}
        self.pagination = False
        self.lose_reply = False
        self.readback_wrong = False
        self.readback_pending = False

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, copy.deepcopy(body)))
        if method == "PATCH":
            self.after_mutation = True
            if not self.readback_pending:
                self.review["attributes"]["state"] = "WAITING_FOR_REVIEW"
            if self.lose_reply:
                raise live.ProviderError()
            return {"data": self.review}
        if method == "POST":
            self.after_mutation = True
            if not self.readback_pending:
                self.version["attributes"]["appVersionState"] = "PENDING_APPLE_RELEASE"
            return {"data": resource("appStoreVersionReleaseRequests", "release-1")}
        values = {
            "/v1/apps/1234": self.app,
            "/v1/appStoreVersions/version-1": self.version,
            "/v1/appStoreVersions/version-1/app": self.app,
            "/v1/appStoreVersions/version-1/build": self.build,
            "/v1/builds/build-1/app": self.app,
            "/v1/builds/build-1/preReleaseVersion": self.prerelease,
            "/v1/appStoreVersions/version-1/appStoreVersionPhasedRelease": None,
            "/v1/apps/1234/reviewSubmissions?limit=200": [self.review],
            "/v1/reviewSubmissions/review-1/items?include=appStoreVersion,appEvent,appCustomProductPageVersion,appStoreVersionExperiment&limit=200": self.items,
        }
        value = copy.deepcopy(values[path])
        if self.readback_wrong and self.after_mutation and path.endswith("/build"):
            value["id"] = "other-build"
        result = {"data": value}
        if self.pagination and isinstance(value, list):
            result["links"] = {"next": "https://never-follow.invalid"}
        return result

    def writes(self):
        return [row for row in self.calls if row[0] != "GET"]


class Play:
    def __init__(self):
        self.calls = []
        self.bundle = {"versionCode": 628, "sha256": "b" * 64, "sha1": "e" * 40}
        self.internal = {"track": "internal", "releases": [{"name": "2.6.5", "versionCodes": ["628"],
                                                              "status": "draft", "releaseNotes": [{"language": "en-US", "text": "Reviewed notes"}]}]}
        self.production = {"track": "production", "releases": [{"versionCodes": ["627"], "status": "completed"}]}
        self.edits = {}
        self.next_id = 1
        self.fail_validate = False
        self.fail_commit = False
        self.fail_cleanup = False
        self.fail_readback = False
        self.readback_pending = False
        self.old_production = copy.deepcopy(self.production)

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, copy.deepcopy(body)))
        if method == "POST" and path == live.PLAY_ROOT:
            identifier = "edit-" + str(self.next_id)
            self.next_id += 1
            self.edits[identifier] = copy.deepcopy(self.production)
            return {"id": identifier}
        identifier = path.removeprefix(live.PLAY_ROOT + "/").split("/")[0].split(":")[0]
        if method == "DELETE":
            if self.fail_cleanup:
                raise live.ProviderError(403)
            self.edits.pop(identifier, None)
            return {}
        if method == "POST" and ":validate" in path:
            if self.fail_validate:
                raise live.ProviderError(400)
            return {}
        if method == "POST" and ":commit" in path:
            self.production = self.edits.pop(identifier)
            if self.fail_commit:
                raise live.ProviderError()
            return {}
        if method == "PUT":
            self.edits[identifier] = copy.deepcopy(body)
            return body
        if path.endswith("/bundles"):
            return {"bundles": [copy.deepcopy(self.bundle)]}
        if path.endswith("/tracks/internal"):
            return copy.deepcopy(self.internal)
        if path.endswith("/tracks/production"):
            result = copy.deepcopy(self.edits[identifier])
            if self.readback_pending and identifier == "edit-2":
                result = copy.deepcopy(self.old_production)
            if self.fail_readback and identifier == "edit-2":
                result["releases"][0]["versionCodes"] = ["629"]
            return result
        raise AssertionError("Unexpected fake provider request")

    def preview(self, request, receipt):
        identifier = self("POST", live.PLAY_ROOT, {})["id"]
        plan = live.plan_play(self, request, receipt, identifier)
        live.delete_edit(self, identifier)
        self.calls.clear()
        self.next_id = 1
        return plan


class LiveAdapters(unittest.TestCase):
    def apple(self, operation="ios-submit-review"):
        request, receipt = inputs(operation)
        api = Apple(operation == "ios-release-approved-version")
        request["storeSnapshotSha256"] = live.plan_ios(api, request, receipt)["storeSnapshotSha256"]
        api.calls.clear()
        return api, request, receipt

    def play(self):
        request, receipt = inputs("play-production-rollout")
        api = Play()
        request["storeSnapshotSha256"] = api.preview(request, receipt)["storeSnapshotSha256"]
        return api, request, receipt

    def test_ios_preview_is_get_only_without_human_comment_or_reviewer(self):
        api, request, receipt = self.apple()
        plan = live.plan_ios(api, request, receipt)
        self.assertFalse(plan["mutationPerformed"])
        self.assertEqual([], api.writes())
        self.assertNotIn("approvalCommentId", request)

    def test_submit_exact_existing_version_one_mutation_no_upload_or_release(self):
        api, request, receipt = self.apple()
        result = live.execute_ios(api, request, receipt, lambda bound: bound == request)
        self.assertEqual("WAITING_FOR_REVIEW", result["providerState"])
        self.assertFalse(result["publicAvailabilityVerified"])
        self.assertEqual([("PATCH", "/v1/reviewSubmissions/review-1", {"data": {
            "type": "reviewSubmissions", "id": "review-1", "attributes": {"submitted": True}}})], api.writes())

    def test_release_approved_existing_version_is_separate_no_rebuild(self):
        api, request, receipt = self.apple("ios-release-approved-version")
        result = live.execute_ios(api, request, receipt, lambda _: True)
        self.assertFalse(result["rebuiltOrResigned"])
        self.assertEqual("POST", api.writes()[0][0])
        self.assertEqual("/v1/appStoreVersionReleaseRequests", api.writes()[0][1])

    def test_no_runtime_authorization_no_store_mutation(self):
        for operation in ("ios-submit-review", "ios-release-approved-version", "play-production-rollout"):
            api, request, receipt = self.play() if operation.startswith("play") else self.apple(operation)
            execute = live.execute_play if operation.startswith("play") else live.execute_ios
            with self.assertRaisesRegex(ValueError, "LIVE_AUTHORIZATION_REQUIRED"):
                execute(api, request, receipt, lambda _: False)
            self.assertFalse(any(row[0] != "GET" for row in api.calls))

    def test_ios_selected_identity_and_ready_state_fail_before_mutation(self):
        mutations = [lambda api: api.app["attributes"].update(bundleId="other.app"),
                     lambda api: api.version["attributes"].update(versionString="2.6.6"),
                     lambda api: api.version["attributes"].update(releaseType="AFTER_APPROVAL"),
                     lambda api: api.build["attributes"].update(processingState="PROCESSING"),
                     lambda api: api.build["attributes"].update(expired=True),
                     lambda api: api.prerelease["attributes"].update(version="2.6.4"),
                     lambda api: api.items.append(copy.deepcopy(api.items[0])),
                     lambda api: api.items[0]["relationships"].update(appEvent={"data": {"type": "appEvents", "id": "event"}}),
                     lambda api: api.items[0]["relationships"].update(appEvent={"links": {"related": "unobserved"}}),
                     lambda api: setattr(api, "pagination", True)]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                api, request, receipt = self.apple()
                mutate(api)
                with self.assertRaises(ValueError):
                    live.execute_ios(api, request, receipt, lambda _: True)
                self.assertEqual([], api.writes())

    def test_provider_drift_during_authorization_is_rejected(self):
        api, request, receipt = self.apple()
        def changed(_):
            api.version["attributes"]["copyright"] = "changed during authorization"
            return True
        with self.assertRaisesRegex(ValueError, "LIVE_STORE_DRIFT"):
            live.execute_ios(api, request, receipt, changed)
        self.assertEqual([], api.writes())

    def test_wrong_upload_receipt_or_snapshot_is_not_publication_authority(self):
        for field, value in (("artifactSha256", "f" * 64), ("sourceSha", "f" * 40),
                             ("runAttempt", 2), ("signatureVerified", False)):
            api, request, receipt = self.apple()
            receipt[field] = value
            with self.assertRaises(ValueError):
                live.execute_ios(api, request, receipt, lambda _: True)
            self.assertEqual([], api.writes())
        api, request, receipt = self.apple()
        request["storeSnapshotSha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "LIVE_STORE_DRIFT"):
            live.execute_ios(api, request, receipt, lambda _: True)
        self.assertEqual([], api.writes())

    def test_lost_submission_reply_never_retries_or_claims_success(self):
        api, request, receipt = self.apple()
        api.lose_reply = True
        with self.assertRaises(live.ProviderError):
            live.execute_ios(api, request, receipt, lambda _: True)
        self.assertEqual(1, len(api.writes()))

    def test_post_submission_wrong_build_is_failure(self):
        api, request, receipt = self.apple()
        api.readback_wrong = True
        with self.assertRaisesRegex(ValueError, "LIVE_PROVIDER_IDENTITY"):
            live.execute_ios(api, request, receipt, lambda _: True)
        self.assertEqual(1, len(api.writes()))

    def test_async_apple_state_reports_accepted_pending_without_duplicate_mutation(self):
        for operation in ("ios-submit-review", "ios-release-approved-version"):
            api, request, receipt = self.apple(operation)
            api.readback_pending = True
            result = live.execute_ios(api, request, receipt, lambda _: True)
            self.assertTrue(result["mutationPerformed"])
            self.assertFalse(result["providerReadbackVerified"])
            self.assertEqual("READ_ONLY_STORE_INSPECTION", result["continuation"])
            self.assertEqual(1, len(api.writes()))

    def test_play_get_only_preview_and_owned_commit_promote_same_bundle(self):
        api, request, receipt = self.play()
        result = live.execute_play(api, request, receipt, lambda bound: bound == request)
        self.assertEqual("completed", result["providerState"])
        self.assertFalse(result["publicAvailabilityVerified"])
        self.assertEqual({}, api.edits)
        writes = [row for row in api.calls if row[0] == "PUT"]
        self.assertEqual(1, len(writes))
        self.assertEqual(["628"], writes[0][2]["releases"][0]["versionCodes"])
        self.assertEqual("completed", writes[0][2]["releases"][0]["status"])
        self.assertEqual(1, sum(":commit?changesNotSentForReview=false" in row[1] for row in api.calls))
        self.assertFalse(any("upload" in row[1] for row in api.calls))

    def test_play_preview_only_reads_existing_edit(self):
        api, request, receipt = self.play()
        edit_id = api("POST", live.PLAY_ROOT, {})["id"]
        api.calls.clear()
        live.plan_play(api, request, receipt, edit_id)
        self.assertTrue(all(row[0] == "GET" for row in api.calls))
        live.delete_edit(api, edit_id)

    def test_play_multi_code_wrong_hash_active_rollout_and_newer_release_are_blocked(self):
        changes = [lambda api: api.bundle.update(sha256="f" * 64),
                   lambda api: api.internal["releases"][0].update(versionCodes=["628", "620"]),
                   lambda api: api.internal["releases"][0].update(countryTargeting={"countries": ["US"]}),
                   lambda api: api.production["releases"][0].update(status="inProgress"),
                   lambda api: api.production["releases"][0].update(versionCodes=["629"])]
        for change in changes:
            with self.subTest(change=change):
                api, request, receipt = self.play()
                change(api)
                with self.assertRaises(ValueError):
                    live.execute_play(api, request, receipt, lambda _: True)
                self.assertEqual({}, api.edits)
                self.assertFalse(any(row[0] == "PUT" or ":commit" in row[1] for row in api.calls))

    def test_play_validate_failure_cleans_owned_edit_without_commit(self):
        api, request, receipt = self.play()
        api.fail_validate = True
        with self.assertRaises(live.ProviderError):
            live.execute_play(api, request, receipt, lambda _: True)
        self.assertEqual({}, api.edits)
        self.assertFalse(any(":commit" in row[1] for row in api.calls))

    def test_play_failed_commit_reply_never_retries_even_if_store_committed(self):
        api, request, receipt = self.play()
        api.fail_commit = True
        with self.assertRaises(live.ProviderError):
            live.execute_play(api, request, receipt, lambda _: True)
        self.assertEqual(1, sum(":commit" in row[1] for row in api.calls))

    def test_play_readback_failure_is_not_success_and_cleans_inspection_edit(self):
        api, request, receipt = self.play()
        api.fail_readback = True
        with self.assertRaisesRegex(ValueError, "LIVE_PLAY_COMMIT_READBACK_UNVERIFIED"):
            live.execute_play(api, request, receipt, lambda _: True)
        self.assertEqual({}, api.edits)

    def test_async_play_readback_preserves_commit_and_requires_only_inspection(self):
        api, request, receipt = self.play()
        api.readback_pending = True
        result = live.execute_play(api, request, receipt, lambda _: True)
        self.assertTrue(result["mutationPerformed"])
        self.assertFalse(result["providerReadbackVerified"])
        self.assertEqual("READ_ONLY_STORE_INSPECTION", result["continuation"])
        self.assertEqual(1, sum(":commit" in row[1] for row in api.calls))
        self.assertEqual({}, api.edits)

    def test_play_lost_authorization_before_commit_aborts_uncommitted_changes(self):
        api, request, receipt = self.play()
        authorizations = iter([True, True, False])
        with self.assertRaisesRegex(ValueError, "LIVE_AUTHORIZATION_REQUIRED"):
            live.execute_play(api, request, receipt, lambda _: next(authorizations))
        self.assertEqual({}, api.edits)
        self.assertFalse(any(":commit" in row[1] for row in api.calls))

    def test_cleanup_only_treats_404_as_already_absent(self):
        for status in (404, 403):
            api = Mock(side_effect=live.ProviderError(status))
            if status == 404:
                live.delete_edit(api, "owned-1")
            else:
                with self.assertRaises(live.ProviderError):
                    live.delete_edit(api, "owned-1")

    def test_fixed_origin_transport_rejects_redirect_and_does_not_leak_token(self):
        api = live.StoreAPI("ios", "synthetic-token")
        for path in ("https://other.invalid/v1/apps", "/v1/../other", "/v1/apps#fragment", "/v1/apps\r\nHeader:bad"):
            with self.assertRaises(ValueError):
                api("GET", path)
        self.assertIsNone(live.NoRedirect().redirect_request(None, None, 302, None, None, "https://other.invalid"))
        error = urllib.error.HTTPError("https://api.appstoreconnect.apple.com/v1/apps", 403, "secret payload", {}, None)
        api._opener = Mock()
        api._opener.open.side_effect = error
        with self.assertRaises(live.ProviderError) as result:
            api("GET", "/v1/apps")
        self.assertEqual("LIVE_PROVIDER_REQUEST_FAILED_NO_RETRY", str(result.exception))
        self.assertEqual(403, result.exception.status)
        self.assertEqual(1, api._opener.open.call_count)


if __name__ == "__main__":
    unittest.main()
