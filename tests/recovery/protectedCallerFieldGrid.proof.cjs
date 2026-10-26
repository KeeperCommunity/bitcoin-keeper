// Missing caller-specific fields: original invalid revision ACKs for label and
// node producers, and original wrong-publicId node FINAL snapshot. All actual
// callers, receipts, encrypted Realm, crypto, signed CAS and backend stay real.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { runSaga } = require('redux-saga');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const common = { assert, crypto, runSaga, declarations, evaluate, plain, mnemonic, seed, appId };
const labelScope = { ...common };
evaluate(declarations('tests/recovery/protectedLabelProducers.proof.cjs',
  ['assertOriginalTuple', 'assertPending']), labelScope, 'unchanged-real-label-caller-assertions.ts');
// The original label setup is a host Node function. Its AddressCache external/
// internal objects enter native Realm.Mixed and must retain host constructors.
// Compile its ENTIRE unchanged declaration, without rewriting record data or
// replacing the real client, schema, transaction, encryption or positive checks.
const labelSetupFactory = vm.runInThisContext(`(function(scope, server) {
const { assert, createProtectedRealmClient, appId, seed, mnemonic, declarations, evaluate, plain } = scope;
${declarations('tests/recovery/protectedLabelProducers.proof.cjs', ['setup'])}
return setup; })`, { filename: 'unchanged-host-label-caller-setup.cjs' });
const nodeScope = { ...common, writes: () => writes() };
evaluate(declarations('tests/recovery/protectedNodeBootstrap.proof.cjs',
  ['setup']), nodeScope, 'unchanged-real-node-caller-setup.ts');
// Only these test assertions need their original host constructors: localNodes
// returns host JSON, so comparing it with a VM Array literal changes equality.
// Preserve the complete original declarations and inject only their observers.
const nodeAssertionHelpers = vm.runInThisContext(`(function(assert, writes) {
${declarations('tests/recovery/protectedNodeBootstrap.proof.cjs', ['assertPending', 'assertConnectionSuccessful'])}
return { assertPending, assertConnectionSuccessful }; })`, { filename: 'unchanged-host-node-test-assertions.cjs' });
Object.assign(nodeScope, nodeAssertionHelpers(assert, () => writes()));
const ackScope = { assert };
evaluate(declarations('tests/recovery/protectedAcknowledgementGrid.proof.cjs', ['assertOriginalPositiveAck']),
  ackScope, 'unchanged-full-positive-ack-contract.ts');
let server;
beforeEach(async () => {
  server = await createProtectedServer(); labelScope.server = server; nodeScope.server = server;
});
afterEach(async () => {
  await server?.close(); server = undefined; labelScope.server = undefined; nodeScope.server = undefined;
});
after(() => Realm.shutdown());
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

// Install observation on the actual source export BEFORE unchanged setup binds
// its producer workers. Delegate the same arguments and return the exact source
// promise. No proof, receipt, native commit or successful reply is substituted.
function observedClient(t) {
  return async (...args) => {
    const f = await createProtectedRealmClient(...args);
    const automatic = f.load('src/services/backup/automatic');
    const original = automatic.enqueueAutomaticBackupOperation;
    f.queueCalls = [];
    automatic.enqueueAutomaticBackupOperation = function (receipt, mutations) {
      f.queueCalls.push({ receipt, mutations });
      return original.apply(this, arguments);
    };
    f.replayCaptured = call => original.call(automatic, call.receipt, call.mutations);
    t.after(() => { automatic.enqueueAutomaticBackupOperation = original; });
    return f;
  };
}

async function caller(t, kind) {
  const scope = kind === 'labels' ? labelScope : nodeScope;
  scope.createProtectedRealmClient = observedClient(t);
  const setup = kind === 'labels' ? labelSetupFactory(scope, server) : scope.setup;
  const f = await setup(t);
  assert.equal(f.queueCalls.length, 0, 'Initial explicit enrollment must not stand in for the measured caller queue');
  return f;
}

function assertOwnTuple(event, base, operation) {
  assert.equal(event.operation, operation);
  assert.equal(event.status, 200);
  assert.equal(event.committed, true);
  assert.equal(event.namespaceId, base.namespaceId);
  assert.equal(event.expectedRevision, base.revision);
  assert.equal(event.expectedGeneration, base.generation);
  assert.equal(event.authEpoch, base.authEpoch);
}

function assertFullPending(f) {
  const state = f.store.getState().bhr;
  assert.equal(state.pendingAllBackupByAppId[appId], true);
  assert.notEqual(state.backupRepairStateByAppId[appId], 'verified');
  assert.notEqual(state.backupRepairCompletedByAppId[appId], true);
  assert.equal(state.automaticCloudBackupByAppId[appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), false);
  assert.equal(f.transport.captureBackupWriteIntent(appId), undefined);
}

function actualCallerReceipt(f, base, operation) {
  assert.equal(f.queueCalls.length, 1);
  const call = f.queueCalls[0];
  assert.equal(call.receipt.committed, true);
  assert.deepEqual(plain(call.receipt.intent.protectedBase), plain(base));
  assert.equal(call.mutations.length, 1);
  assert.equal(call.mutations[0].operation, operation);
  return call;
}

