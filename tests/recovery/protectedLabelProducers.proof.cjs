// Additive signed-v3 port of all nine historical label/send/coin-choice cases.
// Real encrypted Realm, production workers/receipts and origin middleware,
// authority, HTTP and transactional Relay. No transaction is signed/broadcast.
// Historical v2 runner, its 295 cases/pins and failed results remain unchanged.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
let server;
beforeEach(async () => { server = await createProtectedServer(); });
afterEach(async () => { await server?.close(); server = undefined; });
after(() => Realm.shutdown());
const test = (name, body) => nodeTest(name, { timeout: 20_000 }, body);
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');
const label = (ref, name) => ({ id: `${ref}${name}`, ref, label: name, type: 'TXN',
  origin: 'disposable-public-origin', isSystem: false });

async function setup(t, initialTags = []) {
  await server.reset();
  const f = await createProtectedRealmClient(server.url, {
    appId, primarySeed: seed.toString('hex'), primaryMnemonic: mnemonic,
  });
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  const wallet = f.defaults(f.RealmSchema.Wallet, {
    id: 'producer-wallet', entityKind: f.enums.EntityKind.WALLET, type: f.enums.WalletType.DEFAULT,
    networkType: f.enums.NetworkType.TESTNET, scriptType: 'P2WPKH',
    derivationDetails: f.defaults(f.RealmSchema.WalletDerivationDetails, {
      instanceNum: 0, xDerivationPath: "m/84'/1'/0'",
    }),
    presentationData: f.defaults(f.RealmSchema.WalletPresentationData, {
      name: 'Producer fixture', visibility: 'DEFAULT',
    }),
    specs: f.defaults(f.RealmSchema.WalletSpecs, {
      xpub: 'intentionally-unspendable-public-fixture', nextFreeAddressIndex: 1,
      addresses: { external: {}, internal: { 0: 'change-address' } },
      confirmedUTXOs: [f.defaults(f.RealmSchema.UTXO, {
        txId: 'input', vout: 0, spendability: 'spendable', isManualOverride: false,
      })],
    }),
  });
  assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet), true);
  for (const tag of initialTags)
    assert.equal(f.dbManager.createObject(f.RealmSchema.Tags, tag), true);
  const utxos = f.load('src/store/reducers/utxos');
  const sagas = f.productionSagas([
    'currentBackupAppId', 'setServerBackupFailed', 'backupInspectionOwners', 'runBackupInspection',
    'buildAutomaticAppMutation', 'buildAutomaticVaultMutation', 'queueCommittedBackupWorker',
    'updateAppImageWorker', 'updateVaultImageWorker',
  ], {
    ...utxos,
    // Public descriptor formatting is the sole label metadata boundary stub.
    // The intentionally unspendable xpub grants no signing authority; this does
    // not replace local receipts, ciphertext, signature verification or replies.
    generateAbbreviatedOutputDescriptors: () => 'disposable-public-origin',
  });
  evaluate(declarations('src/store/sagas/utxos.ts', [
    'currentOriginApp', 'originUiAction', 'persistTagsForOrigin', 'persistSpendabilityForOrigin',
    'backupCommittedLabels', 'addLabelsWorker', 'bulkUpdateLabelsWorker', 'importLabelsWorker',
    'transactionLabelsWorker', 'markUTXOSpendabilityWorker',
  ]), sagas.scope, 'production-protected-label-producers.ts');
  // Exercise the actual send worker's delegation without any Bitcoin network
  // operations. The historical obligation is label persistence after a send,
  // not transaction construction, signing, broadcast or rendered native UI.
  evaluate(declarations('src/store/sagas/send_and_receive.ts', ['handleChangeOutputLabels']),
    sagas.scope, 'production-send-label-delegation.ts');
  assert.equal(await sagas.run('runBackupInspection', true, f.appId, true), true,
    'Explicit production opt-in must enroll, repair and verify the actual namespace');
  f.wallet = () => plain(f.dbManager.getObjectById(f.RealmSchema.Wallet, wallet.id));
  f.read = async () => {
    const result = await f.protected.readProtectedBackup(mnemonic, undefined, f.appId);
    assert.equal(result.state, 'present');
    return result.snapshot;
  };
  f.remoteImage = async () => {
    const remote = await f.read();
    return f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
      remote, remote.namespaceId, () => {}, true);
  };
  const actions = f.load('src/store/sagaActions/utxos');
  const creators = { addLabelsWorker: actions.addLabels,
    importLabelsWorker: actions.importLabels, bulkUpdateLabelsWorker: actions.bulkUpdateLabels,
    markUTXOSpendabilityWorker: actions.markUTXOSpendability };
  f.run = async (name, payload) => {
    const action = f.store.dispatch(creators[name](payload, f.appId));
    assert.equal(action.originAppId, f.appId);
    assert.equal(f.transport.isCapturedBackupWriteIntent(action.originBackupWriteIntent), true,
      'Actual origin middleware must retain the original runtime-branded receipt');
    f.lastAction = action;
    return sagas.run(name, action);
  };
  f.sendAction = payload => f.store.dispatch({ type: 'SEND_PHASE_THREE', payload });
  f.send = async (payload, original = f.sendAction(payload)) => {
    f.lastAction = original;
    return sagas.run('handleChangeOutputLabels', payload.finalOutputs || [], payload.inputs || [],
      payload.wallet, payload.txId, original.originAppId, original.originBackupAccountSession,
      original.originBackupWriteIntent, payload.note);
  };
  f.initial = await f.read();
  assert.ok(f.transport.captureBackupWriteIntent(f.appId)?.protectedBase);
  server.clearTrace();
  return f;
}

