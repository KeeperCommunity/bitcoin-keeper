// Original three-member fanout and shared-registration producer obligations.
// Every commit/ACK/conflict/read uses the real production queue and backend;
// a competing real signed CAS causes conflict, never an invented HTTP status.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
function barrier() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
const builders = { assert };
evaluate(declarations('tests/recovery/automaticWriteRealmRelay.integration.cjs', [
  'wallet', 'signer', 'vault', 'persist', 'persistVault', 'vaultBody', 'labelBody', 'operations',
]), builders, 'unchanged-disposable-fanout-record-builders.ts');
const { operations, wallet, vault, persist, persistVault, vaultBody, labelBody } = builders;
const fixtureScope = { assert, createProtectedRealmClient, mnemonic, seed, appId, operations };
evaluate(declarations('tests/recovery/protectedWriteRealmRelay.proof.cjs', ['client', 'assertOwnNextTuple']),
  fixtureScope, 'unchanged-real-client-and-full-ack-chain-helper.ts');
const ackScope = { assert, appId };
evaluate(declarations('tests/recovery/protectedAcknowledgementGrid.proof.cjs', ['assertOriginalPositiveAck', 'assertPending']),
  ackScope, 'unchanged-positive-ack-and-pending-assertions.ts');
let server;
beforeEach(async () => { server = await createProtectedServer(); fixtureScope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; fixtureScope.server = undefined; });
after(() => Realm.shutdown());
const test = (name, body) => nodeTest(name, { timeout: 30_000 }, body);
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');
const FANOUTS = ['create-and-archive-vaults', 'shared-vault-registration', 'label-import-and-delete'];

async function setup(t, operation, additionalVaults = []) {
  await server.reset();
  const f = await fixtureScope.client(t);
  operations[operation].prepare(f);
  persist(f, f.RealmSchema.Wallet, wallet(f, 'retained-wallet', 'Retained local recovery record'));
  for (const id of additionalVaults) persistVault(f, id);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
  await tick();
  assert.equal(await f.sagas.run('runBackupInspection', true, appId, true), true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], false);
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[appId], true);
  assert.ok(f.transport.captureBackupWriteIntent(appId)?.protectedBase);
  f.initialImage = await f.repair.captureBackupImage();
  f.initialApp = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
  server.clearTrace();
  return f;
}
function begin(f) {
  return f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId),
    f.transport.currentBackupAccountSession());
}
async function read(f) {
  const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(remote.state, 'present');
  const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
    remote.namespaceId, () => {}, true);
  return { remote, decoded };
}
async function localRetained(f, image) {
  assert.equal(await f.image.compareImages(image, await f.repair.captureBackupImage()), 'matched');
  assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
  assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
}
async function noReplay(f, receipt, mutations) {
  const total = server.trace.length, count = writes().length;
  const replay = await f.automatic.enqueueAutomaticBackupOperation(receipt, mutations);
  assert.notEqual(replay.backupConfirmed, true);
  assert.equal(server.trace.length, total, 'Old fanout cannot read, enroll, repair, rebase or replay');
  assert.equal(writes().length, count);
  ackScope.assertPending(f);
}

