const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');
const { fixture, enums, wallet, loadModule, functions } = require('./sagaHarness.cjs');

const txid = 'a'.repeat(64);

function faucetFixture(balanceOnAttempt) {
  const f = fixture();
  f.state.settings.bitcoinNetworkType = enums.NetworkType.TESTNET;
  f.app.networkType = enums.NetworkType.TESTNET;
  const stored = {
    ...wallet('disposable-faucet', enums.NetworkType.TESTNET),
    specs: {
      balances: { confirmed: 0, unconfirmed: 0 },
      confirmedUTXOs: [],
      unconfirmedUTXOs: [],
      addresses: { external: {}, internal: {} },
      transactions: [],
      receivingAddress: 'tb1qdisposable',
    },
  };
  f.collections.Wallet.push(stored);

  f.scope.getJSONFromRealmObject = (value) => JSON.parse(JSON.stringify(value));
  f.scope.store = { getState: () => f.state };
  f.scope.WALLET_SYNC_SCOPE_CHANGED = 'WALLET_SYNC_SCOPE_CHANGED';
  f.scope.ELECTRUM_CLIENT = {
    isClientConnected: true,
    activePeer: { networkType: enums.NetworkType.TESTNET },
  };
  let historyPolls = 0;
  f.scope.ElectrumClient = {
    getConnectionGeneration: () => 1,
    assertConnectionGeneration: (_generation, network) => {
      assert.equal(network, enums.NetworkType.TESTNET);
    },
    syncHistoryByAddress: async () => {
      historyPolls += 1;
      return { txids: [txid] };
    },
  };
  f.scope.WalletUtilities.getNetworkByType = () => ({ network: 'testnet4' });
  let refreshes = 0;
  f.scope.WalletOperations = {
    getNextFreeAddress: () => stored.specs.receivingAddress,
    syncWalletsViaElectrumClient: async (wallets) => {
      refreshes += 1;
      const synced = f.scope.getJSONFromRealmObject(wallets[0]);
      synced.specs.unconfirmedUTXOs = [{
        txId: txid,
        vout: 0,
        address: stored.specs.receivingAddress,
        value: 1000,
      }];
      synced.specs.balances = { confirmed: 0, unconfirmed: balanceOnAttempt(refreshes) };
      synced.specs.hasNewUpdates = true;
      return { synchedWallets: [{ synchedWallet: synced, newUTXOs: [] }] };
    },
  };
  let relayRequests = 0;
  f.scope.Relay.getTestcoins = async () => {
    relayRequests += 1;
    return { txid, funded: true };
  };
  f.scope.isFaucetTxVisible = loadModule('src/store/sagas/faucetVisibility.ts').isFaucetTxVisible;
  f.scope.classifyDustByAddress = () => ({
    taintedAddresses: new Set(), initialTaintAddresses: new Set(), dustSpendTxids: new Set(),
  });
  for (const name of [
    'setTestCoinsReceived', 'setTestCoinsFailed', 'setTestCoinsPending',
    'setTestCoinsQuotaReached', 'setSyncing', 'setElectrumNotConnectedErr',
  ]) {
    f.scope[name] = (payload) => ({ type: name, payload });
  }
  f.scope.ELECTRUM_NOT_CONNECTED_ERR = 'offline';
  f.scope.ELECTRUM_NOT_CONNECTED_ERR_TOR = 'tor-offline';
  f.scope.delay = () => Promise.resolve();

  const writes = [];
  const originalUpdate = f.scope.dbManager.updateObjectById;
  f.scope.dbManager.updateObjectById = (schema, id, patch) => {
    writes.push({ schema, balance: patch.specs.balances.unconfirmed });
    return originalUpdate(schema, id, patch);
  };
  vm.runInNewContext(ts.transpileModule(
    functions('src/store/sagas/wallets.ts', ['refreshWalletsWorker', 'testcoinsWorker']),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }
  ).outputText, f.scope);

  return {
    f, stored, writes,
    getCounts: () => ({ relayRequests, historyPolls, refreshes }),
  };
}

test('faucet receipt waits for a funded UTXO and Home-visible persisted balance', async () => {
  const { f, stored, writes, getCounts } = faucetFixture((attempt) => attempt === 1 ? 0 : 1000);
  await f.run('testcoinsWorker', { payload: { wallet: stored } });

  assert.deepEqual(getCounts(), { relayRequests: 1, historyPolls: 2, refreshes: 2 });
  assert.deepEqual(writes, [
    { schema: 'Wallet', balance: 0 },
    { schema: 'Wallet', balance: 1000 },
  ]);
  assert.deepEqual(f.actions.filter((action) => action.type === 'setTestCoinsReceived')
    .map((action) => action.payload), [false, true]);
  assert.equal(stored.specs.balances.unconfirmed, 1000);
  assert.equal(stored.specs.unconfirmedUTXOs[0].txId, txid);
});

test('faucet reports pending when the funded txid persists but visible balance stays zero', async () => {
  const { f, stored, writes, getCounts } = faucetFixture(() => 0);
  await f.run('testcoinsWorker', { payload: { wallet: stored } });

  assert.deepEqual(getCounts(), { relayRequests: 1, historyPolls: 8, refreshes: 8 });
  assert.equal(writes.length, 8);
  assert.equal(f.actions.some((action) =>
    action.type === 'setTestCoinsReceived' && action.payload === true), false);
  assert.ok(f.actions.some((action) =>
    action.type === 'setTestCoinsPending' && action.payload === 'propagation'));
});
