# R5 cloud integration and acceptance record

This is an isolated candidate, not release approval. Ordinary development and
native testing use Cloud, including hosted macOS; the owner's personal Mac is
not a prerequisite. No producer branch or shared branch is rewritten.

The current package ledger is [R5 delivery continuation](r5/DELIVERY-CONTINUATION.md).
The PR descriptions hold exact candidate/run/attempt results; implementation
package checks below never transfer to a new integration SHA. The isolated
completed execution window on #7082 remains at3eb92fc. The sole next hosted
window is #7107 at23f14e01f3437c213f1443c3167d96022f3a43bc, separate from
this integration's later SHA. Its receipts never transfer to this source.

## Source continuity

Observed 22 October 2026. Recheck producer heads before candidate freeze.

| Input | Verified commit | Integration |
| --- | --- | --- |
| Released R4 | `1d8a86a7462d935cbd0e28b857934b5718c152fc` | Ancestor of core and 5.1; no further R4 confirmation required |
| Core #7058, `codex/r5-key-deletion-startup` | `77b72da29ac5f2cdf3f51c9a0e9f3fd1c2af7238` | Included by ancestry |
| 5.1 #7067, `codex/7066-protected-backup-correction` | `c1c4b803039b61b940373c4dc9d08473cf25e042` | Integration starts here; includes backup and Version History corrections |
| 5.2 | Identity and authoritative checkpoint unresolved | Owner reports running; do not infer identity/completion or duplicate its implementation |

Patch-only review links remain separate:

