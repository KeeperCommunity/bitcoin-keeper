// Supplemental #7066 upgrade regression against the current selected Relay.
// Keep the historical proof runner and its reviewed source pins unchanged.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const historical = require('./run-protected-backup-genuine.cjs');

const BACKEND_COMMIT = '29597b27eeeb299205bf7d0555db0a90c38cc4be';
// Every other fixture input is byte-identical to the historical reviewed pin.
const BACKEND_FILES = Object.freeze({ ...historical.BACKEND_FILES,
  'src/services/protectedBackup.ts': '1487da3778fcc39efc7d453e5ddcbb944d3b8c2912c04632dbb3076f761decd4',
});

function checkedCurrentBackend(checkout) {
  assert.ok(checkout, 'Set KEEPER_PROTECTED_RELAY_CHECKOUT to the exact current Relay checkout');
  const directory = fs.realpathSync(checkout);
  const git = (...args) => spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
  const head = git('rev-parse', 'HEAD');
  assert.equal(head.status, 0, 'The current Relay fixture must be a Git checkout');
  assert.equal(head.stdout.trim(), BACKEND_COMMIT, `Use current Relay ${BACKEND_COMMIT}`);
  assert.equal(git('diff', '--quiet', 'HEAD').status, 0, 'Current Relay tracked files must be clean');
  for (const [relative, expected] of Object.entries(BACKEND_FILES)) {
    const filename = path.join(directory, relative);
    assert.equal(fs.realpathSync(filename), filename, 'Fixed Relay inputs must not be symlink aliases');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), expected,
      `Current Relay input differs: ${relative}`);
  }
  const requireBackend = createRequire(path.join(directory, 'package.json'));
  for (const [name, version] of [['mongoose', '5.13.20'], ['mongodb', '3.7.4']])
    assert.equal(requireBackend(`${name}/package.json`).version, version, 'Use frozen native driver inputs');
  return directory;
}

// The fixture imports its admission function through this module export. Only
// admission changes: production app/backend code, crypto, HTTP and Realm stay real.
// This opt-in process never updates the historical runner or production config.
historical.checkedBackend = checkedCurrentBackend;

function main() {
  assert.ok(historical.supportedNode(process.versions.node), 'Use Node22.23.3 or a later22.x patch');
  const checkout = checkedCurrentBackend(process.env.KEEPER_PROTECTED_RELAY_CHECKOUT);
  const mongo = historical.disposableMongoUrl(process.env.BACKUP_TEST_MONGO_URL);
  const app = path.resolve(__dirname, '..');
  const test = path.join(app, 'tests/recovery/protectedUpgrade7066.proof.cjs');
  assert.ok(fs.existsSync(test), 'Missing focused protected-upgrade regression');
  const result = spawnSync(process.execPath, ['--require', __filename, '--test', test], {
    cwd: app, stdio: 'inherit', env: { ...process.env,
      KEEPER_PROTECTED_RELAY_CHECKOUT: checkout, BACKUP_TEST_MONGO_URL: mongo },
  });
  process.exitCode = result.status ?? 1;
}

module.exports = { BACKEND_COMMIT, BACKEND_FILES, checkedCurrentBackend };
if (require.main === module) main();
