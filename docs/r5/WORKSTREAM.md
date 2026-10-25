# R5 Cloud workstream

Status: development draft reconciled to owner-confirmed live R4 / 2.6.4 source
`1d8a86a7462d935cbd0e28b857934b5718c152fc`. No R5 app version/date assigned.
The earlier pending-baseline records below are historical and superseded by the
22 October owner confirmation and completed reconciliation.

## Authority and budget

Owner request and Master Task List, Backlog row 245 (15 October 2026 scope reset),
plus rows 7, 8, 23, 76, 231 and 263. The owner's 22 October confirmation that R4
2.6.4 is live authorizes reconciliation with its recorded released source on R5
only. Historical instructions to wait for R4 are superseded. PR base is `sprint`;
do not modify R4 or other workstream branches.

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

The initial checkpoint inspected R4 PR #7045 at
`4927ad549dd1d610d9eb84c6d9a37ed0a6f33a29`. A read-only recheck on 18 October
2026 found it still an unmerged draft at
`be89c34473bb6aab253b98325f1fe746ca391c6f`. R4 changes the backup/deletion backend,
Login/CreatePin, Home/navigation, ResetEmergencyKey/ResetInheritanceKey, transaction
views and Android native configuration. Leave those dependencies alone now.
R4, Reproducibility, Bitkey/Assisted Multisig and Claude-review branches are not
implementation sources for this workstream and must not be modified.

The three initial R5 UI modules are byte-identical between both inspected R4
heads and sprint. No R4 implementation was imported. Initial independent changes:

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

## Original bounded worklist (current results below)

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

No Mac is needed for Cloud source development. R4 is released and reconciliation
is complete. For later native work, use a separate safe checkout,
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

## Independent Cloud follow-up — 18 October 2026

The owner authorized continued independent Cloud implementation and automated
testing while R4 and its Mac remain untouched. This follow-up stays on the R5
draft; it changes no backend, account/session, shared PIN, native, production
configuration, version/counter or contributor-pin inputs.

Deletion review reproduced replayed and cancelled passcode callbacks dispatching
deletion, plus callbacks reading detached active/archived-reference snapshots.
Each deletion selection now has a one-use intent, consumed synchronously and
cancelled when its confirmation closes or its screen loses focus. Confirmation
reads the live Vault collection, blocking active references and retaining keys
needed by archived wallets. The screen still does not supply backend atomicity
or shared authentication/account-session provenance.

The full safety query must include concealed and canary references, but those
records must not disclose wallet names, descriptions or counts in a deletion
warning. Only the selected key identity is retained; every render reads current
references again, including newly added references and changes to visibility.
The warning uses a generic message whenever details are concealed or unavailable,
and leaving the screen clears it. Tests exercise both callback lifetime and the actual production
signer-identity helper; native Realm, presentation and dispatch remain replaced
at the test boundary.

Setup review reproduced late Firebase-token completion dispatching setup or a
token update after the screen unmounted. Effect-owned guards suppress those late
Redux actions. The tests now use the real login reducer and setup action with a
small test-owned Redux store, covering repeated error/Retry/success, rapid presses,
pending/rejected tokens and successful remount. They simulate `appCreated`; they
do not prove native wallet creation, wallet-worker success, persistent storage or
backend idempotency. No arbitrary notification timeout or navigation fix was added.

### Reproducible JavaScript preparation

The unchanged R5 frozen installation failure was reproduced first. The repair
adds only the two missing root ESLint selectors, preserving all 2,299 existing
selectors and their version/resolution/integrity/dependency fields. Manifest,
Pod lock, Nitro/Hermes and native inputs stay unchanged.

Node 22.23.3 and Yarn 1.22.22 frozen installation with root lifecycle scripts
disabled then passed; all six explicit dependency patches passed. Yarn still
prepares the pinned Git dependencies while packaging them, so this is not a claim
that no dependency build scripts execute. The existing IAP/Nitro peer mismatch
is retained and is not a native-build pass.

