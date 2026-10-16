const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { createRealmClient, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');

// Native Realm and complete production schemas/snapshot/wrapper, with only the
// fixture's unused React Native/MMKV boundary adapters. No Relay request is made.
async function fixture(run) {
  const client = await createRealmClient('http://127.0.0.1:1/');
  const commits = [];
  let invalidations = 0;
  client.dbManager.setRecoveryCommitObserver((appId, fingerprint) => {
    assert.equal(client.nativeRealm().isInTransaction, false);
    const current = client.load('src/services/backup/localSnapshot').captureLocalRecovery(client.nativeRealm());
    assert.equal(appId, current.app.id);
    assert.equal(fingerprint, current.fingerprint);
    commits.push({ appId, fingerprint });
  });
  client.dbManager.setRecoveryMutationObserver(() => { invalidations += 1; });
  const label = (id, patch = {}) => client.defaults(client.RealmSchema.Tags, {
    id, type: 'txn', ref: 'disposable-reference', label: 'before', ...patch,
  });
  const counts = () => ({ commits: commits.length, invalidations });
  try {
    await run({ ...client, commits, label, counts });
  } finally {
    await client.close();
    mock.restoreAll();
  }
}
after(() => Realm.shutdown());

test('whole-array create is one native commit and a bad later record rolls back the entire array', () => fixture(async (f) => {
  const { Tags } = f.RealmSchema;
  assert.equal(f.dbManager.createObjectBulk(Tags, [f.label('label-a'), f.label('label-b')]), true);
  assert.equal(f.nativeRealm().objects(Tags).length, 2);
  assert.deepEqual(f.counts(), { commits: 1, invalidations: 1 });
  mock.method(console, 'log', () => {});
  assert.equal(f.dbManager.createObjectBulk(Tags, [f.label('label-c'), f.label('label-d', { ref: 42 })]), false);
  assert.equal(f.nativeRealm().objects(Tags).length, 2);
  assert.equal(f.nativeRealm().objectForPrimaryKey(Tags, 'label-c'), null);
  assert.deepEqual(f.counts(), { commits: 1, invalidations: 2 }, 'failed attempt invalidates UI but produces no committed generation');
}));

for (const helper of ['updateObjectById', 'updateObjectByPrimaryId', 'updateObjectByQuery'])
  test(`${helper} rolls back every field when a later assignment fails`, () => fixture(async (f) => {
    const { Tags } = f.RealmSchema;
    assert.equal(f.dbManager.createObject(Tags, f.label('label-a')), true);
    const update = (patch) => helper === 'updateObjectById'
      ? f.dbManager[helper](Tags, 'label-a', patch)
      : helper === 'updateObjectByPrimaryId'
        ? f.dbManager[helper](Tags, 'id', 'label-a', patch)
        : f.dbManager[helper](Tags, (record) => record.id === 'label-a', patch);
    mock.method(console, 'error', () => {});
    assert.equal(update({ label: 'partially changed', ref: 42 }), false);
    const record = f.nativeRealm().objectForPrimaryKey(Tags, 'label-a');
    assert.equal(record.label, 'before');
    assert.equal(record.ref, 'disposable-reference');
    assert.deepEqual(f.counts(), { commits: 1, invalidations: 2 });
    assert.equal(update({ label: 'committed', ref: 'new reference' }), true);
    assert.equal(record.label, 'committed');
    assert.equal(record.ref, 'new reference');
    assert.deepEqual(f.counts(), { commits: 2, invalidations: 3 });
  }));

test('nested synchronous helpers share a native outer transaction and notify once after the group', () => fixture(async (f) => {
  const { Tags } = f.RealmSchema;
  const native = f.nativeRealm();
  assert.equal(f.realmDatabase.write(() => {
    assert.equal(native.isInTransaction, true);
    assert.equal(f.dbManager.createObject(Tags, f.label('label-a')), true);
    assert.equal(f.realmDatabase.write(() => {
      assert.equal(f.dbManager.createObject(Tags, f.label('label-b')), true);
    }), true);
    assert.equal(f.commits.length, 0, 'a nested helper cannot publish an uncommitted generation');
  }), true);
  assert.equal(native.objects(Tags).length, 2);
  assert.equal(f.commits.length, 1);
}));

test('a caught nested write failure still poisons the outer group and rolls back all local effects', () => fixture(async (f) => {
  const { Tags } = f.RealmSchema;
  mock.method(console, 'log', () => {});
  assert.throws(() => f.realmDatabase.write(() => {
    assert.equal(f.dbManager.createObject(Tags, f.label('label-a')), true);
    assert.equal(f.dbManager.createObjectBulk(Tags, [f.label('label-b'), f.label('label-c', { ref: 42 })]), false);
    assert.equal(f.dbManager.createObject(Tags, f.label('label-d')), true);
  }));
  assert.equal(f.nativeRealm().objects(Tags).length, 0);
  assert.equal(f.commits.length, 0);
  assert.equal(f.counts().invalidations, 3);
}));

test('write and delete failures throw and thenable callbacks roll back without a generation', () => fixture(async (f) => {
  const { Tags } = f.RealmSchema;
  assert.equal(f.dbManager.createObject(Tags, f.label('label-a')), true);
  const record = f.nativeRealm().objectForPrimaryKey(Tags, 'label-a');
  assert.throws(() => f.realmDatabase.write(() => { record.label = 'bad'; throw new Error('synthetic failure'); }), /synthetic failure/);
  assert.equal(record.label, 'before');
  assert.throws(() => f.realmDatabase.delete(undefined));
  assert.throws(() => f.realmDatabase.write(() => { record.label = 'bad'; return { then() {} }; }), /synchronous/);
  assert.equal(record.label, 'before');
  let asyncStarted = false;
  assert.throws(() => f.realmDatabase.write(async () => { asyncStarted = true; record.label = 'bad'; }), /synchronous/);
  assert.equal(asyncStarted, false);
  assert.equal(f.commits.length, 1);
  assert.equal(f.realmDatabase.delete(record), true);
  assert.equal(f.nativeRealm().objects(Tags).length, 0);
  assert.equal(f.commits.length, 2);
}));

test('cache, node-connection and history-only writes do not advance committed recovery generation', () => fixture(async (f) => {
  const { Wallet, NodeConnect, UAI } = f.RealmSchema;
  assert.equal(f.dbManager.createObject(Wallet, f.defaults(Wallet, { id: 'wallet-a' })), true);
  const wallet = f.nativeRealm().objectForPrimaryKey(Wallet, 'wallet-a');
  assert.equal(f.dbManager.createObject(NodeConnect, f.defaults(NodeConnect, { id: 1, host: 'fixture' })), true);
  const before = f.counts();
  assert.equal(f.dbManager.updateObjectById(Wallet, 'wallet-a', {
    specs: { ...plain(wallet.specs), balances: { confirmed: 123, unconfirmed: 456 }, lastSynched: 123 },
  }), true);
  assert.equal(f.dbManager.updateObjectByQuery(NodeConnect, (node) => node.id === 1, { isConnected: true }), true);
  assert.equal(f.dbManager.createObject(UAI, f.defaults(UAI)), true);
  assert.deepEqual(f.counts(), before);
  assert.equal(f.dbManager.updateObjectById(Wallet, 'wallet-a', {
    specs: { ...plain(wallet.specs), nextFreeAddressIndex: wallet.specs.nextFreeAddressIndex + 1 },
  }), true);
  assert.deepEqual(f.counts(), { commits: before.commits + 1, invalidations: before.invalidations + 1 });
}));

test('KeeperApp recovery metadata advances generation while analytics-only changes do not', () => fixture(async (f) => {
  const { KeeperApp } = f.RealmSchema;
  const app = f.nativeRealm().objectForPrimaryKey(KeeperApp, f.appId);
  assert.equal(f.dbManager.updateObjectById(KeeperApp, f.appId, { enableAnalytics: !app.enableAnalytics }), true);
  assert.deepEqual(f.counts(), { commits: 0, invalidations: 0 });
  for (const patch of [{ version: '2.6.4-fixture' }, { publicId: 'new fixture identity' }, { networkType: 'MAINNET' }]) {
    const before = f.counts();
    assert.equal(f.dbManager.updateObjectById(KeeperApp, f.appId, patch), true);
    assert.deepEqual(f.counts(), { commits: before.commits + 1, invalidations: before.invalidations + 1 });
  }
}));

test('observer failure cannot report a successfully committed local write as failed', () => fixture(async (f) => {
  const { KeeperApp } = f.RealmSchema;
  f.dbManager.setRecoveryCommitObserver(() => { throw new Error('synthetic observer failure'); });
  assert.equal(f.dbManager.updateObjectById(KeeperApp, f.appId, { version: '2.6.4-fixture' }), true);
  assert.equal(f.nativeRealm().objectForPrimaryKey(KeeperApp, f.appId).version, '2.6.4-fixture');
  assert.deepEqual(f.diagnostics, ['Error']);
}));
