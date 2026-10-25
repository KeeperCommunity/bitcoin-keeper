// Additive signed-v3 ports of the eleven existing-USDT caller obligations.
// Actual hook closures, production workers/receipts, encrypted native Realm,
// crypto, signed HTTP and transactional Relay remain real. React callback
// mounting and public unfunded existing-record inputs are host boundaries only.
// No USDT generation, provider, token transfer or rendered native UI is tested.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isDeepStrictEqual } = require('node:util');
const ts = require('typescript');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
let server;
beforeEach(async () => { server = await createProtectedServer(); });
afterEach(async () => { await server?.close(); server = undefined; });
after(() => { seed.fill(0); Realm.shutdown(); });
const test = (name, body) => nodeTest(name, { timeout: 30_000 }, body);
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');
const equal = (actual, expected, label) => assert.ok(isDeepStrictEqual(actual, expected), label);

// Original public existing-wallet inputs; neither this builder nor the paused
// creation test calls a token provider or derives a new USDT wallet.
function usdt(f, type = 'DEFAULT', id = `usdt-${type}`) {
  return f.defaults(f.RealmSchema.USDTWallet, {
    id, type, entityKind: f.enums.EntityKind.USDT_WALLET, networkType: f.enums.NetworkType.TESTNET,
    derivationDetails: f.defaults(f.RealmSchema.USDTWalletDerivationDetails, {
      instanceNum: type === 'DEFAULT' ? 1 : null, mnemonic: 'public disposable fixture only',
      xDerivationPath: "m/44'/195'/0'/0/0",
    }),
    presentationData: f.defaults(f.RealmSchema.USDTWalletPresentationData, {
      name: 'Existing wallet', description: 'Before', visibility: 'DEFAULT',
    }),
    specs: f.defaults(f.RealmSchema.USDTWalletSpecs, {
      address: 'disposable-token-address', privateKey: 'unspendable-fixture-private-material', balance: 10,
    }),
  });
}

function selectedCallbacks() {
  const file = 'src/hooks/useUSDTWallets.ts';
  const source = ts.createSourceFile(file,
    fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'), ts.ScriptTarget.Latest, true);
  const needed = new Set(['isOriginCurrent', 'createWallet', 'updateWallet', 'deleteWallet']);
  const found = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && needed.has(node.name.getText(source)))
      found.push({ name: node.name.getText(source), text: `const ${node.getText(source)};` });
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(found.length, needed.size, 'All selected production hook callbacks must exist');
  assert.equal(new Set(found.map(entry => entry.name)).size, needed.size,
    'Each unchanged callback declaration must be selected exactly once');
  return declarations(file, ['USDT_WALLET_CREATION_PAUSED']) + '\n' +
    found.map(entry => entry.text).join('\n');
}

function mountCallbacks(scope) {
  // Realm.Mixed uses host constructor identity. Compile the exact selected
  // production bodies into that host; do not JSON-roundtrip/drop schema fields
  // or replace the native database, receipt, crypto or HTTP implementation.
  const names = Object.keys(scope).filter(name => name !== 'default' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name));
  const code = ts.transpileModule(selectedCallbacks(), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const factory = vm.runInThisContext(`(function (${names.join(',')}) {
${code}
return { createWallet, updateWallet, deleteWallet, creationPaused: USDT_WALLET_CREATION_PAUSED };
})`, { filename: 'unchanged-existing-usdt-callbacks.cjs' });
  return factory(...names.map(name => scope[name]));
}

