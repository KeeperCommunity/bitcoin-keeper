// Real existing-wallet USDT hook callbacks through native Realm, production
// backup sagas, actual AES and paired Relay HTTP. Creation stays paused; this
// fixture never contacts a token chain or derives a new USDT wallet.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test, before, after } = require('node:test');
const { createRealmClient, declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
assert.ok(process.env.KEEPER_RELAY_FIXTURE_MODULE, 'The pinned paired Relay fixture is required');
const { createFixture } = require(process.env.KEEPER_RELAY_FIXTURE_MODULE);
let server;
before(async () => { server = await createFixture(); });
after(async () => { await server?.close(); Realm.shutdown(); });
const writes = () => server.trace.filter(event => event.path === '/revisionedBackupMutation');

function usdt(f, type = 'DEFAULT', id = `usdt-${type}`) {
  return f.defaults(f.RealmSchema.USDTWallet, {
    id, type, entityKind: f.enums.EntityKind.USDT_WALLET, networkType: f.enums.NetworkType.TESTNET,
    derivationDetails: f.defaults(f.RealmSchema.USDTWalletDerivationDetails, {
      instanceNum: type === 'DEFAULT' ? 1 : null, mnemonic: 'public disposable fixture only', xDerivationPath: "m/44'/195'/0'/0/0",
    }),
    presentationData: f.defaults(f.RealmSchema.USDTWalletPresentationData, { name: 'Existing wallet', description: 'Before', visibility: 'DEFAULT' }),
    specs: f.defaults(f.RealmSchema.USDTWalletSpecs, { address: 'disposable-token-address', privateKey: 'unspendable-fixture-private-material', balance: 10 }),
  });
}

function selectedCallbacks() {
  const file = 'src/hooks/useUSDTWallets.ts';
  const source = ts.createSourceFile(file, fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'), ts.ScriptTarget.Latest, true);
  const needed = new Set(['isOriginCurrent', 'createWallet', 'updateWallet', 'deleteWallet']);
  const found = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && needed.has(node.name.getText(source)))
      found.push(`const ${node.getText(source)};`);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(found.length, needed.size, 'All selected production hook callbacks must exist');
  return declarations(file, ['USDT_WALLET_CREATION_PAUSED']) + '\n' + found.join('\n');
}

async function setup(t, type = 'DEFAULT') {
  await server.reset();
  const f = await createRealmClient(server.url);
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  assert.equal(f.dbManager.createObject(f.RealmSchema.USDTWallet, usdt(f, type)), true);
  assert.equal(f.dbManager.createObject(f.RealmSchema.USDTWallet, usdt(f, 'IMPORTED', 'retained-usdt')), true);
  await server.seed(await f.payloadForCurrentImage());
  assert.equal(await f.repair.inspectBackup(f.appId, false, () => {}), 'verified');
  server.clearTrace();
  const sagas = f.productionSagas(['currentBackupAppId', 'buildAutomaticAppMutation', 'queueCommittedBackupWorker', 'updateAppImageWorker']);
  const pending = [];
  const errors = [];
  const scope = {
    ...f.encryption, ...f.image, ...f.transport, ...f.automatic, ...f.bhr,
    ...f.load('src/store/sagaActions/bhr'), RealmSchema: f.RealmSchema, dbManager: f.dbManager,
    appId: f.appId, renderAccountSession: f.transport.currentBackupAccountSession(), reduxStore: f.store,
    // Execute the selected callback closure without claiming a React render.
    // Realm, Redux, encryption, commit receipts and HTTP remain production.
    useCallback: callback => callback,
    dispatch(action) {
      f.store.dispatch(action);
      if (action.type === 'UPDATE_APP_IMAGE') pending.push(sagas.run('updateAppImageWorker', action));
    },
    setError: message => errors.push(message),
    captureError: error => errors.push(error.message),
    generateUSDTWallet: () => { throw new Error('Paused wallet generation must not run'); },
  };
  evaluate(selectedCallbacks() + '\nglobalThis.callbacks = {createWallet, updateWallet, deleteWallet};', scope, 'production-existing-usdt-hooks.ts');
  f.callbacks = scope.callbacks;
  f.update = async model => {
    const result = await f.callbacks.updateWallet(model);
    await Promise.all(pending.splice(0));
    return result;
  };
  f.wallet = () => plain(f.dbManager.getObjectById(f.RealmSchema.USDTWallet, `usdt-${type}`));
  f.remoteImage = async () => f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    await server.snapshot(f.appId), f.appId, () => {}, true);
  return f;
}

