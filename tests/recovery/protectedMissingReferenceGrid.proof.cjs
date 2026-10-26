// Preserve each original INITIAL-snapshot missing-vault reference defect.
// Actual backend bytes/revision remain unchanged: v3 rejects the corrupt raw
// projection before a reference decoder or any mutation can gain authority.
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
const missingReference = 'missing-vault-reference';
let server;
beforeEach(async () => { server = await createProtectedServer(); scope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; scope.server = undefined; });
after(() => Realm.shutdown());
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

for (const operation of operationNames) nodeTest(
  `${operation}: missing vault reference in the real initial snapshot cannot authorize any mutation or receipt replay`,
  { timeout: 30_000 }, async t => {
    const f = await scope.setup(t, operation);
    const request = await scope.committedRequest(f, operation);
    assert.equal(request.receipt.committed, true);
    const base = request.receipt.intent.protectedBase;
    const local = await f.repair.captureBackupImage();
    const app = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
    // Actual explicit Delete preparation completes before fault admission.
    server.clearTrace();
    let originalSnapshot, injectedSnapshot, initialFaults = 0;
    server.armFault({ path: '/backup/v3/snapshot', mutateReply(value) {
      originalSnapshot = plain(value);
      injectedSnapshot = { ...value, appImage: { ...value.appImage,
        vaults: [...value.appImage.vaults, missingReference] } };
      initialFaults += 1;
      return injectedSnapshot;
    } });
    const result = await request.invoke();
    assert.equal(initialFaults, 1, 'Exactly the actual initial signed snapshot response must receive the missing reference');
    assert.deepEqual(server.trace.map(event => [event.path, event.status]), [['/backup/v3/snapshot', 200]]);
    assert.equal(writes().length, 0);
    assert.equal(originalSnapshot.namespaceId, base.namespaceId);
    assert.equal(originalSnapshot.revision, base.revision);
    assert.equal(originalSnapshot.generation, base.generation);
    assert.equal(originalSnapshot.authEpoch, base.authEpoch);
    assert.equal(originalSnapshot.deleted, false);
    assert.deepEqual(originalSnapshot, plain(f.initialRemote.snapshot),
      'The unmodified actual initial reply must be the fully verified original protected snapshot');
    assert.equal(originalSnapshot.appImage.vaults.includes(missingReference), false);
    assert.equal(originalSnapshot.allVaultImages.some(value => value.vaultId === missingReference), false);
    assert.deepEqual(injectedSnapshot.appImage.vaults, [...originalSnapshot.appImage.vaults, missingReference]);
    assert.equal(injectedSnapshot.revision, originalSnapshot.revision, 'Never forge a matching revision to bypass raw snapshot integrity');
    assert.notEqual(result.updated, true);
    assert.notEqual(result.backupConfirmed, true);
    scope.assertPending(f);
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), app);
    assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
    if (operation === 'deleteVaults') assert.ok(f.dbManager.getObjectById(f.RealmSchema.Vault, 'retained-vault'));

    const beforeReplay = server.trace.length;
    assert.notEqual((await request.invoke()).backupConfirmed, true);
    assert.equal(server.trace.length, beforeReplay, 'Old rejected receipt cannot read, enroll, repair or replay');
    const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
    assert.equal(remote.state, 'present', 'An invalid initial snapshot cannot authorize even an old explicit Delete');
    assert.deepEqual(plain(remote.snapshot), originalSnapshot);
    assert.deepEqual(plain(remote.snapshot), plain(f.initialRemote.snapshot),
      'Only the earlier proxy reply changed; the complete actual backend copy remains untouched');
    const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
      remote.namespaceId, () => {}, true);
    assert.equal(await f.image.compareImages(f.initialImage, decoded), 'matched');
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), app);
    const afterReadback = server.trace.length;
    assert.notEqual((await request.invoke()).backupConfirmed, true);
    assert.equal(server.trace.length, afterReadback, 'Independent valid readback cannot renew the old receipt authority');
    assert.equal(writes().length, 0);
    scope.assertPending(f);
  });
