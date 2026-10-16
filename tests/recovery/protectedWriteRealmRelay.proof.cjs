// Opt-in, exact-private protected-v3 app proof. This is not the public v2
// matrix. Native encrypted Realm, real production app authority/queue/store,
// crypto, HTTP and the reviewed bounded transactional backend all remain real.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { test, beforeEach, afterEach, after } = require('node:test');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const { declarations, classMembers, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const builders = { assert };
// Reuse data builders only, without importing or running the historical v2
// tests. Every protocol assertion and admission below is new and v3-specific.
evaluate(declarations('tests/recovery/automaticWriteRealmRelay.integration.cjs', [
  'wallet', 'signer', 'vault', 'persist', 'persistVault', 'vaultBody', 'labelBody', 'operations',
]), builders, 'shared-native-recovery-record-builders.ts');
const { wallet, persist, operations } = builders;
let server;
// Each independent case gets a fresh real router and its unchanged admission
// buckets. Repeated same-account requests across unrelated cases must not share
// a synthetic burst or disable the actual production rate limits.
beforeEach(async () => { server = await createProtectedServer(); });
afterEach(async () => { await server?.close(); server = undefined; });
after(() => { Realm.shutdown(); });
const tick = () => new Promise(resolve => setImmediate(resolve));
function barrier() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
const mutations = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

async function client(t, options = {}) {
  const f = await createProtectedRealmClient(server.url, { appId, primarySeed: seed.toString('hex'), primaryMnemonic: mnemonic, ...options });
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  const stop = f.listen();
  t.after(async () => { stop(); await f.close(); });
  f.sagas = f.productionSagas(['currentBackupAppId', 'backupInspectionOwners', 'runBackupInspection']);
  return f;
}
async function setup(t, operation = 'updateAppImage') {
  await server.reset(); const f = await client(t);
  operations[operation].prepare(f);
  persist(f, f.RealmSchema.Wallet, wallet(f, 'retained-wallet', 'Retained local recovery record'));
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
  await tick();
  const verified = await f.sagas.run('runBackupInspection', true, f.appId, true);
  if (!verified) {
    try { await read(f); }
    catch (error) { t.diagnostic(JSON.stringify({ directProtectedReadFailure: error.name, message: error.message })); }
    t.diagnostic(JSON.stringify({ requests: server.trace }));
  }
  assert.equal(verified, true,
    `Genuine protected opt-in must verify: ${JSON.stringify(f.store.getState().bhr.backupRepairStateByAppId)}`);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], false);
  const intent = f.transport.captureBackupWriteIntent(appId);
  assert.ok(intent?.protectedBase, 'Actual inspection must capture the full original protected CAS tuple');
  assert.notEqual(intent.protectedBase.namespaceId, appId, 'Protected authority is independent of the original Keeper account ID');
  server.clearTrace(); return f;
}
async function read(f) {
  return f.protected.readProtectedBackup(mnemonic, undefined, f.appId);
}
async function assertComplete(f) {
  const remote = await read(f); assert.equal(remote.state, 'present');
  const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot, remote.namespaceId);
  assert.equal(await f.image.compareImages(await f.repair.captureBackupImage(), decoded), 'matched');
  return remote;
}
async function committedRequest(f, operation) {
  const contract = operations[operation]; let receipt;
  if (operation === 'deleteBackup') receipt = await f.automatic.beginBackupDeleteOperation(appId, f.transport.currentBackupAccountSession());
  else {
    const op = f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId), f.transport.currentBackupAccountSession());
    receipt = f.automatic.commitBackupLocalOperation(op, realm => contract.mutate(realm, f));
  }
  assert.equal(receipt.committed, true); assert.ok(receipt.intent?.protectedBase);
  const body = await contract.body(f);
  return { receipt, body, invoke: () => contract.invoke(f, body, receipt.intent) };
}
async function twoWalletMutationRequest(f) {
  const op = f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId), f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, realm => {
    realm.objectForPrimaryKey('Wallet', 'wallet-a').presentationData.name = 'First fanout local commit';
    realm.objectForPrimaryKey('Wallet', 'retained-wallet').presentationData.name = 'Second fanout local commit';
  });
  assert.equal(receipt.committed, true); assert.ok(receipt.intent);
  const image = await f.repair.captureBackupImage(), key = f.encryption.generateEncryptionKey(f.seed);
  const input = [];
  for (const id of ['wallet-a', 'retained-wallet']) input.push({ operation: 'updateAppImage',
    body: { appId, walletsObject: { [id]: await f.image.encryptRecord(key, image.wallets[id]) } } });
  return { receipt, image, invoke: () => f.automatic.enqueueAutomaticBackupOperation(receipt, input) };
}
function assertOwnNextTuple(first, next) {
  assert.equal(next.expectedRevision, first.serverRevision);
  assert.equal(next.expectedGeneration, first.serverGeneration);
  assert.equal(next.authEpoch, first.serverAuthEpoch);
}
function pending(f) {
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], true);
  assert.notEqual(f.store.getState().bhr.backupRepairStateByAppId[appId], 'verified');
}
function recoverySagas(f) {
  // Reuse only the existing real-wallet crypto setup declaration. This does not
  // execute its historical public-v2 test or supply any recovery result.
  const scope = { require, crypto, bip39: require('bip39'), declarations, classMembers, evaluate };
  evaluate(declarations('tests/recovery/automaticRecoveryRestore.integration.cjs', ['cryptoAndRecovery']), scope,
    'shared-production-recovery-crypto-setup.ts');
  return scope.cryptoAndRecovery(f);
}
async function blankRecoveryClient(t, { inheritedConsent = false } = {}) {
  const f = await client(t); const saga = recoverySagas(f);
  if (inheritedConsent) {
    // Establish saved consent while this account is genuinely selected. An
    // unbranded enable for an unselected account is correctly rejected.
    f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true })); await tick();
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  }
  f.realmDatabase.closeDatabase(); const filename = path.join(f.directory, 'protected-clean-restore.realm');
  assert.equal((await f.dbManager.initializeRealm(Buffer.alloc(64, 7), filename)).success, true);
  f.store.dispatch(f.storage.setAppId(''));
  f.store.dispatch(f.account.setTempDetails({ hash: f.encryption.hash256('public-disposable-passcode-fixture'),
    realmId: filename, accountIdentifier: 'disposable protected restore' }));
  assert.equal(f.nativeRealm().objects('KeeperApp').length, 0);
  return { f, saga };
}

