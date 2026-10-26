// Actual endpoint/native-availability gates, with BOTH Node fixture overrides
// removed where required and a controlled RestClient boundary preventing any
// non-owned network I/O. Compiled availability flags remain unchanged.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
const builders = { assert };
evaluate(declarations('tests/recovery/automaticWriteRealmRelay.integration.cjs', [
  'wallet', 'signer', 'vault', 'persist', 'persistVault', 'vaultBody', 'labelBody', 'operations',
]), builders, 'unchanged-disposable-operation-record-builders.ts');
const scope = { assert, plain, createProtectedRealmClient, mnemonic, seed, appId, tick, ...builders };
scope.fixtureScope = scope;
evaluate(declarations('tests/recovery/protectedWriteRealmRelay.proof.cjs', ['client', 'committedRequest']),
  scope, 'unchanged-real-protected-client-and-committed-receipt.ts');
evaluate(declarations('tests/recovery/protectedReceiptOwnershipGrid.proof.cjs', ['setup', 'assertPending']),
  scope, 'unchanged-real-enrollment-full-initial-image-and-pending-checks.ts');
let server;
beforeEach(async () => { server = await createProtectedServer(); scope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; scope.server = undefined; });
after(() => Realm.shutdown());
const test = (name, body) => nodeTest(name, { timeout: 30_000 }, body);
const MODES = ['development-loopback', 'production-environment', 'development-disabled', 'missing-explicit-port'];
const FIXTURE_KEYS = ['KEEPER_RELAY_FIXTURE_MODULE', 'KEEPER_PROTECTED_RELAY_CHECKOUT'];
function removeFixtureOverrides() {
  const saved = FIXTURE_KEYS.map(key => ({ key, present: Object.hasOwn(process.env, key), value: process.env[key] }));
  for (const { key } of saved) delete process.env[key];
  return () => { for (const { key, present, value } of saved) {
    if (present) process.env[key] = value; else delete process.env[key];
  } };
}
function boundary(f) {
  const rest = f.load('src/services/rest/RestClient').default, original = rest.post;
  const ownedOrigin = new URL(server.url).origin, calls = [];
  let blocked = 0;
  rest.post = function (...args) {
    const target = new URL(args[0]);
    calls.push({ origin: target.origin, path: target.pathname, protocol: target.protocol });
    if (target.origin !== ownedOrigin) {
      blocked += 1;
      throw new Error('Controlled proof forbids non-owned transport before network I/O');
    }
    return original.apply(this, args);
  };
  return { calls, blocked: () => blocked, restore: () => { rest.post = original; } };
}
function configSnapshot(f) {
  const relay = f.config.RELAY, environment = f.config.ENVIRONMENT, dev = f.config.isDevMode;
  return () => { f.config.RELAY = relay; f.config.ENVIRONMENT = environment; f.config.isDevMode = dev; };
}
async function request(f) {
  const prepared = await scope.committedRequest(f, 'updateAppImage');
  assert.equal(prepared.receipt.committed, true);
  assert.equal(prepared.receipt.intent.protectedBase.revision, f.initialRemote.snapshot.revision);
  const local = await f.repair.captureBackupImage();
  assert.deepEqual(plain(await f.image.decryptRecord(f.encryption.generateEncryptionKey(f.seed),
    prepared.body.walletsObject['wallet-a'])), plain(local.wallets['wallet-a']));
  return { prepared, local };
}
async function unchangedLocalAndRemote(f, local, expected) {
  assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
  assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
  const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(remote.state, 'present');
  const image = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
    remote.namespaceId, () => {}, true);
  assert.equal(await f.image.compareImages(expected, image), 'matched');
  return remote;
}

test('configured hosted target cannot escape the controlled proof transport even when compiled hosting is intentionally available', async t => {
  const f = await scope.setup(t, 'updateAppImage'), { prepared, local } = await request(f);
  const restoreConfig = configSnapshot(f), observed = boundary(f);
  t.after(() => { restoreConfig(); observed.restore(); });
  const sourceReady = f.automatic.AUTOMATIC_BACKUP_SOURCE_READY;
  const hostedAvailable = f.automatic.AUTOMATIC_BACKUP_HOSTED_AVAILABLE;
  const protectedAvailable = f.protected.PROTECTED_BACKUP_HOSTED_AVAILABLE;
  assert.equal(hostedAvailable, true, 'Compiled app availability does not certify deployed backend readiness');
  f.config.RELAY = 'https://hosted-recovery-fixture.invalid/';
  assert.equal(/^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(f.config.RELAY), false,
    'A hosted target can never satisfy the actual Node fixture loopback predicate');
  let result;
  try { result = await prepared.invoke(); }
  finally { restoreConfig(); observed.restore(); }
  assert.notEqual(result.backupConfirmed, true);
  assert.equal(server.trace.length, 0, 'The owned real backend receives no hosted attempt');
  const eligible = sourceReady && hostedAvailable && protectedAvailable;
  assert.equal(observed.calls.length, eligible ? 1 : 0,
    'Current compiled availability, not fixture authorization, determines whether a signed HTTPS attempt reaches transport');
  assert.equal(observed.blocked(), observed.calls.length, 'Every non-owned attempt is stopped before original RestClient/actual I/O');
  if (eligible) assert.deepEqual(observed.calls[0], {
    origin: 'https://hosted-recovery-fixture.invalid', path: '/backup/v3/snapshot', protocol: 'https:',
  });
  assert.equal(f.automatic.AUTOMATIC_BACKUP_SOURCE_READY, sourceReady);
  assert.equal(f.automatic.AUTOMATIC_BACKUP_HOSTED_AVAILABLE, hostedAvailable);
  assert.equal(f.protected.PROTECTED_BACKUP_HOSTED_AVAILABLE, protectedAvailable);
  scope.assertPending(f);
  const beforeReplay = server.trace.length;
  assert.notEqual((await prepared.invoke()).backupConfirmed, true);
  assert.equal(server.trace.length, beforeReplay);
  const remote = await unchangedLocalAndRemote(f, local, f.initialImage);
  assert.deepEqual(plain(remote.snapshot), plain(f.initialRemote.snapshot));
  scope.assertPending(f);
});

