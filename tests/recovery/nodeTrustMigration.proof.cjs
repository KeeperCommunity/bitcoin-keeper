// Opt-in host proof: genuine encrypted Realm files, actual old/current schemas
// and the production migration callback. This is not a mobile upgrade/UI test.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { test, after } = require('node:test');
const ts = require('typescript');
const { Realm, sourceLoader, declarations, evaluate, plain } =
  require('./automaticWriteRealmRelay.fixture.cjs');
const { certificates } = require('../electrum/fixtures.cjs');
const history = require('./fixtures/realm109-node-source.json');

const root = path.resolve(__dirname, '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const historical = new Map(history.files.map((entry) => [entry.path, entry]));
assert.equal(history.commit, '2b6c3ce56857b5dc92f17cc37453ff308d5a3ae8');
assert.equal(history.realm_schema_version, 109);
assert.equal(require('realm/package.json').version, history.realm_package);
assert.equal(require('../../package.json').dependencies.realm, history.realm_package);

function oldSource(file) {
  const expected = historical.get(file);
  assert.ok(expected, 'Only the recorded historical schema dependency closure may load');
  const bytes = git('show', history.commit + ':' + file);
  assert.equal(digest(bytes), expected.sha256);
  assert.equal(git('rev-parse', history.commit + ':' + file).toString().trim(), expected.git_blob);
  return bytes.toString('utf8');
}

function oldSchemas() {
  const cache = new Map();
  function load(file) {
    const name = [file, file + '.ts', file + '/index.ts'].find((item) => historical.has(item));
    assert.ok(name, 'Historical schema import is outside the recorded closure');
    if (cache.has(name)) return cache.get(name).exports;
    const module = { exports: {} };
    cache.set(name, module);
    const code = ts.transpileModule(oldSource(name), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const requireSchema = (request) => {
      if (request === 'realm') return Realm;
      const target = request.startsWith('.') ?
        path.posix.normalize(path.posix.join(path.posix.dirname(name), request)) : request;
      return load(target);
    };
    vm.runInNewContext('(function(require,module,exports){' + code + '\n})',
      { JSON, Date, Buffer, Uint8Array, ArrayBuffer }, { filename: name })
      (requireSchema, module, module.exports);
    return module.exports;
  }
  // This is the actual historical source, not a current schema with a field removed.
  const schema = load('src/storage/realm/schema').default;
  const realmSource = ts.createSourceFile('realm.ts',
    oldSource('src/storage/realm/realm.ts'), ts.ScriptTarget.Latest, true);
  const database = realmSource.statements.find((node) =>
    ts.isClassDeclaration(node) && node.name?.text === 'RealmDatabase');
  const version = database.members.find((node) => node.name?.getText(realmSource) === 'schemaVersion');
  assert.equal(version.initializer.getText(realmSource), '109');
  for (const name of ['NodeConnect', 'DefaultNodeConnect'])
    assert.equal(Object.hasOwn(schema.find((item) => item.name === name).properties, 'tlsCa'), false);
  return schema;
}

function currentDatabase() {
  for (const file of ['src/storage/realm/realm.ts', 'src/storage/realm/migrations.ts',
    ...history.files.map((entry) => entry.path).filter((file) => file !== 'src/storage/realm/realm.ts')])
    assert.deepEqual(fs.readFileSync(path.join(root, file)), git('show', 'HEAD:' + file));
  const migration = {};
  // Execute the actual declaration. No pre-109 legacy branch is replaced.
  evaluate(declarations('src/storage/realm/migrations.ts', ['runRealmMigrations']),
    migration, 'actual-production-realm-migrations.ts');
  const calls = [];
  const load = sourceLoader({
    realm: Realm,
    'src/services/sentry': { captureError(error) { throw error; } },
    'src/services/backup/localSnapshot': {
      captureLocalRecovery() { throw new Error('Recovery snapshot is outside this migration proof'); },
    },
    'src/storage/realm/migrations': {
      runRealmMigrations(args) {
        calls.push([args.oldRealm.schemaVersion, args.newRealm.schemaVersion]);
        assert.deepEqual(calls.at(-1), [109, 110]);
        migration.runRealmMigrations(args);
      },
    },
  });
  const { RealmDatabase } = load('src/storage/realm/realm');
  assert.equal(RealmDatabase.schemaVersion, 110);
  return { database: new RealmDatabase(), calls };
}

const records = [
  { id: 101, host: 'private-node.fixture.invalid', port: '50002', useKeeperNode: false,
    isConnected: true, useSSL: true, networkType: 'TESTNET' },
  { id: 102, host: 'a'.repeat(56) + '.onion', port: '50001', useKeeperNode: false,
    isConnected: true, useSSL: false, networkType: 'MAINNET' },
  { id: 103, host: 'private-node.fixture.invalid', port: '50003', useKeeperNode: false,
    isConnected: false, useSSL: true, networkType: 'TESTNET' },
];
const defaultNode = { id: 201, host: 'keeper.fixture.invalid', port: '50002',
  useKeeperNode: true, isConnected: false, useSSL: true, networkType: 'TESTNET' };
const fixtures = [];
let tls;
function expectedNodes(ca = null) {
  return records.map((record) => ({ ...record, tlsCa: record.id === 101 ? ca : null }));
}
async function fixture() {
  const current = currentDatabase();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-realm109-trust-'));
  const filename = path.join(directory, 'keeper.realm');
  const key = crypto.randomBytes(64);
  const result = { directory, filename, key, ...current };
  fixtures.push(result);
  const old = await Realm.open({ path: filename, encryptionKey: key,
    schema: oldSchemas(), schemaVersion: 109 });
  try {
    assert.equal(old.schemaVersion, 109);
    old.write(() => {
      for (const record of records) old.create('NodeConnect', record);
      old.create('DefaultNodeConnect', defaultNode);
    });
    assert.deepEqual(plain(old.objects('NodeConnect')), records);
  } finally { old.close(); }
  result.open = async () => {
    assert.equal((await current.database.initializeDatabase(key, filename)).success, true);
    return current.database.getDatabase();
  };
  result.close = () => current.database.closeDatabase();
  await result.open();
  assert.deepEqual(current.calls, [[109, 110]]);
  return result;
}
after(() => {
  for (const item of fixtures) {
    item.close();
    fs.rmSync(item.directory, { recursive: true, force: true });
  }
  Realm.shutdown();
  tls?.cleanup();
});

test('actual encrypted schema109 migrates to110 with selected private/onion/default identities intact', async () => {
  const f = await fixture();
  const realm = f.database.getDatabase();
  assert.equal(realm.schemaVersion, 110);
  assert.deepEqual(plain(realm.objects('NodeConnect')), expectedNodes());
  assert.deepEqual(plain(realm.objects('DefaultNodeConnect')), [{ ...defaultNode, tlsCa: null }]);
  f.close();
  const reopened = await f.open();
  assert.deepEqual(plain(reopened.objects('NodeConnect')), expectedNodes());
  assert.deepEqual(f.calls, [[109, 110]], 'Reopening110 must not run109 migration again');
});

test('a newly supplied real public CA persists after migration/reopen without leaking to another endpoint', async () => {
  tls ||= certificates();
  const ca = tls.read('root.pem');
  const f = await fixture();
  const realm = f.database.getDatabase();
  realm.write(() => { realm.objects('NodeConnect').filtered('id == 101')[0].tlsCa = ca; });
  f.close();
  const reopened = await f.open();
  assert.deepEqual(plain(reopened.objects('NodeConnect')), expectedNodes(ca));
  assert.equal(reopened.objects('DefaultNodeConnect')[0].tlsCa, null);
  assert.equal(reopened.objects('NodeConnect').filtered('networkType == "MAINNET"')[0].useSSL, false);
});

test('two genuinely migrated encrypted files keep the same-endpoint custom trust isolated', async () => {
  tls ||= certificates();
  const first = await fixture();
  const second = await fixture();
  first.database.getDatabase().write(() => {
    first.database.getDatabase().objects('NodeConnect').filtered('id == 101')[0].tlsCa = tls.read('root.pem');
  });
  first.close(); second.close();
  assert.deepEqual(plain((await first.open()).objects('NodeConnect')), expectedNodes(tls.read('root.pem')));
  assert.deepEqual(plain((await second.open()).objects('NodeConnect')), expectedNodes());
});

test('wrong or omitted encryption keys cannot open or reset the migrated node/trust data', async () => {
  tls ||= certificates();
  const ca = tls.read('root.pem');
  const f = await fixture();
  f.database.getDatabase().write(() => {
    f.database.getDatabase().objects('NodeConnect').filtered('id == 101')[0].tlsCa = ca;
  });
  f.close();
  const wrong = Buffer.from(f.key); wrong[0] ^= 255;
  await assert.rejects(Realm.open({ path: f.filename, encryptionKey: wrong, readOnly: true }));
  await assert.rejects(Realm.open({ path: f.filename, readOnly: true }));
  assert.deepEqual(plain((await f.open()).objects('NodeConnect')), expectedNodes(ca));
  assert.deepEqual(f.calls, [[109, 110]]);
});
