# Canonical exact-source native acceptance route

This separate infrastructure package prepares manual native validation of the
eventual canonical merge SHA. Existing PR-head validation and its fail-closed
release gate remain unchanged. The new route is uninstalled/unexecuted and
untrusted until independently reviewed, approved and installed on protected
`sprint`. No native dispatch, release operation or repository configuration is
performed by preparing this package.

## Trust and execution

The caller is `.github/workflows/keeper-canonical-native.yml`, dispatched manually
with one immutable40-character `source_sha`. Source SHA, workflow SHA, current
protected sprint HEAD and the nonsecret repository variable
`KEEPER_CANONICAL_NATIVE_DRIVER_SHA` must all agree. The workflow must be active
at the expected installed path. The run must be the newest canonical dispatch for
that source, in this repository, on sprint, with the exact current run attempt.
Check-suite and job check-run identities must belong to the real GitHub Actions
App15368, not a status name, actor name or artifact assertion.
The live repository pin is read again through the authenticated read-only API at
each provenance check; revocation or unavailable variable-read permission blocks.
The default workflow token cannot read repository Variables. A separate
repository-selected Variables:read identity, supplied as the step-only secret
`KEEPER_CANONICAL_PIN_READ_TOKEN`, reads that endpoint. Actions/checks/contents
continue to use the workflow token. The collector removes the credential from
its environment before invoking the archive reader. Missing, expired or revoked
credentials fail closed with no fallback to the initial variable snapshot.

The separate canonical platform worker preserves the existing hosted command
sequence: record→prepare→iOS driver preflight→development build→startup smoke→native
persistence→production-worker probe→full-product measurements/companions. iOS
finishes before Android starts. Native admission checks reject other active or
queued/waiting/pending/requested native workflows without cancelling them. There is no automatic retry,
dispatch, concurrency replacement/cancellation or queue mutation. Operators must
schedule one canonical run at a time; the read-only admission check supplements
the serial platform dependency rather than providing a distributed lock.

Hosted macOS/Xcode and Linux/KVM emulator prerequisites, dependency/source guards,
safe caches, disk budgets, loopback fixtures and development signing conventions
remain those of the reviewed foundation. No production signing key, upload,
distribution, protected environment or release credential is used. The worker
has only contents/actions/checks read workflow permissions; its sole forwarded
secret is the read-only Variables identity, exposed only during its initial
provenance script, before dependencies and native tooling. No personal Mac is requested.

Each platform uploads one bounded `metadata.json` artifact:

```text
keeper-canonical-native-IOS-<sha>-<runid>-<attempt>
keeper-canonical-native-ANDROID-<sha>-<runid>-<attempt>
```

The collector job is **Canonical native attestation**; its validation step is
**Verify canonical receipts and required matrix**. It authenticates exact-attempt
platform jobs and every required native step, then validates artifact names,
provenance, size and SHA256. A standard-library archive reader permits exactly
one bounded metadata.json, rejecting traversal, extra files, symlinks and oversized
content. Receipt identities must match source/platform/native app/workflow/run/
attempt. Skipped, partial, diagnostic, stale or other-source results receive no
canonical pass. Head/run/attempt provenance is checked again after downloads.
Only bounded fixed outcomes and receipt digests enter collector output; raw
logs, screenshots, hierarchy, databases, credentials and app responses are absent.

## Complete attestation versus partial evidence

The intended positive artifact is named
`keeper-canonical-native-attestation-<sha>-<runid>-<attempt>` and contains only
`keeper-canonical-native-attestation.json`. Schema1 uses fixed root fields:

```text
schema, kind=keeper-canonical-native, repository,
source_sha, source_tree, workflow_sha, workflow_path,
run_id, run_attempt, selected_route=canonical-hosted-native,
platforms, feature_matrix_complete
```

Each IOS/ANDROID platform has conclusion, artifact_id, receipt_sha256, the seven
`release_acceptance.REQUIRED` case IDs/statuses, and fixed executed_checks with
explicit scopes. Individual build/startup/native-storage, extracted worker,
five full-product observations, controlled-disconnect Retry, installed-version
history, key-management discovery and unused-key/PIN UI outcomes remain visible.
Missing individual evidence is NOT VERIFIED. Worker/probe scopes are explicit.

The parent release matrix currently retains five NOT IMPLEMENTED obligations.
Live-Vault reference/privacy UI, multi-account UI, native restore/recovery and a
performance budget are not supplied by those narrower executions. This route
therefore emits **no positive attestation** for current implementation coverage,
even if every implemented platform scenario succeeds. It writes the separate
bounded `keeper-canonical-native-readiness.json` with feature_matrix_complete:false
and fails the collector. Existing positive files are removed before collection;
the attestation upload step cannot transfer a stale file or credit a skip.

Once separately reviewed complete executable coverage exists, the same route can
emit complete:true only when all seven parent cases and all required implemented
checks are PASS on both platforms. This package supplies no status-name waiver
or arbitrary caller flag to override the parent matrix. The independent signing
consumer must revalidate live Actions origin, latest run/attempt, current source,
pin, artifact digests, strict payload and complete case set. An attestation is
software test evidence, never authority to merge, sign, upload, deploy or publish.

## Installation inventory and actual verification

Remaining approved installation work: independent source/security review; explicit
owner approval to merge/install; retain protected sprint; pin its reviewed exact
commit in KEEPER_CANONICAL_NATIVE_DRIVER_SHA; verify read-only API access to that
variable and the required Actions/check/artifact endpoints; then separately
authorize a single hosted run. Repin only a reviewed canonical candidate. None of
these configuration changes or executions has occurred here. Existing incomplete
software/physical acceptance and release approvals remain independent.
See [the pin-reader installation handoff](CANONICAL-PIN-READ-INSTALLATION.md) for
the verified permission blocker, narrowly scoped identity and API preflight.

Executed local contract checks: Node API/provenance/receipt controls and Python
real-ZIP safety controls. They exercise forged runs/apps/workflows, moved heads,
stale attempts, skipped/duplicate jobs, artifact spoofing, bounded partial evidence
and archive rejection. They establish neither native execution nor any pass on a
canonical merge SHA. Complete native software matrix and physical results remain
unverified. No PR producer/source branch is rewritten or promoted.

The first complete combined contract run retained112PASS/1FAIL because its
explicit PR-workflow classification omitted this package's new offline contract
job. The corrected classification also asserts read-only permissions, a pinned
Node runtime, no environment/secrets and separation from the manual native caller.
No native obligation, producer-origin check or release gate was relaxed.

Capacity admission includes the existing one-time native bootstrap routes and
does not cancel their runs. It is a read-only admission check, not a global
mutex shared by every legacy workflow. Installation must coordinate those routes;
this package alone cannot promise atomic scheduling across independently triggered
workflows. No canonical run was dispatched during this preparation.
