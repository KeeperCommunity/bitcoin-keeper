const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { fixture, enums, wallet } = require('./sagaHarness.cjs');

test('BTC wallet delete completion reflects saved local removal while a rejected cloud delete stays pending', async () => {
  const f = fixture();
  f.collections.Wallet.push(wallet('keep', enums.NetworkType.MAINNET));
  f.scope.Relay.deleteAppImageEntity = async () => ({ updated: false, error: 'rejected' });
  const completed = [];

  const result = await f.run('deleteAppImageEntityRequestWorker', {
    originAppId: f.app.id,
    payload: { walletIds: ['keep'] },
    onComplete: (deleted) => completed.push(deleted),
  });

  assert.equal(result, true);
  assert.deepEqual(completed, [true]);
  assert.deepEqual(f.collections.Wallet, []);
  assert.equal(f.state.bhr.pendingAllBackupByAppId[f.app.id], true);
});

test('BTC wallet delete completion is true only after the Realm object is gone', async () => {
  const f = fixture();
  f.collections.Wallet.push(wallet('remove', enums.NetworkType.MAINNET));
  const completed = [];

  const result = await f.run('deleteAppImageEntityRequestWorker', {
    originAppId: f.app.id,
    payload: { walletIds: ['remove'] },
    onComplete: (deleted) => completed.push(deleted),
  });

  assert.equal(result, true);
  assert.deepEqual(completed, [true]);
  assert.deepEqual(f.collections.Wallet, []);
});

test('BTC wallet delete completion is false if Realm reports success but retains the object', async () => {
  const f = fixture();
  f.collections.Wallet.push(wallet('keep', enums.NetworkType.MAINNET));
  f.scope.dbManager.deleteObjectById = () => true;
  const completed = [];

  const result = await f.run('deleteAppImageEntityRequestWorker', {
    originAppId: f.app.id,
    payload: { walletIds: ['keep'] },
    onComplete: (deleted) => completed.push(deleted),
  });

  assert.equal(result, false);
  assert.deepEqual(completed, [false]);
  assert.deepEqual(f.collections.Wallet.map((row) => row.id), ['keep']);
  assert.equal(f.state.bhr.pendingAllBackupByAppId[f.app.id], true);
});

test('vault delete reports failure if Realm reports success but retains the object', async () => {
  const f = fixture();
  f.collections.Vault.push({ id: 'keep' });
  f.scope.deleteVaultImageWorker = function* () { return { updated: true }; };
  f.scope.dbManager.deleteObjectById = () => true;

  await f.run('deleteVaultWorker', {
    originAppId: f.app.id,
    payload: { vaultId: 'keep' },
  });

  assert.ok(f.actions.some((action) => action.type === 'relayVaultUpdateFail'));
  assert.ok(!f.actions.some((action) => action.type === 'relayVaultUpdateSuccess'));
  assert.deepEqual(f.collections.Vault.map((row) => row.id), ['keep']);
});

test('vault delete callback is scoped to its request and fires once after local removal', async () => {
  const f = fixture();
  f.collections.Vault.push({ id: 'remove' });
  f.scope.deleteVaultImageWorker = function* () { return { updated: true }; };
  const completed = [];

  const result = await f.run('deleteVaultRequestWorker', {
    originAppId: f.app.id,
    payload: { vaultId: 'remove' },
    onComplete: (deleted) => completed.push(deleted),
  });

  assert.equal(result, true);
  assert.deepEqual(completed, [true]);
  assert.deepEqual(f.collections.Vault, []);
  assert.ok(!f.actions.some((action) =>
    ['setRelayVaultUpdateLoading', 'relayVaultUpdateSuccess', 'relayVaultUpdateFail']
      .includes(action.type)));
});

test('vault delete callback reports saved local removal once while cloud deletion is pending', async () => {
  const f = fixture();
  f.collections.Vault.push({ id: 'keep' });
  f.scope.Relay.deleteVaults = async () => ({ updated: false, error: 'rejected' });
  const completed = [];

  const result = await f.run('deleteVaultRequestWorker', {
    originAppId: f.app.id,
    payload: { vaultId: 'keep' },
    onComplete: (deleted) => completed.push(deleted),
  });

  assert.equal(result, true);
  assert.deepEqual(completed, [true]);
  assert.deepEqual(f.collections.Vault, []);
  assert.equal(f.state.bhr.pendingAllBackupByAppId[f.app.id], true);
  assert.ok(!f.actions.some((action) =>
    ['setRelayVaultUpdateLoading', 'relayVaultUpdateSuccess', 'relayVaultUpdateFail']
      .includes(action.type)));
});