async function setup(t, type = 'DEFAULT') {
  await server.reset();
  const f = await createProtectedRealmClient(server.url, {
    appId, primarySeed: seed.toString('hex'), primaryMnemonic: mnemonic,
  });
  const pending = [];
  t.after(async () => {
    const drained = await Promise.allSettled(pending.splice(0));
    await f.close();
    assert.ok(drained.every(result => result.status === 'fulfilled'), 'Owned USDT backup worker must drain');
  });
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  assert.equal(f.dbManager.createObject(f.RealmSchema.USDTWallet, usdt(f, type)), true);
  assert.equal(f.dbManager.createObject(f.RealmSchema.USDTWallet,
    usdt(f, 'IMPORTED', 'retained-usdt')), true);
  const sagas = f.productionSagas([
    'currentBackupAppId', 'setServerBackupFailed', 'backupInspectionOwners', 'runBackupInspection',
    'buildAutomaticAppMutation', 'queueCommittedBackupWorker', 'updateAppImageWorker',
  ]);
  assert.equal(await sagas.run('runBackupInspection', true, f.appId, true), true,
    'Only explicit actual production opt-in may enroll, repair and verify the initial copy');
  f.read = async () => {
    const remote = await f.protected.readProtectedBackup(mnemonic, undefined, f.appId);
    assert.equal(remote.state, 'present');
    return remote.snapshot;
  };
  f.decode = remote => f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    remote, remote.namespaceId, () => {}, true);
  f.remoteImage = async () => f.decode(await f.read());
  f.wallet = () => plain(f.dbManager.getObjectById(f.RealmSchema.USDTWallet, `usdt-${type}`));
  f.retained = () => plain(f.dbManager.getObjectById(f.RealmSchema.USDTWallet, 'retained-usdt'));
  f.initial = await f.read();
  f.initialImage = await f.repair.captureBackupImage();
  f.retainedBefore = f.retained();
  assert.ok(f.transport.captureBackupWriteIntent(f.appId)?.protectedBase);
  f.queueCalls = [];
  const enqueue = f.automatic.enqueueAutomaticBackupOperation;
  const observeQueue = (receipt, mutations) => {
    // Observe and delegate unchanged. This never supplies a commit/ACK/proof.
    f.queueCalls.push({ receipt, mutations });
    return enqueue(receipt, mutations);
  };
  sagas.scope.enqueueAutomaticBackupOperation = observeQueue;
  f.hookActions = [];
  f.hookFeedback = 0;
  f.generationCalls = 0;
  const callbacks = mountCallbacks({
    ...f.encryption, ...f.image, ...f.transport, ...f.automatic, ...f.bhr,
    ...f.load('src/store/sagaActions/bhr'),
    enqueueAutomaticBackupOperation: observeQueue,
    RealmSchema: f.RealmSchema, dbManager: f.dbManager,
    appId: f.appId, renderAccountSession: f.transport.currentBackupAccountSession(), reduxStore: f.store,
    // Mount the selected callback closure, not a React render or native UI.
    useCallback: callback => callback,
    dispatch(action) {
      const actual = f.store.dispatch(action);
      f.hookActions.push(actual);
      if (actual.type === 'UPDATE_APP_IMAGE') pending.push(sagas.run('updateAppImageWorker', actual));
      return actual;
    },
    setError() { f.hookFeedback += 1; },
    captureError() { f.hookFeedback += 1; },
    generateUSDTWallet() {
      f.generationCalls += 1;
      throw new Error('Paused USDT generation must not run');
    },
  });
  f.callbacks = callbacks;
  f.update = async wallet => {
    const result = await callbacks.updateWallet(wallet);
    await Promise.all(pending.splice(0));
    return result;
  };
  server.clearTrace();
  return f;
}

function queueCall(f) {
  assert.equal(f.queueCalls.length, 1, 'The actual caller must submit one committed operation');
  const call = f.queueCalls[0];
  assert.equal(call.receipt.committed, true);
  assert.ok(call.receipt.intent?.protectedBase, 'Original complete protected base is required');
  return call;
}

function assertOriginalTuple(event, intent) {
  const base = intent.protectedBase;
  assert.ok(event.namespaceId === base.namespaceId, 'Original namespace must be retained');
  assert.ok(event.expectedRevision === base.revision, 'Original revision must be retained');
  assert.ok(event.expectedGeneration === base.generation, 'Original generation must be retained');
  assert.ok(event.authEpoch === base.authEpoch, 'Original auth epoch must be retained');
}

function ownAttempt(f, operation, peer = false) {
  const actual = writes();
  assert.equal(actual.length, peer ? 2 : 1);
  if (peer) {
    assert.equal(actual[0].operation, 'updateAppImage');
    assert.equal(actual[0].committed, true, 'Competing signed mutation must really commit');
    assert.equal(actual[0].status, 200);
  }
  const own = actual.at(-1);
  assert.equal(own.operation, operation);
  assertOriginalTuple(own, queueCall(f).receipt.intent);
  return own;
}

function assertPending(f) {
  const state = f.store.getState().bhr;
  assert.equal(state.pendingAllBackupByAppId[f.appId], true);
  assert.notEqual(state.backupRepairStateByAppId[f.appId], 'verified');
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
}

async function assertConfirmed(f, operation) {
  const own = ownAttempt(f, operation);
  assert.equal(own.status, 200);
  assert.equal(own.committed, true);
  const remote = await f.read();
  assert.ok(remote.revision === own.serverRevision, 'Readback must match the actual ACK revision');
  assert.ok(remote.generation === own.serverGeneration, 'Readback must match the actual ACK generation');
  assert.ok(remote.authEpoch === own.serverAuthEpoch, 'Readback must match the actual ACK auth epoch');
  const image = await f.decode(remote);
  assert.equal(await f.image.compareImages(await f.repair.captureBackupImage(), image), 'matched',
    'Complete decrypted image must match the current native image');
  equal(image.wallets['retained-usdt'], f.retainedBefore, 'Every retained sibling field must survive');
  equal(f.retained(), f.retainedBefore, 'The native retained sibling must remain unchanged');
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified');
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[f.appId], true);
  assert.equal(server.trace.some(event => event.path === '/backup/v3/enroll'), false,
    'An existing-wallet action cannot re-enroll or repair');
  return image;
}

