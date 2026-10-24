// Actual label/spendability producers, native Realm, real AES and the paired
// Relay's production HTTP transaction routes. Missing prerequisites fail.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { createRealmClient, declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const fixtureModule = process.env.KEEPER_RELAY_FIXTURE_MODULE;
assert.ok(fixtureModule, 'Set KEEPER_RELAY_FIXTURE_MODULE to Relay tests/support/automaticBackupHttpFixture.cjs');
const { createFixture } = require(fixtureModule);
let server;
before(async () => { server = await createFixture(); });
after(async () => { await server?.close(); Realm.shutdown(); });

const label = (ref, name) => ({ id: `${ref}${name}`, ref, label: name, type: 'TXN', origin: 'disposable-public-origin', isSystem: false });
const writes = () => server.trace.filter(event => event.path === '/revisionedBackupMutation');

async function setup(t, initialTags = []) {
  await server.reset();
  const f = await createRealmClient(server.url);
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  const wallet = f.defaults(f.RealmSchema.Wallet, {
    id: 'producer-wallet', entityKind: f.enums.EntityKind.WALLET, type: f.enums.WalletType.DEFAULT,
    networkType: f.enums.NetworkType.TESTNET, scriptType: 'P2WPKH',
    derivationDetails: f.defaults(f.RealmSchema.WalletDerivationDetails, { instanceNum: 0, xDerivationPath: "m/84'/1'/0'" }),
    presentationData: f.defaults(f.RealmSchema.WalletPresentationData, { name: 'Producer fixture', visibility: 'DEFAULT' }),
    specs: f.defaults(f.RealmSchema.WalletSpecs, {
      xpub: 'disposable-public-wallet-xpub', nextFreeAddressIndex: 1,
      addresses: { external: {}, internal: { 0: 'change-address' } },
      confirmedUTXOs: [f.defaults(f.RealmSchema.UTXO, {
        txId: 'input', vout: 0, spendability: 'spendable', isManualOverride: false,
      })],
    }),
  });
  assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet), true);
  for (const tag of initialTags) assert.equal(f.dbManager.createObject(f.RealmSchema.Tags, tag), true);
  await server.seed(await f.payloadForCurrentImage());
  assert.equal(await f.repair.inspectBackup(f.appId, false, () => {}), 'verified');
  server.clearTrace();
  const utxos = f.load('src/store/reducers/utxos');
  const sagas = f.productionSagas([
    'currentBackupAppId', 'setServerBackupFailed',
    'buildAutomaticAppMutation', 'buildAutomaticVaultMutation', 'queueCommittedBackupWorker',
    'updateAppImageWorker', 'updateVaultImageWorker',
  ], {
    ...f.automatic, ...utxos,
    // The fixture's synthetic public xpub is intentionally non-spendable.
    // Descriptor formatting supplies public label metadata, not write proof.
    generateAbbreviatedOutputDescriptors: () => 'disposable-public-origin',
  });
  evaluate(declarations('src/store/sagas/utxos.ts', [
    'currentOriginApp', 'originUiAction', 'persistTagsForOrigin', 'persistSpendabilityForOrigin',
    'backupCommittedLabels', 'addLabelsWorker', 'bulkUpdateLabelsWorker', 'importLabelsWorker',
    'transactionLabelsWorker', 'markUTXOSpendabilityWorker',
  ]), sagas.scope, 'production-label-producers.ts');
  f.run = (name, payload, metadata = {}) => sagas.run(name, {
    payload, originAppId: f.appId,
    originBackupAccountSession: f.transport.currentBackupAccountSession(),
    originBackupWriteIntent: f.transport.captureBackupWriteIntent(f.appId),
    ...metadata,
  });
  f.wallet = () => plain(f.dbManager.getObjectById(f.RealmSchema.Wallet, wallet.id));
  f.remoteImage = async () => f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    await server.snapshot(f.appId), f.appId, () => {}, true);
  return f;
}