for (const fanout of FANOUTS) test(
  `${fanout}: real peer CAS after ACK1 rejects member2, stops member3 and preserves every local effect`, async t => {
    const labels = fanout === 'label-import-and-delete';
    const f = await setup(t, labels ? 'modifyLabels' : 'updateVaultImage', labels ? [] : ['vault-b', 'vault-c']);
    const receipt = f.automatic.commitBackupLocalOperation(begin(f), realm => {
      if (fanout === 'create-and-archive-vaults') {
        realm.objectForPrimaryKey('Vault', 'vault-a').archived = true;
        realm.create('Vault', vault(f, 'new-vault'), Realm.UpdateMode.Modified);
        realm.objectForPrimaryKey('Vault', 'vault-c').presentationData.name = 'Third prepared effect';
      } else if (fanout === 'shared-vault-registration') {
        realm.objectForPrimaryKey('VaultSigner', 'disposable-vault-public-key').registeredVaults = [
          { vaultId: 'vault-a', registered: true }, { vaultId: 'vault-b', registered: true }, { vaultId: 'vault-c', registered: true },
        ];
      } else {
        realm.delete(realm.objectForPrimaryKey('Tags', 'old-label'));
        for (const id of ['label-one', 'label-two', 'label-three']) realm.create('Tags',
          f.defaults(f.RealmSchema.Tags, { id, type: 'TX', ref: id, label: id }));
      }
    });
    assert.equal(receipt.committed, true);
    assert.ok(receipt.intent?.protectedBase);
    const local = await f.repair.captureBackupImage();
    const mutations = [];
    if (labels) for (const [index, id] of ['label-one', 'label-two', 'label-three'].entries()) {
      mutations.push({ operation: 'modifyLabels', body: await labelBody(f, [id], index === 0 ? ['old-label'] : []) });
    } else for (const id of fanout === 'create-and-archive-vaults'
      ? ['vault-a', 'new-vault', 'vault-c'] : ['vault-a', 'vault-b', 'vault-c']) {
      mutations.push({ operation: 'updateVaultImage', body: await vaultBody(f, id) });
    }
    assert.equal(mutations.length, 3);
    let firstAck, peerAck;
    server.armFault({ path: '/backup/v3/mutate', operation: mutations[0].operation,
      async beforeReply({ body }) {
        firstAck = plain(body);
        ackScope.assertOriginalPositiveAck(firstAck, receipt.intent.protectedBase, mutations[0].operation);
        peerAck = await f.protected.protectedBackupMutation(mnemonic, {
          namespaceId: receipt.intent.protectedBase.namespaceId, revision: body.newRevision,
          generation: body.newGeneration, authEpoch: body.authEpoch,
        }, 'updateAppImage', { walletsObject: {
          'remote-only-peer': await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed),
            plain(wallet(f, 'remote-only-peer', 'Independent peer recovery record'))),
        } });
      } });
    const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, mutations);
    assert.notEqual(result.backupConfirmed, true);
    assert.ok(firstAck);
    assert.ok(peerAck?.base, 'A genuinely committed signed peer CAS must advance the actual server tuple');
    const all = writes();
    assert.equal(all.length, 3, 'Exactly two own attempts and one independent real peer mutation');
    assert.deepEqual(all.map(event => event.status), [200, 200, 409]);
    assert.equal(all[0].operation, mutations[0].operation);
    assert.equal(all[1].operation, 'updateAppImage');
    assert.equal(all[2].operation, mutations[1].operation);
    assert.equal(all[0].committed, true);
    assert.equal(all[1].committed, true);
    assert.equal(all[2].committed, false);
    assert.equal(all[0].expectedRevision, receipt.intent.protectedBase.revision);
    assert.equal(all[0].expectedGeneration, receipt.intent.protectedBase.generation);
    assert.equal(all[0].authEpoch, receipt.intent.protectedBase.authEpoch);
    fixtureScope.assertOwnNextTuple(all[0], all[2]);
    assert.notEqual(all[2].expectedRevision, peerAck.base.revision, 'Member2 cannot borrow peer authority');
    ackScope.assertPending(f);
    await localRetained(f, local);
    const { remote, decoded } = await read(f);
    assert.equal(remote.snapshot.revision, peerAck.base.revision);
    assert.equal(remote.snapshot.generation, peerAck.base.generation);
    assert.ok(decoded.wallets['remote-only-peer']);
    if (labels) {
      assert.deepEqual(plain(decoded.labels['label-one']), plain(local.labels['label-one']));
      assert.equal(decoded.labels['old-label'], undefined);
      assert.equal(decoded.labels['label-two'], undefined);
      assert.equal(decoded.labels['label-three'], undefined);
    } else if (fanout === 'create-and-archive-vaults') {
      assert.equal(decoded.vaults['vault-a'].archived, true);
      assert.equal(decoded.vaults['new-vault'], undefined);
      assert.deepEqual(plain(decoded.vaults['vault-c']), plain(f.initialImage.vaults['vault-c']));
    } else {
      assert.deepEqual(plain(decoded.vaults['vault-a'].signers[0].registeredVaults),
        plain(local.vaults['vault-a'].signers[0].registeredVaults));
      for (const id of ['vault-b', 'vault-c']) assert.deepEqual(plain(decoded.vaults[id]), plain(f.initialImage.vaults[id]));
    }
    await noReplay(f, receipt, mutations);
  });

