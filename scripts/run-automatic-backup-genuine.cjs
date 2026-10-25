// This matrix requires the pinned paired Relay, a real native Realm binding
// and disposable loopback Mongo. Missing prerequisites are a failing check.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const relaySha = '838049e537e07eb646a2a0393eb969fba43d0739';
const root = path.resolve(__dirname, '..');
const fixture = process.env.KEEPER_RELAY_FIXTURE_MODULE;
assert.equal(process.versions.node.split('.')[0], '22', 'Run the genuine automatic backup matrix with Node 22');
assert.ok(fixture, 'Set KEEPER_RELAY_FIXTURE_MODULE to the pinned Relay tests/support/automaticBackupHttpFixture.cjs');
const filename = fs.realpathSync(fixture);
const checkout = path.dirname(path.dirname(path.dirname(filename)));
assert.equal(path.relative(checkout, filename), 'tests/support/automaticBackupHttpFixture.cjs');
const revision = spawnSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
assert.equal(revision.status, 0, 'The Relay fixture must be in a Git checkout');
assert.equal(revision.stdout.trim(), relaySha, `Use paired Relay commit ${relaySha}`);
const clean = spawnSync('git', ['-C', checkout, 'diff', '--quiet', 'HEAD'], { encoding: 'utf8' });
assert.equal(clean.status, 0, 'The pinned Relay checkout must have no tracked changes');

const mongoUrl = new URL(process.env.BACKUP_TEST_MONGO_URL || 'mongodb://127.0.0.1:27058');
assert.equal(mongoUrl.protocol, 'mongodb:');
assert.ok(['127.0.0.1', 'localhost'].includes(mongoUrl.hostname), 'The matrix only accepts loopback Mongo');
assert.equal(mongoUrl.port, '27058', 'Use the disposable keeperQA replica set on port 27058');
assert.ok(!mongoUrl.username && !mongoUrl.password, 'The disposable matrix does not accept credentials');

const Realm = require('realm');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-native-realm-prerequisite-'));
let probe;
try {
  probe = new Realm({
    path: path.join(directory, 'probe.realm'), inMemory: true,
    schema: [{ name: 'NativeProbe', primaryKey: 'id', properties: { id: 'string', value: 'int' } }],
  });
  probe.write(() => probe.create('NativeProbe', { id: 'native', value: 1 }));
  assert.equal(probe.objectForPrimaryKey('NativeProbe', 'native').value, 1);
} finally {
  probe?.close();
  Realm.shutdown();
  fs.rmSync(directory, { recursive: true, force: true });
}

const matrices = fs.readdirSync(path.join(root, 'tests/recovery'))
  .filter(filename => filename.endsWith('.integration.cjs')).sort();
for (const required of ['automaticWriteRealmRelay.integration.cjs',
  'automaticLabelProducers.integration.cjs', 'automaticUpgradeProducer.integration.cjs',
  'automaticWalletProducer.integration.cjs', 'automaticUSDTProducer.integration.cjs',
  'automaticSignerProducer.integration.cjs', 'automaticRecoveryRestore.integration.cjs'])
  assert.ok(matrices.includes(required), `Missing genuine production matrix ${required}`);
const result = spawnSync(process.execPath, ['--test', ...matrices.map(filename => `tests/recovery/${filename}`)], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, KEEPER_RELAY_FIXTURE_MODULE: filename, BACKUP_TEST_MONGO_URL: mongoUrl.toString() },
});
process.exit(result.status ?? 1);
