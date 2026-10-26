// Retain original actual native listener-emission obligations after every real
// non-Delete local commit, alongside genuine signed CAS and full current readback.
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
const operationNames = ['updateAppImage', 'migrateXfps', 'deleteAppImageEntity',
  'deleteVaults', 'updateVaultImage', 'modifyLabels'];
assert.deepEqual(Object.keys(builders.operations).filter(name => name !== 'deleteBackup'), operationNames);
let server;
beforeEach(async () => { server = await createProtectedServer(); scope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; scope.server = undefined; });
after(() => Realm.shutdown());

for (const operation of operationNames) nodeTest(
  `${operation}: real committed local change emits native Realm notification before full signed verification`,
  { timeout: 30_000 }, async t => {
    const f = await scope.setup(t, operation);
    const eventBoundary = f.nativeEvents.length;
    const request = await scope.committedRequest(f, operation);
    const base = request.receipt.intent.protectedBase;
    const local = await f.repair.captureBackupImage();
    server.clearTrace();
    const result = await request.invoke();
    assert.equal(result.updated, true);
    if (operation !== 'modifyLabels') assert.equal(result.backupConfirmed, true);
    const writes = server.trace.filter(event => event.path === '/backup/v3/mutate');
    assert.equal(writes.length, 1);
    const own = writes[0];
    assert.equal(own.operation, operation);
    assert.equal(own.status, 200);
    assert.equal(own.committed, true);
    assert.equal(own.namespaceId, base.namespaceId);
    assert.equal(own.expectedRevision, base.revision);
    assert.equal(own.expectedGeneration, base.generation);
    assert.equal(own.authEpoch, base.authEpoch);
    assert.ok(f.nativeEvents.length > eventBoundary,
      'The actual native Realm listener must observe this operation commit, beyond all initial setup events');
    const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
    assert.equal(remote.state, 'present');
    assert.equal(remote.snapshot.revision, own.serverRevision);
    assert.equal(remote.snapshot.generation, own.serverGeneration);
    assert.equal(remote.snapshot.authEpoch, own.serverAuthEpoch);
    const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
      remote.namespaceId, () => {}, true);
    assert.equal(await f.image.compareImages(local, decoded), 'matched');
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
    assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], false);
    assert.equal(f.store.getState().bhr.backupRepairStateByAppId[appId], 'verified');
    assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[appId], true);
    assert.equal(f.automatic.isBackupVerificationCurrent(appId), true);
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  });
