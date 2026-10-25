# Private diagnostic Actions origin

This source package validates the origin of the two future R5 private native
windows. It does not run a collector, native job, backend, provider or release
operation. The reviewed-window allowlist is empty. Its reviewed entrypoint
rejects every request before making any API call. No workflow invokes the
private origin API, and no environment variable or receipt can install a pin.

`authenticatePrivateActionsOrigins(github, expectedPerPlatform, {clock})` is a
lower-level read-only diagnostic API. The caller must supply separately
reviewed immutable expectations for both platforms:

```text
IOS|ANDROID: {
  platform,
  app: {repository, sha, tree},
  control: {repository, sha, tree},
  backend: {repository, sha},
  execution: {repository, workflowPath, workflowSha, ref, runId, runAttempt}
}
```

App repository is `KeeperCommunity/bitcoin-keeper` (ID470904030). Control and
backend repository is the private `KeeperCommunity/bitcoin-keeper-relay`
(ID496119449). Backend source is fixed to
`29597b27eeeb299205bf7d0555db0a90c38cc4be`. The workflow and execution ref are
fixed to `.github/workflows/r5-native-integration.yml` and
`refs/heads/codex/r5-native-integration-execution-20261022`.

Both windows use the same exact app SHA/tree and backend, with independently
expected controller SHA/tree/run/attempt. They must have distinct controller
commits and runs. The current execution branch must point to one controller;
its sole parent must be the other controller. All tracked blobs and executable
modes must agree except the exact platform request marker. This permits the
reviewed serial iOS/Android marker strategy without borrowing either window's
identity. An intervening code, mode or unrelated marker change blocks the pair.
Both native job intervals must be complete and ordered without overlap; each
artifact must have been created within its own selected native job interval.

The API verifies repository IDs/privacy, active workflow identity, immutable
Git commits/trees, exact commit subjects and request markers. Its source policy
is compared with frozen reviewed D source
`448e09d7a373fc7e9d9c540880b45e2c742997f7`. Backend changes must remain inside
that finite policy, and all required sparse inputs must exist. Actual workflow
source must select the independently expected app. Public worker and recovery
source hashes are computed from original authenticated app Git blobs, with
blob/tree binding; no source hash comes from the artifact.

Each selected head's latest unfiltered push run must be complete and successful
at the exact current attempt, source, workflow and branch. The current-attempt
job, official GitHub Actions app, check suite, check ID/name and successful
source/preparation/build/selected native/cleanup/upload steps are bound together.
The other platform's native step must be skipped and receives no credit. Hosted
runner labels constrain the selected route; they do not establish readiness or
prove that any feature ran. Raw receipt composition remains separately required.

Exactly one artifact must match the selected current attempt's full name, with
an original-byte SHA256 digest, valid job-bound creation time, unexpired retention
and a positive size within12MiB. Complete bounded API lists may retain older or
other unselected artifacts; none receive credit or are deleted. Repository,
workflow, branch, run, attempt, job, check, artifact and freshness are read again
after source retrieval. A terminal repository/workflow/branch and both latest
run/attempt fence follows every selected-artifact readback. No subsequent API
work occurs before issue. A later queued, failed or partial rerun revokes an
earlier pass. Artifact bytes, ZIP parsing, the thirteen
raw member validator and post-download origin checks belong to separate P2B2.
This package does not claim to have performed those steps.

The returned object is deeply frozen and privately branded by this module.
Serialized objects and caller-authored PASS labels do not acquire the brand.
It remains `reviewed_window:false`, `installed_trust:UNVERIFIED`,
`native_acceptance:false`, with all release/readiness/authorization flags false.
That diagnostic brand cannot be cast into canonical or installed acceptance.
P3 must authenticate its separate installed-window capability before fresh
collection, and independently retain the existing installed canonical public
route and live pin checks. No protected installation is established here.

Source controls use synthetic Actions/Git responses and actual committed public
source bytes. They are not private native results. The source-only origin and
canonical contract workflows now run the reusable SDK cleanup, private C2/D
validators, private ZIP and raw source tests under their existing read-only
permissions and source fences. The existing one-shot artifact transport probe
is a separate package with its own actual result; its saved-archive controls are
not silently imported as current candidate evidence.

Remaining dependencies are separately reviewed execution-window pins and final
app source; P2B2 original-byte transport/composition; and P3 protected installed
authority. Actual native execution, combined acceptance and release readiness
remain unproved by these source checks. No WAN, historical installation,
physical-device, biometric or performance-budget result is invented.