test('native add/import/edit label producers each use one committed HTTP mutation and final readback', async t => {
  const f = await setup(t);
  await f.run('addLabelsWorker', {
    txId: 'first', wallet: f.wallet(), labels: [{ name: 'original', isSystem: false }], type: 'TXN',
  });
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].operation, 'modifyLabels');
  assert.equal(writes()[0].committed, true);
  assert.equal((await f.remoteImage()).labels.firstoriginal.label, 'original');
  server.clearTrace();
  await f.run('importLabelsWorker', { labels: [
    { type: 'tx', ref: 'second', label: 'import one', origin: 'disposable-public-origin' },
    { type: 'tx', ref: 'third', label: 'import two', origin: 'disposable-public-origin' },
  ] });
  assert.equal(writes().length, 1);
  assert.equal(Object.keys((await f.remoteImage()).labels).length, 3);
  server.clearTrace();
  await f.run('bulkUpdateLabelsWorker', {
    txId: 'first', wallet: f.wallet(),
    labelChanges: { added: [{ name: 'edited', isSystem: false }], deleted: [{ name: 'original', isSystem: false }] },
  });
  assert.equal(writes().length, 1);
  const image = await f.remoteImage();
  assert.equal(image.labels.firstoriginal, undefined);
  assert.equal(image.labels.firstedited.label, 'edited');
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
});

test('native send labels group the transaction note and all change labels into one HTTP mutation', async t => {
  const f = await setup(t, [label('input:0', 'inherited')]);
  await f.run('transactionLabelsWorker', {
    txId: 'sent', wallet: f.wallet(), note: 'send note',
    finalOutputs: [{ address: 'recipient-address' }, { address: 'change-address' }], inputs: [{ txId: 'input', vout: 0 }],
  });
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].committed, true);
  const image = await f.remoteImage();
  for (const id of ['sentsend note', 'sent:1Change', 'sent:1inherited'])
    assert.deepEqual(plain(image.labels[id]), plain(f.dbManager.getObjectById(f.RealmSchema.Tags, id)));
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
});

test('native invalid second imported tag rolls back the first and generates no HTTP writes', async t => {
  const f = await setup(t);
  await f.run('importLabelsWorker', { labels: [
    { type: 'tx', ref: 'first', label: 'must roll back', origin: 'disposable-public-origin' },
    { type: 'tx', ref: 'second', label: null, origin: 'disposable-public-origin' },
  ] });
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Tags).length, 0);
  assert.equal(writes().length, 0);
  assert.equal(Object.keys((await f.remoteImage()).labels).length, 0);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
});

test('native manual coin choice is committed before the encrypted wallet reaches HTTP', async t => {
  const f = await setup(t);
  await f.run('markUTXOSpendabilityWorker', {
    wallet: f.wallet(), txId: 'input', vout: 0, spendability: 'doNotSpend',
  });
  assert.equal(f.wallet().specs.confirmedUTXOs[0].spendability, 'doNotSpend');
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].operation, 'updateAppImage');
  assert.equal(writes()[0].committed, true);
  const image = await f.remoteImage();
  assert.equal(image.wallets['producer-wallet'].specs.confirmedUTXOs[0].spendability, 'doNotSpend');
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
});

for (const mode of ['409', '404', 'malformed', 'lost-reply'])
  test(`native combined send labels survive ${mode} and keep backup pending after one request`, async t => {
    const f = await setup(t);
    server.armFault({ mode, operation: 'modifyLabels' });
    await f.run('transactionLabelsWorker', {
      txId: 'sent', wallet: f.wallet(), note: 'send note',
      finalOutputs: [{ address: 'change-address' }], inputs: [],
    });
    assert.equal(writes().length, 1);
    for (const id of ['sentsend note', 'sent:0Change'])
      assert.ok(f.dbManager.getObjectById(f.RealmSchema.Tags, id));
    assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
    assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
  });

test('native old-session transaction labels cannot commit after A to B to A', async t => {
  const f = await setup(t);
  const old = {
    originBackupAccountSession: f.transport.currentBackupAccountSession(),
    originBackupWriteIntent: f.transport.captureBackupWriteIntent(f.appId),
  };
  const originalWallet = f.wallet();
  await f.selectAccount('disposable-other-account');
  await f.selectAccount(f.appId);
  await f.run('transactionLabelsWorker', { txId: 'sent', wallet: originalWallet, note: 'old session' }, old);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Tags).length, 0);
  assert.equal(writes().length, 0);
});
