# R5 protected-release evidence consumer

This separate package adds a read-only consumer for original Actions execution
provenance. It does not import into the preparation gate or enable an operation.
The B1 guard at `551198c6a5d55d05b5ecd2cae57505ca69270264` remains fail-closed.
There is no release authorization, signing, build, upload or dispatch entry point.

`scripts/trusted-release-origin.cjs` exports
`collectTrustedOrigin(request, provenanceToken, now, pinReadToken)`
and `isTrustedOrigin(proof)`. A proof is an immutable object registered in this
module's private WeakSet; a copied API/JSON payload cannot mint one. A future,
separately reviewed gate integration must call the collector again immediately
before every protected operation and after environment approval, bind its result
to the same immutable source/driver, and retain all owner/environment/config,
certificate, artifact and version checks. This object always records
`release_authorized: false`, `authorization_eligible: false` and
`execution_allowed: false`. **It must not mint B1's authorization capability.**

## Required installed sources

- Source and driver must both equal the **current protected sprint HEAD**.
  The repository variable `KEEPER_CANONICAL_NATIVE_DRIVER_SHA` must explicitly
  pin that same installed commit. No variable is created or changed here.
- Tests must originate from the active installed `.github/workflows/test.yml`,
  its latest exact-source `push` run on sprint and its `Tests` job with successful
  actual test, recovery, version and packaged-artifact steps.
- CodeQL must originate from the active installed `.github/workflows/codeql.yml`,
  its latest exact-source `push` run on sprint and its actual analysis job/steps.
- Canonical native evidence must originate from the separately reviewed
  `.github/workflows/keeper-canonical-native.yml`, its latest exact-source manual
  run on sprint, both platform jobs and its attestation collector step.

Each selected run must have completed successfully within 24 hours. The consumer
selects the latest run without a success filter, validates the current attempt,
and binds every required job to the original GitHub Actions check ID and check
suite. Status context strings, check names alone and a bot/app assertion provide
no credit. The legacy `keeper/local-validation` commit status is not treated as
independent canonical proof and is never manufactured here. Existing PR gates
and their installed-base requirements remain unchanged.

The official GitHub Advanced Security CodeQL result is checked separately from
the Actions analysis job: a failed, pending, missing or foreign-app exact-source
security result blocks this read-only proof. This matters because an Actions
analysis run can succeed while the separate CodeQL security check fails on a
high alert. The consumer now also requires the selected installed analysis job's
original attempt-scoped upload receipt. The CodeQL workflow pins official CodeQL
v4 actions to `9b3254085494b55a0f7c4c2b3d2d52cc712ce370` and checkout v7 to
`3d3c42e5aac5ba805825da76410c181273ba90b1` (official tag targets read on
2026-10-22), disables checkout credential persistence, and uses the fixed
`keeper-javascript-typescript/` category. It captures only the analyze action's
documented `sarif-id` output after processing completes; SARIF and code contents
are never published. Both capture and artifact upload must be successful
original job steps. Their supported producer context is a sprint push.

The consumer checks the receipt's original Actions artifact API record, digest
and bounded ZIP bytes, exact source/ref/workflow/run/current attempt, then reads
the official SARIF processing status, matching analysis list and individual
analysis record. Exactly one processed CodeQL analysis must match the upload ID,
source/ref, analysis key, category and no-matrix environment (`{}` or `null`),
with no processing error or warning. Timestamps and matching analysis keys alone
cannot establish linkage. It rechecks the selected run/current attempt, artifact,
official analysis and separate security result before returning a read-only
proof. Missing receipts, denied APIs or changed authority fail closed.

Successful collection records `codeql_analysis_run_linkage_verified: true` for
**analysis-to-run origin**, through the reviewed installed workflow and official
action output. The public API does not expose a direct GAS-check-to-analysis-ID
join. Therefore `security_check_analysis_linkage_verified` and the existing
broader `security_analysis_run_linkage_verified` remain **false**. A prior
successful GAS check cannot establish full security linkage to a newer analysis
or attempt. No future integration may treat the narrower analysis-origin flag
as completion of this remaining security obligation.

