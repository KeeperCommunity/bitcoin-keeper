// Remaining specific BHR node/alias and final metadata obligations. Actual
// callers, native commits, encryption, signed snapshots and CAS remain genuine.
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
let server;
beforeEach(async () => { server = await createProtectedServer(); scope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; scope.server = undefined; });
after(() => Realm.shutdown());
const test = (name, body) => nodeTest(name, { timeout: 30_000 }, body);
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');
const METADATA_FIELDS = ['publicId', 'version', 'subscription'];
async function actualRead(f) {
  const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(remote.state, 'present');
  const image = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
    remote.namespaceId, () => {}, true);
  return { remote, image };
}
function assertVerified(f) {
  const state = f.store.getState().bhr;
  assert.equal(state.pendingAllBackupByAppId[appId], false);
  assert.equal(state.backupRepairStateByAppId[appId], 'verified');
  assert.equal(state.backupRepairCompletedByAppId[appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), true);
  assert.equal(state.automaticCloudBackupByAppId[appId], true);
}

test('actual BHR node producer backs up its persisted collection then deletes every native and remote node with an exact empty set', async t => {
  const f = await scope.setup(t, 'updateAppImage');
  const producer = f.productionSagas(['currentBackupAppId', 'buildAutomaticAppMutation', 'queueCommittedBackupWorker', 'updateAppImageWorker']);
  const op = f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId),
    f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, realm => realm.create('NodeConnect',
    f.defaults(f.RealmSchema.NodeConnect, { id: 12, host: 'public-disposable-node.invalid', port: '50002',
      useSSL: true, networkType: f.enums.NetworkType.TESTNET })));
  assert.equal(receipt.committed, true);
  assert.ok(receipt.intent?.protectedBase);
  const localWithNode = await f.repair.captureBackupImage();
  assert.equal(localWithNode.nodes['12'].host, 'public-disposable-node.invalid');
  const result = await producer.run('updateAppImageWorker', { payload: { updateNodes: true }, originAppId: appId,
    originBackupAccountSession: f.transport.currentBackupAccountSession(), committedOperation: receipt });
  assert.equal(result.backupConfirmed, true);
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].committed, true);
  assert.equal(writes()[0].replaceNodes, true);
  assert.equal(writes()[0].nodeCount, 1);
  const first = plain(writes()[0]);
  let observed = await actualRead(f);
  assert.equal(observed.image.nodes['12'].host, 'public-disposable-node.invalid');
  assert.equal(await f.image.compareImages(localWithNode, observed.image), 'matched');
  assertVerified(f);
  const deletion = f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId),
    f.transport.currentBackupAccountSession());
  const removed = f.automatic.commitBackupLocalOperation(deletion, realm => realm.delete(realm.objects('NodeConnect')));
  assert.equal(removed.committed, true);
  assert.ok(removed.intent?.protectedBase);
  assert.equal(f.nativeRealm().objects('NodeConnect').length, 0);
  const localEmpty = await f.repair.captureBackupImage();
  assert.deepEqual(Object.keys(localEmpty.nodes), []);
  server.clearTrace();
  const cleared = await producer.run('updateAppImageWorker', { payload: { updateNodes: true }, originAppId: appId,
    originBackupAccountSession: f.transport.currentBackupAccountSession(), committedOperation: removed });
  assert.equal(cleared.backupConfirmed, true);
  assert.equal(writes().length, 1);
  const own = writes()[0];
  assert.equal(own.committed, true);
  assert.equal(own.replaceNodes, true);
  assert.equal(own.nodeCount, 0);
  assert.equal(own.expectedRevision, first.serverRevision);
  assert.equal(own.expectedGeneration, first.serverGeneration);
  assert.equal(own.authEpoch, first.serverAuthEpoch);
  observed = await actualRead(f);
  assert.deepEqual(Object.keys(observed.image.nodes), []);
  assert.equal(await f.image.compareImages(localEmpty, observed.image), 'matched');
  assert.equal(await f.image.compareImages(localEmpty, await f.repair.captureBackupImage()), 'matched');
  assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
  assertVerified(f);
});

