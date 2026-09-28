# Contributor setup verification — 26 September 2026

## Contributor handoff follow-up — 28 September 2026

- Removed the public contributor-access issue template. Access instructions now
  use private intake/internal tracking, matching the owner's policy. Added
  `HANDOFF.md` for independent-machine setup and separate pass/fail/untested reports.
- Five bootstrap regression tests, strict contributor OpenSpec validation, ten
  local documentation links and diff whitespace checks: PASS.
- Restarted this Mac's existing Colima profile and ran the documented `dev up`
  against the same pinned sources, existing disposable project/volumes and build
  caches. Health, Socket.IO, explicit unsupported-route failure, app create/read
  and V3 testnet authorization/2FA: PASS.
- `verify-local.sh --persistence --boundaries`: PASS, including retained app and
  signing identity after recreation and rejection of mainnet/hosted databases.
  This rerun is not a fresh-machine, native UI or transaction-signing test.
- Published baseline app head `434cd7c405d8723b3c21c7ce6e82745b9b254517`, GitHub
  run `36240719417`: app tests/coverage PASS; backend bootstrap unit tests PASS;
  backend startup FAIL and subsequent integration checks SKIPPED. CI access is
  still unresolved; these CI results apply to that baseline, not a later head.
- Independent-machine verification, supported mobile Server Key acceptance,
  backend readiness acceptance and safe CI source access remain open. No new
  native build, full UI automation, provider-purchase or security-clearance pass
  is claimed by this follow-up.

## Readiness before private access

The owner requires the same repository hygiene before private contributor access
as before public publication. Backend cleanup is published in private draft PRs.
This app now pins those updated revisions and its refreshed adapters have passed
a fresh Docker setup on this Mac. Broader backend access still awaits history
hygiene, credential handling, remaining dependency/security review and acceptance.
Detailed findings remain private.

## Fresh backend readiness integration

Updated pins: relay `5f59876b43fba1be9091657a6bf3389ce43831d0`, signing
`5ad45119ab014ea58efecabd54702b488d8fd254`. New app worktree, newly fetched
backend sources and new Docker volumes; host image/package caches and existing
GitHub read access reused. Project `keeper-readiness-proof` used ports
23000/24002/23003, preserving other development projects.

- Source fetch, adapter checksums/application and container builds: PASS.
- All four service health checks, Socket.IO handshake, explicit unsupported-route
  response and persisted app record create/read: PASS.
- V3 testnet Server Key setup, authorization and valid/invalid 2FA: PASS.
- Container recreation preserves the same app record and derived signer public
  key: PASS. Mainnet/hosted database startup rejection: PASS.
- Five bootstrap regression tests: PASS. Active contributor OpenSpec validation:
  PASS. Both backend test jobs and current-source scans pass in their own CI;
  their history scans remain failing, tracked privately.
- Updated native development builds: iOS PASS after replacing a stale local
  Node path; Android PASS after selecting the installed JDK 17 (976 tasks, 58
  executed, 918 cached). Both builds embed the isolated 23000/24002/23003 backend
  configuration. Native app source is the previously verified sprint integration;
  this follow-up changes only backend pins/adapters and documentation.
- Relay container compilation initially failed from memory exhaustion. Importing
  only the existing Android Publisher v3 client reduced measured local compiler
  memory to about 422 MB; the final image builds successfully with a 1 GB Node
  heap. This retains the same provider API/library version.
- Final image startup/API/V3/2FA and persistence/configuration-boundary checks:
  PASS. The earlier iOS onboarding record survives recreation. No actual store
  purchase, signing transaction or backup/recovery correctness test is claimed.
- Native local smoke: iOS passcode/onboarding, Mobile Wallet and More Options
  PASS using Maestro steps plus screenshot inspection. Initial Start New selector
  failed despite the visible control; a visually guided tap continued the flow.
  Relaunch/unlock after final backend restart PASS after handling the notification
  prompt and repeated introductory/recovery-backup reminders; More Options assertion
  passed. The original uninterrupted automation flows remain recorded as failures.
- Android: disposable emulator user 10 preserves the prior user's app data. Fresh
  passcode/onboarding, Mobile Wallet and More Options PASS using ADB assertions
  plus a visually guided Next tap. The first attempt used the wrong Metro; after
  selecting the matching checkout and resetting only this new user's disposable
  fixture, the relay created the native app record with HTTP 200. UIAutomator could
  not reach idle during the animated Next screen; that original assertion timed
  out, while visual navigation and subsequent assertions passed. An earlier
  attempt also overlapped the deliberate backend restart and was retried.
- Native app records are confirmed in local MongoDB. This is onboarding/connectivity
  evidence, not real signing, recovery, purchase or cloud-integration acceptance.
- Full Linux Docker CI still lacks private-source access. Independent-machine
  setup and Keeper security acceptance remain pending. These commits are draft
  review inputs and are not an approval to deploy production backends.

## Access policy and analysis update

The owner chose approved contributor access and deferred SonarCloud on 26
September. [Access instructions](ACCESS.md) and a GitHub request template now
cover profile/context review, approved resource grants and setup confirmation.
Local edits need no individual approval. No invitations or CI credentials were
provisioned by this documentation change. SonarCloud is removed from active CI;
its earlier failures below remain historical evidence, not a passing analysis.
App tests and coverage remain active; private-source access still blocks backend
CI. Independent contributor setup remains pending.

This documentation/workflow update passed YAML and issue-template parsing,
21 local documentation link checks, all five bootstrap tests and strict validation
of both active OpenSpec changes. Native builds were not repeated for this update;
the existing build results below apply to the unchanged app/native code.

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
  requires CI access provisioning; approved contributors also need their own
  source access before setup. It is not a passing setup check.
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