Both existing CI jobs now use verified immutable action pins, exact Node/Yarn,
frozen installation, fail-closed patch application and manifest/lock immutability
checks. Checkout credentials are not persisted. This avoids invoking the normal
Mac-specific root prepare script on Linux; that script can mask a CocoaPods
failure because it lacks `set -e`. Required `Tests`, the local-validation gate,
and inherited tolerated lint behavior are unchanged.

### Executed follow-up validation

- Frozen JavaScript install: PASS (250.09 seconds), after the original frozen
  failure and minimal selector repair. All six dependency patches: PASS.
- Combined offline Jest: **16 suites / 181 tests PASS**, zero failures/skips.
  This includes **42 deletion** and **9 setup-lifecycle** cases. Command:
  `node_modules/.bin/jest --runInBand --coverage=false --testPathIgnorePatterns '/tests/services/(client|wallet|vault)\.test\.ts$'`.
  The three existing live-Electrum integration suites were not run locally;
  the existing CI `npm run test` command still runs the complete suite.
- Accepted regression controls: the original deletion code failed 12/30 cases;
  subsequent lifecycle checks failed 2/32 and live-warning checks failed 10/42
  before their fixes. Original setup code failed 3/9 lifecycle cases. These
  were assertion failures after successful test setup, not native results.
- Existing merge-gate contracts: **11/11 PASS**. Actionlint 1.7.7, workflow
  YAML/shell checks, localization JSON and `git diff --check`: PASS.
- Focused ESLint: **FAIL 29 errors / 17 warnings**, exactly the original R5
  diagnostic multiset after ignoring positions, including embedded upper-scope
  line/column references. No new lint findings; this is not a clean lint pass.
- Whole TypeScript: **FAIL 1,013 diagnostics**, versus 1,014 at the original R5
  checkpoint with the same installed dependencies. Normalizing positions and
  linked dependency paths finds zero added/one removed diagnostic. The removed
  diagnostic was the existing Vault JSON conversion assignment in DeleteKeys.
- Independent review: the two additional visible-to-hidden/canary warning probes
  failed before the live-warning repair and passed afterward. No additional
  blocker was found in this bounded source/test/workflow follow-up.

The final draft handoff records the exact tested head and hosted CI results.
The initial failures above remain part of this checkpoint's history. No native
iOS/Android, physical-device, startup/first-wallet performance, real-backend or
retained-data continuity result follows from these JavaScript tests. Finish the
R4-baseline reconciliation before the affected native matrix. No Mac access,
private-data transfer, merge, signing or release occurred.

## Cloud continuation — 21 October 2026

Continued from the latest #7058 head `625435ac26af0304670c993a639626b1117699ba`
after checking current guidance, the approved sheet rows, R4 and overlapping PRs.
The [startup investigation](STARTUP-INVESTIGATION.md) records the confirmed fixes,
source traces and limits. No optional Linux setup or Mac session was required.

Independent implementation now includes starting the credential read without the
fixed splash-animation gate, explicit error propagation for startup-only Keychain
reads, one generic Retry action, stale-read protection, and setup navigation-timer
cleanup/repeat protection. The legacy login flow's visibility/disabled-state and
first-error assumptions are corrected as an unexecuted native test specification.
No R4 code/ref, shared PIN, navigation, wallet worker, backup/backend, native
configuration, dependency, CI or version/counter input changed in this follow-up.

New regression controls before fixes: Splash 9 failures/10; actual secure-store
boundary 2 failures/5; setup navigation 3 new failures/12, then a retained-callback
failure/13. These are executed JavaScript assertion failures, not native results.
All final focused cases pass. The expanded offline run passes 19 suites/218 tests,
with the same three live-Electrum integration suites excluded. Four process-level
timezone runs pass 18 cases each (72 total); no Android timezone defect or
navigation root cause is established. Neither received a speculative patch.

Focused ESLint on Splash, NewKeeperApp and secure-store still FAILS with 26 errors
and 11 warnings, versus 28/11 on the previous R5 head with the same dependencies;
no added findings after position normalization. Whole TypeScript still FAILS:
1,018 diagnostics versus 1,019 on previous head625435 with these same installed
dependencies, zero added/one removed after normalizing positions and linked paths.
These counts differ from the previous worker's 1,013 and do not supersede its
separately scoped evidence. Gate contracts 11/11, test formatting, YAML/JSON and
diff checks PASS. A transient new noImplicitReturns diagnostic in timer cleanup
was corrected before the final comparison. No clean whole-lint/typecheck claim.