function assertOriginalTuple(event, intent) {
  assert.equal(event.namespaceId, intent.protectedBase.namespaceId);
  assert.equal(event.expectedRevision, intent.protectedBase.revision);
  assert.equal(event.expectedGeneration, intent.protectedBase.generation);
  assert.equal(event.authEpoch, intent.protectedBase.authEpoch);
}

async function assertConfirmed(f, operation) {
  const trace = [...server.trace];
  assert.equal(writes().length, 1, 'Each committed caller group submits one actual CAS');
  const event = writes()[0];
  assert.equal(event.operation, operation);
  assert.equal(event.committed, true);
  assert.equal(event.status, 200);
  assertOriginalTuple(event, f.lastAction.originBackupWriteIntent);
  assert.deepEqual(trace.map(event => event.path), [
    '/backup/v3/snapshot', '/backup/v3/mutate', '/backup/v3/snapshot',
  ], 'Baseline and final readback must be genuine signed HTTP reads');
  const final = await f.read();
  assert.equal(final.revision, event.serverRevision);
  assert.equal(final.generation, event.serverGeneration);
  assert.equal(final.authEpoch, event.serverAuthEpoch);
  const remote = await f.remoteImage();
  assert.equal(await f.image.compareImages(await f.repair.captureBackupImage(), remote), 'matched',
    'Compare the complete decrypted recovery image, not only the changed label');
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  const state = f.store.getState().bhr;
  assert.equal(state.pendingAllBackupByAppId[f.appId], false);
  assert.equal(state.backupRepairStateByAppId[f.appId], 'verified');
  assert.equal(state.backupRepairCompletedByAppId[f.appId], true);
  return remote;
}

function assertPending(f) {
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
}

test('add/import/edit callers each commit one signed-v3 mutation and complete decrypted readback', async t => {
  const f = await setup(t);
  await f.run('addLabelsWorker', {
    txId: 'first', wallet: f.wallet(), labels: [{ name: 'original', isSystem: false }], type: 'TXN',
  });
  assert.equal((await assertConfirmed(f, 'modifyLabels')).labels.firstoriginal.label, 'original');
  server.clearTrace();
  await f.run('importLabelsWorker', { labels: [
    { type: 'tx', ref: 'second', label: 'import one', origin: 'disposable-public-origin' },
    { type: 'tx', ref: 'third', label: 'import two', origin: 'disposable-public-origin' },
  ] });
  assert.equal(Object.keys((await assertConfirmed(f, 'modifyLabels')).labels).length, 3);
  server.clearTrace();
  await f.run('bulkUpdateLabelsWorker', {
    txId: 'first', wallet: f.wallet(),
    labelChanges: { added: [{ name: 'edited', isSystem: false }],
      deleted: [{ name: 'original', isSystem: false }] },
  });
  const image = await assertConfirmed(f, 'modifyLabels');
  assert.equal(image.labels.firstoriginal, undefined);
  assert.equal(image.labels.firstedited.label, 'edited');
  assert.equal(image.labels['secondimport one'].label, 'import one');
  assert.equal(image.labels['thirdimport two'].label, 'import two');
});

