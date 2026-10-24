// Additive signed-v3 launch/history producer proof. Production upgrade/history
// declarations, origin middleware, Redux Persist, encrypted native Realm, AES,
// authority, HTTP and transactional Relay are real. Old version values are only
// disposable current-schema inputs; actual producers perform every upgrade.
// This is neither an authentic historic disk migration nor native UI evidence.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const installedVersion = require('../../package.json').version;
const installedBuild = fs.readFileSync(path.join(__dirname, '../../android/app/build.gradle'), 'utf8')
  .match(/versionCode\s+(\d+)/)[1];
assert.equal(installedVersion, '2.6.4', 'Use the existing R4-derived installation; allocate no R5 version');
assert.equal(installedBuild, '627');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const otherAppId = 'disposable-launch-other-account';
const builders = { assert };
evaluate(declarations('tests/recovery/automaticUpgradeProducer.integration.cjs', ['wallet', 'persistVaults']),
  builders, 'unchanged-disposable-upgrade-input-builders.ts');
let server;
beforeEach(async () => { server = await createProtectedServer(); });
afterEach(async () => { await server?.close(); server = undefined; });
after(() => Realm.shutdown());
const test = (name, run) => nodeTest(name, { timeout: 25_000 }, run);
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');
const historyKey = `${installedVersion}(${installedBuild})`;
const upgradeDeclarations = [
  'LABELS_INTRODUCTION_VERSION', 'BIP329_INTRODUCTION_VERSION', 'KEY_MANAGEMENT_VERSION',
  'APP_KEY_UPGRADE_VERSION', 'HEALTH_CHECK_TIMELINE_MIGRATION_VERSION', 'SIGNER_POLICY_MIGRATION_VERSION',
  'upgradeAccountIsActive', 'beginUpgradeGroup', 'completeUpgradeGroup', 'stageVersionUpdate',
  'updateReleaseTopics', 'observeCurrentVersionHistory', 'applyUpgradeSequence', 'updateVersionHistoryWorker',
  'migrateLablesWorker', 'migrateStructureforSignersInAppImage', 'migrateStructureforVaultInAppImage',
  'updateAppKeysToEnableSigning', 'mapAppKeysToWallets', 'generateExtendedKeysForSigners',
  'updateVaultSigners', 'updateSignerDetails', 'updateSignerXpubs',
  'healthCheckTimelineMigration', 'migrateServerKeyPolicy',
];

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function boundedArrival(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Expected genuine upgrade read boundary was not reached')), 10000);
    })]);
  } finally { clearTimeout(timer); }
}

function assertOwnNextTuple(previous, next) {
  assert.equal(next.namespaceId, previous.namespaceId);
  assert.equal(next.expectedRevision, previous.serverRevision);
  assert.equal(next.expectedGeneration, previous.serverGeneration);
  assert.equal(next.authEpoch, previous.serverAuthEpoch);
}

function assertPending(f) {
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.notEqual(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified');
}

function localUpgradeState(f) {
  return {
    version: f.dbManager.getObjectById(f.RealmSchema.KeeperApp, f.appId).version,
    // VersionHistory's actual primary key is `version`; the generic id helper
    // intentionally cannot query this schema. Read the genuine Realm record.
    history: plain(f.nativeRealm().objectForPrimaryKey(f.RealmSchema.VersionHistory, historyKey)),
    historyCount: f.dbManager.getCollection(f.RealmSchema.VersionHistory).length,
    tagsCount: f.dbManager.getCollection(f.RealmSchema.Tags).length,
    healthCount: f.dbManager.getCollection(f.RealmSchema.Signer)[0]?.healthCheckDetails.length ?? 0,
    archived: f.dbManager.getObjectById(f.RealmSchema.Vault, 'upgrade-old-vault')?.archived,
  };
}

function assertLocalUpgrade(f, migrated = false, state = localUpgradeState(f)) {
  assert.equal(state.version, installedVersion);
  assert.equal(state.history.title, `Upgraded from ${f.previousVersion} to ${installedVersion}`);
  assert.equal(Number.isNaN(Date.parse(state.history.date)), false);
  assert.equal(state.historyCount, 1);
  if (migrated) {
    assert.equal(state.tagsCount, 1);
    assert.equal(state.healthCount, 1);
    assert.equal(state.archived, true);
  }
}

async function assertConfirmed(f, count) {
  assert.equal(writes().length, count);
  assert.ok(writes().every(event => event.committed));
  const remote = await f.read();
  assert.equal(remote.snapshot.appImage.version, installedVersion);
  assert.equal(remote.snapshot.revision, writes().at(-1).serverRevision);
  assert.equal(remote.snapshot.generation, writes().at(-1).serverGeneration);
  assert.equal(remote.snapshot.authEpoch, writes().at(-1).serverAuthEpoch);
  const image = await f.decode(remote);
  assert.equal(await f.image.compareImages(await f.repair.captureBackupImage(), image), 'matched');
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified');
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[f.appId], true);
  return image;
}

