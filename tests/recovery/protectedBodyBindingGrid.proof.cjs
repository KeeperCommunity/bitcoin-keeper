// Every remaining operation must bind submitted ciphertext/deletion target to
// the genuine committed native receipt. Existing FULL wallet case is not repeated.
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
const operationNames = ['migrateXfps', 'deleteAppImageEntity', 'deleteVaults',
  'updateVaultImage', 'modifyLabels', 'deleteBackup'];
assert.deepEqual(Object.keys(builders.operations).filter(name => name !== 'updateAppImage'), operationNames);
let server;
beforeEach(async () => { server = await createProtectedServer(); scope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; scope.server = undefined; });
after(() => Realm.shutdown());

for (const operation of operationNames) nodeTest(
  `${operation}: genuine receipt cannot authorize uncommitted ciphertext or a mismatched deletion target`,
  { timeout: 30_000 }, async t => {
    const f = await scope.setup(t, operation);
    const request = await scope.committedRequest(f, operation);
    assert.equal(request.receipt.committed, true);
    assert.ok(request.receipt.intent?.protectedBase);
    const local = await f.repair.captureBackupImage();
    const key = f.encryption.generateEncryptionKey(f.seed);
    let altered = false;
    async function staleCipher(cipher, change, field, expected) {
      const value = await f.image.decryptRecord(key, cipher);
      change(value);
      const encrypted = await f.image.encryptRecord(key, value);
      const observed = await f.image.decryptRecord(key, encrypted);
      assert.equal(field(observed), expected, 'Actual submitted ciphertext must contain the deliberate uncommitted value');
      altered = true;
      return encrypted;
    }
    if (operation === 'migrateXfps') request.body.signerChanges[0].newSignerDetails = await staleCipher(
      request.body.signerChanges[0].newSignerDetails, value => { value.signerName = 'Uncommitted action data'; },
      value => value.signerName, 'Uncommitted action data');
    if (operation === 'deleteAppImageEntity') {
      assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
      request.body.walletIds = ['retained-wallet'];
      altered = request.body.walletIds[0] === 'retained-wallet';
    }
    if (operation === 'deleteVaults') {
      assert.ok(f.dbManager.getObjectById(f.RealmSchema.Vault, 'retained-vault'));
      request.body.vaults = ['retained-vault'];
      altered = request.body.vaults[0] === 'retained-vault';
    }
    if (operation === 'updateVaultImage') request.body.vault = await staleCipher(request.body.vault,
      value => { value.presentationData.name = 'Uncommitted action data'; },
      value => value.presentationData.name, 'Uncommitted action data');
    if (operation === 'modifyLabels') request.body.addLabels[0].content = await staleCipher(
      request.body.addLabels[0].content, value => { value.label = 'Uncommitted action data'; },
      value => value.label, 'Uncommitted action data');
    if (operation === 'deleteBackup') {
      request.body.appId = 'different-disposable-account';
      altered = request.body.appId !== appId;
    }
    assert.equal(altered, true);
    // Real Delete preparation is completed before measuring this rejected request.
    server.clearTrace();
    const result = await request.invoke();
    assert.notEqual(result.updated, true);
    assert.notEqual(result.backupConfirmed, true);
    assert.equal(server.trace.filter(event => event.path === '/backup/v3/mutate').length, 0);
    assert.equal(server.trace.length, operation === 'deleteBackup' ? 0 : 1);
    if (operation !== 'deleteBackup') {
      assert.equal(server.trace[0].path, '/backup/v3/snapshot');
      assert.equal(server.trace[0].status, 200);
    }
    scope.assertPending(f);
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
    assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
    const beforeReplay = server.trace.length;
    const replay = await request.invoke();
    assert.notEqual(replay.backupConfirmed, true);
    assert.equal(server.trace.length, beforeReplay, 'Invalidated receipt cannot read, enroll, repair or replay');
    const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
    assert.equal(remote.state, 'present');
    assert.deepEqual(plain(remote.snapshot), plain(f.initialRemote.snapshot));
    const decoded = await f.image.decodeImage(key, remote.snapshot, remote.namespaceId, () => {}, true);
    assert.equal(await f.image.compareImages(f.initialImage, decoded), 'matched');
    assert.equal(server.trace.filter(event => event.path === '/backup/v3/mutate').length, 0);
    scope.assertPending(f);
  });
