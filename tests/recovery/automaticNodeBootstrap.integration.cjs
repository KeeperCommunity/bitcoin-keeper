// Actual production connectToNodeWorker module and dispatch middleware, native
// encrypted Realm, real crypto and transactional loopback Relay. The Electrum
// provider is the only connection boundary stub: no public servers/fees are
// contacted. This is not rendered native UI, MMKV or live Electrum acceptance.
const assert = require('node:assert/strict');
const { test: nodeTest, before, after } = require('node:test');
const { runSaga } = require('redux-saga');
const { createRealmClient, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');

const fixtureModule = process.env.KEEPER_RELAY_FIXTURE_MODULE;
assert.ok(fixtureModule, 'Set the pinned real transactional Relay fixture');
const { createFixture } = require(fixtureModule);
let server;
before(async () => { server = await createFixture(); });
after(async () => { await server?.close(); Realm.shutdown(); });
const test = (name, body) => nodeTest(name, { timeout: 20_000 }, body);
const writes = () => server.trace.filter(event => event.path === '/revisionedBackupMutation');

function deferred(t) {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  t.after(() => resolve());
  return { promise, resolve };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'Expected genuine HTTP boundary was not reached');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

function createNode(f, node) {
  assert.equal(f.dbManager.createObject(f.RealmSchema.NodeConnect,
    f.defaults(f.RealmSchema.NodeConnect, node)), true);
}

function holdFirstNodeRead(t, f) {
  const entered = deferred(t);
  const release = deferred(t);
  const original = f.dbManager.getCollection;
  let held = false;
  // Scheduling adapter only: defer the unchanged actual Realm query. No node
  // data, transaction result or backup proof is substituted.
  f.dbManager.getCollection = (...args) => {
    if (!held && args[0] === f.RealmSchema.NodeConnect) {
      held = true;
      entered.resolve();
      return release.promise.then(() => original(...args));
    }
    return original(...args);
  };
  t.after(() => { f.dbManager.getCollection = original; });
  return { entered: entered.promise, release: release.resolve };
}

async function setup(t, options = {}) {
  await server.reset();
  const f = await createRealmClient(server.url, { withNetwork: true, ...options });
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  const predefined = f.load('src/services/electrum/predefinedNodes');
  f.predefined = predefined;
  if (options.prepare) options.prepare(f);
  await server.seed(await f.payloadForCurrentImage());
  assert.equal(await f.repair.inspectBackup(f.appId, false, () => {}), 'verified');
  f.initial = await server.snapshot(f.appId);
  server.clearTrace();
  let peers = [];
  let generation = 0;
  let connectImpl;
  let connectedPeerIndex = 0;
  f.providerCalls = [];
  const electrum = {
    setActivePeer(nodes) { peers = Array.from(nodes); f.providerCalls.push('setActivePeer'); },
    async connect() {
      const requestGeneration = ++generation;
      f.providerCalls.push('connect');
      if (connectImpl) return connectImpl(requestGeneration);
      return { connected: true, connectedTo: 'disposable-provider.invalid', generation: requestGeneration };
    },
    getActivePeer: () => peers[connectedPeerIndex],
    getConnectionGeneration: () => generation,
  };
  f.setConnect = value => { connectImpl = value; };
  f.setConnectedPeerIndex = value => { connectedPeerIndex = value; };
  f.bindings['src/services/electrum/client'] = electrum;
  // These are unchanged selected production functions, not fabricated backup
  // replies. The boundary avoids unrelated React Native bootstrap imports.
  f.sagas = f.productionSagas([
    'currentBackupAppId', 'buildAutomaticAppMutation', 'queueCommittedBackupWorker', 'updateAppImageWorker',
  ]);
  f.bindings['src/store/sagas/bhr'] = f.sagas.scope;
  f.worker = f.load('src/store/sagas/network').connectToNodeWorker;
  f.connectRaw = (action) => runSaga({ getState: f.store.getState, dispatch: f.store.dispatch }, f.worker, action).toPromise();
  f.drain = () => f.transport.withBackupSession(f.appId, async () => {});
  f.connect = async action => {
    const result = await f.connectRaw(action);
    // Observe completion of detached actual backup work for proof and cleanup.
    // This does not change the production parent task's completion semantics.
    await f.drain();
    return result;
  };
  f.connectDispatched = () => f.connect(f.store.dispatch(f.load('src/store/sagaActions/network').connectToNode()));
  f.localNodes = () => plain(Array.from(f.dbManager.getCollection(f.RealmSchema.NodeConnect)));
  f.remote = async () => f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    await server.snapshot(f.appId), f.appId, () => {}, true);
  return f;
}

