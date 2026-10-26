# Existing-build live store continuation

This isolated candidate connects three existing-build operations to the protected
SDK driver and its existing manual workflow. It is not installed or remotely run.
Tests use disposable keys and fake providers. App source, versions and counters
are unchanged. Human review/comments remain optional; technical authorization is
mandatory and caller JSON never creates it.

`scripts/live_store_adapters.py` adds three bounded operations:

| Operation | Existing provider objects required | Single publication mutation |
| --- | --- | --- |
| `ios-submit-review` | Correct existing App Store app/version, exact selected processed build, manual release mode, and a prepared READY_FOR_REVIEW submission containing only that version | Submit that review submission. No metadata edit, build selection, upload or release. |
| `ios-release-approved-version` | Same existing version/build, manual release mode and PENDING_DEVELOPER_RELEASE | Request release of that version after Apple approval. Existing phased-release configuration is read and bound, never changed. |
| `play-production-rollout` | Exact previously uploaded AAB SHA256/versionCode, one internal release containing only that code, and only older completed production releases | Set production to that existing release with status completed, validate and commit once with changesNotSentForReview=false. No bundle upload or metadata/image/changelog API. |

The callable `StoreAPI(provider, short_lived_bearer_token)` uses fixed official
origins, configured Python proxy/CA trust, no redirects or mutation retries, and
sanitized errors. Token acquisition remains with the existing credential custodian
and protected runtime. The module has no CLI and reads no credential environment
variables. Pass only the operation's existing scoped provider token to this client;
do not forward Actions, GitHub, signing or unrelated secrets.

The installed caller must authenticate the successful upload receipt and its
signed-artifact provenance with the existing artifact/run guards, prove current
source/native/security/custody authorization, and bind the complete request to
the user's standing release authorization. The adapter's receipt field checks
prove consistency, not authentication. Its required `authorize(request)` callback
revalidates runtime authorization and returns true only for that same exact
operation/source/artifact/store snapshot; it is not a request for a human comment
or environment reviewer. No JSON field can install or bypass that caller boundary.

Requests retain the original source SHA, artifact SHA256, signing identity/config
digests, version/build and upload run/attempt. iOS also needs the actual numeric
App Store app ID and actual appStoreVersion/build/reviewSubmission resource IDs;
none is inferred from an arbitrary latest build. `plan_ios` is read-only. For
Play, create an authorized disposable edit, call GET-only `plan_play` with its
ID, then delete that edit; temporary edit creation/deletion are provider writes,
although they do not publish. Bind the returned `storeSnapshotSha256` to the
execution request. `execute_play` creates a new edit it owns, checks the same
snapshot, mutates only production, validates, reauthorizes before commit, and
reads production and the bundle hash in another fresh edit that it deletes.

Apple does not expose an uploaded IPA SHA256 through these build APIs. Its build
mapping therefore relies on the authenticated successful upload receipt plus
explicit exact provider app/version/build IDs and processed-build readback;
this is not a new cryptographic proof of Apple's reprocessed bytes. Play does
expose the AAB upload SHA256 and that exact digest is checked before and after.

Every receipt leaves `publicAvailabilityVerified` false. Apple review and store
processing/territory availability, Play review/managed publishing, agreements,
policy declarations and propagation remain actual provider state. A request or
completed track is not proof that customers can install globally. Unknown or
failed mutation replies are never retried automatically; inspect actual provider
state before resuming. Accepted requests whose subsequent read still shows the
exact prior state return `providerReadbackVerified:false` with continuation
`READ_ONLY_STORE_INSPECTION`; they do not resubmit or report verified rollout.
Unexpected identities or unrelated state remain failures. No build is rebuilt
or resigned to promote it.

The driver now authenticates the successful upload receipt artifact and its
original signing artifact/run/attempt, rechecks the unchanged signed app, and
connects the adapter through a private parent/child authorization pipe. Before
each mutation the Node parent refreshes its same-process branded source/native/
security/actor proof and rechecks both artifact/run identities. Child request JSON
or copied success cannot authorize itself. Every parent refresh requires at
least two hours of the official run authority remaining; that same deadline is
carried on the private pipe and checked by the child. The live child is bounded
to 30 minutes, and a queued/expired run must stop before store credentials or
mutations rather than borrowing an earlier authorization. Signing/upload secrets never cross
into other operations; read tokens remain only in the parent. Public signature
checks run without store credential environment variables. A separate Node22.23.4
helper uses the existing scoped ASC key or Play service account to obtain only
a short-lived token; it uses fixed official audiences/endpoints and no redirects.
Actual source acceptance, signed artifacts, provider credentials/access, prepared
metadata/compliance/review state, store baselines and resource IDs remain required
live inputs. The current version manifest is unchanged, including its older
baseline values; this package does not select the release counters for 2.6.5.

Offline verification:

```sh
node --test scripts/protected-live-runtime.test.cjs scripts/store-token.test.cjs
python3 -B -m unittest discover -s scripts -p 'test_live_store_*.py'
```

API shapes were checked against Fastlane2.225.0's direct Spaceship review submission
and release-request methods, and its Supply edit/bundle/track APIs. Tests use a
fake provider only, including wrong selected builds, multi-version internal
releases, bundle substitution, production conflicts, source/receipt/snapshot
drift, lost authorization/replies, readback failures and owned-edit cleanup.

## Exact runtime path after protected installation

Use the existing `keeper-protected-release-workers.yml` manual workflow from the
current protected sprint source S. Its `request_json` retains the normal source,
release ref, version/build, artifact/certificate/config digests. For a live
operation, `artifact_id` is the successful **upload receipt artifact** ID, not the
signing artifact ID: the authenticated upload receipt supplies that signing chain.
`approval_comment_id` may be absent or `none`. Add one `live_parameters` string
containing strict JSON with these fields:

```json
{
  "mode": "inspect",
  "store_snapshot_sha256": "pending",
  "app_id": "<actual numeric App Store app ID>",
  "app_store_version_id": "<actual existing version resource ID>",
  "build_id": "<actual selected processed build resource ID>",
  "review_submission_id": "<actual prepared review submission ID>"
}
```

Those four resource fields apply to `ios-submit-review`. Omit
`review_submission_id` for `ios-release-approved-version`; omit all four resource
fields for `play-production-rollout` (its package and tracks are fixed in code).
Unknown fields/duplicate keys, mutable references and execution with a pending
snapshot are rejected before credentials. The inspector still verifies original
artifacts and current technical eligibility. It publishes nothing; on Play it
creates/deletes only its own disposable edit. Read `storeSnapshotSha256` from its
retained receipt, then dispatch the same operation with mode `execute` and that
exact digest. Store drift requires a new inspection, not a waived check.

After Apple approves the manually held version, inspect then execute the
separate `ios-release-approved-version` operation for that same build. Its
original upload may be days old: source version/counter consistency and artifact
identity remain fixed, while current store readback replaces the pre-upload
baseline's 24-hour freshness check for live operations only. Current source/
security/native/actor eligibility and the current run's bounded authorization
are still required. Signed-build and upload operations keep their original fresh
store-baseline gate. Review never forces a rebuild, resign or counter increment.
