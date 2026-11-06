# R4 tests that could move to hosted runners

Assessment date: 17 October 2026. This is a read-only assessment of
[R4 PR #7045](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045), whose
live head was rechecked as **`be89c34473bb6aab253b98325f1fe746ca391c6f`** on branch
`codex/r4-264-combined-candidate`, targeting `sprint`. R4 remains draft,
**BLOCKED / NOT RELEASE-READY**. This document changes no R4 code, refs, checks,
comments, test scope, or release decision.

Fresh hosted runners can take over disposable native build, startup and local
persistence checks. Much of the remaining backup/recovery matrix is also
technically suitable for fresh hosted simulators, but requires a separately
reviewed, disposable **protected-v3** backend and native observation harness that
are not supplied by the startup smoke. Existing private accounts, databases,
artifacts and upgrade continuity must stay with their current Local evidence.
Physical-device and signing work remains separate.

## Evidence and current limits

The newest [Local report, 17 October 06:41 UTC][latest-local] is `BLOCKED` at the
exact R4 head above. It supersedes only the subsets it actually exercised:

- iOS installed/launched the current Debug simulator artifact, completed protected
  Recovery Key recovery, matched the backed-up wallet/signers/label/account
  metadata, and passed cold PIN and native consent-OFF persistence checks.
  **Whole-current-image equality did not pass:** two local-only NodeConnect
  records remain, with `canonicalRecoveryEqual=false`. Do not remove those
  records from the comparison or call that result a full restore pass.
- The [Android producer report][android-positive] records actual strict-16KB
  Hermes/crypto, opt-in/repair, rename and positive production-action results,
  complete native comparisons and cold persistence. This is a demonstrated
  subset, not all operation/UI acceptance. The [later report][android-followup]
  adds account/consent/status cases and preserves a lost-response condition with
  **two mutation requests after one UI action**; its no-second-request condition
  failed. Later successful read-only reconciliation does not erase that result.
- The retained strict-16KB Android VM subsequently failed to finish OS boot after
  the Mac restart. Keeper recovery did not run in that attempt. This is a runtime
  blocker, not a diagnosed app failure or permission to replace its retained data.
- Required IOS/ANDROID coverage remains incomplete. At 07:04 UTC, release owner
  `antuz123` posted a fresh [exact-`be89` physical-only scope decision][owner-scope]
  deferring eligible unrun HARDWARE checks to owner post-release reporting.
  Physical tests remain **NOT RUN**. No later `LOCAL_PASSED` report exists;
  IOS/ANDROID acceptance, known failures and review/release gates remain required.
  The owner-reduced [release-essential plan][owner-plan] remains in effect, with
  its historical SHA boundaries and parked cases preserved.

At this assessment's starting snapshot, [infrastructure PR #7060][infra-pr] was
at `3e32c3611186cf4e0d41ff2e33aff15c222e8fcf`. Its [hosted run][initial-run]
failed dependency setup on **both platforms**; native builds and UI smoke were
NOT RUN. Its 47 passing infrastructure contracts are not native passes.

The subsequent [hosted run at infrastructure head `9509`][repair-run], full SHA
`9509da6bb2b533c348846b2ec079ac5ca27ffae3`, passed immutable dependency installation
on **both platforms** and the actual Android development native build. Android
smoke setup then failed when `emulator -version` exited 127, before app install;
Android UI smoke has **not passed**. The iOS native build subsequently hit its
35-minute command timeout (exit 124); iOS smoke was **NOT RUN**. Record final
source/run/attempt and actual platform results in the PR report after the remaining fixes and final run; these
intermediate results do not establish both-platform native acceptance. Even
successful #7060 startup smoke will not attest R4 source `be89`, its private
fixture, or any backup/restore case below.

The R4 head's `keeper/local-validation`, public automatic Realm/Relay lane and
CodeQL aggregate were still failing when inspected. Successful Jest, CodeQL
analysis execution and backend bootstrap jobs do not reverse those results. The
[current handoff][handoff] records actual exact-source host proofs and their
limits separately from full native acceptance.

### Exact-R4 setup must be reviewed separately

A read-only source audit found no missing root Yarn selectors at `be89`; no R4
install or build was attempted here. Its committed Pod lock records CocoaPods
**1.15.2**, while #7060 installs **1.16.2**. CocoaPods' [deployment verification][pod-deployment]
compares the complete regenerated lock, including that version field. The
unchanged #7060 setup therefore cannot satisfy the exact R4 lock. A future R4
lane must match its reviewed toolchain, including the handoff's Node **22.23.3+**,
and preserve its Nitro/Hermes inputs. R4's public local-backend guide also warns
that Hermes podspec checksums can depend on checkout path: report a strict-lock
mismatch as **BLOCKED**, rather than rewriting the lock to obtain a pass.

R4 has no copy of this new native workflow/harness. Reusing the approach needs
separately reviewed orchestration of its exact head, without edits to R4 source.
Explicit generated loopback configuration and dummy Firebase can cover startup;
blank service values must not activate real-service defaults. Fresh account
creation needs the separately reviewed public local services, while protected-v3
requires its separate authorized fixture source. None was obtained or started
for this assessment. #7060's source or toolchain is not a substitute for R4's.

## Fresh disposable cloud candidates

Every row below is a **candidate, NOT RUN by this assessment**. None uses the
Mac's retained APK/app, accounts, PINs, mnemonics, ciphertext, Mongo database,
fixtures, logs or volumes. Generate any needed test material within the new
job, use no funds/providers, and destroy only that job's state after preserving
safe nonsecret evidence. Existing successful Local subsets stay valid within
their recorded scope; setup prerequisites below do not request redundant Local
retests or start a new R4 build campaign.

| Case or prerequisite for remaining tests | Hosted execution that can be safe | Prerequisites and acceptance boundary |
| --- | --- | --- |
| Exact-source development build/install/startup on both platforms; PIN create/confirm/cold unlock | Fresh iOS Simulator and Android emulator, unsigned/debug configuration, generated throwaway PIN | First demonstrate #7060's real build/UI passes. R4 then needs its **own exact-head** execution and artifact/config identity; another PR's pass does not transfer. Current #7060 smoke stops before saving a PIN or creating an account. |
| Actual normal-4KB Android native runtime and Hermes/TextEncoder/BigInt initialization | Fresh explicitly identified 4KB emulator; measure actual page size and exercise the native app | Record API/ABI/image, `PAGE_SIZE`, package/source and result. It does not replace strict-16KB ARM64 evidence or its JNA/Portal requirements. |
| Encrypted Realm and MMKV cold persistence using newly generated records | New isolated account/state, native process restart, actual PIN and MMKV/Realm reads | Needs a reviewed native observation path; Node Realm, AST projection and a Metro bundle compiled for Hermes are not native runtime proof. Compare complete counts/fingerprints, consent and session before/after restart. |
| Native Portal introduction/catalog and brief wallet/base rendering without a device | Fresh emulator/simulator and locally generated unfunded/public test records | Limit result to rendered screens/native initialization. No NFC/USB, real camera, signer, biometric or signing claim. Preserve owner-parked navigation scope. |
| Packaged native-library graph, ELF/RELRO/ZIP checks on a newly built test APK | Run the existing source checker on the new job-owned APK and record exact supplier/packaging identities | Static PASS is not install/launch PASS. The [16KB source guide][android-16kb] requires final packaged bytes, including source-linked libraries, rather than a supplier sample. No Mac APK download is needed. |
| Canonical-versus-legacy MMKV ordering, confirmed absence versus read errors, fallback persistence and stale Verified after cold launch | New locally generated MMKV/Realm fixtures with reviewed bounded fault injection and actual app restarts | No copy of existing persistence files. Do not fabricate app verification/consent or turn a missing native probe into success. Independent combinations remain explicit; a normal cold-consent pass alone does not prove them. |

These cases can reduce Mac build/UI time without depending on its existing
private fixture. Fresh account creation must use a reviewed disposable local
onboarding path: the existing protected-backup fixture alone does not serve
onboarding/channel/provider APIs.

## Protocol cases suitable only after a new reviewed fixture exists

The [exact-head protected-backup guide][protected-guide] says the public Relay
`838049e537e07eb646a2a0393eb969fba43d0739` v2 lane is incompatible with current
protected-v3 consumers. The separately reviewed backend is
`7693ce4bfffcadb5fb71d6478a8befc8e533a844`; it is not automatically available to
public/fork CI. The existing backend/fixture data has not been obtained for this
assessment. Do not vendor private inputs, change contributor pins/readiness
constants, substitute a permissive mock ACK server, or weaken genuine proof to
make a hosted run green.

A future cloud lane would need authorized, separately reviewed protocol source;
a new credential-free, job-owned transactional loopback database; new test
accounts/keys and deliberate older-copy ciphertext generated inside that job;
and reviewed native UI/action, HTTP-count and complete crypto/readback evidence.
If those prerequisites cannot be supplied without private transfer or R4 changes,
these rows remain Local. The existing #7060 harness supplies none of them.

| Exact remaining R4 cases | What a fresh hosted reproduction must prove |
| --- | --- |
| Original zero-node opt-in → default-node bootstrap → automatic Verified → rename → full readback/no-op/cold sequence | Start from a genuinely new account with initial-node state that permits bootstrap; preserve original order and prove automatic completion without manual repair. The existing Android account whose `initialNodesSaved` was already true does not satisfy this case. |
| Android clean protected restore; explicit older-copy restore on both platforms; remaining iOS positive/consent/account acceptance | New synthetic datasets and blank destinations, actual native crypto/canonical/metadata comparisons, correct provenance and consent OFF. No automatic older-copy fallback on absent/empty/tombstone/error. The observed iOS whole-image difference remains a separate unresolved result. |
| Scoped protected Delete confirmed/uncertain response, cold tombstone discovery, explicit recreate and EN/ES notices | Run Delete **last, after restore proof**, on the new job's protected copy only; positive acknowledgment plus authoritative readback, local recovery data retained, consent OFF after cold launch, older encrypted copies still read-only. Uncertain deletion is not success. |
| Representative stale payload/session/CAS/partial-fanout/final-verification boundaries | Actual native production paths with bounded holds/faults, zero wrong-account/stale writes, complete immutable original proof and truthful pending/incomplete state. Do not reinstate exhaustive cross-products parked by the owner. |
| Old-session delayed completion, recovery supersession and consent/account timing not already instrumented | Newly generated A/B accounts, actual app-session boundaries and late native completion; no cross-account keys, data, status or stale success. Existing A→B→A status coverage does not prove every held old-session completion or first-frame flash. |
| Lost/malformed mutation acknowledgment and separate read-only reconciliation | Preserve the failed extra-request observation; count attempted requests separately from committed writes and upstream replies. A new synthetic reproduction can diagnose/recheck behavior but cannot retroactively pass the original condition or unpark C8/#7056. |

The [historical automatic matrix][matrix] explicitly distinguishes host-native
Realm/source proofs from iOS/Android runtime evidence. Its historical v2/delete
language is superseded by protected-v3: Delete affects only the new protected
copy. Existing source proof counts must not be relabeled as new hosted native
execution.

## Work that stays with Local or physical/release owners

| Work | Why a hosted replacement is insufficient |
| --- | --- |
| Existing private A/B account continuity, retained original/restore fixture databases, ciphertext and current-image differences | They bind to Local's actual data and receipts. Keep investigation and evidence in place; use only public nonsecret result summaries here. Fresh synthetic tests are additional evidence, not migration or replacement of those receipts. |
| Existing installed-artifact update/upgrade and durable private Realm/MMKV continuity | Recreating fresh state does not establish byte continuity across the retained app update, prior versions or the exact saved user data. A new synthetic upgrade lane is possible later with reviewed old/new artifacts, but is not the current startup lane or a pass for the retained upgrade. |
| Retained strict-16KB ARM64 VM recovery and its exact app/Portal/JNA evidence | #7060's standard Linux x86_64 API35 emulator is not that runtime. A separately demonstrated supported strict-16KB hosted image could cover a **new synthetic** run; this assessment neither provisions it nor moves the retained VM/state. Keep actual normal4KB and strict16KB results separate. |
| Phones, real camera/biometrics, hardware signers, NFC/USB, device prompts | Simulator screens cannot prove physical behavior. Keep HARDWARE explicit; only the existing exact-PR/head release-owner procedure may defer eligible **unrun** physical checks. Failed/critical cases are not waived. |
| Signing credentials, user approval prompts, production config/artifact/store/channel review | These are owner-controlled release operations and independent readiness evidence. No CI result authorizes signing, merge, deployment, upload, submission or publication. |

The newest report's storage shortage and OS-boot limitation are descriptions of
Local's environment, not authorization to inspect, restart, unlock, clean up,
rebuild on, or otherwise interrupt that Mac. This assessment did none of those
actions. No private native artifact or fixture was downloaded and #7045 was not
modified.

## Suggested order without changing R4 now

1. Finish #7060's reproducible dependency/native setup and demonstrate actual
   exact-head iOS **and** Android build-plus-startup passes. Keep pre-merge runs
   diagnostic: the trusted gate must use reviewed infrastructure from `sprint`.
2. Separately review a fresh-fixture coverage proposal for the first table; do
   not launch R4 native work, alter its branch, or claim its acceptance from this
   document. Preserve the original owner-reduced batch and known failures.
3. Decide whether the protected-v3 prerequisites can be provided without private
   transfer or R4 code changes. If not, leave that protocol acceptance with Local;
   fresh startup passes still reduce a useful but narrow part of future work.
4. Keep the exact-head IOS/ANDROID/HARDWARE gate, local fallback, fresh owner scope
   decisions, independent review and separate release approval. No existing
   blocked/failed R4 report is overwritten or hidden by generic hosted success.

[latest-local]: https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6230795563
[android-positive]: https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6224434285
[android-followup]: https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6224892021
[owner-plan]: https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6185462332
[owner-scope]: https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6231002359
[handoff]: https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6219779493
[protected-guide]: https://github.com/KeeperCommunity/bitcoin-keeper/blob/be89c34473bb6aab253b98325f1fe746ca391c6f/release/r4-protected-backup-app.md
[android-16kb]: https://github.com/KeeperCommunity/bitcoin-keeper/blob/be89c34473bb6aab253b98325f1fe746ca391c6f/release/r4-android-16kb.md
[matrix]: https://github.com/KeeperCommunity/bitcoin-keeper/blob/be89c34473bb6aab253b98325f1fe746ca391c6f/openspec/changes/fix-recovery-backup-freshness/automatic-write-validation.md
[infra-pr]: https://github.com/KeeperCommunity/bitcoin-keeper/pull/7060
[initial-run]: https://github.com/KeeperCommunity/bitcoin-keeper/actions/runs/39010808486
[repair-run]: https://github.com/KeeperCommunity/bitcoin-keeper/actions/runs/39012940184
[pod-deployment]: https://github.com/CocoaPods/CocoaPods/blob/1.16.2/lib/cocoapods/installer.rb#L489-L497