- [Core changes after released R4](https://github.com/KeeperCommunity/bitcoin-keeper/compare/1d8a86a7462d935cbd0e28b857934b5718c152fc...77b72da29ac5f2cdf3f51c9a0e9f3fd1c2af7238)
- [5.1 changes after core](https://github.com/KeeperCommunity/bitcoin-keeper/compare/77b72da29ac5f2cdf3f51c9a0e9f3fd1c2af7238...c1c4b803039b61b940373c4dc9d08473cf25e042)

5.1 contains exactly two commits after core: protected-backup correction
`3c5f8d8ace5c211ed78264b1a460c4e06e060ceb`, then Version History correction
`c1c4b803039b61b940373c4dc9d08473cf25e042`. Package names 5.1 and 5.2 do not
assign app versions. Existing native inputs remain 2.6.4 / Android627 / iOS620;
the recorded R5 version intent does not establish new build counters.

## Approved scope and package boundaries

Master Task List Backlog245 and relevant R05 rows select safe discoverable key
deletion, wallet-reference protections and startup/first-use reliability;
bounded navigation/timezone reproduction; PIN/biometric verification; Emergency
Key and Assisted Server Backup copy. Later owner additions select protected
backup/Version History correction, cloud testing, bounded signing preparation,
PHP exposure research (remediation belongs to R6), applicable Claude review and
the separate read-only timelock-assessor candidate with its remaining safeguards.

Core and 5.1 already total roughly 35k changed code/test tokens. This integration
PR assembles reviewed inputs and evidence. Further implementation stays in
separate patch packages: CI reconciliation, executable native feature scenarios,
confirmed biometric callback correction if reproduced, current-protocol witness
repair if needed, and protected-release/non-app readiness. Re-estimate any package
approaching 20k changed code/test tokens or more than two substantial features.

Excluded scope stays excluded: all-copy legacy backup purge, parked #7056 second
POST investigation, storage/passcode redesign, Receive QR, broad navigation,
terminology/scaling redesign and Assisted Multisig implementation. Preserve the
existing assessor candidate; do not infer that it is 5.2.

## Acceptance rules

- An implementation checkpoint is not native acceptance or backend compatibility.
- Tests and artifact evidence belong to the exact tested checkout. Never transfer
  results from infrastructure-only source or an earlier candidate SHA.
- Run disposable current-protocol backup, recovery, deletion and account-isolation
  checks. Do not operate production accounts.
- Native acceptance requires feature checks and at least five raw startup and
  first-wallet observations, not only a startup/passcode smoke.
- Real biometrics, phones and signers require actual devices/testers. Emulator
  evidence cannot satisfy them.
- Hosted diagnostics of unmerged infrastructure cannot satisfy a gate that
  requires reviewed workflow ancestry. Keep trusted gates fail-closed.
- Signing, upload, distribution, deployment, publication, merges and shared-branch
  promotion require separate explicit owner approval. No such action is performed.

## Initial inherited evidence and unresolved findings

The original core and 5.1 Tests/public-backend jobs pass on their recorded heads.
Their old genuine automatic-backup matrix fails; the historical fixture's result
must remain visible alongside the current-v3 witness. CodeQL analysis execution
passes, while the separate security result fails on an inherited high-severity
incomplete sanitization finding at `src/services/wallets/operations/index.ts`.
This initial checkpoint established no independent clearance or severity waiver. Lint jobs tolerate
command failures; green jobs do not mean lint is clean.

Read-only alert triage confirmed the flagged module blob
`db29ee432496e84bc70be82b0d9a3017e154888d` is identical in released R4, core,
5.1 and the inspected interim candidate. The flagged string feeds a numeric
witness-size estimate; no HTML sink was established in the traced callers.
An earlier uncommitted literal-selector counting candidate matched 140 pinned fixture
witnesses and 104 production-helper comparisons. This is bounded triage, not
an exploitability clearance or signing-security review. The later separately
reviewed #7098 literal-selector correction is now incorporated by ancestry, with
fresh223 controls and78policy/927witness/120fee-API baseline evidence. Its scoped
official check passes, while its reported full-R5 scan retains another inherited
High. The original failed check stays attached to its original source; no
dismissal, waiver or transfer of security acceptance is made.

At initial integration there is no combined native acceptance, no five raw
measurements and no identified 5.2 checkpoint. Candidate freeze is blocked until
the authoritative 5.2 handoff is rechecked and all package results are recorded.

## Separately reviewable delivery packages

These are implementation checkpoints included or tracked by this integration,
not transferred acceptance results. Current exact-head results belong in this
PR's handoff and the referenced immutable workflow receipts. Do not commit a
post-test evidence update and silently transfer results to the resulting SHA.

| Package | Review / implementation checkpoint | Status and next action |
| --- | --- | --- |
| Core deletion/startup | #7058 / `77b72da29ac5f2cdf3f51c9a0e9f3fd1c2af7238` | Included; complete combined native feature acceptance |
| 5.1 backup and Version History | #7067 / `c1c4b803039b61b940373c4dc9d08473cf25e042` | Included; current-v3 genuine witness passed on earlier exact app checkpoint, rerun combined |
| 5.2 | Owner-reported running, authoritative task/branch/PR unavailable | Running dependency; obtain checkpoint, inspect overlaps, integrate verified commits, rerun affected checks before freeze |
| Cloud reconciliation | #7070 / `17baf3bff3a5cd96787218b9e8e1fee75f549967`; inputs #7060/#7063/#7062 | Included with original patch review links; installed-base trust and required branch protections remain separate from diagnostic execution |
| Native production-worker witness | #7071 / `486810052f90550d55dd6ddd541ff53ebd875caa` | Included; actual Realm/MMKV worker scenarios, explicitly controlled generation/transport/dispatch; execute on exact combined source |
| Full-product UI measurements | #7073 / `040955d0caca38bb3cb386ca2918adf60f0f30db` | Included; require five healthy numeric samples plus a separate failed-transport/explicit-Retry fixture, actual normal app and cold relaunch/counts/navigation; no helper timing substitution or WAN-offline claim |
| Native key/PIN UI companion | #7079 / `5c4c211339aeee3216faa0663c309314a1627123` | Included; normal app unused Mobile Key creation/deletion, cancellation, wrong-PIN rejection/retry and cold persistence. Seven independent controls pass; referenced-Vault UI, credential-store read faults and real biometrics are not covered |
| Installed native bytes | `551ce622e94315091e2cf073736c2a5ad8d9ba27`; UI wiring `eee849144ddf706f7786f482b744596cd395a60d` | Included; full owned iOS bundle/executable and single Android installed-APK comparison before/after probes and product UI. Eight independent file/transport controls pass; actual native verification remains unrun until this candidate executes. Installer transformations do not receive an equivalence waiver |
| Confirmed biometric callback defects | #7069 / `257fbe17e1a85d0e5d7e5d8ab97e1a69edbd9628`, review correction `14a2459b30e31ea3099d56f6c6928a4a3b7d6995` | Included; independent review reproduced prompt repetition and stale epoch cases; 17 component controls pass, actual biometrics remain unrun |
| Current protocol pairing | Private Relay #160 / `4db6a758a307111137ad6bb4f35a32fa15b17a9d` | 52 backend + 43 protected app + 1 upgraded-account + 3 guard cases pass at their exact documented pair; pin/retest combined app SHA |
| Protected release preparation | #7072 / `f2fc0cb557f0e5303335dadc9e98152640795e6c`; origin correction #7074 / `76150f455978c1a565f2c670774672bc18789877` | Included; inventory and plan controls implemented, authorization planning deliberately disabled until installed CI origin is verified. Review reproduced forged check-name acceptance; 21 corrected plan controls pass with specific rejection-code assertions. Separate future workers/protected setup remain, with no signing/upload executed |
| PHP exposure research | #7072, `docs/r5-cloud-release-readiness.md` | Official advisories/source assessment documented; deployed runtime inventory unknown, no Keeper exposure assertion; remedies stay R6 |
| Navigation/timezone/PIN/copy | `docs/r5/BIOMETRIC-LIFECYCLE.md` and source tests | No speculative #7055/#6991 fix; bounded native reproduction/device checks remain. Retain shipped PIN and scoped EN/ES corrections |
| Read-only timelock assessor | Separately recorded candidate, not identified as 5.2 | Source/handoff and complete key/origin/script/intent binding and native isolation acceptance remain; no activation or wallet clearance |
| Independent/Claude review | Source review receipts on package PRs; policy #7034 / reviewer #7049 | Independent agent reviews performed. Apply risk-based conditional review; policy/auth/recovery/CI changes require adequate review. Applicable Claude provider review remains unavailable without trusted installation and verified existing authorization/budget; no new paid activation or blanket human-review requirement inferred |
| Physical acceptance / release evidence | Exact artifact and authorized tester required | Not run; no physical deferral inferred. Version/build allocation, protected signing and distribution require the specified fresh evidence and explicit approvals |

The infrastructure adoption is about **54k changed code/test characters/4** across
the existing packages, much larger than an older 19k estimate. The initial new
reconciliation was about 6.7k, with a small additional runner hook. Preserve the
original #7060/#7063/#7062 reviews and the reconciliation-only comparison; this
aggregate is an integration input, not a request to approve one new 54k patch.
Native worker (~7.8k), product measurements (~10.1k), key/PIN UI (~6.5k), biometric correction (~4k)
and release preparation (~7.2k code/test, ~12.7k including research/docs) stay
separate. Signing worker preparation grew during independent review and is split
into bounded core authorization/platform adapters and separate orchestration/
uploader packages, with a small locked Ruby-toolchain package. None is integrated
into this native candidate or executed. Exact canonical-source native attestation,
protected environments and one-time credentials remain real dependencies. The
unknown 5.2 delta is not estimated by guessing.

The first combined preflight exposed an expected-workflow allowlist mismatch
after adding the offline release-preparation contracts. It is retained as an
integration failure and corrected by explicitly admitting that read-only test
workflow and asserting that the protected release plan remains manual-only.
The corrected policy controls pass; no release gate or test was removed.

The first hosted contract job on interim `7785c741be203cc348726293537238b54183861a`
(run39735104974) failed because the lightweight runner lacked TypeScript after
worker-extraction contracts were included. The correction installs only a locked,
script-disabled TypeScript5.0.4 test tool, matching the frozen app lock integrity,
and verifies that its version matches the candidate manifest. The failed receipt
remains preserved; this does not narrow or skip the worker tests.