test('exact-private prerequisite: production native Realm/authority/root queue explicitly enrolls, repairs and verifies a full protected copy', async t => {
  const f = await setup(t);
  const authority = f.authority.deriveBackupAuthority(mnemonic);
  assert.equal(authority.namespaceId, 'bk3_7SolLs5PrxK2ybpJGsah8spJqewmCskdDW_L9gnI2FY');
  authority.dispose();
  await assertComplete(f);
  assert.equal(f.store.getState().bhr.protectedBackupStateByAppId[appId].status, 'present');
});

for (const operation of Object.keys(operations)) {
  test(`${operation}: committed native receipt uses signed v3 original tuple once and verifies the complete result`, async t => {
    const f = await setup(t, operation), request = await committedRequest(f, operation);
    const result = await request.invoke();
    assert.equal(result.updated, true);
    // This historical public wrapper intentionally exposes only {updated}; its
    // success is proved by the real store/current-proof and complete readback.
    if (operation !== 'modifyLabels') assert.equal(result.backupConfirmed, true);
    assert.equal(mutations().length, 1); assert.equal(mutations()[0].operation, operation);
    assert.equal(mutations()[0].committed, true);
    if (operation === 'deleteBackup') {
      assert.equal((await read(f)).state, 'deleted');
      assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a'));
      assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], false);
    } else {
      await assertComplete(f);
      assert.equal(f.store.getState().bhr.backupRepairStateByAppId[appId], 'verified');
    }
  });
}

test('consent-off status is signed read-only and never enrolls or uploads; explicit production opt-in alone creates the protected copy', async t => {
  await server.reset(); const f = await client(t);
  operations.updateAppImage.prepare(f);
  const sagas = f.productionSagas(['currentBackupAppId', 'backupInspectionOwners', 'runBackupInspection', 'backupAllSignersAndVaultsWorker']);
  assert.equal(await sagas.run('runBackupInspection', false, appId, true), false);
  assert.equal(mutations().length, 0); assert.equal(server.trace.some(event => event.path === '/backup/v3/enroll'), false);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], undefined);
  assert.equal(await sagas.run('backupAllSignersAndVaultsWorker', { appId }), true);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  await assertComplete(f);
});

test('Delete worker preserves the original account, subscription, encrypted local records and older copy; explicit recreate advances the tombstone', async t => {
  const f = await setup(t); const before = await f.repair.captureBackupImage();
  const appBefore = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
  await server.seedLegacy(await f.payloadForCurrentImage());
  const old = await server.backend.mongoose.connection.db.collection('appimages').findOne({ appId });
  const sagas = f.productionSagas(['currentBackupAppId', 'deleteBackupWorker']);
  assert.equal(await sagas.run('deleteBackupWorker', { appId }), true);
  const deleted = await read(f); assert.equal(deleted.state, 'deleted');
  assert.equal(deleted.snapshot.suppressLegacyFallback, true);
  assert.equal(await f.image.compareImages(before, await f.repair.captureBackupImage()), 'matched');
  const appAfter = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
  for (const field of ['id', 'primaryMnemonic', 'primarySeed', 'subscription']) assert.deepEqual(appAfter[field], appBefore[field]);
  assert.deepEqual(await server.backend.mongoose.connection.db.collection('appimages').findOne({ appId }), old);
  assert.equal(await f.sagas.run('runBackupInspection', true, appId, true), true);
  const recreated = await assertComplete(f);
  assert.ok(recreated.snapshot.generation > deleted.snapshot.generation);
  assert.equal(recreated.snapshot.authEpoch, deleted.snapshot.authEpoch);
});

for (const invalidation of ['local-commit', 'consent-revoked', 'A-to-B-to-A']) {
  test(`a queued original receipt invalidated by ${invalidation} never borrows fresh authority or uploads`, async t => {
    const f = await setup(t), request = await committedRequest(f, 'updateAppImage');
    const gate = barrier(); t.after(gate.release);
    const preceding = f.transport.withBackupSession(appId, () => gate.promise);
    const writing = request.invoke(); await tick();
    if (invalidation === 'local-commit') persist(f, f.RealmSchema.Tags,
      f.defaults(f.RealmSchema.Tags, { id: 'late', type: 'TX', ref: 'public', label: 'Later local commit' }));
    if (invalidation === 'consent-revoked') f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: false }));
    if (invalidation === 'A-to-B-to-A') { await f.selectAccount('disposable-other-account'); await f.selectAccount(appId); }
    gate.release(); await preceding; const result = await writing;
    assert.notEqual(result.backupConfirmed, true); assert.equal(mutations().length, 0);
    assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a').presentationData.name, 'Committed wallet');
  });
}

test('a genuine local commit without its original protected baseline remains local and cannot obtain upload authority later', async t => {
  const f = await setup(t); f.transport.clearVerifiedRemoteRevision(appId);
  const op = f.automatic.beginBackupLocalOperation(appId, undefined, f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, realm => operations.updateAppImage.mutate(realm, f));
  assert.equal(receipt.committed, true); assert.equal(receipt.intent, undefined);
  const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, [{ operation: 'updateAppImage', body: await operations.updateAppImage.body(f) }]);
  assert.notEqual(result.backupConfirmed, true); assert.equal(mutations().length, 0);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a').presentationData.name, 'Committed wallet');
});

test('a peer commit between original snapshot and CAS produces real409; local rename and remote-only recovery both survive', async t => {
  const f = await setup(t), request = await committedRequest(f, 'updateAppImage');
  const base = request.receipt.intent.protectedBase;
  server.armFault({ path: '/backup/v3/snapshot', async beforeReply() {
    await f.protected.protectedBackupMutation(mnemonic, base, 'updateAppImage', {
      walletsObject: { peer: await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed),
        plain(wallet(f, 'peer', 'Remote-only recovery'))) },
    });
  } });
  const result = await request.invoke(); assert.notEqual(result.backupConfirmed, true);
  assert.ok(mutations().some(event => event.status === 409));
  const remote = await read(f); assert.ok(remote.snapshot.appImage.wallets.peer);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a').presentationData.name, 'Committed wallet');
  pending(f);
});

