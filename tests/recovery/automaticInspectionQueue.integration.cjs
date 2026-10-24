// Native encrypted Realm, production wallet/inspection sagas and real AES/CAS
// HTTP into the pinned transactional Relay. Scheduling gates hold real replies;
// they never replace backup proof, crypto, persistence or acknowledgement data.
const assert = require('node:assert/strict');
const { test: nodeTest, before, after } = require('node:test');
const {
  createRealmClient, declarations, evaluate, Realm,
} = require('./automaticWriteRealmRelay.fixture.cjs');

const fixtureModule = process.env.KEEPER_RELAY_FIXTURE_MODULE;
assert.ok(fixtureModule, 'Set KEEPER_RELAY_FIXTURE_MODULE to the pinned production Relay fixture');
const { createFixture } = require(fixtureModule);
let server;
before(async () => { server = await createFixture(); });
after(async () => { await server?.close(); Realm.shutdown(); });

const writes = () => server.trace.filter(event => event.path === '/revisionedBackupMutation');
const snapshots = () => server.trace.filter(event => event.path === '/getBackupSnapshot');
const initialName = 'Initial wallet';
const renamed = 'Committed rename';
const test = (name, run) => nodeTest(name, { timeout: 15_000 }, run);

function deferred(t) {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  t.after(() => resolve());
  return { promise, resolve };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}

function wallet(f) {
  return f.defaults(f.RealmSchema.Wallet, {
    id: 'wallet', entityKind: f.enums.EntityKind.WALLET, type: f.enums.WalletType.DEFAULT,
    networkType: f.enums.NetworkType.TESTNET, scriptType: 'P2WPKH',
    derivationDetails: f.defaults(f.RealmSchema.WalletDerivationDetails, {
      instanceNum: 0, xDerivationPath: "m/84'/1'/0'",
    }),
    presentationData: f.defaults(f.RealmSchema.WalletPresentationData, {
      name: initialName, visibility: 'DEFAULT',
    }),
    specs: f.defaults(f.RealmSchema.WalletSpecs, {
      xpub: 'intentionally-unspendable-public-fixture', nextFreeAddressIndex: 1,
    }),
  });
}

async function setup(t, options = {}) {
  await server.reset();
  const f = await createRealmClient(server.url, options);
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet(f)), true);
  await server.seed(await f.payloadForCurrentImage());
  assert.equal(await f.repair.inspectBackup(f.appId, false, () => {}), 'verified');
  const sagas = f.productionSagas([
    'currentBackupAppId', 'buildAutomaticAppMutation', 'queueCommittedBackupWorker',
    'updateAppImageWorker', 'backupInspectionOwners', 'runBackupInspection',
  ]);
  evaluate(declarations('src/store/sagas/wallets.ts', [
    'currentWalletAccountId', 'assertWalletAccount', 'updateWalletDetailsWorker',
  ]), sagas.scope, 'production-rename-producer.ts');
  f.status = (session = f.transport.currentBackupAccountSession()) =>
    sagas.run('runBackupInspection', false, f.appId, false, session);
  f.rename = () => {
    // Use the actual origin middleware, including its runtime-branded original
    // intent. Host runSaga delivers the stamped action to the unchanged worker;
    // this is not rendered React Native UI or native navigation timing.
    const action = f.store.dispatch({
      type: 'UPDATE_WALLET_DETAILS',
      payload: { wallet: wallet(f), details: { name: renamed, description: 'Local description' } },
    });
    f.renameAction = action;
    return sagas.run('updateWalletDetailsWorker', action);
  };
  f.localName = () => f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet').presentationData.name;
  f.remoteImage = async () => f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    await server.snapshot(f.appId), f.appId, () => {}, true);
  f.initialSnapshot = await server.snapshot(f.appId);
  server.clearTrace();
  return f;
}