async function assertConfirmed(f, count = 1) {
  assert.equal(writes().length, count, 'The actual network caller must enqueue its committed node image');
  assert.ok(writes().every(event => event.committed));
  const current = await server.snapshot(f.appId);
  assert.notEqual(current.revision, f.initial.revision);
  assert.equal(current.revision, writes().at(-1).response.newRevision);
  const remote = await f.remote();
  assert.equal(await f.image.compareImages(await f.repair.captureBackupImage(), remote), 'matched');
  const localNodes = Object.fromEntries(f.localNodes().map(node => [String(node.id), f.image.recoveryContent('nodes', node)]));
  assert.deepEqual(plain(remote.nodes), plain(localNodes));
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  const state = f.store.getState().bhr;
  assert.equal(state.pendingAllBackupByAppId[f.appId], false);
  assert.equal(state.backupRepairStateByAppId[f.appId], 'verified');
  assert.equal(state.backupRepairCompletedByAppId[f.appId], true);
}

function assertConnectionSuccessful(f) {
  const results = f.actions.filter(action => action.type === 'login/electrumClientConnectionExecuted');
  assert.equal(results.at(-1)?.payload.successful, true,
    'Backup errors must not manufacture an Electrum connection failure');
}

async function assertPending(f, { committed = false } = {}) {
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].committed, committed);
  assert.deepEqual(f.localNodes().map(node => node.id).sort(), [336, 337]);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  const bhr = f.store.getState().bhr;
  assert.equal(bhr.pendingAllBackupByAppId[f.appId], true);
  assert.notEqual(bhr.backupRepairStateByAppId[f.appId], 'verified');
  assertConnectionSuccessful(f);
}

test('node bootstrap actual caller: Verified empty node image creates defaults and completes an acknowledged backup', async t => {
  const f = await setup(t);
  assert.deepEqual(f.localNodes(), []);
  assert.deepEqual(plain((await f.remote()).nodes), {});
  server.clearTrace();
  // This reproduces the production refresh/login yield call(connectToNodeWorker)
  // path with no synthetic action or externally supplied backup intent.
  await f.connect();
  assert.deepEqual(f.localNodes().map(node => node.id).sort(), [336, 337]);
  assert.equal(f.store.getState().network.initialNodesSaved, true);
  assert.equal(f.store.getState().network.testnetFallbackNodeAddedByAppId[f.appId], true);
  assert.deepEqual(f.providerCalls, ['setActivePeer', 'connect']);
  await assertConfirmed(f);
});

test('dispatched CONNECT_TO_NODE uses production origin middleware and the same committed backup path', async t => {
  const f = await setup(t);
  const action = f.store.dispatch(f.load('src/store/sagaActions/network').connectToNode());
  assert.equal(action.originAppId, f.appId);
  assert.equal(f.transport.isCapturedBackupWriteIntent(action.originBackupWriteIntent), true);
  await f.connect(action);
  await assertConfirmed(f);
});

