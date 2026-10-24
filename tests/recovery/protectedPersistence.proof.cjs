// Seven additive cold-persistence obligations through actual Redux Persist,
// encrypted native Realm, production observers/queue and signed-v3 HTTP/Relay.
// Only MMKV I/O/read ordering is a host Promise adapter. No native app claim.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { componentDeclarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
let server;
beforeEach(async () => { server = await createProtectedServer(); });
afterEach(async () => { await server?.close(); server = undefined; });
after(() => Realm.shutdown());
const test = (name, body) => nodeTest(name, { timeout: 30_000 }, body);
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

async function client(t, persistedRedux = true) {
  const f = await createProtectedRealmClient(server.url, {
    appId, primarySeed: seed.toString('hex'), primaryMnemonic: mnemonic, persistedRedux,
  });
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, f.defaults(f.RealmSchema.Wallet, {
    id: 'persisted-wallet', entityKind: f.enums.EntityKind.WALLET, type: f.enums.WalletType.DEFAULT,
    networkType: f.enums.NetworkType.TESTNET, scriptType: 'P2WPKH',
    derivationDetails: f.defaults(f.RealmSchema.WalletDerivationDetails, {
      instanceNum: 0, xDerivationPath: "m/84'/1'/0'",
    }),
    presentationData: f.defaults(f.RealmSchema.WalletPresentationData, {
      name: 'Initial wallet', visibility: 'DEFAULT',
    }),
    specs: f.defaults(f.RealmSchema.WalletSpecs, {
      xpub: 'intentionally-unspendable-public-fixture', nextFreeAddressIndex: 1,
    }),
  })), true);
  f.sagas = f.productionSagas(['currentBackupAppId', 'backupInspectionOwners', 'runBackupInspection']);
  f.check = () => f.sagas.run('runBackupInspection', false, f.appId, true);
  f.read = async () => {
    const result = await f.protected.readProtectedBackup(mnemonic, undefined, f.appId);
    assert.equal(result.state, 'present');
    return result;
  };
  f.localImage = () => f.repair.captureBackupImage();
  f.rootSnapshot = legacy => ({
    storage: { ...plain(f.store.getState().storage), appVersion: 'persisted-safe-version' },
    account: plain(f.store.getState().account), _persist: { version: 4, rehydrated: true },
    ...(legacy ? { bhr: legacy } : {}),
  });
  return f;
}

async function setup(t) {
  await server.reset();
  // Seed the genuine protected namespace through a distinct production client.
  // The target cold store starts without live consent or proof. It never borrows
  // the seeding client's in-memory authority, state, receipt or module instance.
  const source = await client(t, false);
  source.store.dispatch(source.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
  assert.equal(await source.sagas.run('runBackupInspection', true, appId, true), true);
  const initial = await source.read();
  const expected = await source.localImage();
  await source.close();
  const f = await client(t);
  assert.equal(await f.image.compareImages(expected, await f.localImage()), 'matched');
  assert.equal(f.transport.captureBackupWriteIntent(appId), undefined);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), false);
  f.initial = initial;
  f.before = await f.localImage();
  server.clearTrace();
  return f;
}

function pending(f) {
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], true);
  assert.notEqual(f.store.getState().bhr.backupRepairStateByAppId[appId], 'verified');
  assert.notEqual(f.store.getState().bhr.backupRepairCompletedByAppId[appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), false);
  assert.equal(f.transport.captureBackupWriteIntent(appId), undefined);
}

async function noBootRequest(f) {
  assert.equal(await f.image.compareImages(f.before, await f.localImage()), 'matched');
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), false);
  assert.equal(f.transport.captureBackupWriteIntent(appId), undefined);
  await tick();
  assert.equal(server.trace.length, 0, 'Actual persistence/observers must not request, enroll, repair or replay');
}

function observe(t, f) {
  const states = [];
  const stop = f.store.subscribe(() => states.push(plain(f.store.getState().bhr)));
  t.after(stop);
  return states;
}

function assertSanitized(states) {
  assert.ok(states.length > 0, 'The real persistence pipeline must notify actual store subscribers');
  for (const state of states) {
    assert.notEqual(state.backupRepairStateByAppId[appId], 'verified');
    assert.notEqual(state.backupRepairCompletedByAppId[appId], true);
    assert.notEqual(state.backupAllSuccess, true);
    assert.notEqual(state.deleteBackupSuccess, true);
  }
}