async function assertConfirmed(f) {
  const trace = [...server.trace];
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].operation, 'updateAppImage');
  assert.equal(writes()[0].committed, true);
  assert.equal(f.localName(), renamed);
  const remote = await f.remoteImage();
  assert.equal(remote.wallets.wallet.presentationData.name, renamed);
  assert.equal(await f.image.compareImages(await f.repair.captureBackupImage(), remote), 'matched');
  const final = await server.snapshot(f.appId);
  assert.notEqual(final.revision, f.initialSnapshot.revision);
  assert.equal(final.revision, writes()[0].response.newRevision);
  assert.ok(f.transport.captureBackupWriteIntent(f.appId));
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  const bhr = f.store.getState().bhr;
  assert.equal(bhr.pendingAllBackupByAppId[f.appId], false);
  assert.equal(bhr.backupRepairStateByAppId[f.appId], 'verified');
  assert.equal(bhr.backupRepairCompletedByAppId[f.appId], true);
  assert.equal(bhr.backupRepairRunningByAppId[f.appId], false);
  assert.deepEqual(trace.map(event => event.path), [
    '/getBackupSnapshot', '/revisionedBackupMutation', '/getBackupSnapshot', '/getBackupSnapshot',
  ]);
}

async function assertPending(f) {
  assert.equal(f.localName(), renamed);
  assert.equal(writes().length, 0);
  assert.equal((await server.snapshot(f.appId)).revision, f.initialSnapshot.revision);
  assert.equal((await f.remoteImage()).wallets.wallet.presentationData.name, initialName);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
}

test('ordinary dispatched rename finishes one real CAS before a later read-only status check', async t => {
  const f = await setup(t);
  assert.equal(await f.rename(), true);
  assert.equal(await f.status(), true);
  await assertConfirmed(f);
});

test('writer-first: a check queued before writer admission cannot revoke its originating baseline', async t => {
  const f = await setup(t);
  const entered = deferred(t);
  const release = deferred(t);
  const blocker = f.transport.withBackupSession(f.appId, () => {
    entered.resolve(); return release.promise;
  });
  await entered.promise;
  const epoch = f.transport.backupBaselineEpoch(f.appId);
  const writing = f.rename();
  const checking = f.status();
  const epochAfterRequest = f.transport.backupBaselineEpoch(f.appId);
  const requestsBeforeAdmission = server.trace.length;
  release.resolve();
  await blocker;
  assert.equal(await writing, true);
  assert.equal(await checking, true);
  assert.equal(f.localName(), renamed);
  assert.ok(f.renameAction.originBackupWriteIntent);
  assert.equal(epochAfterRequest, epoch);
  assert.equal(requestsBeforeAdmission, 0);
  await assertConfirmed(f);
});

for (const [stage, afterSnapshot] of [['initial snapshot', 0], ['final readback', 1]]) {
  test(`writer-first: read-only inspection requested during ${stage} waits without changing its proof`, async t => {
    const f = await setup(t);
    const entered = deferred(t);
    const release = deferred(t);
    let checking;
    let epochBeforeCheck;
    let epochAfterCheck;
    server.armFault({ mode: 'before-snapshot-reply', after: afterSnapshot, beforeReply() {
      epochBeforeCheck = f.transport.backupBaselineEpoch(f.appId);
      checking = f.status();
      epochAfterCheck = f.transport.backupBaselineEpoch(f.appId);
      entered.resolve();
      return release.promise;
    } });
    const writing = f.rename();
    await entered.promise;
    assert.equal(writes().length, afterSnapshot);
    if (afterSnapshot) assert.equal(writes()[0].committed, true);
    release.resolve();
    assert.equal(await writing, true);
    assert.equal(await checking, true);
    assert.equal(epochAfterCheck, epochBeforeCheck);
    await assertConfirmed(f);
  });
}

test('writer-first: a check during the genuinely committed but held CAS acknowledgement waits', async t => {
  const f = await setup(t);
  server.armFault({ mode: 'delay-reply', operation: 'updateAppImage', delayMs: 1200 });
  let settled = false;
  const writing = f.rename().then(result => { settled = true; return result; });
  await waitFor(() => writes()[0]?.committed, 'The actual Relay CAS must commit before the held reply');
  assert.equal(settled, false, 'The client must still be awaiting its real acknowledgement');
  const epoch = f.transport.backupBaselineEpoch(f.appId);
  const checking = f.status();
  const epochAfterCheck = f.transport.backupBaselineEpoch(f.appId);
  assert.equal(await writing, true);
  assert.equal(await checking, true);
  assert.equal(epochAfterCheck, epoch);
  await assertConfirmed(f);
});

