// Separate opt-in protected-protocol proof. The public v2 lane and its pins stay
// independent. This guard contains only reviewed identities, never backend code.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const BACKEND_COMMIT = '7693ce4bfffcadb5fb71d6478a8befc8e533a844';
const BACKEND_FILES = Object.freeze({
  'package.json': '091bbd47dc459a13276b9dee0122b54ef002c45442771b0d06a408d013ea9988',
  'yarn.lock': 'b989c1197f6ddc9530d400a354bab42af8974ac4687f0ba0a178cb2f787b0321',
  'src/services/protectedBackupAuth.ts': 'b45fbfe0b1481a52a0158b9cbca79a619e14484e254064ef8efb5155ddfa7ecf',
  'src/services/protectedBackup.ts': '087f2d5190d9bcd68ba3a529712d7ca60b06fd487f1f021c0c4907ebd6235a76',
  'src/routes/protectedBackup.ts': '6eb2f8ba2c70cc459c88068f81a6dae2e6efa507468c84cafb2a7508fb78bcfb',
  'src/routes/routes.ts': '245fec3b717fab83957bc1690cd9d76395c031b0c2525414846ba55081ec2183',
  'src/services/backupSnapshot.ts': '3c097222970c88d1d9af154c6cc50bf532f0d1559050af65fafecf2aa59ac187',
  'src/services/bhr.ts': '72736ddaca020d293adee9b430343493e07123dfbc54b301914e5d766092df15',
  'src/db.ts': '52455dc9472a713afc538189db541ced108e1a0dcb4246b824da0bff120f8992',
  'tests/support/protectedBackupFixture.cjs': '3ce114525e34bea75e515df596b10da82a73becadc253e2ecae223cf3d37d38c',
  'tests/support/protectedBackupClient.cjs': 'dee3441f65defc0cd5dbbc282bc179210edfa7b544b4db41e501468bece8022f',
  'tests/disposableMongo.cjs': 'a9dd8d12f37aafef09003ef47369cb7416692fd07e28ad96c25a0533cf99ee96',
});

function supportedNode(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return !!match && Number(match[1]) === 22 &&
    (Number(match[2]) > 23 || (Number(match[2]) === 23 && Number(match[3]) >= 3));
}

function disposableMongoUrl(value) {
  const url = new URL(value || 'mongodb://127.0.0.1:27038');
  assert.equal(url.protocol, 'mongodb:', 'Use a disposable loopback MongoDB replica');
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Hosted MongoDB is forbidden in this proof');
  assert.equal(url.port, '27038', 'Use the separately approved keeperQA fixture on port 27038');
  assert.ok(!url.username && !url.password, 'This proof does not accept credentials');
  assert.ok(['', '/'].includes(url.pathname) && !url.search && !url.hash,
    'Pass only the loopback server address; the fixture chooses its own database');
  return url.toString();
}

function checkedBackend(checkout) {
  assert.ok(checkout, 'Set KEEPER_PROTECTED_RELAY_CHECKOUT to the separately obtained exact reviewed backend checkout');
  const directory = fs.realpathSync(checkout);
  const git = (...arguments_) => spawnSync('git', ['-C', directory, ...arguments_], { encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD');
  assert.equal(head.status, 0, 'The protected fixture must be in a Git checkout');
  assert.equal(head.stdout.trim(), BACKEND_COMMIT, `Use exact reviewed backend ${BACKEND_COMMIT}`);
  assert.equal(git('diff', '--quiet', 'HEAD').status, 0, 'The reviewed backend must have no tracked changes');
  for (const [relative, expected] of Object.entries(BACKEND_FILES)) {
    const filename = path.join(directory, relative);
    assert.equal(fs.realpathSync(filename), filename, 'The fixed backend inputs must not be symlink aliases');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), expected,
      `Reviewed backend input differs: ${relative}`);
  }
  const requireBackend = createRequire(path.join(directory, 'package.json'));
  for (const [name, version] of [['mongoose', '5.13.20'], ['mongodb', '3.7.4']])
    assert.equal(requireBackend(`${name}/package.json`).version, version, 'Use the reviewed frozen native driver lane');
  return directory;
}

function nativeRealmPrerequisite() {
  const Realm = require('realm');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-protected-realm-prerequisite-'));
  const filename = path.join(directory, 'probe.realm');
  const options = { path: filename, encryptionKey: Buffer.alloc(64, 7),
    schema: [{ name: 'NativeProbe', primaryKey: 'id', properties: { id: 'string', value: 'int' } }] };
  let realm;
  try {
    realm = new Realm(options);
    realm.write(() => realm.create('NativeProbe', { id: 'native', value: 1 }));
    realm.close();
    realm = new Realm(options);
    assert.equal(realm.objectForPrimaryKey('NativeProbe', 'native').value, 1,
      'Actual native encrypted Realm must commit and reopen');
  } finally {
    if (realm && !realm.isClosed) realm.close();
    Realm.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function main() {
  assert.ok(supportedNode(process.versions.node), 'Use Node22.23.3 or a later22.x patch for the protected proof');
  const checkout = checkedBackend(process.env.KEEPER_PROTECTED_RELAY_CHECKOUT);
  const mongo = disposableMongoUrl(process.env.BACKUP_TEST_MONGO_URL);
  nativeRealmPrerequisite();
  const app = path.resolve(__dirname, '..');
  const test = 'tests/recovery/protectedWriteRealmRelay.proof.cjs';
  assert.ok(fs.existsSync(path.join(app, test)), 'Missing separate protected production proof');
  const result = spawnSync(process.execPath, ['--test', test], {
    cwd: app, stdio: 'inherit', env: { ...process.env,
      KEEPER_PROTECTED_RELAY_CHECKOUT: checkout, BACKUP_TEST_MONGO_URL: mongo },
  });
  process.exitCode = result.status ?? 1;
}

module.exports = { BACKEND_COMMIT, BACKEND_FILES, supportedNode, disposableMongoUrl, checkedBackend };
if (require.main === module) main();