for (const mode of MODES) test(
  `without either Node fixture override ${mode} obeys the real compiled native and endpoint gates`, async t => {
    const f = await scope.setup(t, 'updateAppImage'), { prepared, local } = await request(f);
    const sourceReady = f.automatic.AUTOMATIC_BACKUP_SOURCE_READY;
    const hostedAvailable = f.automatic.AUTOMATIC_BACKUP_HOSTED_AVAILABLE;
    const protectedAvailable = f.protected.PROTECTED_BACKUP_HOSTED_AVAILABLE;
    const restoreConfig = configSnapshot(f), observed = boundary(f), restoreOverrides = removeFixtureOverrides();
    t.after(() => { restoreConfig(); restoreOverrides(); observed.restore(); });
    assert.equal(hostedAvailable, true, 'Compiled app availability does not certify deployed backend readiness');
    if (mode === 'production-environment') f.config.ENVIRONMENT = 'PRODUCTION';
    if (mode === 'development-disabled') f.config.isDevMode = () => false;
    if (mode === 'missing-explicit-port') f.config.RELAY = 'http://127.0.0.1/';
    let result;
    try {
      for (const key of FIXTURE_KEYS) assert.equal(Object.hasOwn(process.env, key), false);
      result = await prepared.invoke();
    } finally { restoreConfig(); restoreOverrides(); observed.restore(); }
    const allowed = mode === 'development-loopback' && sourceReady;
    const writes = server.trace.filter(event => event.path === '/backup/v3/mutate');
    if (allowed) {
      assert.equal(result.updated, true);
      assert.equal(result.backupConfirmed, true);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].committed, true);
      const base = prepared.receipt.intent.protectedBase;
      assert.equal(writes[0].status, 200);
      assert.equal(writes[0].namespaceId, base.namespaceId);
      assert.equal(writes[0].expectedRevision, base.revision);
      assert.equal(writes[0].expectedGeneration, base.generation);
      assert.equal(writes[0].authEpoch, base.authEpoch);
      assert.equal(observed.calls.length, 3);
      assert.equal(observed.blocked(), 0);
      assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], false);
      assert.equal(f.store.getState().bhr.backupRepairStateByAppId[appId], 'verified');
      assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[appId], true);
      assert.equal(f.automatic.isBackupVerificationCurrent(appId), true);
      assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
      const remote = await unchangedLocalAndRemote(f, local, local);
      assert.equal(remote.snapshot.revision, writes[0].serverRevision);
      assert.equal(remote.snapshot.generation, writes[0].serverGeneration);
      assert.equal(remote.snapshot.authEpoch, writes[0].serverAuthEpoch);
    } else {
      assert.notEqual(result.backupConfirmed, true);
      assert.equal(writes.length, 0);
      assert.equal(server.trace.length, 0);
      assert.equal(observed.calls.length, 0, 'Invalid HTTP native/endpoint configuration must reject before any RestClient call');
      scope.assertPending(f);
      const beforeReplay = server.trace.length;
      assert.notEqual((await prepared.invoke()).backupConfirmed, true);
      assert.equal(server.trace.length, beforeReplay);
      const remote = await unchangedLocalAndRemote(f, local, f.initialImage);
      assert.deepEqual(plain(remote.snapshot), plain(f.initialRemote.snapshot));
      scope.assertPending(f);
    }
    assert.equal(f.automatic.AUTOMATIC_BACKUP_SOURCE_READY, sourceReady);
    assert.equal(f.automatic.AUTOMATIC_BACKUP_HOSTED_AVAILABLE, hostedAvailable);
    assert.equal(f.protected.PROTECTED_BACKUP_HOSTED_AVAILABLE, protectedAvailable);
  });
