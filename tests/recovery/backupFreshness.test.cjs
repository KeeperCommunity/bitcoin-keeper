const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');
const { fixture, enums, encryption, wallet, loadModule, functions } = require('./sagaHarness.cjs');
const { NetworkType, WalletType } = enums;

test('archived-only resume keeps checking an empty hidden vault without notifications', async () => {
  const f = fixture();
  f.collections.Wallet.push(wallet('visible-wallet', NetworkType.MAINNET));
  f.collections.Vault.push({
    ...wallet('empty-archive', NetworkType.MAINNET),
    entityKind: enums.EntityKind.VAULT,
    archived: true,
    presentationData: { visibility: 'HIDDEN' },
    specs: { balances: { confirmed: 0, unconfirmed: 0 } },
  });
  f.collections.Vault.push({
    ...wallet('other-network-archive', NetworkType.TESTNET),
    entityKind: enums.EntityKind.VAULT,
    archived: true,
  });
  const batches = [];
  f.scope.refreshWalletsWorker = async ({ payload }) => {
    batches.push(payload);
    return true;
  };

  await f.run('autoWalletsSyncWorker', { payload: { archivedOnly: true } });
  await f.run('autoWalletsSyncWorker', { payload: { archivedOnly: true } });
  assert.deepEqual(batches.map(({ wallets }) => wallets.map(({ id }) => id)), [
    ['empty-archive'], ['empty-archive'],
  ]);
  assert.ok(batches.every(({ options }) => options.addNotifications === false));
});

function refreshFixture(kind, rejectWrite = false) {
  const f = fixture({ bhr: { pendingAllBackup: true } });
  const original = {
    ...wallet('refresh-persistence', NetworkType.MAINNET),
    entityKind: kind === 'Vault' ? enums.EntityKind.VAULT : enums.EntityKind.WALLET,
    specs: {
      receivingAddress: 'before-refresh',
      confirmedUTXOs: [], unconfirmedUTXOs: [], transactions: [],
      addresses: { external: {}, internal: {} },
    },
  };
  f.collections[kind].push(original);
  f.scope.getJSONFromRealmObject = (value) => JSON.parse(JSON.stringify(value));
  f.scope.WALLET_SYNC_SCOPE_CHANGED = 'WALLET_SYNC_SCOPE_CHANGED';
  f.scope.store = { getState: () => f.state };
  f.scope.ELECTRUM_CLIENT = {
    isClientConnected: true,
    activePeer: { networkType: NetworkType.MAINNET },
  };
  f.scope.ElectrumClient = {
    getConnectionGeneration: () => 1,
    assertConnectionGeneration: (_generation, networkType) => {
      if (networkType !== f.scope.ELECTRUM_CLIENT.activePeer.networkType) {
        throw new Error('Electrum network changed');
      }
    },
  };
  f.scope.WalletUtilities.getNetworkByType = () => ({});
  f.scope.WalletOperations = { syncWalletsViaElectrumClient: async () => {
    const synced = f.scope.getJSONFromRealmObject(original);
    synced.specs.receivingAddress = 'after-refresh';
    synced.specs.hasNewUpdates = true;
    return { synchedWallets: [{ synchedWallet: synced, newUTXOs: [] }] };
  } };
  f.scope.classifyDustByAddress = () => ({
    taintedAddresses: new Set(), initialTaintAddresses: new Set(), dustSpendTxids: new Set(),
  });
  f.scope.setSyncing = (payload) => ({ type: 'setSyncing', payload });
  f.scope.setElectrumNotConnectedErr = (payload) => ({ type: 'setElectrumNotConnectedErr', payload });
  f.scope.ELECTRUM_NOT_CONNECTED_ERR = 'offline';
  f.scope.ELECTRUM_NOT_CONNECTED_ERR_TOR = 'tor-offline';
  f.errors = [];
  f.scope.captureError = (error) => f.errors.push(error);
  const persist = f.scope.dbManager.updateObjectById;
  f.writes = [];
  f.scope.dbManager.updateObjectById = (schema, id, patch) => {
    f.writes.push(schema);
    return rejectWrite ? false : persist(schema, id, patch);
  };
  vm.runInNewContext(ts.transpileModule(
    functions('src/store/sagas/wallets.ts', ['refreshWalletsWorker']),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }
  ).outputText, f.scope);
  return f;
}