for (const type of ['DEFAULT', 'IMPORTED']) {
  test(`actual existing ${type} USDT metadata edit commits before HTTP and verifies hidden recovery state`, async t => {
    const f = await setup(t, type);
    const edited = f.wallet();
    edited.presentationData = { name: 'Saved edit', description: 'Recoverable description', visibility: 'HIDDEN' };
    server.armFault({ beforeMutation() {
      assert.equal(f.wallet().presentationData.name, 'Saved edit');
      assert.equal(f.wallet().presentationData.visibility, 'HIDDEN');
    } });
    assert.equal(await f.update(edited), true);
    assert.equal(writes().length, 1);
    assert.equal(writes()[0].committed, true);
    assert.deepEqual(plain((await f.remoteImage()).wallets[edited.id].presentationData), edited.presentationData);
    assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
  });

  test(`actual existing ${type} USDT deletion commits before HTTP and preserves another wallet`, async t => {
    const f = await setup(t, type);
    const id = f.wallet().id;
    server.armFault({ beforeMutation() {
      assert.equal(f.dbManager.getObjectById(f.RealmSchema.USDTWallet, id), undefined);
      assert.ok(f.dbManager.getObjectById(f.RealmSchema.USDTWallet, 'retained-usdt'));
    } });
    assert.equal(await f.callbacks.deleteWallet(id), true);
    assert.equal(writes().length, 1);
    assert.equal(writes()[0].committed, true);
    const image = await f.remoteImage();
    assert.equal(image.wallets[id], undefined);
    assert.ok(image.wallets['retained-usdt']);
    assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
  });
}

test('actual USDT hook creation and import stay paused before generation, native writes or HTTP', async t => {
  const f = await setup(t);
  const before = f.dbManager.getCollection(f.RealmSchema.USDTWallet).length;
  for (const type of ['DEFAULT', 'IMPORTED']) {
    const result = await f.callbacks.createWallet({ type, name: 'Paused', description: '' });
    assert.equal(result.error, 'USDT wallet setup is paused');
  }
  assert.equal(f.dbManager.getCollection(f.RealmSchema.USDTWallet).length, before);
  assert.equal(server.trace.length, 0);
});

for (const mode of ['409', 'malformed', 'lost-reply']) test(`actual USDT metadata survives ${mode} with pending backup`, async t => {
  const f = await setup(t);
  const edited = f.wallet();
  edited.presentationData.name = 'Saved despite cloud failure';
  server.armFault({ mode, operation: 'updateAppImage' });
  assert.equal(await f.update(edited), true);
  assert.equal(f.wallet().presentationData.name, 'Saved despite cloud failure');
  assert.equal(writes().length, 1);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
});

test('actual USDT deletion survives conflict after its local commit and remains pending', async t => {
  const f = await setup(t);
  const id = f.wallet().id;
  server.armFault({ mode: '409', operation: 'deleteAppImageEntity' });
  assert.equal(await f.callbacks.deleteWallet(id), true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.USDTWallet, id), undefined);
  assert.equal(writes().length, 1);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.ok((await f.remoteImage()).wallets[id]);
});

test('actual USDT cache refresh creates no redundant recovery HTTP writes', async t => {
  const f = await setup(t);
  const synced = f.wallet();
  synced.specs.balance = 12;
  synced.specs.lastSynched = 2;
  synced.accountStatus.nextNonce = 1;
  assert.equal(await f.update(synced), true);
  assert.equal(f.wallet().specs.balance, 12);
  assert.equal(server.trace.length, 0);
});

test('actual USDT rendered callbacks cannot edit or delete after A to B to A', async t => {
  const f = await setup(t);
  const edited = f.wallet();
  edited.presentationData.name = 'Old callback';
  await f.selectAccount('disposable-other-account');
  await f.selectAccount(f.appId);
  assert.equal(await f.update(edited), false);
  assert.equal(await f.callbacks.deleteWallet(edited.id), false);
  assert.equal(f.wallet().presentationData.name, 'Existing wallet');
  assert.equal(server.trace.length, 0);
});
