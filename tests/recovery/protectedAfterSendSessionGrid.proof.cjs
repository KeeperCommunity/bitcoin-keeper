// A real committed ACK remains held across an actual distinct-key account B
// enrollment and A return. Old-session completion may change neither account UI.
// Genuine native Realm, original queue, signing, crypto and backend remain real.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bip39 = require('bip39');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const mnemonicB = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
assert.equal(bip39.validateMnemonic(mnemonicB), true);
const seed = bip39.mnemonicToSeedSync(mnemonic), seedB = bip39.mnemonicToSeedSync(mnemonicB);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const appIdB = crypto.createHash('sha256').update(seedB).digest('hex');
assert.notEqual(appId, appIdB);
assert.equal(seedB.length, 64);
const tick = () => new Promise(resolve => setImmediate(resolve));
function barrier() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
const builders = { assert };
evaluate(declarations('tests/recovery/automaticWriteRealmRelay.integration.cjs', [
  'wallet', 'signer', 'vault', 'persist', 'persistVault', 'vaultBody', 'labelBody', 'operations', 'accountBackupFlags',
]), builders, 'unchanged-disposable-operation-and-full-account-flag-builders.ts');
const { operations, wallet, persist, persistVault, accountBackupFlags } = builders;
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
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

async function setup(t, operation) {
  await server.reset();
  const f = await fixtureScope.client(t);
  operations[operation].prepare(f);
  persist(f, f.RealmSchema.Wallet, wallet(f, 'retained-wallet', 'Retained account A recovery record'));
  if (operation === 'deleteVaults') persistVault(f, 'retained-vault');
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
  await tick();
  assert.equal(await f.sagas.run('runBackupInspection', true, appId, true), true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], false);
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[appId], true);
  return f;
}