for (const mode of ['lost-reply', 'malformed-json', 'malformed-ack']) {
  test(`${mode} after an actual committed write never retries ciphertext or claims Verified from an unacknowledged tuple`, async t => {
    const f = await setup(t), request = await committedRequest(f, 'updateAppImage');
    server.armFault({ path: '/backup/v3/mutate', operation: 'updateAppImage',
      ...(mode === 'malformed-ack' ? { mutateReply: value => ({ ...value, newGeneration: value.newGeneration + 1 }) } : { mode }) });
    const result = await request.invoke(); assert.notEqual(result.backupConfirmed, true); pending(f);
    assert.equal(mutations().length, 1); assert.equal(mutations()[0].committed, true);
    const remote = await read(f); assert.equal(remote.snapshot.generation, request.receipt.intent.protectedBase.generation + 1);
    await request.invoke(); assert.equal(mutations().length, 1, 'Consumed receipt must not resubmit uncertain ciphertext');
    assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a').presentationData.name, 'Committed wallet');
  });
}

test('a malformed final authenticated namespace readback cannot become Verified after the real CAS commit', async t => {
  const f = await setup(t), request = await committedRequest(f, 'updateAppImage');
  server.armFault({ path: '/backup/v3/snapshot', after: 1,
    mutateReply: value => ({ ...value, namespaceId: 'bk3_invalid-namespace' }) });
  const result = await request.invoke(); assert.notEqual(result.backupConfirmed, true); pending(f);
  assert.equal(mutations().length, 1); assert.equal(mutations()[0].committed, true);
});

test('real native insertion followed by an injected transaction failure leaves the full remote tuple unchanged and local data intact', async t => {
  const f = await setup(t), request = await committedRequest(f, 'updateAppImage');
  const prototype = Object.getPrototypeOf(server.backend.connection.db.collection('protectedBackupRecords'));
  const original = prototype.insertMany; let injected = false;
  prototype.insertMany = async function(records, ...args) {
    if (!injected && this.collectionName === 'protectedBackupRecords' && records.length) {
      injected = true; await original.call(this, records.slice(0, 1), ...args);
      throw Error('Disclosed fixture failure after one real insert');
    }
    return original.call(this, records, ...args);
  };
  let result;
  try { result = await request.invoke(); } finally { prototype.insertMany = original; }
  assert.equal(injected, true); assert.notEqual(result.backupConfirmed, true); pending(f);
  const remote = await read(f); assert.equal(remote.snapshot.revision, request.receipt.intent.protectedBase.revision);
  assert.equal(remote.snapshot.generation, request.receipt.intent.protectedBase.generation);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a').presentationData.name, 'Committed wallet');
});

test('a real native change at the final Redux verification commit prevents a Verified claim', async t => {
  const f = await setup(t), request = await committedRequest(f, 'updateAppImage'); let injected = false;
  f.setBeforeDispatch(action => {
    if (!injected && action.type === f.bhr.commitBackupInspection.type) {
      injected = true; persist(f, f.RealmSchema.Tags,
        f.defaults(f.RealmSchema.Tags, { id: 'final-race', type: 'TX', ref: 'public', label: 'Committed during verification' }));
    }
  });
  const result = await request.invoke(); assert.equal(injected, true);
  assert.notEqual(result.backupConfirmed, true); pending(f); assert.equal(mutations().length, 1);
});

test('actual BHR producer reads committed native IDs, preserving local-first data through the real signed queue', async t => {
  const f = await setup(t), request = await committedRequest(f, 'updateAppImage');
  const producer = f.productionSagas(['currentBackupAppId', 'buildAutomaticAppMutation', 'queueCommittedBackupWorker', 'updateAppImageWorker']);
  const result = await producer.run('updateAppImageWorker', {
    payload: { wallets: [wallet(f, 'wallet-a', 'Stale action presentation')] }, originAppId: appId,
    originBackupAccountSession: f.transport.currentBackupAccountSession(), committedOperation: request.receipt,
  });
  assert.equal(result.backupConfirmed, true); assert.equal(mutations().length, 1);
  const remote = await assertComplete(f);
  const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot, remote.namespaceId);
  assert.equal(decoded.wallets['wallet-a'].presentationData.name, 'Committed wallet');
});

test('the actual Recovery Key worker restores a protected full image into blank encrypted Realm without changing Keeper identity or granting consent', async t => {
  const source = await setup(t); const sourceCrypto = recoverySagas(source);
  persist(source, source.RealmSchema.Signer, sourceCrypto.scope.setupRecoveryKeySigningKey(mnemonic));
  assert.equal(await source.sagas.run('runBackupInspection', true, appId, true), true);
  const defaultNode = plain(source.load('src/services/electrum/predefinedNodes').predefinedTestnetNodes[0]);
  const customNode = source.defaults(source.RealmSchema.NodeConnect, { id: 73,
    host: 'custom-recovery-node.invalid', port: '50002', useSSL: true, isConnected: true,
    networkType: source.enums.NetworkType.MAINNET });
  const nodeSession = source.transport.currentBackupAccountSession();
  const nodeOperation = source.automatic.beginBackupLocalOperation(appId, source.transport.captureBackupWriteIntent(appId), nodeSession);
  const nodeReceipt = source.automatic.commitBackupLocalOperation(nodeOperation, realm => {
    // Persist real default/custom node records only. No connection/provider
    // worker is imported or invoked by this backup/restore proof.
    realm.create(source.RealmSchema.NodeConnect, defaultNode);
    realm.create(source.RealmSchema.NodeConnect, customNode);
  });
  assert.equal(nodeReceipt.committed, true);
  const nodeProducer = source.productionSagas(['currentBackupAppId', 'buildAutomaticAppMutation',
    'queueCommittedBackupWorker', 'updateAppImageWorker']);
  server.clearTrace();
  const nodeResult = await nodeProducer.run('updateAppImageWorker', { payload: { updateNodes: true },
    originAppId: appId, originBackupAccountSession: nodeSession, committedOperation: nodeReceipt });
  assert.equal(nodeResult.backupConfirmed, true);
  assert.equal(mutations().length, 1); assert.equal(mutations()[0].replaceNodes, true);
  assert.equal(mutations()[0].nodeCount, 2);
  const uploaded = await assertComplete(source); assert.equal(uploaded.snapshot.appImage.nodes.length, 2);
  const uploadedImage = await source.image.decodeImage(source.encryption.generateEncryptionKey(source.seed),
    uploaded.snapshot, uploaded.namespaceId);
  assert.ok(Object.values(uploadedImage.nodes).every(node => node.isConnected === false),
    'The real producer clears all transient connection flags in the encrypted backup');
  const expected = await source.repair.captureBackupImage();
  const { f, saga } = await blankRecoveryClient(t); server.clearTrace();
  await saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic } });
  assert.equal(f.store.getState().storage.appCreated, true, f.store.getState().bhr.appImageError);
  assert.equal(f.store.getState().storage.appId, appId);
  assert.equal(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp).primaryMnemonic, mnemonic);
  assert.equal(await f.image.compareImages(expected, await f.repair.captureBackupImage()), 'matched');
  const restoredNodes = Array.from(f.dbManager.getCollection(f.RealmSchema.NodeConnect));
  assert.equal(restoredNodes.length, 2);
  assert.equal(restoredNodes.find(node => node.id === defaultNode.id).host, defaultNode.host);
  assert.equal(restoredNodes.find(node => node.id === customNode.id).host, customNode.host);
  // The unchanged recovery worker selects the first restored node when all
  // uploaded flags are false. This is local selection, not a network connection.
  assert.equal(restoredNodes[0].isConnected, true);
  assert.ok(restoredNodes.slice(1).every(node => node.isConnected === false));
  assert.notEqual(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  assert.equal(f.store.getState().bhr.recoveryDiscovery.provenance.source, 'protected');
  assert.equal(server.trace.some(event => event.legacyRead), false); assert.equal(mutations().length, 0);
});

