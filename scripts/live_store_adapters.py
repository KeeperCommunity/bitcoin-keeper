"""Unconnected live-store continuation; never builds, signs or uploads bytes.

The installed authorization driver must verify the upload receipt's provenance,
native/security acceptance and current runtime release authorization before
calling these functions. ``authorize`` revalidates that authorization, including
the exact operation/source/artifact and provider snapshot, immediately before mutations.
Human comments/reviewers are optional policy; this module requires neither.
This module cannot mint that authority, and has deliberately no CLI/workflow.
Store credentials belong only to the caller's authenticated JSON API client.
No provider exception/response, credential or release metadata is logged here.
"""
import copy
import hashlib
import json
import re
import urllib.error
import urllib.request

IOS_APP = "io.hexawallet.keeper"
PLAY_APP = "io.hexawallet.bitcoinkeeper"


class ProviderError(RuntimeError):
    def __init__(self, status=None):
        super().__init__("LIVE_PROVIDER_REQUEST_FAILED_NO_RETRY")
        self.status = status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class StoreAPI:
    """Fixed-origin JSON transport for an already authorized short-lived token.

    Token acquisition/custody stays with the existing protected caller. No
    redirects, provider fallbacks or mutation retries are performed. A failed
    mutation can have an unknown outcome: inspect store state before any rerun.
    """
    def __init__(self, provider, bearer_token):
        demand(provider in ("ios", "play") and isinstance(bearer_token, str)
               and bearer_token and not re.search(r"[\r\n]", bearer_token), "LIVE_PROVIDER_CLIENT")
        self._origin = {"ios": "https://api.appstoreconnect.apple.com",
                        "play": "https://androidpublisher.googleapis.com"}[provider]
        self._prefix = "/v1/" if provider == "ios" else "/androidpublisher/v3/applications/" + PLAY_APP + "/edits"
        self._token = bearer_token
        self._opener = urllib.request.build_opener(NoRedirect())

    def __call__(self, method, path, body=None):
        demand(method in ("GET", "POST", "PATCH", "PUT", "DELETE") and isinstance(path, str)
               and path.startswith(self._prefix) and not re.search(r"[\x00-\x20\x7f#]", path)
               and "://" not in path and ".." not in path and "//" not in path, "LIVE_PROVIDER_PATH")
        demand((method in ("GET", "DELETE")) == (body is None), "LIVE_PROVIDER_BODY")
        data = None if body is None else json.dumps(body, allow_nan=False).encode()
        request = urllib.request.Request(self._origin + path, data=data, method=method,
                                         headers={"Authorization": "Bearer " + self._token,
                                                  "Accept": "application/json", "Content-Type": "application/json"})
        try:
            with self._opener.open(request, timeout=30) as response:
                demand(200 <= response.status < 300, "LIVE_PROVIDER_HTTP")
                raw = response.read(4 * 1024 * 1024 + 1)
                demand(len(raw) <= 4 * 1024 * 1024, "LIVE_PROVIDER_RESPONSE_LIMIT")
                value = json.loads(raw) if raw else {}
                demand(isinstance(value, dict), "LIVE_PROVIDER_JSON")
                return value
        except urllib.error.HTTPError as error:
            raise ProviderError(error.code) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ProviderError() from None