test('legacy vault delete without a callback retains its global result state', async () => {
  const f = fixture();
  f.collections.Vault.push({ id: 'remove' });
  f.scope.deleteVaultImageWorker = function* () { return { updated: true }; };

  assert.equal(await f.run('deleteVaultRequestWorker', {
    originAppId: f.app.id,
    payload: { vaultId: 'remove' },
  }), true);
  assert.ok(f.actions.some((action) => action.type === 'setRelayVaultUpdateLoading'));
  assert.ok(f.actions.some((action) => action.type === 'relayVaultUpdateSuccess'));
});

test('overlapping vault saga requests report their own outcomes despite unrelated vault state', async () => {
  const f = fixture();
  f.collections.Vault.push({ id: 'first' }, { id: 'second' });
  const pending = new Map();
  f.scope.deleteVaultImageWorker = ({ payload }) =>
    new Promise((resolve) => pending.set(payload.vaultIds[0], resolve));
  const completed = [];
  const first = f.run('deleteVaultRequestWorker', {
    originAppId: f.app.id, payload: { vaultId: 'first' },
    onComplete: (deleted) => completed.push(['first', deleted]),
  });
  const second = f.run('deleteVaultRequestWorker', {
    originAppId: f.app.id, payload: { vaultId: 'second' },
    onComplete: (deleted) => completed.push(['second', deleted]),
  });
  for (let attempt = 0; attempt < 20 && pending.size < 2; attempt++)
    await new Promise(setImmediate);
  assert.equal(pending.size, 2);

  f.actions.push({ type: 'relayVaultUpdateSuccess', source: 'unrelated' });
  assert.deepEqual(completed, []);
  pending.get('second')({ updated: true });
  assert.equal(await second, true);
  assert.deepEqual(completed, [['second', true]]);
  pending.get('first')({ updated: false, error: 'rejected' });
  assert.equal(await first, true);
  assert.deepEqual(completed, [['second', true], ['first', true]]);
  assert.deepEqual(f.collections.Vault, []);
});

test('signer delete completion is false if Realm reports success but retains the signer', async () => {
  const f = fixture();
  f.collections.Signer.push({ id: 'keep' });
  f.scope.dbManager.deleteObjectByPrimaryKey = () => true;
  const completed = [];

  const result = await f.run('deleteAppImageEntityRequestWorker', {
    originAppId: f.app.id,
    payload: { signerIds: ['keep'], walletIds: [] },
    onComplete: (deleted) => completed.push(deleted),
  });

  assert.equal(result, false);
  assert.deepEqual(completed, [false]);
  assert.deepEqual(f.collections.Signer.map((row) => row.id), ['keep']);
});

