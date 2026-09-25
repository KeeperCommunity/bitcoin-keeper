## ADDED Requirements

### Requirement: Consistent release metadata
The release tooling SHALL require a single marketing version in package.json, Android versionName and every Keeper iOS MARKETING_VERSION. Android versionCode SHALL match the explicit Android release counter and every Keeper iOS CURRENT_PROJECT_VERSION SHALL match the explicit iOS release counter.

#### Scenario: Matching source metadata
- **GIVEN** verified release intent and matching source versions
- **WHEN** the source preflight runs
- **THEN** it succeeds and prints only non-secret version information.

#### Scenario: Platform metadata differs
- **GIVEN** one native target or package.json has a different version
- **WHEN** preflight runs
- **THEN** it fails and identifies the mismatched file/field before any build upload.

### Requirement: Prevent backwards versions and reused builds
The release tooling MUST compare semantic version components numerically and require the new marketing version to exceed the highest verified published marketing baseline. It MUST require platform build counters to exceed the highest verified already-uploaded counter for that platform. Missing or unverified store baselines MUST block publication checks.

#### Scenario: Observed Android regression
- **GIVEN** a previously released marketing version of 2.5.14
- **WHEN** a candidate has version 2.3.15 and Android code 621
- **THEN** the marketing-version check fails even if its numeric Android code increased.

#### Scenario: Reused Android code
- **GIVEN** the highest verified uploaded Android code is 621
- **WHEN** the candidate also uses 621
- **THEN** preflight fails regardless of marketing version.

#### Scenario: Apple access unavailable
- **GIVEN** the public App Store version is known but uploaded-build evidence is unverified
- **WHEN** publication preflight runs
- **THEN** it fails with an actionable evidence error and does not invent a build number.

### Requirement: Verify distribution artifacts
The release process MUST verify the packaged IPA version/build and bundle identifier, the AAB/APK versionName/versionCode and production package identifier, and their expected signing identities. The AAB and APK MUST originate from the same release source and carry matching Android version metadata. Source-only checks MUST NOT count as artifact verification.

#### Scenario: Wrong Android package
- **GIVEN** a build uses `io.hexawallet.keeper` or `.development` instead of `io.hexawallet.bitcoinkeeper`
- **WHEN** production artifact validation runs
- **THEN** it fails before upload.

#### Scenario: Correct three-platform artifacts
- **GIVEN** the IPA, AAB and APK match the release manifest and verified source/signing identities
- **WHEN** release verification completes
- **THEN** their checksums, versions, build numbers and canonical source SHA are recorded before publication.

#### Scenario: Stale packaged content despite correct source metadata
- **GIVEN** source declarations match but the packaged binary has an older native counter or lacks required Ask Keeper / Dust markers
- **WHEN** production artifact validation runs
- **THEN** it fails before upload; marker checks use stable route/data strings that survive release compilation.

#### Scenario: Current iOS build did not return an artifact
- **GIVEN** an earlier IPA remains in the output directory and the current build returns no IPA path
- **WHEN** upload is prepared
- **THEN** the lane fails rather than selecting the older file.

### Requirement: Preserve app behavior
The change SHALL preserve Wallet, Vault, Signer and UTXO behavior, app storage and existing navigation. It SHALL require startup/settings smoke checks for both native platforms and record actual test outcomes rather than assuming a successful build implies a working app.

#### Scenario: Development smoke test
- **GIVEN** a development build installed on the intended simulator/emulator
- **WHEN** it launches and the tester navigates to Version History
- **THEN** startup succeeds and the visible installed version/build matches that installed artifact.

### Requirement: Reconciled feature coverage across platforms
The release candidate SHALL include Ask Keeper and the intended Dust Protection changes together. Both native platforms MUST be built from the same reviewed source commit and checked for the intended feature entry points and behavior. Matching version numbers or a conflict-free Git merge MUST NOT be treated as proof of feature coverage. Historical release-source claims MUST distinguish verified provenance from hypotheses.

#### Scenario: Reported iOS and Android feature mismatch
- **GIVEN** the prior report of Ask Keeper on Android and Dust with old Concierge on iOS
- **WHEN** the next release candidate is verified
- **THEN** Ask Keeper and Dust Protection, Dust Report and Donate Dust are checked on both platforms and their test results are tied to the common source SHA.

#### Scenario: Branches merge without textual conflicts
- **GIVEN** a merge preview succeeds without conflicts
- **WHEN** release reconciliation is assessed
- **THEN** feature regression tests and build provenance checks are still required before declaring reconciliation complete.
