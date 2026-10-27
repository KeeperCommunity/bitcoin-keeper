'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { NAMES } = require('../native/relay_reader_app.cjs');
const { childEnvironment } = require('../../scripts/protected-release-worker.cjs');
const root = path.resolve(__dirname, '../..');
const app = { KEEPER_RELAY_READER_APP_ID: '10', KEEPER_RELAY_READER_INSTALLATION_ID: '20',
  KEEPER_RELAY_READER_PRIVATE_KEY: 'DISPOSABLE_APP_KEY' };
function child(env) {
  return JSON.parse(execFileSync('python3', ['-c', 'import json,os; print(json.dumps(dict(os.environ)))'],
    { env, encoding: 'utf8' }));
}
test('canonical workflow removes the captured App identity before its raw source subprocesses', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/keeper-canonical-native.yml'), 'utf8');
  const prefix = workflow.slice(workflow.indexOf('const privateEnv ='),
    workflow.indexOf('// Pinned source bootstrap:', workflow.indexOf('const privateEnv =')));
  assert(prefix.includes('delete process.env.KEEPER_RELAY_READER_PRIVATE_KEY'));
  const env = { PATH: process.env.PATH, ...app, KEEPER_CANONICAL_PIN_READ_TOKEN: 'DISPOSABLE_PIN',
    KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN: 'DISPOSABLE_PAT' };
  const result = new Function('process', prefix + '\nreturn privateEnv;')({ env });
  for (const key of NAMES) { assert.equal(result[key], app[key]); assert.equal(env[key], undefined); }
  const observed = child(env);
  for (const key of [...NAMES, 'KEEPER_CANONICAL_PIN_READ_TOKEN', 'KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN'])
    assert.equal(observed[key], undefined, key);
});
test('protected worker captures App fields while excluding them from source and native environments', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/keeper-protected-release-workers.yml'), 'utf8');
  const prefix = workflow.slice(workflow.indexOf('const stepEnv ='), workflow.indexOf("const fs = require('node:fs')"));
  assert(prefix.includes('const privateEnv'));
  const env = { PATH: process.env.PATH, ...app, KEEPER_CANONICAL_PIN_READ_TOKEN: 'DISPOSABLE_PIN',
    KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN: 'DISPOSABLE_PAT', KEEPER_ANDROID_KEYSTORE_BASE64: 'DISPOSABLE_ANDROID' };
  const result = new Function('process', prefix + '\nreturn { privateEnv, stepEnv };')({ env });
  for (const key of NAMES) { assert.equal(result.privateEnv[key], app[key]); assert.equal(result.stepEnv[key], undefined); }
  const source = child(env), native = child(childEnvironment(result.stepEnv, 'android-signed-build'));
  for (const key of [...NAMES, 'KEEPER_CANONICAL_PIN_READ_TOKEN', 'KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN']) {
    assert.equal(source[key], undefined, key); assert.equal(native[key], undefined, key);
  }
  assert.equal(source.KEEPER_ANDROID_KEYSTORE_BASE64, undefined);
  assert.equal(native.KEEPER_ANDROID_KEYSTORE_BASE64, 'DISPOSABLE_ANDROID');
});
test('every worker SDK step supplies the complete App tuple without adding it to job-wide environment', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/keeper-protected-release-workers.yml'), 'utf8');
  const count = workflow.match(/^          KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN:/gm).length;
  for (const key of NAMES) assert.equal(workflow.match(new RegExp('^          ' + key + ':', 'gm')).length, count, key);
  assert(!/^      KEEPER_RELAY_READER_PRIVATE_KEY:/m.test(workflow));
});