async function assertConsumedNoReplay(f) {
  assert.equal(f.queueCalls.length, 1, 'Capture only the actual producer submission');
  const { receipt, mutations } = f.queueCalls[0];
  assert.equal(receipt.committed, true);
  const count = writes().length;
  const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, mutations);
  assert.notEqual(result.backupConfirmed, true);
  assert.equal(writes().length, count, 'A consumed receipt cannot replay the original ciphertext');
}

async function setup(t, { previousVersion = '2.6.3', migration = false } = {}) {
  await server.reset();
  const f = await createProtectedRealmClient(server.url, {
    appId, primarySeed: seed.toString('hex'), primaryMnemonic: mnemonic, persistedRedux: true,
  });
  t.after(() => f.close());
  f.previousVersion = previousVersion;
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  // Seed a dormant account's INPUT metadata before enrollment or invocation.
  // Never manually advance its version instead of calling the real producer.
  f.nativeRealm().write(() => {
    f.nativeRealm().objectForPrimaryKey(f.RealmSchema.KeeperApp, f.appId).version = previousVersion;
  });
  assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, builders.wallet(f)), true);
  if (migration) {
    builders.persistVaults(f);
    assert.equal(f.dbManager.createObject(f.RealmSchema.UTXOInfo, f.defaults(f.RealmSchema.UTXOInfo, {
      id: 'legacy-utxo', walletId: 'upgrade-wallet', txId: 'public-legacy-tx', vout: 0,
      labels: [f.defaults(f.RealmSchema.Label, { name: 'legacy note', type: 'OUTPUT' })],
    })), true);
  }
  // Ordinary real Redux Persist boot, without substituting REHYDRATE actions.
  // MMKV's host byte adapter is explicit; cold boot race coverage is separate.
  await f.rehydratePersistedRedux({
    root: { storage: { appId: f.appId, appVersion: previousVersion }, _persist: { version: 4, rehydrated: true } },
    bhr: { automaticCloudBackupByAppId: { [f.appId]: true }, _persist: { version: -1, rehydrated: true } },
  });
  assert.equal(f.store.getState().storage.appVersion, previousVersion);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], true);
  f.topics = [];
  const unexpected = () => { throw new Error('Unexpected signer/provider operation in public-only launch fixture'); };
  const sagas = f.productionSagas([
    'currentBackupAppId', 'backupInspectionOwners', 'runBackupInspection',
    'buildAutomaticAppMutation', 'buildAutomaticVaultMutation',
  ], {
    semver: require('semver'), realmDatabase: f.realmDatabase,
    DeviceInfo: { getVersion: () => installedVersion, getBuildNumber: () => installedBuild },
    ...f.load('src/models/interfaces/HeathCheckTypes'),
    // Explicit unrelated Firebase boundary: record requested topics; no provider call.
    getApp: () => ({}), getMessaging: () => ({}),
    subscribeToTopic: (_messaging, topic) => { f.topics.push(['subscribe', topic]); },
    unsubscribeFromTopic: (_messaging, topic) => { f.topics.push(['unsubscribe', topic]); },
    getReleaseTopic: f.load('src/utils/releaseTopic').getReleaseTopic,
    // Original intentionally unspendable public fixture needs only label metadata.
    generateAbbreviatedOutputDescriptors: () => 'disposable-public-upgrade-origin',
    generateExtendedKeysForCosigner: unexpected, SigningServer: { migrateSignerPolicy: unexpected },
    WalletUtilities: { getFingerprintFromExtendedKey: unexpected },
  });
  evaluate(declarations('src/store/sagas/upgrade.ts', upgradeDeclarations), sagas.scope,
    'unchanged-production-launch-history-producers.ts');
  f.sagas = sagas;
  f.queueCalls = [];
  const enqueue = sagas.scope.enqueueAutomaticBackupOperation;
  sagas.scope.enqueueAutomaticBackupOperation = (receipt, mutations) => {
    // Observe exact real arguments and delegate unchanged, including every ACK.
    f.queueCalls.push({ receipt, mutations });
    return enqueue(receipt, mutations);
  };
  assert.equal(await sagas.run('runBackupInspection', true, f.appId, true), true,
    'Only explicit production opt-in enrolls/verifies the protected namespace');
  f.origin = {
    originBackupAccountSession: f.transport.currentBackupAccountSession(),
    originBackupWriteIntent: f.transport.captureBackupWriteIntent(f.appId),
  };
  assert.ok(f.origin.originBackupWriteIntent?.protectedBase);
  f.upgrade = (metadata = {}) => sagas.run('applyUpgradeSequence', {
    previousVersion, newVersion: installedVersion, ...f.origin, ...metadata,
  });
  f.read = async () => {
    const result = await f.protected.readProtectedBackup(mnemonic, undefined, f.appId);
    assert.equal(result.state, 'present');
    return result;
  };
  f.decode = remote => f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    remote.snapshot, remote.namespaceId, () => {}, true);
  f.initial = await f.read();
  assert.equal(f.initial.snapshot.appImage.version, previousVersion);
  server.clearTrace();
  return f;
}

