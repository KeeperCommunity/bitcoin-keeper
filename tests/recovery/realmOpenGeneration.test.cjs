const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const opens = [];
  const deletes = [];
  const errors = [];
  const Realm = {
    open: (config) => {
      const pending = deferred();
      opens.push({ config, ...pending });
      return pending.promise;
    },
    deleteFile: (config) => deletes.push(config.path),
  };
  const { RealmDatabase } = loadModule(
    'src/storage/realm/realm.ts',
    {
      realm: { default: Realm, __esModule: true },
      'src/services/sentry': { captureError: (error) => errors.push(error) },
      // These tests prove only open/close races; the fake handles intentionally
      // provide no recovery content or post-commit generation evidence.
      'src/services/backup/localSnapshot': { captureLocalRecovery() {
        throw new Error('Recovery content unavailable in open-race fixture');
      } },
      './schema': { default: [], __esModule: true },
      './migrations': { runRealmMigrations() {} },
      './enum': { RealmSchema: {} },
    },
    { console: { log() {} } }
  );
  RealmDatabase.file = 'keeper.realm';
  const db = new RealmDatabase();
  const handle = (name) => ({
    name,
    isClosed: false,
    closeCount: 0,
    close() {
      this.closeCount += 1;
      this.isClosed = true;
    },
  });
  const key = new Uint8Array([1]);
  return { db, RealmDatabase, opens, deletes, errors, handle, key };
}

test('late A open cannot replace newer B or reset its accepted Realm path', async () => {
  const f = fixture();
  const a = f.db.initializeDatabase(f.key, 'A.realm');
  const b = f.db.initializeDatabase(f.key, 'B.realm');
  const aHandle = f.handle('A');
  const bHandle = f.handle('B');
  f.opens[1].resolve(bHandle);
  assert.equal((await b).success, true);
  f.opens[0].resolve(aHandle);
  assert.equal((await a).success, false);
  assert.equal(f.db.getDatabase(), bHandle);
  assert.equal(f.RealmDatabase.file, 'B.realm');
  assert.equal(aHandle.closeCount, 1);
  assert.equal(bHandle.closeCount, 0);
});

test('same-path stale open never closes the Realm handle adopted by latest open', async () => {
  const f = fixture();
  const first = f.db.initializeDatabase(f.key, 'A.realm');
  const latest = f.db.initializeDatabase(f.key, 'A.realm');
  const shared = f.handle('shared');
  f.opens[0].resolve(shared);
  assert.equal((await first).success, false);
  assert.equal(shared.closeCount, 0, 'latest open may resolve to the same native handle');
  f.opens[1].resolve(shared);
  assert.equal((await latest).success, true);
  assert.equal(f.db.getDatabase(), shared);
  assert.equal(shared.closeCount, 0);
});

test('failed new open preserves the active Realm and its path', async () => {
  const f = fixture();
  const first = f.db.initializeDatabase(f.key, 'A.realm');
  const active = f.handle('A');
  f.opens[0].resolve(active);
  assert.equal((await first).success, true);

  const failed = f.db.initializeDatabase(f.key, 'B.realm');
  f.opens[1].reject(new Error('disposable failure'));
  assert.equal((await failed).success, false);
  assert.equal(f.db.getDatabase(), active);
  assert.equal(active.closeCount, 0);
  assert.equal(f.RealmDatabase.file, 'A.realm');
  assert.equal(f.errors.length, 1);
});

test('close and delete invalidate pending opens without adopting their handles', async () => {
  const f = fixture();
  const closing = f.db.initializeDatabase(f.key, 'A.realm');
  f.db.closeDatabase();
  const staleAfterClose = f.handle('stale-close');
  f.opens[0].resolve(staleAfterClose);
  assert.equal((await closing).success, false);
  assert.equal(staleAfterClose.closeCount, 1);
  assert.throws(() => f.db.getDatabase(), /database not initialized/);
  assert.equal(f.RealmDatabase.file, 'keeper.realm');

  const deleting = f.db.initializeDatabase(f.key, 'B.realm');
  assert.equal(f.db.deleteDatabase(f.key), true);
  const staleAfterDelete = f.handle('stale-delete');
  f.opens[1].resolve(staleAfterDelete);
  assert.equal((await deleting).success, false);
  assert.equal(staleAfterDelete.closeCount, 1);
  assert.throws(() => f.db.getDatabase(), /database not initialized/);
  assert.deepEqual(f.deletes, ['keeper.realm']);
});