async function assertConsumedNoReplay(f) {
  const call = queueCall(f);
  const before = server.trace.length;
  const result = await f.automatic.enqueueAutomaticBackupOperation(call.receipt, call.mutations);
  assert.notEqual(result.backupConfirmed, true);
  assert.equal(server.trace.length, before, 'Consumed receipt must not read, replay, enroll or repair');
  assertPending(f);
}

function peerConflict(f) {
  const base = f.transport.captureBackupWriteIntent(f.appId).protectedBase;
  let committed = false;
  server.armFault({ path: '/backup/v3/snapshot', async beforeReply() {
    const result = await f.protected.protectedBackupMutation(mnemonic, base, 'updateAppImage', {
      nodes: [], replaceNodes: true,
    });
    assert.equal(result.updated, true);
    committed = true;
  } });
  return () => assert.equal(committed, true, 'The independent signed peer CAS must actually commit');
}

function observeAdmission(t, capture) {
  const observations = [], errors = [];
  const trace = server.trace, original = trace.push;
  trace.push = function (...events) {
    for (const event of events) if (event.path === '/backup/v3/mutate') {
      try { observations.push(capture()); } catch { errors.push(true); }
    }
    return original.apply(this, events);
  };
  t.after(() => { trace.push = original; });
  return { observations, errors };
}

for (const type of ['DEFAULT', 'IMPORTED']) {
  test(`actual existing ${type} USDT metadata edit commits before signed HTTP and verifies hidden recovery state`, async t => {
    const f = await setup(t, type), edited = f.wallet();
    edited.presentationData = { name: 'Saved edit', description: 'Recoverable description', visibility: 'HIDDEN' };
    const admission = observeAdmission(t, () => ({
      committed: f.wallet().presentationData.name === 'Saved edit' &&
        f.wallet().presentationData.visibility === 'HIDDEN' && !f.nativeRealm().isInTransaction,
    }));
    assert.equal(await f.update(edited), true);
    equal(admission.observations, [{ committed: true }], 'Native metadata must precede the first actual mutation');
    assert.equal(admission.errors.length, 0);
    const image = await assertConfirmed(f, 'updateAppImage');
    equal(image.wallets[edited.id].presentationData, edited.presentationData,
      'All edited metadata and hidden visibility must survive complete readback');
    assert.equal(f.generationCalls, 0);
  });

  test(`actual existing ${type} USDT deletion commits before signed HTTP and preserves another wallet`, async t => {
    const f = await setup(t, type), id = f.wallet().id;
    const admission = observeAdmission(t, () => ({
      deleted: f.dbManager.getObjectById(f.RealmSchema.USDTWallet, id) === undefined,
      retained: !!f.dbManager.getObjectById(f.RealmSchema.USDTWallet, 'retained-usdt'),
      outsideTransaction: !f.nativeRealm().isInTransaction,
    }));
    assert.equal(await f.callbacks.deleteWallet(id), true);
    equal(admission.observations, [{ deleted: true, retained: true, outsideTransaction: true }],
      'Actual deletion and retained sibling must precede signed mutation admission');
    assert.equal(admission.errors.length, 0);
    assert.equal(f.dbManager.getObjectById(f.RealmSchema.USDTWallet, id), undefined);
    const image = await assertConfirmed(f, 'deleteAppImageEntity');
    assert.equal(image.wallets[id], undefined);
    assert.equal(f.generationCalls, 0);
  });
}

test('actual USDT hook creation and import stay paused before generation native writes or HTTP', async t => {
  const f = await setup(t);
  assert.equal(f.callbacks.creationPaused, true);
  const before = await f.repair.captureBackupImage();
  const count = f.dbManager.getCollection(f.RealmSchema.USDTWallet).length;
  for (const type of ['DEFAULT', 'IMPORTED']) {
    const result = await f.callbacks.createWallet({ type, name: 'Paused', description: '' });
    assert.equal(result.error, 'USDT wallet setup is paused');
  }
  assert.equal(f.generationCalls, 0);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.USDTWallet).length, count);
  assert.equal(await f.image.compareImages(before, await f.repair.captureBackupImage()), 'matched');
  assert.equal(f.queueCalls.length, 0);
  assert.equal(server.trace.length, 0);
});