async function rename(f, name, intent = f.transport.captureBackupWriteIntent(appId)) {
  const operation = f.automatic.beginBackupLocalOperation(appId, intent,
    f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(operation, realm => {
    realm.objectForPrimaryKey(f.RealmSchema.Wallet, 'persisted-wallet').presentationData.name = name;
  });
  assert.equal(receipt.committed, true, 'A real native commit must occur independently of remote authority');
  const image = await f.localImage();
  const body = { appId, walletsObject: { 'persisted-wallet': await f.image.encryptRecord(
    f.encryption.generateEncryptionKey(f.seed), image.wallets['persisted-wallet']) } };
  return { receipt, result: await f.automatic.enqueueAutomaticBackupOperation(receipt,
    [{ operation: 'updateAppImage', body }]) };
}

async function assertReadOnlyVerified(f) {
  assert.equal(await f.check(), true, 'Only a fresh signed snapshot and actual complete comparison earn proof');
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), true);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[appId], 'verified');
  assert.ok(server.trace.length > 0);
  assert.ok(server.trace.every(event => event.path === '/backup/v3/snapshot'),
    'Check Again must remain signed read-only even with saved consent');
  assert.equal(writes().length, 0);
}

for (const persistedKey of ['bhr', 'root']) {
  test(`${persistedKey} historical Verified boot expires every saved proof before genuine current readback`, async t => {
    const f = await setup(t);
    const ids = { interrupted: 'persisted-interrupted', completed: 'persisted-completed',
      running: 'persisted-running', different: 'persisted-different', consent: 'persisted-consent-only' };
    const consent = { [appId]: true, [ids.interrupted]: false, [ids.completed]: true,
      [ids.running]: true, [ids.different]: false, [ids.consent]: false };
    const historical = { ...plain(f.store.getState().bhr), backupMethod: 'SEED', seedConfirmed: true,
      automaticCloudBackupByAppId: consent,
      backupAllLoading: true, backupAllSuccess: true, backupAllFailure: true,
      deleteBackupSuccess: true, deleteBackupFailure: true,
      backupAllLoadingByAppId: { [appId]: true },
      backupAllSuccessByAppId: { [appId]: true, [ids.completed]: true },
      backupAllFailureByAppId: { [ids.interrupted]: true },
      deleteBackupSuccessByAppId: { [appId]: true },
      deleteBackupFailureByAppId: { [ids.interrupted]: true },
      backupRepairStateByAppId: { [appId]: 'verified', [ids.interrupted]: 'uploading', [ids.different]: 'different' },
      backupRepairCompletedByAppId: { [appId]: true, [ids.completed]: true, [ids.different]: false },
      pendingAllBackupByAppId: { [appId]: false, [ids.interrupted]: false, [ids.completed]: false,
        [ids.running]: false, [ids.different]: true },
      backupRepairRunningByAppId: { [ids.interrupted]: true, [ids.running]: true },
      _persist: { version: -1, rehydrated: true },
    };
    const inbound = plain(historical);
    const subscribers = observe(t, f);
    await f.rehydratePersistedRedux({ root: f.rootSnapshot(persistedKey === 'root' ? historical : undefined),
      ...(persistedKey === 'bhr' ? { bhr: historical } : {}) }, { firstKey: persistedKey });
    assert.ok(f.persistedHostReads.includes('persist:root') && f.persistedHostReads.includes('persist:bhr'));
    assert.equal(f.persistedBootStates[0].key, persistedKey);
    assertSanitized(subscribers);
    const state = f.store.getState();
    assert.deepEqual(plain(state.bhr.automaticCloudBackupByAppId), consent);
    assert.equal(state.bhr.backupMethod, 'SEED');
    assert.equal(state.bhr.seedConfirmed, true);
    assert.equal(state.storage.appVersion, 'persisted-safe-version');
    for (const field of ['backupAllLoading', 'backupAllSuccess', 'backupAllFailure', 'deleteBackupSuccess', 'deleteBackupFailure'])
      assert.equal(state.bhr[field], false);
    for (const field of ['backupAllLoadingByAppId', 'backupAllSuccessByAppId', 'backupAllFailureByAppId',
      'deleteBackupSuccessByAppId', 'deleteBackupFailureByAppId'])
      assert.ok(Object.values(state.bhr[field]).every(value => value === false));
    for (const id of [appId, ids.interrupted, ids.completed, ids.running]) {
      assert.equal(state.bhr.backupRepairStateByAppId[id], 'unverified');
      assert.equal(state.bhr.backupRepairCompletedByAppId[id], false);
      assert.equal(state.bhr.pendingAllBackupByAppId[id], true);
      assert.notEqual(state.bhr.backupRepairRunningByAppId[id], true);
    }
    assert.equal(state.bhr.backupRepairStateByAppId[ids.different], 'different');
    assert.equal(state.bhr.pendingAllBackupByAppId[ids.different], true);
    assert.equal(state.bhr.backupRepairStateByAppId[ids.consent], undefined);
    assert.deepEqual(historical, inbound, 'Real rehydration must not mutate caller-owned input bytes');
    if (persistedKey === 'root')
      assert.notEqual(f.persistedBootStates[0].bhr.automaticCloudBackupByAppId[appId], true,
        'Root-only legacy consent waits for a confirmed canonical absence');
    await noBootRequest(f);
    const absent = await rename(f, 'Initial wallet', undefined);
    assert.equal(absent.receipt.intent, undefined);
    assert.notEqual(absent.result.backupConfirmed, true);
    pending(f);
    assert.equal(server.trace.length, 0);
    await assertReadOnlyVerified(f);
    assert.deepEqual(plain(f.store.getState().bhr.automaticCloudBackupByAppId), consent);
    const fresh = await rename(f, 'Fresh post-inspection commit');
    assert.equal(fresh.result.backupConfirmed, true);
    assert.equal(writes().length, 1);
    assert.equal(writes()[0].committed, true);
    const base = fresh.receipt.intent.protectedBase;
    assert.equal(writes()[0].namespaceId, base.namespaceId);
    assert.equal(writes()[0].expectedRevision, base.revision);
    assert.equal(writes()[0].expectedGeneration, base.generation);
    assert.equal(writes()[0].authEpoch, base.authEpoch);
    const remote = await f.read();
    const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot, remote.namespaceId);
    assert.equal(await f.image.compareImages(await f.localImage(), decoded), 'matched');
    assert.equal(f.store.getState().bhr.backupRepairStateByAppId[ids.completed], 'unverified');
  });
}