test('actual R4-derived dormant-account launch upgrades Realm and persisted Redux, with truthful idempotent history and signed readback', async t => {
  const f = await setup(t);
  assert.equal(f.sagas.scope.observeCurrentVersionHistory(f.appId, installedVersion, installedBuild), false,
    'An account still at its old version cannot acquire a current-installation observation');
  assert.equal(f.dbManager.getCollection(f.RealmSchema.VersionHistory).length, 0);
  assert.equal(await f.upgrade(), true);
  assertLocalUpgrade(f);
  assert.equal(f.store.getState().storage.appVersion, installedVersion);
  await f.flushPersistedRedux();
  assert.equal(f.readPersistedRedux('root').storage.appVersion, installedVersion);
  assert.deepEqual(f.topics.map(([operation]) => operation), ['unsubscribe', 'subscribe']);
  assert.equal(writes()[0].expectedRevision, f.origin.originBackupWriteIntent.protectedBase.revision);
  assert.equal(writes()[0].expectedGeneration, f.origin.originBackupWriteIntent.protectedBase.generation);
  assert.equal(writes()[0].authEpoch, f.origin.originBackupWriteIntent.protectedBase.authEpoch);
  assert.deepEqual(writes().map(event => event.operation), ['updateAppImage']);
  await assertConfirmed(f, 1);
  const historyBefore = plain(f.nativeRealm().objectForPrimaryKey(f.RealmSchema.VersionHistory, historyKey));
  const traceCount = server.trace.length;
  for (let i = 0; i < 2; i++) assert.equal(f.sagas.scope.observeCurrentVersionHistory(f.appId, installedVersion, installedBuild), true);
  assert.deepEqual(plain(f.nativeRealm().objectForPrimaryKey(f.RealmSchema.VersionHistory, historyKey)), historyBefore);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.VersionHistory).length, 1);
  assert.equal(server.trace.length, traceCount, 'History observation neither uploads nor invents an upgrade');
});

test('actual dispatched current history worker keeps a no-original-base local version/history commit pending with zero HTTP', async t => {
  const f = await setup(t);
  f.transport.clearVerifiedRemoteRevision(f.appId);
  assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
  const action = f.store.dispatch(f.load('src/store/sagaActions/upgrade')
    .updateVersionHistory(f.previousVersion, installedVersion, false, f.appId));
  assert.equal(action.originAppId, f.appId);
  assert.equal(action.originBackupAccountSession, f.transport.currentBackupAccountSession());
  assert.equal(action.originBackupWriteIntent, undefined);
  assert.equal(await f.sagas.run('updateVersionHistoryWorker', action), true);
  assertLocalUpgrade(f);
  assert.equal(server.trace.length, 0, 'Missing original authority cannot start even a backup read');
  assertPending(f);
  assert.equal((await f.read()).snapshot.appImage.version, f.previousVersion);
  assert.equal(f.queueCalls[0].receipt.committed, true);
  assert.equal(f.queueCalls[0].receipt.intent, undefined);
});

