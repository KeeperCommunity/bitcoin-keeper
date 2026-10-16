// Real Redux Persist serialization/reconciliation, production BHR reducer and
// origin middleware. MMKV I/O uses a disposable Promise storage adapter here.
// The fresh-proof predicate is an explicitly controlled UI-unit boundary;
// automaticWriteRealmRelay.integration proves actual branded Realm/HTTP proof.
// Native MMKV and an iOS/Android process relaunch are NOT tested by this file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');
const { combineReducers, createStore, applyMiddleware } = require('redux');
const { persistReducer, persistStore, createMigrate } = require('redux-persist');
const { loadModule, functions, enums } = require('./sagaHarness.cjs');
const copy = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const serialize = (value) => JSON.stringify(Object.fromEntries(Object.entries(value).map(
  ([key, field]) => [key, JSON.stringify(field)]
)));

async function setup(t, { nested, legacy, guarded = true } = {}) {
  const values = new Map([
    ['persist:bhr', nested === undefined ? null : serialize({ ...nested, _persist: { version: -1, rehydrated: true } })],
    ['persist:root', serialize({ storage: { appId: 'A', pinHash: 'disposable-pin-marker' },
      account: { allAccounts: [{ appId: 'A' }, { appId: 'B' }], recoveryKeyStatusByAppId: { A: 'confirmed' } },
      ...(legacy ? { bhr: legacy } : {}), _persist: { version: 4, rehydrated: true } })],
  ]);
  const reads = new Map();
  const hostStorage = {
    getItem: (key) => new Promise((resolve, reject) => reads.set(key, { resolve, reject })),
    setItem: async (key, value) => values.set(key, value),
    removeItem: async (key) => values.delete(key),
  };
  const bhr = loadModule('src/store/reducers/bhr.ts', {
    'src/models/enums/BHR': loadModule('src/models/enums/BHR.ts'),
    'src/storage': { reduxStorage: hostStorage },
  });
  const storage = loadModule('src/store/reducers/storage.ts', { 'src/services/wallets/enums': enums });
  const proofPredicate = new Set();
  const { takeBackupRecoveryConsentDisable } = loadModule('src/services/backup/transport.ts', {
    '../rest/RestClient': {},
  });
  const actions = [], snapshots = [];
  let store;
  const scope = {
    ...bhr, persistReducer, createMigrate, reduxStorage: hostStorage, storage: hostStorage,
    reduxPersistMigrations: loadModule('src/store/migrations.ts').default,
    RESET_REDUX_STORE: 'RESET_REDUX_STORE',
    appReducer: combineReducers({ bhr: bhr.default, storage: storage.default,
      // Unrelated account payload is opaque: no account migration is run at v4.
      account: (state = {}) => state }),
    RealmSchema: { KeeperApp: 'KeeperApp' },
    dbManager: { getObjectByIndex: () => ({ id: store.getState().storage.appId }) },
    currentBackupAccountSession: () => 0,
    captureBackupWriteIntent: () => undefined,
    canAccessBackupAccount: () => false,
    observeBackupConsentAction: (_action, appId) => store.getState().storage.appId === appId,
    takeBackupRecoveryConsentDisable,
    isBackupVerificationCurrent: (appId) => proofPredicate.has(appId) &&
      store.getState().storage.appId === appId,
  };
  vm.runInNewContext(ts.transpileModule(functions('src/store/store.ts', [
    'rootReducer', 'persistConfig', 'persistedReducer',
    'accountOwnedActions', 'accountOwnedUtxoUiActions', 'bindActionOrigin',
  ]), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, scope);
  store = createStore(scope.persistedReducer, applyMiddleware(
    ...(guarded ? [scope.bindActionOrigin] : []),
    () => (next) => (action) => { actions.push(action); return next(action); }
  ));
  store.subscribe(() => snapshots.push(copy(store.getState())));
  let booted;
  const boot = new Promise((resolve) => { booted = resolve; });
  const persistor = persistStore(store, { manualPersist: true }, booted);
  t.after(() => persistor.pause());
  persistor.persist();
  for (let i = 0; i < 20 && reads.size < 2; i++) await tick();
  assert.equal(reads.has('persist:root'), true);
  assert.equal(reads.has('persist:bhr'), true);
  const release = async (key, error) => {
    const previous = actions.filter((action) => action.type === 'persist/REHYDRATE').length;
    const read = reads.get(`persist:${key}`);
    if (error) read.reject(error); else read.resolve(values.get(`persist:${key}`));
    for (let i = 0; i < 50 && actions.filter((action) => action.type === 'persist/REHYDRATE').length === previous; i++)
      await tick();
    assert.equal(actions.some((action) => action.type === 'persist/REHYDRATE' && action.key === key), true);
  };
  return { store, bhr, storage, snapshots, actions, proofPredicate, release, boot, persistor,
    stored: (key) => {
      const record = JSON.parse(values.get(`persist:${key}`));
      return Object.fromEntries(Object.entries(record).map(([field, value]) => [field, JSON.parse(value)]));
    },
    async finish(order = ['bhr', 'root']) { for (const key of order) await release(key); await boot; },
  };
}

const savedVerified = { automaticCloudBackupByAppId: { A: true, B: false },
  backupRepairStateByAppId: { A: 'verified' }, backupRepairCompletedByAppId: { A: true },
  pendingAllBackupByAppId: { A: false, B: true }, backupMethod: 'SEED' };

function assertNeverVerified(f) {
  assert.ok(f.snapshots.every((snapshot) => snapshot.bhr.backupRepairStateByAppId.A !== 'verified'));
  assert.ok(f.snapshots.every((snapshot) => snapshot.bhr.backupRepairCompletedByAppId.A !== true));
}

test('control: default persistence resurrects saved Verified despite an empty proof predicate', async (t) => {
  const f = await setup(t, { nested: savedVerified, guarded: false });
  await f.finish();
  assert.equal(f.proofPredicate.size, 0);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId.A, 'verified');
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId.A, true);
});