async function consentFixture(t) {
  const f = await setup(t);
  const legacy = { ...plain(f.store.getState().bhr),
    automaticCloudBackupByAppId: { [appId]: true, 'legacy-only-peer': true },
    backupRepairStateByAppId: { [appId]: 'verified' }, backupRepairCompletedByAppId: { [appId]: true },
    pendingAllBackupByAppId: { [appId]: false }, _persist: { version: -1, rehydrated: true } };
  const canonicalConsent = { [appId]: false, 'canonical-peer': false };
  const canonical = { ...legacy, automaticCloudBackupByAppId: canonicalConsent, backupMethod: 'SEED', seedConfirmed: true };
  return { f, legacy, canonical, canonicalConsent, root: f.rootSnapshot(legacy), states: observe(t, f) };
}

for (const firstKey of ['root', 'bhr']) {
  test(`${firstKey}-first canonical opt-out never exposes legacy opt-in or authorizes a later automatic write`, async t => {
    const { f, canonical, canonicalConsent, root, states } = await consentFixture(t);
    await f.rehydratePersistedRedux({ root, bhr: canonical }, { firstKey });
    assert.deepEqual(f.persistedBootStates.map(state => state.key).filter(key => ['root', 'bhr'].includes(key)),
      [firstKey, firstKey === 'root' ? 'bhr' : 'root']);
    assertSanitized(states);
    assert.ok(states.every(state => state.automaticCloudBackupByAppId[appId] !== true));
    assert.deepEqual(plain(f.store.getState().bhr.automaticCloudBackupByAppId), canonicalConsent);
    pending(f);
    await noBootRequest(f);
    await assertReadOnlyVerified(f);
    const reads = server.trace.length;
    const denied = await rename(f, 'Local opt-out commit');
    assert.notEqual(denied.result.backupConfirmed, true);
    assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'persisted-wallet').presentationData.name, 'Local opt-out commit');
    assert.equal(server.trace.length, reads, 'Fresh proof cannot override persisted automatic opt-out');
    assert.deepEqual(plain(f.store.getState().bhr.automaticCloudBackupByAppId), canonicalConsent);
    pending(f);
  });
}