const screenFile = path.join(__dirname, '../../src/screens/AppSettings/ManageWallets.tsx');
const screen = ts.createSourceFile(screenFile, fs.readFileSync(screenFile, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let deleteDeclaration;
let guardDeclaration;
function findDelete(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(screen) === 'deleteSelectedEntity')
    deleteDeclaration = node;
  if (ts.isVariableDeclaration(node) && node.name.getText(screen) === 'canDeleteRecoveryEntity')
    guardDeclaration = node;
  ts.forEachChild(node, findDelete);
}
findDelete(screen);
assert.ok(deleteDeclaration, 'production ManageWallets delete handler must exist');
assert.ok(guardDeclaration, 'production ManageWallets backup deletion guard must exist');
const deleteHandlerCode = ts.transpileModule(
  `const ${guardDeclaration.getText(screen)}; const ${deleteDeclaration.getText(screen)}; globalThis.deleteSelectedEntity = deleteSelectedEntity;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }
).outputText;

function screenFixture(entityKind, usdtResult = false) {
  const state = {
    active: 'A', session: 1, consent: true, verified: true,
    present: true, presentById: new Map(), actions: [], toasts: [],
  };
  const scope = {
    React: { createElement: (component) => component },
    TickIcon: 'tick', ToastErrorIcon: 'error',
    EntityKind: { WALLET: 'WALLET', VAULT: 'VAULT', USDT_WALLET: 'USDT_WALLET' },
    RealmSchema: { KeeperApp: 'KeeperApp', Wallet: 'Wallet', Vault: 'Vault', USDTWallet: 'USDTWallet' },
    selectedWallet: { id: 'keep', entityKind },
    dbManager: {
      getObjectByIndex: () => ({ id: state.active }),
      getObjectById: (_schema, id) =>
        (state.presentById.has(id) ? state.presentById.get(id) : state.present)
          ? { id }
          : undefined,
    },
    activeRealmAppId: () => state.active,
    currentBackupAccountSession: () => state.session,
    store: { getState: () => ({ storage: { appId: state.active }, bhr: {
      automaticCloudBackupByAppId: { [state.active]: state.consent },
    } }) },
    isAutomaticCloudBackupEnabled: (backup, appId) =>
      backup.automaticCloudBackupByAppId[appId] === true,
    isBackupVerificationCurrent: (appId) => state.verified && appId === state.active,
    deleteAppImageEntity: (request) => ({ type: 'DELETE_BTC', ...request }),
    deleteVault: (id, onComplete) => ({ type: 'DELETE_VAULT', id, onComplete }),
    deleteUSDTWallet: async () => usdtResult,
    dispatch: (action) => state.actions.push(action),
    showToast: (message, icon) => state.toasts.push({ message, icon }),
    errorText: {
      waletDeleted: 'Wallet deleted',
      vaultDeleted: 'Vault deleted',
      failedToDeleteVault: 'Failed to delete vault',
    },
  };
  vm.runInNewContext(deleteHandlerCode, scope);
  return { state, scope, deleteSelectedEntity: scope.deleteSelectedEntity };
}

test('ManageWallets waits for the BTC delete outcome before showing a toast', async () => {
  const f = screenFixture('WALLET');
  await f.deleteSelectedEntity();
  assert.equal(f.state.actions.length, 1);
  assert.deepEqual(f.state.toasts, []);

  f.state.actions[0].onComplete(false);
  assert.equal(f.state.toasts[0].message, 'Failed to delete wallet');
});

test('ManageWallets withholds a consented BTC Delete after PIN if Hide is still pending', async () => {
  const f = screenFixture('WALLET');
  f.state.verified = false;
  await f.deleteSelectedEntity();
  assert.deepEqual(f.state.actions, []);
  assert.equal(f.state.toasts[0].message, 'Verify your assisted backup before deleting');
});

test('ManageWallets permits local BTC Delete with assisted consent off', async () => {
  const f = screenFixture('WALLET');
  f.state.consent = false;
  f.state.verified = false;
  await f.deleteSelectedEntity();
  assert.deepEqual(f.state.actions.map(action => action.type), ['DELETE_BTC']);
});

test('ManageWallets refuses a BTC success toast while the Realm wallet still exists', async () => {
  const f = screenFixture('WALLET');
  await f.deleteSelectedEntity();
  f.state.actions[0].onComplete(true);
  assert.equal(f.state.toasts[0].message, 'Failed to delete wallet');

  const removed = screenFixture('WALLET');
  await removed.deleteSelectedEntity();
  removed.state.present = false;
  removed.state.actions[0].onComplete(true);
  assert.equal(removed.state.toasts[0].message, 'Wallet deleted');
});

test('ManageWallets does not show an old account delete result after account switch', async () => {
  const f = screenFixture('WALLET');
  await f.deleteSelectedEntity();
  f.state.active = 'B';
  f.state.session = 2;
  f.state.actions[0].onComplete(false);
  assert.deepEqual(f.state.toasts, []);
});

test('ManageWallets does not report USDT deletion success while Realm retains it', async () => {
  const f = screenFixture('USDT_WALLET', true);
  await f.deleteSelectedEntity();
  assert.equal(f.state.toasts[0].message, 'Failed to delete USDT wallet');
});

test('ManageWallets waits for the matching vault delete before reporting success', async () => {
  const f = screenFixture('VAULT');
  await f.deleteSelectedEntity();
  assert.deepEqual(f.state.toasts, []);
  assert.deepEqual(f.state.actions.map((action) => action.type), ['DELETE_VAULT']);
  f.state.present = false;
  f.state.actions[0].onComplete(true);
  assert.equal(f.state.toasts[0].message, 'Vault deleted');
});

test('overlapping vault deletes and unrelated vault results cannot consume another request', async () => {
  const f = screenFixture('VAULT');
  f.scope.selectedWallet = { id: 'first', entityKind: 'VAULT' };
  await f.deleteSelectedEntity();
  f.scope.selectedWallet = { id: 'second', entityKind: 'VAULT' };
  await f.deleteSelectedEntity();
  assert.deepEqual(f.state.actions.map((action) => action.id), ['first', 'second']);

  // Another vault action may publish its own global Redux success while both
  // delete requests are in flight; only each request's callback can show a toast.
  f.state.actions.push({ type: 'UNRELATED_VAULT_SUCCESS' });
  assert.deepEqual(f.state.toasts, []);
  f.state.presentById.set('second', false);
  f.state.actions[1].onComplete(true);
  assert.deepEqual(f.state.toasts.map((toast) => toast.message), ['Vault deleted']);
  f.state.actions[0].onComplete(false);
  assert.deepEqual(f.state.toasts.map((toast) => toast.message),
    ['Vault deleted', 'Failed to delete vault']);
});

test('a vault delete from an earlier account session shows no toast', async () => {
  const f = screenFixture('VAULT');
  await f.deleteSelectedEntity();
  f.state.session += 2;
  f.state.actions[0].onComplete(false);
  assert.deepEqual(f.state.toasts, []);
});
