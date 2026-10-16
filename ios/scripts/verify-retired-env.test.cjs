const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const verifier = path.join(__dirname, 'verify-retired-env.rb');
const reader = process.env.KEEPER_TEST_RN_CONFIG_READER ||
  path.join(__dirname, '..', '..', 'node_modules', 'react-native-config', 'ios', 'ReactNativeConfig');
const secret = 'synthetic-secret-not-for-output';
const retiredNames = ['GASFREE_API_KEY', 'GASFREE_API_SECRET', 'LETS_EXCHANGE_API_KEY'];
retiredNames.push(...retiredNames.map(name => `RN_${name}`));

function verify(contents, additionalEnv = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-ios-env-'));
  try {
    const envFile = path.join(directory, '.env.test');
    fs.writeFileSync(envFile, contents);
    return spawnSync('ruby', [verifier, reader, directory], {
      cwd: directory,
      env: { PATH: process.env.PATH, ENVFILE: envFile, ...additionalEnv },
      encoding: 'utf8',
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('iOS pod guard accepts config without retired credentials', () => {
  assert.ok(fs.existsSync(reader), 'Install react-native-config before running this test');
  const result = verify('CHANNEL_URL=https://channel.bitcoinkeeper.app/\n');
  assert.equal(result.status, 0, result.stderr);
});

for (const name of retiredNames) {
  test(`iOS pod guard rejects ${name} in selected ENVFILE before logging its value`,
    () => {
      const result = verify(`CHANNEL_URL=https://channel.bitcoinkeeper.app/\n${name}=${secret}\n`);
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret-not-for-output/);
    });
}

test('iOS pod guard rejects exported retired credentials', () => {
  const result = verify(`export GASFREE_API_KEY=${secret}\n`);
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret-not-for-output/);
});

test('iOS pod guard rejects a retired process variable before logging its value',
  () => {
    const result = verify('CHANNEL_URL=https://channel.bitcoinkeeper.app/\n', {
      RN_GASFREE_API_SECRET: secret,
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret-not-for-output/);
  });

test('iOS production codegen rejects a conflicting envfile selector', () => {
  assert.ok(fs.existsSync(reader), 'Install react-native-config before running this test');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-ios-production-env-'));
  try {
    const production = path.join(directory, '.env.production');
    const selector = path.join(directory, 'envfile-selector');
    fs.writeFileSync(production, 'CHANNEL_URL=https://channel.bitcoinkeeper.app/\n');
    fs.writeFileSync(selector, path.join(directory, 'unreviewed.env'));
    const result = spawnSync('ruby', [verifier, reader, directory, selector], {
      cwd: directory,
      env: { PATH: process.env.PATH, ENVFILE: production },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /environment differs from the reviewed/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('iOS production codegen accepts matching or absent envfile selector', () => {
  assert.ok(fs.existsSync(reader), 'Install react-native-config before running this test');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-ios-production-env-'));
  try {
    const production = path.join(directory, '.env.production');
    const selector = path.join(directory, 'envfile-selector');
    fs.writeFileSync(production, 'CHANNEL_URL=https://channel.bitcoinkeeper.app/\n');
    for (const selectorContents of [null, production]) {
      if (selectorContents === null) fs.rmSync(selector, { force: true });
      else fs.writeFileSync(selector, selectorContents);
      const result = spawnSync('ruby', [verifier, reader, directory, selector], {
        cwd: directory,
        env: { PATH: process.env.PATH, ENVFILE: production },
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