test('never-enrolled protected discovery is typed and creates no local account, enrollment, automatic legacy read or upload', async t => {
  await server.reset(); const { f, saga } = await blankRecoveryClient(t); server.clearTrace();
  await saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic } });
  assert.equal(f.store.getState().bhr.recoveryDiscovery.status, 'protected-absent');
  assert.equal(f.nativeRealm().objects('KeeperApp').length, 0);
  assert.equal(server.trace.some(event => event.legacyRead || event.path === '/backup/v3/enroll'), false);
  assert.equal(mutations().length, 0);
});

test('a protected tombstone never silently restores the retained old copy; explicit older selection reads it without protected writes or consent', async t => {
  const source = await setup(t), sourceCrypto = recoverySagas(source);
  persist(source, source.RealmSchema.Signer, sourceCrypto.scope.setupRecoveryKeySigningKey(mnemonic));
  assert.equal(await source.sagas.run('runBackupInspection', true, appId, true), true);
  await server.seedLegacy(await source.payloadForCurrentImage());
  assert.equal((await (await committedRequest(source, 'deleteBackup')).invoke()).backupConfirmed, true);
  const { f, saga } = await blankRecoveryClient(t); server.clearTrace();
  await saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic } });
  assert.equal(f.store.getState().bhr.recoveryDiscovery.status, 'protected-deleted');
  assert.equal(f.nativeRealm().objects('KeeperApp').length, 0);
  assert.equal(server.trace.some(event => event.legacyRead), false);
  await saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic,
    selection: { source: 'legacy-older', olderCopyConfirmed: true } } });
  assert.equal(f.store.getState().storage.appCreated, true, f.store.getState().bhr.appImageError);
  assert.equal(f.store.getState().storage.appId, appId);
  assert.equal(f.store.getState().bhr.recoveryDiscovery.provenance.source, 'legacy-older');
  assert.equal(f.store.getState().bhr.recoveryDiscovery.provenance.legacyMayPredateDeletion, true);
  assert.notEqual(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  assert.equal(server.trace.filter(event => event.legacyRead).length, 1);
  assert.equal(mutations().length, 0); assert.equal((await read(source)).state, 'deleted');
});

test('a malformed protected discovery reports read-error and never falls back to an available older copy', async t => {
  const source = await setup(t); await server.seedLegacy(await source.payloadForCurrentImage());
  const { f, saga } = await blankRecoveryClient(t); server.clearTrace();
  server.armFault({ path: '/backup/v3/snapshot', mutateReply: value => ({ ...value, namespaceId: 'bk3_wrong' }) });
  await saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic } });
  assert.equal(f.store.getState().bhr.recoveryDiscovery.status, 'read-error');
  assert.equal(f.nativeRealm().objects('KeeperApp').length, 0);
  assert.equal(server.trace.some(event => event.legacyRead), false); assert.equal(mutations().length, 0);
});

test('hosted enablement remains false for explicit enrollment and repair despite valid local authority', async t => {
  await server.reset(); const f = await client(t); const previous = f.config.RELAY;
  f.config.RELAY = 'https://fixture.invalid/';
  try {
    await assert.rejects(f.protected.enrollProtectedBackup(mnemonic), /not enabled/);
    await assert.rejects(f.protected.protectedBackupMutation(mnemonic, {}, 'repairAppBackup', {}), /not enabled/);
  } finally { f.config.RELAY = previous; }
  assert.equal(server.trace.length, 0);
});

test('a real committed mnemonic change invalidates queued authority before any old ciphertext is sent', async t => {
  const f = await setup(t), request = await committedRequest(f, 'updateAppImage');
  const gate = barrier(); t.after(gate.release);
  const preceding = f.transport.withBackupSession(appId, () => gate.promise);
  const writing = request.invoke(); await tick();
  const other = require('bip39').entropyToMnemonic('11'.repeat(16));
  assert.equal(f.dbManager.updateObjectById(f.RealmSchema.KeeperApp, appId, { primaryMnemonic: other }), true);
  gate.release(); await preceding; const result = await writing;
  assert.notEqual(result.backupConfirmed, true); assert.equal(mutations().length, 0);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a').presentationData.name, 'Committed wallet');
});

