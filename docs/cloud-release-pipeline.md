# Permanent cloud release pipeline

[Issue #7061](https://github.com/KeeperCommunity/bitcoin-keeper/issues/7061)
establishes the default process for R5 and every later Keeper release: cloud code
completion, hosted native acceptance, authorized physical testing, independent
review, and separately approved signing/distribution/publication. R5 is the first
rollout, not a special workflow. The target is zero ongoing dependency on the
release owner's personal Mac; hosted iOS jobs still use macOS and physical
checks still need suitable phones/signers and authorized people.

This document describes the Phase A candidate and the separate Phase B plan.
It does not grant merge, signing, upload, submission or publication approval.

## Current capability and adoption

Status snapshot: 2026-10-18. Recheck linked PRs and current trusted workflows at
each handoff; these initial blockers are not evidence about a later head.

| Capability | Current state and evidence boundary |
| --- | --- |
| Hosted development builds and account-free startup smoke | #7060 has actual iOS and Android build/UI passes at `d865ca9c4f91532a1524443cc6da42d8d7b07e1a`, run [39024530330](https://github.com/KeeperCommunity/bitcoin-keeper/actions/runs/39024530330). It remains an unmerged draft. That evidence belongs only to its tested source. |
| Reusable Phase A release acceptance | Candidate infrastructure stacked on #7060. Its local contract checks are distinct from actual hosted builds/UI execution. R5 native and release acceptance remain **NOT VERIFIED** until R5's own exact head runs after trusted installation and baseline reconciliation. |
| R5 feature/security matrix | **BLOCKED / NOT VERIFIED** until the relevant R4 baseline is reconciled and R5's own deletion/reference, setup/persistence, account-isolation and recovery/regression cases actually run. Representative probes do not waive missing or failed cases. |
| Protected signed beta and store delivery | Phase B: **NOT IMPLEMENTED / NOT VERIFIED**. Existing Fastlane lanes are not a validated cloud release workflow. |
| Physical phone/signer acceptance | **NOT VERIFIED** without named authorized tester reports for the exact approved distributed artifact. Hosted simulators/emulators supply no physical credit. |

The Phase A action-pin contract also found a malformed inherited Android
emulator-action reference in #7060. The new worker uses the verified v2.34.0
commit; resolve/review the dependency reference in #7060 before installation.
Its historical successful run is not proof that the malformed literal works.

The active R4 PR [#7045](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045)
and its existing process remain untouched. Do not update its source, refs,
fixtures, Mac work, gate or approvals to adopt this pipeline. Do not transfer
#7060's or this candidate's results to R4 or
[R5 #7058](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7058).

Before adoption, independently review #7060's workflow, dependency and iOS-native
changes against R4's eventual released baseline. Obtain owner approval before
merging it. Then review the separate Phase A candidate and install its reviewed
workflows on `sprint` only with approval. A stacked candidate can test its
infrastructure, but cannot certify its own untrusted CI or bypass the currently
required `keeper/local-validation` and `Tests` checks. Preserve the existing safe
Local fallback until the applicable hosted capability is proven.

## Phase A: reusable hosted acceptance

The shared platform job is `.github/workflows/keeper-native-platform.yml`
(`workflow_call`); `.github/workflows/keeper-release-acceptance.yml` invokes it for
PRs targeting `sprint`. The trigger applies to future release/app PRs without a
version-specific selector or manual workflow copy. The explicit active-R4 #7045
exclusion prevents this rollout from starting new work on that release.

Each run must use the full current PR head SHA and a disposable development
configuration, with read-only repository access, no persisted checkout credential
and no production signing/service secrets. Native builds execute PR-controlled
source on disposable runners; independent source/CI review remains necessary.
Reviewed workflow/harness provenance and actual step outcomes must be checked
before treating a run as trusted evidence. Changing CI infrastructure requires
review before it supplies authoritative acceptance.

Preflight compares the caller, shared worker, existing #7060 workflow and the
complete native harness against the exact app source, the current `sprint` base
and the event's original base. The summary also verifies the newest Actions run,
its exact attempt, PR association and actual native job/step results through the
read-only Actions API. A partial rerun cannot reuse an earlier attempt's pass.
Required executable files must exist as ordinary
files in all three snapshots. Missing installation, changed CI, fork provenance
or a concurrent source/base change supplies no native credit. Consequently this
stacked candidate **skips its new native jobs** before reviewed installation.
The full acceptance summary deliberately fails even if both primitive probe jobs
pass: five required app scenarios are still **NOT IMPLEMENTED**. Extending those
scenarios requires executable tests and review, not changing a status/waiver.

The bounded representative matrix extends #7060's startup smoke with a separate
development-only probe entrypoint using real native Realm/MMKV modules and the
current app schema. Across three process launches it seeds synthetic wallet
records, checks persistence and separate Realm-file isolation, rejects a wrong
Realm encryption key, checks transaction rollback and targeted Realm deletion,
then verifies persistence and deletes its disposable state. Its wallet records
contain an invalid public sentinel, with no fundable keys. This verifies native
storage primitives, not product key deletion/reference protections, app account
isolation, setup/retry behavior, recovery, upgrade or release performance.

Use only job-created throwaway state: no Mac accounts, keystores, private signer
material, historical fixtures, funding or live signing. The summary must fail
full acceptance when required R5 app/security cases are missing, blocked or
failed. Keep the matrix small enough to fit the hosted job budget; expand
coverage only for a concrete release risk.

For every release, the Cloud handoff records:

- Full PR head SHA and PR URL; required `IOS`, `ANDROID` and, when applicable,
  `HARDWARE` checks.
- Workflow run URL/attempt and actual build, startup, integration and timing
  outcomes for each platform: `PASS`, `FAIL`, `NOT RUN` or `BLOCKED`.
- Safe artifact identity/hashes and the exact scenarios exercised, with missing
  feature/security cases and failures kept explicit.
- Remaining physical checks, assigned tester and any required owner decision.

Use the existing **Codex local handoff**, `State: NEEDS_LOCAL` and `Required local
checks` fields in [AGENTS.md](../AGENTS.md). These are the current gate's protocol;
the default execution destination for R5/future native work is hosted CI.
`Local checks requested: NONE` is appropriate only when trusted hosted evidence
satisfies all required native checks and no physical checks remain. Otherwise
describe the actual fallback or physical work. Do not invent a passing Local
report to represent a hosted run.

A new head commit invalidates previous native evidence and owner scope decisions.
Rerun both platforms on that head. Retain bounded safe metadata and diagnostic
outcomes on failure; do not upload raw logs, credentials, generated account data,
screenshots or development app bundles just to document a pass. A development
artifact hash is not a signed beta identity. Follow the trust, bootstrap, runner
budget and evidence rules in [hosted native validation](hosted-native-validation.md).

### Staged runner budget

The current R4 gate and #7060 startup workflow stay unchanged. During staged
adoption, each eligible app PR push can therefore run the original startup pair
as well as the new build/probe pair. The original caps are 65 iOS / 60 Android
minutes; the new shared worker caps each platform at 75 minutes, builds once and
runs startup plus native storage probes. Neither has automatic retries. The
combined ceiling is 275 runner-minutes per push, approximately $9.49 if billable
at the reference rates in [hosted validation](hosted-native-validation.md), before
allowances/storage/other CI. This is a planning ceiling, not observed runtime or
an account bill. The uninstalled candidate starts no new native jobs.

Consolidating those platform builds and their trusted gate consumer needs a later
reviewed change after the R4 noninterference constraint permits it. Do not alter
R4's current gate or discard failed evidence to reduce this rollout's cost.

## Phase B: separate protected delivery workflow

**NOT IMPLEMENTED / NOT VERIFIED.** Deliver this in a separate PR with a short
scope estimate before implementation. Keep Phase A focused; split or defer work
if a phase approaches approximately 20,000 changed code/test tokens or contains
two substantial independent features.

Review the existing `ios/fastlane/Fastfile` and `android/fastlane/Fastfile` before
choosing hosted macOS/Linux delivery, or Xcode Cloud for iOS. Inventory these
prerequisites with the owner; record credential owners and availability without
copying secret values into issues, PRs, logs or artifacts:

| Area | Setup to resolve before signing/distribution |
| --- | --- |
| iOS | Apple team/app identifiers, distribution certificate/private-key custody, provisioning profiles, App Store Connect upload authorization, TestFlight groups and approved channel mappings. |
| Android | Package identity, existing upload-key custody and alias, Play App Signing status, least-privileged Play service account, internal-test track and tester access. Never regenerate an upload key without authorization. |
| Both | Reviewed production configuration, immutable commit/version/build identity, fresh store histories/counters, protected environments and approvers, retained artifact hashes/signatures/provenance and distribution receipts. |

Audit tracked native signing configuration for embedded credential fields without
printing their values. If values may be live, use the project's private security
process and plan replacement/rotation with the owner. Do not assume tracked
values are valid, usable or safe to reuse. Existing Fastlane build-number
mutation and immediate upload behavior must be reviewed for exact-artifact and
approval controls before being used remotely.

The release-only workflow must accept trusted reviewed release source and bind
its exact commit, version, build and channel. Production secrets belong only in
least-privileged protected environments, never a PR job. Require explicit owner
approval before signing and before any TestFlight/Play internal upload or other
distribution. Preserve the signed artifact's hash, signature identity, provenance
and upload receipt; testers and publication decisions must refer to that same
artifact. Require separate explicit owner approval for external submission and
public publication. Never treat a passing build, gate or beta test as approval.

One-time account/provisioning/key-custody setup may require the owner. Describe
that setup honestly; it is separate from an ongoing requirement to unlock the
owner's Mac for each release.

## Physical checks and final review

Assign a named trusted tester/maintainer, or a securely operated device facility
for supported cases, to install the approved TestFlight/Play internal artifact.
Record the artifact hash/build/channel and head SHA, tester, phone OS/model,
signer model/firmware, requested scenarios, actual outcomes and unresolved cases.
Exercise real biometrics, cameras, NFC/USB/BLE, hardware signers and relevant
policy/recovery behavior on the devices that support them. A simulator report
cannot stand in for those results.

Use owner-approved physical scope and retain [the existing exact-SHA HARDWARE
deferral and critical-defect restrictions](../AGENTS.md#owner-directed-post-release-test-scope).
A failed check or high-risk issue involving keys, recovery, funds, backups or
incorrect signing stays blocking. Owner deferral must remain honest about
unrun cases and cannot waive a required failed platform or physical result.

Independent review, feature/security acceptance, artifact/version checks and
explicit per-release approvals remain separate from CI. Report each unproven
capability as **NOT IMPLEMENTED / NOT VERIFIED**, preserve current safe fallback,
and state the next concrete action. Future releases reuse these reviewed shared
workflows; only their source, versions, relevant acceptance cases, artifact and
approvals change.