test('fallback migration backs up all saved mixed-network nodes and reconnect respects an explicitly deleted fallback', async t => {
  const f = await setup(t, { prepare(f) {
    createNode(f, f.predefined.predefinedTestnetNodes[0]);
    createNode(f, { id: 900, host: 'public-custom-mainnet.invalid', port: '50002', useSSL: true,
      networkType: f.enums.NetworkType.MAINNET });
    f.store.dispatch(f.network.setInitialNodesSaved(true));
  } });
  await f.connect();
  await assertConfirmed(f);
  assert.deepEqual(f.localNodes().map(node => node.id).sort((a, b) => a - b), [336, 337, 900]);
  const operation = f.automatic.beginBackupLocalOperation(f.appId,
    f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(operation, realm => {
    realm.delete(realm.objects(f.RealmSchema.NodeConnect).filtered('id == $0', 337));
  });
  assert.equal(receipt.committed, true);
  const removed = await f.sagas.run('updateAppImageWorker', { payload: { updateNodes: true },
    originAppId: f.appId, originBackupAccountSession: f.transport.currentBackupAccountSession(),
    committedOperation: receipt });
  assert.equal(removed.backupConfirmed, true);
  server.clearTrace();
  await f.connect();
  assert.equal(writes().length, 0);
  assert.deepEqual(f.localNodes().map(node => node.id).sort((a, b) => a - b), [336, 900]);
  assert.deepEqual(Object.keys((await f.remote()).nodes).sort(), ['336', '900']);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
});

test('legacy initial-node migration preserves custom same-ID fields and the complete mixed-network set', async t => {
  const f = await setup(t, { prepare(f) {
    createNode(f, { ...f.predefined.predefinedTestnetNodes[0], host: 'owner-custom-testnet.invalid', port: '60123' });
    createNode(f, { id: 900, host: 'owner-custom-mainnet.invalid', port: '60002', useSSL: true,
      networkType: f.enums.NetworkType.MAINNET });
    assert.equal(f.dbManager.createObject(f.RealmSchema.DefaultNodeConnect,
      f.defaults(f.RealmSchema.DefaultNodeConnect, f.predefined.predefinedTestnetNodes[0])), true);
  } });
  await f.connect();
  const nodes = f.localNodes();
  assert.deepEqual(nodes.map(node => node.id).sort((a, b) => a - b), [336, 337, 900]);
  assert.equal(nodes.find(node => node.id === 336).host, 'owner-custom-testnet.invalid');
  assert.equal(nodes.find(node => node.id === 336).port, '60123');
  await assertConfirmed(f);
});

test('consent OFF keeps bootstrap local and sends no backup HTTP', async t => {
  const f = await setup(t);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: false }));
  await f.connect();
  assert.deepEqual(f.localNodes().map(node => node.id).sort(), [336, 337]);
  assert.equal(server.trace.length, 0);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], false);
  assert.equal((await server.snapshot(f.appId)).revision, f.initial.revision);
  assertConnectionSuccessful(f);
});

test('missing original baseline preserves local defaults without manufacturing upload authority', async t => {
  const f = await setup(t);
  f.transport.clearVerifiedRemoteRevision(f.appId);
  await f.connect();
  assert.deepEqual(f.localNodes().map(node => node.id).sort(), [336, 337]);
  assert.equal(writes().length, 0);
  assert.equal((await server.snapshot(f.appId)).revision, f.initial.revision);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assertConnectionSuccessful(f);
});

test('explicit missing dispatch-time intent stays missing after a later genuine verification', async t => {
  const f = await setup(t);
  f.transport.clearVerifiedRemoteRevision(f.appId);
  const action = f.store.dispatch(f.load('src/store/sagaActions/network').connectToNode());
  assert.equal(action.originBackupWriteIntent, undefined);
  assert.equal(await f.repair.inspectBackup(f.appId, false, () => {}), 'verified');
  server.clearTrace();
  await f.connect(action);
  assert.equal(writes().length, 0);
  assert.deepEqual(f.localNodes().map(node => node.id).sort(), [336, 337]);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.equal((await server.snapshot(f.appId)).revision, f.initial.revision);
});

test('a reconnect with no recovery change performs no write and retains the verified generation', async t => {
  const f = await setup(t, { prepare(f) {
    for (const node of f.predefined.predefinedTestnetNodes) createNode(f, node);
    f.store.dispatch(f.network.setInitialNodesSaved(true));
    f.store.dispatch(f.network.setTestnetFallbackNodeAdded(f.appId));
  } });
  const generation = f.automatic.currentCommittedBackupGeneration(f.appId);
  await f.connect();
  assert.equal(server.trace.length, 0);
  assert.equal(f.automatic.currentCommittedBackupGeneration(f.appId), generation);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  assertConnectionSuccessful(f);
});

