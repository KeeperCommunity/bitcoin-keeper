const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const verifier = path.join(__dirname, 'verify-channel-config.cjs');
const prebuild = path.join(__dirname, '..', 'appcenter-pre-build.sh');
const channel = 'CHANNEL_URL=https://channel.bitcoinkeeper.app/\nENVIRONMENT=PRODUCTION\n';

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-usdt-env-'));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('release env accepts reviewed channel without retired credentials', () =>
  withTempDirectory((directory) => {
    const envFile = path.join(directory, '.env.production');
    fs.writeFileSync(envFile, channel);
    const result = spawnSync(process.execPath, [verifier, envFile], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }));

test('direct Android production release requires and selects the reviewed file', () =>
  withTempDirectory((directory) => {
    fs.mkdirSync(path.join(directory, 'scripts'));
    fs.copyFileSync(verifier, path.join(directory, 'scripts', 'verify-channel-config.cjs'));
    const bin = path.join(directory, 'bin');
    fs.mkdirSync(bin);
    const launcher = path.join(bin, 'react-native');
    fs.writeFileSync(launcher, '#!/bin/sh\nprintf "%s|%s" "$ENVFILE" "$*" > selected-env\n');
    fs.chmodSync(launcher, 0o755);
    fs.writeFileSync(path.join(directory, '.env'), channel);
    const command = require('../package.json').scripts.androidProductionRelease;
    const options = {
      cwd: directory,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: 'utf8',
    };
    const missing = spawnSync('sh', ['-c', command], options);
    assert.notEqual(missing.status, 0);
    assert.equal(fs.existsSync(path.join(directory, 'selected-env')), false);

    fs.writeFileSync(path.join(directory, '.env.production'), channel);
    const valid = spawnSync('sh', ['-c', command], options);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(
      fs.readFileSync(path.join(directory, 'selected-env'), 'utf8'),
      '.env.production|run-android --mode=productionRelease'
    );
  }));

for (const [caseName, stage] of [
  ['missing', ''],
  ['development', 'ENVIRONMENT=DEVELOPMENT\n'],
  ['duplicate', 'ENVIRONMENT=PRODUCTION\nENVIRONMENT=PRODUCTION\n'],
]) {
  test(`release env rejects ${caseName} production stage`, () =>
    withTempDirectory((directory) => {
      const envFile = path.join(directory, '.env.production');
      fs.writeFileSync(envFile, `CHANNEL_URL=https://channel.bitcoinkeeper.app/\n${stage}`);
      const result = spawnSync(process.execPath, [verifier, envFile], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Production ENVIRONMENT must be PRODUCTION/);
    }));
}

for (const name of [
  'GASFREE_API_KEY',
  'GASFREE_API_SECRET',
  'RN_GASFREE_API_KEY',
  'LETS_EXCHANGE_API_KEY',
  'RN_LETS_EXCHANGE_API_KEY',
]) {
  test(`release env rejects ${name} without logging its value`, () =>
    withTempDirectory((directory) => {
      const envFile = path.join(directory, '.env.production');
      const secret = 'synthetic-secret-not-for-output';
      fs.writeFileSync(envFile, `${channel}${name}=${secret}\n`);
      const result = spawnSync(process.execPath, [verifier, envFile], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret-not-for-output/);
    }));
}

test('AppCenter rejects retired credential input before writing .env', () =>
  withTempDirectory((directory) => {
    const secret = 'synthetic-secret-not-for-output';
    const result = spawnSync('bash', [prebuild], {
      cwd: directory,
      env: { PATH: process.env.PATH, RN_GASFREE_API_SECRET: secret },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(directory, '.env')), false);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret-not-for-output/);
  }));

test('AppCenter rejects retired swap credential input before writing .env', () =>
  withTempDirectory((directory) => {
    const secret = 'synthetic-secret-not-for-output';
    const result = spawnSync('bash', [prebuild], {
      cwd: directory,
      env: { PATH: process.env.PATH, RN_LETS_EXCHANGE_API_KEY: secret },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(directory, '.env')), false);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret-not-for-output/);
  }));
