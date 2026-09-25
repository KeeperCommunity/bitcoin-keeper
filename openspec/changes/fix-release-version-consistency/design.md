## Context

T-050 is the selected development item. The user authorized public App Store, Play production and normal APK publication after testing. Google Play API inspection on 2026-09-25 confirmed production package `io.hexawallet.bitcoinkeeper` is `621 (2.3.15)`, with highest returned bundle code 621. Authenticated App Store Connect inspection confirmed 2.5.14/build 612 on September 25, 2026. Local source has package.json 2.5.13, Android 2.5.14/616, iOS 2.5.14/614. Do not mistake the old `io.hexawallet.keeper` Play app for production.

## Goals / Non-Goals

**Goals:** One explicit marketing version, independently verified monotonically increasing platform build numbers, and a reproducible manifest of the exact released source/artifacts. Catch the observed 2.5.14 -> 2.3.15 regression before upload.

**Non-Goals:** No new screen, copy, assets, navigation, React components, wallet behavior, signing implementation, Redux slice/saga, Realm schema, MMKV key or persisted-state migration. No PSBT or hardware interaction. No timestamp fix. Preserve the user's existing IAP fix.

## Decisions

- Add `release/version.json` as explicit version intent and `scripts/release-version.cjs` for check/apply commands. Use Node's standard library so preflight does not depend on mobile native build tools.
- Keep native values explicit in Gradle and Xcode for compatibility with existing build tools. An apply command synchronizes them; a check command verifies every Keeper target configuration and package.json. Fail on missing/ambiguous targets rather than silently skipping a platform.
- Store baselines separately from candidate values. Version intent can be drafted while store access is unavailable, but publication preflight must reject an unverified baseline. Numeric build values are not chosen until the relevant store is checked.
- Source preflight verifies semver progression, platform counters and matching source declarations. An artifact verifier separately checks metadata extracted from APK/AAB/IPA. Source checks alone do not prove artifacts were built correctly.
- Packaged feature checks use stable Ask Keeper / Dust route and data markers verified against fresh optimized Hermes bundles. These supplement UI tests. Reject a missing current-build IPA path instead of falling back to an older output. Verify both Android artifacts before the first upload.
- Production Android signing credentials come from the environment and the existing keystore. Remove the committed Gradle credential properties, preserving debug signing. This prevents bringing the newer sprint credential strings into the prepared integration; it does not erase repository history or resolve key-custody review.
- Build both Android outputs from one source/configuration and the same versionCode. Sign with the existing appropriate identities and compare fingerprints to the established release identities; never generate replacement release keys.
- Remove independent Fastlane bump operations for production; use explicit preflight instead. Production lanes must not post Slack messages as a side effect of this task. New public distribution steps require verified source provenance and correct environment configuration.
- Keep draft planning possible with unverified baselines, but make final release checks fail closed. Use the highest verified marketing baseline across platforms (at least 2.5.14), so the Android regression is not treated as the new semantic baseline.
- Supply the reconciled source SHA through `KEEPER_RELEASE_COMMIT`; preflight compares it to HEAD and requires a clean checkout. Keeping the SHA outside the committed manifest avoids a self-referential commit hash.

## Affected files

New: `release/version.json`, `scripts/release-version.cjs`, `scripts/release-version.test.cjs`, release documentation and verification evidence. Modified: `package.json`, `android/app/build.gradle`, `ios/hexa_keeper.xcodeproj/project.pbxproj`, `android/fastlane/Fastfile`, `ios/fastlane/Fastfile`, and CI validation workflow as needed. No UI files. Both iOS Info.plist files must use project version variables: a real simulator rebuild demonstrated that hardcoded CFBundleVersion silently overrode the otherwise consistent project settings.

## Risks / Trade-offs

- Missing Apple uploaded-build evidence -> keep iOS release blocked and do not invent the next build number.
- Native metadata drift -> check every app target and extracted artifact, not only a root version string.
- Existing Fastlane lanes overwrite `.env` and increment builds -> provide a checked release route before invoking publication; do not invoke legacy lanes blindly.
- Store state changes after checking -> refresh baselines immediately before upload.
- Different branch content -> record the canonical release SHA and verify all three artifacts against it. Resolve release-source reconciliation before publishing.

## Validation and rollout

Regression tests must fail on the actual 2.3.15 regression, mismatched package/native versions, missing metadata, reused build codes, and unverified store evidence, and pass a consistent fixture. Run existing startup/settings smoke tests with explicit development app IDs on Android and iOS. User checks: launch/unlock, existing wallet visibility without migration loss, displayed version/build, and upgrade installation for existing production identities. Full wallet/signing testing is outside the version change, but relevant release regressions still gate publication.

DESIGN.md reviewed: no UI change, so existing typography, colors, components and navigation are preserved. No new screenshots/assets/SVGs or design tokens are needed.

## Open Questions

- Candidate selected: 2.5.15, Android 622, iOS 615. Refresh store baselines before upload.
- Canonical release source after reconciling iOS and Android published-build provenance.
- Public APK channel is GitHub Releases with SHA256SUM.asc and KEEPER_DETACHED_SIGN.sign. Existing local keystore certificate matches public APK 2.5.13; PGP signing access remains to be resolved.