test('an actual native validation failure rolls back the entire initial-node group and leaves migration flags unset', async t => {
  const f = await setup(t);
  // Native schema validation fails on the second row, after the first create;
  // this exercises actual Realm rollback rather than a fake write result.
  f.predefined.predefinedTestnetNodes[1].port = { invalid: 'native string field' };
  await f.connect();
  assert.deepEqual(f.localNodes(), []);
  assert.equal(f.store.getState().network.initialNodesSaved, false);
  assert.equal(f.store.getState().network.testnetFallbackNodeAddedByAppId[f.appId], undefined);
  assert.equal(writes().length, 0);
  assert.equal((await server.snapshot(f.appId)).revision, f.initial.revision);
  assert.deepEqual(f.providerCalls, []);
});

test('a bootstrap paused before commit cannot cross A to B to A', async t => {
  const f = await setup(t);
  const hold = holdFirstNodeRead(t, f);
  const connecting = f.connect();
  await hold.entered;
  const session = f.transport.currentBackupAccountSession();
  await f.selectAccount('disposable-node-account-b');
  await f.selectAccount(f.appId);
  assert.notEqual(f.transport.currentBackupAccountSession(), session);
  hold.release();
  await connecting;
  assert.deepEqual(f.localNodes(), []);
  assert.equal(f.store.getState().network.initialNodesSaved, false);
  assert.equal(writes().length, 0);
  assert.deepEqual(f.providerCalls, []);
});

test('a network switch before native commit prevents old-network defaults and stale connection completion', async t => {
  const f = await setup(t);
  const hold = holdFirstNodeRead(t, f);
  const connecting = f.connect();
  await hold.entered;
  f.store.dispatch(f.settings.setBitcoinNetwork(f.enums.NetworkType.MAINNET));
  hold.release();
  await connecting;
  assert.deepEqual(f.localNodes(), []);
  assert.equal(writes().length, 0);
  assert.deepEqual(f.providerCalls, []);
});

test('a same-account Realm replacement before commit cannot borrow the unchanged account session', async t => {
  const f = await setup(t);
  const hold = holdFirstNodeRead(t, f);
  const originalRealm = f.nativeRealm();
  const session = f.transport.currentBackupAccountSession();
  const connecting = f.connect();
  await hold.entered;
  // Close then reopen the same native file through production APIs. Opening
  // a second cached same-path wrapper is a different Realm lifecycle boundary.
  f.realmDatabase.closeDatabase();
  await f.selectAccount(f.appId);
  assert.notEqual(f.nativeRealm(), originalRealm);
  assert.equal(f.transport.currentBackupAccountSession(), session);
  hold.release();
  await connecting;
  assert.deepEqual(f.localNodes(), []);
  assert.equal(f.store.getState().network.initialNodesSaved, false);
  assert.equal(writes().length, 0);
  assert.deepEqual(f.providerCalls, []);
});

test('a superseded bootstrap worker cannot publish after the current worker completes', async t => {
  const f = await setup(t);
  const hold = holdFirstNodeRead(t, f);
  const older = f.connect();
  await hold.entered;
  await f.connect();
  await assertConfirmed(f);
  const currentEpoch = f.transport.backupBaselineEpoch(f.appId);
  hold.release();
  await older;
  assert.equal(writes().length, 1);
  assert.equal(f.transport.backupBaselineEpoch(f.appId), currentEpoch);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  assert.deepEqual(f.providerCalls, ['setActivePeer', 'connect']);
});

for (const [mode, committed] of [['409', false], ['malformed', true], ['lost-reply', true]]) {
  test(`node bootstrap ${mode} preserves defaults and reports backup pending independently of Electrum`, async t => {
    const f = await setup(t);
    server.armFault({ mode, operation: 'updateAppImage' });
    await f.connect();
    await assertPending(f, { committed });
  });
}

test('malformed final snapshot metadata cannot publish Verified after the real node CAS', async t => {
  const f = await setup(t);
  server.armFault({ mode: 'malformed-metadata', after: 1 });
  await f.connect();
  await assertPending(f, { committed: true });
});