for (const kind of ['Wallet', 'Vault']) {
  test(`${kind}: rejected refresh persistence returns failure and clears syncing`, async () => {
    const f = refreshFixture(kind, true);
    assert.equal(await f.run('refreshWalletsWorker', {
      payload: { wallets: f.collections[kind], options: { hardRefresh: true }, requestId: 'failed-pull' },
    }), false);
    assert.deepEqual(f.writes, [kind]);
    assert.equal(f.collections[kind][0].specs.receivingAddress, 'before-refresh');
    assert.deepEqual(f.actions.filter((action) => action.type === 'setSyncing')
      .map((action) => action.payload.isSyncing), [true, false]);
    assert.equal(f.errors.length, 1);
    assert.ok(f.actions.some((action) => action.type === 'setElectrumNotConnectedErr' &&
      action.payload.includes('Failed to persist refreshed wallet')));
    const finished = f.actions.find((action) => action.type === 'finishRefreshRequest')?.payload;
    assert.equal(finished?.requestId, 'failed-pull');
    assert.equal(finished?.succeeded, false);
  });

  test(`${kind}: login never inspects stale specs after rejected refresh persistence`, async () => {
    const f = refreshFixture(kind, true);
    await f.run('autoWalletsSyncWorker', { payload: { backupCheckAppId: f.app.id } });
    assert.deepEqual(f.writes, [kind]);
    assert.equal(f.collections[kind][0].specs.receivingAddress, 'before-refresh');
    assert.equal(f.actions.some((action) => action.type === 'checkBackupFreshness'), false);
    assert.equal(f.state.bhr.pendingAllBackup, true);
  });

  test(`${kind}: login inspects backup only after successful refresh persistence`, async () => {
    const f = refreshFixture(kind);
    await f.run('autoWalletsSyncWorker', { payload: { backupCheckAppId: f.app.id } });
    assert.deepEqual(f.writes, [kind]);
    assert.equal(f.collections[kind][0].specs.receivingAddress, 'after-refresh');
    assert.equal(f.actions.filter((action) => action.type === 'checkBackupFreshness').length, 1);
    assert.equal(f.errors.length, 0);
  });
}

test('successful pull refresh completes only after refreshed specs are persisted', async () => {
  const f = refreshFixture('Wallet');
  assert.equal(await f.run('refreshWalletsWorker', {
    payload: { wallets: f.collections.Wallet, options: { hardRefresh: true }, requestId: 'saved-pull' },
  }), true);
  assert.equal(f.collections.Wallet[0].specs.receivingAddress, 'after-refresh');
  const finished = f.actions.find((action) => action.type === 'finishRefreshRequest')?.payload;
  assert.equal(finished?.requestId, 'saved-pull');
  assert.equal(finished?.succeeded, true);
});

test('refresh does not read or write another Realm during account handover', async () => {
  const f = refreshFixture('Wallet');
  f.app.id = 'new-profile'; // Realm B opened while Redux still names account A.
  assert.equal(await f.run('refreshWalletsWorker', {
    payload: { wallets: f.collections.Wallet, options: { hardRefresh: true } },
  }), false);
  assert.deepEqual(f.writes, []);
  assert.equal(f.collections.Wallet[0].specs.receivingAddress, 'before-refresh');
  assert.deepEqual(f.errors, []);
});

