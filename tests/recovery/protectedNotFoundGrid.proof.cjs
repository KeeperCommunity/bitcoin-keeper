// Actual raw-operation CAS404 after guarded namespace loss in this freshly
// owned disposable fixture DB. Real router returns404; no HTTP reply is invented.
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
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

for (const operation of operationNames) nodeTest(
  `${operation}: real missing-namespace CAS404 retains local recovery and refuses history downgrade, repair or replay`,
  { timeout: 30_000 }, async t => {
    const f = await scope.setup(t, operation);
    const request = await scope.committedRequest(f, operation);
    const base = request.receipt.intent.protectedBase;
    const local = await f.repair.captureBackupImage();
    server.clearTrace();
    let originalSnapshot, namespaceLossWitness = false, removedRecords = 0;
    server.armFault({ path: '/backup/v3/snapshot', async beforeReply({ body }) {
      originalSnapshot = plain(body);
      // Exact established guarded fault pattern from the genuine label proof.
      // This cannot touch a non-fixture DB or any different namespace.
      const backend = server.backend;
      assert.match(backend.database, /^keeper_protected_http_test_[0-9]+$/);
      assert.equal(backend.mongoose.connection.name, backend.database);
      const database = backend.mongoose.connection.db;
      const removed = await database.collection('protectedBackupNamespaces').deleteOne({ _id: base.namespaceId });
      assert.equal(removed.deletedCount, 1);
      const records = await database.collection('protectedBackupRecords').deleteMany({ namespaceId: base.namespaceId });
      removedRecords = records.deletedCount;
      namespaceLossWitness = true;
    } });
    const result = await request.invoke();
    assert.equal(namespaceLossWitness, true);
    assert.ok(removedRecords > 0, 'The actual existing encrypted records must have been present and removed in the owned fault');
    assert.equal(originalSnapshot.exists, true);
    assert.equal(originalSnapshot.namespaceId, base.namespaceId);
    assert.equal(originalSnapshot.revision, base.revision);
    assert.equal(originalSnapshot.generation, base.generation);
    assert.equal(originalSnapshot.authEpoch, base.authEpoch);
    assert.notEqual(result.updated, true);
    assert.notEqual(result.backupConfirmed, true);
    assert.deepEqual(server.trace.map(event => [event.path, event.status]), [
      ['/backup/v3/snapshot', 200], ['/backup/v3/mutate', 404],
    ]);
    assert.equal(writes().length, 1);
    const own = writes()[0];
    assert.equal(own.operation, operation);
    assert.equal(own.status, 404);
    assert.equal(own.committed, false);
    assert.equal(own.namespaceId, base.namespaceId);
    assert.equal(own.expectedRevision, base.revision);
    assert.equal(own.expectedGeneration, base.generation);
    assert.equal(own.authEpoch, base.authEpoch);
    scope.assertPending(f);
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
    assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
    const database = server.backend.mongoose.connection.db;
    assert.equal(await database.collection('protectedBackupNamespaces').countDocuments({ _id: base.namespaceId }), 0);
    assert.equal(await database.collection('protectedBackupRecords').countDocuments({ namespaceId: base.namespaceId }), 0);
    const beforeReplay = server.trace.length;
    assert.notEqual((await request.invoke()).backupConfirmed, true);
    assert.equal(server.trace.length, beforeReplay, 'A consumed404 receipt cannot read, enroll, repair or replay');
    await assert.rejects(f.protected.readProtectedBackup(mnemonic, undefined, appId),
      /Protected backup history conflicts with this device/,
      'Known protected history must not downgrade lost storage to a never-enrolled or legacy source');
    const revision = f.transport.backupRevision(appId);
    const phase = await f.repair.inspectBackup(appId, false, () => {});
    assert.equal(phase, 'unverified');
    assert.equal(writes().length, 1, 'Read-only reconciliation cannot recreate or retry a missing namespace');
    assert.ok(f.transport.backupRevision(appId) >= revision);
    assert.equal(server.trace.some(event => event.path === '/backup/v3/enroll' || event.legacyRead), false);
    const afterInspection = server.trace.length;
    assert.notEqual((await request.invoke()).backupConfirmed, true);
    assert.equal(server.trace.length, afterInspection);
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    scope.assertPending(f);
  });