test('actual still-gated 1.0.5 producer atomically migrates label/health/version then confirms app/live/archive/label fanout without receipt replay', async t => {
  const f = await setup(t, { previousVersion: '1.0.5', migration: true });
  const observed = [], observationErrors = [];
  const originalPush = server.trace.push;
  const trace = server.trace;
  trace.push = function (...events) {
    for (const event of events) if (event.path === '/backup/v3/mutate') {
      // Observe before forwarding, but never throw into HTTP admission. A
      // failed observation is asserted after the real producer has drained.
      try { observed.push({ operation: event.operation, state: localUpgradeState(f) }); }
      catch (error) { observationErrors.push(error); }
    }
    return originalPush.apply(this, events);
  };
  t.after(() => { trace.push = originalPush; });
  assert.equal(await f.upgrade(), true);
  assertLocalUpgrade(f, true);
  assert.equal(observationErrors.length, 0, observationErrors.map(error => error.message).join('; '));
  assert.deepEqual(observed.map(value => value.operation), ['updateAppImage', 'updateVaultImage', 'updateVaultImage', 'modifyLabels']);
  for (const observation of observed) assertLocalUpgrade(f, true, observation.state);
  for (let i = 1; i < writes().length; i++) assertOwnNextTuple(writes()[i - 1], writes()[i]);
  const image = await assertConfirmed(f, 4);
  assert.equal(image.vaults['upgrade-old-vault'].archived, true);
  assert.equal(Object.values(image.labels)[0].label, 'legacy note');
  await assertConsumedNoReplay(f);
});

test('actual late native Realm version validation rolls back every staged migration and emits no HTTP', async t => {
  const f = await setup(t, { previousVersion: '1.0.5', migration: true });
  const before = await f.repair.captureBackupImage();
  const signerBefore = plain(f.dbManager.getCollection(f.RealmSchema.Signer)[0]);
  let reachedLateVersionWrite = false;
  const stageVersion = f.sagas.scope.stageVersionUpdate;
  f.sagas.scope.stageVersionUpdate = (group, ...args) => {
    // Read-only positive observation, ordered after the real migration writes
    // and immediately before the unchanged producer's staged version write.
    group.writes.push(database => {
      assert.equal(database.isInTransaction, true);
      assert.equal(database.objects(f.RealmSchema.Tags).length, 1);
      assert.equal(database.objects(f.RealmSchema.Signer)[0].healthCheckDetails.length, 1);
      assert.equal(database.objectForPrimaryKey(f.RealmSchema.KeeperApp, f.appId).version, f.previousVersion);
      reachedLateVersionWrite = true;
    });
    return stageVersion(group, ...args);
  };
  assert.equal(await f.upgrade({ newVersion: null }), false,
    'The unchanged producer reaches the real required string field inside one Realm transaction');
  assert.equal(reachedLateVersionWrite, true, 'An unrelated earlier failure cannot satisfy the late rollback witness');
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.KeeperApp, f.appId).version, f.previousVersion);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.VersionHistory).length, 0);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Tags).length, 0);
  assert.deepEqual(plain(f.dbManager.getCollection(f.RealmSchema.Signer)[0]), signerBefore);
  assert.equal(await f.image.compareImages(before, await f.repair.captureBackupImage()), 'matched');
  assert.equal(f.store.getState().storage.appVersion, f.previousVersion);
  assert.equal(f.queueCalls.length, 0);
  assert.equal(server.trace.length, 0);
  assert.equal((await f.read()).snapshot.appImage.version, f.previousVersion);
});

test('actual originating A-to-B-to-A session is rejected before any local launch write', async t => {
  const f = await setup(t);
  await f.selectAccount(otherAppId);
  await f.selectAccount(f.appId);
  assert.notEqual(f.transport.currentBackupAccountSession(), f.origin.originBackupAccountSession);
  assert.equal(await f.upgrade(), false);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.KeeperApp, f.appId).version, f.previousVersion);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.VersionHistory).length, 0);
  assert.equal(f.queueCalls.length, 0);
  assert.equal(server.trace.length, 0);
  assert.equal(f.topics.length, 0);
});

