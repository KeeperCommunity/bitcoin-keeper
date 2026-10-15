# R5 Cloud workstream

Status: development draft; R4 release baseline pending. No app version/date assigned.

## Authority and budget

Owner request and Master Task List, Backlog row 245 (15 October 2026 scope reset),
plus rows 7, 8, 23, 76, 231 and 263. The owner's current request allows independent
implementation now; historical instructions to wait for R4 still apply to work
that depends on R4. PR base is `sprint`; do not import the unmerged R4 candidate.

Pre-implementation changed code/test estimate (not model context or runtime cost):

| Area | Tokens | Complexity | Regression risk |
| --- | ---: | --- | --- |
| Safe discoverable key deletion #7006 | 6k–8k | Substantial feature 1 | High: signing material and wallet references |
| Android startup/first use #7046, measured #6813 | 5k–7k | Substantial feature 2 | Medium: initialization, authentication, retries |
| Bounded #7055/#6991 and confirmed minor corrections | 2k–3k | Small investigations only | Medium until reproduced |
| Total | 13k–18k | Two substantial areas | Security review and native acceptance required |

Warn and propose a smaller split before exceeding approximately 20k changed
code/test tokens or adding a third substantial feature. Investigations do not
implicitly authorize architectural fixes.

Excluded: Receive QR (R7); broad components, terminology and touch targets (R8);
global text scaling and Ask Keeper reply delivery (Soon); #6917 guided setup (R10);
#7056 second backup POST and #7057 restored-fixture follow-up (Later).

## Baseline and overlap

Inspected R4 PR #7045 at `4927ad549dd1d610d9eb84c6d9a37ed0a6f33a29`.
It is unmerged and NOT RELEASE-READY. R4 changes the backup/deletion backend,
Login/CreatePin, Home/navigation, ResetEmergencyKey/ResetInheritanceKey, transaction
views and Android native configuration. Leave those dependencies alone now.
R4, Reproducibility, Bitkey/Assisted Multisig and Claude-review branches are not
implementation sources for this workstream and must not be modified.

The three initial R5 UI modules are byte-identical between the inspected R4 head
and sprint. Initial independent changes:

- Keys tab links to Manage Keys; visible eligible keys offer Delete without Hide.
- Read the full Vault collection rather than the network/canary-filtered display
  hook for active-reference protection. Recheck after passcode entry. Preserve
  Recovery Key/Policy Server exclusions, hidden-key authentication, cancellation
  and archived-reference retention. No backend deletion or backup changes.
- Remove the duplicate setup-error modal; clear the previous error on Retry so a
  subsequent failed attempt can report its error again.

This is an initial source checkpoint, not completed R5 or native acceptance.
Backend atomic reference enforcement and account/session changes need reconciliation
with the released R4 implementation before deletion can be release-ready.

## Remaining bounded work

1. Reconcile with the released R4 source; rerun deletion tests and inspect every
   delete/archive caller and storage/backup boundary. Include references across
   normal, hidden, archived and canary wallets and signer identity variants.
2. #7046: profile Android cold/warm/resume time to usable PIN/home; remove artificial
   splash wait while preserving theme/network/Tor/auth/deep links. Do not substitute
   the animation's configured 3000 ms for measured startup performance.
3. Exercise setup failure/offline/retry with one dialog/one attempt, success,
   relaunch and no duplicate wallet. Correct Maestro login to visible/disabled
   Proceed only after the R4 shipped PIN baseline is available (sprint is older).
4. #6813: time first-wallet creation on disposable state, preserve build/device,
   sample count and raw durations. Diagnose only measured bottlenecks.
5. #7055: supported single-user Android plus controlled clean state; Wallets → More
   → Wallets after backup opt-in/Delete, cold launch and account changes. Preserve
   logcat/task evidence. Existing report does not establish an app root cause.
   No navigation patch without confirmed narrow cause.
6. #6991: inspect source timestamps, wallet list/history/details, pending/confirmed/
   cached data, timezone changes and DST on actual R4-derived build. Current source
   uses local Moment/Date formatting; source inspection alone does not prove or
   disprove the Android report. No speculative timezone patch.
7. Verify shipped #7007 rapid PIN/delete, lock/unlock and biometric behavior;
   do not redo shipped fixes. Verify Emergency/Inheritance helper text and Assisted
   Server Backup copy against what R4 actually ships, then make copy-only fixes.

## Later Local resource plan

No Mac is needed for Cloud development. Do not start Local native work while R4
is being finalized. When the baseline is settled, use a separate safe checkout,
check available disk (approximately 6 GiB minimum planning threshold; require more
if the selected build needs it), run one native build at a time and reuse safe
compatible caches/artifacts. Preserve every existing worktree, simulator, AVD user,
wallet/database, artifact and evidence file. Never clean/delete them without owner
approval. Recheck free space during builds and stop safely if capacity is inadequate.

Native matrix: iOS and Android for shared UI; physical PIN/biometric verification;
unused visible/hidden key delete and cancellation; active/hidden/canary/multi-wallet
blocks; archived retention; reference added during passcode; Recovery/Policy Server
exclusions; offline/retry/resume; small screens/light/dark/large display settings.
No native result is implied by a unit test. No merge, signing or publication authority.

## Cloud validation, initial checkpoint

- `yarn install --frozen-lockfile --ignore-scripts`: FAILED, existing sprint
  manifest/lockfile mismatch. `corepack yarn install --pure-lockfile --ignore-scripts`:
  PASSED, no tracked manifest/lockfile changes. Nested git dependency preparation
  still ran its package builds. This fallback is not reproducibility evidence.
- `node_modules/.bin/jest tests/screens/DeleteKeys.test.tsx tests/screens/NewKeeperApp.test.tsx tests/components/Button.test.tsx tests/components/UTXOFooter.test.tsx --runInBand --coverage=false`:
  PASS, 4 suites / 22 tests. New screen tests are 13 cases; use mocked native,
  storage, signer-identity and dispatch boundaries. They do not prove actual
  Realm transactions, native passcode storage, hardware or backup behavior.
- Initial test harness run: FAILED module resolution for dynamically registered
  mocks (0 tests executed). Corrected mock paths; final command above passes.
- Focused ESLint on the three touched UI modules: FAIL, 29 errors / 17 warnings.
  Read-only stdin comparison with origin/sprint finds identical error/warning
  counts and rule/message findings (line numbers in two inherited shadow warnings
  moved). Tests are ignored by the repository ESLint configuration. No claim of
  repository-wide lint or type-check success.
- `git diff --check`: PASS. Localization JSON parsing: PASS.
- Security-focused executed coverage: reference blocking, reference added during
  passcode entry, cancellation, archived retention, Policy Server and Recovery Key
  exclusions, hidden-key concealment and repeat confirmation. Backend/session race
  enforcement and true signer identity integration remain unverified.
- Native iOS/Android builds, emulator/simulator, physical biometrics/signers,
  startup/first-wallet timing, CodeQL and full repository test suite: NOT RUN in
  this checkpoint. No Android SDK/adb was available in this Cloud workspace.

Next: after R4 release, reconcile this draft with its exact baseline and rerun
these tests; review backend reference enforcement before expanding deletion use.
Then complete the bounded startup work and actual performance/native matrix.
Do not claim R5 completion, close issues, merge or release this checkpoint.
