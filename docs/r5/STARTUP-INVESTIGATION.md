# R5 startup and bounded investigations — 21 October 2026

Development evidence only. The owner confirms R4/2.6.4 is live; R5 is now
reconciled to its recorded source1d8a86a. Earlier unmerged/pending descriptions
below retain their original investigation scope. No native acceptance,
release-readiness, issue closure or performance improvement is claimed here.

## Newer work checked before editing

Continued from PR #7058 head `625435ac26af0304670c993a639626b1117699ba`, preserving
its deletion/privacy, setup lifecycle and CI/lock work. `AGENTS.md` is unchanged.
R4 #7045 was an open draft at `1d8a86a7462d935cbd0e28b857934b5718c152fc`.
Its Splash, NewKeeperApp and secure-store modules are identical to the original
sprint versions. This permits independent source changes without importing R4.
R4's changed Login, Home/navigation, transaction views and backup/backend paths
remained untouched during that independent checkpoint. Reconciliation with the
owner-confirmed released source is now complete; see R4-RECONCILIATION.md.

Other open work includes native-validation #7060, cloud-release #7062, bootstrap
#7063, lock-selector #7064, PIN fixes #7052/#7053, reproducibility #7043 and the
Assisted Multisig preview #7041. No commits were imported from these branches;
no branch/ref, workflow, native configuration or dependency input in them was
changed. No optional Linux setup or Mac connection was awaited or started.

## #7046: confirmed JavaScript startup defects

1. The credential read formerly started only after the 3,000 ms animation
   callback. Tests failed 9/10 against the previous Splash implementation.
   Startup now starts that read after its existing default-network/theme/Tor
   initialization, independently of animation completion. It still waits for
   credentials before choosing Login/CreatePin and discards stale completions.
   PersistGate wraps the app before Navigator, so Redux rehydration already
   precedes Splash; this change does not remove that hydration gate.
2. `hasPin()` caught native Keychain/JSON failures and returned false. Two real
   secure-store boundary tests reproduced this conflating an unreadable store
   with an empty store. Startup now explicitly requests error propagation with
   `hasPin({ throwOnError: true })`; default behavior is preserved for legacy
   callers. A generic Retry dialog contains no underlying error or credential
   material. Repeated Retry callbacks cannot start parallel reads. No Keychain
   write, account-selection rule or authentication-policy change was made.
3. Three setup navigation tests reproduced unmounts leaving the 3-second
   recreated-app and 500 ms Next timers active, and rapid Next taps scheduling
   multiple replacements. Cleanup and a one-use pending timer fix those cases.
   A fourth test reproduced a retained Next callback scheduling after unmount;
   its screen-lifetime guard now rejects it. The delays themselves are unchanged.
4. `flows/login.yaml` now checks Proceed is visible but disabled at zero/three
   digits, enabled at four, and disabled after the inline incorrect-PIN error.
   It no longer expects a Retry modal on the first incorrect PIN. The existing
   disposable fixture PIN remains 1111; the flow accepts old-sprint Next or R4's
   direct advance and then requires Home. It is a native test specification,
   YAML-parsed here but NOT executed with Maestro. Shared PIN code was not edited.
5. After release reconciliation, six new tests reproduced pending setup/FCM tokens
   and navigation timers crossing an A → B → A account-session change. Existing
   effect lifetime checks now also require their captured production session;
   Next retains its rendered session before scheduling and when the timer fires.
   All 20 first-use screen cases pass. These tests use the real session counter
   with explicit account-transition fixtures; workers and account schemas are
   unchanged. They do not prove native account-switch persistence or performance.

The screen tests replace native Keychain, navigation, animation and UI boundaries;
they are not cold-start, warm-start, resume, deep-link or native persistence proof.
The credential tests execute the actual secure-store function with synthetic
Keychain results and synthetic account identifiers, without writing any storage.

## #6813: first-wallet timing

