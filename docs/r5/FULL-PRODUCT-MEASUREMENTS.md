# Full-product startup and first-wallet UI measurements

This separately reviewable R5 acceptance package runs the ordinary packaged app
through `index.js`, its real PIN/storage setup, production account-creation saga,
wallet/key generation and encrypted persistence. It complements the CI-only
native module/worker probes. Estimates: approximately 4k–6k changed code/test
tokens, one acceptance-infrastructure feature. No app version is allocated here.

The only product change is a FlatList test ID derived from the already-rendered
visible wallet list: `home_visible_wallet_count_N`. Hidden and archived counts
are not exposed. In a fresh one-wallet fixture, count1 before/after a cold process
relaunch demonstrates visible-list persistence without exporting wallet IDs.

## Execution contract

The reconciled hosted foundation must first `record`, `prepare` and `build` the
exact candidate. Before that build its `.env.ci` must use
`RELAY=http://127.0.0.1:8765/`; retain the foundation's DEVELOPMENT, blocked
signing/channel/Sentry endpoints and disposable credential namespace. This
runner checks that exact nonsecret configuration. DEVELOPMENT makes production
Splash select Testnet on the fresh installation. No faucet request, funded
wallet, transaction, signing or server-backup enrollment is performed.

After the hosted smoke/probes finish, run on the same hosted platform:

```sh
python3 .github/native/product_measurements.py run
```

The runner requires a disposable GitHub-hosted runner (`GITHUB_ACTIONS=true`,
`RUNNER_ENVIRONMENT=github-hosted`) to prevent accidental local data clearing.
It imports `.github/native/hosted_native.py`, verifies its successful
build and artifact fingerprint, uses its installed pinned Maestro, warms the
ordinary Metro bundle, then creates its own iOS simulator or uses the CI-owned
Android emulator. Physical Android devices are rejected. Android forwards only
Metro and the fixture ports. It removes only its new iOS simulator or disposable
development app and its own temporary measurement files. Existing personal
devices, simulator profiles, other worktrees, caches and evidence are untouched.

Production source and bundle configuration must match committed HEAD. The sole
manifest exception is the foundation's recorded rn-nodeify module-mapping overlay:
its before hash must match `git show HEAD:package.json`, its after hash must match
current bytes, its allowed fields must be exactly browser/react-native/browserify,
and all other parsed manifest fields must remain equal. Unrecorded mapping changes,
dependency/script changes and expanded allowlists fail closed.

The setup responder binds only127.0.0.1:8765, answers only `createNewApp` with the
controlled `{created:true}` response, discards request bodies without logging or
retaining identifiers, and rejects every other backend operation. A separate
fixed-vocabulary metric route records host monotonic timestamps for UI actions.
This deliberately supplies **no backend-protocol/compatibility acceptance**.
Public Testnet Electrum connections still follow source defaults and may succeed
or fail; that network condition is part of this development fixture, not a
controlled release-performance benchmark. Paired genuine Relay coverage remains
a separate package.

Each of five samples clears only the disposable app and its credentials, then:

1. Launches the full app and waits for Create a passcode.
2. Creates public fixture PIN1111, declines biometrics and skips introduction.
3. Taps Start New and waits for production setup's Next, then reaches the home
   list after explicitly skipping backup. Never opens a seed/recovery-word view.
4. Requires visible-wallet count1 and Mobile Wallet, stops the process, launches
   again, enters PIN1111 and requires the same visible count.
5. Exercises More→Wallets and requires the one-wallet list again. This is a
   bounded fresh-state navigation check; it does not reproduce #7055's original
   backup-delete/multiuser trigger or close that investigation.
6. Opens More→App Settings→Version History and asserts the native Installed app
   version header and the retained Initially installed row. Expected version/build
   regexes come from the exact source's committed release/version.json (currently
   Android2.6.4/627 and iOS2.6.4/620); no work-package label is an app version.
   A fresh account already has that tuple's initial-install row, so cold login
   preserves it and does not insert Current installation observed. Empty/stale
   history observation insertion and migrations remain separate unproven cases.
7. Enters Keys→Manage Keys and exits with Back, then verifies the wallet list
   again. The fresh Recovery Key is excluded from DeleteKeys' list; no deletion
   intent, confirmation, recovery material or seed-word screen is opened. This
   checks discoverability/return navigation only, not safe-deletion acceptance.

A sixth fresh fixture runs separately from the five performance samples. Its
first bounded createNewApp body is read and discarded, then the loopback server
closes the connection without any account storage/commit. The actual app must
show exactly one creation-error title, its internet/retry explanation and Retry,
with no Next action. Only after those UI assertions may the fixed Retry marker
and explicit Retry tap precede the second successful HTTP response. Success/home,
cold process relaunch, PIN login and persistent visible-wallet count1 are required.
Exactly one dropped attempt and one acknowledged response are allowed; a hidden
native HTTP retry, extra setup call or error marker without the transport failure
fails closed. This is **controlled loopback disconnection before commit**, not
physical WAN-offline or uncertain-after-commit acceptance. Its receipt is stored
under `controlled_disconnect_retry`, never in the five raw performance samples.

Only metadata.json receives bounded raw durations/counts/stage labels. Five
separate startup-to-passcode and StartNew-to-ready values are retained; no median
can hide an individual failure. Timings include Maestro driver and React Native
development overhead, with a warm host bundle and cold app process. They are
actual UI timings when run, not release-build performance or module microbenchmarks.
The authenticated-home duration includes the automated PIN taps. The setup-to-home
duration includes the explicit recovery-backup skip interaction.

All stages must occur once in order, JUnit must fully pass, the artifact must stay
unchanged and exactly one createNewApp call may occur across setup and cold
relaunch. Any missing stage, duplicate request, changed artifact, native/tool error
or incomplete sample keeps the suite failing. Failure metadata retains only
completed fixed stages/numeric durations/error class; it never exports raw errors.
Maestro's temporary diagnostics (including automatic failure screenshots), Metro
logs and app/credential state are deleted; upload only the existing bounded
`artifacts/native/*/metadata.json` path. No screenshot, hierarchy, raw command/app
log or database artifact belongs in uploaded evidence.

## Verification and limits

`python3 -m unittest discover -s .github/tests -p test_product_measurements.py`
tests real loopback HTTP allowlisting, disconnect/retry, rejection and nonretention,
ordered receipts, hidden/extra retry rejection, approved manifest overlays, native
version expectations and partial-flow preservation.
Those tests provide no native acceptance. Before the first hosted execution,
the full-app Maestro selectors and per-platform credential-reset behavior remain
unverified. Record actual execution outcomes for each exact candidate; never
copy passes or raw timings from another SHA. Physical biometrics and devices,
physical WAN-offline/other error-retry scenarios, full deletion/reference protection, actual
protected-backup operations and release readiness remain separate evidence.