test('nested rehydration invalidates saved proof and interrupted UI before subscribers see it', async (t) => {
  const nested = { ...savedVerified,
    backupRepairStateByAppId: { A: 'verified', B: 'checking', C: 'preparing', D: 'uploading', E: 'verifying', F: 'different' },
    backupRepairCompletedByAppId: { A: true, G: true, F: false },
    backupRepairRunningByAppId: { H: true, A: false },
    pendingAllBackupByAppId: { A: false, F: true, J: true },
    backupAllSuccess: true, backupAllLoading: true, deleteBackupSuccess: true,
    backupAllSuccessByAppId: { A: true }, backupAllLoadingByAppId: { B: true }, deleteBackupSuccessByAppId: { A: true },
    signingDevices: [{ xpub: 'disposable-public-key' }],
  };
  const before = copy(nested);
  const f = await setup(t, { nested });
  await f.finish();
  assertNeverVerified(f);
  const state = f.store.getState();
  for (const id of ['A', 'B', 'C', 'D', 'E', 'G', 'H']) {
    assert.equal(state.bhr.backupRepairStateByAppId[id], 'unverified');
    assert.equal(state.bhr.backupRepairCompletedByAppId[id], false);
    assert.equal(state.bhr.pendingAllBackupByAppId[id], true);
  }
  assert.equal(state.bhr.backupRepairRunningByAppId.H, false);
  assert.equal(state.bhr.backupRepairStateByAppId.F, 'different');
  assert.equal(state.bhr.pendingAllBackupByAppId.F, true);
  assert.equal(state.bhr.pendingAllBackupByAppId.J, true);
  assert.deepEqual(copy(state.bhr.automaticCloudBackupByAppId), before.automaticCloudBackupByAppId);
  assert.deepEqual(copy(state.bhr.signingDevices), before.signingDevices);
  assert.equal(state.bhr.backupMethod, before.backupMethod);
  assert.equal(state.storage.pinHash, 'disposable-pin-marker');
  assert.equal(state.account.recoveryKeyStatusByAppId.A, 'confirmed');
  assert.equal(state.bhr.backupAllSuccess, false);
  assert.equal(state.bhr.backupAllLoading, false);
  assert.equal(state.bhr.deleteBackupSuccess, false);
  assert.equal(state.bhr.backupAllSuccessByAppId.A, false);
  assert.equal(state.bhr.backupAllLoadingByAppId.B, false);
  assert.equal(state.bhr.deleteBackupSuccessByAppId.A, false);
  assert.deepEqual(nested, before, 'Sanitization never mutates the supplied snapshot');
  assert.ok(f.actions.every((action) => action.type.startsWith('persist/')));
});

