// A real later opt-out invalidates every previously committed operation,
// including explicit Delete. Real consent observers, receipts, Realm and backend.
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
]), builders, 'unchanged-disposable-operation-record-builders.ts');
const scope = { assert, plain, createProtectedRealmClient, mnemonic, seed, appId, tick, ...builders };
scope.fixtureScope = scope;
evaluate(declarations('tests/recovery/protectedWriteRealmRelay.proof.cjs', ['client', 'committedRequest']),
  scope, 'unchanged-real-protected-client-and-committed-receipt.ts');
evaluate(declarations('tests/recovery/protectedReceiptOwnershipGrid.proof.cjs', ['setup', 'assertPending']),
  scope, 'unchanged-real-enrollment-full-initial-image-and-pending-checks.ts');
const operationNames = ['updateAppImage', 'migrateXfps', 'deleteAppImageEntity', 'deleteVaults',
  'updateVaultImage', 'modifyLabels', 'deleteBackup'];
assert.deepEqual(Object.keys(builders.operations), operationNames);
let server;
beforeEach(async () => { server = await createProtectedServer(); scope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; scope.server = undefined; });
after(() => Realm.shutdown());

function assertRevokedPending(f) {
  const state = f.store.getState().bhr;
  assert.equal(state.pendingAllBackupByAppId[appId], true);
  assert.notEqual(state.backupRepairStateByAppId[appId], 'verified');
  assert.notEqual(state.backupRepairCompletedByAppId[appId], true);
  assert.equal(state.automaticCloudBackupByAppId[appId], false);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), false);
  assert.equal(f.transport.captureBackupWriteIntent(appId), undefined);
}
for (const operation of operationNames) nodeTest(
  `${operation}: actual later consent-off invalidates the original epoch before HTTP and preserves local and remote copies`,
  { timeout: 30_000 }, async t => {
    const f = await scope.setup(t, operation);
    const request = await scope.committedRequest(f, operation);
    assert.equal(request.receipt.committed, true);
    assert.ok(request.receipt.intent?.protectedBase);
    const originalEpoch = request.receipt.intent.consentEpoch;
    const local = await f.repair.captureBackupImage();
    // Real explicit Delete preparation may read before the newer choice.
    server.clearTrace();
    f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: false }));
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], false);
    assert.ok(f.transport.backupConsentEpoch(appId) > originalEpoch,
      'The actual consent observer must advance the original operation epoch');
    const result = await request.invoke();
    assert.notEqual(result.updated, true);
    assert.notEqual(result.backupConfirmed, true);
    assert.equal(server.trace.length, 0, 'Old operation cannot read, enroll, mutate or repair after the later opt-out');
    assertRevokedPending(f);
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
    assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
    const replay = await request.invoke();
    assert.notEqual(replay.backupConfirmed, true);
    assert.equal(server.trace.length, 0);
    const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
    assert.equal(remote.state, 'present', 'Old explicit Delete must respect the newer consent epoch');
    assert.deepEqual(plain(remote.snapshot), plain(f.initialRemote.snapshot));
    const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
      remote.namespaceId, () => {}, true);
    assert.equal(await f.image.compareImages(f.initialImage, decoded), 'matched');
    assert.equal(server.trace.filter(event => event.path === '/backup/v3/mutate').length, 0);
    assertRevokedPending(f);
  });