async function retainedCommit(f, call, expectedImage, account, expectedSnapshot) {
  const beforeReplay = server.trace.length;
  assert.notEqual((await f.replayCaptured(call)).backupConfirmed, true);
  assert.equal(server.trace.length, beforeReplay, 'The actual consumed caller receipt cannot read, enroll, repair or replay');
  const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(remote.state, 'present');
  assert.equal(remote.snapshot.revision, writes()[0].serverRevision);
  assert.equal(remote.snapshot.generation, writes()[0].serverGeneration);
  assert.equal(remote.snapshot.authEpoch, writes()[0].serverAuthEpoch);
  if (expectedSnapshot) assert.deepEqual(plain(remote.snapshot), expectedSnapshot);
  const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
    remote.namespaceId, () => {}, true);
  assert.equal(await f.image.compareImages(expectedImage, decoded), 'matched');
  assert.equal(await f.image.compareImages(expectedImage, await f.repair.captureBackupImage()), 'matched');
  assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), account);
  const afterReadback = server.trace.length;
  assert.notEqual((await f.replayCaptured(call)).backupConfirmed, true);
  assert.equal(server.trace.length, afterReadback, 'A fresh independent read cannot renew the old actual caller receipt');
  assert.equal(writes().length, 1);
  assertFullPending(f);
}

async function invalidRevisionAck(t, kind) {
  const f = await caller(t, kind), operation = kind === 'labels' ? 'modifyLabels' : 'updateAppImage';
  const base = f.transport.captureBackupWriteIntent(appId).protectedBase;
  const account = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
  let originalAck, deliveredAck, faults = 0;
  server.armFault({ path: '/backup/v3/mutate', operation, mutateReply(value) {
    originalAck = plain(value); deliveredAck = { ...value, newRevision: 'invalid' }; faults += 1;
    return deliveredAck;
  } });
  if (kind === 'labels') await f.send({ txId: 'sent', wallet: f.wallet(), note: 'send note',
    finalOutputs: [{ address: 'change-address' }], inputs: [] });
  else await f.connect();
  assert.equal(faults, 1);
  ackScope.assertOriginalPositiveAck(originalAck, base, operation);
  assert.deepEqual(deliveredAck, { ...originalAck, newRevision: 'invalid' });
  assert.notEqual(deliveredAck.newRevision, originalAck.newRevision);
  assert.equal(writes().length, 1);
  assertOwnTuple(writes()[0], base, operation);
  const call = actualCallerReceipt(f, base, operation);
  if (kind === 'labels') {
    for (const id of ['sentsend note', 'sent:0Change'])
      assert.ok(f.dbManager.getObjectById(f.RealmSchema.Tags, id));
    labelScope.assertOriginalTuple(writes()[0], f.lastAction.originBackupWriteIntent);
    labelScope.assertPending(f);
  } else await nodeScope.assertPending(f, { committed: true });
  assertFullPending(f);
  await retainedCommit(f, call, await f.repair.captureBackupImage(), account);
}

nodeTest('actual combined send-label caller rejects invalid revision ACK after real commit and preserves its local labels',
  { timeout: 30_000 }, t => invalidRevisionAck(t, 'labels'));

nodeTest('actual node-bootstrap caller rejects invalid revision ACK after real commit without failing Electrum connection',
  { timeout: 30_000 }, t => invalidRevisionAck(t, 'nodes'));

nodeTest('actual node-bootstrap caller rejects wrong publicId in its real final snapshot while preserving defaults and connection',
  { timeout: 30_000 }, async t => {
    const f = await caller(t, 'nodes');
    const base = f.transport.captureBackupWriteIntent(appId).protectedBase;
    const account = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
    let originalAck, ackObserved = false, originalFinal, injectedFinal, faults = 0;
    server.armFault({ path: '/backup/v3/mutate', operation: 'updateAppImage', beforeReply({ body }) {
      originalAck = plain(body); ackObserved = true;
    } });
    server.armFault({ path: '/backup/v3/snapshot', after: 1, mutateReply(value) {
      originalFinal = plain(value);
      injectedFinal = { ...value, appImage: { ...value.appImage, publicId: 'wrong-disposable-public-id' } };
      faults += 1; return injectedFinal;
    } });
    await f.connect();
    assert.equal(ackObserved, true);
    ackScope.assertOriginalPositiveAck(originalAck, base, 'updateAppImage');
    assert.equal(faults, 1);
    assert.deepEqual(server.trace.map(event => [event.path, event.status]), [
      ['/backup/v3/snapshot', 200], ['/backup/v3/mutate', 200], ['/backup/v3/snapshot', 200],
    ]);
    assert.equal(writes().length, 1);
    assertOwnTuple(writes()[0], base, 'updateAppImage');
    const call = actualCallerReceipt(f, base, 'updateAppImage');
    assert.equal(originalFinal.revision, originalAck.newRevision);
    assert.equal(originalFinal.generation, originalAck.newGeneration);
    assert.equal(originalFinal.authEpoch, originalAck.authEpoch);
    assert.notEqual(injectedFinal.appImage.publicId, originalFinal.appImage.publicId);
    assert.deepEqual(injectedFinal, { ...originalFinal,
      appImage: { ...originalFinal.appImage, publicId: 'wrong-disposable-public-id' } });
    assert.equal(injectedFinal.revision, originalFinal.revision, 'Never forge a matching revision to reach a later metadata branch');
    await nodeScope.assertPending(f, { committed: true });
    assertFullPending(f);
    await retainedCommit(f, call, await f.repair.captureBackupImage(), account, originalFinal);
  });