test('a stored seed inconsistent with the Recovery Key cannot enroll or repair under an otherwise current original Keeper account', async t => {
  const f = await setup(t); const walletBefore = plain(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a'));
  assert.equal(f.dbManager.updateObjectById(f.RealmSchema.KeeperApp, appId, { primarySeed: 'ff'.repeat(64) }), true);
  assert.equal(await f.sagas.run('runBackupInspection', true, appId, true), false);
  assert.equal(server.trace.length, 0, 'Account binding must reject before any signed request');
  assert.deepEqual(plain(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a')), walletBefore);
});

test('two real fanout mutations use only their own preceding full ACK tuple and verify the complete committed native image', async t => {
  const f = await setup(t), request = await twoWalletMutationRequest(f);
  const result = await request.invoke(); assert.equal(result.backupConfirmed, true);
  const writes = mutations(); assert.equal(writes.length, 2);
  assert.equal(writes[0].expectedRevision, request.receipt.intent.protectedBase.revision);
  assert.equal(writes[0].expectedGeneration, request.receipt.intent.protectedBase.generation);
  assert.equal(writes[0].authEpoch, request.receipt.intent.protectedBase.authEpoch);
  assertOwnNextTuple(writes[0], writes[1]);
  assert.equal(writes[1].serverGeneration, writes[0].serverGeneration + 1);
  const remote = await assertComplete(f); assert.equal(remote.snapshot.revision, writes[1].serverRevision);
  assert.equal(remote.snapshot.generation, writes[1].serverGeneration);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[appId], 'verified');
});

test('a real peer CAS after ACK1 rejects fanout member2 without rebasing or resubmitting; first commit and all local data survive', async t => {
  const f = await setup(t), request = await twoWalletMutationRequest(f);
  server.armFault({ path: '/backup/v3/mutate', async beforeReply({ body }) {
    await f.protected.protectedBackupMutation(mnemonic, { namespaceId: request.receipt.intent.protectedBase.namespaceId,
      revision: body.newRevision, generation: body.newGeneration, authEpoch: body.authEpoch }, 'updateAppImage', {
      walletsObject: { peer: await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed), plain(wallet(f, 'peer', 'Peer recovery'))) },
    });
  } });
  const result = await request.invoke(); assert.notEqual(result.backupConfirmed, true); pending(f);
  const writes = mutations(); assert.equal(writes.length, 3);
  assert.deepEqual(writes.map(event => event.status), [200, 200, 409]);
  assertOwnNextTuple(writes[0], writes[2]);
  assert.notEqual(writes[2].expectedRevision, writes[1].serverRevision, 'Member2 cannot borrow the peer revision');
  const remote = await read(f), decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot, remote.namespaceId);
  assert.equal(decoded.wallets['wallet-a'].presentationData.name, 'First fanout local commit');
  assert.equal(decoded.wallets['retained-wallet'].presentationData.name, 'Retained local recovery record');
  assert.ok(decoded.wallets.peer);
  assert.equal(await f.image.compareImages(request.image, await f.repair.captureBackupImage()), 'matched');
  await request.invoke(); assert.equal(mutations().length, 3, 'Consumed partial fanout cannot be resubmitted');
});

test('a lost ACK after real fanout member2 preserves both effects but never turns matching readback into acknowledgement or a retry', async t => {
  const f = await setup(t), request = await twoWalletMutationRequest(f);
  server.armFault({ path: '/backup/v3/mutate', after: 1, mode: 'lost-reply' });
  const result = await request.invoke(); assert.notEqual(result.backupConfirmed, true); pending(f);
  const writes = mutations(); assert.equal(writes.length, 2); assert.ok(writes.every(event => event.committed));
  assertOwnNextTuple(writes[0], writes[1]);
  await assertComplete(f); pending(f);
  assert.equal(await f.image.compareImages(request.image, await f.repair.captureBackupImage()), 'matched');
  await request.invoke(); assert.equal(mutations().length, 2, 'Lost final ACK cannot renew an old receipt');
});

test('a changed final vault-map fingerprint cannot hide behind an unchanged revision or become Verified after a real vault CAS', async t => {
  const f = await setup(t, 'updateVaultImage'), request = await committedRequest(f, 'updateVaultImage');
  let injected = false;
  server.armFault({ path: '/backup/v3/snapshot', after: 1, mutateReply: value => {
    assert.ok(value.vaultMaps.length > 0, 'Exercise the actual complete vault-map projection');
    assert.notEqual(value.vaultMaps[0].xfpHash, 'f'.repeat(64)); injected = true;
    return { ...value, vaultMaps: value.vaultMaps.map((map, index) => index === 0
      ? { ...map, xfpHash: 'f'.repeat(64) } : map) };
  } });
  const result = await request.invoke(); assert.equal(injected, true);
  assert.notEqual(result.backupConfirmed, true); pending(f);
  assert.equal(mutations().length, 1); assert.equal(mutations()[0].committed, true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Vault, 'vault-a').presentationData.name, 'Committed vault');
});

for (const malformed of ['label-wire-id', 'wallet-map-alias']) {
  test(`owned signed opaque ${malformed} is accepted by the real backend but protected recovery rejects it before any Realm write`, async t => {
    const source = await setup(t), current = await read(source);
    const key = source.encryption.generateEncryptionKey(source.seed);
    const operation = malformed === 'label-wire-id' ? 'modifyLabels' : 'updateAppImage';
    const data = malformed === 'label-wire-id'
      ? { addLabels: [{ id: 'f'.repeat(64), content: await source.image.encryptRecord(key,
        source.defaults(source.RealmSchema.Tags, { id: 'different-plaintext-label', type: 'TX', ref: 'public', label: 'Synthetic protected label' })) }] }
      : { walletsObject: { 'wrong-wire-wallet-id': await source.image.encryptRecord(key,
        plain(wallet(source, 'different-plaintext-wallet-id', 'Synthetic protected wallet'))) } };
    // This is an independently admitted, genuinely signed owner write. The
    // backend stores opaque ciphertext and cannot prove its plaintext record ID.
    const ack = await source.protected.protectedBackupMutation(mnemonic,
      source.protected.protectedBackupBase(current.snapshot), operation, data);
    assert.equal(ack.updated, true);
    const { f, saga } = await blankRecoveryClient(t); server.clearTrace();
    await saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic } });
    assert.equal(f.store.getState().bhr.recoveryDiscovery.status, 'read-error');
    assert.notEqual(f.store.getState().storage.appCreated, true);
    assert.equal(f.store.getState().storage.appId, '');
    for (const name of ['KeeperApp', 'Wallet', 'Signer', 'Vault', 'Tags', 'NodeConnect'])
      assert.equal(f.nativeRealm().objects(name).length, 0, `Protected ${malformed} must fail before ${name} persistence`);
    assert.equal(server.trace.some(event => event.legacyRead), false);
    assert.equal(mutations().length, 0, 'A failed protected recovery cannot repair or replace its source');
  });
}