for (const operation of operationNames) nodeTest(
  `${operation}: held old A ACK across genuine distinct-key B enrollment and A return preserves both account sessions`,
  { timeout: 30_000 }, async t => {
    const f = await setup(t, operation);
    const prepared = await fixtureScope.committedRequest(f, operation);
    const expectedA = await f.repair.captureBackupImage();
    const appA = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
    const originalSession = f.transport.currentBackupAccountSession();
    const base = prepared.receipt.intent.protectedBase;
    server.clearTrace();
    const held = barrier(), release = barrier();
    t.after(release.release);
    let actualAck, settled = false;
    server.armFault({ path: '/backup/v3/mutate', operation, beforeReply({ body }) {
      actualAck = plain(body); held.release(); return release.promise;
    } });
    const writing = prepared.invoke().then(value => { settled = true; return value; }, error => {
      settled = true; return { updated: false, failure: error.name };
    });
    let result, expectedB, remoteB, appB, newAFlags, unchangedBFlags, actionBoundary;
    try {
      assert.equal(await Promise.race([held.promise.then(() => true), writing.then(() => false)]), true);
      assert.equal(settled, false);
      ackScope.assertOriginalPositiveAck(actualAck, base, operation);
      assert.equal(writes().length, 1);
      assert.equal(writes()[0].committed, true);
      await f.selectAccount(appIdB);
      assert.equal(f.selected(), appIdB);
      assert.equal(f.dbManager.updateObjectById(f.RealmSchema.KeeperApp, appIdB, {
        primarySeed: seedB.toString('hex'), primaryMnemonic: mnemonicB, publicId: 'distinct-key-public-account-b',
        imageEncryptionKey: f.encryption.generateEncryptionKey(seedB.toString('hex')),
      }), true);
      persist(f, f.RealmSchema.Wallet, wallet(f, 'distinct-account-b-wallet', 'A separate account B record'));
      appB = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
      assert.notEqual(appB.primarySeed, appA.primarySeed);
      assert.equal(appB.primarySeed, seedB.toString('hex'));
      assert.equal(appB.primaryMnemonic, mnemonicB);
      f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: appIdB, enabled: true }));
      assert.equal(await f.sagas.run('runBackupInspection', true, appIdB, true), true,
        'B must gain its own genuine encrypted namespace, signed backup and UI proof');
      assert.equal(f.automatic.isBackupVerificationCurrent(appIdB), true);
      expectedB = await f.repair.captureBackupImage();
      remoteB = await f.protected.readProtectedBackup(mnemonicB, undefined, appIdB);
      assert.equal(remoteB.state, 'present');
      assert.notEqual(remoteB.namespaceId, base.namespaceId);
      const decodedB = await f.image.decodeImage(f.encryption.generateEncryptionKey(seedB.toString('hex')),
        remoteB.snapshot, remoteB.namespaceId, () => {}, true);
      assert.equal(await f.image.compareImages(expectedB, decodedB), 'matched');
      assert.equal(decodedB.wallets['distinct-account-b-wallet'].presentationData.name, 'A separate account B record');
      await f.selectAccount(appId);
      assert.equal(f.selected(), appId);
      assert.ok(f.transport.currentBackupAccountSession() > originalSession);
      newAFlags = plain(accountBackupFlags(f, appId));
      unchangedBFlags = plain(accountBackupFlags(f, appIdB));
      assert.equal(settled, false, 'All distinct-key B setup and A return finish while actual old ACK remains held');
      actionBoundary = f.actions.length;
    } finally {
      release.release();
      result = await writing;
    }
    assert.notEqual(result.backupConfirmed, true);
    const ownWrites = writes().filter(event => event.namespaceId === base.namespaceId);
    assert.equal(ownWrites.length, 1);
    assert.equal(ownWrites[0].committed, true);
    assert.equal(ownWrites[0].expectedRevision, base.revision);
    assert.equal(ownWrites[0].expectedGeneration, base.generation);
    assert.equal(ownWrites[0].authEpoch, base.authEpoch);
    ackScope.assertPending(f);
    assert.deepEqual(plain(accountBackupFlags(f, appId)), newAFlags, 'Old completion cannot change new-session A UI');
    assert.deepEqual(plain(accountBackupFlags(f, appIdB)), unchangedBFlags, 'Old A completion cannot change B UI');
    assert.equal(f.actions.slice(actionBoundary).some(action => action.type === f.bhr.commitBackupInspection.type), false);
    assert.equal(await f.image.compareImages(expectedA, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), appA);
    const remoteA = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
    assert.equal(remoteA.state, operation === 'deleteBackup' ? 'deleted' : 'present');
    assert.equal(remoteA.snapshot.revision, actualAck.newRevision);
    if (operation !== 'deleteBackup') {
      const decodedA = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remoteA.snapshot,
        remoteA.namespaceId, () => {}, true);
      assert.equal(await f.image.compareImages(expectedA, decodedA), 'matched');
    } else assert.equal(remoteA.snapshot.suppressLegacyFallback, true);
    const finalRemoteB = await f.protected.readProtectedBackup(mnemonicB, undefined, appIdB);
    assert.equal(finalRemoteB.state, 'present');
    assert.deepEqual(plain(finalRemoteB.snapshot), plain(remoteB.snapshot));
    const finalDecodedB = await f.image.decodeImage(f.encryption.generateEncryptionKey(seedB.toString('hex')),
      finalRemoteB.snapshot, finalRemoteB.namespaceId, () => {}, true);
    assert.equal(await f.image.compareImages(expectedB, finalDecodedB), 'matched');
    const beforeReplay = server.trace.length;
    const replay = await prepared.invoke();
    assert.notEqual(replay.backupConfirmed, true);
    assert.equal(server.trace.length, beforeReplay, 'Old A receipt cannot read, enroll, repair or replay in the new A session');
    await f.selectAccount(appIdB);
    assert.equal(await f.image.compareImages(expectedB, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), appB);
    assert.equal(writes().filter(event => event.namespaceId === base.namespaceId).length, 1);
  });