Source trace: Start/Retry waits for Firebase token retrieval (rejection falls back
to tokenless setup), then dispatches setup. The setup worker can derive seed/BIP85
material, call Relay registration, persist the app/account, create the default
wallet and Recovery Key signer, then set appCreated. R4 changes some downstream
wallet/backup behavior. No stage has been established as the runtime bottleneck.
Do not introduce a notification timeout, weaken wallet setup or change worker
idempotency from this source trace.

Native measurement recipe, on disposable state after R4 reconciliation:

- Record exact source/build/APK hash, OS/API/ABI, screen/display/font settings,
  network/Tor state, cold/warm/resume mode and free disk. Reuse the same build
  mode/device for before/after comparison.
- Record raw monotonic durations for launch to usable PIN, PIN to usable Home,
  and Start to completed first wallet. Separate Firebase, worker dispatch,
  registration response and wallet persistence stages using test instrumentation
  without logging credentials, seeds, account identifiers or private payloads.
- At least five samples per cold/warm condition; retain every sample and report
  median/range rather than attributing the configured animation duration to actual
  wall-clock performance. Test offline/retry/relaunch and count persisted wallets
  before/after; JavaScript appCreated simulation cannot prove no duplicates.

No measured native durations or performance percentage is available in this Cloud
workspace. Java/Jest wall times must not be substituted for app performance.

## #7055: More → Wallets exits to launcher

Bounded read-only trace: MenuFooter calls Home's option-change callback; Home
selects the Wallets content. Neither path invokes BackHandler.exitApp, navigation
back/reset, or an Android activity-finish call for this tap. R4 adds tab test IDs
and changes Home/Ask navigation, so it remains the required baseline. Native
MainActivity/AppState/task transitions and the report's multiuser history are not
modeled by these JavaScript tests. No root cause is confirmed and no navigation
behavior was patched. This does not dismiss the preserved Android 17 failure.

Next reproduction should use an ordinary single-user install plus separate fresh
state on supported Android versions, then the reported backup opt-in/Delete
sequence. Verify Wallets/Keys/Ask/More, cold launch and account changes; preserve
wallets, labels, task/window state, logcat and absence of unintended backup reupload.
Use existing disposable fixtures only; retain the failed user/artifacts. Do not
reopen owner-parked #7056/#7057 or infer an R4 test waiver.

## #6991: local transaction times

Bitcoin transaction conversion stores UTC strings from epoch seconds; list rows
and transaction details call local Moment formatting. R4 changes the row module
but retains that formatter. The new test renders the actual current production
TransactionElement with those UTC strings, using synthetic confirmed, pending
and cached records, and checks the transaction object is unchanged.

Four separate Node/Jest processes tested UTC, Asia/Kolkata, America/New_York and
Europe/London: 18 assertions each, 72 total. Vectors cover fractional offsets,
previous-day rollover, spring DST changes and New York's repeated autumn hour.
All passed. Existing display punctuation/hour-format conventions were preserved.
This establishes local formatting in Node for the tested rows, not Android/Hermes,
actual history/details, device-timezone changes while running, or cached-source
integrity. No timezone fix was confirmed, so no timestamp/formatter code changed.
Native reproduction remains open and bounded to the approved scope.

## Execution limits and next native route

Cloud has Java and approximately 24 GiB free at preflight, but no adb, emulator
or Maestro on PATH. No Android/iOS build, install, native UI or physical-device
check ran. The hosted-native PRs are separate unmerged infrastructure work, not a
reason to block this source/test work or to import their implementation here.
Use the approved Cloud native route when available; use a Mac only for remaining
platform/device checks it actually needs. Do not interrupt R4's Mac work.

For any later native handoff: verify the exact R5 head after R4 reconciliation;
check disk (approximately 6 GiB planning minimum, more if required), one native
build at a time, reuse compatible caches and preserve worktrees, AVD users,
simulators, wallet data, artifacts and evidence. No deletion/cleanup without
approval. IOS, ANDROID and HARDWARE acceptance remain outstanding.
