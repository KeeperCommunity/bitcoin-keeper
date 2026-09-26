# Contributor setup verification — 26 September 2026

## Integration onto sprint

The current PR is being integrated onto `sprint` commit `1adf4f663`; the release
baseline results below are historical and are not a substitute for these checks.
Fresh worktree and node_modules, host SDKs/caches reused:

- Frozen Yarn installation: PASS.
- Jest: 17 suites / 183 tests PASS; process exits normally after adding test-only
  Electrum/HTTP teardown. LCOV is generated (coverage scope is the existing
  Electrum/wallet directories).
- Five bootstrap regression tests (including denied source access) and both active
  OpenSpec changes: PASS.
- Broad validation of all legacy OpenSpec specs: 17 pre-existing specs failed;
  CI validates active changes, not these legacy documents.
- Ruby lockfile constraints synchronized with Gemfile without gem version changes.
- Initial CocoaPods install failed because `sprint` locked openiap 1.2.22 while
  its existing react-native-iap 16.5.0 requires 3.4.0. Targeted `pod update openiap`
  aligned NitroIap/NitroModules/openiap with existing JavaScript dependencies;
  142 pods installed successfully. The updated lockfile is part of this PR.
- Fresh backend API, V3 authorization/2FA, persistence and configuration boundary
  checks: PASS using this Mac's existing backend source access.
- Android development build: PASS (976 tasks, 5m20s). Install over the disposable
  development app, local backend configuration and testnet passcode-screen launch:
  PASS. Fresh signed iOS Debug simulator build: PASS (142 pods). Simulator install and
  launch to the passcode screen: PASS by screenshot inspection. These launch
  checks are not complete onboarding, recovery or transaction tests.
- GitHub Linux app job: PASS, 17 suites / 183 tests, active OpenSpec validation and
  LCOV artifact upload. Measured line coverage is 57.37% (1451/2529) within the
  existing configured source scope; no 80% coverage claim is made.
- GitHub Linux bootstrap unit tests: PASS. Docker startup: FAIL during source
  fetch because both backend repositories are private and CI lacks access. This
  is a blocker for unrestricted public onboarding, not a passing setup check.
- SonarCloud: both the original and updated scanner failed before analysis; repository binding
  still points at the old organization. See [CI notes](CI.md). No analysis pass
  or security clearance is claimed.

This integration preserves `sprint`'s app version fields; the separate 2.5.15
release-version work is not imported or reverted by this contributor PR.

## Test environment

Fresh HTTPS clone of the published app tag `v2.5.15` (`e79e16b572d6e3472ac94500bf812d937bd89135`), plus this contributor setup change. New app dependency directories and newly fetched backend checkouts; no copied backend env files, databases or signing keys. Existing host SDKs, package caches and container image caches were reused.

Apple Silicon Mac, macOS 26.6.2, Xcode 26.4/iOS 26.4 simulator, Node 25.9.0, Yarn 1.22.22, Python 3.9, Ruby 3.3.0/CocoaPods 1.15.2, JDK 17.0.19. Docker Engine 29.5.2/Compose 5.5.1 on Colima. Independent Compose project `keeper-contributor-clean`, newly generated volumes, loopback ports 13000/14002/13003. Existing developer/release services and data were preserved.

## Results

