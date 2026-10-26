// Real native local-operation proof boundaries. No uncommitted transaction,
// caller boolean or copied operation can mint authority; real rollback retained.
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
let server;
beforeEach(async () => { server = await createProtectedServer(); scope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; scope.server = undefined; });
after(() => Realm.shutdown());
const test = (name, body) => nodeTest(name, { timeout: 30_000 }, body);

async function unchanged(f) {
  assert.equal(server.trace.length, 0, 'Local proof rejection sends no HTTP of any kind');
  assert.equal(await f.image.compareImages(f.initialImage, await f.repair.captureBackupImage()), 'matched');
  assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a').presentationData.name, 'Initial wallet');
  assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
  const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(remote.state, 'present');
  assert.deepEqual(plain(remote.snapshot), plain(f.initialRemote.snapshot));
  const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
    remote.namespaceId, () => {}, true);
  assert.equal(await f.image.compareImages(f.initialImage, decoded), 'matched');
  assert.equal(server.trace.filter(event => event.path === '/backup/v3/mutate').length, 0);
}

test('uncommitted real native image and caller boolean cannot mint a branded committed-generation proof', async t => {
  const f = await scope.setup(t, 'updateAppImage');
  const op = f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId),
    f.transport.currentBackupAccountSession());
  let observedInside, stagedTag = false;
  assert.throws(() => f.nativeRealm().write(() => {
    f.nativeRealm().create('Tags', f.defaults(f.RealmSchema.Tags, {
      id: 'uncommitted-tag', type: 'TX', ref: 'pending', label: 'Must roll back',
    }));
    stagedTag = f.nativeRealm().objectForPrimaryKey('Tags', 'uncommitted-tag')?.label === 'Must roll back';
    observedInside = f.transport.captureBackupWriteIntent(appId);
    assert.throws(() => f.automatic.beginBackupLocalOperation(appId, observedInside));
    throw new Error('Deliberate rollback');
  }), /Deliberate rollback/);
  assert.equal(stagedTag, true);
  assert.equal(observedInside, undefined);
  assert.equal(f.nativeRealm().objectForPrimaryKey('Tags', 'uncommitted-tag'), null);
  const forgedCompletion = f.automatic.completeBackupLocalOperation(op, true);
  assert.equal(forgedCompletion.committed, false);
  assert.equal(forgedCompletion.intent, undefined);
  await unchanged(f);
});

test('actual selected-account switch inside final native transaction rolls back the complete local operation', async t => {
  const f = await scope.setup(t, 'updateAppImage');
  const before = plain(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a'));
  const op = f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId),
    f.transport.currentBackupAccountSession());
  const originalSession = f.transport.currentBackupAccountSession();
  let stagedMutation = false, selectedSwitch = false;
  const receipt = f.automatic.commitBackupLocalOperation(op, realm => {
    builders.operations.updateAppImage.mutate(realm, f);
    stagedMutation = realm.objectForPrimaryKey('Wallet', 'wallet-a').presentationData.name === 'Committed wallet';
    f.store.dispatch(f.storage.setAppId('different-disposable-account'));
    selectedSwitch = f.store.getState().storage.appId === 'different-disposable-account';
  });
  assert.equal(stagedMutation, true);
  assert.equal(selectedSwitch, true);
  assert.ok(f.transport.currentBackupAccountSession() > originalSession);
  assert.equal(receipt.committed, false);
  assert.equal(receipt.intent, undefined);
  assert.deepEqual(plain(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a')), before);
  await unchanged(f);
});

test('counterfeit local operation cannot enter the native transaction callback or mint an intent', async t => {
  const f = await scope.setup(t, 'updateAppImage');
  const genuine = f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId),
    f.transport.currentBackupAccountSession());
  const copy = { ...genuine };
  assert.notEqual(copy, genuine);
  let entered = false;
  const receipt = f.automatic.commitBackupLocalOperation(copy, realm => {
    entered = true;
    builders.operations.updateAppImage.mutate(realm, f);
  });
  assert.equal(entered, false);
  assert.equal(receipt.committed, false);
  assert.equal(receipt.intent, undefined);
  await unchanged(f);
});
