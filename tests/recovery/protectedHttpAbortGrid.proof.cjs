// Real HTTP cancellation AFTER actual signed-v3 CAS commit, across every core
// operation. Only the real abort timer is compressed; the reply is held until
// actual Axios cancellation. No timeout/error/ACK/backend commit is fabricated.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
function barrier() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
const builders = { assert };
evaluate(declarations('tests/recovery/automaticWriteRealmRelay.integration.cjs', [
  'wallet', 'signer', 'vault', 'persist', 'persistVault', 'vaultBody', 'labelBody', 'operations',
]), builders, 'unchanged-public-disposable-operation-builders.ts');
const { operations, wallet, persist, persistVault } = builders;
const operationNames = ['updateAppImage', 'migrateXfps', 'deleteAppImageEntity', 'deleteVaults',
  'updateVaultImage', 'modifyLabels', 'deleteBackup'];
assert.deepEqual(Object.keys(operations), operationNames);
const fixtureScope = { assert, createProtectedRealmClient, mnemonic, seed, appId, operations };
evaluate(declarations('tests/recovery/protectedWriteRealmRelay.proof.cjs', ['client', 'committedRequest']),
  fixtureScope, 'unchanged-real-protected-client-and-receipt-helpers.ts');
const ackScope = { assert, appId };
evaluate(declarations('tests/recovery/protectedAcknowledgementGrid.proof.cjs', ['assertOriginalPositiveAck', 'assertPending']),
  ackScope, 'unchanged-positive-ack-and-full-pending-assertions.ts');
let server;
beforeEach(async () => { server = await createProtectedServer(); fixtureScope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; fixtureScope.server = undefined; });
after(() => Realm.shutdown());
const mutations = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

async function setup(t, operation) {
  await server.reset();
  // Existing fixture option changes setTimeout delay only. Date/deadlines,
  // signature/crypto, real requests, abort controller and queue stay unchanged.
  const f = await fixtureScope.client(t, { backupTimerCeilingMs: 1000 });
  operations[operation].prepare(f);
  persist(f, f.RealmSchema.Wallet, wallet(f, 'retained-wallet', 'Retained local recovery record'));
  if (operation === 'deleteVaults') persistVault(f, 'retained-vault');
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
  await tick();
  assert.equal(await f.sagas.run('runBackupInspection', true, appId, true), true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], false);
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), true);
  assert.ok(f.transport.captureBackupWriteIntent(appId)?.protectedBase);
  return f;
}

for (const operation of operationNames) nodeTest(
  `${operation}: a genuine held committed HTTP reply is aborted and cannot confirm, opt out or replay`,
  { timeout: 30_000 }, async t => {
    const f = await setup(t, operation);
    const request = await fixtureScope.committedRequest(f, operation);
    const base = request.receipt.intent.protectedBase;
    const localImage = await f.repair.captureBackupImage();
    const appBefore = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
    server.clearTrace();
    const held = barrier(), release = barrier();
    t.after(release.release);
    let originalAck, actualSignal, abortEvents = 0, axiosFailure, boundedFailure;
    // Observe the original production RestClient, preserving every argument,
    // actual AbortSignal, return and error. Nothing supplies an Axios response.
    const rest = f.load('src/services/rest/RestClient').default;
    const originalPost = rest.post;
    rest.post = async function (...args) {
      if (new URL(args[0]).pathname !== '/backup/v3/mutate') return originalPost.apply(this, args);
      actualSignal = args[3]?.signal;
      assert.ok(actualSignal);
      assert.equal(actualSignal.aborted, false);
      actualSignal.addEventListener('abort', () => { abortEvents++; }, { once: true });
      try { return await originalPost.apply(this, args); }
      catch (error) { axiosFailure = { name: error.name, code: error.code }; throw error; }
    };
    const boundedPost = f.transport.boundedBackupPost;
    f.transport.boundedBackupPost = async function (...args) {
      try { return await boundedPost.apply(this, args); }
      catch (error) {
        if (new URL(args[0]).pathname === '/backup/v3/mutate') boundedFailure = { name: error.name, category: error.category };
        throw error;
      }
    };
    t.after(() => { rest.post = originalPost; f.transport.boundedBackupPost = boundedPost; });
    server.armFault({ path: '/backup/v3/mutate', operation, beforeReply({ body, event }) {
      originalAck = plain(body);
      assert.equal(event.status, 200);
      assert.equal(event.committed, true);
      held.release();
      return release.promise;
    } });
    let settled = false;
    const writing = request.invoke().then(value => { settled = true; return value; }, error => {
      settled = true; return { updated: false, failure: error.name };
    });
    let result;
    try {
      const reachedCommit = await Promise.race([held.promise.then(() => true), writing.then(() => false)]);
      assert.equal(reachedCommit, true, 'Actual operation must reach the held real committed ACK before settling');
      assert.equal(settled, false, 'The actual committed ACK is still held before transport cancellation');
      assert.ok(actualSignal);
      assert.equal(actualSignal.aborted, false);
      ackScope.assertOriginalPositiveAck(originalAck, base, operation);
      result = await writing;
      // The real abort event AND actual Axios cancellation are required. A
      // thrown callback, fabricated timeout or early local guard cannot pass.
      assert.equal(actualSignal.aborted, true);
      assert.equal(abortEvents, 1);
      assert.equal(axiosFailure?.name, 'CanceledError');
      assert.equal(axiosFailure?.code, 'ERR_CANCELED');
      assert.equal(boundedFailure?.name, 'Error');
      assert.equal(boundedFailure?.category, 'timeout');
      assert.notEqual(result.updated, true);
      assert.notEqual(result.backupConfirmed, true);
      ackScope.assertPending(f);
      assert.equal(mutations().length, 1);
      const own = mutations()[0];
      assert.equal(own.committed, true);
      assert.equal(own.operation, operation);
      assert.equal(own.namespaceId, base.namespaceId);
      assert.equal(own.expectedRevision, base.revision);
      assert.equal(own.expectedGeneration, base.generation);
      assert.equal(own.authEpoch, base.authEpoch);
      assert.equal(await f.image.compareImages(localImage, await f.repair.captureBackupImage()), 'matched');
      assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), appBefore);
      assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
    } finally {
      release.release();
      await writing;
    }
    await tick();
    const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
    assert.equal(remote.state, operation === 'deleteBackup' ? 'deleted' : 'present');
    assert.equal(remote.snapshot.revision, originalAck.newRevision);
    assert.equal(remote.snapshot.generation, originalAck.newGeneration);
    assert.equal(remote.snapshot.authEpoch, originalAck.authEpoch);
    const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot, remote.namespaceId, () => {}, true);
    if (operation === 'deleteBackup') {
      assert.equal(remote.snapshot.suppressLegacyFallback, true);
      assert.equal(Object.keys(decoded.wallets).length, 0);
      assert.equal(Object.keys(decoded.signers).length, 0);
      assert.equal(Object.keys(decoded.vaults).length, 0);
      assert.equal(Object.keys(decoded.labels).length, 0);
      assert.equal(Object.keys(decoded.nodes).length, 0);
    } else assert.equal(await f.image.compareImages(localImage, decoded), 'matched');
    ackScope.assertPending(f);
    const beforeReplay = server.trace.length;
    const replay = await request.invoke();
    assert.notEqual(replay.backupConfirmed, true);
    assert.equal(server.trace.length, beforeReplay, 'Consumed uncertain receipt cannot read, enroll, repair or replay');
    assert.equal(mutations().length, 1);
    ackScope.assertPending(f);
  });
