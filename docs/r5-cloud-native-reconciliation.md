# R5 Cloud native infrastructure reconciliation

This isolated package adopts completed infrastructure into the released-R4/R5 source. It does not merge or alter producer branches, install a trusted baseline, grant full app acceptance, or perform release operations. Ordinary iOS and Android validation uses hosted runners; the owner's personal Mac is not required.

## Sources and separate reviews

- App input: R5 core #7058 through `77b72da29ac5f2cdf3f51c9a0e9f3fd1c2af7238`, plus completed 5.1 #7067 through `c1c4b803039b61b940373c4dc9d08473cf25e042`. Released R4 `1d8a86a7462d935cbd0e28b857934b5718c152fc` is already reconciled. Work-package labels are not app versions.
- [#7063 bootstrap/privacy patch](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7063/files), source `0984c5b97e7e8326d6856ba662274ecf325e5e0f`: source-linked cherry-pick preserves fixed diagnostic vocabularies, privacy regressions, draft guards and corrected emulator pin. Newer R4 frozen/script-disabled installs, dependency patching and release guards are preserved in `test.yml`.
- [#7062 reusable foundation delta](https://github.com/KeeperCommunity/bitcoin-keeper/compare/d865ca9c4f91532a1524443cc6da42d8d7b07e1a...59c821ce195a5c063d99045fd97b5ac605433f62), source `59c821ce195a5c063d99045fd97b5ac605433f62`: source-linked cherry-pick adds shared worker, provenance verifier and separate native storage probe without reverting #7063 privacy fixes.
- [#7060 native repairs](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7060/files), source `d865ca9c4f91532a1524443cc6da42d8d7b07e1a`: narrow adoption aligns NitroModules 0.36.5 with existing IAP 16.5.0 and installs the standard RN dependency provider. Newer R4 crypto dependencies, app/release versions, Podfile retired-credential guard and current Podfile/Hermes checksums remain preserved; CocoaPods is matched to the runner's 1.16.2. Exact-candidate deployment-mode installation must prove those inputs.

These inherited packages exceed one small review; their original patch-only reviews and source-linked commits remain authoritative review units. The new reconciliation delta is separately committed and bounded to orchestration/gate/source setup. Product native feature scenarios and full-product timing are separate implementation packages, as is protected signing/distribution preparation.

## Execution routes

`Keeper release acceptance` is the reusable default after approved protected-base installation. Native jobs require a real non-draft PR, exact source checkout and reviewed CI fingerprints matching current and run bases. Platforms execute sequentially. Full Phase A acceptance remains BLOCKED until each product requirement has genuine evidence; native-storage or helper probes cannot grant full app, backend, crypto, UI or release acceptance.

`Keeper native candidate diagnostics` allows pre-merge execution on a same-repository draft with explicit `keeper/native-diagnostic` label. The coordinator verifies current head and existing active native jobs before labeling. The worker rechecks current source and opt-in before setup. iOS runs first, then Android; concurrency does not cancel an active candidate job. A synchronize event creates a new exact-source run rather than transferring evidence. Remove the label before changing the candidate if another run should not be queued. Diagnostic results are metadata only, have separate artifact names, and are excluded from trusted gate evidence.

The former startup workflow requires `keeper/legacy-native`; this selects the serialized startup fallback instead of the reusable default. Inherited Android production-debug package diagnostics now require their existing explicit manual dispatch, preventing a second automatic PR candidate build. Their concurrency no longer cancels an active job. The coordinator must still check other already-running workflows and schedule only one native build at a time. No active job was cancelled by this package.

The trusted validation gate accepts exact-head successful platform build/UI/probe jobs from the reviewed reusable workflow or legacy startup fallback. It selects the current label route, then uses only that route’s newest run and current attempt, and checks the full native harness plus executable worker against protected current/run bases. A newer skipped/cancelled/failed run within the selected route cannot reuse an older successful run. The intentionally skipped alternate route cannot shadow genuine evidence. Current base, repository/ref identity and selected route are rechecked immediately before status publication. A diagnostic run, absent worker, changed CI, stale SHA or build-only result provides no credit. Hardware requirements, actual failures, owner-scoped deferrals and local fallback remain binding. This status is platform scope only; it cannot approve full feature acceptance or release.

## Disposable data, evidence and limits

The app is unsigned on iOS Simulator and uses the public debug key on Android. Synthetic Firebase identities and blocked loopback service configuration isolate product accounts. The loopback Relay URL is `http://127.0.0.1:8765/` solely for the separately reviewed disposable product UI measurement responder; without that responder requests fail. That responder is controlled transport and supplies no paired-backend/protected-backup compatibility evidence. Other configured services remain blocked loopback destinations.

Only bounded metadata is uploaded, with source/run/attempt, toolchain, artifact hashes, safe scenario statuses and raw measurement numbers. Raw logs, screenshots, UI hierarchies, application databases, generated key material and app bundles remain on the disposable runner. Frozen lockfiles and repository dependency patches stay required. Existing Yarn/Gradle caches hold development dependencies, never accounts, keychains or signing material. No production account operation or credential copying occurs.

## Current evidence

- #7060 historical native success at its own `d865ca9c4f91532a1524443cc6da42d8d7b07e1a`, run `39024530330`, is retained solely as infrastructure history. It does not validate R5 source.
- #7063 source `0984c5b97e7e8326d6856ba662274ecf325e5e0f`: native skipped; CI Tests failed frozen install before tests (run `39105347518`, job `117609865702`). The stale excluded dependency baseline is inherited, not a privacy-regression pass.
- #7062 source `59c821ce195a5c063d99045fd97b5ac605433f62`: no PR native run/status returned at readback. Its full product matrix was explicitly unimplemented.
- This reconciliation: host policy/negative/provenance tests and semantic workflow lint are verified separately at its final commit. Actual R5 iOS/Android native build, feature checks, full-product startup/first-wallet timing and physical-device results remain NOT RUN until exact-candidate execution. Full Phase A and release readiness remain BLOCKED.

Next: integrate independently reviewed scenario/product-measurement packages and completed 5.2 only after its authoritative checkpoint; verify ancestry and combined head; finish active inherited native jobs; schedule one candidate diagnostic run; retain all failures and rerun affected checks after any correction. Protected-base adoption/required-check configuration needs explicit approval and administrative verification. No merge, signing, upload, distribution, deployment or publication is authorized here.


## Feature and product UI hooks

The reusable worker invokes `.github/native/hosted_native.py features` and then `.github/native/product_measurements.py run` after startup and primitive-storage probes. The first hook depends on the separately reviewed native-feature package; the second depends on the separate full-product measurement package. Those source packages are intentionally absent from the standalone foundation branch. A missing dependency fails execution; it cannot be treated as a feature pass. The integration candidate must include both before scheduling a native run.

Worker evidence requires all five fixed scenarios, actual native persistence across six processes, five bounded raw helper measurements and source-function hashes matching the current candidate files. Only an allowlist of fixed metadata and numbers is exported. Helper timings remain explicitly different from the full-product measurements, whose runner uses the normal app/Metro entrypoint and records five raw startup/passcode/first-wallet/relaunch/UI samples. Controlled loopback transport in either runner grants no genuine paired-backend evidence.

Runner disk preflight records available bytes and a 12 GiB minimum reserve before dependency preparation and native compilation; insufficient reserve fails without deleting another task's caches or data. iOS and Android job ceilings are 105 and 90 minutes respectively, with no automatic retry. These are upper bounds, not observed runtime or cost. Actual combined native execution remains NOT RUN here.

The inherited infrastructure adoption is approximately 53.6k changed code/test tokens by the characters/4 estimate, with the new reconciliation delta approximately 6.7k before these hooks. The 19k estimate belongs to the original #7062 delta alone. Keep original source review units and the new reconciliation-only comparison separate; do not describe the aggregate as one sub-20k package.

Installed-artifact scope: successful install consumes the unchanged candidate build path. Metadata reports install_succeeded and explicitly leaves installed_artifact_verified false because installed bytes have not been independently hashed. Built artifact hashes and exact production source checks remain required; do not describe this as installed-byte hash verification.
