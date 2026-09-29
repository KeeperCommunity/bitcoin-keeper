const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { fixture, enums, encryption, loadModule } = require('./sagaHarness.cjs');
const { image } = require('./helpers.cjs');
const { updateAppImage } = loadModule('src/store/sagaActions/bhr.ts');
const copy = (value) => JSON.parse(JSON.stringify(value));

// Run the production hook callback without React/Realm native bindings, then
// drive its dispatched action through the production saga and real AES codec.
function hookFixture(options = {}) {
  const f = fixture(options);
  const source = ts.createSourceFile('useUSDTWallets.ts', fs.readFileSync(
    path.join(__dirname, '../../src/hooks/useUSDTWallets.ts'), 'utf8'),
  ts.ScriptTarget.Latest, true);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'updateWallet')
      callback = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, 'Production updateWallet callback exists');
  const pending = [], order = [], errors = [], mutations = [];
  const dbManager = {
    getObjectById: (_schema, id) => {
      const stored = f.collections.USDTWallet.find((wallet) => wallet.id === id);
      return stored && { toJSON: () => copy(stored) };
    },
    updateObjectById: async (_schema, id, patch) => {
      assert.equal('id' in patch, false, 'Realm primary key must not be updated');
      order.push('persist');
      if (options.failPersistence) return false;
      const stored = f.collections.USDTWallet.find((wallet) => wallet.id === id);
      Object.assign(stored, copy(patch));
      return true;
    },
  };
  const updateWallet = vm.runInNewContext(ts.transpileModule(`(${callback})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    dbManager,
    RealmSchema: { USDTWallet: 'USDTWallet' },
    canonical: image.canonical,
    recoveryContent: image.recoveryContent,
    appId: f.app.id,
    markBackupMutation: (id) => mutations.push(id),
    invalidateBackupRepair: (payload) => ({ type: 'invalidateBackupRepair', payload }),
    setPendingAllBackup: (payload) => ({ type: 'setPendingAllBackup', payload }),
    updateAppImage,
    dispatch(action) {
      if (action.type === 'UPDATE_APP_IMAGE') {
        order.push('backup');
        assert.deepEqual(copy(f.collections.USDTWallet[0]), copy(action.payload.wallets[0]),
          'Backup must contain the successfully persisted wallet');
        pending.push(f.run('updateAppImageWorker', action));
      } else {
        f.actions.push(action);
        if (action.type === 'setPendingAllBackup') f.state.bhr.pendingAllBackup = action.payload;
      }
    },
    setError: (message) => errors.push(message),
    captureError: () => {},
  });
  return { ...f, order, errors, mutations,
    update: async (wallet) => {
      const result = await updateWallet(wallet);
      await Promise.all(pending);
      return result;
    },
  };
}

const usdtWallet = (type = 'DEFAULT') => ({
  id: `usdt-${type}`,
  entityKind: enums.EntityKind.USDT_WALLET,
  type,
  networkType: enums.NetworkType.TESTNET,
  derivationDetails: {
    instanceNum: type === 'DEFAULT' ? 1 : null,
    mnemonic: 'disposable fixture mnemonic; not a usable wallet',
    xDerivationPath: "m/44'/195'/0'/0/0",
  },
  presentationData: { name: 'Before edit', description: 'Before', visibility: 'DEFAULT' },
  specs: { address: 'disposable-tron-address', privateKey: 'fixture-only-private-key',
    balance: 10, transactions: [], hasNewUpdates: false, lastSynched: 1 },
  accountStatus: { isActive: true, nextNonce: 0 },
  createdAt: 1,
});

for (const type of ['DEFAULT', 'IMPORTED']) {
  test(`USDT ${type} metadata and hidden state survive encrypted backup and restore`, async () => {
    const f = hookFixture();
    const original = usdtWallet(type);
    f.collections.USDTWallet.push(copy(original));
    await f.run('updateAppImageWorker', { payload: { wallets: [original] } });
    const edited = { ...original,
      presentationData: { name: 'After edit', description: 'Updated description', visibility: 'HIDDEN' } };
    assert.equal(await f.update(edited), true);
    assert.deepEqual(f.order, ['persist', 'backup']);
    const key = encryption.generateEncryptionKey(f.app.primarySeed);
    const cipher = f.remote.wallets[original.id];
    assert.ok(!cipher.includes(edited.specs.privateKey));
    assert.deepEqual(JSON.parse(encryption.decrypt(key, cipher)), edited);
    f.collections.USDTWallet = [];
    await f.run('recoverApp', 'mock mnemonic', Buffer.from('fixture'), key,
      f.app.id, f.app.subscription, f.remote, [], [], '2.5.16');
    assert.deepEqual(copy(f.collections.USDTWallet), [edited]);
  });
}

for (const failure of [{ online: false }, { incrementalError: true }, { rejectIncremental: true }]) {
  test(`USDT edit remains local and retryable when backup fails: ${JSON.stringify(failure)}`, async () => {
    const f = hookFixture(failure);
    const original = usdtWallet();
    f.collections.USDTWallet.push(copy(original));
    const edited = { ...original, presentationData: { ...original.presentationData, name: 'Changed' } };
    assert.equal(await f.update(edited), true, 'A remote failure must not discard the saved edit');
    assert.deepEqual(copy(f.collections.USDTWallet), [edited]);
    assert.equal(f.state.bhr.pendingAllBackup, true);
    assert.ok(f.actions.some((a) => a.type === 'invalidateBackupRepair' && a.payload === f.app.id));
    assert.equal(f.remote.wallets[edited.id], undefined);
    assert.ok(!f.actions.some((a) => a.type === 'setBackupAllSuccess' && a.payload));
  });
}

test('failed USDT persistence cannot report success or upload an unsaved edit', async () => {
  const f = hookFixture({ failPersistence: true });
  const original = usdtWallet();
  f.collections.USDTWallet.push(copy(original));
  const edited = { ...original, presentationData: { ...original.presentationData, name: 'Not saved' } };
  assert.equal(await f.update(edited), false);
  assert.deepEqual(f.order, ['persist']);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(copy(f.collections.USDTWallet), [original]);
  assert.equal(f.state.bhr.pendingAllBackup, true, 'Partial-write uncertainty requires inspection');
  assert.deepEqual(f.mutations, [f.app.id]);
  assert.ok(f.actions.some((a) => a.type === 'invalidateBackupRepair' && a.payload === f.app.id));
  assert.deepEqual(f.errors, ['Failed to update wallet']);
});

test('USDT balance, transaction and account sync avoids redundant backup uploads', async () => {
  const f = hookFixture();
  const original = usdtWallet();
  f.collections.USDTWallet.push(copy(original));
  const synced = { ...original,
    specs: { ...original.specs, balance: 12, transactions: [{ txId: 'fixture-tx' }],
      hasNewUpdates: true, lastSynched: 2 },
    accountStatus: { isActive: true, nextNonce: 1 },
  };
  assert.equal(await f.update(synced), true);
  assert.deepEqual(copy(f.collections.USDTWallet), [synced]);
  assert.deepEqual(f.order, ['persist']);
  assert.equal(f.calls.length, 0);
  assert.equal(f.actions.length, 0);
});

test('USDT metadata edits respect disabled Assisted Server Backup', async () => {
  const f = hookFixture({ bhr: { automaticCloudBackup: false } });
  const original = usdtWallet();
  f.collections.USDTWallet.push(copy(original));
  const edited = { ...original, presentationData: { ...original.presentationData, visibility: 'HIDDEN' } };
  assert.equal(await f.update(edited), true);
  assert.deepEqual(copy(f.collections.USDTWallet), [edited]);
  assert.equal(f.calls.length, 0);
});
