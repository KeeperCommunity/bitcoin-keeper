// Opt-in genuine host Realm regression. Requires installed realm.node; never native iOS/Android evidence.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const generator = require('../native/r52_realm109_prepare.cjs');
const core = require('../native/r52_realm109_core.js');
const { Realm, sourceLoader, declarations, evaluate } = require('../../tests/recovery/automaticWriteRealmRelay.fixture.cjs');
const root = path.resolve(__dirname, '../..');
const temporary = [];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
function checkout() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-realm109-contract-')); temporary.push(directory);
  git(directory, 'init', '-q');
  fs.writeFileSync(path.join(directory, '.git/objects/info/alternates'), git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'objects') + '\n');
  git(directory, 'update-ref', 'refs/heads/fixture', git(root, 'rev-parse', 'HEAD'));
  git(directory, 'symbolic-ref', 'HEAD', 'refs/heads/fixture');
  for (const name of ['tests/recovery/fixtures/realm109-node-source.json', 'package.json']) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    fs.copyFileSync(path.join(root, name), path.join(directory, name));
  }
  return directory;
}
function generated() {
  const directory = checkout(), receipt = generator.prepare(directory, 'IOS');
  const base = path.join(directory, generator.DESTINATION);
  return { directory, receipt, base, config: JSON.parse(fs.readFileSync(path.join(base, 'config.json'))),
    oldSchema: require(path.join(base, 'src/storage/realm/schema/index.js')).default };
}
after(() => { Realm.shutdown(); temporary.forEach(directory => fs.rmSync(directory, { recursive: true, force: true })); });

function current() {
  const migration = {};
  evaluate(declarations('src/storage/realm/migrations.ts', ['runRealmMigrations']), migration, 'actual-production-migration.ts');
  const calls = [];
  const load = sourceLoader({ realm: Realm,
    'src/services/sentry': { captureError(error) { throw error; } },
    'src/services/backup/localSnapshot': { captureLocalRecovery() { throw new Error('Snapshot outside fixture'); } },
    'src/storage/realm/migrations': { runRealmMigrations(args) {
      calls.push([args.oldRealm.schemaVersion, args.newRealm.schemaVersion]); migration.runRealmMigrations(args);
    } },
  });
  return { RealmDatabase: load('src/storage/realm/realm').RealmDatabase,
    schema: load('src/storage/realm/schema').default, calls };
}
test('host real encrypted Realm exercises the same fixture core and production109to110 callback', async () => {
  const value = generated(), production = current();
  const result = await core.run({ Realm, ...production, oldSchema: value.oldSchema, config: value.config,
    directory: value.directory, randomBytes: length => crypto.randomBytes(length) });
  assert.equal(result.status, 'PASS'); assert.deepEqual(result.cases.map(row => row.id), core.CASES);
  assert.deepEqual(production.calls, [[109, 110]]);
});
test('a current schema masquerading as historical109 cannot enter the native fixture', async () => {
  const value = generated(), production = current();
  await assert.rejects(core.run({ Realm, ...production, oldSchema: production.schema, config: value.config,
    directory: value.directory, randomBytes: length => crypto.randomBytes(length) }), /OLD_SCHEMA/);
});
test('a failed production initializer cannot be counted as migration evidence', async () => {
  const value = generated(), production = current();
  class Failed { static schemaVersion = 110; async initializeDatabase() { return { success: false }; } }
  await assert.rejects(core.run({ Realm, ...production, RealmDatabase: Failed, oldSchema: value.oldSchema,
    config: value.config, directory: value.directory, randomBytes: length => crypto.randomBytes(length) }), /INITIALIZE/);
});