def demand(value, code):
    if not value:
        raise ValueError(code)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def selected(request, upload_receipt, operation):
    """Consistency only: receipt authentication remains the installed driver's job."""
    demand(isinstance(request, dict) and request.get("operation") == operation, "LIVE_OPERATION")
    for name, pattern in (("sourceSha", r"[a-f0-9]{40}"), ("artifactSha256", r"[a-f0-9]{64}"),
                          ("identitySha256", r"[a-f0-9]{64}"), ("configSha256", r"[a-f0-9]{64}"),
                          ("version", r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"),
                          ("build", r"[1-9][0-9]{0,9}")):
        demand(isinstance(request.get(name), str) and re.fullmatch(pattern, request[name]), "LIVE_IDENTITY")
    demand(int(request["build"]) <= 2100000000, "LIVE_BUILD")
    demand(upload_receipt.get("schema") == 1 and upload_receipt.get("signatureVerified") is True
           and upload_receipt.get("storeUploaded") is True, "LIVE_UPLOAD_RECEIPT")
    ios = operation.startswith("ios-")
    demand(upload_receipt.get("operation") == ("testflight-upload" if ios else "play-internal-upload"),
           "LIVE_UPLOAD_OPERATION")
    for name in ("sourceSha", "version", "build", "artifactSha256", "identitySha256", "configSha256"):
        demand(upload_receipt.get(name) == request[name], "LIVE_UPLOAD_IDENTITY")
    demand(str(upload_receipt.get("runId")) == request.get("uploadRunId")
           and str(upload_receipt.get("runAttempt")) == request.get("uploadRunAttempt"), "LIVE_UPLOAD_RUN")


def authorized(authorize, request):
    demand(callable(authorize) and authorize(copy.deepcopy(request)) is True, "LIVE_AUTHORIZATION_REQUIRED")


def resource(value, kind, identifier=None):
    demand(isinstance(value, dict) and value.get("type") == kind
           and isinstance(value.get("id"), str), "LIVE_PROVIDER_RESOURCE")
    if identifier is not None:
        demand(value["id"] == identifier, "LIVE_PROVIDER_IDENTITY")
    return value


def collection(api, path):
    result = api("GET", path)
    demand(isinstance(result.get("data"), list)
           and not result.get("links", {}).get("next"), "LIVE_PROVIDER_PAGINATION")
    return result["data"]


def ios_snapshot(api, request, *, submission):
    ids = [request.get(name) for name in ("appId", "appStoreVersionId", "buildId")]
    demand(all(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9-]{1,100}", value) for value in ids),
           "LIVE_IOS_RESOURCE_ID")
    app_id, version_id, build_id = ids
    app = resource(api("GET", "/v1/apps/" + app_id)["data"], "apps", app_id)
    demand(app.get("attributes", {}).get("bundleId") == IOS_APP, "LIVE_IOS_APP")
    version = resource(api("GET", "/v1/appStoreVersions/" + version_id)["data"], "appStoreVersions", version_id)
    resource(api("GET", "/v1/appStoreVersions/" + version_id + "/app")["data"], "apps", app_id)
    attrs = version.get("attributes", {})
    demand(attrs.get("platform") == "IOS" and attrs.get("versionString") == request["version"]
           and attrs.get("releaseType") == "MANUAL", "LIVE_IOS_VERSION_RELEASE_MODE")
    build = resource(api("GET", "/v1/appStoreVersions/" + version_id + "/build")["data"], "builds", build_id)
    demand(build.get("attributes", {}).get("version") == request["build"]
           and build["attributes"].get("processingState") == "VALID"
           and build["attributes"].get("expired") is False, "LIVE_IOS_BUILD")
    resource(api("GET", "/v1/builds/" + build_id + "/app")["data"], "apps", app_id)
    prerelease = resource(api("GET", "/v1/builds/" + build_id + "/preReleaseVersion")["data"], "preReleaseVersions")
    demand(prerelease.get("attributes", {}).get("version") == request["version"]
           and prerelease["attributes"].get("platform") == "IOS", "LIVE_IOS_BUILD_VERSION")
    try:
        phased = api("GET", "/v1/appStoreVersions/" + version_id + "/appStoreVersionPhasedRelease").get("data")
    except ProviderError as error:
        if error.status != 404:
            raise
        phased = None
    if phased is not None:
        resource(phased, "appStoreVersionPhasedReleases")
    result = {"app": app, "version": version, "build": build, "preReleaseVersion": prerelease,
              "phasedRelease": phased}
    if submission:
        review_id = request.get("reviewSubmissionId")
        demand(isinstance(review_id, str) and re.fullmatch(r"[A-Za-z0-9-]{1,100}", review_id), "LIVE_REVIEW_ID")
        reviews = collection(api, "/v1/apps/" + app_id + "/reviewSubmissions?limit=200")
        matches = [row for row in reviews if row.get("id") == review_id]
        demand(len(matches) == 1, "LIVE_REVIEW_APP")
        review = resource(matches[0], "reviewSubmissions", review_id)
        demand(review.get("attributes", {}).get("platform") == "IOS", "LIVE_REVIEW_PLATFORM")
        items = collection(api, "/v1/reviewSubmissions/" + review_id +
                           "/items?include=appStoreVersion,appEvent,appCustomProductPageVersion,appStoreVersionExperiment&limit=200")
        demand(len(items) == 1, "LIVE_REVIEW_EXTRA_ITEMS")
        item = resource(items[0], "reviewSubmissionItems")
        relations = item.get("relationships", {})
        demand(relations.get("appStoreVersion", {}).get("data") == {"type": "appStoreVersions", "id": version_id}
               and all("data" in value and value["data"] in (None, []) for key, value in relations.items()
                       if key not in ("appStoreVersion", "reviewSubmission")), "LIVE_REVIEW_ITEM_IDENTITY")
        result.update(review=review, items=items)
    return result


def plan_ios(api, request, upload_receipt):
    operation = request.get("operation")
    demand(operation in ("ios-submit-review", "ios-release-approved-version"), "LIVE_OPERATION")
    selected(request, upload_receipt, operation)
    snapshot = ios_snapshot(api, request, submission=operation == "ios-submit-review")
    attrs = snapshot["version"]["attributes"]
    state = attrs.get("appVersionState") or attrs.get("appStoreState")
    if operation == "ios-submit-review":
        demand(snapshot["review"]["attributes"].get("state") == "READY_FOR_REVIEW"
               and state in ("PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW"), "LIVE_REVIEW_NOT_READY")
    else:
        demand(state == "PENDING_DEVELOPER_RELEASE", "LIVE_IOS_NOT_APPROVED")
    return {"operation": operation, "storeSnapshotSha256": fingerprint(snapshot),
            "mutationPerformed": False, "publicAvailabilityVerified": False}


def execute_ios(api, request, upload_receipt, authorize):
    plan = plan_ios(api, request, upload_receipt)
    demand(request.get("storeSnapshotSha256") == plan["storeSnapshotSha256"], "LIVE_STORE_DRIFT")
    authorized(authorize, request)
    # Re-read after the potentially slow runtime authorization check.
    demand(plan_ios(api, request, upload_receipt) == plan, "LIVE_STORE_DRIFT")
    if request["operation"] == "ios-submit-review":
        identifier = request["reviewSubmissionId"]
        api("PATCH", "/v1/reviewSubmissions/" + identifier,
            {"data": {"type": "reviewSubmissions", "id": identifier, "attributes": {"submitted": True}}})
        after = ios_snapshot(api, request, submission=True)
        state = after["review"]["attributes"].get("state")
        verified = state in ("WAITING_FOR_REVIEW", "IN_REVIEW", "COMPLETE")
        demand(verified or state == "READY_FOR_REVIEW", "LIVE_SUBMISSION_READBACK_UNVERIFIED")
    else:
        api("POST", "/v1/appStoreVersionReleaseRequests", {"data": {
            "type": "appStoreVersionReleaseRequests", "relationships": {"appStoreVersion": {
                "data": {"type": "appStoreVersions", "id": request["appStoreVersionId"]}}}}})
        after = ios_snapshot(api, request, submission=False)
        attrs = after["version"]["attributes"]
        state = attrs.get("appVersionState") or attrs.get("appStoreState")
        verified = state in ("PENDING_APPLE_RELEASE", "PROCESSING_FOR_DISTRIBUTION", "PROCESSING_FOR_APP_STORE",
                             "READY_FOR_DISTRIBUTION", "READY_FOR_SALE")
        demand(verified or state == "PENDING_DEVELOPER_RELEASE", "LIVE_RELEASE_READBACK_UNVERIFIED")
    return {"operation": request["operation"], "artifactSha256": request["artifactSha256"],
            "storeBuildId": request["buildId"], "providerState": state,
            "mutationPerformed": True, "rebuiltOrResigned": False,
            "providerReadbackVerified": verified,
            "continuation": "READ_ONLY_STORE_INSPECTION" if not verified else "STORE_PROCESSING_OR_REVIEW",
            "publicAvailabilityVerified": False}


PLAY_ROOT = "/androidpublisher/v3/applications/" + PLAY_APP + "/edits"


def play_snapshot(api, request, edit_id):
    demand(isinstance(edit_id, str) and re.fullmatch(r"[A-Za-z0-9-]{1,100}", edit_id), "LIVE_PLAY_EDIT")
    base = PLAY_ROOT + "/" + edit_id
    bundles = api("GET", base + "/bundles").get("bundles")
    demand(isinstance(bundles, list), "LIVE_PLAY_BUNDLES")
    candidates = [row for row in bundles if str(row.get("versionCode")) == request["build"]]
    demand(len(candidates) == 1 and candidates[0].get("sha256") == request["artifactSha256"], "LIVE_PLAY_BUNDLE_IDENTITY")
    internal = api("GET", base + "/tracks/internal")
    production = api("GET", base + "/tracks/production")
    demand(internal.get("track") == "internal" and production.get("track") == "production", "LIVE_PLAY_TRACK")
    releases = internal.get("releases", [])
    demand(len(releases) == 1 and releases[0].get("versionCodes") == [request["build"]]
           and releases[0].get("status") in ("draft", "completed"), "LIVE_PLAY_INTERNAL_SELECTION")
    demand(set(releases[0]) <= {"name", "versionCodes", "status", "releaseNotes", "inAppUpdatePriority"},
           "LIVE_PLAY_UNREVIEWED_TARGETING")
    for release in production.get("releases", []):
        demand(release.get("status") == "completed" and release.get("versionCodes")
               and all(re.fullmatch(r"[1-9][0-9]*", value) and int(value) < int(request["build"])
                       for value in release["versionCodes"]), "LIVE_PLAY_ACTIVE_OR_NEWER_RELEASE")
    return {"bundle": candidates[0], "internal": internal, "production": production}


def delete_edit(api, edit_id):
    demand(isinstance(edit_id, str) and re.fullmatch(r"[A-Za-z0-9-]{1,100}", edit_id), "LIVE_PLAY_EDIT")
    try:
        api("DELETE", PLAY_ROOT + "/" + edit_id)
    except ProviderError as error:
        if error.status != 404:
            raise


def plan_play(api, request, upload_receipt, edit_id):
    """GET-only preview of a caller-owned temporary edit; never commits it."""
    selected(request, upload_receipt, "play-production-rollout")
    snapshot = play_snapshot(api, request, edit_id)
    return {"operation": request["operation"], "storeSnapshotSha256": fingerprint(snapshot),
            "mutationPerformed": False, "publicAvailabilityVerified": False}


def execute_play(api, request, upload_receipt, authorize):
    selected(request, upload_receipt, "play-production-rollout")
    authorized(authorize, request)  # Creation of the disposable edit also has runtime authorization.
    edit_id = api("POST", PLAY_ROOT, {}).get("id")
    committed = False
    try:
        snapshot = play_snapshot(api, request, edit_id)
        demand(request.get("storeSnapshotSha256") == fingerprint(snapshot), "LIVE_STORE_DRIFT")
        target = copy.deepcopy(snapshot["internal"]["releases"][0])
        target["status"] = "completed"
        authorized(authorize, request)
        demand(play_snapshot(api, request, edit_id) == snapshot, "LIVE_STORE_DRIFT")
        body = {"track": "production", "releases": [target]}
        api("PUT", PLAY_ROOT + "/" + edit_id + "/tracks/production", body)
        demand(api("GET", PLAY_ROOT + "/" + edit_id + "/tracks/production") == body,
               "LIVE_PLAY_EDIT_READBACK")
        api("POST", PLAY_ROOT + "/" + edit_id + ":validate", {})
        authorized(authorize, request)
        # Exact false is deliberate: never fall back to silently retaining draft.
        api("POST", PLAY_ROOT + "/" + edit_id + ":commit?changesNotSentForReview=false", {})
        committed = True
    finally:
        if not committed:
            delete_edit(api, edit_id)
    # Fresh provider snapshot, rather than our own edit echo, is required.
    read_id = api("POST", PLAY_ROOT, {}).get("id")
    try:
        actual = api("GET", PLAY_ROOT + "/" + read_id + "/tracks/production")
        verified = actual == body
        demand(verified or actual == snapshot["production"], "LIVE_PLAY_COMMIT_READBACK_UNVERIFIED")
        bundles = api("GET", PLAY_ROOT + "/" + read_id + "/bundles").get("bundles", [])
        demand(sum(str(row.get("versionCode")) == request["build"]
                   and row.get("sha256") == request["artifactSha256"] for row in bundles) == 1,
               "LIVE_PLAY_COMMIT_BUNDLE_UNVERIFIED")
    finally:
        delete_edit(api, read_id)
    return {"operation": request["operation"], "artifactSha256": request["artifactSha256"],
            "versionCode": request["build"], "providerState": "completed" if verified else "COMMIT_ACCEPTED_READBACK_PENDING",
            "mutationPerformed": True, "rebuiltOrResigned": False,
            "providerReadbackVerified": verified,
            "continuation": "READ_ONLY_STORE_INSPECTION" if not verified else "STORE_PROCESSING_OR_REVIEW",
            "publicAvailabilityVerified": False}