test('send delegation groups its note, Change and inherited labels into one signed-v3 CAS', async t => {
  const f = await setup(t, [label('input:0', 'inherited')]);
  await f.send({ txId: 'sent', wallet: f.wallet(), note: 'send note',
    finalOutputs: [{ address: 'recipient-address' }, { address: 'change-address' }],
    inputs: [{ txId: 'input', vout: 0 }] });
  const image = await assertConfirmed(f, 'modifyLabels');
  for (const id of ['sentsend note', 'sent:1Change', 'sent:1inherited'])
    assert.deepEqual(plain(image.labels[id]), plain(f.dbManager.getObjectById(f.RealmSchema.Tags, id)));
  assert.deepEqual(Object.keys(image.labels).sort(),
    ['input:0inherited', 'sent:1Change', 'sent:1inherited', 'sentsend note'].sort());
});

test('invalid second imported label rolls back the real first write and sends no HTTP', async t => {
  const f = await setup(t);
  const before = await f.repair.captureBackupImage();
  await f.run('importLabelsWorker', { labels: [
    { type: 'tx', ref: 'first', label: 'must roll back', origin: 'disposable-public-origin' },
    { type: 'tx', ref: 'second', label: null, origin: 'disposable-public-origin' },
  ] });
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Tags).length, 0);
  assert.equal(server.trace.length, 0, 'Failed atomic local import must not reach baseline or mutation HTTP');
  assert.equal(await f.image.compareImages(before, await f.repair.captureBackupImage()), 'matched');
  assertPending(f);
  assert.equal((await f.read()).revision, f.initial.revision);
  assert.equal(Object.keys((await f.remoteImage()).labels).length, 0);
});

test('manual coin choice persists in native Realm before encrypted signed-v3 wallet backup and survives reopen', async t => {
  const f = await setup(t);
  let committedBeforeHttp = false;
  server.armFault({ path: '/backup/v3/snapshot', beforeReply() {
    const choice = f.wallet().specs.confirmedUTXOs[0];
    committedBeforeHttp = choice.spendability === 'doNotSpend' && choice.isManualOverride === true &&
      f.nativeRealm().isInTransaction === false;
  } });
  await f.run('markUTXOSpendabilityWorker', {
    wallet: f.wallet(), txId: 'input', vout: 0, spendability: 'doNotSpend',
  });
  assert.equal(committedBeforeHttp, true);
  const image = await assertConfirmed(f, 'updateAppImage');
  assert.equal(image.wallets['producer-wallet'].specs.confirmedUTXOs[0].spendability, 'doNotSpend');
  assert.equal(image.wallets['producer-wallet'].specs.confirmedUTXOs[0].isManualOverride, true);
  f.realmDatabase.closeDatabase();
  await f.selectAccount(f.appId);
  assert.equal(f.wallet().specs.confirmedUTXOs[0].spendability, 'doNotSpend');
  assert.equal(f.wallet().specs.confirmedUTXOs[0].isManualOverride, true);
});

