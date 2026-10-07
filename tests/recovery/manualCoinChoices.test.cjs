const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { image, makeImage, harness } = require('./helpers.cjs');
const { fixture, enums, encryption, wallet } = require('./sagaHarness.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const coin = (spendability = 'doNotSpend', extra = {}) => ({
  txId: 'disposable-transaction', vout: 0, value: 10000, address: 'disposable-address',
  spendability, isManualOverride: true, ...extra,
});
const withCoins = (kind = 'Wallet') => ({
  ...wallet('manual-choice', enums.NetworkType.MAINNET),
  entityKind: kind === 'Vault' ? enums.EntityKind.VAULT : enums.EntityKind.WALLET,
  signers: [], scheme: { m: 1, n: 1 },
  specs: { confirmedUTXOs: [coin('spendable', { isManualOverride: false })],
    unconfirmedUTXOs: [], transactions: [], addresses: { external: {}, internal: {} } },
});
function loadFunctions(scope, file, names) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), ts.ScriptTarget.Latest, true);
  const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => node.getText(source).replace(/^export /, '')).join('\n');
  assert.equal(source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).length, names.length);
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, scope);
}
function sagaFixture(options = {}) {
  const f = fixture(options);
  f.scope.getJSONFromRealmObject = clone;
  f.scope.captureError = error => { throw error; };
  f.scope.dbManager.getObjectById = (kind, id) => f.collections[kind].find(row => row.id === id);
  f.scope.dbManager.updateObjectById = (kind, id, update) => {
    if (options.rejectLocalWrite) return false;
    Object.assign(f.scope.dbManager.getObjectById(kind, id), clone(update));
    return true;
  };
  f.scope.Relay.updateVaultImage = async payload => {
    f.calls.push(['vault', payload]);
    if (options.incrementalError) throw Error('offline');
    if (options.rejectIncremental) return { updated: false };
    f.remote.vault = payload.vault;
    return { updated: true };
  };
  loadFunctions(f.scope, 'src/store/sagas/bhr.ts', ['updateVaultImageWorker']);
  loadFunctions(f.scope, 'src/store/sagas/utxos.ts', ['markUTXOSpendabilityWorker']);
  return f;
}
for (const kind of ['wallets', 'vaults']) test(`${kind}: compare manual choices but ignore chain-derived UTXO fields and confirmation order`, async () => {
  const local = makeImage(), remote = makeImage();
  local[kind].wallet = withCoins(); remote[kind].wallet = clone(local[kind].wallet);
  local[kind].wallet.specs.confirmedUTXOs = [coin()];
  assert.equal(await image.compareImages(local, remote), 'different');
  remote[kind].wallet.specs.confirmedUTXOs = [];
  remote[kind].wallet.specs.unconfirmedUTXOs = [coin('doNotSpend', { value: 20000, height: 0 })];
  assert.equal(await image.compareImages(local, remote), 'matched');
  remote[kind].wallet.specs.unconfirmedUTXOs[0].spendability = 'spendable';
  assert.equal(await image.compareImages(local, remote), 'different');
});

test('upgrade inspection detects a missing manual choice and repair includes it in encrypted readback', async () => {
  const f = harness(); f.local.Wallet.push(withCoins());
  assert.equal(await f.run(true), 'verified');
  f.local.Wallet[0].specs.confirmedUTXOs[0] = coin();
  assert.equal(await f.run(), 'different');
  assert.equal(await f.run(true), 'verified');
  const restored = JSON.parse(encryption.decrypt(encryption.generateEncryptionKey(f.app.primarySeed), f.remote.wallets['manual-choice']));
  assert.equal(restored.specs.confirmedUTXOs[0].spendability, 'doNotSpend');
  assert.equal(restored.specs.confirmedUTXOs[0].isManualOverride, true);
});

for (const kind of ['Wallet', 'Vault']) test(`${kind}: manual choice persists before incremental backup and invalidates prior verification`, async () => {
  const f = sagaFixture(); const w = withCoins(kind); f.collections[kind].push(w);
  const relayName = kind === 'Vault' ? 'updateVaultImage' : 'updateAppImage';
  const original = f.scope.Relay[relayName];
  f.scope.Relay[relayName] = payload => {
    assert.equal(f.collections[kind][0].specs.confirmedUTXOs[0].spendability, 'doNotSpend');
    return original(payload);
  };
  await f.run('markUTXOSpendabilityWorker', { payload: { wallet: w, txId: coin().txId, vout: 0, spendability: 'doNotSpend' } });
  const encrypted = kind === 'Vault' ? f.remote.vault : f.remote.wallets[w.id];
  const restored = JSON.parse(encryption.decrypt(encryption.generateEncryptionKey(f.app.primarySeed), encrypted));
  assert.equal(restored.specs.confirmedUTXOs[0].spendability, 'doNotSpend');
  assert.ok(f.actions.some(action => action.type === 'invalidateBackupRepair'));
});

