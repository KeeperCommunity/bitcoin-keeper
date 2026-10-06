## Design

Keep the mobile checkout and native IDEs on the host. Python standard-library commands fetch backend revisions into ignored `.sources`, check adapter digests, apply patches/replacement files, and start Compose. No system packages are installed automatically. Existing source edits, env files and data volumes are retained.

Docker runs Mongo, relay/channel, testnet signing and an nginx loopback gateway. Backend containers use an internal network. Startup is health-gated; the app template supplies disposable local identifiers. Compose project names and host ports support an independent acceptance environment.

Pin source commits rather than mutable branches. Relay's public source contains local mode directly. Bundle only the SigningServer local-mode adapter, verify its hashes when updating, and replace it with an upstream commit when that implementation is merged.

The setup hook remains platform neutral; Android reads ANDROID_HOME and iOS runs root Bundler/CocoaPods explicitly. No Redux slices, sagas, PSBT data flow, Realm schemas, MMKV keys or UI components change.

## Affected files

- `dev/local-backend/`: Compose, bootstrap/verification, templates, adapters, source lock and contributor documentation.
- `setup.sh`: only compatibility shims in Yarn's prepare hook.
- `Readme.md`, `CONTRIBUTING.md` and `.github/pull_request_template.md`: discoverable contributor workflow and test reporting, with security review, acceptance, merge and release authority retained by Keeper maintainers. No claim that repository protection rules have been verified or changed.
- `openspec/changes/package-contributor-development/`: scope and acceptance evidence.

## Validation and limits

Integration onto `sprint` also updates `.github/workflows/test.yml`, removes the
redundant scan-only `build.yml`, and publishes the test coverage artifact for
review. The project owner deferred SonarCloud; its job is removed while its
configuration and prior findings remain documented. `test-setup.js` and the vault
test close test-owned connections. `Gemfile.lock`, `ios/Podfile.lock` and the YAML
quoting in `openspec/config.yaml` are aligned with existing dependency/config
requirements. No app business logic or version fields change. `CI.md` records the
public-source CI verification and deferred SonarCloud work.

`ACCESS.md` defines private contributor intake, profile/context review,
approved development resources, invitations and setup confirmation. Access/admin
decisions stay in the internal backlog; public issues describe user-facing features
and bugs, and security findings use the private security process. Anyone may
work on public code, and approved contributors may change their local environment
without per-change approval. Access approval does not accept code or grant merge
or release authority. These documents do not themselves grant GitHub permissions.

Test from a fresh remote app checkout with newly fetched backend sources and new Docker volumes on alternate ports. Verify local API writes/reads, V3 Server Key and 2FA, persistence after recreation and rejection of external database/mainnet config. Build development Android and iOS using fresh dependency directories. Reuse host SDKs and download caches; a second physical developer machine remains an independent handoff check. Record failures honestly in VERIFICATION.md.
