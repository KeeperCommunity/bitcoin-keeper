# Protected cloud release preparation handoff

This document reconciles the separately reviewable non-app packages. They are
prepared source candidates, **not installed or operational release capability**.
No signing, keychain, provider, upload, distribution, release or deployment
operation has been performed. The primary R5 candidate and all producer branches
remain unchanged. Work-package labels 5.1/5.2 are not app versions.

## Preserved source checkpoints

| Package | Draft PR / exact commit | Current state and next action |
| --- | --- | --- |
| Inventory, authorization preparation and research | [#7072](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7072), `f2fc0cb557f0e5303335dadc9e98152640795e6c` | Preparation complete. Its original estimate and NOT IMPLEMENTED worker state are historical package scope; later packages below supply inert worker candidates. Preserve its source/research evidence. |
| Origin guard | [#7074](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7074), `76150f455978c1a565f2c670774672bc18789877` | Deliberately disabled. The module-private origin marker is never minted by the collector; caller JSON/status names cannot authorize. Keep disabled pending separately reviewed integration. |
| Platform worker core | [#7076](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7076), `e195de31ffc38ec54fcee9c43f74e610139d3844` | Implemented future adapters, not executed. Review together with orchestration and the paired canonical native foundation. |
| Frozen Ruby inputs | [#7078](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7078), `1241256d465d25f2ea2bb4c4e75fccb608ff276e` | Actual frozen118-gem install/load/project parse previously passed. CocoaPods1.16.2/Xcodeproj1.27.0 must be paired with the reviewed native foundation's Podfile.lock; inherited worker-base lock1.15.2 fails before credentials. No native pass follows from dependency loading. |
| Manual orchestration and upload adapters | [#7080](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7080), `c1e0e6df99eb762d62e31e9d71afa2cb97958bc5` | Prepared, deliberately inoperable through B1. The small follow-up containing this handoff corrects TestFlight processing-path metadata writes; review its patch separately from this preserved producer. |
| Upload-only successor | [#7086](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7086), `36df64be4ccafc287c0ac07fb911d7e3a1c4711c` | Preserved and included in the isolated reconciliation. Pinned Pilot fake-boundary regression proves the corrected adapter stops before processing/distribution. No provider operation performed. |
| Canonical native producer | [#7084](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7084), `29a73faaf4312f3536db9aad1d5b6795042aef7d` | Uninstalled/unexecuted. Five parent obligations remain NOT IMPLEMENTED; only blocked readiness can be emitted until genuine complete coverage exists. Read-only capacity admission is not an atomic lock shared with legacy routes. |
| Read-only trusted-origin consumer | [#7085](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7085), `a1e167cab4e8485bb84418cadfb2313cbcedb644` | Separate and unintegrated. Proofs retain authorization_eligible:false, release_authorized:false and execution_allowed:false. Official security-analysis/run linkage is unverified after analysis API403. Never use this object to mint B1 authorization. |
| Strict installed-byte consumer successor | [#7087](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7087), `546d77261d02c0633e45b2c62df8f8e5580620c0` | Implements root/all-five/Retry/key proof schema, equality and built-binary binding missing from #7085. Separate, not included here; review/adoption and genuine exact-canonical receipt acceptance pending. All authorization flags remain false. |
| Canonical live-pin identity successor | [#7095](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7095), `effd9175c00ebbdbaf616813a3ecfa6886bbbf45` | Fixes default-token Variables-read incompatibility in its candidate. Separate uninstalled repository-selected Variables-read identity/setup and live preflight remain required; no fallback or release capability. |

Each linked PR retains its patch-only comparison. Do not squash these packages
into an expanded app implementation PR or transfer their checks to another SHA.
The orchestrator's existing stack totals multiple substantial features; each
future substantial delta must remain separately bounded, with a new estimate
and a split before approximately20k changed code/test tokens.

## Final source review and actual checks

Independent review of orchestration c1e0 and its pinned Fastlane2.225.0 source
found one additional functional discrepancy: waiting for TestFlight processing
reaches `update_beta_app_meta` before `skip_submission` is honored. The follow-up
sets `skip_waiting_for_build_processing:true` with no changelog. Actual library
control-flow tests stub login, package construction and Transporter; the corrected
options stop after one fake upload, while the previous waiting flag reaches the
processing/distribution path. No store or network operation is exercised.

At preserved c1e0, independent local rerun passed Node22.23.3 contracts67,
Python contracts24, Ruby3.3.8 fake adapter tests3runs/16assertions and actionlint
for3workflows. These are source/fake contracts, not native/signing/store tests.
Initial reviewer invocations used a nonexistent artifact-test filename and
workflow path; corrected invocations passed without source changes. They are
review-command errors, not application regressions. Follow-up exact-head results
are recorded in its PR, rather than attributed to c1e0.

Source review also confirmed that transient cleanup, staged-source/recorded
nodeify overlays, signed payload digests and independent operation credentials
remain bounded. Actual hosted cleanup on failure/cancellation or runner loss,
full embedded production-config readback, provider-selected build identities and
processing remain **NOT VERIFIED**. Current upload receipts correctly record
command completion only and storeProcessingVerified:false.

Review follows the latest owner instructions and [#7034](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7034).
Signing/workflow/security changes require adequate Balanced coverage; record
reviewer route, exact SHA/base, findings and disposition. This independent cloud
agent review is source evidence, not a formal GitHub approval or completed
Copilot/Claude provider review. Claude is unavailable/uninstalled; no new paid
activation/retry is authorized. Human developer review is conditional, not a
blanket gate. Preserve substantive security findings and actual required checks.

## Observed one-time setup, without credential values

Read-only environment collection at **2026-10-22 18:23:58 UTC** returned exactly
`copilot`, `Env` and `keeper-claude-review`. Neither `keeper-release-ios` nor
`keeper-release-android` exists in that response. Earlier secret-name/variable-name
reads returned403: custody, value existence, ownership, scope and usability remain
UNKNOWN, not absent. No secret value was requested and no setup was changed.

| Setup boundary | Remaining evidence/action, requiring separately authorized administration or operation |
| --- | --- |
| Protected source and driver | Approved installation on protected sprint, reviewed exact canonical source and release ref, current nonsecret driver pin. No merge/promotion/pin/configuration change has occurred. |
| Protected environments | Create/configure only after approval: independent reviewers, prevented self approval, administrative bypass disabled and exact protected-source restriction; prove actual rejection before loading credentials. Environment selection alone proves nothing. |
| Apple signing | Authorized custodian for existing distribution identity/profile, matching team/app/entitlements and independently verified fingerprint; no personal Mac/keychain export, implicit certificate creation or rotation. |
| Android signing | Authorized existing upload keystore/alias/password custody and independently verified upload-certificate continuity; distinguish Play App Signing identity. |
| Store API custody | Approved least-privileged App Store Connect and Play app/channel identities, current agreements and authenticated complete version/build baselines. Names are listed in release/cloud/README.md; no values enter source, requests or logs. |
| Production app configuration | Reviewed client-safe allowlist and exact digest, no signing/upload/server secret embedded. Input digest/source checks do not establish full binary configuration readback. |
| Artifact audience | Separate owner receipt must acknowledge signed binaries accessible to authenticated readers of this public repository for14days. If that audience is not approved, a private reviewed artifact transport is still required. |
| Hosted capacity and trust access | Verify macOS/Xcode/Android readiness, safe caches/disk, one native build at a time and read-only variable/Actions/check/artifact/analysis permissions. Coordinate legacy routes; do not cancel active work. |
| Native, backend and physical acceptance | Complete exact-candidate software matrix and paired backend evidence remain separate from these source packages; actual devices/testers are required for physical results. |

## Remaining implementation deltas before any authorization integration

1. Bind official CodeQL security analysis to the selected installed run/attempt
   using a genuinely authorized read-only API route. Current403 and separate
   failed security outcomes are not a success. Keep authorization false while
   linkage is incomplete.
2. Reconcile installed selected-route evidence with the legacy all-checks/name
   predicate without accepting unrelated skips, pending/failed checks or another
   SHA. Retain exact owner/environment/version/config/certificate/artifact gates.
3. Original #7085 omitted root/per-scenario installed-byte binding from #7083.
   Separate successor [#7087](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7087)
   now implements strict platform proof schema, built-byte binding and equality
   across all five samples/Retry/key receipts, rejecting missing/false/malformed/
   mismatched proofs. Review/adopt that candidate and obtain genuine hosted
   receipts; do not implement a competing copy or claim it is installed. All
   authorization flags remain false and the canonical matrix remains incomplete.
4. Complete the parent native feature/performance matrix in its own app/acceptance
   packages, then obtain genuine exact-canonical receipts after approved
   installation. Do not replace missing cases with helper/startup evidence.
5. Before calling signing/distribution verified, separately authorize hosted
   disposable/approved-channel trials and verify actual transient cleanup,
   embedded config/signature compatibility, artifact transport and provider
   build/readback receipts. This document does not authorize those operations.

The provenance integration and installed-byte binding are estimated separately
at roughly6k–12k changed code/test tokens before live validation; security API
availability and final native schema may change that estimate. Provider receipt
and configuration readback would be another bounded estimated3k–6k delta if
assigned, with actual hosted acceptance separate. No infrastructure absence is
treated as release approval or grounds to weaken a gate.

## Resumed dependency preparation and metadata evidence

Work continues in isolated `codex/r5-cloud-release-reconciliation`, based on
#7080 plus #7086. All producer refs and the native candidate are preserved.
Only the three dependency files below are copied from #7082
`3eb92fc8a622a3e09926d49f47243c163e32d009`; later native app code is not imported.
The Gem inputs remain byte-identical to reviewed #7078. No resolver regenerated
any lock and no authorization code was enabled.

| Input | Origin | SHA256 |
| --- | --- | --- |
| Gemfile | #7078 | `5ab2f41eef4d9b3cd84f939f099d0d58cd3fceddb2d4b7815f83eb9b146dd6b4` |
| Gemfile.lock | #7078 | `e62ce3f1729da11bfdbbbb1665b90c72516352ffaa14606507ff6ce2367b78b1` |
| package.json | #7082 | `0497b2aaeb76372a6f21721f28ebd42ec2877155a090580b23ace2e017fab6a8` |
| yarn.lock | #7082 | `60ef283fd7cfb1ac0a940216864d7a779e8449fd245c213d3148b92b97435b7b` |
| ios/Podfile.lock | #7082 | `b72b31df28a9dececdab9781d5d96785b2081e63cc1d7475941ecfbc624777b3` |

The selected tuple is CocoaPods1.16.2/Xcodeproj1.27.0/Nitro0.36.5. The existing
worker rejection is retained, extended to reject manifest/Yarn/Pod Nitro drift,
and exposed through a read-only hash report. It does not confer authorization.

Fresh safe GitHub metadata readback during this resume, approximately
**2026-10-22 18:28–18:31 UTC**, establishes:

- Complete environment collection: total_count3, exactly `copilot`, `Env`,
  `keeper-claude-review`; both dedicated release environments absent.
- Current `sprint` source `def0d6a90c80287edb4f58ae272cbfc340f00d73`,
  protected:true. Active ruleset24908211 targets `refs/heads/sprint`, has no
  bypass actors, blocks deletion/non-fast-forward changes, and requires
  `Tests` and `keeper/local-validation`, both bound to integration15368.
  Its approval count is0 and strict status policy false; no stronger developer
  approval/up-to-date-source enforcement is inferred. Other security/native
  requirements and effective release-ref protection still need proof.
- Classic branch-protection read, repository secret-name read and variable-name
  read each return403. Custody/pin visibility and classic policy remain UNKNOWN.
  No value was printed or retained. The managed task has no configured release
  credentials; no authorized store/vault metadata route is available here.
- Native run39824790868, attempt1, exact #7082 source above: iOS job119985112961
  failed `Check disposable iOS driver readiness` after immutable dependency
  setup; app build/probes skipped. Android job119991169863 was still running
  after its development build at that observation. No native acceptance is
  claimed or transferred.

Later refresh at approximately **18:35 UTC** found new #7087/#7095 candidates
above and native diagnostic successor [#7094](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7094)
`ffb2131e4e4478e6befc93c9124941fcff4abb31`. #7094 records attempt1 Android's
natural FAILURE after installed-APK byte comparison: initial Create a passcode
assertion failed; later feature/performance cases did not run. Its iOS setup-only
diagnostic owns the next investigation, without an established root cause or
dependency correction. The original run39824790868 has meanwhile advanced to
attempt2/in_progress (iOS job120011570058) under its owner's work. This task
neither initiated nor cancelled/retried it. Coordinate that owner and #7094;
never infer an idle native window from the earlier observation.

Signing certificate/profile/upload-key continuity, team/app/store API identity,
roles, expiry/revocation, agreements and fresh complete store histories remain
**UNKNOWN / NOT VERIFIED**. Source app identifiers and secret names cannot prove
those facts. The [exact administrator/custodian specification](r5-cloud-administrator-setup.md)
lists the safe metadata needed, exact protected names and rejection requirements.
This task prepares that setup; it does not apply it.

## Reusable cloud-only operator handoff

```text
Resume isolated protected release preparation; no operation authorization.
Read AGENTS.md, the newest preparation PR/head and this handoff. Preserve every
producer/shared branch, the native owner's source and all retained failures.
Use a new worktree/branch; do not depend on /tmp tools from an earlier session.

1. Refresh #7082 and successors, #7078/#7086 and #7084/#7085 exact heads, active
   native runs/current attempts, complete environment collection and effective
   protected rules. Record full SHAs, observation time and API limitations.
   Keep one named native owner and one reserved hosted native window. Wait for
   existing runs to finish naturally; do not cancel or dispatch a competing run.
2. Agree with the native owner on ONE new immutable combined-source checkpoint:
   their current reviewed full app/native foundation plus reviewed Ruby/Gem
   inputs and any explicitly adopted preparation corrections. Do not replace a
   newer app manifest with this preparation branch's older complete app tree.
   Verify the five dependency hashes/provenance; if the owner advances any input,
   review that delta and record a new tuple instead of regenerating locks.
3. On that combined source, run the read-only input checker and negative/fake
   contracts, then frozen Yarn --ignore-scripts and BUNDLE_FROZEN=true bundle
   install/check/load. Preserve exact input bytes. The native owner alone then
   schedules hosted macOS15/Xcode16.4 frozen pod install --deployment (no update),
   no-signing iOS and disposable Android acceptance within that owner's already
   authorized route. This task does not dispatch or extend that permission. If
   any route signs artifacts, resolve its separate scope before invoking it.
   Require all
   applicable feature/storage/restore/multi-account/recovery, five raw full-app
   timings, Retry/key UI and strict installed-byte evidence. Failed/skipped or
   incomplete cases remain blocked. No personal Mac or platform waiver.
4. Coordinate #7084/#7085 installation separately from native execution. Keep
   B1's private marker unminted and all authorization flags false. Require current
   protected sprint = installed driver = reviewed canonical pin/source, genuine
   exact-canonical latest-run/current-attempt Actions App/job/check-suite/check
   identities, original bounded artifact ZIP/digest bytes, complete parent matrix
   and production source hashes. PR-head checks cannot transfer to canonical SHA.
   Enforce the strict installed-byte schema including per-scenario identity.
   Review/adopt #7087's existing binding implementation and #7095's explicit
   Variables-reader fix; provision/live-test the latter only under separately
   approved administration.
   Producer permits1MiB ZIP/512KiB JSON; consumer permits128KiB/64KiB and stronger
   raw observations. Obtain actual acceptance by BOTH without relaxing limits.
   Resolve official CodeQL security outcome AND analysis-to-run linkage; Actions
   workflow success and a403 analysis API are insufficient. Fix/review selected
   route/legacy-check reconciliation; neither successor is installed by this task.
5. Have administrator/custodian complete the separately authorized specification
   and supply only secret-free metadata/readback. Verify environment reviewers,
   prevented self review, can_admins_bypass:false, protected-branches-only policy,
   exact source/ref controls and actual credential-free rejection tests. Verify
   independent certificate/profile/upload-key/store app/channel identities and
   fresh full histories; never infer readiness from name presence or status text.
6. Update a durable exact-head PR handoff with commands and real pass/fail/
   blocked/not-run results, run IDs/attempts and artifact digests, remaining setup,
   named ownership and execution_allowed:false. No owner receipt is fabricated.
   No signing, upload, credential/configuration change, deployment, merge or
   release operation follows from preparation. A later operation needs its own
   explicit source/environment/channel/artifact approval after all gates exist.
```

Exact-head test results and native-owner coordination links belong in the new
preparation PR, so a later operator can distinguish this static procedure from
live acceptance. Offline/fake checks never supply canonical native/security or
signing/store evidence.