test('inspection-first: a later captured rename receipt keeps its local commit but cannot borrow a new baseline', async t => {
  const f = await setup(t);
  const entered = deferred(t);
  const release = deferred(t);
  const blocker = f.transport.withBackupSession(f.appId, () => {
    entered.resolve(); return release.promise;
  });
  await entered.promise;
  const checking = f.status();
  const writing = f.rename();
  const originatingIntent = f.renameAction.originBackupWriteIntent;
  release.resolve();
  await blocker;
  assert.equal(await checking, false);
  assert.equal(await writing, true, 'Cloud rejection must not undo the local rename');
  assert.ok(originatingIntent, 'Later dispatch captured only the original verified base');
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'different');
  await assertPending(f);
});

test('inspection already admitted: a new rename has no original baseline and its local data survives the read-only retry', async t => {
  const f = await setup(t);
  const entered = deferred(t);
  const release = deferred(t);
  server.armFault({ mode: 'before-snapshot-reply', beforeReply() {
    entered.resolve(); return release.promise;
  } });
  const checking = f.status();
  await entered.promise;
  const writing = f.rename();
  assert.equal(f.renameAction.originBackupWriteIntent, undefined);
  release.resolve();
  assert.equal(await writing, true);
  assert.equal(await checking, false);
  assert.equal(snapshots().length, 2, 'Only the read-only inspection retries after the queued local change');
  await assertPending(f);
});

test('missing original verified baseline still preserves a rename and cannot create upload authority', async t => {
  const f = await setup(t);
  f.transport.clearVerifiedRemoteRevision(f.appId);
  assert.equal(await f.rename(), true);
  assert.equal(f.renameAction.originBackupWriteIntent, undefined);
  assert.equal(await f.status(), false);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'different');
  await assertPending(f);
});

async function recordMatchedBaseline(f) {
  // Explicit public-provider-registration boundary for stale-owner/retry
  // tests, not a nested queued inspection. Create no invented revision or
  // ciphertext: real HTTP must decrypt/compare to current native Realm before
  // the production recorder runs, with metadata/handle/session/fingerprint held.
  const snapshotTools = f.load('src/services/backup/localSnapshot');
  const database = f.nativeRealm();
  const session = f.transport.currentBackupAccountSession();
  const before = snapshotTools.captureLocalRecovery(database);
  const current = await server.snapshot(f.appId);
  const remote = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    current, f.appId, () => {}, true);
  assert.equal(await f.image.compareImages(await f.repair.captureBackupImage(), remote), 'matched');
  assert.equal(snapshotTools.backupMetadataMatches(before.app, current.appImage), true);
  assert.equal(f.nativeRealm(), database);
  assert.equal(f.transport.currentBackupAccountSession(), session);
  assert.equal(snapshotTools.captureLocalRecovery(database).fingerprint, before.fingerprint);
  f.transport.recordVerifiedRemoteRevision(f.appId, current.revision, session);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  return f.transport.captureBackupWriteIntent(f.appId);
}

test('an old A session inspection queued before A to B to A cannot erase the new session baseline', async t => {
  const f = await setup(t);
  const entered = deferred(t);
  const release = deferred(t);
  const blocker = f.transport.withBackupSession(f.appId, () => {
    entered.resolve(); return release.promise;
  });
  await entered.promise;
  const oldSession = f.transport.currentBackupAccountSession();
  const oldCheck = f.repair.inspectBackup(f.appId, false, () => {}, false, oldSession);
  await f.selectAccount('disposable-other-account');
  await f.selectAccount(f.appId);
  assert.notEqual(f.transport.currentBackupAccountSession(), oldSession);
  const fresh = await recordMatchedBaseline(f);
  const epoch = f.transport.backupBaselineEpoch(f.appId);
  const generation = f.automatic.currentCommittedBackupGeneration(f.appId);
  const session = f.transport.currentBackupAccountSession();
  assert.equal(f.transport.isCapturedBackupWriteIntent(fresh), true);
  server.clearTrace();
  release.resolve();
  await blocker;
  assert.equal(await oldCheck, 'unverified');
  assert.equal(f.transport.backupBaselineEpoch(f.appId), epoch);
  assert.equal(f.automatic.currentCommittedBackupGeneration(f.appId), generation);
  assert.equal(f.transport.currentBackupAccountSession(), session);
  assert.equal(f.transport.captureBackupWriteIntent(f.appId).baseRevision, fresh.baseRevision);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  assert.equal(server.trace.length, 0, 'A stale queued inspection cannot read for the new session');
  assert.equal(await f.rename(), true, 'The preserved baseline must remain usable by a fresh production producer');
  assert.equal(await f.status(), true);
  await assertConfirmed(f);
});

