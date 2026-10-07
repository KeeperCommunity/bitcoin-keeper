## Why

Tracked task T-050 records a release-version regression: commit `1adf4f66399a2bfac4572d9da94440323bff02f2` changes Android versionName from `2.5.14` to `2.3.15` while increasing versionCode from 616 to 621. The local package version also differs from native version metadata. Release preparation must reconcile actual store uploads and built artifacts so this cannot silently recur.

## What Changes

- Establish an explicit release-version manifest and a dependency-free preflight validator for package.json, Android and all Keeper iOS target configurations.
- Record verified published/uploaded baselines, source commit, intended marketing version and platform build numbers before selecting final release values.
- Fail release validation when platform versions differ, the marketing version goes backwards, or a build number is reused against the verified baseline.
- Verify the actual IPA, Android App Bundle and public APK metadata, signing identity and source provenance before publication.
- Prevent Fastlane from independently changing build numbers after validation; preserve existing distribution destinations until explicitly selected.

## Capabilities

### New Capabilities

- `release-version-consistency`: Reconciled source versions and verified release artifact metadata across iOS, Play and APK distribution.

### Modified Capabilities

None.

## Impact

T-050 under T-053 is the selected first development task. This affects release tooling and version metadata on iOS and Android, with identical marketing version for Mainnet and Testnet builds of the release. No changes to Wallet, Vault, Signer or UTXO behavior, subscription tiers, hardware compatibility, PSBTs, wallet storage, or product UI copy. No new network calls in the app. Release tooling uses authorized store access without embedding credentials in source or logs. Maestro impact: run startup and existing settings smoke checks; no new UI flow is introduced.

## Non-goals

Fixing Version History timestamps, unrelated feature development, changing production backend code, rotating signing keys, migrating wallets, or pretending a public listing proves the highest uploaded store build. Local-backend setup remains separate environment work.

## First milestone scope — 25 September 2026

The user requests a small test release with high confidence and explicitly separates security remediation. T-040/T-044 completion and private-advisory sign-in are not prerequisites for this milestone. Make no security-fix claims. The versioning patch introduces no wallet/transaction/storage feature changes. Local Docker packaging and broader feature development remain separate work. Determine regression coverage from the actual selected release source; do not call an unverified sprint-to-production delta version-only. The user reconfirmed public App Store, Play production and the normal public APK channel.