test('actual NEW-vault producer includes committed scheme metadata and verifies a genuinely new protected row', async t => {
  const f = await setup(t, 'updateVaultImage'), id = 'new-vault-production-caller';
  const before = await read(f); assert.equal(before.snapshot.allVaultImages.some(vault => vault.vaultId === id), false);
  const op = f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId), f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, realm =>
    realm.create('Vault', builders.vault(f, id), Realm.UpdateMode.Modified));
  assert.equal(receipt.committed, true); assert.ok(receipt.intent);
  const producer = f.productionSagas(['currentBackupAppId', 'buildAutomaticVaultMutation',
    'queueCommittedBackupWorker', 'updateVaultImageWorker']);
  server.clearTrace();
  const result = await producer.run('updateVaultImageWorker', {
    payload: { vault: { id }, isUpdate: false }, originAppId: appId,
    originBackupAccountSession: f.transport.currentBackupAccountSession(), committedOperation: receipt,
  });
  if (!result.backupConfirmed) t.diagnostic(JSON.stringify({ writes: mutations(),
    phase: f.store.getState().bhr.backupRepairStateByAppId[appId], localVaultRetained: !!f.dbManager.getObjectById(f.RealmSchema.Vault, id) }));
  assert.equal(result.backupConfirmed, true);
  assert.equal(mutations().length, 1); assert.equal(mutations()[0].committed, true);
  const remote = await assertComplete(f), value = remote.snapshot.allVaultImages.find(vault => vault.vaultId === id);
  assert.deepEqual(value.scheme, plain(f.dbManager.getObjectById(f.RealmSchema.Vault, id).scheme));
});

test('same-account protected recovery revokes inherited canonical consent, advances its epoch and invalidates old local operation scope', async t => {
  const f = await setup(t), saga = recoverySagas(f);
  persist(f, f.RealmSchema.Signer, saga.scope.setupRecoveryKeySigningKey(mnemonic));
  assert.equal(await f.sagas.run('runBackupInspection', true, appId, true), true);
  const oldEpoch = f.transport.backupConsentEpoch(appId), oldRevision = f.transport.backupRevision(appId);
  const oldScope = f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId), f.transport.currentBackupAccountSession());
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  f.store.dispatch(f.account.setTempDetails({ hash: f.encryption.hash256('public-disposable-passcode-fixture'),
    realmId: f.nativeRealm().path, accountIdentifier: 'same account recovery' }));
  server.clearTrace();
  await saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic } });
  assert.equal(f.store.getState().storage.appCreated, true, f.store.getState().bhr.appImageError);
  assert.equal(f.store.getState().storage.appId, appId);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], false);
  assert.ok(f.transport.backupConsentEpoch(appId) > oldEpoch);
  assert.ok(f.transport.backupRevision(appId) > oldRevision);
  assert.equal(f.transport.captureBackupWriteIntent(appId), undefined);
  let attempted = false;
  const rejected = f.automatic.commitBackupLocalOperation(oldScope, () => { attempted = true; });
  assert.equal(rejected.committed, false); assert.equal(attempted, false);
  assert.equal(mutations().length, 0); assert.equal(server.trace.some(event => event.path === '/backup/v3/enroll'), false);
});

test('different-selected-account older recovery disables the target saved true consent without borrowing the selected account or auto-uploading', async t => {
  const source = await setup(t), sourceCrypto = recoverySagas(source);
  persist(source, source.RealmSchema.Signer, sourceCrypto.scope.setupRecoveryKeySigningKey(mnemonic));
  assert.equal(await source.sagas.run('runBackupInspection', true, appId, true), true);
  await server.seedLegacy(await source.payloadForCurrentImage());
  const f = await client(t);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
  const targetEpoch = f.transport.backupConsentEpoch(appId);
  const otherMnemonic = require('bip39').entropyToMnemonic('22'.repeat(16));
  const otherSeed = require('bip39').mnemonicToSeedSync(otherMnemonic);
  const otherId = crypto.createHash('sha256').update(otherSeed).digest('hex');
  await f.selectAccount(otherId);
  assert.equal(f.dbManager.updateObjectById(f.RealmSchema.KeeperApp, otherId, {
    primaryMnemonic: otherMnemonic, primarySeed: otherSeed.toString('hex'),
    imageEncryptionKey: f.encryption.generateEncryptionKey(otherSeed.toString('hex')),
  }), true);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: otherId, enabled: true }));
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  const originSession = f.transport.currentBackupAccountSession();
  const saga = recoverySagas(f);
  f.realmDatabase.closeDatabase(); const filename = path.join(f.directory, 'older-copy-new-realm.realm');
  assert.equal((await f.dbManager.initializeRealm(Buffer.alloc(64, 7), filename)).success, true);
  f.store.dispatch(f.account.setTempDetails({ hash: f.encryption.hash256('public-disposable-passcode-fixture'),
    realmId: filename, accountIdentifier: 'older target recovery' }));
  assert.equal(f.store.getState().storage.appId, otherId);
  server.clearTrace();
  await saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic,
    selection: { source: 'legacy-older', olderCopyConfirmed: true } } });
  assert.equal(f.store.getState().storage.appCreated, true, f.store.getState().bhr.appImageError);
  assert.equal(f.store.getState().storage.appId, appId);
  assert.equal(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp).id, appId);
  assert.ok(f.transport.currentBackupAccountSession() > originSession);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], false);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[otherId], true, 'The other account consent must stay scoped');
  assert.ok(f.transport.backupConsentEpoch(appId) > targetEpoch);
  assert.equal(f.transport.captureBackupWriteIntent(appId), undefined);
  assert.equal(server.trace.filter(event => event.legacyRead).length, 1);
  assert.equal(mutations().length, 0); assert.equal(server.trace.some(event => event.path === '/backup/v3/enroll'), false);
});