test('coalesced read-only requests share one inspection and do not clear the baseline again', async t => {
  const f = await setup(t);
  const entered = deferred(t);
  const release = deferred(t);
  server.armFault({ mode: 'before-snapshot-reply', beforeReply() {
    entered.resolve(); return release.promise;
  } });
  const firstPhases = [];
  const secondPhases = [];
  const first = f.repair.inspectBackup(f.appId, false, phase => firstPhases.push(phase));
  await entered.promise;
  const epoch = f.transport.backupBaselineEpoch(f.appId);
  const second = f.repair.inspectBackup(f.appId, false, phase => secondPhases.push(phase));
  assert.equal(second, first);
  assert.equal(f.transport.backupBaselineEpoch(f.appId), epoch);
  assert.deepEqual(secondPhases, ['checking']);
  release.resolve();
  assert.equal(await first, 'verified');
  assert.equal(await second, 'verified');
  assert.deepEqual(firstPhases, ['checking', 'verified']);
  assert.deepEqual(secondPhases, ['checking', 'verified']);
  assert.equal(snapshots().length, 1);
  assert.equal(writes().length, 0);
});

test('a read-only transient retry owns its new admission and retains the original deadline', async t => {
  // Compress only actual transport abort timers. Axios still performs real
  // HTTP and aborts a genuinely held reply; the inspection clock/deadline and
  // every production retry/queue guard remain unchanged.
  const f = await setup(t, { backupTimerCeilingMs: 1000 });
  const deadlines = [];
  const originalPost = f.transport.boundedBackupPost;
  f.transport.boundedBackupPost = (...args) => {
    deadlines.push(args[2]);
    return originalPost(...args);
  };
  t.after(() => { f.transport.boundedBackupPost = originalPost; });
  const admitted = deferred(t);
  const release = deferred(t);
  const delayedReply = deferred(t);
  let intervening;
  let publishedEpoch;
  server.armFault({ mode: 'before-snapshot-reply', beforeReply() {
    intervening = f.transport.withBackupSession(f.appId, async () => {
      await recordMatchedBaseline(f);
      publishedEpoch = f.transport.backupBaselineEpoch(f.appId);
      admitted.resolve();
      await release.promise;
    });
    return delayedReply.promise;
  } });
  const phases = [];
  const checking = f.repair.inspectBackup(f.appId, false, phase => phases.push(phase));
  await admitted.promise;
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  // Observe the second actual HTTP request, not a fake reply or a new budget.
  server.armFault({ mode: 'before-snapshot-reply', beforeReply() {
    assert.equal(f.transport.backupBaselineEpoch(f.appId), publishedEpoch + 1);
    assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
  } });
  release.resolve();
  await intervening;
  assert.equal(await checking, 'verified');
  assert.equal(deadlines.length, 2);
  assert.equal(deadlines[0], deadlines[1], 'Retry must not receive a fresh ten-minute budget');
  assert.ok(deadlines[0] > Date.now());
  assert.deepEqual(phases, ['checking', 'checking', 'verified']);
  assert.equal(snapshots().length, 3, 'Two inspection attempts plus the real matched-baseline setup read');
  assert.equal(writes().length, 0);
});

test('a malformed snapshot is not retried or granted mutation authority', async t => {
  const f = await setup(t);
  server.armFault({ mode: 'malformed-json' });
  assert.equal(await f.status(), false);
  assert.equal(snapshots().length, 1);
  assert.equal(writes().length, 0);
  assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'unverified');
});
