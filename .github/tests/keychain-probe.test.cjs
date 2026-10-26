// Host orchestration controls only, never evidence of native Keychain behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runKeychain, SERVICE, USERNAME, FIRST, SECOND } = require('../native/keychain_probe_core');
function fixture() {
  let item = false;
  const calls = [];
  const keychain = {
    ACCESSIBLE: { WHEN_UNLOCKED: 'AccessibleWhenUnlocked' },
    async getGenericPassword(options) { calls.push(['get', options]); return item; },
    async setGenericPassword(username, password, options) {
      calls.push(['set', options]); item = { service: options.service, username, password }; return { service: options.service };
    },
    async resetGenericPassword(options) { calls.push(['reset', options]); item = false; return true; },
  };
  return { keychain, calls, set: value => { item = value; }, get: () => item };
}
test('three logical processes require persisted update and deletion on the explicit synthetic service', async () => {
  const f = fixture();
  assert.equal((await runKeychain(f.keychain)).stage, 'seeded');
  assert.equal(f.get().password, FIRST);
  assert.equal((await runKeychain(f.keychain)).stage, 'updated');
  assert.equal(f.get().password, SECOND);
  assert.equal((await runKeychain(f.keychain)).stage, 'pass');
  assert.equal(f.get(), false);
  assert.deepEqual(f.calls.map(([name]) => name), ['get', 'set', 'get', 'get', 'set', 'get', 'get', 'reset', 'get']);
  for (const [name, options] of f.calls) assert.deepEqual(options, name === 'set'
    ? { service: SERVICE, accessible: 'AccessibleWhenUnlocked' } : { service: SERVICE });
});
test('missing entitlement projects only its fixed code; arbitrary native payload is excluded', async () => {
  const f = fixture();
  f.keychain.setGenericPassword = async () => { throw { code: '-34018', message: 'PRIVATE_NATIVE_DATA' }; };
  assert.deepEqual(await runKeychain(f.keychain), { stage: 'failed', operation: 'WRITE_INITIAL',
    failure_code: 'MISSING_ENTITLEMENT', native_code: -34018 });
  f.keychain.getGenericPassword = async () => { throw new Error('PRIVATE_NATIVE_DATA'); };
  const result = await runKeychain(f.keychain);
  assert.equal(result.failure_code, 'NATIVE_EXCEPTION');
  assert.equal(result.native_code, null);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('unexpected service data is never overwritten or deleted and deletion must read absent', async () => {
  const f = fixture(); f.set({ service: SERVICE, username: 'UNEXPECTED', password: 'PRIVATE' });
  assert.equal((await runKeychain(f.keychain)).failure_code, 'UNEXPECTED_SERVICE_ITEM');
  assert.deepEqual(f.calls.map(([name]) => name), ['get']);
  f.set({ service: SERVICE, username: USERNAME, password: SECOND });
  f.keychain.resetGenericPassword = async () => true;
  const result = await runKeychain(f.keychain);
  assert.equal(result.stage, 'failed');
  assert.equal(result.failure_code, 'DELETE_READBACK_MISMATCH');
});
test('loss of persisted item cannot advance a process-relaunch checkpoint', async () => {
  const f = fixture();
  assert.equal((await runKeychain(f.keychain)).stage, 'seeded');
  f.set(false);
  assert.equal((await runKeychain(f.keychain)).stage, 'seeded');
});
