## Why

T-051: the working local backend depends on unpublished changes and machine-specific instructions. Hosted development services have been retired. Contributors need a reproducible start without production secrets.

## What Changes

Package pinned backend source revisions and local-only adapters, Docker orchestration, a safe bootstrap, environment templates, native build instructions, and executable acceptance checks. Separate Yarn's platform-neutral setup from native dependency installation.

Document the fork-to-pull-request workflow and provide a PR template with explicit test results. Outside contributors can run, test and propose changes; Keeper maintainers retain security review, acceptance, merge and release authority. Automated checks do not grant approval.

## Capabilities

### New Capabilities
- `contributor-development`: bootstrap and verify an isolated local development backend and connect native development apps.

### Modified Capabilities
None.

## Impact

The integration targets `sprint`. Repair CI coverage handoff and test teardown,
align Ruby lockfile constraints with the existing Gemfile, and correct OpenSpec
YAML parsing. CI runs backend checks and publishes app coverage. Optional private
development resources use maintainer approval based on contributor profiles and
planned work; local changes require no per-change permission. Backend source
pins now point to public clean-history repositories. SonarCloud is explicitly
deferred by the project owner, with
configuration and prior findings retained for future restoration.

Testnet local development only; no released Wallet, Vault, Signer or UTXO behavior changes. No subscription gating, Realm/MMKV changes, migration or hardware compatibility changes. Local signing keys persist in disposable Docker volumes. Runtime backend egress is blocked. Native mobile network access remains separate. No screen changes, so no new Maestro selectors/flows are required.

## Non-goals

Store releases, production deployments, mainnet signing, T-060 recovery changes, iOS/Android feature reconciliation, offline Electrum, cloud integrations, hardware tests and inheritance scheduling.
