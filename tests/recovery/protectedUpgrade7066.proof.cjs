// Opt-in disposable upgraded-account witness. Uses production Redux Persist,
// native encrypted Realm, authority, crypto, HTTP and actual protected Relay.
// This host proof does not establish iOS/Android or original-phone acceptance.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test, after } = require('node:test');
const {
  createProtectedServer,
  createProtectedRealmClient,
} = require('./protectedWriteRealmRelay.fixture.cjs');
const { declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const mnemonic =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const builders = { assert };
evaluate(
  declarations('tests/recovery/automaticWriteRealmRelay.integration.cjs', [
    'wallet',
    'signer',
    'vault',
    'persist',
    'persistVault',
  ]),
  builders,
  'disposable-upgrade-builders.ts'
);
after(() => Realm.shutdown());

test('existing legacy account with saved consent can explicitly create, recheck and delete only its protected copy', async (t) => {
  const server = await createProtectedServer();
  t.after(() => server.close());
  const f = await createProtectedRealmClient(server.url, {
    appId,
    primarySeed: seed.toString('hex'),
    primaryMnemonic: mnemonic,
    persistedRedux: true,
  });
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  builders.persist(
    f,
    f.RealmSchema.Wallet,
    builders.wallet(f, 'upgraded-wallet', 'Disposable old wallet')
  );
  builders.persist(f, f.RealmSchema.Signer, builders.signer(f));
  builders.persistVault(f, 'upgraded-vault');
  const localBefore = await f.repair.captureBackupImage();
  f.nativeRealm().write(() => {
    f.nativeRealm().objectForPrimaryKey(f.RealmSchema.KeeperApp, appId).version = '2.6.3';
  });
  await server.seedLegacy(await f.payloadForCurrentImage());
  const legacy = server.backend.mongoose.connection.db.collection('appimages');
  const legacyBefore = await legacy.findOne({ appId });
  // An actual cold Redux Persist boot preserves old consent but expires saved
  // Verified state. The installed upgrade keeps all existing local records.
  await f.rehydratePersistedRedux({
    root: { storage: { appId }, _persist: { version: 4, rehydrated: true } },
    bhr: {
      automaticCloudBackupByAppId: { [appId]: true },
      backupRepairStateByAppId: { [appId]: 'verified' },
      backupRepairCompletedByAppId: { [appId]: true },
      _persist: { version: -1, rehydrated: true },
    },
  });
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[appId], 'unverified');
  f.nativeRealm().write(() => {
    f.nativeRealm().objectForPrimaryKey(f.RealmSchema.KeeperApp, appId).version = '2.6.4';
  });
  const sagas = f.productionSagas([
    'currentBackupAppId',
    'backupInspectionOwners',
    'runBackupInspection',
    'deleteBackupWorker',
  ]);
  const inspect = (repair) => sagas.run('runBackupInspection', repair, appId, true);
  const read = () =>
    f.protected.readProtectedBackup(
      mnemonic,
      undefined,
      appId,
      undefined,
      plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp))
    );
  server.clearTrace();
  assert.equal(await inspect(false), false);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[appId], 'never-enrolled');
  assert.deepEqual(
    server.trace.map((entry) => entry.path),
    ['/backup/v3/snapshot']
  );
  assert.equal(await sagas.run('deleteBackupWorker', { appId }), false);
  assert.equal(f.transport.getBackupDiagnostic(appId).category, 'never-enrolled');
  assert.equal(f.store.getState().bhr.deleteBackupSuccessByAppId[appId], false);
  assert.ok(server.trace.every((entry) => entry.path === '/backup/v3/snapshot'));
  assert.equal(
    await f.image.compareImages(localBefore, await f.repair.captureBackupImage()),
    'matched'
  );
  // Upgrade-specific failure witness: enrollment commits, but its reply is
  // interrupted. The existing account stays unverified with all data/consent
  // intact; repeated Check Again remains read-only and cannot finish backup.
  server.armFault({ path: '/backup/v3/enroll', mode: 'lost-reply' });
  assert.equal(await inspect(true), false);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[appId], 'unverified');
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  assert.equal(
    await f.image.compareImages(localBefore, await f.repair.captureBackupImage()),
    'matched'
  );
  assert.deepEqual(await legacy.findOne({ appId }), legacyBefore);
  assert.equal(server.trace.filter((entry) => entry.path === '/backup/v3/mutate').length, 0);
  server.clearTrace();
  assert.equal(await inspect(false), false);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[appId], 'different');
  assert.ok(server.trace.every((entry) => entry.path === '/backup/v3/snapshot'));
  // Back Up Now is the separate affirmative repair action. Check Again above
  // never enrolls/uploads, even with saved automatic consent enabled.
  server.clearTrace();
  assert.equal(await inspect(true), true);
  assert.ok(server.trace.every((entry) => entry.path !== '/backup/v3/enroll'));
  assert.deepEqual(
    server.trace
      .filter((entry) => entry.path === '/backup/v3/mutate')
      .map((entry) => entry.operation),
    ['repairAppBackup']
  );
  const protectedCopy = await read();
  assert.equal(protectedCopy.state, 'present');
  const decoded = await f.image.decodeImage(
    f.encryption.generateEncryptionKey(f.seed),
    protectedCopy.snapshot,
    protectedCopy.namespaceId,
    () => {},
    true
  );
  assert.equal(await f.image.compareImages(localBefore, decoded), 'matched');
  assert.deepEqual(await legacy.findOne({ appId }), legacyBefore);
  server.clearTrace();
  assert.equal(await inspect(false), true);
  assert.ok(server.trace.every((entry) => entry.path === '/backup/v3/snapshot'));
  // Stopping automatic backup retains both copies. A separate explicit delete
  // obtains a fresh authenticated tuple and confirms its protected tombstone.
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: false }));
  assert.equal((await read()).state, 'present');
  assert.deepEqual(await legacy.findOne({ appId }), legacyBefore);
  assert.equal(await sagas.run('deleteBackupWorker', { appId }), true);
  assert.equal((await read()).state, 'deleted');
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], false);
  assert.equal(
    await f.image.compareImages(localBefore, await f.repair.captureBackupImage()),
    'matched'
  );
  assert.deepEqual(await legacy.findOne({ appId }), legacyBefore);
  assert.equal(await inspect(true), true);
  assert.equal((await read()).state, 'present');
  assert.deepEqual(await legacy.findOne({ appId }), legacyBefore);
});