for (const kind of ['Wallet', 'Vault']) for (const options of [
  { bhr: { automaticCloudBackup: false } }, { online: false }, { rejectIncremental: true }, { incrementalError: true },
]) test(`${kind}: local manual choice survives backup unavailability ${JSON.stringify(options)}`, async () => {
  const f = sagaFixture(options); const w = withCoins(kind); f.collections[kind].push(w);
  await f.run('markUTXOSpendabilityWorker', { payload: { wallet: w, txId: coin().txId, vout: 0, spendability: 'doNotSpend' } });
  assert.equal(f.collections[kind][0].specs.confirmedUTXOs[0].spendability, 'doNotSpend');
  if (options.bhr || options.online === false) assert.equal(f.calls.length, 0);
  if (!options.bhr) assert.equal(f.state.bhr.pendingAllBackup, true);
  assert.equal(f.remote.wallets[w.id], undefined);
  assert.equal(f.remote.vault, undefined);
});

test('missing outpoint and repeated identical choice do not upload', async () => {
  const f = sagaFixture(); const w = withCoins(); w.specs.confirmedUTXOs[0] = coin(); f.collections.Wallet.push(w);
  for (const txId of ['missing', coin().txId]) {
    await f.run('markUTXOSpendabilityWorker', { payload: { wallet: w, txId, vout: 0, spendability: 'doNotSpend' } });
  }
  assert.equal(f.calls.length, 0);
});

test('rejected local persistence never uploads an unapplied coin choice', async () => {
  const f = sagaFixture({ rejectLocalWrite: true }); const w = withCoins(); f.collections.Wallet.push(w);
  await f.run('markUTXOSpendabilityWorker', { payload: { wallet: w, txId: coin().txId, vout: 0, spendability: 'doNotSpend' } });
  assert.equal(f.collections.Wallet[0].specs.confirmedUTXOs[0].spendability, 'spendable');
  assert.equal(f.calls.length, 0);
});

for (const kind of ['Wallet', 'Vault']) for (const choice of ['doNotSpend', 'spendable']) test(`${kind}: restored manual ${choice} survives real refresh orchestration`, async () => {
  const f = sagaFixture(); const restored = withCoins(kind); restored.specs.confirmedUTXOs = [coin(choice)];
  f.collections[kind].push(restored);
  f.scope.ELECTRUM_CLIENT = { isClientConnected: true };
  f.scope.WalletUtilities.getNetworkByType = () => ({});
  f.scope.WalletOperations = { syncWalletsViaElectrumClient: async () => {
    const synced = clone(restored);
    synced.specs.confirmedUTXOs = [coin('spendable', { isManualOverride: false })];
    return { synchedWallets: [{ synchedWallet: synced, newUTXOs: [] }] };
  } };
  // Oppose the user's choice to prove the production manual-override branch wins.
  f.scope.classifyDustByAddress = () => ({
    taintedAddresses: new Set(choice === 'spendable' ? [coin().address] : []),
    initialTaintAddresses: new Set(), dustSpendTxids: new Set(),
  });
  f.scope.setSyncing = payload => ({ type: 'syncing', payload });
  f.scope.setElectrumNotConnectedErr = error => { throw Error(error); };
  f.scope.ELECTRUM_NOT_CONNECTED_ERR = 'offline'; f.scope.ELECTRUM_NOT_CONNECTED_ERR_TOR = 'tor-offline';
  loadFunctions(f.scope, 'src/store/sagas/wallets.ts', ['refreshWalletsWorker']);
  await f.run('refreshWalletsWorker', { payload: { wallets: [restored], options: { hardRefresh: true } } });
  assert.equal(f.collections[kind][0].specs.confirmedUTXOs[0].spendability, choice);
  assert.equal(f.collections[kind][0].specs.confirmedUTXOs[0].isManualOverride, true);
});