for (const mode of ['409', 'malformed', 'lost-reply']) {
  test(`actual USDT metadata survives genuine ${mode} with pending backup and no replay`, async t => {
    const f = await setup(t), edited = f.wallet();
    edited.presentationData.name = 'Saved despite cloud failure';
    let confirmPeer, malformedWitness = false;
    if (mode === '409') confirmPeer = peerConflict(f);
    else server.armFault({ path: '/backup/v3/mutate', operation: 'updateAppImage',
      ...(mode === 'malformed' ? { mutateReply(value) {
        assert.equal(value.updated, true);
        malformedWitness = true;
        return { ...value, newRevision: 'invalid' };
      } } : { mode }) });
    assert.equal(await f.update(edited), true);
    assert.equal(f.wallet().presentationData.name, 'Saved despite cloud failure');
    const own = ownAttempt(f, 'updateAppImage', mode === '409');
    assert.equal(own.status, mode === '409' ? 409 : 200);
    assert.equal(own.committed, mode !== '409');
    if (mode === '409') confirmPeer();
    if (mode === 'malformed') assert.equal(malformedWitness, true,
      'Alter only a parsed real committed ACK, preserving the invalid-revision control');
    assertPending(f);
    const image = await f.remoteImage();
    equal(image.wallets[edited.id], mode === '409' ? f.initialImage.wallets[edited.id] : f.wallet(),
      'The remote image must reflect the genuine rejected or committed own mutation');
    equal(image.wallets['retained-usdt'], f.retainedBefore, 'The complete retained sibling must survive');
    assertPending(f);
    await assertConsumedNoReplay(f);
    assert.equal(writes().length, mode === '409' ? 2 : 1);
    assert.equal(server.trace.some(event => event.path === '/backup/v3/enroll'), false);
  });
}

test('actual USDT deletion survives genuine conflict after its local commit and remains pending', async t => {
  const f = await setup(t), id = f.wallet().id, confirmPeer = peerConflict(f);
  assert.equal(await f.callbacks.deleteWallet(id), true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.USDTWallet, id), undefined);
  confirmPeer();
  const own = ownAttempt(f, 'deleteAppImageEntity', true);
  assert.equal(own.status, 409);
  assert.equal(own.committed, false);
  assertPending(f);
  const image = await f.remoteImage();
  equal(image.wallets[id], f.initialImage.wallets[id], 'The rejected delete must retain the entire old remote wallet');
  equal(image.wallets['retained-usdt'], f.retainedBefore, 'The complete retained remote sibling must survive');
  equal(f.retained(), f.retainedBefore, 'The complete retained native sibling must survive');
  assertPending(f);
  await assertConsumedNoReplay(f);
  assert.equal(writes().length, 2);
});

test('actual USDT cache refresh creates no redundant recovery HTTP writes', async t => {
  const f = await setup(t), synced = f.wallet();
  const before = await f.repair.captureBackupImage();
  synced.specs.balance = 12;
  synced.specs.lastSynched = 2;
  synced.accountStatus.nextNonce = 1;
  assert.equal(await f.update(synced), true);
  assert.equal(f.wallet().specs.balance, 12);
  assert.equal(f.wallet().specs.lastSynched, 2);
  assert.equal(f.wallet().accountStatus.nextNonce, 1);
  assert.equal(await f.image.compareImages(before, await f.repair.captureBackupImage()), 'matched');
  equal(f.retained(), f.retainedBefore, 'Cache refresh must preserve every retained sibling field');
  assert.equal(f.queueCalls.length, 0);
  assert.equal(server.trace.length, 0);
});

test('actual USDT rendered callbacks cannot edit or delete after A to B to A', async t => {
  const f = await setup(t), edited = f.wallet();
  const before = await f.repair.captureBackupImage();
  const session = f.transport.currentBackupAccountSession();
  const feedback = f.hookFeedback, actionCount = f.hookActions.length;
  edited.presentationData.name = 'Old callback';
  const otherMnemonic = require('bip39').entropyToMnemonic('66'.repeat(16));
  const otherSeed = require('bip39').mnemonicToSeedSync(otherMnemonic);
  const otherId = crypto.createHash('sha256').update(otherSeed).digest('hex');
  try {
    await f.selectAccount(otherId);
    await f.selectAccount(f.appId);
  } finally { otherSeed.fill(0); }
  assert.notEqual(f.transport.currentBackupAccountSession(), session);
  assert.equal(await f.update(edited), false);
  assert.equal(await f.callbacks.deleteWallet(edited.id), false);
  assert.equal(f.wallet().presentationData.name, 'Existing wallet');
  assert.equal(await f.image.compareImages(before, await f.repair.captureBackupImage()), 'matched');
  assert.equal(f.hookFeedback, feedback, 'Old closures must not publish newer-session error feedback');
  assert.equal(f.hookActions.length, actionCount, 'Old closures must not dispatch into the newer session');
  assert.equal(f.queueCalls.length, 0);
  assert.equal(server.trace.length, 0);
});
