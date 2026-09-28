# OneKey BLE maintainer follow-up

Validation date: 28 September 2026. This is integration work for PR #6900, not release acceptance.

## Source

- Contributor head: `7fdae83724c6e1509a095c4466e762cceb8b6bf4`.
- Current fetched `sprint`: `1adf4f66399a2bfac4572d9da94440323bff02f2`.
- Integration merge: `0e9d0c8eeea74a80d86cd63e5abec9f171f1957c`.
- Work lives on Keeper's `codex/onekey-6900-followup` branch. The contributor branch and `sprint` are unchanged.

The only Git conflict was the Hermes checksum in `ios/Podfile.lock`. The integration retains sprint's checksum and the PR's BLE pod additions. This resolves the text conflict; successful CocoaPods resolution remains required.

## Implemented

- Bluetooth readiness removes its subscription and clears its timer when an adapter state arrives.
- A synchronous current-state callback is handled safely before the subscription is returned. This is covered as an injected boundary case; it was not observed on physical hardware.
- Errors from the fallback adapter-state query reject the readiness operation instead of leaving it pending.
- Device discovery clears its timeout on success and failure.
- Added 15 mocked regression tests covering these cases, permission denial, Bluetooth off, unknown-state fallback, scan timeout, matching/missing/wrong fingerprints, mainnet/testnet account paths, empty-passphrase parameters, PSBT transport encoding, PIN cancellation and empty signing responses.

## Verification

- `yarn install --frozen-lockfile --ignore-scripts`: passed. Install scripts were then run selectively: repository `patch-package` patches and the `rn-nodeify` command from `setup.sh`.
- Before the fix, the initial test suite had 4 failing and 9 passing tests. Failures demonstrated timer cleanup, injected immediate-callback handling and adapter-error propagation problems.
- `yarn jest tests/services/onekeyBle.test.ts --runInBand --coverage=false`: **15 passed** after the fix and additional failure-path tests.
- Prettier check on the changed service and test: passed.
- `git diff --check`: passed.
- Full `tsc --noEmit`: failed with 1,009 diagnostics across the repository. No diagnostics named the OneKey service, modal, signing screens or new test at the time of that run. This is not a clean project type check or a baseline comparison.
- `pod install`: blocked before native compilation. The installed `react-native-iap` 16.5.0 requires `openiap` 3.4.0, while the lockfile pins 1.2.22. Both the package version and old lock entry are also present on the fetched sprint base. No general purchase-library migration was included here.
- Android production JS bundling: attempted after patch-package and the repository's nodeify setup command; blocked resolving `constants` from `node-rsa` (the mapping targets an unavailable `constants-browserify` package). No successful Android native build is claimed.

## Remaining Keeper-owned work

1. Finish reproducible native dependency setup and obtain clean iOS/Android builds. Recheck the final pod lock with CocoaPods; the text-conflict resolution alone is insufficient.
2. Review lifecycle cancellation across the modal and both signing screens. The modal's delayed launch currently has no cleanup, and in-flight operations can continue after leaving the UI. These are remaining review items, not fixed by the adapter timer changes.
3. Confirm operation timeout behavior against the pinned SDK. The wrapper explicitly bounds discovery at 15 seconds; the PR description's blanket 30-second claim is not established by this review.
4. Validate real devices/model/firmware on iOS and Android: import/identify/recovery, fingerprint mismatch, standard multisig receive-address comparison, testnet PSBT and message signing, permission denial, Bluetooth off, disconnection, cancellation, reconnect and retry.
5. Verify supported wallet/script types and user-facing copy, including unsupported hidden-wallet passphrases, with the existing Keeper patterns before release acceptance.

No physical OneKey device testing or end-to-end cryptographic signing validation was performed. The transport test uses a small encoding fixture, not a valid signed transaction. No release date is committed. Keeper owns routine follow-up work; ask the contributor only for information we cannot reproduce or obtain ourselves.