| Check | Result |
| --- | --- |
| Fetch pinned sources and verify/apply packaged adapters | PASS, both backends fetched from GitHub |
| Advertised `dev up`, including API checks | PASS after correcting the smoke fixture to use current V3 Server Key APIs |
| Mongo, relay, signing, gateway readiness | PASS |
| Socket.IO polling handshake | PASS |
| Relay create/read persisted app record | PASS |
| Unsupported relay integration | PASS, explicit HTTP 503 |
| V3 testnet Server Key setup and public-key format | PASS |
| Invalid authorization, valid 2FA, invalid 2FA | PASS |
| Container removal/recreation with retained volumes | PASS, same app record and derived signing public key |
| Mainnet and hosted Mongo configuration rejection | PASS for relay and signing |
| Actual container network/port inspection | PASS, backend network internal, no database port published, gateway bound only to loopback |
| Rerun setup, existing env preservation, adapter tampering, unknown checkout preservation, duplicate ports | PASS, four regression tests plus real repeated bootstrap |
| Fresh `yarn install --frozen-lockfile --non-interactive` | PASS; no tracked dependency version changes |
| Fresh CocoaPods installation | PASS, 142 pods; see path-dependent checksum note below |
| Fresh Android `assembleDevelopmentDebug` | PASS, 976 tasks executed, 5m17s |
| Android installed local configuration | PASS, development environment and alternate local backend ports verified in generated BuildConfig |
| Android fresh install, passcode creation, onboarding, Mobile Wallet and More Options | PASS via ADB UI assertions and observed emulator controls |
| Android local app record creation | PASS, HTTP 200 and database record confirmation |
| Android Maestro driver | UNAVAILABLE, gRPC connection failed twice before flow execution; no Maestro pass claimed |
| Fresh iOS development simulator build | PASS, signed Debug simulator app from fresh Pods/derived data |
| iOS simulator launch, passcode creation/unlock and local relay connection | PASS, dev app launched; local app record created (two native app records total) |
| iOS onboarding through Wallets | PASS by simulator screenshot inspection; Maestro text assertion failed despite the visible Mobile Wallet tile |
| iOS More Options | PASS, simulator navigation and screenshot inspected |
| Node/Mongo/nginx pinned image manifests | PASS, each includes Linux amd64 and arm64 |
| Existing release version consistency | PASS, unchanged 2.5.15 / Android 622 / iOS 615 |
| Strict OpenSpec validation | PASS |

Native apps use a separate Metro process on port 8082 during this acceptance run, preserving the existing developer's Metro on 8081. Android's dev-server host is set to localhost with device port 8081 forwarded to host 8082. Ordinary single-checkout instructions use port 8081.

## Findings and limits

- The pinned relay and signing backends acknowledge creation before their save callbacks complete. The check polls for record visibility for up to five seconds before dependent reads; it does not hide a rejected verification token or an unexpected response.
- An exploratory legacy V2 Server Key setup returned success and then terminated its signing process. Its source uses a structured verifier schema but writes a string. This is an observed limitation of the pinned backend, not a verified production incident. Current app acceptance uses V3. Legacy V2 workflows remain outside the supported acceptance scope; this packaging change does not repair wallet/signing business logic.
- Initial CocoaPods `--deployment` failed because the Hermes podspec embeds an absolute `HERMES_CLI_PATH`. A normal locked `pod install` refreshed only that podspec checksum to the new checkout path. Comparing old/new podspec JSON confirmed the path is the only difference. No dependency version changed. This generated lockfile difference is not part of the contributor source change.
- Initial iOS UI scripts hit modal timing/selector failures, and one automated unlock was rejected. Retrying the same fixture PIN with waits succeeded. The XCUITest driver also needed a simulator restart after a failed connection; app data was preserved. The Mobile Wallet tile and Start New card were visible in screenshots when text assertions could not find them. These are recorded as automation limitations, not passes of the original complete flows; visual checks are explicitly distinguished from automated assertions.
- React Native/third-party dependencies emit existing peer-dependency, export-resolution and native deprecation warnings. Build success is not a claim that those upstream warnings are resolved.
- This proves a fresh checkout on this Mac, not a second physical machine. Intel/Linux/Windows, physical devices, cloud integrations, hardware wallets, real Server Key transactions, recovery correctness and scheduled inheritance flows remain unverified here. Recovery T-060 and store/source reconciliation are separate tasks.
- Backend image digests and source pins constrain inputs; package caches and Debian package repositories prevent claiming a bit-identical image build.

## Reproduce checks

```sh
./dev/local-backend/dev up
./dev/local-backend/verify-local.sh --persistence --boundaries
python3 -B -m unittest discover -s dev/local-backend -p test_keeper.py
npx --no-install openspec validate package-contributor-development --strict
```

The acceptance logs and emulator fixtures remain on the maintainer's machine outside the source package. Do not include local databases, generated signing identities, recovery material or captured emails in a source review or handoff archive.
