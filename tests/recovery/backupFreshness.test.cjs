const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, enums, encryption, wallet, loadModule } = require('./sagaHarness.cjs');
const { NetworkType, WalletType } = enums;

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
