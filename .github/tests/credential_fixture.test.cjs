/* Fake adapters validate fixture safety only. No native acceptance credit. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { BACKUP_SERVICE, MALFORMED, runFixture } = require('../native/credential_fixture_core');
const config = { ENVIRONMENT: 'DEVELOPMENT', RELAY: 'http://127.0.0.1:8765/',
  ENC_KEY_STORAGE_IDENTIFIER: 'KEEPER-HOSTED-DISPOSABLE' };
const secret = 'PRIVATE_SECRET_SENTINEL';
function fixture() {
  const account = { isDefault: true, accountIdentifier: '', appId: 'disposable',
    realmId: 'owned.realm', hash: 'disposable-hash' };
  const root = { account: JSON.stringify({ allAccounts: [account] }),
    storage: JSON.stringify({ appId: account.appId }) };
  const original = { username: config.ENC_KEY_STORAGE_IDENTIFIER,
    password: JSON.stringify({ hash: account.hash, enc_key: secret, other: 'preserve-exact-bytes' }) };
  const values = new Map([[undefined, structuredClone(original)]]);
  const writes = [];
  const storage = { getString: (key) => key === 'persist:root' ? JSON.stringify(root) : undefined };
  const Keychain = { ACCESSIBLE: { WHEN_UNLOCKED: 'WHEN_UNLOCKED' },
    async getGenericPassword({ service }) { return values.get(service) || false; },
    async setGenericPassword(username, password, options) {
      writes.push(options.service); values.set(options.service, { username, password }); return true;
    },
    async resetGenericPassword({ service }) { return values.delete(service); } };
  return { account, root, original, values, writes, Keychain, storage,
    run: (phase, extra = {}) => runFixture({ phase, Keychain, storage, config,
      development: true, ...extra }) };
}
test('arm stores exact secret bytes only in Keychain and restore removes the verified backup', async () => {
  const f = fixture();
  const rootBefore = JSON.stringify(f.root);
  assert.equal(await f.run('arm'), 'armed');
  assert.equal(f.values.get(undefined).password, MALFORMED);
  assert.deepEqual(f.writes, [BACKUP_SERVICE, undefined]);
  assert.equal(await f.run('restore'), 'restored');
  assert.deepEqual(f.values.get(undefined), f.original);
  assert.equal(f.values.has(BACKUP_SERVICE), false);
  assert.equal(JSON.stringify(f.root), rootBefore, 'fixture never mutates persisted app/account state');
});
test('successfully empty Keychain is rejected without writes and never called an error fixture', async () => {
  const f = fixture(); f.values.delete(undefined);
  await assert.rejects(f.run('arm'), /credential-required/);
  assert.deepEqual(f.writes, []);
});
test('native Keychain rejection propagates without exporting its error or writing new credentials', async () => {
  const f = fixture();
  f.Keychain.getGenericPassword = async () => { throw new Error(secret); };
  await assert.rejects(f.run('arm'));
  assert.deepEqual(f.writes, []);
  // The native UI wrapper catches every exception and displays fixed "failed" only.
  const wrapper = require('node:fs').readFileSync(require('node:path').join(__dirname,
    '../native/credential_fixture.js'), 'utf8');
  assert.match(wrapper, /\.catch\(\(\) => 'failed'\)/);
  assert.doesNotMatch(wrapper, /console\.|writeFile|fetch\(|JSON\.stringify/);
});
test('non-disposable build, unapproved phase, non-default and multiple owners are refused before writes', async () => {
  const cases = [
    (f) => f.run('arm', { development: false }),
    (f) => f.run('arm', { config: { ...config, RELAY: 'https://production.invalid/' } }),
    (f) => f.run('arm', { config: { ...config, ENC_KEY_STORAGE_IDENTIFIER: 'OTHER' } }),
    (f) => f.run('unknown'),
    (f) => { f.account.accountIdentifier = 'another'; f.root.account = JSON.stringify({ allAccounts: [f.account] }); return f.run('arm'); },
    (f) => { f.root.account = JSON.stringify({ allAccounts: [f.account, f.account] }); return f.run('arm'); },
    (f) => { f.root.storage = JSON.stringify({ appId: 'another' }); return f.run('arm'); },
  ];
  for (const attempt of cases) { const f = fixture(); await assert.rejects(attempt(f)); assert.deepEqual(f.writes, []); }
});
test('unknown prior backup and wrong account credential are never overwritten', async () => {
  const f = fixture(); f.values.set(BACKUP_SERVICE, { username: 'other', password: secret });
  await assert.rejects(f.run('arm'), /backup-already-present/);
  assert.equal(f.values.get(BACKUP_SERVICE).password, secret);
  assert.deepEqual(f.writes, []);
  f.values.delete(BACKUP_SERVICE);
  f.values.set(undefined, { ...f.original, password: JSON.stringify({ hash: 'other', enc_key: secret }) });
  await assert.rejects(f.run('arm'), /matching-credential-required/);
  assert.deepEqual(f.writes, []);
});
test('backup write/readback failure never corrupts the original', async () => {
  for (const option of ['write', 'readback']) {
    const f = fixture();
    if (option === 'write') f.Keychain.setGenericPassword = async () => false;
    else {
      const get = f.Keychain.getGenericPassword;
      f.Keychain.getGenericPassword = async (options) => options.service === BACKUP_SERVICE &&
        f.values.has(BACKUP_SERVICE) ? { username: 'wrong', password: secret } : get(options);
    }
    await assert.rejects(f.run('arm'));
    assert.deepEqual(f.values.get(undefined), f.original);
  }
});
test('restore refuses account switches or changed credentials without overwriting them', async () => {
  const f = fixture(); await f.run('arm');
  f.root.account = JSON.stringify({ allAccounts: [{ ...f.account, realmId: 'another.realm' }] });
  await assert.rejects(f.run('restore'), /backup-owner-mismatch/);
  assert.equal(f.values.get(undefined).password, MALFORMED);
  f.root.account = JSON.stringify({ allAccounts: [f.account] });
  f.values.set(undefined, { username: f.original.username, password: 'CHANGED' });
  await assert.rejects(f.run('restore'), /restore-source-changed/);
  assert.equal(f.values.get(undefined).password, 'CHANGED');
});
test('restore readback and backup cleanup failures cannot emit restored', async () => {
  for (const option of ['write', 'readback', 'cleanup', 'cleanup-readback']) {
    const f = fixture(); await f.run('arm');
    if (option === 'write') f.Keychain.setGenericPassword = async () => false;
    if (option === 'readback') f.Keychain.setGenericPassword = async () => true;
    if (option === 'cleanup') f.Keychain.resetGenericPassword = async () => false;
    if (option === 'cleanup-readback') f.Keychain.resetGenericPassword = async () => true;
    await assert.rejects(f.run('restore'));
  }
});
test('alternate Metro config accepts only the two fixed fixture phases and leaves other requests alone', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const filename = path.join(__dirname, '../native/credential_metro.cjs');
  const source = fs.readFileSync(filename, 'utf8');
  function load(phase) {
    const context = { module: { exports: {} }, __dirname: path.dirname(filename),
      process: { env: { KEEPER_CREDENTIAL_FIXTURE_PHASE: phase } },
      require: (name) => name === 'node:path' ? path : {} };
    vm.runInNewContext(source, context);
    return context.module.exports;
  }
  for (const value of [undefined, 'product', '../index', 'arm?other']) assert.throws(() => load(value));
  for (const phase of ['arm', 'restore']) {
    const wrapped = load(phase).server.enhanceMiddleware((request) => request.url);
    assert.equal(wrapped({ url: '/index.bundle?platform=ios' }),
      `/.github/native/credential_${phase}.bundle?platform=ios`);
    assert.equal(wrapped({ url: '/index.map' }), `/.github/native/credential_${phase}.map`);
    assert.equal(wrapped({ url: '/index.bundle.other' }), '/index.bundle.other');
    assert.equal(wrapped({ url: '/status' }), '/status');
  }
});
