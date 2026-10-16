# Release version verification

**Current source intent:** this R4 candidate stages 2.6.4 on the 2.6.3 pairing-channel hotfix baseline. The candidate is still under review. Keep private advisory details, credentials and fixtures out of public release material.

`version.json` provisionally selects 2.6.4, Android 627 and iOS 620. Its recorded authenticated store baselines on 6 October 2026 are Android 625 and iOS 618, both at 2.6.2. Refresh these baselines and confirm the counters before signing or upload. Development builds and local relay validation are separate from reviewed production builds, deployment and store submission.

The owner will perform real-phone and other manual live checks after release. Do not require Developer Mode or physical-device connections to finish preparation. Record simulator, automated and disposable testnet evidence accurately; they do not establish physical or hardware-signer acceptance.

1. Read all uploaded builds and release tracks for Android package `io.hexawallet.bitcoinkeeper`, and uploaded iOS builds for `io.hexawallet.keeper`. Preserve the timestamp and evidence outside the repository. Refresh before upload; preflight accepts evidence at most 24 hours old.
2. Update the manifest with the highest known marketing version and highest uploaded build per platform. Select one greater marketing version for both stores and greater platform build counters. Check unpublished App Store version records as well.
3. Run `npm run version:apply` to synchronize package.json, Android versionName/versionCode and both Keeper iOS targets. Both Info.plist files must reference `$(CURRENT_PROJECT_VERSION)` and `$(MARKETING_VERSION)`; hardcoded values are rejected. Review the diff, then run `npm run version:check` and `npm run test:release`.
4. Reconcile release source with the published versions, prepare a clean release checkout and set `KEEPER_RELEASE_COMMIT` to its complete verified commit SHA. Run `npm run release:preflight`. The manifest cannot contain its own commit SHA.
5. Build from a reviewed production configuration and existing signing identities. Check extracted IPA, APK and AAB metadata against the manifest, verify signing fingerprints and record checksums. A source preflight does not verify the resulting binaries.
6. Run all feasible automated, simulator/emulator and disposable checks before public submission; record the owner's post-release manual checks separately.

Both Fastlane `build_only` and `live` lanes run the same preflight, production build and artifact verification logic and consume `.env.production` without downloading over `.env`. They do not increment production build numbers. `build_only` never uploads and never notifies Slack, including on failures and when `KEEPER_NOTIFY_SLACK=1` is set. Android `live` notifications still require explicit `KEEPER_NOTIFY_SLACK=1`.

These existing lanes still upload to **TestFlight** and **Play internal testing** respectively. Neither constitutes the requested public release. Public submission must record App Store review/submission state, Play production state and GitHub APK publication separately.

## Build-only production preparation

The following commands are for a future **owner-approved production build**. `build_only` still obtains signing assets and creates signed production artifacts using the existing identities. Approval must name the intended commit, platform and production environment before these commands run. Simulator/emulator validation in the Codex Local handoff is separate and does not authorize signing, building production artifacts, upload or distribution.

Refresh authenticated store evidence, review `.env.production` and provide the existing signing credentials first. Start each platform in its own clean, isolated checkout at the approved commit so one platform's signing/provisioning changes cannot affect the other platform's clean-source preflight. In each checkout, set `KEEPER_RELEASE_COMMIT` to that full verified commit and run `npm run release:preflight` before its command:

```sh
# In the approved iOS checkout (requires the approved Mac/signing setup):
export KEEPER_RELEASE_COMMIT="$(git rev-parse HEAD)"
npm run release:preflight
(cd ios && ENVFILE=.env.production bundle exec fastlane build_only --env production)
```

```sh
# In the approved Android checkout (requires the established release keystore):
export KEEPER_RELEASE_COMMIT="$(git rev-parse HEAD)"
npm run release:preflight
(cd android && ENVFILE=.env.production bundle exec fastlane build_only --env production)
```

Record the generated IPA or AAB/APK paths, verifier output and checksums. The lanes require fresh artifact paths from their current build actions; a prior lane-context path cannot satisfy a missing output. Review signing/provisioning changes without committing credentials. Separate IPA/AAB signing verification and all distribution channels still need their own checks and approval. Do not use `live` for build-only preparation because it uploads.

`ruby scripts/test_fastlane_build_only.rb` executes the real lane bodies and success/error hooks with fake actions in disposable fixtures. It checks preflight/config/artifact failures, rejection of old artifact paths, and absence of upload/Slack calls for `build_only`, while retaining `live` upload behavior. It needs Ruby 3.3 with the bundled Minitest gem; it never invokes Fastlane, native build tools, signing, stores or Slack. Run it through `npm run test:release` with the source and packaged-artifact regression suites.

## Packaged artifact checks

Run `python3 scripts/verify-release-artifact.py /absolute/path/to/build.ipa` (or `.apk` / `.aab`). Both production lanes run this; `live` does so before uploading. Android builds both artifacts and verifies them before its first upload. Both platforms clear prior artifact paths before their build actions and require the current build's output; the iOS lane never falls back to an older file in the builds directory.

The verifier checks the production application ID, marketing version, native counter, and bundled Ask Keeper / Dust route and data markers, then emits artifact and bundle SHA-256 hashes. Marker presence supplements device testing; it does not prove behavior or source provenance. Compiler-generated component names are unsuitable markers because release optimization removes them.

For Android, set `AAPT2` and `APKSIGNER` to SDK build-tool paths (or put them on PATH), `BUNDLETOOL_JAR` to an installed bundletool jar, and `KEEPER_ANDROID_CERT_SHA256` to the certificate fingerprint independently verified from the established public APK. The verifier checks the APK signature and certificate. IPA code signing/provisioning and AAB signing still require separate verification before distribution. The seven packaged-artifact regression tests run with `npm run test:release` alongside the source-version tests; Python 3 is required.

The normal public APK channel is the repository's GitHub Releases. Publish the APK together with `SHA256SUM.asc` and `KEEPER_DETACHED_SIGN.sign` using the established PGP identity, as documented in the root README. Do not replace release signing keys to work around missing access.

Android production signing reads `STORE_PASSWORD`, `KEY_PASSWORD`, and `KEY_ALIAS` from the build environment. `KEEPER_ANDROID_KEYSTORE` may select an absolute existing keystore path; otherwise the existing ignored `android/app/release.keystore` is used. Repository Gradle properties no longer contain release credentials. The development debug build continues to use its development keystore.

## Manual release checks

- Post-release by owner decision: upgrade an existing installation with a designated test wallet on a physical iPhone and Android device; do not uninstall first. Confirm unlock, wallet visibility and settings survive.
- Check the displayed marketing version and native build counter against the release manifest on both platforms.
- Open Ask Keeper on both platforms and send a non-sensitive sample question to the intended backend. Confirm the response and error/retry behavior; local isolated-backend entry checks do not test AI responses.
- Open Wallet Settings > Dust Report. Check an empty test wallet, then a designated testnet fixture with Do Not Spend coins. Confirm the report, ordinary-spend exclusion, and Donate Dust confirmation/amount/fee behavior. Record separately whether a testnet signing transaction completed; an empty-wallet result cannot verify donation.
- Exercise wallet navigation, receive and a test transaction/signing flow with designated test funds and hardware where applicable. Verify that production build configuration is correct; do not send real funds merely to test this versioning change.
- Install the public APK as an upgrade over the previous public APK and verify its signature/checksum. The APK and AAB must carry the same Android version and code.
- Record each channel's actual submission/publication state and public download links. Do not report a TestFlight/internal upload as a public release.
