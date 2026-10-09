const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { runSaga } = require('redux-saga');
const { call, delay, put } = require('redux-saga/effects');

const file = 'src/store/sagas/utxos.ts';
const source = ts.createSourceFile(
  file, fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), ts.ScriptTarget.Latest, true
);
const names = new Set([
  'currentOriginApp', 'persistTagsForOrigin', 'persistSpendabilityForOrigin',
  'originUiAction',
  'addLabelsWorker', 'bulkUpdateLabelsWorker', 'importLabelsWorker', 'markUTXOSpendabilityWorker',
]);
const extracted = source.statements
  .filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map((node) => node.getText(source).replace(/^export /, ''))
  .join('\n');
const code = ts.transpileModule(extracted, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture({ consent = true, switchDuringCheck = false, switchDuringWalletRead = false, switchDuringDescriptor = false } = {}) {
  const state = { active: 'A', reduxActive: 'A', networkType: 'MAINNET', saved: [], deleted: [], uploaded: [], uiActions: [], failed: 0, consent };
  const dbManager = {
    getObjectByIndex: () => ({ id: state.active, primarySeed: `seed-${state.active}` }),
    createObjectBulk: (_schema, tags) => {
      state.saved.push({ appId: state.active, tags });
      return true;
    },
    deleteObjectById: (_schema, id) => {
      state.deleted.push({ appId: state.active, id });
      return true;
    },
    getObjectById: () => {
      if (switchDuringWalletRead) state.active = 'B';
      return { id: 'wallet', specs: {
        confirmedUTXOs: [{ txId: 'tx', vout: 0, spendability: 'spendable' }],
      } };
    },
    updateObjectById: () => {
      state.saved.push({ appId: state.active, walletUpdated: true });
      return true;
    },
  };
  const scope = {
    call, delay, put, dbManager, console,
    store: { getState: () => ({ storage: { appId: state.reduxActive }, settings: { bitcoinNetworkType: state.networkType } }) },
    RealmSchema: { KeeperApp: 'KeeperApp', Tags: 'Tags', Wallet: 'Wallet', Vault: 'Vault' },
    LabelRefType: { TXN: 'TXN', ADDR: 'ADDR', OUTPUT: 'OUTPUT' },
    EntityKind: { VAULT: 'VAULT' },
    generateAbbreviatedOutputDescriptors: () => {
      if (switchDuringDescriptor) state.networkType = 'TESTNET';
      return 'disposable-origin';
    },
    generateEncryptionKey: (seed) => seed,
    hash256: (value) => `hash(${value})`,
    encrypt: (_key, value) => value,
    getJSONFromRealmObject: (value) => value,
    Relay: { modifyLabels: async (appId, added, removed) => {
      state.uploaded.push({ appId, added, removed });
      return { updated: true };
    } },
    checkBackupCondition: function* (appId) {
      assert.equal(appId, 'A');
      if (switchDuringCheck) {
        state.active = 'B';
        state.reduxActive = 'B';
      }
      return !state.consent;
    },
    setServerBackupFailed: function* (appId) {
      assert.equal(appId, 'A');
      state.failed++;
    },
    updateAppImageWorker: function* () { throw Error('unexpected backup'); },
    updateVaultImageWorker: function* () { throw Error('unexpected backup'); },
    setSyncingUTXOs: (value) => ({ type: 'sync', value }),
    setSyncingUTXOError: (value) => ({ type: 'error', value }),
    resetState: () => ({ type: 'reset' }),
  };
  vm.runInNewContext(code, scope);
  const run = (name, payload, originAppId = 'A') => runSaga(
    { dispatch: (action) => state.uiActions.push({ ...action, active: state.active }),
      getState: () => ({}) }, scope[name], { payload, originAppId }
  ).toPromise();
  return { state, run };
}

const wallet = { id: 'wallet', entityKind: 'WALLET' };
const add = { txId: 'tx', wallet, labels: [{ name: 'note', isSystem: false }], type: 'TXN' };

test('an A label action starting after switch to B writes neither Realm nor relay', async () => {
  const f = fixture();
  f.state.active = 'B';
  f.state.reduxActive = 'B';
  await f.run('addLabelsWorker', add);
  assert.deepEqual(f.state.saved, []);
  assert.deepEqual(f.state.uploaded, []);
});

test('Redux account B with A Realm still open cannot persist A labels', async () => {
  const f = fixture();
  f.state.reduxActive = 'B';
  await f.run('addLabelsWorker', add);
  assert.deepEqual(f.state.saved, []);
  assert.deepEqual(f.state.uploaded, []);
});

test('switch during connectivity check leaves A local label and makes no B upload', async () => {
  const f = fixture({ switchDuringCheck: true });
  await f.run('addLabelsWorker', add);
  assert.equal(f.state.saved.length, 1);
  assert.equal(f.state.saved[0].appId, 'A');
  assert.deepEqual(f.state.uploaded, []);
  assert.equal(f.state.failed, 0);
  assert.ok(f.state.uiActions.filter((action) => action.active === 'B').every(
    (action) => action.originAppId === 'A'
  ));
});

test('unconsented A can label locally with zero backup upload', async () => {
  const f = fixture({ consent: false });
  await f.run('importLabelsWorker', { labels: [{ type: 'TX', ref: 'tx', label: 'note', origin: 'fixture' }] });
  assert.equal(f.state.saved[0].appId, 'A');
  assert.deepEqual(f.state.uploaded, []);
});

test('network switch before scoped label persistence writes neither Realm nor relay', async () => {
  const f = fixture({ switchDuringDescriptor: true });
  await f.run('bulkUpdateLabelsWorker', {
    labelChanges: { added: [{ name: 'note', isSystem: false }], deleted: [] },
    UTXO: { txId: 'tx', vout: 0 },
    wallet: { ...wallet, networkType: 'MAINNET' },
    scope: { appId: 'A', networkType: 'MAINNET' },
  });
  assert.deepEqual(f.state.saved, []);
  assert.deepEqual(f.state.uploaded, []);
});

test('UTXO spendability cannot persist into B after an A action waits for Realm', async () => {
  const f = fixture({ switchDuringWalletRead: true });
  await f.run('markUTXOSpendabilityWorker', {
    wallet, txId: 'tx', vout: 0, spendability: 'doNotSpend',
  });
  assert.equal(f.state.active, 'B');
  assert.deepEqual(f.state.saved, []);
  assert.deepEqual(f.state.uploaded, []);
});