test('native node mutation during final readback preserves both local changes but withholds Verified', async t => {
  const f = await setup(t);
  server.armFault({ mode: 'before-snapshot-reply', after: 1, beforeReply() {
    createNode(f, { id: 901, host: 'late-local-node.invalid', port: '50002', useSSL: true,
      networkType: f.enums.NetworkType.TESTNET });
  } });
  await f.connect();
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].committed, true);
  assert.deepEqual(f.localNodes().map(node => node.id).sort((a, b) => a - b), [336, 337, 901]);
  assert.deepEqual(Object.keys((await f.remote()).nodes).sort(), ['336', '337']);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assertConnectionSuccessful(f);
});

test('after-send A to B to A cannot apply an old bootstrap acknowledgement to the new session', async t => {
  const f = await setup(t);
  server.armFault({ mode: 'delay-reply', operation: 'updateAppImage', delayMs: 1200 });
  let settled = false;
  const connecting = f.connect().then(value => { settled = true; return value; });
  await waitFor(() => writes()[0]?.committed);
  assert.equal(settled, false);
  await f.selectAccount('disposable-node-account-b');
  await f.selectAccount(f.appId);
  const epoch = f.transport.backupBaselineEpoch(f.appId);
  const boundary = f.actions.length;
  await connecting;
  assert.equal(writes().length, 1);
  assert.deepEqual(f.localNodes().map(node => node.id).sort(), [336, 337]);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.equal(f.actions.slice(boundary).some(action => action.type === f.bhr.commitBackupInspection.type), false);
  assert.ok(f.transport.backupBaselineEpoch(f.appId) >= epoch);
});

test('detached backup does not hold connection completion and real connection flags do not invalidate recovery', async t => {
  const f = await setup(t);
  const entered = deferred(t);
  const release = deferred(t);
  server.armFault({ mode: 'before-snapshot-reply', beforeReply() {
    entered.resolve(); return release.promise;
  } });
  f.setConnectedPeerIndex(1);
  const flagWrites = [];
  const originalUpdate = f.dbManager.updateObjectById;
  f.dbManager.updateObjectById = (...args) => {
    const before = f.automatic.currentCommittedBackupGeneration(f.appId);
    const result = originalUpdate(...args);
    flagWrites.push({ schema: args[0], id: args[1], patch: args[2], result,
      before, after: f.automatic.currentCommittedBackupGeneration(f.appId),
      queued: f.transport.backupQueuedRevision(f.appId) });
    return result;
  };
  let parentFinished = false;
  const parent = f.connectRaw().then(value => { parentFinished = true; return value; });
  try {
    await entered.promise;
    await waitFor(() => parentFinished);
    assertConnectionSuccessful(f);
    assert.deepEqual(f.providerCalls, ['setActivePeer', 'connect']);
    assert.equal(writes().length, 0, 'The real baseline HTTP reply remains held');
    assert.equal(flagWrites.length, 2, 'Both selected-node flags use actual dbManager/Realm writes');
    for (const write of flagWrites) {
      assert.equal(write.schema, f.RealmSchema.NodeConnect);
      assert.equal(write.result, true);
      assert.equal(write.before, write.after);
      assert.ok(write.queued > 0, 'The backup was already queued before the cache write');
    }
    assert.deepEqual(f.localNodes().map(node => [node.id, node.isConnected]).sort(), [[336, false], [337, true]]);
  } finally {
    f.dbManager.updateObjectById = originalUpdate;
    release.resolve();
    await parent;
    await f.drain();
  }
  await assertConfirmed(f);
  let transactions = 0;
  const originalTransaction = f.realmDatabase.writeTransaction;
  f.realmDatabase.writeTransaction = (...args) => {
    transactions += 1; return originalTransaction(...args);
  };
  try {
    server.clearTrace();
    await f.connect();
    assert.equal(transactions, 0, 'A settled reconnect with the active peer unchanged is a genuine native no-op');
    assert.equal(server.trace.length, 0);
    assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  } finally {
    f.realmDatabase.writeTransaction = originalTransaction;
  }
});
