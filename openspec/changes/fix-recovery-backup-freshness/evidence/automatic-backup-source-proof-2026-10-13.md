# R4 automatic backup source/disposable proof — 13 October 2026

This is a sanitized result summary. It contains source identities, commands, counts and test boundaries only. It contains no backup content, real account/wallet identifiers, labels, seed material, private keys or credentials. Existing September logs are preserved unchanged.

## Source identity and enablement boundary

- Final tested app code commit before this documentation commit: `3cc9368ca2f3b2149db5743a5f9d230aa516d6a0`. This includes persisted BHR proof expiration before reconciliation, current-proof UI status projection and seven added genuine cases, in addition to the earlier frozen-Yarn and utility fixes.
- Paired Relay: `b600416e5ba7325927d7d2871cff7776f4e593fe`. The app runner requires this exact clean tracked checkout and the expected fixture path.
- Final flags: `AUTOMATIC_BACKUP_SOURCE_READY=true` permits DEVELOPMENT loopback testing only; `AUTOMATIC_BACKUP_RELAY_ROLLOUT_READY=false` remains unchanged. Development source readiness does not enable hosted writes.
- The final PR Local handoff must separately record the exact post-push head SHA. This evidence file cannot name its own future commit or confer release approval.

## Genuine host Realm and transactional HTTP matrix

Command: `npm run test:automatic-backup-genuine`, with Node 22.23.3 on Linux, actual Realm 12.15.0, `KEEPER_RELAY_FIXTURE_MODULE` pointing to the pinned Relay's `tests/support/automaticBackupHttpFixture.cjs`, and `BACKUP_TEST_MONGO_URL=mongodb://127.0.0.1:27058`. The runner refuses a missing/different/dirty tracked Relay, missing required matrix, unavailable native binding, unsupported Node or non-loopback/credentialed Mongo. A missing prerequisite fails; it is not skipped or replaced by a unit adapter.

Final combined command outcome/time: **PASS 260/260, 0 failures, 0 skips**, exit 0, 208.779 seconds; clean frozen-Yarn run terminal log recorded 2026-10-13 05:26 UTC on the exact app/Relay sources above. Earlier combined seven-file run passed 245/245 with zero skips. Eight added direct schedules passed 8/8 with zero skips, 30.469 seconds, observed 2026-10-13 04:08 UTC at fixture commit 7b1ad70ba9e2aa1a2778b375f36e776bdd26a5ad: one native local change after the first actual CAS while its ACK is held, and after-send A→B→A for each of the seven operations. Each B account uses a distinct seed/appId/publicId and real verified B baseline; old A completion preserves B UI/native/remote state. The final seven-file combined run includes all eight schedules at the enabled code SHA.

| File / scope | Observed result |
| --- | --- |
| automaticWriteRealmRelay.integration.cjs — all seven operations and shared queue/proof gates | 213/213 PASS, including held-ACK schedules plus seven rehydration/current-proof projection cases |
| automaticRecoveryRestore.integration.cjs — whole Recovery Key restore | 1/1 PASS; strengthened whole-image/all-signers/normalized-nodes comparison also reran 1/1 PASS |
| automaticLabelProducers.integration.cjs — actual label import/edit/send/manual-coin producers | 9/9 PASS |
| automaticUpgradeProducer.integration.cjs — actual launch upgrade/version/health/label fanout | 9/9 PASS |
| automaticWalletProducer.integration.cjs — actual wallet/vault creation, rename and migration | 8/8 PASS |
| automaticUSDTProducer.integration.cjs — existing DEFAULT/IMPORTED metadata/deletion, cache and paused creation | 11/11 PASS |
| automaticSignerProducer.integration.cjs — actual correction/registration/live/archive fanout | 9/9 PASS |

The fixture loads actual production Realm wrappers and schemas, snapshot/sanitization/AES, backup automatic coordinator/transport, real Redux reducers, extracted production account-origin middleware and store observers. The paired server runs real HTTP through extracted production routes, production services and Mongoose transactions in a disposable keeperQA replica set. Protocol fault interception is explicit: malformed/old/missing/false ACK, 404, 409, lost or delayed reply and corrupt readback. Negative tests assert zero unauthorized effects or stopped fanout, retained local data, and pending/unverified status. They never manufacture an operation receipt, generation or baseline.

Core mutation callbacks are often built directly over the production commit API; the five producer suites and selected BHR cases additionally execute actual source functions. Host platform/device-info, MMKV persistence adapter, unused RSA and notification helpers are disclosed host boundaries. The seven new cases comprise six actual Redux Persist boot/consent/durability cases and one actual UI AST declaration projection case over native Realm/HTTP proof. They assert saved Verified/interrupted/completed flags become unverified/pending without changing consent, physical confirmation or local records; existing negative findings survive. Canonical nested opt-out wins both read orders and every subscriber prefix; legacy fallback requires confirmed absence, a read error denies it, and absence-first legacy fallback retains live persistence metadata so later consent/pending changes really flush. Rehydration sends no Relay read, repair or write and grants no usable write intent. A fresh complete encrypted HTTP inspection alone restores current proof, and a new post-inspection operation alone may upload. The display checks project actual source declarations; no rendered React Native UI, native MMKV, full app boot, UI navigation or physical signing is attested.

