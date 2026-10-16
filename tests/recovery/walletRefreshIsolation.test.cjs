const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');
const { fixture, enums, wallet, loadModule, functions } = require('./sagaHarness.cjs');
const { image, encryption, unitProtectedFacade } = require('./helpers.cjs');
const walletState = loadModule('src/store/reducers/wallets.ts', {
  'src/storage': { reduxStorage: {} },
  '../sagaActions/wallets': { ADD_NEW_WALLETS: 'ADD_NEW_WALLETS' },
  'redux-persist/es/persistReducer': { __esModule: true, default: (_settings, reducer) => reducer },
});

function refreshFixture(kind, archived = false) {
  const f = fixture();
  f.state.settings.bitcoinNetworkType = enums.NetworkType.TESTNET;
  const stored = {
    ...wallet('same-disposable-id', enums.NetworkType.TESTNET),
    entityKind: kind === 'Vault' ? enums.EntityKind.VAULT : enums.EntityKind.WALLET,
    archived,
    presentationData: { visibility: archived ? 'HIDDEN' : 'DEFAULT' },
    specs: {
      balances: { confirmed: 0, unconfirmed: 0 },
      confirmedUTXOs: [],
      unconfirmedUTXOs: [],
      transactions: [],
      addresses: { external: {}, internal: {} },
    },
  };
  f.collections[kind].push(stored);
  f.scope.getJSONFromRealmObject = (value) => JSON.parse(JSON.stringify(value));
  f.scope.WALLET_SYNC_SCOPE_CHANGED = 'WALLET_SYNC_SCOPE_CHANGED';
  f.scope.ELECTRUM_CLIENT = { isClientConnected: true };
  f.scope.ElectrumClient = {
    getConnectionGeneration: () => 1,
    assertConnectionGeneration: () => {},
  };
  f.scope.WalletUtilities.getNetworkByType = () => ({});
  f.scope.classifyDustByAddress = () => ({
    taintedAddresses: new Set(),
    initialTaintAddresses: new Set(),
    dustSpendTxids: new Set(),
  });
  f.scope.setSyncing = walletState.setSyncing;
  f.scope.ELECTRUM_NOT_CONNECTED_ERR = 'offline';
  f.scope.ELECTRUM_NOT_CONNECTED_ERR_TOR = 'tor-offline';
  let finishSync;
  f.scope.WalletOperations = {
    syncWalletsViaElectrumClient: (wallets) => {
      const synced = f.scope.getJSONFromRealmObject(wallets[0]);
      synced.specs.balances.unconfirmed = 1000;
      synced.specs.hasNewUpdates = true;
      return new Promise((resolve) => {
        finishSync = () => resolve({ synchedWallets: [{ synchedWallet: synced, newUTXOs: [] }] });
      });
    },
  };
  const originalWrite = f.scope.dbManager.updateObjectById;
  f.writes = [];
  f.scope.dbManager.updateObjectById = (...args) => {
    f.writes.push(args);
    return originalWrite(...args);
  };
  vm.runInNewContext(
    ts.transpileModule(functions('src/store/sagas/wallets.ts', ['refreshWalletsWorker']), {
      compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText,
    f.scope
  );
  f.refresh = (originAppId = f.app.id) =>
    f.run('refreshWalletsWorker', {
      originAppId,
      payload: { wallets: [stored], options: { hardRefresh: true } },
    });
  f.waitForSync = async () => {
    for (let attempt = 0; attempt < 20 && !finishSync; attempt += 1)
      await new Promise(setImmediate);
    assert.ok(finishSync, 'refresh must reach the pending Electrum boundary');
  };
  f.complete = () => finishSync();
  return f;
}

for (const [kind, archived] of [
  ['Wallet', false],
  ['Vault', false],
  ['Vault', true],
]) {
  const description = archived ? 'hidden archived Vault' : kind;
  test(`${description}: pending A refresh cannot overwrite B with the same ID`, async () => {
    const f = refreshFixture(kind, archived);
    const refreshing = f.refresh();
    await f.waitForSync();
    f.app.id = 'B';
    f.state.storage.appId = 'B';
    const b = {
      ...wallet('same-disposable-id', enums.NetworkType.TESTNET),
      entityKind: kind === 'Vault' ? enums.EntityKind.VAULT : enums.EntityKind.WALLET,
      specs: { balances: { confirmed: 42, unconfirmed: 0 } },
    };
    f.collections[kind] = [b];
    const actionCount = f.actions.length;
    let bUi = walletState.default(
      undefined,
      walletState.setSyncing({ wallets: [b], isSyncing: true })
    );
    f.complete();
    assert.equal(await refreshing, false);
    for (const action of f.actions.slice(actionCount)) bUi = walletState.default(bUi, action);
    assert.deepEqual(f.writes, []);
    assert.equal(b.specs.balances.confirmed, 42);
    assert.equal(b.specs.balances.unconfirmed, 0);
    assert.equal(bUi.walletSyncing[b.id], true, 'A completion must not clear B pending refresh');
  });

  test(`${description}: pending Testnet refresh cannot persist after a Mainnet switch`, async () => {
    const f = refreshFixture(kind, archived);
    const refreshing = f.refresh();
    await f.waitForSync();
    f.state.settings.bitcoinNetworkType = enums.NetworkType.MAINNET;
    f.complete();
    assert.equal(await refreshing, false);
    assert.deepEqual(f.writes, []);
    assert.equal(f.collections[kind][0].specs.balances.unconfirmed, 0);
  });

  test(`${description}: queued A refresh is rejected before syncing B`, async () => {
    const f = refreshFixture(kind, archived);
    const originAppId = f.app.id;
    f.app.id = 'B';
    f.state.storage.appId = 'B';
    let synced = false;
    f.scope.WalletOperations.syncWalletsViaElectrumClient = () => {
      synced = true;
    };
    assert.equal(await f.refresh(originAppId), false);
    assert.equal(synced, false);
    assert.deepEqual(f.writes, []);
  });
}

test('refresh marks recoverable address counters pending after Realm persistence', async () => {
  const f = refreshFixture('Wallet');
  const originAppId = f.app.id;
  f.collections.Wallet[0].specs.nextFreeAddressIndex = 1;
  f.collections.Wallet[0].specs.nextFreeChangeAddressIndex = 0;
  f.collections.Wallet[0].specs.totalExternalAddresses = 2;
  const mutations = [];
  // The direct Realm write is represented by the unit DB adapter. Exercise the
  // production snapshot/generation check rather than asserting the removed
  // clearVerifiedRemoteRevision call; native commit hooks have separate proof.
  const database = {
    isInTransaction: false,
    objects: (schema) => (schema === 'KeeperApp' ? [f.app] : f.collections[schema]),
  };
  const utilities = {
    getKeyUID: f.scope.getKeyUID,
    sanitizeSeedKeyForBackup: f.scope.sanitizeSeedKeyForBackup,
    sanitizeVaultSignersForSeedKeyBackup: f.scope.sanitizeVaultSignersForSeedKeyBackup,
  };
  const schema = { RealmSchema: f.scope.RealmSchema };
  const localSnapshot = loadModule('src/services/backup/localSnapshot.ts', {
    'src/storage/realm/enum': schema,
    'src/utils/service-utilities/encryption': encryption,
    'src/utils/utilities': utilities,
    './image': image,
  });
  const transport = loadModule('src/services/backup/transport.ts', {
    '../rest/RestClient': {
      post: () => {
        throw new Error('No network expected');
      },
    },
  });
  transport.observeBackupAccount(originAppId);
  transport.setBackupUploadGuard((id) => id === f.app.id);
  const automatic = loadModule('src/services/backup/automatic.ts', {
    'src/storage/realm/realm': { getDatabase: () => database },
    'src/storage/realm/enum': schema,
    'src/utils/service-utilities/config': { RELAY: 'fixture/' },
    'src/utils/service-utilities/encryption': encryption,
    'src/utils/utilities': utilities,
    './image': image,
    './localSnapshot': localSnapshot,
    './transport': transport,
    './protected': unitProtectedFacade(transport, f.app),
  });
  transport.recordVerifiedRemoteRevision(
    originAppId,
    'a'.repeat(64),
    transport.currentBackupAccountSession(),
    { namespaceId: `unit-protected-${originAppId}`, revision: 'a'.repeat(64), generation: 0, authEpoch: 0 }
  );
  const baseline = transport.captureBackupWriteIntent(originAppId);
  assert.ok(automatic.isBackupVerificationCurrent(originAppId));
  f.scope.markBackupMutation = (appId) => {
    mutations.push(appId);
    transport.markBackupMutation(appId);
  };
  f.scope.invalidateBackupRepair = (appId) => ({ type: 'invalidateBackupRepair', payload: appId });
  f.scope.setPendingAllBackup = (payload) => ({ type: 'setPendingAllBackup', payload });
  f.scope.WalletOperations.syncWalletsViaElectrumClient = (wallets) => {
    const synced = f.scope.getJSONFromRealmObject(wallets[0]);
    synced.specs.nextFreeAddressIndex = 2;
    synced.specs.nextFreeChangeAddressIndex = 1;
    synced.specs.totalExternalAddresses = 3;
    synced.specs.hasNewUpdates = true;
    return { synchedWallets: [{ synchedWallet: synced, newUTXOs: [] }] };
  };

  assert.equal(await f.refresh(), true);
  assert.equal(f.collections.Wallet[0].specs.totalExternalAddresses, 3);
  assert.deepEqual(mutations, [originAppId]);
  assert.equal(
    automatic.isBackupVerificationCurrent(originAppId),
    false,
    'the old verified revision cannot prove newly committed address counters'
  );
  assert.ok(automatic.currentCommittedBackupGeneration(originAppId) > baseline.localGeneration);
  assert.ok(
    f.actions.some(
      (action) => action.type === 'invalidateBackupRepair' && action.payload === originAppId
    )
  );
  assert.equal(f.state.bhr.pendingAllBackupByAppId[originAppId], true);
});

test('refresh paused at Electrum cannot overwrite newer A specs after A to B to A', async () => {
  const f = refreshFixture('Wallet', false);
  const originAppId = f.app.id;
  let session = 1;
  f.scope.currentBackupAccountSession = () => session;
  const refreshing = f.refresh(originAppId);
  await f.waitForSync();
  f.app.id = 'B';
  f.state.storage.appId = 'B';
  session++;
  f.app.id = originAppId;
  f.state.storage.appId = originAppId;
  session++;
  f.collections.Wallet[0].specs.balances.confirmed = 777;
  f.complete();
  assert.equal(await refreshing, false);
  assert.deepEqual(f.writes, []);
  assert.equal(f.collections.Wallet[0].specs.balances.confirmed, 777);
});

test('new A login refresh runs after stale A lease from A to B to A', async () => {
  const f = refreshFixture('Wallet', false);
  const originAppId = f.app.id;
  let session = 1;
  f.scope.currentBackupAccountSession = () => session;

  const staleRefresh = f.refresh(originAppId);
  await f.waitForSync();
  f.app.id = 'B';
  f.state.storage.appId = 'B';
  session++;
  f.app.id = originAppId;
  f.state.storage.appId = originAppId;
  session++;
  f.collections.Wallet[0].specs.balances.confirmed = 777;

  let newSessionSyncs = 0;
  f.scope.WalletOperations.syncWalletsViaElectrumClient = (wallets) => {
    newSessionSyncs++;
    const synced = f.scope.getJSONFromRealmObject(wallets[0]);
    synced.specs.balances.unconfirmed = 2000;
    synced.specs.hasNewUpdates = true;
    return { synchedWallets: [{ synchedWallet: synced, newUTXOs: [] }] };
  };
  const newSessionRefresh = f.refresh(originAppId);
  await new Promise(setImmediate);
  assert.equal(newSessionSyncs, 0, 'the new session must wait for the prior wallet write lease');
  f.complete();

  assert.equal(await staleRefresh, false);
  assert.equal(await newSessionRefresh, true);
  assert.equal(newSessionSyncs, 1, 'the new A session must perform its own Electrum sync');
  assert.equal(f.collections.Wallet[0].specs.balances.confirmed, 777);
  assert.equal(f.collections.Wallet[0].specs.balances.unconfirmed, 2000);
});