for (const order of [['root', 'bhr'], ['bhr', 'root']]) {
  test(`canonical opt-out beats legacy opt-in in every subscriber state: ${order.join(' then ')}`, async (t) => {
    const f = await setup(t, { nested: { ...savedVerified, automaticCloudBackupByAppId: { A: false, B: true } },
      legacy: savedVerified });
    await f.release(order[0]);
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId.A, order[0] === 'root' ? undefined : false);
    await f.release(order[1]); await f.boot;
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId.A, false);
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId.B, true);
    assert.ok(f.snapshots.every((snapshot) => snapshot.bhr.automaticCloudBackupByAppId.A !== true));
    assertNeverVerified(f);
  });
}

for (const order of [['root', 'bhr'], ['bhr', 'root']]) {
  test(`legacy fallback waits for confirmed canonical absence: ${order.join(' then ')}`, async (t) => {
    const f = await setup(t, { legacy: savedVerified });
    await f.release(order[0]);
    if (order[0] === 'root') assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId.A, undefined);
    await f.release(order[1]); await f.boot;
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId.A, true);
    assert.equal(f.store.getState().bhr.backupRepairStateByAppId.A, 'unverified');
    assert.equal(f.store.getState().bhr.pendingAllBackupByAppId.A, true);
    assertNeverVerified(f);
  });
}

test('unreadable canonical storage suppresses deferred legacy consent rather than treating failure as absence', async (t) => {
  const f = await setup(t, { legacy: savedVerified });
  await f.release('root');
  await f.release('bhr', new Error('Injected host storage read failure')); await f.boot;
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId.A, undefined);
  assertNeverVerified(f);
  assert.ok(f.snapshots.every((snapshot) => snapshot.bhr.automaticCloudBackupByAppId.A !== true));
});

test('absence-first legacy fallback keeps initialized fields and continues nested persistence after flush', async (t) => {
  const f = await setup(t, { legacy: savedVerified });
  await f.finish(['bhr', 'root']);
  assert.equal(f.store.getState().bhr._persist.rehydrated, true);
  assert.equal(f.store.getState().bhr.relayWalletUpdateLoading, false);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: 'A', enabled: false }));
  f.store.dispatch(f.bhr.setPendingAllBackup({ appId: 'B', pending: true }));
  f.store.dispatch(f.bhr.setSeedConfirmed(true));
  await f.persistor.flush();
  const stored = f.stored('bhr');
  assert.equal(stored.pendingAllBackupByAppId.B, true);
  assert.equal(stored.automaticCloudBackupByAppId.A, false);
  assert.equal(stored.backupRepairStateByAppId.A, 'unverified');
  assert.equal(stored._persist.rehydrated, true);
  assert.equal(stored.seedConfirmed, undefined, 'The actual nested write blacklist remains effective');
});

test('proof-gated fresh completion remains possible and cannot clear another account pending state', async (t) => {
  const f = await setup(t, { nested: savedVerified });
  await f.finish();
  f.store.dispatch(f.bhr.commitBackupInspection({ appId: 'A', phase: 'verified', pending: false }));
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId.A, 'unverified');
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId.A, true);
  // Explicit UI-unit predicate mock only; the genuine native suite obtains
  // this decision from the unchanged production Realm/HTTP proof verifier.
  f.proofPredicate.add('A');
  f.store.dispatch(f.bhr.commitBackupInspection({ appId: 'A', phase: 'verified', pending: false }));
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId.A, 'verified');
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId.A, false);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId.B, true);
  f.store.dispatch(f.storage.setAppId('B'));
  f.store.dispatch(f.bhr.commitBackupInspection({ appId: 'A', phase: 'verified', pending: false }));
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId.A, 'unverified');
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId.B, true);
});