**Live installation and linkage remain UNVERIFIED.** No receipt from the changed
installed workflow has been executed or consumed. The current integration token
cannot read code-scanning analyses (HTTP 403), so this session cannot produce a
live proof. The B1 preparation capability remains disabled; even a successful
synthetic origin proof grants no release or execution authority.

## Artifact contract

The canonical producer uses attempt-scoped names:

- `keeper-canonical-native-attestation-${sha}-${runid}-${attempt}` contains only
  `keeper-canonical-native-attestation.json`.
- `keeper-canonical-native-${IOS|ANDROID}-${sha}-${runid}-${attempt}` contains only
  `metadata.json`.

CodeQL separately uses `keeper-codeql-analysis-${sha}-${runid}-${attempt}`,
containing only `analysis.json` with the official upload ID and immutable
execution context. It receives the same bounded single-file ZIP/API/digest
checks as canonical evidence. Earlier runs without this artifact are ineligible.

The consumer independently reads the original artifact API record, requires its
immutable SHA256 digest, original run/source association and unexpired bounded
size, then verifies the downloaded archive bytes. It accepts only a single
regular-file ZIP entry with the exact filename, at most 128 KiB archived and
64 KiB expanded; it rejects ambiguous ZIPs, extra files, links and traversal.
Only GitHub's signed HTTPS storage redirect is followed, without forwarding the
GitHub token. It prints no token, signed URL, artifact payload or process log.

The strict schema-1 attestation binds repository, source commit/tree, installed
workflow commit/path, original run/current attempt, route and both platform
artifact IDs/raw receipt hashes. All seven reviewed required native obligations
must be present exactly once and PASS on each platform. `feature_matrix_complete`
must be the boolean `true`. Each original platform receipt must independently
bind the same source/workflow/run/attempt and record PASS for build, startup,
native persistence, R5 worker scenarios and full product UI measurements.
It also requires the fixed nine executed-check IDs and bounded scopes. Original
receipts must contain all five raw product samples, history/key-entry observations,
the separately bounded Retry and unused-key/PIN UI receipts, and all five worker
scenarios/helper timing pairs. Worker function hashes are checked against the
same committed source files fetched as data from GitHub, rather than merely
trusting another PASS boolean or a self-reported source SHA.

The separate installed-byte follow-up also requires a literal verified boolean
and the exact platform proof schema at the receipt root, every one of the five
product observations, Retry and key/PIN UI. Android requires the single pulled
base APK SHA256; iOS requires the full typed bundle inventory and executable
SHA256. Every observation must match the root proof, and the installed binary
hash must match the built artifact. iOS typed inventory and the older build tree
use different algorithms, so their digest strings are not equated. Missing,
malformed, unexpected or mismatched fields fail closed; installer normalization
and successful installation commands provide no substitute for byte comparison.

The existing helper probe and product measurements do **not** complete every
required native obligation. The producer must emit blocked readiness evidence
while any obligation is unimplemented or unexecuted. The consumer rejects such
evidence; neither a successful startup nor a helper result waives a missing case.
It repeats mutable protected-source/pin, producer latest-run/current-attempt and
artifact authority checks after downloading the receipts.

## Verification and setup boundaries

Run `node --test scripts/trusted-release-origin.test.cjs scripts/codeql-analysis-receipt.test.cjs scripts/protected-release-plan.test.cjs`.
All tests use fake API responses and bounded synthetic unsigned metadata archives.
They do not establish actual Actions permissions, installed trust, native feature
acceptance, signing identities, store access or release readiness. No native or
release operation has been run by this package.