test('failed canonical storage read cannot fall back to old consent or gain write authority from Check Again', async t => {
  const { f, root, states } = await consentFixture(t);
  await f.rehydratePersistedRedux({ root }, { firstKey: 'root', failKey: 'bhr' });
  assert.deepEqual(f.persistedBootStates.map(state => state.key).filter(key => ['root', 'bhr'].includes(key)), ['root', 'bhr']);
  assert.ok(f.actions.some(action => action.type === 'persist/REHYDRATE' && action.key === 'bhr' && action.err));
  assertSanitized(states);
  assert.ok(states.every(state => state.automaticCloudBackupByAppId[appId] !== true));
  assert.notEqual(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  await noBootRequest(f);
  await assertReadOnlyVerified(f);
  const reads = server.trace.length;
  assert.notEqual((await rename(f, 'Unconsented local commit')).result.backupConfirmed, true);
  assert.equal(server.trace.length, reads);
  assert.notEqual(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  pending(f);
});

test('confirmed canonical absence preserves sanitized legacy fallback and durably stores a later opt-out', async t => {
  const { f, root } = await consentFixture(t);
  root.bhr = { backupMethod: 'SEED', automaticCloudBackupByAppId: { [appId]: true },
    backupRepairStateByAppId: { [appId]: 'verified' }, backupRepairCompletedByAppId: { [appId]: true },
    pendingAllBackupByAppId: { [appId]: false, 'pending-peer': false } };
  const states = observe(t, f);
  await f.rehydratePersistedRedux({ root }, { firstKey: 'bhr' });
  assert.deepEqual(f.persistedBootStates.map(state => state.key).filter(key => ['root', 'bhr'].includes(key)), ['bhr', 'root']);
  assertSanitized(states);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  assert.equal(f.store.getState().bhr._persist.rehydrated, true);
  assert.equal(f.store.getState().bhr._persist.version, -1);
  assert.deepEqual(plain(f.store.getState().bhr.backupAllLoadingByAppId), {});
  assert.deepEqual(plain(f.store.getState().bhr.seedWords), []);
  pending(f);
  await noBootRequest(f);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: false }));
  f.store.dispatch(f.bhr.setPendingAllBackup({ appId: 'pending-peer', pending: true }));
  await f.flushPersistedRedux();
  const savedBhr = f.readPersistedRedux('bhr');
  const savedRoot = f.readPersistedRedux('root');
  assert.equal(savedBhr.automaticCloudBackupByAppId[appId], false);
  assert.equal(savedBhr.pendingAllBackupByAppId['pending-peer'], true);
  assert.equal(savedBhr.backupRepairStateByAppId[appId], 'unverified');
  assert.equal(savedBhr.backupRepairCompletedByAppId[appId], false);
  assert.equal(savedBhr._persist.rehydrated, true);
  assert.equal(server.trace.length, 0);
  // A second actual persistStore reads the bytes emitted by the first writer.
  // This is host storage readback, not an iOS/Android/MMKV process relaunch.
  const cold = await client(t);
  cold.before = await cold.localImage();
  const coldStates = observe(t, cold);
  await cold.rehydratePersistedRedux({ root: savedRoot, bhr: savedBhr }, { firstKey: 'root' });
  assertSanitized(coldStates);
  assert.ok(coldStates.every(state => state.automaticCloudBackupByAppId[appId] !== true));
  assert.equal(cold.store.getState().bhr.automaticCloudBackupByAppId[appId], false);
  assert.equal(cold.store.getState().bhr.pendingAllBackupByAppId['pending-peer'], true);
  await noBootRequest(cold);
  await assertReadOnlyVerified(cold);
  assert.equal(cold.store.getState().bhr.automaticCloudBackupByAppId[appId], false);
});

test('actual status expression expires an earlier session and a later native mutation without requesting backup', async t => {
  const f = await setup(t);
  await f.rehydratePersistedRedux({ root: f.rootSnapshot(), bhr: {
    automaticCloudBackupByAppId: { [appId]: false }, _persist: { version: -1, rehydrated: true },
  } });
  await noBootRequest(f);
  await assertReadOnlyVerified(f);
  const expression = componentDeclarations('src/screens/AppSettings/AssistedBackupStatus.tsx',
    'AssistedBackupStatus', ['recordedPhase', 'phase']);
  const phase = () => {
    const scope = { id: appId, backupRepairStateByAppId: f.store.getState().bhr.backupRepairStateByAppId,
      isBackupVerificationCurrent: f.automatic.isBackupVerificationCurrent };
    evaluate(expression, scope, 'production-persisted-status-phase.ts');
    return scope.phase;
  };
  assert.equal(phase(), 'verified');
  server.clearTrace();
  await f.selectAccount('persisted-status-peer');
  await f.selectAccount(appId);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), false);
  assert.equal(phase(), 'unverified');
  assert.equal(server.trace.length, 0);
  await assertReadOnlyVerified(f);
  assert.equal(phase(), 'verified');
  const requests = server.trace.length;
  f.nativeRealm().write(() => {
    f.nativeRealm().objectForPrimaryKey(f.RealmSchema.Wallet, 'persisted-wallet').presentationData.name = 'Native change';
  });
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), false);
  assert.equal(phase(), 'unverified');
  assert.equal(server.trace.length, requests);
  assert.equal(writes().length, 0);
});