Clean restoration uses real BIP39/BIP32/BIP85/AES and actual getAppImageWorker/recoverApp/writeRecoveredObject into a blank encrypted Realm, reading from the actual HTTP Relay. The dataset includes BTC MAINNET and TESTNET, retained DEFAULT and IMPORTED USDT key/address/history metadata, Recovery Key and other signer data, active/archived vaults, registrations, labels and both-network nodes. Whole recovery-image comparison, complete signer fields and normalized nodes are asserted. Initial database opening is a real dbManager call, outside the native passcode/UI flow. No new USDT setup/import, provider transfer or consent opt-in is enabled by this test.

## Other Cloud checks

| Check | Actual outcome / boundary |
| --- | --- |
| Recovery suite: `npm run test:recovery` | 443/443 PASS, zero failures/skips, 52.156 seconds, exit 0 on app source 3cc9368ca2f3b2149db5743a5f9d230aa516d6a0. Producer unit adapters are distinguished from genuine integration files; actual native Realm wrapper regressions are included |
| Realm commit/invalidation/open-session focused suite | 20/20 PASS, including ten actual-native atomic commit/rollback/observer cases |
| Root Jest | 42 suites / 432 tests PASS, exit 0, 37.9 seconds on 3cc9368ca2f3b2149db5743a5f9d230aa516d6a0 |
| Release tooling | Coordinator reports Node 28 PASS, Python 7 PASS and Ruby 21 runs / 117 assertions PASS; these are tooling tests, not signing/store validation |
| Local validation gate tests | Coordinator reports 11/11 PASS; gate test code passing does not supply an actual Local validation comment |
| Focused six core backup modules lint/format | Recorded PASS; distinguished from whole-repository lint |
| Whole-repository lint CLI | Prior 2071 hosted run actually FAILED with 5353 problems: 4467 errors and 886 warnings. The job tolerated this failure and completed green; neither job status nor focused checks is a clean whole-lint pass |
| Whole-project TypeScript | FAIL: coordinator reports 945 inherited diagnostics versus 957 at baseline bb66cea459fbb00ec33c5c4ebd601d07c0d7c125, zero added normalized diagnostics. No clean whole-project typecheck is claimed |
| Current release preflight | FAIL: observed 2026-10-13 04:11 UTC, iOS store history older than 24 hours; no release-readiness pass is inferred from tooling tests |
| Source-specific CI | Source #7042 at 163cccb831f824b3daacc05199421683abdaf1ad passed hosted Tests/CodeQL: 341 Jest, 210 recovery, 12 JavaScript + 7 Python release checks and version 2.6.3. Changes are test-only fixtures/AES assertion/CI trigger; runtime d280 unchanged. Prior 74df and 28c7 failures remain source-specific history below; these results are not combined R4 or native signoff |
| Independent agent fixture review | PASS architecture/evidence review after strengthening missing full-signers/nodes restore assertions; no external final-source developer signoff implied |

## Preserved earlier October checkpoints

The earlier source checkpoint remains evidence for its own tested source: genuine 253/253, zero failures/skips, 162.1566 seconds at app efa6f89ebf7140f738f03ce8a7218a2a1e7f9bc2 and the same pinned Relay, terminal recorded 2026-10-13 04:12 UTC. Earlier recovery 430/430, zero failures/skips, 47.9 seconds was run on 0f37506a58e6bf44061dd6788b20e5fa095a10c6 after the c308aa405 session guards. The coordinator's earlier Jest report was 41 suites / 393 tests PASS. These are historical October results, superseded for the current source by the refreshed counts above; no result is retroactively transferred to a new SHA. September evidence files are unchanged.

The later a243b53b5682a276eb88851c3d34379c0908fedd source checkpoint passed genuine 253/253, zero failures/skips, 195.046 seconds at 04:40 UTC; recovery 434/434 in 67.140 seconds and Jest 42 suites / 432 tests in 72.836 seconds. Hosted combined head 2071acbdcc572de9988d41f894b7356618bc14be then passed Tests run 38348159148 (genuine 253 with zero skips, recovery 434, Jest 42/432) and CodeQL check 115134694738 SUCCESS. Its whole lint CLI nevertheless failed with the 5353 problems stated above. That checkpoint preceded the rehydrated-Verified proof fix and cannot prove the new source or native cold launch.

Source #7042 history is separate: trigger correction 74df55446d8645ebfac05405fce81fa43446acd9 had separate CodeQL/Analyze SUCCESS but Tests run 38347397038 failed 34/35 Jest suites, 333/340 tests (seven unchanged live-network Electrum failures); recovery/version/release were skipped. The intervening 28c7 test-fixture attempt also remained a failed source-PR checkpoint. Final test-only 163cccb831f824b3daacc05199421683abdaf1ad corrected fixtures/AES assertion/trigger and passed its own hosted checks with runtime d280 unchanged. It is source-specific version 2.6.3 evidence, not the combined R4 app's final-head checks. Subsequent current-head CI outcomes are recorded externally on the PR after the final documentation push.

## Open gates

IOS and ANDROID exact-source build/launch, automatic create/edit/delete/relaunch and complete Recovery Key restore safety matrix: **NOT RUN / NEEDS_LOCAL**. Host SDK close/reopen is not proof of process restart, persisted MMKV pending state, background execution, UI layout, enlarged text, memory or native 1/10/50-wallet profiling. Physical-only follow-up needs a separately recorded owner decision; it cannot waive critical native checks.

Hosted running Relay source parity, transaction topology, request limits, old/legacy-writer fleet rollout and production authorization remain unverified. Final current-head CI/external developer review, store histories/counters, signed artifact identity, merge/signing/submission/deployment/publication approval remain open. This source/disposable proof does not authorize any such operation and stays independent of Reproducibility, Bitkey/Recoverable Wallet and unrelated R4 deliverables.