Before any future integration, separately verify the canonical producer is
reviewed and installed, the nonsecret commit pin is set through the approved
repository administration process, and the provenance identity can read repository
contents, Actions runs/jobs/artifacts, checks and code-scanning analyses/SARIF
processing. `pinReadToken` is a separate required repository-selected identity
with **Variables: read only**; only the live repository-variable endpoint receives
it, with `Cache-Control: no-cache` on every live recheck. The default Actions `GITHUB_TOKEN` cannot read repository variables, and the
consumer never falls back to it. Provision the dedicated
`KEEPER_CANONICAL_PIN_READ_TOKEN` secret only through the separately approved
setup for #7084; no credential is added or configured here. Missing permissions, a missing
digest, pagination over 100 entries, a changed current source or incomplete
feature scenarios fail closed. This package adds no credentials and performs no
repository configuration or protection changes. Physical-device and paired-backend
acceptance remain separate exact-candidate evidence requirements.

## Installation handoff and current access blockers

This successor preserves #7085 head
`a1e167cab4e8485bb84418cadfb2313cbcedb644` and recovers #7087's installed-byte
successor `546d77261d02c0633e45b2c62df8f8e5580620c0` as a merge ancestor. #7087
was published at 18:28:51 UTC during this task, after initial head/ref inspection.
All installed-byte root/sample/Retry/key/PIN/build-binding rejection controls are
retained; only their fixture calls gained the required isolated pin token. Review
the CodeQL/pin-reader delta against `546d77261d02c0633e45b2c62df8f8e5580620c0`.
It does not install changes into sprint or rewrite producer branches. Coordinate
the reviewed workflow/receipt contract with #7084's pin-reader setup before future
operation. No variable, secret, protection, release capability or native route is
activated here. No duplicate native dispatch or personal Mac check is requested.

The separately approved installer must verify the provenance identity has
**Contents: read, Actions: read, Checks: read, Code scanning alerts: read**
(`security_events=read` in the API permission header), and the isolated pin
reader has Variables: read on this repository. Give no Variables write or
administration permission. Replacing the stored secret alone does not revoke a
token already held by a running job: revoke the old token at its issuer or
change/delete the live pin to revoke in-flight work. Keep tokens out of
receipts/logs. Verify a genuine
normal installed sprint-push CodeQL receipt on its exact source/attempt; a PR
analysis or synthetic contract is not interchangeable. No native dispatch is
needed to verify CodeQL upload provenance. Full canonical acceptance still needs
the separately completed hosted native matrix and route coordination. Full
official security-check/analysis linkage needs a separately verified mechanism;
this patch intentionally does not invent one from names or timestamps.

Read-only probes on 2026-10-22:

| Probe | Actual outcome | Consequence |
| --- | --- | --- |
| `GET /repos/KeeperCommunity/bitcoin-keeper/code-scanning/analyses?per_page=1` | HTTP 403, `Resource not accessible by integration`; `X-Accepted-GitHub-Permissions: security_events=read` | Current integration lacks required Code Scanning read access; no live analysis/run linkage verified. |
| Same endpoint with `ref=refs/heads/sprint&tool_name=CodeQL&per_page=100` | Same HTTP 403 and required permission | Filtering does not resolve access; no private analysis metadata obtained. |
| `GET /repos/KeeperCommunity/bitcoin-keeper/check-runs/119985857101` | Official GAS App 57789, exact `3eb92fc8a622a3e09926d49f47243c163e32d009`, `conclusion: failure` | Failed security result remains blocking. |
| Original Actions/check-suite reads for that candidate | Reads succeeded; CodeQL Actions run `39830650673` attempt 1 completed successfully | Actions success does not clear the GAS failure or establish analysis provenance. |

No settings, credentials or alert disposition were changed. The analyses API
denial is an integration-permission blocker, not evidence that the repository
lacks analyses or CodeQL failed to execute. Genuine verification needs approved
read access and an installed output receipt; neither is waived by offline tests.

Final assembled-source verification used Node 22.23.3: **268/268 Node controls
passed**, comprising the consumer, captured-upload writer, disabled B1 controls
and inherited `.github` gate tests. The 114 installed-byte rejection controls
recovered from #7087 remain present. The first merged run failed those controls
because their old three-argument fixture calls omitted the newly required pin
identity; adapting those calls retained every rejection assertion. Both changed
workflows passed actionlint 1.7.12 with external shellcheck/pyflakes disabled;
whitespace checks passed. No native, installed-provider or release acceptance is
claimed from these offline controls.
