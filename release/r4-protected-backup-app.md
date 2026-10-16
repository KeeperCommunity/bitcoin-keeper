# R4 / 2.6.4 protected-backup app handoff

State: **NEEDS_LOCAL; R4 remains BLOCKED.** Use the full app SHA in the newest **Codex local handoff** on [PR #7045](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045), verify it equals the live PR head, and preserve every earlier result under its original SHA. This document cannot name its own eventual commit. The current v3 instructions here supersede the historical public-v2 fixture commands in [the earlier handoff](r4-automatic-backup-local-handoff.md).

## Superseded recovery request correction

The03e proof did not cover a newer recovery discovery arriving during the old restore's record decryption in the **same account session**. Genuine protected and explicit-older schedules reproduced local account/consent changes. The corrected worker carries an identity-only request checkpoint through decode, post-derivation and every guarded Realm write, alongside the existing original/selected account-session checks. Each recovery Redux dispatch checks current request/session. Only GET_APP_IMAGE uses `takeLatest`; it cancels called wallet/signer/upgrade generators, and cancelled workers cannot emit retry cleanup. This does not change generic watchers, account authority or parked navigation behavior. Source RED/GREEN, fixture precondition failures and actual watcher/child cancellation evidence belong to the newest exact-head receipt.

CodeQL's03e analysis completed but its separate security aggregate **failed** (one Critical SSRF/one High sanitizer alert) on synthetic merge784b915c27060afabc340248b459541a754fe5f4. The test-only proxy now chooses three literal loopback URLs without constructing a destination from request input; genuine raw-target rejection tests verify it. Independent review supports a false-positive classification for the unchanged ASM warning: text remains local and only its numeric element count reaches fee sizing, with no HTML sink. No alert was dismissed. A new source scan and its actual result stay separate from this classification.

## Scope and identity

Production entry points are the protected authority/transport, existing automatic-write producer/queue and repair/status paths, confirmed Delete worker, and typed Recovery Key discovery/restore. Authority is derived separately from the Recovery Key with the supported signing profile; it does not turn legacy decryption or an old account identifier into proof of ownership. Existing Keeper app identity, wallet/key derivation, encrypted payload format, provider/billing identity and local-first recovery records stay separate. Missing/stale account, session, consent, committed-generation, original-base, fingerprint, CAS or final-readback proof remains fail-closed.

Hosted rollout readiness stays **false**. Read-only status never enrolls or enables automatic backup. Delete removes **only the new protected copy**, preserves local wallets/Recovery Key and records its confirmed tombstone. Older encrypted copies may remain read-only. A lost/malformed/uncertain Delete reply is not success; preserve local data and check status rather than retrying uncertain ciphertext. Turning off automatic backup keeps copies. Re-enrollment after Delete is an explicit new-copy action, with no automatic legacy fallback.

Recovery checks the protected namespace first. Absent, empty, deleted and read/auth/network errors are distinct typed results; errors do not select legacy recovery. Only the deliberate **Recover an older copy** choice permits that read. Complete validation precedes recovery success, whose provenance must match the selected source and current account. Partial/unavailable recovery is not full success. Restore leaves automatic-backup consent **off**; enabling the protected copy is a separate explicit action. EN and reachable ES disclose the retained-copy scope.

## Dependency and source preservation

Exactly five direct JS dependencies were added: `@exodus/bytes@1.16.0`, `@scure/bip32@2.4.0`, `@scure/bip39@2.4.0`, `@noble/curves@2.4.0`, and `@noble/hashes@2.4.0`. Yarn adds six selectors, including nested `@scure/base@2.4.0`; all 2,274 original selectors and old direct pins are unchanged. Existing QR resolution remains `@scure/base@1.1.9`; existing wallet crypto remains independent. The JS entry adds only the encoding initializer, which installs TextEncoder only when absent. The Android input receipt changes only its matching yarn-lock hash.

Android/iOS inputs, patches, native dependencies, JNA/Portal, Metro/Babel/shim, fixed configuration and the approved contributor `dev/local-backend/sources.lock.json` remain unchanged from `4927ad549dd1d610d9eb84c6d9a37ed0a6f33a29`. This is source preservation, not transfer of old native acceptance to the new SHA.

## Cloud and disposable checks

Use Node **22.23.3** or a later supported 22.x patch and frozen Yarn Classic **1.22.22** dependencies. Keep the separate private backend checkout at **`7693ce4bfffcadb5fb71d6478a8befc8e533a844`**, clean and obtained with authorized private read access. The opt-in runner checks that commit, fixed nonsecret input hashes, Mongoose 5.13.20/driver 3.7.4, genuine encrypted native Realm commit/reopen, and a credential-free disposable loopback replica at port **27038**. Never point it at hosted services or import/start the full backend/provider service graph.

```sh
KEEPER_PROTECTED_RELAY_CHECKOUT=/absolute/path/to/reviewed-private-backend \
BACKUP_TEST_MONGO_URL=mongodb://127.0.0.1:27038 \
yarn test:protected-backup-genuine
node --test tests/recovery/protected-authority.test.mjs
node tests/recovery/protected-authority.metro.cjs
node --test tests/recovery/protectedRecoverySource.test.cjs tests/recovery/recoveryErrorFeedback.test.cjs scripts/run-protected-backup-genuine.test.cjs
```

The private genuine lane exercises actual production saga/store/crypto, encrypted Realm and transactional backend HTTP/readback. It is separate from the public Relay **`838049e537e07eb646a2a0393eb969fba43d0739`** v2 lane. Public/fork CI cannot obtain the private fixture automatically; public838 results do not validate this v3 protocol. Do not replace contributor pins, vendor private backend source into the app, or skip the private proof and report success.

The signer command runs actual installed production crypto/vector/interoperability checks. The focused Metro command resolves mobile/default encoding and authority sources, executes its bundle in Node V8 and compiles Hermes bytecode; it does **not** execute Hermes or the full native App. The unit command is a narrow recovery/guard lane, not the entire acceptance matrix. Missing native bindings, skipped genuine proof and substituted algorithm mocks remain failures or blockers.

Source-bound construction results retained before the final commit: signer13/13, focused corrected genuine5/5, Jest42 suites/432 tests, release Node28/Python7/Ruby21 (117 assertions), all with zero skips. The newest PR receipt records the final frozen38 genuine cases and whole480 recovery outcome separately. Existing diagnostic failures are retained: initial Jest430/432, recovery473/480; later recovery478/480 (two missing AST bindings, both affected files subsequently36/36). A genuine vault-map alteration was RED0/1 then GREEN1/1 after complete projection validation; a genuine new-vault producer was RED0/1 then GREEN in the focused5/5 after including its scheme.

Expanded runtime lint has13 errors/2 warnings both at the4927 baseline and current source, with zero added/removed normalized findings; UI comparison36/21 versus38/21 adds none. Whole-project TypeScript remains failing with944 diagnostics on each tree. Seven raw TS2339 message renderings differ only in abbreviated inferred locale types; the same missing properties remain. Normalization adds/removes zero diagnostics. This is baseline comparison, not a clean typecheck or lint pass. New source support, advisory and Metro receipts are in `tests/recovery/protected-authority-evidence.json`; the independent engineering review is not professional crypto certification.

The final exact-head comment supplies all commands, case classifications, source hashes, stable-input manifests, compressed log retrieval and actual final outcomes. Native IOS/ANDROID/HARDWARE, Hermes runtime and full-app startup are NOT RUN in Cloud.

Do not convert earlier source-bound or native results into final-head passes. The newest PR comment must record exact commands, full app/backend identities, actual counts/failures/skips and log hashes.

## Codex Local: bounded current-source acceptance

Required local checks: **IOS, ANDROID, HARDWARE**. Keep the owner's [minimal native batch](https://github.com/KeeperCommunity/bitcoin-keeper/pull/7045#issuecomment-6185462332) and all remaining R4 gates. C8/[#7056](https://github.com/KeeperCommunity/bitcoin-keeper/issues/7056) and navigation work remain parked; no new fix/rebuild loop is authorized by this document. Old strict16KB/4KB/iOS results stay SHA-scoped. Only a fresh exact-SHA owner decision can defer eligible unrun physical checks; required platform failures cannot be waived.

### Disposable native transport preparation

The public contributor stack does not supply v3. Obtain the exact private backend separately and retain the approved public source manifest. In the app checkout use the same environment as the genuine runner, with a task-owned credential-free `keeperQA` replica on loopback27038 and frozen dependencies/native Realm. Run this **proposed, not native-executed in Cloud** long-lived command from the final app checkout:

```sh
KEEPER_PROTECTED_RELAY_CHECKOUT=/absolute/path/to/reviewed-private-backend \
BACKUP_TEST_MONGO_URL=mongodb://127.0.0.1:27038 \
node <<'NODE'
const assert = require('node:assert/strict');
const { checkedBackend, supportedNode, disposableMongoUrl } = require('./scripts/run-protected-backup-genuine.cjs');
assert.ok(supportedNode(process.versions.node));
checkedBackend(process.env.KEEPER_PROTECTED_RELAY_CHECKOUT);
process.env.BACKUP_TEST_MONGO_URL = disposableMongoUrl(process.env.BACKUP_TEST_MONGO_URL);
(async () => {
  const { createProtectedServer } = require('./tests/recovery/protectedWriteRealmRelay.fixture.cjs');
  const fixture = await createProtectedServer();
  console.log(JSON.stringify({ relay: fixture.url, audience: fixture.audience,
    database: fixture.backend.database, backend: '7693ce4bfffcadb5fb71d6478a8befc8e533a844' }));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await fixture.close();
  };
  process.once('SIGINT', () => { close().catch(() => { process.exitCode = 1; }); });
  process.once('SIGTERM', () => { close().catch(() => { process.exitCode = 1; }); });
})().catch(() => { console.error('Disposable protected fixture startup failed'); process.exitCode = 1; });
NODE
```

This uses actual private v3 router/services plus the two exact legacy read declarations, inert provider traps and a distinct disposable database. No full backend/bootstrap/config/credentials are loaded. It binds an ephemeral loopback port; do not run the full matrix concurrently against its single-process fixture. The fixture close operation drops **only its owned disposable database**; keep a diagnosed failure process/database alive until evidence is retained. Container volumes and all existing databases remain protected. Nothing here authorizes a hosted call.

In a separate **uncommitted local QA environment file**, set `ENVIRONMENT=DEVELOPMENT` and `RELAY` to the printed exact `http://127.0.0.1:<port>/` including trailing slash. Keep the existing reviewed local channel/SigningServer/test-only values; never print/copy hosted configuration. `src/utils/service-utilities/config.ts` consumes this field. `src/services/backup/protected.ts` and `automatic.ts` admit only explicit-port development loopback without changing their hosted false constants. For Android use `adb -s <disposable-emulator> reverse tcp:<port> tcp:<port>`; iOS simulator uses host loopback. Record the exact QA env-file hash/path and actual ENVFILE/native configuration selection, without exporting values.

**Boundary:** this fixture serves backups, not onboarding/channel/provider APIs. The app has one RELAY origin and no per-v3 override. Prepare a disposable consent-OFF account through the already reviewed local onboarding stack, then switch that QA configuration to this backup-only server for the exact-source native build/test; preserve the account's original identity and local records. It cannot establish full fresh onboarding against a composed v3 service. If an end-to-end onboarding gateway is needed, a fixed reviewed local-only forwarding composition remains required: do not silently invent it, start a private full service/provider graph, or claim this standalone launcher implements it. Clean protected restore is exercised from the app's recovery path, with real native success still to be established. Explicit older-copy native recovery additionally requires deliberately seeded disposable legacy ciphertext; do not point at retained customer copies. The actual encrypted fixture seeds/readback and failure injection are in `protectedWriteRealmRelay.proof.cjs` and `.fixture.cjs`; native hooks do not inherit those Node proof passes.

Build, install and launch the actual current development artifact on both platforms, then preserve artifact hashes and test:

- Fresh explicit opt-in → complete protected Verified; ordinary wallet-detail default-node bootstrap → automatic complete Verified → ordinary rename → full decrypted image/metadata readback. Test the original order, including a fresh account, rather than repairing the baseline first.
- Consent off/status without enrollment, current-account/session isolation, complete protected restore and deliberate older-copy restore; no legacy fallback on tombstone, empty/absent protected data, or errors. Available records must be complete before success; restore must keep consent off.
- Scoped Delete confirmed versus uncertain result, cold tombstone discovery and explicit recreate; older-copy warning/provenance and EN/ES enable/disable/status/recovery notices. Preserve local recovery data throughout.
- Cold PIN/MMKV/encrypted Realm persistence, relevant wallet/base smoke and Portal behavior. Android must actually launch with strict 16KB settings and exercise real Hermes/crypto initialization; retain normal4KB and iOS acceptance separately as requested in the minimal batch.

Record unrun hardware interactions as NOT RUN, with the actual exact-SHA owner scope decision if applicable. Report any new failure without speculating that an earlier fix uniquely explains it.

## Storage and authorization boundaries

The latest supplied Mac report is **16 October 15:30:40 UTC**, **50.9437 GiB free**. The proposed Stage B estimate is **47 GiB**, leaving arithmetic margin **3.9437 GiB**; this is a dated report, not current capacity or a fit decision. The storage helper still exited **2**: embedded-worktree fingerprint/source bindings and a non-null fit assessment remain required. Preserve all protected source/evidence/caches/devices/wallets/volumes. No cleanup was authorized.

Before any heavy checkout/install/fixture/native resumption and at closeout, follow available `AGENTS.override.md`, `keeper-local-memory.md` and `dev-environment/release-runbook.md`; run `python3 dev-environment/release-storage.py assess --context <freshcontext>` with the fresh complete remaining-peak/retry budget. Receipts expire after 30 minutes. Resolve the capacity/fit/source-binding gaps before heavy work; no timer/background cleanup.

Backend promotion/deployment/index/transaction/CAS/fleet/old-writer and ingress/protection evidence, hosted app enablement at a separately reviewed new SHA, exact-head local acceptance, store/channel/version/artifact approvals and physical follow-up remain separate open gates. No merge, production deployment/index/data/admin write, release signing, production AAB/split construction, upload/submission/publication, provider call or real transaction is authorized here. Keep R4 independent of Reproducibility and Bitkey Wallet.
