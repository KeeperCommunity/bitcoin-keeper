// Actual committed reply uncertainty: invalid revision shape or genuinely lost
// HTTP reply across all seven operations. Native receipts, crypto, backend and
// full readback remain real; no successful ACK or backend commit is fabricated.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
const builders = { assert };
evaluate(declarations('tests/recovery/automaticWriteRealmRelay.integration.cjs', [
  'wallet', 'signer', 'vault', 'persist', 'persistVault', 'vaultBody', 'labelBody', 'operations',
]), builders, 'unchanged-public-disposable-operation-builders.ts');
const { operations, wallet, persist, persistVault } = builders;
const operationNames = ['updateAppImage', 'migrateXfps', 'deleteAppImageEntity', 'deleteVaults',
  'updateVaultImage', 'modifyLabels', 'deleteBackup'];
assert.deepEqual(Object.keys(operations), operationNames);
// Reuse the reviewed REAL client/receipt helper declarations without importing
// that proof file or registering/executing its unrelated tests.
const fixtureScope = { assert, createProtectedRealmClient, mnemonic, seed, appId, operations };
evaluate(declarations('tests/recovery/protectedWriteRealmRelay.proof.cjs', ['client', 'committedRequest']),
  fixtureScope, 'unchanged-real-protected-client-and-receipt-helpers.ts');
let server;
beforeEach(async () => { server = await createProtectedServer(); fixtureScope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; fixtureScope.server = undefined; });
after(() => Realm.shutdown());
const mutations = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

const REPLY_FAULTS = [
  { id: 'malformed-revision', mode: undefined },
  { id: 'lost-reply', mode: 'lost-reply' },
];

async function setup(t, operation) {
  await server.reset();
  const f = await fixtureScope.client(t);
  operations[operation].prepare(f);
  persist(f, f.RealmSchema.Wallet, wallet(f, 'retained-wallet', 'Retained local recovery record'));
  // Retain the original delete-vault fixture's independent remaining vault.
  if (operation === 'deleteVaults') persistVault(f, 'retained-vault');
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
  await tick();
  assert.equal(await f.sagas.run('runBackupInspection', true, appId, true), true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], false);
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), true);
  assert.ok(f.transport.captureBackupWriteIntent(appId)?.protectedBase);
  server.clearTrace();
  return f;
}

function assertPending(f) {
  const state = f.store.getState().bhr;
  assert.equal(state.pendingAllBackupByAppId[appId], true);
  assert.notEqual(state.backupRepairStateByAppId[appId], 'verified');
  assert.notEqual(state.backupRepairCompletedByAppId[appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), false);
  assert.equal(state.automaticCloudBackupByAppId[appId], true,
    'An unacknowledged Delete cannot opt out; other operation failures cannot change consent');
}

async function settled(request) {
  try { return await request.invoke(); }
  catch (error) { return { updated: false, failure: error.name }; }
}

function assertOriginalPositiveAck(value, base, operation) {
  assert.equal(value.updated, true);
  assert.equal(value.preconditionApplied, true);
  assert.match(value.newRevision, /^[a-f0-9]{64}$/);
  assert.notEqual(value.newRevision, base.revision);
  assert.equal(value.newGeneration, base.generation + 1);
  assert.equal(value.authEpoch, base.authEpoch + (operation === 'deleteBackup' ? 1 : 0));
  assert.equal(value.deleted, operation === 'deleteBackup');
  assert.equal(typeof value.suppressLegacyFallback, 'boolean');
  if (operation === 'deleteBackup') {
    assert.equal(value.suppressLegacyFallback, true);
    assert.equal(value.deletionScope, 'protected-backup-only');
    assert.equal(value.legacyCopiesMayRemain, true);
  }
}

for (const operation of operationNames) for (const fault of REPLY_FAULTS) {
  nodeTest(`${operation}: actual committed ${fault.id} preserves every pending flag, complete recovery and read-only no replay`,
    { timeout: 30000 }, async t => {
      const f = await setup(t, operation);
      const request = await fixtureScope.committedRequest(f, operation);
      const base = request.receipt.intent.protectedBase;
      const local = await f.repair.captureBackupImage();
      const app = plain(f.dbManager.getObjectById(f.RealmSchema.KeeperApp, appId));
      let originalAck, injected = false;
      server.armFault({ path: '/backup/v3/mutate', operation,
        ...(fault.mode ? { mode: fault.mode } : {}),
        beforeReply({ body }) { originalAck = plain(body); injected = true; },
        ...(fault.id === 'malformed-revision' ? { mutateReply(value) {
          return { ...value, newRevision: 'not-a-valid-revision' };
        } } : {}),
      });
      const result = await settled(request);
      assert.equal(injected, true, 'The selected operation must reach its actual committed HTTP ACK');
      assert.equal(mutations().length, 1);
      assert.equal(mutations()[0].operation, operation);
      assert.equal(mutations()[0].status, 200);
      assert.equal(mutations()[0].committed, true);
      assert.equal(mutations()[0].namespaceId, base.namespaceId);
      assert.equal(mutations()[0].expectedRevision, base.revision);
      assert.equal(mutations()[0].expectedGeneration, base.generation);
      assert.equal(mutations()[0].authEpoch, base.authEpoch);
      assertOriginalPositiveAck(originalAck, base, operation);
      assert.notEqual(result.updated, true);
      assert.notEqual(result.backupConfirmed, true);
      assertPending(f);
      assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
      assert.deepEqual(plain(f.dbManager.getObjectById(f.RealmSchema.KeeperApp, appId)), app);
      assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
      if (operation === 'deleteVaults') assert.ok(f.dbManager.getObjectById(f.RealmSchema.Vault, 'retained-vault'));

      // Observe the actual committed remote effect independently of its faulty
      // ACK. This read does not substitute a successful queue acknowledgement.
      const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
      assert.equal(remote.state, operation === 'deleteBackup' ? 'deleted' : 'present');
      assert.equal(remote.snapshot.revision, originalAck.newRevision);
      assert.equal(remote.snapshot.generation, originalAck.newGeneration);
      assert.equal(remote.snapshot.authEpoch, originalAck.authEpoch);
      const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
        remote.snapshot, remote.namespaceId, () => {}, true);
      if (operation === 'deleteBackup') {
        assert.equal(remote.snapshot.suppressLegacyFallback, true);
        assert.ok(Object.values(decoded).every(records => Object.keys(records).length === 0));
        assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a'));
      } else assert.equal(await f.image.compareImages(local, decoded), 'matched');
      assertPending(f);

      const beforeReplay = server.trace.length;
      assert.notEqual((await settled(request)).backupConfirmed, true);
      assert.equal(server.trace.length, beforeReplay, 'The consumed receipt cannot read, enroll, retry or repair');
      assertPending(f);
      const revision = f.transport.backupRevision(appId);
      const phase = await f.repair.inspectBackup(appId, false, () => {});
      // v3's explicit deleted state is the truthful replacement for a v2
      // missing/different copy, never a positive Delete acknowledgement.
      assert.equal(phase, operation === 'deleteBackup' ? 'deleted' : 'verified');
      assert.equal(mutations().length, 1, 'Read-only reconciliation cannot replay the uncertain mutation');
      assert.ok(f.transport.backupRevision(appId) >= revision);
      assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
      const afterInspection = server.trace.length;
      assert.notEqual((await settled(request)).backupConfirmed, true);
      assert.equal(server.trace.length, afterInspection, 'Even a fresh read cannot lend authority to the old receipt');
      assertPending(f);
    });
}