R5 remains two substantial features and within its 13k–18k estimate: a rough
changed-source/test character count divided by four is about 15k tokens. This is
an estimate, not tokenizer usage. Stop/propose a split before approximately 20k
or a third feature. Native startup/first-wallet timings, offline wallet-worker
idempotency/persistence, real Realm/authentication, #7055/#6991 native reproduction,
PIN/biometrics and R4-shipped copy reconciliation remain open. Reconcile against
R4's eventual released baseline and rerun affected checks before native acceptance.

## R4 reconciliation preflight — 22 October 2026

The owner reported R4 released and authorized moving forward. Current repository
and regional store evidence still identify open/draft #7045 source1d8a86a with
held store review, unchanged sprint and no2.6.4 tag; exact baseline clarification
is pending. The [reconciliation preflight](R4-RECONCILIATION.md) records a read-only
merge preview (one yarn.lock conflict), transactional deletion/account-binding
review and **31/31 passing R4 unit cases** in a detached, unchanged audit worktree.
This is not an integrated R5/native pass. No R4 branch or R5 ancestry was changed.

The approved narrow Emergency Key helper correction is independently applied to
R5: a dedicated EN/ES helper now names Emergency Key, while Inheritance Key keeps
its original helper. No timelock or recovery calculation changed. JSON/diff PASS;
existing ResetEmergencyKey ESLint FAIL39/1 with zero added findings. Native copy
checks remain open. Previous R5 head98c4 hosted Tests and CodeQL are now SUCCESS;
job-log download was unavailable, so no new hosted suite count or clean-lint claim.


## Released-baseline reconciliation completed — 22 October 2026

The owner's explicit confirmation that R4/2.6.4 is live resolves the earlier
metadata discrepancy. No further release/tag/source confirmation is being awaited.
Released source1d8a86a is now an ancestor of R5 through commit a8947c867; previous
R5 history remains intact. R4/sprint/other workstream refs and all released native,
dependency, backend/store/worker/version inputs remain unchanged. The one lock
conflict resolves to R4's exact lock, which already includes the two R5 selectors.

The [current reconciliation and finite native plan](R4-RECONCILIATION.md) records
final full Jest 47/538 PASS, R5 focused 106 PASS, recovery 480/480 PASS (including 10 real
Linux Realm cases after installing its missing N-API prerequisite), gate11 PASS,
static31 PASS and Node/Python release-tool28/7 PASS. Local Ruby checks remain
unavailable/failed-prerequisite, not passed; hosted CI explicitly installs Ruby
before them. Lint82/25 and TypeScript943 remain inherited failures with no added
normalized diagnostics versus released R4. Native app/UI/performance/physical
acceptance has NOT RUN here.

Reconciliation also confirmed and fixed eleven stale-origin UI cases: key-delete
selection and confirmation now retain the original account/session, verify current
Redux/Realm ownership, and carry that origin into R4's existing middleware/worker.
No R4 reference/session guard was weakened. New tests execute real session-counter,
identity and action-creator logic with modeled screen/storage boundaries. The
Keys entry's dispatch form was adapted to the released navigation types.

Six additional startup session-crossing regressions failed before the narrow
effect/timer guards and now pass with the existing cases (20 first-use screen
tests). Pending token callbacks, recreated-app timers and retained Next callbacks
cannot act after an A → B → A round trip. No setup worker or backup policy changed.

The R5-only changed source/test estimate is approximately 18.1k tokens (rough
characters/4), at the upper edge of the approved two-feature 13k–18k target. Hold
scope here. Review against the
released source rather than counting R4's inherited history as new R5 work. Do not
silently add hosted-native infrastructure, extra backend work or a third feature.
No optional Linux setup or Mac session was awaited. Next is the exact-head finite
native acceptance/performance plan and required review; no PR merge or release.
