const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = 'src/hooks/useUSDTWallets.ts';
const source = ts.createSourceFile(
  file, fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), ts.ScriptTarget.Latest, true
);
const declarations = new Map();
function find(node) {
  if (ts.isVariableDeclaration(node) &&
    ['isOriginCurrent', 'createWallet', 'deleteWallet', 'updateWallet'].includes(node.name.getText(source)))
    declarations.set(node.name.getText(source), node);
  ts.forEachChild(node, find);
}
find(source);
for (const name of ['isOriginCurrent', 'createWallet', 'deleteWallet', 'updateWallet'])
  assert.ok(declarations.has(name), `production USDT ${name} callback must exist`);
const code = ts.transpileModule(
  [...declarations.values()].map((declaration) => `const ${declaration.getText(source)};`).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture({ consent = true, creationPaused = true, switchDuringRemote = false,
  switchDuringGeneration = false, switchDuringUpdate = false } = {}) {
  const state = { active: 'A', remote: [], local: [], errors: [], dispatched: [], invalidated: [] };
  const scope = {
    appId: 'A',
    useCallback: (callback) => callback,
    RealmSchema: { KeeperApp: 'KeeperApp', USDTWallet: 'USDTWallet' },
    dbManager: {
      getObjectByIndex: (schema) => schema === 'KeeperApp' ? { id: state.active } : [],
      getObjectById: () => ({ id: 'wallet', name: 'old' }),
      createObject: async (_schema, wallet) => {
        state.local.push({ appId: state.active, wallet });
        return true;
      },
      updateObjectById: async (_schema, _id, update) => {
        state.local.push({ appId: state.active, update });
        if (switchDuringUpdate) state.active = 'B';
        return true;
      },
      deleteObjectById: (_schema, walletId) => {
        state.local.push({ appId: state.active, walletId });
        return true;
      },
    },
    reduxStore: { getState: () => ({
      storage: { appId: state.active },
      bhr: { automaticCloudBackupByAppId: { A: consent } },
    }) },
    isAutomaticCloudBackupEnabled: (backup, appId) => backup.automaticCloudBackupByAppId[appId],
    USDT_WALLET_CREATION_PAUSED: creationPaused,
    USDTWalletType: { DEFAULT: 'default' },
    USDTWalletSupportedNetwork: 'mainnet',
    generateUSDTWallet: async () => {
      if (switchDuringGeneration) state.active = 'B';
      return { id: 'wallet', name: 'new' };
    },
    canonical: JSON.stringify,
    recoveryContent: (_kind, wallet) => wallet,
    updateAppImage: (payload, originAppId) => ({ type: 'UPDATE_APP_IMAGE', payload, originAppId }),
    invalidateBackupRepair: (appId) => ({ type: 'INVALIDATE_BACKUP_REPAIR', appId }),
    setPendingAllBackup: (payload) => ({ type: 'SET_PENDING_ALL_BACKUP', payload }),
    markBackupMutation: (appId) => state.invalidated.push(appId),
    dispatch: (action) => state.dispatched.push(action),
    Relay: { deleteAppImageEntity: async (body) => {
      state.remote.push(body);
      if (switchDuringRemote) state.active = 'B';
      return { updated: true };
    } },
    setError: (error) => state.errors.push(error),
    captureError: () => {},
  };
  vm.runInNewContext(`${code}\nglobalThis.callbacks = { createWallet, deleteWallet, updateWallet };`, scope);
  return { state, ...scope.callbacks };
}

test('unconsented USDT wallet deletes locally without a relay write', async () => {
  const f = fixture({ consent: false });
  assert.equal(await f.deleteWallet('wallet'), true);
  assert.deepEqual(f.state.remote, []);
  assert.equal(f.state.local[0].appId, 'A');
});

test('remote response after account switch cannot delete B local wallet', async () => {
  const f = fixture({ switchDuringRemote: true });
  assert.equal(await f.deleteWallet('wallet'), false);
  assert.equal(f.state.remote.length, 1);
  assert.equal(f.state.remote[0].appId, 'A');
  assert.deepEqual(f.state.local, []);
  assert.deepEqual(f.state.invalidated, ['A']);
  assert.equal(f.state.dispatched.find((action) => action.type === 'SET_PENDING_ALL_BACKUP').payload.appId, 'A');
});

test('a stale A callback invoked while B is active makes no write', async () => {
  const f = fixture();
  f.state.active = 'B';
  assert.equal(await f.deleteWallet('wallet'), false);
  assert.deepEqual(f.state.remote, []);
  assert.deepEqual(f.state.local, []);
});

test('paused USDT setup returns before generation, persistence or backup', async () => {
  const f = fixture({ switchDuringGeneration: true });
  const result = await f.createWallet({ type: 'default', name: 'new', description: '' });
  assert.equal(result.error, 'USDT wallet setup is paused');
  assert.equal(f.state.active, 'A', 'wallet generation must not run during the pause');
  assert.deepEqual(f.state.local, []);
  assert.deepEqual(f.state.dispatched, []);
});

test('when setup resumes, wallet generation after account switch cannot persist to B', async () => {
  const f = fixture({ creationPaused: false, switchDuringGeneration: true });
  const result = await f.createWallet({ type: 'default', name: 'new', description: '' });
  assert.equal(result.error, 'Account changed');
  assert.deepEqual(f.state.local, []);
  assert.deepEqual(f.state.dispatched, []);
});

test('when setup resumes, wallet create dispatches backup with captured originating account', async () => {
  const f = fixture({ creationPaused: false });
  const result = await f.createWallet({ type: 'default', name: 'new', description: '' });
  assert.equal(result.newWallet.id, 'wallet');
  assert.equal(f.state.local[0].appId, 'A');
  assert.equal(f.state.dispatched[0].originAppId, 'A');
});

test('wallet update after account switch cannot dispatch backup for B', async () => {
  const f = fixture({ switchDuringUpdate: true });
  assert.equal(await f.updateWallet({ id: 'wallet', name: 'new' }), false);
  assert.equal(f.state.local[0].appId, 'A');
  assert.equal(f.state.dispatched.some((action) => action.type === 'UPDATE_APP_IMAGE'), false);
  assert.deepEqual(f.state.invalidated, ['A']);
});

test('a stale wallet update invoked while B is active makes no write', async () => {
  const f = fixture();
  f.state.active = 'B';
  assert.equal(await f.updateWallet({ id: 'wallet', name: 'new' }), false);
  assert.deepEqual(f.state.local, []);
  assert.deepEqual(f.state.dispatched, []);
});