test('actual account change during a held signed read retains committed A while withholding stale Redux/cloud completion and all B writes', async t => {
  const f = await setup(t);
  const entered = deferred(), release = deferred();
  server.armFault({ path: '/backup/v3/snapshot', beforeReply() { entered.resolve(); return release.promise; } });
  const upgrading = f.upgrade();
  let beforeB, primaryFailure;
  try {
    await boundedArrival(entered.promise);
    assertLocalUpgrade(f);
    await f.selectAccount(otherAppId);
    beforeB = await f.repair.captureBackupImage();
  } catch (error) { primaryFailure = error; throw error; }
  finally {
    release.resolve();
    // Release and drain before t.after closes Realm/server, including failures
    // in the held-boundary assertions. Preserve any primary assertion failure.
    try { await upgrading; }
    catch (error) {
      if (!primaryFailure) throw error;
      t.diagnostic('Owned upgrade worker also failed while draining after the primary assertion');
    }
  }
  assert.equal(await upgrading, false);
  assert.equal(f.selected(), otherAppId);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.KeeperApp, otherAppId).version, installedVersion);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.VersionHistory).length, 0);
  assert.equal(await f.image.compareImages(beforeB, await f.repair.captureBackupImage()), 'matched');
  assert.equal(f.store.getState().storage.appVersion, f.previousVersion,
    'An old account must not publish setAppVersion after the asynchronous boundary');
  assert.equal(f.topics.length, 0);
  assert.equal(writes().length, 0);
  await f.selectAccount(f.appId);
  assertLocalUpgrade(f);
  assertPending(f);
  assert.equal((await f.read()).snapshot.appImage.version, f.previousVersion);
});

test('actual peer CAS after ACK1 rejects upgrade fanout member2 without rebase/retry and preserves all local migrations', async t => {
  const f = await setup(t, { previousVersion: '1.0.5', migration: true });
  server.armFault({ path: '/backup/v3/mutate', operation: 'updateAppImage', async beforeReply({ body }) {
    await f.protected.protectedBackupMutation(mnemonic, {
      namespaceId: f.origin.originBackupWriteIntent.protectedBase.namespaceId,
      revision: body.newRevision, generation: body.newGeneration, authEpoch: body.authEpoch,
    }, 'updateAppImage', { nodes: [], replaceNodes: true });
  } });
  assert.equal(await f.upgrade(), true, 'Local commit survives the genuine remote CAS rejection');
  assertLocalUpgrade(f, true);
  assert.equal(f.store.getState().storage.appVersion, installedVersion);
  assert.deepEqual(writes().map(event => event.status), [200, 200, 409]);
  assert.deepEqual(writes().map(event => event.operation), ['updateAppImage', 'updateAppImage', 'updateVaultImage']);
  assertOwnNextTuple(writes()[0], writes()[2]);
  assert.notEqual(writes()[2].expectedRevision, writes()[1].serverRevision);
  assert.equal(writes()[2].committed, false);
  assertPending(f);
  const remote = await f.read();
  assert.equal(remote.snapshot.appImage.version, installedVersion);
  const image = await f.decode(remote);
  assert.equal(Object.keys(image.labels).length, 0, 'The unacknowledged remaining fanout cannot be claimed uploaded');
  assert.notEqual(await f.image.compareImages(await f.repair.captureBackupImage(), image), 'matched');
  await assertConsumedNoReplay(f);
});

test('actual committed launch write with lost ACK remains pending even after matching signed readback and never replays', async t => {
  const f = await setup(t);
  server.armFault({ path: '/backup/v3/mutate', operation: 'updateAppImage', mode: 'lost-reply' });
  assert.equal(await f.upgrade(), true);
  assertLocalUpgrade(f);
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].committed, true);
  assertPending(f);
  const remote = await f.read();
  assert.equal(remote.snapshot.appImage.version, installedVersion);
  assert.equal(await f.image.compareImages(await f.repair.captureBackupImage(), await f.decode(remote)), 'matched');
  assertPending(f);
  await assertConsumedNoReplay(f);
});

test('actual complete upgrade cannot become Verified from corrupted final readback metadata despite four real committed writes', async t => {
  const f = await setup(t, { previousVersion: '1.0.5', migration: true });
  let injected = false;
  server.armFault({ path: '/backup/v3/snapshot', after: 1, mutateReply: value => {
    assert.equal(value.appImage.version, installedVersion);
    injected = true;
    return { ...value, appImage: { ...value.appImage, version: 'wrong-version' } };
  } });
  assert.equal(await f.upgrade(), true);
  assert.equal(injected, true, 'Alter only a real final snapshot response after all writes');
  assertLocalUpgrade(f, true);
  assert.equal(writes().length, 4);
  assert.ok(writes().every(event => event.committed));
  assertPending(f);
  assert.equal((await f.read()).snapshot.appImage.version, installedVersion,
    'The backend stores the real committed metadata; only the faulted readback differed');
  await assertConsumedNoReplay(f);
});
