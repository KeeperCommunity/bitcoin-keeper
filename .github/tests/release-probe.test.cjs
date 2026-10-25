/* Host-only orchestration tests. This model supplies NO native platform evidence. */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runProbe, PHASE_KEY, MARKER_KEY, PRIMARY, OTHER, ROLLBACK } = require('../native/release_probe_core');

function fixture(bugs = {}) {
  const disk = new Map();
  const values = new Map([['unrelated-storage-key', 'preserve']]);
  const handles = new Set();
  const storage = {
    getString: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    deleteItem: (key) => values.delete(key),
  };
  const Realm = {
    defaultPath: '/synthetic-device/default.realm',
    async open(config) {
      const key = config.encryptionKey[0];
      if (!disk.has(config.path)) disk.set(config.path, { key, wallets: new Map() });
      const file = disk.get(config.path);
      if (key !== file.key && !bugs.acceptWrongKey) throw new Error('modeled wrong key');
      const handle = {
        objectForPrimaryKey: (_table, id) => file.wallets.get(id),
        objects: () => [...file.wallets.values()],
        write(callback) {
          const before = structuredClone(file.wallets);
          try {
            callback();
          } catch (error) {
            if (!bugs.skipRollback) file.wallets = before;
            throw error;
          }
        },
        create(_table, value) { file.wallets.set(value.id, structuredClone(value)); },
        delete(value) { if (!bugs.skipDelete) file.wallets.delete(value.id); },
        close() { handles.delete(handle); },
      };
      handles.add(handle);
      return handle;
    },
    deleteFile(config) {
      if (bugs.cleanupFailure) throw new Error('modeled cleanup failure');
      disk.delete(config.path);
    },
  };
  return {
    options: { Realm, schema: [], storage }, disk, values, handles,
    a: () => disk.get('/synthetic-device/keeper-ci-release-probe-v1-a.realm'),
  };
}

test('three process phases require persisted state and clean only disposable fixture', async () => {
  const state = fixture();
  assert.equal(await runProbe(state.options), 'seeded');
  assert.equal(state.handles.size, 0);
  assert.equal(state.values.get(PHASE_KEY), 'seeded');
  assert.equal(await runProbe(state.options), 'mutated');
  assert.equal(state.handles.size, 0);
  assert.equal(state.a().wallets.has(PRIMARY), false);
  assert.equal(state.a().wallets.has(OTHER), true);
  assert.equal(state.a().wallets.has(ROLLBACK), false);
  assert.equal(await runProbe(state.options), 'pass');
  assert.equal(state.handles.size, 0);
  assert.equal(state.disk.size, 0);
  assert.deepEqual([...state.values], [['unrelated-storage-key', 'preserve']]);
});

test('missing persisted MMKV marker cannot progress after relaunch', async () => {
  const state = fixture();
  await runProbe(state.options);
  state.values.delete(MARKER_KEY);
  await assert.rejects(runProbe(state.options), { code: 'mmkv-marker-not-persisted' });
  assert.equal(state.values.get(PHASE_KEY), 'seeded');
  assert.equal(state.handles.size, 0);
});

test('wrong-key acceptance fails closed before wallet deletion', async () => {
  const state = fixture({ acceptWrongKey: true });
  await runProbe(state.options);
  await assert.rejects(runProbe(state.options), { code: 'wrong-encryption-key-accepted' });
  assert.equal(state.a().wallets.has(PRIMARY), true);
  assert.equal(state.handles.size, 0);
});

test('corruption of embedded wallet balances cannot pass', async () => {
  const state = fixture();
  await runProbe(state.options);
  state.a().wallets.get(OTHER).specs.balances.confirmed = 1;
  await assert.rejects(runProbe(state.options), { code: 'embedded-wallet-state-not-persisted' });
  assert.equal(state.values.get(PHASE_KEY), 'seeded');
  assert.equal(state.handles.size, 0);
});

test('failed transaction rollback cannot progress', async () => {
  const state = fixture({ skipRollback: true });
  await runProbe(state.options);
  await assert.rejects(runProbe(state.options), { code: 'transaction-rollback-failed' });
  assert.equal(state.values.get(PHASE_KEY), 'seeded');
  assert.equal(state.handles.size, 0);
});

test('failed deletion cannot advance persistence marker', async () => {
  const state = fixture({ skipDelete: true });
  await runProbe(state.options);
  await assert.rejects(runProbe(state.options), { code: 'targeted-wallet-delete-failed' });
  assert.equal(state.values.get(PHASE_KEY), 'seeded');
  assert.equal(state.handles.size, 0);
});

test('lost deletion after second relaunch cannot pass', async () => {
  const state = fixture();
  await runProbe(state.options);
  const original = structuredClone(state.a().wallets.get(PRIMARY));
  await runProbe(state.options);
  state.a().wallets.set(PRIMARY, original);
  await assert.rejects(runProbe(state.options), { code: 'unexpected-primary-record-count' });
  assert.equal(state.values.get(PHASE_KEY), 'mutated');
  assert.equal(state.handles.size, 0);
});

test('fixture cleanup failure cannot produce pass', async () => {
  const state = fixture({ cleanupFailure: true });
  await runProbe(state.options);
  await runProbe(state.options);
  await assert.rejects(runProbe(state.options), /modeled cleanup failure/);
  assert.equal(state.values.get(PHASE_KEY), 'mutated');
  assert.equal(state.handles.size, 0);
});

test('unknown phase stops before accessing native databases', async () => {
  const state = fixture();
  state.values.set(PHASE_KEY, 'unexpected');
  await assert.rejects(runProbe(state.options), { code: 'invalid-phase' });
  assert.equal(state.disk.size, 0);
});
