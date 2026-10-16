const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');
const { runSaga } = require('redux-saga');
const { fixture, enums, account, wallet, signer, loadModule, functions } = require('./sagaHarness.cjs');

// Disposable adapters only: run the production setup, wallet/key registration,
// faucet and refresh workers without a live relay, Realm file or user seed.
function freshInstallFixture(options = {}) {
  const network = options.network || enums.NetworkType.TESTNET;
  const f = fixture({ bhr: { automaticCloudBackup: false } });
  f.state.storage.appId = '';
  f.state.settings.bitcoinNetworkType = network;
  f.state.settings.loginMethod = 'PIN';
  let activeApp;
  let activeRealm = {};
  let rejectKeyWrite = options.rejectKeyWrite;
  let generationCount = 0;
  let faucetRequests = 0;
  const writes = [];
  const txid = 'c'.repeat(64);
  const originalGet = f.scope.dbManager.getObjectByIndex;
  const originalCreate = f.scope.dbManager.createObject;
  const originalBulkCreate = f.scope.dbManager.createObjectBulk;
  const originalGetCollection = f.scope.dbManager.getCollection;
  f.scope.realm = { getDatabase: () => activeRealm };
  f.scope.dbManager.getObjectByIndex = (schema, ...args) =>
    schema === 'KeeperApp' ? activeApp : originalGet(schema, ...args);
  f.scope.dbManager.createObject = (schema, value, ...args) => {
    writes.push({ schema, owner: f.state.storage.appId });
    if ((schema === 'Wallet' && options.rejectWalletWrite) ||
      (schema === 'Signer' && rejectKeyWrite)) return false;
    if (schema !== 'KeeperApp') return originalCreate(schema, value, ...args);
    if (options.rejectAppWrite) return false;
    activeApp = { ...value };
    options.afterAppWrite?.(f);
    return true;
  };
  f.scope.dbManager.createObjectBulk = (schema, values, ...args) => {
    writes.push({ schema, owner: f.state.storage.appId });
    if ((schema === 'Wallet' && options.rejectWalletWrite) ||
      (schema === 'Signer' && rejectKeyWrite)) return false;
    return originalBulkCreate(schema, values, ...args);
  };
  f.scope.dbManager.getCollection = (schema) => {
    const values = originalGetCollection(schema);
    if (schema === 'Signer' && values.length) options.afterRecoveryKeyRead?.(f);
    return values;
  };
  f.scope.bip39.generateMnemonic = () => 'disposable setup fixture';
  f.scope.WalletUtilities.getDerivationPath = () => "m/84'/1'/0'";
  f.scope.LoginMethod = { BIOMETRIC: 'BIOMETRIC' };
  f.scope.Relay.createNewApp = async () => {
    options.onRelay?.(f);
    return { created: true };
  };
  f.scope.addNewWallet = async () => {
    generationCount += 1;
    options.onWalletGeneration?.(f);
    return {
      ...wallet('disposable-mobile', network),
      specs: {
        receivingAddress: 'tb1qdisposable',
        balances: { confirmed: 0, unconfirmed: 0 },
        confirmedUTXOs: [], unconfirmedUTXOs: [], transactions: [],
        addresses: { external: {}, internal: {} },
      },
    };
  };
  f.scope.setupRecoveryKeySigningKey = () => ({
    ...signer('RECOVERY', network, enums.SignerType.SEED_WORDS), hidden: true,
  });
  f.scope.setAppCreationError = (payload) => ({ type: 'setAppCreationError', payload });
  f.scope.resetRealyWalletState = () => ({ type: 'resetRealyWalletState' });
  f.scope.getJSONFromRealmObject = (value) => JSON.parse(JSON.stringify(value));
  f.scope.WALLET_SYNC_SCOPE_CHANGED = 'WALLET_SYNC_SCOPE_CHANGED';
  f.scope.ELECTRUM_CLIENT = { isClientConnected: true };
  f.scope.ElectrumClient = {
    getConnectionGeneration: () => 1,
    assertConnectionGeneration: (_generation, currentNetwork) => assert.equal(currentNetwork, network),
    syncHistoryByAddress: async () => ({ txids: [txid] }),
  };
  f.scope.WalletUtilities.getNetworkByType = () => ({});
  f.scope.WalletOperations = {
    getNextFreeAddress: (w) => w.specs.receivingAddress,
    syncWalletsViaElectrumClient: async (wallets) => {
      const synced = f.scope.getJSONFromRealmObject(wallets[0]);
      synced.specs.unconfirmedUTXOs = [{ txId: txid, vout: 0, value: 1000 }];
      synced.specs.balances = { confirmed: 0, unconfirmed: 1000 };
      synced.specs.hasNewUpdates = true;
      return { synchedWallets: [{ synchedWallet: synced, newUTXOs: [] }] };
    },
  };
  f.scope.Relay.getTestcoins = async (_address, requestedNetwork, appId) => {
    faucetRequests += 1;
    assert.equal(requestedNetwork, enums.NetworkType.TESTNET);
    assert.equal(appId, activeApp.id);
    return { txid, funded: true };
  };
  f.scope.isFaucetTxVisible = loadModule('src/store/sagas/faucetVisibility.ts').isFaucetTxVisible;
  f.scope.classifyDustByAddress = () => ({
    taintedAddresses: new Set(), initialTaintAddresses: new Set(), dustSpendTxids: new Set(),
  });
  for (const name of ['setTestCoinsReceived', 'setTestCoinsFailed', 'setTestCoinsPending',
    'setTestCoinsQuotaReached', 'setSyncing', 'setElectrumNotConnectedErr']) {
    f.scope[name] = (payload) => ({ type: name, payload });
  }
  f.scope.ELECTRUM_NOT_CONNECTED_ERR = 'offline';
  f.scope.ELECTRUM_NOT_CONNECTED_ERR_TOR = 'tor-offline';
  f.scope.delay = () => Promise.resolve();
  const dispatch = (action) => {
    f.actions.push(action);
    if (action.type === 'setAppId') f.state.storage.appId = action.payload;
    if (action.type === 'setAppCreated') f.state.storage.appCreated = action.payload;
    f.state.account = account.default(f.state.account, action);
    options.onDispatch?.(f, action);
    return action;
  };
  f.scope.store = { getState: () => f.state, dispatch };
  vm.runInNewContext(ts.transpileModule([
    functions('src/store/sagas/storage.ts', ['setupKeeperAppWorker']),
    functions('src/store/sagas/wallets.ts', ['refreshWalletsWorker', 'testcoinsWorker']),
  ].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, f.scope);
  f.run = (name, ...args) => runSaga({ getState: () => f.state, dispatch },
    f.scope[name], ...args).toPromise();
  f.setup = () => f.run('setupKeeperAppWorker', { payload: { appName: 'Disposable', fcmToken: '' } });
  f.switchToB = () => {
    activeRealm = {};
    activeApp = { id: 'B' };
    f.state.storage.appId = 'B';
    f.collections.Wallet = [wallet('disposable-mobile', network)];
    f.collections.Signer = [];
    f.state.account = { ...f.state.account, allAccounts: [{ appId: 'B' }] };
    f.switchActionIndex = f.actions.length;
    f.switchWriteIndex = writes.length;
  };
  f.allowKeyWrites = () => { rejectKeyWrite = false; };
  f.counts = () => ({ generationCount, faucetRequests });
  f.writes = writes;
  return f;
}

for (const network of [enums.NetworkType.MAINNET, enums.NetworkType.TESTNET]) {
  test(`fresh ${network} setup persists one default wallet and Recovery Key before readiness`, async () => {
    const f = freshInstallFixture({ network });
    await f.setup();
    assert.equal(f.collections.Wallet.length, 1);
    assert.equal(f.collections.Signer.length, 1);
    assert.equal(f.collections.Signer[0].networkType, network);
    assert.equal(f.state.storage.appCreated, true);
    assert.equal(f.state.account.defaultWalletCreatedByAppId[f.state.storage.appId][network], true);
    assert.equal(f.actions.some((action) => action.type === 'setAppCreationError'), false);
    assert.equal(f.calls.length, 0, 'fresh setup must keep automatic backup off');
  });
}

test('fresh Testnet setup -> one Receive Test Sats request persists a visible balance in the same session', async () => {
  const f = freshInstallFixture();
  await f.setup();
  const freshWallet = f.collections.Wallet[0];
  assert.ok(freshWallet, 'setup must produce the wallet before opening its settings');
  await f.run('testcoinsWorker', {
    originAppId: f.state.storage.appId, payload: { wallet: freshWallet },
  });
  assert.deepEqual(f.counts(), { generationCount: 1, faucetRequests: 1 });
  assert.equal(f.collections.Wallet.length, 1);
  assert.equal(freshWallet.specs.balances.confirmed + freshWallet.specs.balances.unconfirmed, 1000);
  assert.ok(f.actions.some((action) => action.type === 'setTestCoinsReceived' && action.payload));
});

for (const failure of ['rejectAppWrite', 'rejectWalletWrite', 'rejectKeyWrite']) {
  test(`failed ${failure} never marks fresh setup ready`, async () => {
    const f = freshInstallFixture({ [failure]: true });
    await f.setup();
    assert.notEqual(f.state.storage.appCreated, true);
    assert.equal(f.state.account.allAccounts.length, 0);
    assert.deepEqual(Object.keys(f.state.account.defaultWalletCreatedByAppId), []);
    assert.ok(f.actions.some((action) => action.type === 'setAppCreationError' && action.payload));
  });
}

test('retry after key persistence failure preserves the one already-funded default wallet', async () => {
  const f = freshInstallFixture({ rejectKeyWrite: true });
  await f.setup();
  assert.equal(f.collections.Wallet.length, 1);
  const retained = f.collections.Wallet[0];
  retained.specs.balances.unconfirmed = 321;
  f.allowKeyWrites();
  await f.setup();
  assert.equal(f.state.storage.appCreated, true);
  assert.equal(f.collections.Wallet.length, 1);
  assert.equal(f.collections.Wallet[0], retained);
  assert.equal(retained.specs.balances.unconfirmed, 321);
  assert.equal(f.counts().generationCount, 1);
});

for (const boundary of ['onRelay', 'afterAppWrite', 'onWalletGeneration', 'afterRecoveryKeyRead']) {
  test(`account switch at ${boundary} cannot publish A setup or mutate B`, async () => {
    const f = freshInstallFixture({ [boundary]: (current) => current.switchToB() });
    await f.setup();
    assert.equal(f.state.storage.appId, 'B');
    assert.notEqual(f.state.storage.appCreated, true);
    assert.deepEqual(f.state.account.allAccounts, [{ appId: 'B' }]);
    assert.deepEqual(Object.keys(f.state.account.defaultWalletCreatedByAppId), []);
    assert.equal(f.collections.Signer.length, 0);
    assert.equal(f.collections.Wallet[0].specs.balances.confirmed, 10000);
    assert.deepEqual(f.writes.slice(f.switchWriteIndex), []);
    assert.deepEqual(f.actions.slice(f.switchActionIndex), [], 'no stale setup errors or readiness UI on B');
  });
}

test('switch triggered by account registration cannot mark B default wallet or app ready', async () => {
  const f = freshInstallFixture({ onDispatch: (current, action) => {
    if (action.type === 'account/addAccount') current.switchToB();
  } });
  await f.setup();
  assert.equal(f.state.storage.appId, 'B');
  assert.notEqual(f.state.storage.appCreated, true);
  assert.deepEqual(Object.keys(f.state.account.defaultWalletCreatedByAppId), []);
  assert.deepEqual(f.actions.slice(f.switchActionIndex), []);
});