for (const recoverySource of ['protected', 'legacy-older']) {
  test(`${recoverySource}: a newer same-session discovery invalidates an older real decrypt before any local recovery change`, { timeout: 30000 }, async t => {
    const source = await setup(t), sourceCrypto = recoverySagas(source);
    persist(source, source.RealmSchema.Signer, sourceCrypto.scope.setupRecoveryKeySigningKey(mnemonic));
    assert.equal(await source.sagas.run('runBackupInspection', true, appId, true), true);
    if (recoverySource === 'legacy-older') await server.seedLegacy(await source.payloadForCurrentImage());
    const { f, saga } = await blankRecoveryClient(t, { inheritedConsent: true });
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
    const entered = barrier(), resume = barrier(); t.after(resume.release);
    const actualPause = f.image.pauseBackup;
    let held = false;
    // Delay one ordinary production per-record decrypt yield. The real timer,
    // AES, complete decoder, HTTP and recovery worker all remain in use.
    f.image.pauseBackup = async () => {
      await actualPause();
      if (!held) { held = true; entered.release(); await resume.promise; }
    };
    t.after(() => { f.image.pauseBackup = actualPause; });
    server.clearTrace();
    const older = saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic,
      ...(recoverySource === 'legacy-older'
        ? { selection: { source: 'legacy-older', olderCopyConfirmed: true } } : {}) } });
    await entered.promise;
    assert.equal(f.nativeRealm().objects('KeeperApp').length, 0);
    const originSession = f.transport.currentBackupAccountSession();
    const otherMnemonic = require('bip39').entropyToMnemonic('44'.repeat(16));
    await saga.run('getAppImageWorker', { payload: { primaryMnemonic: otherMnemonic } });
    assert.equal(f.store.getState().bhr.recoveryDiscovery.status, 'protected-absent');
    assert.equal(f.transport.currentBackupAccountSession(), originSession);
    const expectedState = plain(f.store.getState());
    const expectedEpoch = f.transport.backupConsentEpoch(appId);
    const expectedRevision = f.transport.backupRevision(appId);
    resume.release(); await older;
    t.diagnostic(JSON.stringify({ recoverySource, held,
      keeperApps: f.nativeRealm().objects('KeeperApp').length,
      consentStillTrue: f.store.getState().bhr.automaticCloudBackupByAppId[appId] === true,
      consentEpochUnchanged: f.transport.backupConsentEpoch(appId) === expectedEpoch,
      localRevisionUnchanged: f.transport.backupRevision(appId) === expectedRevision,
      sessionUnchanged: f.transport.currentBackupAccountSession() === originSession,
      reduxUnchanged: JSON.stringify(plain(f.store.getState())) === JSON.stringify(expectedState) }));
    assert.equal(f.nativeRealm().objects('KeeperApp').length, 0, 'The superseded recovery must not perform its first local write');
    for (const schema of f.nativeRealm().schema.filter(schema => !schema.embedded))
      assert.equal(f.nativeRealm().objects(schema.name).length, 0, 'The superseded recovery must preserve the blank native Realm');
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
    assert.equal(f.transport.backupConsentEpoch(appId), expectedEpoch);
    assert.equal(f.transport.backupRevision(appId), expectedRevision);
    assert.equal(f.transport.currentBackupAccountSession(), originSession);
    assert.deepEqual(plain(f.store.getState()), expectedState);
    assert.equal(mutations().length, 0);
    assert.equal(server.trace.some(event => event.path === '/backup/v3/enroll'), false);
  });
}

test('the actual recovery watcher cancels its called decrypt and recovery generators when a newer discovery arrives', { timeout: 30000 }, async t => {
  const source = await setup(t), sourceCrypto = recoverySagas(source);
  persist(source, source.RealmSchema.Signer, sourceCrypto.scope.setupRecoveryKeySigningKey(mnemonic));
  assert.equal(await source.sagas.run('runBackupInspection', true, appId, true), true);
  const { f, saga } = await blankRecoveryClient(t, { inheritedConsent: true });
  const entered = barrier(), resume = barrier(), decoded = barrier();
  t.after(resume.release);
  const actualPause = f.image.pauseBackup, actualPrepare = saga.scope.prepareRecoveryImage;
  let held = false;
  f.image.pauseBackup = async () => {
    await actualPause();
    if (!held) { held = true; entered.release(); await resume.promise; }
  };
  // Observe completion of the actual crypto/decoder even after cancellation;
  // never provide a decoded record or a replacement recovery result.
  saga.scope.prepareRecoveryImage = (...args) => actualPrepare(...args).finally(decoded.release);
  const actions = f.load('src/store/sagaActions/bhr');
  Object.assign(saga.scope, { GET_APP_IMAGE: actions.GET_APP_IMAGE }, f.load('src/store/utilities'));
  evaluate(declarations('src/store/sagas/bhr.ts', ['getAppImageWatcher']), saga.scope,
    'production-protected-recovery-watcher.ts');
  const { runSaga, stdChannel } = require('redux-saga'), channel = stdChannel();
  const called = new Map(), cancelledCalls = [];
  const dispatch = action => { const result = f.store.dispatch(action); channel.put(action); return result; };
  const task = runSaga({ channel, dispatch, getState: f.store.getState, sagaMonitor: {
    effectTriggered({ effectId, effect }) {
      if (effect.type !== 'CALL') return;
      if (effect.payload.fn === saga.scope.recoverApp) called.set(effectId, 'recoverApp');
      if (effect.payload.fn === saga.scope.prepareRecoveryImage) called.set(effectId, 'prepareRecoveryImage');
    },
    effectCancelled(effectId) { if (called.has(effectId)) cancelledCalls.push(called.get(effectId)); },
  } }, saga.scope.getAppImageWatcher);
  let unsubscribe;
  try {
    server.clearTrace(); dispatch(actions.getAppImage(mnemonic, false)); await entered.promise;
    assert.equal(f.nativeRealm().objects('KeeperApp').length, 0);
    const originSession = f.transport.currentBackupAccountSession();
    const newerDone = barrier();
    unsubscribe = f.store.subscribe(() => {
      if (f.store.getState().bhr.recoveryDiscovery.status === 'protected-absent') newerDone.release();
    });
    dispatch(actions.getAppImage(require('bip39').entropyToMnemonic('55'.repeat(16)), false));
    await newerDone.promise; unsubscribe(); unsubscribe = undefined;
    const expectedState = plain(f.store.getState());
    const expectedEpoch = f.transport.backupConsentEpoch(appId), expectedRevision = f.transport.backupRevision(appId);
    resume.release(); await decoded.promise; await tick();
    assert.ok(cancelledCalls.includes('prepareRecoveryImage'), 'The actual watcher must cancel its called decoder effect');
    assert.ok(cancelledCalls.includes('recoverApp'), 'Cancellation must propagate into the actual called recovery generator');
    for (const schema of f.nativeRealm().schema.filter(schema => !schema.embedded))
      assert.equal(f.nativeRealm().objects(schema.name).length, 0);
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
    assert.equal(f.transport.backupConsentEpoch(appId), expectedEpoch);
    assert.equal(f.transport.backupRevision(appId), expectedRevision);
    assert.equal(f.transport.currentBackupAccountSession(), originSession);
    assert.deepEqual(plain(f.store.getState()), expectedState);
    assert.equal(mutations().length, 0);
    assert.equal(server.trace.some(event => event.path === '/backup/v3/enroll'), false);
  } finally {
    unsubscribe?.(); resume.release(); task.cancel(); await task.toPromise(); channel.close();
    f.image.pauseBackup = actualPause; saga.scope.prepareRecoveryImage = actualPrepare;
  }
});