test('a genuine later native label commit while ACK1 is held stops fanout members2/3 after the first real CAS', async t => {
  const f = await setup(t, 'modifyLabels');
  const receipt = f.automatic.commitBackupLocalOperation(begin(f), realm => {
    realm.delete(realm.objectForPrimaryKey('Tags', 'old-label'));
    for (const id of ['first-imported-label', 'second-imported-label', 'third-imported-label']) realm.create('Tags',
      f.defaults(f.RealmSchema.Tags, { id, type: 'TX', ref: id, label: id }));
  });
  assert.equal(receipt.committed, true);
  assert.ok(receipt.intent?.protectedBase);
  const before = await f.repair.captureBackupImage();
  const mutations = [];
  for (const [index, id] of ['first-imported-label', 'second-imported-label', 'third-imported-label'].entries()) {
    mutations.push({ operation: 'modifyLabels', body: await labelBody(f, [id], index === 0 ? ['old-label'] : []) });
  }
  const held = barrier(), release = barrier();
  t.after(release.release);
  let firstAck, settled = false, expectedLocal;
  server.armFault({ path: '/backup/v3/mutate', operation: 'modifyLabels', beforeReply({ body }) {
    firstAck = plain(body); held.release(); return release.promise;
  } });
  const writing = f.automatic.enqueueAutomaticBackupOperation(receipt, mutations).finally(() => { settled = true; });
  let result;
  try {
    assert.equal(await Promise.race([held.promise.then(() => true), writing.then(() => false)]), true);
    assert.equal(settled, false);
    ackScope.assertOriginalPositiveAck(firstAck, receipt.intent.protectedBase, 'modifyLabels');
    assert.equal(writes().length, 1);
    assert.equal(writes()[0].committed, true);
    persist(f, f.RealmSchema.Tags, f.defaults(f.RealmSchema.Tags, {
      id: 'interleaved-local-label', type: 'TX', ref: 'interleaved', label: 'A later committed local write',
    }));
    expectedLocal = await f.repair.captureBackupImage();
    assert.equal(expectedLocal.labels['interleaved-local-label'].label, 'A later committed local write');
    assert.equal(settled, false, 'Real later local commit must complete while ACK1 remains held');
  } finally {
    release.release();
    result = await writing;
  }
  assert.notEqual(result.backupConfirmed, true);
  assert.equal(writes().length, 1, 'Neither second nor third prepared member may send a mutation');
  ackScope.assertPending(f);
  await localRetained(f, expectedLocal);
  for (const [id, label] of Object.entries(before.labels)) assert.deepEqual(plain(expectedLocal.labels[id]), plain(label));
  const { remote, decoded } = await read(f);
  assert.equal(remote.snapshot.revision, firstAck.newRevision);
  assert.deepEqual(plain(decoded.labels['first-imported-label']), plain(before.labels['first-imported-label']));
  for (const id of ['old-label', 'second-imported-label', 'third-imported-label', 'interleaved-local-label']) {
    assert.equal(decoded.labels[id], undefined);
  }
  await noReplay(f, receipt, mutations);
});

test('actual BHR shared native registration producer updates both existing vaults with its own ACK chain and full readback', async t => {
  const f = await setup(t, 'updateVaultImage', ['vault-b']);
  const producer = f.productionSagas(['currentBackupAppId', 'buildAutomaticVaultMutation', 'queueCommittedBackupWorker']);
  const registrations = [
    { vaultId: 'vault-a', registered: true, hmac: 'disposable-receipt' },
    { vaultId: 'vault-b', registered: true, hmac: 'disposable-receipt' },
  ].map(value => f.defaults(f.RealmSchema.RegistrationInfo, value));
  const receipt = f.automatic.commitBackupLocalOperation(begin(f), realm => {
    realm.objectForPrimaryKey('VaultSigner', 'disposable-vault-public-key').registeredVaults = registrations;
  });
  assert.equal(receipt.committed, true);
  assert.ok(receipt.intent?.protectedBase);
  const local = await f.repair.captureBackupImage();
  for (const id of ['vault-a', 'vault-b']) assert.deepEqual(plain(local.vaults[id].signers[0].registeredVaults), registrations);
  const mutations = ['vault-a', 'vault-b'].map(id => producer.scope.buildAutomaticVaultMutation(id, appId));
  assert.ok(mutations.every(value => value?.operation === 'updateVaultImage'));
  const result = await producer.run('queueCommittedBackupWorker', appId, receipt, mutations,
    f.transport.currentBackupAccountSession());
  assert.equal(result.backupConfirmed, true);
  assert.equal(writes().length, 2);
  assert.ok(writes().every(event => event.committed && event.status === 200));
  assert.equal(writes()[0].expectedRevision, receipt.intent.protectedBase.revision);
  assert.equal(writes()[0].expectedGeneration, receipt.intent.protectedBase.generation);
  assert.equal(writes()[0].authEpoch, receipt.intent.protectedBase.authEpoch);
  fixtureScope.assertOwnNextTuple(writes()[0], writes()[1]);
  const { remote, decoded } = await read(f);
  assert.equal(remote.snapshot.revision, writes()[1].serverRevision);
  for (const id of ['vault-a', 'vault-b']) {
    assert.equal(decoded.vaults[id].signers[0].registeredVaults.length, 2);
    assert.deepEqual(plain(decoded.vaults[id].signers[0].registeredVaults), registrations);
  }
  assert.equal(await f.image.compareImages(local, decoded), 'matched');
  await localRetained(f, local);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], false);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[appId], 'verified');
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), true);
  await noReplay(f, receipt, mutations);
});