for (const mode of ['409', '404', 'malformed', 'lost-reply']) {
  test(`combined send labels remain local and pending after genuine ${mode}, without retry`, async t => {
    const f = await setup(t);
    const base = f.transport.captureBackupWriteIntent(f.appId).protectedBase;
    let namespaceLossWitness = false;
    if (mode === '409') {
      server.armFault({ path: '/backup/v3/snapshot', async beforeReply() {
        const key = f.encryption.generateEncryptionKey(f.seed);
        const peer = label('peer', 'preserved peer');
        const result = await f.protected.protectedBackupMutation(mnemonic, base, 'modifyLabels', {
          addLabels: [{ id: f.encryption.hash256(f.encryption.hash256(key + peer.id)),
            content: await f.image.encryptRecord(key, peer) }], deleteLabels: [],
        });
        assert.equal(result.updated, true, 'The independent signed peer CAS must actually commit');
      } });
    } else if (mode === '404') {
      // Simulate namespace storage loss only in this freshly owned throwaway DB.
      // Normal protected Delete produces a tombstone and is not a 404 substitute.
      // The original signed snapshot is genuine; the real service then detects
      // missing state and returns its own 404, with no fabricated HTTP response.
      server.armFault({ path: '/backup/v3/snapshot', async beforeReply() {
        const backend = server.backend;
        assert.match(backend.database, /^keeper_protected_http_test_[0-9]+$/);
        assert.equal(backend.mongoose.connection.name, backend.database);
        const database = backend.mongoose.connection.db;
        const removed = await database.collection('protectedBackupNamespaces').deleteOne({ _id: base.namespaceId });
        assert.equal(removed.deletedCount, 1);
        await database.collection('protectedBackupRecords').deleteMany({ namespaceId: base.namespaceId });
        namespaceLossWitness = true;
      } });
    } else server.armFault({ path: '/backup/v3/mutate', operation: 'modifyLabels',
      mode: mode === 'malformed' ? 'malformed-json' : mode });
    await f.send({ txId: 'sent', wallet: f.wallet(), note: 'send note',
      finalOutputs: [{ address: 'change-address' }], inputs: [] });
    const actual = writes().filter(event => event.operation === 'modifyLabels');
    assert.equal(actual.length, mode === '409' ? 2 : 1);
    const attempt = actual.at(-1);
    assertOriginalTuple(attempt, f.lastAction.originBackupWriteIntent);
    assert.equal(attempt.status, mode === '409' ? 409 : mode === '404' ? 404 : 200);
    assert.equal(attempt.committed, mode === 'malformed' || mode === 'lost-reply');
    for (const id of ['sentsend note', 'sent:0Change'])
      assert.ok(f.dbManager.getObjectById(f.RealmSchema.Tags, id), 'Local send labels must survive failed backup');
    assertPending(f);
    if (mode === '404') {
      assert.equal(namespaceLossWitness, true);
      await assert.rejects(f.read(), /Protected backup history conflicts with this device/);
    } else {
      const image = await f.remoteImage();
      if (mode === '409') {
        assert.equal(actual[0].committed, true);
        assert.equal(image.labels['peerpreserved peer'].label, 'preserved peer');
        assert.equal(image.labels['sentsend note'], undefined);
        assert.equal(image.labels['sent:0Change'], undefined);
      } else for (const id of ['sentsend note', 'sent:0Change'])
        assert.deepEqual(plain(image.labels[id]), plain(f.dbManager.getObjectById(f.RealmSchema.Tags, id)));
    }
    assert.equal(writes().length, mode === '409' ? 2 : 1,
      'Neither uncertainty, error nor explicit readback may retry or enroll/repair');
    assert.equal(server.trace.some(event => event.path === '/backup/v3/enroll'), false);
    assertPending(f);
  });
}

test('old-session send delegation cannot commit local labels or HTTP after A to B to A', async t => {
  const f = await setup(t);
  const payload = { txId: 'sent', wallet: f.wallet(), note: 'old session' };
  const original = f.sendAction(payload);
  assert.equal(f.transport.isCapturedBackupWriteIntent(original.originBackupWriteIntent), true);
  await f.selectAccount('disposable-label-account-b');
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Tags).length, 0);
  await f.selectAccount(f.appId);
  const before = await f.repair.captureBackupImage();
  await f.send(payload, original);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Tags).length, 0);
  assert.equal(server.trace.length, 0);
  assert.equal(await f.image.compareImages(before, await f.repair.captureBackupImage()), 'matched');
  assert.notEqual(original.originBackupAccountSession, f.transport.currentBackupAccountSession());
});