test('the actual recovery watcher cancels a called signer producer held before commit and preserves the newer discovery', { timeout: 30000 }, async t => {
  const source = await setup(t), sourceCrypto = recoverySagas(source);
  persist(source, source.RealmSchema.Signer, sourceCrypto.scope.setupRecoveryKeySigningKey(mnemonic));
  assert.equal(await source.sagas.run('runBackupInspection', true, appId, true), true);
  const { f, saga } = await blankRecoveryClient(t);
  const actions = f.load('src/store/sagaActions/bhr');
  Object.assign(saga.scope, { GET_APP_IMAGE: actions.GET_APP_IMAGE }, f.load('src/store/utilities'));
  evaluate(declarations('src/store/sagas/bhr.ts', ['getAppImageWatcher']), saga.scope,
    'production-protected-recovery-child-watcher.ts');
  const { runSaga, stdChannel } = require('redux-saga'), channel = stdChannel();
  const entered = barrier(), resume = barrier(), readCompleted = barrier();
  t.after(resume.release);
  const actualCollection = f.dbManager.getCollection;
  let childStarted = false, held = false, childCancelled = false, childCallId, phase = 'starting';
  t.after(() => t.diagnostic(JSON.stringify({ phase, childStarted, held, childCancelled,
    discoveryStatus: f.store.getState().bhr.recoveryDiscovery.status })));
  f.dbManager.getCollection = function (schema, ...args) {
    const actual = actualCollection.call(this, schema, ...args);
    if (childStarted && !held && schema === f.RealmSchema.Signer) {
      held = true; phase = 'child-query-held'; entered.release();
      // Hold only completion of the real native query; never synthesize its
      // records or replace the actual signer producer/commit implementation.
      return resume.promise.then(() => { readCompleted.release(); return actual; });
    }
    return actual;
  };
  const dispatch = action => { const result = f.store.dispatch(action); channel.put(action); return result; };
  const task = runSaga({ channel, dispatch, getState: f.store.getState, sagaMonitor: {
    effectTriggered({ effectId, effect }) {
      if (effect.type === 'CALL' && effect.payload.fn === saga.scope.addSigningDeviceWorker) {
        childStarted = true; childCallId = effectId;
      }
    },
    effectCancelled(effectId) { if (effectId === childCallId) childCancelled = true; },
  } }, saga.scope.getAppImageWatcher);
  const realmFingerprint = () => crypto.createHash('sha256').update(JSON.stringify(
    f.nativeRealm().schema.filter(schema => !schema.embedded).map(schema =>
      [schema.name, plain(Array.from(f.nativeRealm().objects(schema.name)))])
  )).digest('hex');
  let unsubscribe;
  try {
    server.clearTrace(); dispatch(actions.getAppImage(mnemonic, false)); await entered.promise;
    assert.equal(f.nativeRealm().objects('KeeperApp').length, 1);
    const originSession = f.transport.currentBackupAccountSession(), newerDone = barrier();
    unsubscribe = f.store.subscribe(() => {
      if (f.store.getState().bhr.recoveryDiscovery.status === 'protected-absent') newerDone.release();
    });
    dispatch(actions.getAppImage(require('bip39').entropyToMnemonic('66'.repeat(16)), false));
    await newerDone.promise; phase = 'newer-discovery-finished'; unsubscribe(); unsubscribe = undefined;
    const expectedState = plain(f.store.getState()), expectedRealm = realmFingerprint();
    const expectedEpoch = f.transport.backupConsentEpoch(appId), expectedRevision = f.transport.backupRevision(appId);
    resume.release(); await readCompleted.promise; await tick(); phase = 'old-query-settled';
    assert.equal(childCancelled, true, 'Cancellation must propagate to the actual called signer producer');
    assert.equal(realmFingerprint(), expectedRealm, 'The cancelled producer must not commit a native write');
    assert.equal(f.transport.backupConsentEpoch(appId), expectedEpoch);
    assert.equal(f.transport.backupRevision(appId), expectedRevision);
    assert.equal(f.transport.currentBackupAccountSession(), originSession);
    assert.deepEqual(plain(f.store.getState()), expectedState, 'No stale success, retry or source feedback may replace the newer discovery');
    assert.equal(mutations().length, 0);
    assert.equal(server.trace.some(event => event.path === '/backup/v3/enroll'), false);
  } finally {
    unsubscribe?.(); resume.release(); task.cancel(); await task.toPromise(); channel.close();
    f.dbManager.getCollection = actualCollection;
  }
});

test('the loopback fixture rejects nonliteral raw request targets before any upstream request', { timeout: 15000 }, async () => {
  const target = new URL(server.url); assert.equal(target.hostname, '127.0.0.1');
  const http = require('node:http'); server.clearTrace();
  for (const rawTarget of [
    'http://outside.invalid/backup/v3/snapshot', '//outside.invalid/backup/v3/snapshot',
    '/\\outside.invalid/backup/v3/snapshot', '/backup/v3/snapshot?query=1',
    '/backup%2fv3%2fsnapshot', '/backup/v3/snapshot/extra', '/not-a-backup-route',
  ]) {
    // Raw targets travel only over this fixed owned loopback socket. Never
    // resolve or contact the authority spelled inside an invalid request path.
    const status = await new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port: Number(target.port), method: 'POST',
        path: rawTarget, headers: { 'content-type': 'application/json', 'content-length': 2 } }, response => {
        response.resume(); response.once('end', () => resolve(response.statusCode));
        response.once('error', reject);
      });
      request.setTimeout(3000, () => request.destroy(new Error('Owned loopback request timed out')));
      request.once('error', reject); request.end('{}');
    });
    assert.equal(status, 400);
    assert.equal(server.trace.length, 0, 'No invalid target may enter an allowed fixture route');
    assert.equal(server.backend.trace.length, 0, 'No invalid target may reach the actual backend router');
  }
});