test('archive alias without its preceding actual archived ciphertext cannot upload a genuine two-effect native commit', async t => {
  const f = await scope.setup(t, 'updateVaultImage');
  const op = f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId),
    f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, realm => {
    realm.objectForPrimaryKey('Vault', 'vault-a').archived = true;
    realm.create('Vault', builders.vault(f, 'new-vault'), Realm.UpdateMode.Modified);
  });
  assert.equal(receipt.committed, true);
  assert.ok(receipt.intent?.protectedBase);
  const local = await f.repair.captureBackupImage();
  assert.equal(local.vaults['vault-a'].archived, true);
  assert.equal(local.vaults['new-vault'].archived, false);
  const body = await builders.vaultBody(f, 'new-vault');
  body.archiveVaultId = 'vault-a';
  const mutations = [{ operation: 'updateVaultImage', body }];
  assert.equal(mutations.length, 1);
  assert.equal(body.vaultId, 'new-vault');
  const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, mutations);
  assert.notEqual(result.backupConfirmed, true);
  assert.equal(writes().length, 0);
  assert.deepEqual(server.trace.map(event => [event.path, event.status]), [['/backup/v3/snapshot', 200]]);
  scope.assertPending(f);
  assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
  const beforeReplay = server.trace.length;
  assert.notEqual((await f.automatic.enqueueAutomaticBackupOperation(receipt, mutations)).backupConfirmed, true);
  assert.equal(server.trace.length, beforeReplay);
  const { remote, image } = await actualRead(f);
  assert.deepEqual(plain(remote.snapshot), plain(f.initialRemote.snapshot));
  assert.equal(image.vaults['vault-a'].archived, false);
  assert.equal(image.vaults['new-vault'], undefined);
  assert.equal(await f.image.compareImages(f.initialImage, image), 'matched');
  assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
  scope.assertPending(f);
});

for (const field of METADATA_FIELDS) test(
  `single actual update with malformed final ${field} cannot replace current metadata verification`, async t => {
    const f = await scope.setup(t, 'updateAppImage');
    const request = await scope.committedRequest(f, 'updateAppImage');
    const local = await f.repair.captureBackupImage();
    const app = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
    const metadataMatches = f.load('src/services/backup/localSnapshot').backupMetadataMatches;
    const replacement = field === 'subscription' ? '{}' : 'not-the-committed-value';
    let ack, originalFinal, injectedFinal, finalFaults = 0;
    server.armFault({ path: '/backup/v3/mutate', operation: 'updateAppImage', beforeReply({ body }) { ack = plain(body); } });
    server.armFault({ path: '/backup/v3/snapshot', after: 1, mutateReply(value) {
      originalFinal = plain(value);
      injectedFinal = { ...value, appImage: { ...value.appImage, [field]: replacement } };
      finalFaults += 1;
      return injectedFinal;
    } });
    const result = await request.invoke();
    assert.equal(finalFaults, 1);
    scope.assertOriginalPositiveAck(ack, request.receipt.intent.protectedBase, 'updateAppImage');
    assert.equal(Object.hasOwn(originalFinal.appImage, field), true);
    assert.notEqual(originalFinal.appImage[field], replacement);
    assert.equal(injectedFinal.appImage[field], replacement);
    assert.equal(injectedFinal.revision, originalFinal.revision);
    assert.equal(metadataMatches(app, originalFinal.appImage, originalFinal.namespaceId), true);
    assert.equal(metadataMatches(app, injectedFinal.appImage, injectedFinal.namespaceId), false,
      'Actual production metadata comparison must independently recognize the selected changed field');
    assert.deepEqual(server.trace.map(event => [event.path, event.status]), [
      ['/backup/v3/snapshot', 200], ['/backup/v3/mutate', 200], ['/backup/v3/snapshot', 200],
    ]);
    assert.equal(writes().length, 1);
    assert.equal(writes()[0].committed, true);
    assert.equal(originalFinal.revision, ack.newRevision);
    assert.notEqual(result.backupConfirmed, true);
    scope.assertPending(f);
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), app);
    const beforeReplay = server.trace.length;
    assert.notEqual((await request.invoke()).backupConfirmed, true);
    assert.equal(server.trace.length, beforeReplay);
    const { remote, image } = await actualRead(f);
    assert.deepEqual(plain(remote.snapshot), originalFinal);
    assert.equal(await f.image.compareImages(local, image), 'matched');
    assert.equal(writes().length, 1);
    scope.assertPending(f);
  });
