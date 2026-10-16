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
    ['isOriginCurrent', 'createWallet', 'deleteWallet', 'updateWallet', 'syncAccountStatus'].includes(node.name.getText(source)))
    declarations.set(node.name.getText(source), node);
  ts.forEachChild(node, find);
}
find(source);
for (const name of ['isOriginCurrent', 'createWallet', 'deleteWallet', 'updateWallet', 'syncAccountStatus'])
  assert.ok(declarations.has(name), `production USDT ${name} callback must exist`);
const code = ts.transpileModule(
  [...declarations.values()].map((declaration) => `const ${declaration.getText(source)};`).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture({ consent = true, creationPaused = true, switchDuringRemote = false,
  switchDuringRemoteRoundTrip = false,
  switchDuringGeneration = false, switchDuringGenerationRoundTrip = false,
  switchDuringUpdate = false,
  switchDuringUpdateRoundTrip = false, switchDuringAccountSyncRoundTrip = false,
  pretendLocalDelete = false } = {}) {
  const state = { active: 'A', session: 1, remote: [], local: [], errors: [], dispatched: [], invalidated: [] };
  const scope = {
    appId: 'A',
    renderAccountSession: 1,
    useCallback: (callback) => callback,
    RealmSchema: { KeeperApp: 'KeeperApp', USDTWallet: 'USDTWallet' },
    dbManager: {
      getObjectByIndex: (schema) => schema === 'KeeperApp' ? { id: state.active } : [],
      getObjectById: (_schema, walletId) =>
        state.local.some((operation) => operation.walletId === walletId) && !pretendLocalDelete
          ? undefined
          : { id: 'wallet', name: 'old' },
      createObject: async (_schema, wallet) => {
        state.local.push({ appId: state.active, wallet });
        return true;
      },
      updateObjectById: async (_schema, _id, update) => {
        state.local.push({ appId: state.active, update });
        if (switchDuringUpdate) state.active = 'B';
        if (switchDuringUpdateRoundTrip) {
          state.active = 'B';
          state.session += 1;
          state.active = 'A';
          state.session += 1;
        }
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
      if (switchDuringGenerationRoundTrip) {
        state.active = 'B';
        state.session += 1;
        state.active = 'A';
        state.session += 1;
      }
      return { id: 'wallet', name: 'new' };
    },
    updateUSDTWalletAccountStatus: async () => {
      if (switchDuringAccountSyncRoundTrip) {
        state.active = 'B';
        state.session += 1;
        state.active = 'A';
        state.session += 1;
      }
      return { nextNonce: 1 };
    },
    canonical: JSON.stringify,
    recoveryContent: (_kind, wallet) => wallet,
    updateAppImage: (payload, originAppId) => ({ type: 'UPDATE_APP_IMAGE', payload, originAppId }),
    invalidateBackupRepair: (appId) => ({ type: 'INVALIDATE_BACKUP_REPAIR', appId }),
    setPendingAllBackup: (payload) => ({ type: 'SET_PENDING_ALL_BACKUP', payload }),
    markBackupMutation: (appId) => state.invalidated.push(appId),
    currentBackupAccountSession: () => state.session,
    captureBackupWriteIntent: (appId) => ({
      appId, accountSession: state.session, baseRevision: 'a'.repeat(64), baselineEpoch: 0,
    }),
    dispatch: (action) => state.dispatched.push(action),
    Relay: { deleteAppImageEntity: async (body, intent) => {
      state.remote.push({ ...body, accountSession: intent?.accountSession, intent });
      if (switchDuringRemote || switchDuringRemoteRoundTrip) {
        state.active = 'B';
        state.session += 1;
      }
      if (switchDuringRemoteRoundTrip) {
        state.active = 'A';
        state.session += 1;
      }
      return { updated: true };
    } },
    setError: (error) => state.errors.push(error),
    captureError: () => {},
  };
  // Unit-only disposable transaction adapter. The native Realm/HTTP suite
  // separately verifies the production commit receipt and transport proof.
  const rows = { wallet: { id: 'wallet', name: 'old' } };
  scope.beginBackupLocalOperation = (appId, intent, session) => ({ appId, intent, session });
  scope.commitBackupLocalOperation = (operation, write) => {
    if (state.active !== operation.appId || state.session !== operation.session) return { committed: false };
    const savedRows = JSON.parse(JSON.stringify(rows));
    const savedLog = state.local.length;
    try {
      write({
        objectForPrimaryKey: (_schema, id) => rows[id] && new Proxy(rows[id], {
          set(target, key, value) {
            state.local.push({ appId: state.active, update: { [key]: value } });
            target[key] = value;
            if (switchDuringUpdate) state.active = 'B';
            if (switchDuringUpdateRoundTrip) {
              state.active = 'B'; state.session += 1;
              state.active = 'A'; state.session += 1;
            }
            return true;
          },
        }),
        create: (_schema, wallet) => {
          rows[wallet.id] = { ...wallet };
          state.local.push({ appId: state.active, wallet });
        },
        delete: (row) => {
          if (pretendLocalDelete) throw Error('Injected transaction failure');
          delete rows[row.id];
          state.local.push({ appId: state.active, walletId: row.id });
        },
      });
      // Model the production commit observer at the producer boundary, before
      // any cloud wait. Keep stale completion UI out of a newer account session.
      state.invalidated.push(operation.appId);
      if (state.active === operation.appId && state.session === operation.session)
        scope.dispatch(scope.setPendingAllBackup({ appId: operation.appId, pending: true }));
      return { committed: true, intent: { ...operation.intent, accountSession: operation.session } };
    } catch {
      Object.keys(rows).forEach((id) => delete rows[id]); Object.assign(rows, savedRows);
      state.local.splice(savedLog);
      state.invalidated.push(operation.appId);
      scope.dispatch(scope.setPendingAllBackup({ appId: operation.appId, pending: true }));
      return { committed: false };
    }
  };
  scope.enqueueAutomaticBackupOperation = async (receipt, mutations) => {
    if (!receipt.committed || receipt.intent?.accountSession !== state.session || state.active !== receipt.intent.appId)
      return { updated: false, backupPending: true, backupConfirmed: false };
    const result = await scope.Relay.deleteAppImageEntity(mutations[0].body, receipt.intent);
    const current = receipt.intent.accountSession === state.session && state.active === receipt.intent.appId;
    return { ...result, backupConfirmed: current, backupPending: !current };
  };
  vm.runInNewContext(`${code}\nglobalThis.callbacks = { createWallet, deleteWallet, updateWallet, syncAccountStatus };`, scope);
  return { state, ...scope.callbacks };
}

test('unconsented USDT wallet deletes locally without a relay write', async () => {
  const f = fixture({ consent: false });
  assert.equal(await f.deleteWallet('wallet'), true);
  assert.deepEqual(f.state.remote, []);
  assert.equal(f.state.local[0].appId, 'A');
});

test('USDT delete rolls back a local transaction failure before any cloud request', async () => {
  const f = fixture({ pretendLocalDelete: true });
  assert.equal(await f.deleteWallet('wallet'), false);
  assert.equal(f.state.remote.length, 0);
  assert.equal(f.state.local.length, 0);
  assert.deepEqual(f.state.invalidated, ['A']);
  assert.ok(f.state.dispatched.some((action) => action.type === 'SET_PENDING_ALL_BACKUP'));
});

test('cloud response after account switch preserves the completed A deletion and never deletes B', async () => {
  const f = fixture({ switchDuringRemote: true });
  assert.equal(await f.deleteWallet('wallet'), true);
  assert.equal(f.state.remote.length, 1);
  assert.equal(f.state.remote[0].appId, 'A');
  assert.equal(f.state.remote[0].accountSession, 1);
  assert.equal(f.state.local.length, 1);
  assert.equal(f.state.local[0].appId, 'A');
  assert.equal(f.state.dispatched.find((action) => action.type === 'SET_PENDING_ALL_BACKUP').payload.appId, 'A');
});

test('cloud response after A to B to A keeps the original committed deletion pending', async () => {
  const f = fixture({ switchDuringRemoteRoundTrip: true });
  assert.equal(await f.deleteWallet('wallet'), true);
  assert.equal(f.state.active, 'A');
  assert.equal(f.state.session, 3);
  assert.equal(f.state.remote.length, 1);
  assert.equal(f.state.remote[0].appId, 'A');
  assert.equal(f.state.remote[0].accountSession, 1);
  assert.equal(f.state.local.length, 1);
  assert.equal(f.state.local[0].appId, 'A');
  assert.equal(f.state.dispatched.find((action) => action.type === 'SET_PENDING_ALL_BACKUP').payload.appId, 'A');
});

test('a stale A callback invoked while B is active makes no write', async () => {
  const f = fixture();
  f.state.active = 'B';
  assert.equal(await f.deleteWallet('wallet'), false);
  assert.deepEqual(f.state.remote, []);
  assert.deepEqual(f.state.local, []);
});

test('a delete callback rendered in the first A session cannot delete after A to B to A', async () => {
  const f = fixture();
  f.state.active = 'B';
  f.state.session += 1;
  f.state.active = 'A';
  f.state.session += 1;
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

test('when setup resumes, wallet generation after A to B to A cannot persist to the later A', async () => {
  const f = fixture({ creationPaused: false, switchDuringGenerationRoundTrip: true });
  const result = await f.createWallet({ type: 'default', name: 'new', description: '' });
  assert.equal(result.error, 'Account changed');
  assert.equal(f.state.session, 3);
  assert.deepEqual(f.state.local, []);
  assert.deepEqual(f.state.dispatched, []);
});

test('when setup resumes, a stale create callback cannot act after A to B to A', async () => {
  const f = fixture({ creationPaused: false });
  f.state.active = 'B';
  f.state.session += 1;
  f.state.active = 'A';
  f.state.session += 1;
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
  assert.equal(f.state.dispatched.find((action) => action.type === 'UPDATE_APP_IMAGE').originAppId, 'A');
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

test('a callback rendered in the first A session cannot update after A to B to A', async () => {
  const f = fixture();
  f.state.active = 'B';
  f.state.session += 1;
  f.state.active = 'A';
  f.state.session += 1;
  assert.equal(await f.updateWallet({ id: 'wallet', name: 'stale' }), false);
  assert.deepEqual(f.state.local, []);
  assert.deepEqual(f.state.dispatched, []);
});

test('A to B to A during wallet persistence cannot report success or dispatch backup', async () => {
  const f = fixture({ switchDuringUpdateRoundTrip: true });
  assert.equal(await f.updateWallet({ id: 'wallet', name: 'new' }), false);
  assert.equal(f.state.local[0].appId, 'A');
  assert.equal(f.state.dispatched.some((action) => action.type === 'UPDATE_APP_IMAGE'), false);
  assert.deepEqual(f.state.invalidated, ['A']);
});

test('a delayed account sync from the first A session cannot update the second A session', async () => {
  const f = fixture({ switchDuringAccountSyncRoundTrip: true });
  await assert.rejects(f.syncAccountStatus({ id: 'wallet', name: 'old' }), /Failed to sync account status/);
  assert.deepEqual(f.state.local, []);
  assert.deepEqual(f.state.dispatched, []);
});
