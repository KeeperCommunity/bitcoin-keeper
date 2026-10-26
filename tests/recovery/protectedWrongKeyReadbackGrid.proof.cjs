// Corrupt only the FINAL real snapshot after an actual committed positive ACK.
// Its original revision is preserved: signed-v3 integrity rejects the changed
// encrypted record before AES decryption; Delete rejects nonempty tombstones.
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
evaluate(declarations('tests/recovery/protectedAcknowledgementGrid.proof.cjs', ['assertOriginalPositiveAck']),
  scope, 'unchanged-full-positive-ack-contract.ts');
const operationNames = ['updateAppImage', 'migrateXfps', 'deleteAppImageEntity', 'deleteVaults',
  'updateVaultImage', 'modifyLabels', 'deleteBackup'];
assert.deepEqual(Object.keys(builders.operations), operationNames);
let server;
beforeEach(async () => { server = await createProtectedServer(); scope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; scope.server = undefined; });
after(() => Realm.shutdown());
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

for (const operation of operationNames) nodeTest(
  `${operation}: wrong-key ciphertext in the real final snapshot cannot verify an acknowledged commit or replay its receipt`,
  { timeout: 30_000 }, async t => {
    const f = await scope.setup(t, operation);
    const request = await scope.committedRequest(f, operation);
    assert.equal(request.receipt.committed, true);
    const base = request.receipt.intent.protectedBase;
    const local = await f.repair.captureBackupImage();
    const app = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
    const key = f.encryption.generateEncryptionKey(f.seed);
    const wrongKey = f.encryption.generateEncryptionKey('different-public-fixture-key');
    assert.notEqual(wrongKey, key);
    const wrongRecord = plain(builders.wallet(f, 'retained-wallet'));
    const wrongCipher = await f.image.encryptRecord(wrongKey, wrongRecord);
    assert.deepEqual(plain(await f.image.decryptRecord(wrongKey, wrongCipher)), wrongRecord,
      'The injected ciphertext must genuinely encrypt the original disposable wallet under the different key');

    // Explicit Delete preparation can read before these final-readback faults.
    server.clearTrace();
    let originalAck, ackObserved = false, originalFinal, injectedFinal, finalFaults = 0;
    server.armFault({ path: '/backup/v3/mutate', operation, beforeReply({ body }) {
      originalAck = plain(body); ackObserved = true;
    } });
    server.armFault({ path: '/backup/v3/snapshot', after: 1, mutateReply(value) {
      originalFinal = plain(value);
      injectedFinal = { ...value, appImage: { ...value.appImage,
        wallets: { ...value.appImage.wallets, 'retained-wallet': wrongCipher } } };
      finalFaults += 1;
      return injectedFinal;
    } });
    const result = await request.invoke();
    assert.equal(ackObserved, true);
    scope.assertOriginalPositiveAck(originalAck, base, operation);
    assert.equal(finalFaults, 1, 'The real second snapshot after the acknowledged mutation must receive the fault');
    assert.deepEqual(server.trace.map(event => [event.path, event.status]), [
      ['/backup/v3/snapshot', 200], ['/backup/v3/mutate', 200], ['/backup/v3/snapshot', 200],
    ]);
    assert.equal(writes().length, 1);
    const own = writes()[0];
    assert.equal(own.operation, operation);
    assert.equal(own.committed, true);
    assert.equal(own.namespaceId, base.namespaceId);
    assert.equal(own.expectedRevision, base.revision);
    assert.equal(own.expectedGeneration, base.generation);
    assert.equal(own.authEpoch, base.authEpoch);
    assert.equal(originalFinal.revision, originalAck.newRevision);
    assert.equal(originalFinal.generation, originalAck.newGeneration);
    assert.equal(originalFinal.authEpoch, originalAck.authEpoch);
    assert.equal(injectedFinal.revision, originalFinal.revision, 'Never forge a matching content revision for corrupted ciphertext');
    assert.equal(injectedFinal.appImage.wallets['retained-wallet'], wrongCipher);
    if (operation === 'deleteBackup') assert.deepEqual(originalFinal.appImage.wallets, {});
    else assert.equal(typeof originalFinal.appImage.wallets['retained-wallet'], 'string');
    // A received valid ACK may truthfully leave updated=true while final proof
    // fails. That flag must never substitute for a current verified backup.
    assert.notEqual(result.backupConfirmed, true);
    scope.assertPending(f);
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), app);
    assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
    if (operation === 'deleteVaults') assert.ok(f.dbManager.getObjectById(f.RealmSchema.Vault, 'retained-vault'));

    const beforeReplay = server.trace.length;
    assert.notEqual((await request.invoke()).backupConfirmed, true);
    assert.equal(server.trace.length, beforeReplay, 'Consumed original receipt cannot read, enroll, repair or replay');
    const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
    assert.equal(remote.state, operation === 'deleteBackup' ? 'deleted' : 'present');
    assert.deepEqual(plain(remote.snapshot), originalFinal,
      'The actual backend keeps the full original committed snapshot; only the earlier proxy readback was corrupted');
    const decoded = await f.image.decodeImage(key, remote.snapshot, remote.namespaceId, () => {}, true);
    if (operation === 'deleteBackup') {
      assert.equal(remote.snapshot.suppressLegacyFallback, true);
      assert.ok(Object.values(decoded).every(records => Object.keys(records).length === 0));
    } else assert.equal(await f.image.compareImages(local, decoded), 'matched');
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), app);
    const afterReadback = server.trace.length;
    assert.notEqual((await request.invoke()).backupConfirmed, true);
    assert.equal(server.trace.length, afterReadback, 'Independent genuine readback cannot lend fresh authority to the old receipt');
    assert.equal(writes().length, 1);
    scope.assertPending(f);
  });
