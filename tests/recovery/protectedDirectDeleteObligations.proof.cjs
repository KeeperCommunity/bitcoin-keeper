// Original specific Delete worker/direct-wrapper/consent windows. Real receipts,
// native data, origin middleware, CAS and completion remain unchanged.
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
function barrier() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
async function observe(request) { try { return await request.invoke(); } catch (error) { return { failure: error.name }; } }
async function deletedAndRetained(f) {
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].operation, 'deleteBackup');
  assert.equal(writes()[0].committed, true);
  assert.equal(writes()[0].status, 200);
  const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(remote.state, 'deleted');
  assert.equal(remote.snapshot.suppressLegacyFallback, true);
  assert.equal(remote.snapshot.revision, writes()[0].serverRevision);
  assert.equal(remote.snapshot.generation, writes()[0].serverGeneration);
  assert.equal(remote.snapshot.authEpoch, writes()[0].serverAuthEpoch);
  const image = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
    remote.namespaceId, () => {}, true);
  assert.ok(Object.values(image).every(records => Object.keys(records).length === 0));
  assert.equal(await f.image.compareImages(f.initialImage, await f.repair.captureBackupImage()), 'matched');
  assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
  assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a'));
  assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
  assert.equal(server.trace.some(event => event.path === '/backup/v3/enroll'), false);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), false);
  return remote;
}
async function noReplay(f, request) {
  const total = server.trace.length;
  assert.notEqual((await observe(request)).backupConfirmed, true);
  assert.equal(server.trace.length, total, 'Old explicit Delete cannot read, enroll, recreate, repair or replay');
}

test('actual Delete worker with consent ON records success while retaining the complete native account and recovery', async t => {
  const f = await scope.setup(t, 'deleteBackup');
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  const worker = f.productionSagas(['currentBackupAppId', 'deleteBackupWorker']);
  assert.equal(await worker.run('deleteBackupWorker', { appId,
    originBackupAccountSession: f.transport.currentBackupAccountSession() }), true);
  assert.equal(f.store.getState().bhr.deleteBackupSuccessByAppId[appId], true);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], false);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], false);
  await deletedAndRetained(f);
});

test('fresh direct public Delete wrapper after saved consent OFF acknowledges its own explicit current scope', async t => {
  const f = await scope.setup(t, 'deleteBackup');
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: false }));
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], false);
  const offEpoch = f.transport.backupConsentEpoch(appId);
  const request = await scope.committedRequest(f, 'deleteBackup');
  assert.equal(request.receipt.committed, true);
  assert.equal(request.receipt.intent.consentEpoch, offEpoch);
  server.clearTrace();
  const result = await request.invoke();
  assert.equal(result.updated, true);
  assert.equal(result.backupConfirmed, true);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], false);
  await deletedAndRetained(f);
  await noReplay(f, request);
});

test('held real direct Delete ACK cannot overwrite the later actual OFF to ON choice', async t => {
  const f = await scope.setup(t, 'deleteBackup');
  const request = await scope.committedRequest(f, 'deleteBackup');
  const held = barrier(), release = barrier();
  t.after(release.release);
  let ack, settled = false;
  server.clearTrace();
  server.armFault({ path: '/backup/v3/mutate', operation: 'deleteBackup', beforeReply({ body }) {
    ack = plain(body); held.release(); return release.promise;
  } });
  const writing = observe(request).finally(() => { settled = true; });
  let result;
  try {
    assert.equal(await Promise.race([held.promise.then(() => true), writing.then(() => false)]), true);
    assert.equal(settled, false);
    scope.assertOriginalPositiveAck(ack, request.receipt.intent.protectedBase, 'deleteBackup');
    const oldEpoch = f.transport.backupConsentEpoch(appId);
    f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: false }));
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], false);
    f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
    assert.ok(f.transport.backupConsentEpoch(appId) > oldEpoch);
    assert.equal(settled, false, 'Both actual choices finish while old direct acknowledgement remains held');
  } finally { release.release(); result = await writing; }
  assert.notEqual(result.backupConfirmed, true);
  scope.assertPending(f);
  await deletedAndRetained(f);
  await noReplay(f, request);
  scope.assertPending(f);
});

test('reentrant actual newer enable immediately BEFORE final consent-disable dispatch defeats the old direct Delete completion', async t => {
  const f = await scope.setup(t, 'deleteBackup');
  const request = await scope.committedRequest(f, 'deleteBackup');
  let changed = false, beforeDisableWasOn = false, observedNewerEpoch = false;
  f.setBeforeDispatch(action => {
    if (!changed && action.type === f.bhr.setAutomaticCloudBackup.type && action.payload?.enabled === false) {
      changed = true;
      beforeDisableWasOn = f.store.getState().bhr.automaticCloudBackupByAppId[appId] === true;
      const oldEpoch = f.transport.backupConsentEpoch(appId);
      f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
      observedNewerEpoch = f.transport.backupConsentEpoch(appId) > oldEpoch;
    }
  });
  t.after(() => f.setBeforeDispatch(undefined));
  server.clearTrace();
  const result = await observe(request);
  assert.equal(changed, true, 'The actual final consent-disable dispatch must reach the original pre-dispatch checkpoint');
  assert.equal(beforeDisableWasOn, true);
  assert.equal(observedNewerEpoch, true);
  assert.notEqual(result.backupConfirmed, true);
  scope.assertPending(f);
  await deletedAndRetained(f);
  await noReplay(f, request);
  scope.assertPending(f);
});