test('login backup inspection waits for wallet refresh to finish', async () => {
  let finishSync;
  const syncGate = new Promise((resolve) => { finishSync = resolve; });
  const f = fixture({ bhr: { pendingAllBackup: true }, syncGate });
  f.collections.Wallet.push(wallet('pending', NetworkType.MAINNET));
  const running = f.run('autoWalletsSyncWorker', {
    payload: { syncAll: false, hardRefresh: false, addNotifications: true, backupCheckAppId: f.app.id },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls.map(([type]) => type), ['sync']);
  assert.equal(f.actions.some((action) => action.type === 'checkBackupFreshness'), false);
  finishSync();
  await running;
  assert.equal(f.actions.filter((action) => action.type === 'checkBackupFreshness').length, 1);
});

test('failed refresh and account switch do not verify backup freshness', async () => {
  for (const option of ['syncFails', 'switchAppDuringSync']) {
    const f = fixture({ bhr: { pendingAllBackup: true }, [option]: true });
    f.collections.Wallet.push(wallet('pending', NetworkType.MAINNET));
    await f.run('autoWalletsSyncWorker', {
      payload: { backupCheckAppId: f.app.id },
    });
    assert.equal(f.actions.some((action) => action.type === 'checkBackupFreshness'), false);
  }
});

for (const network of [NetworkType.MAINNET, NetworkType.TESTNET]) {
  test(`wallet added after initial backup survives encrypted restore: ${network}`, async () => {
    const f = fixture();
    const initial = wallet('initial', NetworkType.MAINNET);
    const added = wallet('later', network, 1);
    f.collections.Wallet.push(initial);
    await f.run('updateAppImageWorker', { payload: { wallets: [initial] } });
    assert.equal(
      await f.run('addNewWalletsWorker', {
        payload: [{ walletType: WalletType.DEFAULT, walletDetails: { fixture: added } }],
      }),
      true
    );
    assert.deepEqual(Object.keys(f.remote.wallets).sort(), ['initial', 'later']);
    assert.ok(!f.remote.wallets.later.includes('later-address'));
    f.collections.Wallet = [];
    await f.run(
      'recoverApp',
      'mock mnemonic',
      Buffer.from('fixture'),
      encryption.generateEncryptionKey(f.app.primarySeed),
      f.app.id,
      f.app.subscription,
      f.remote,
      [],
      [],
      '2.5.16'
    );
    assert.deepEqual(JSON.parse(JSON.stringify(f.collections.Wallet)), [initial, added]);
  });
}

test('pending repair never suppresses a not-yet-persisted incremental addition', async () => {
  const f = fixture({ bhr: { pendingAllBackup: true } });
  f.collections.Wallet.push(wallet('initial', NetworkType.MAINNET));
  await f.run('addNewWalletsWorker', { payload: [{ walletType: WalletType.DEFAULT,
    walletDetails: { fixture: wallet('new', NetworkType.TESTNET) } }] });
  assert.ok(f.remote.wallets.new);
  assert.deepEqual(f.calls.map(([type]) => type), ['incremental']);
  assert.equal(f.state.bhr.pendingAllBackup, true);
});

test('disabled backup makes no uploads and preserves local creation', async () => {
  const f = fixture({ bhr: { automaticCloudBackup: false, pendingAllBackup: true } });
  await f.run('addNewWalletsWorker', {
    payload: [
      {
        walletType: WalletType.DEFAULT,
        walletDetails: { fixture: wallet('local', NetworkType.MAINNET) },
      },
    ],
  });
  assert.equal(f.calls.length, 0);
  assert.equal(f.collections.Wallet.length, 1);
});

for (const failure of [
  { online: false },
  { incrementalError: true },
]) {
  test(`backup failure retains wallet and retry: ${JSON.stringify(failure)}`, async () => {
    const f = fixture(failure);
    await f.run('addNewWalletsWorker', {
      payload: [
        {
          walletType: WalletType.DEFAULT,
          walletDetails: { fixture: wallet('local', NetworkType.MAINNET) },
        },
      ],
    });
    assert.equal(f.collections.Wallet.length, 1);
    assert.equal(f.state.bhr.pendingAllBackup, true);
    assert.ok(!f.remote.wallets.local);
    assert.ok(!f.actions.some((a) => a.type === 'setBackupAllSuccess' && a.payload === true));
  });
}

for (const networks of [
  [NetworkType.MAINNET],
  [NetworkType.TESTNET],
  [NetworkType.MAINNET, NetworkType.TESTNET],
]) {
  test(`recovery restores saved wallets and confirms Recovery Key status: ${networks}`, async () => {
    const f = fixture();
    // Recovery orchestration computes its own key from the fixture mnemonic.
    const seed = f.scope.bip39.mnemonicToSeedSync().toString('hex');
    const key = encryption.generateEncryptionKey(seed);
    networks.forEach((network) => {
      const w = wallet(network, network);
      f.remote.wallets[w.id] = encryption.encrypt(key, JSON.stringify(w));
    });
    await f.run('getAppImageWorker', { payload: { primaryMnemonic: 'mock fixture only' } });
    assert.deepEqual(
      f.actions.filter((a) => a.type === 'setAppImageError' && a.payload),
      []
    );
    const id = f.app.id;
    assert.equal(f.collections.Wallet.length, networks.length);
    assert.equal(f.state.account.recoveryKeyStatusByAppId[id], 'confirmed');
  });
}

test('relay rejection retains the existing wallet-creation failure contract', async () => {
  const f = fixture({ rejectIncremental: true });
  const result = await f.run('addNewWalletsWorker', {
    payload: [
      {
        walletType: WalletType.DEFAULT,
        walletDetails: { fixture: wallet('rejected', NetworkType.MAINNET) },
      },
    ],
  });
  assert.equal(result, false);
  assert.equal(f.collections.Wallet.length, 0);
  assert.equal(f.state.bhr.pendingAllBackup, true);
  assert.ok(f.actions.some((a) => a.type === 'relayWalletUpdateFail' && a.payload === 'rejected'));
});

for (const enabled of [true, false]) {
  test(`backup gate never performs an unsolicited full repair: ${enabled}`, async () => {
    const f = fixture({ bhr: { automaticCloudBackup: enabled, backupRepairCompletedByAppId: {} } });
    f.collections.Wallet.push(wallet('old', NetworkType.MAINNET));
    assert.equal(await f.run('checkBackupCondition'), !enabled);
    assert.equal(f.calls.length, 0);
    assert.equal(f.state.bhr.backupRepairCompletedByAppId[f.app.id], undefined);
  });
}

test('repair markers are stored in the separately persisted backup slice', () => {
  let config;
  const bhr = loadModule('src/store/reducers/bhr.ts', {
    'src/models/enums/BHR': loadModule('src/models/enums/BHR.ts'),
    'src/storage': { reduxStorage: {} },
    'redux-persist': {
      persistReducer: (settings, reducer) => {
        config = settings;
        return reducer;
      },
    },
  });
  let state = bhr.default(undefined, { type: 'init' });
  assert.equal(config.key, 'bhr');
  assert.ok(!config.blacklist.includes('backupRepairCompletedByAppId'));
  state = bhr.default(state, bhr.setBackupRepairState({ appId: 'first', phase: 'verified' }));
  state = bhr.default(state, bhr.setBackupRepairState({ appId: 'second', phase: 'verified' }));
  assert.equal(state.backupRepairCompletedByAppId.first, true);
  assert.equal(state.backupRepairCompletedByAppId.second, true);
  assert.equal(state.automaticCloudBackup, false);
});

test('pending repair does not suppress explicit wallet deletion', async () => {
  const f = fixture({ bhr: { pendingAllBackup: true } });
  f.collections.Wallet.push(wallet('deleted', NetworkType.MAINNET));
  const response = await f.run('deleteAppImageEntityWorker', {
    payload: { walletIds: ['deleted'] },
  });
  assert.equal(response.updated, true);
  assert.deepEqual(
    f.calls.map(([type]) => type),
    ['delete']
  );
  assert.equal(f.collections.Wallet.length, 0);
  assert.equal(Object.keys(f.remote.wallets).length, 0);
});
