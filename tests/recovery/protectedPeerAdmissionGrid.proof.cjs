// Real peer remote-only/key-conflict change BEFORE old operation admission.
// Actual CAS/signatures, native receipts, complete encrypted images and queue
// remain genuine. No snapshot, conflict reply or backend success is fabricated.
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
evaluate(declarations('tests/recovery/protectedAcknowledgementGrid.proof.cjs', ['assertOriginalPositiveAck']),
  scope, 'unchanged-full-positive-ack-contract.ts');
const operationNames = ['updateAppImage', 'migrateXfps', 'deleteAppImageEntity', 'deleteVaults',
  'updateVaultImage', 'modifyLabels', 'deleteBackup'];
assert.deepEqual(Object.keys(builders.operations), operationNames);
const PEER_CHANGES = ['remote-only', 'key-conflict'];
let server;
beforeEach(async () => { server = await createProtectedServer(); scope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; scope.server = undefined; });
after(() => Realm.shutdown());
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

for (const operation of operationNames) for (const change of PEER_CHANGES) nodeTest(
  `${operation}: genuine pre-admission ${change} peer copy survives old local receipt without any own mutation`,
  { timeout: 30_000 }, async t => {
    const f = await scope.setup(t, operation);
    const request = await scope.committedRequest(f, operation);
    const base = request.receipt.intent.protectedBase;
    const local = await f.repair.captureBackupImage();
    const peerWallet = builders.wallet(f, change === 'remote-only' ? 'server-only-wallet' : 'retained-wallet');
    if (change === 'key-conflict') peerWallet.specs.xpub = 'different-public-key-identity';
    const expectedRemote = plain(f.initialImage);
    expectedRemote.wallets[peerWallet.id] = plain(peerWallet);
    // Deliberately advance the real remote copy BEFORE original queue admission.
    // Its direct signed peer client cannot lend a fresh tuple to the old receipt.
    const peer = await f.protected.protectedBackupMutation(mnemonic, base, 'updateAppImage', { walletsObject: {
      [peerWallet.id]: await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed), plain(peerWallet)),
    } });
    scope.assertOriginalPositiveAck(peer, base, 'updateAppImage');
    assert.equal(writes().length, 1);
    assert.equal(writes()[0].committed, true);
    assert.equal(writes()[0].status, 200);
    assert.equal(peer.base.namespaceId, base.namespaceId);
    assert.notEqual(peer.base.revision, base.revision);
    assert.equal(peer.base.generation, base.generation + 1);
    server.clearTrace();
    const result = await request.invoke();
    assert.notEqual(result.updated, true);
    assert.notEqual(result.backupConfirmed, true);
    assert.equal(writes().length, 0, 'The original legacy pre-admission obligation permits no own CAS attempt');
    assert.equal(server.trace.length, 1);
    assert.equal(server.trace[0].path, '/backup/v3/snapshot');
    assert.equal(server.trace[0].status, 200, 'Read the actual valid advanced peer snapshot before refusing old authority');
    scope.assertPending(f);
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
    assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
    if (operation === 'deleteVaults') assert.ok(f.dbManager.getObjectById(f.RealmSchema.Vault, 'retained-vault'));
    const beforeReplay = server.trace.length;
    const replay = await request.invoke();
    assert.notEqual(replay.backupConfirmed, true);
    assert.equal(server.trace.length, beforeReplay, 'Old receipt cannot read, rebase, enroll, repair or replay');
    const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
    assert.equal(remote.state, 'present', 'An old Delete receipt cannot erase the newer peer copy');
    assert.equal(remote.snapshot.revision, peer.base.revision);
    assert.equal(remote.snapshot.generation, peer.base.generation);
    assert.equal(remote.snapshot.authEpoch, peer.base.authEpoch);
    const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
      remote.namespaceId, () => {}, true);
    assert.equal(decoded.wallets[peerWallet.id].specs.xpub, peerWallet.specs.xpub);
    assert.deepEqual(plain(decoded.wallets[peerWallet.id]), plain(peerWallet));
    assert.equal(await f.image.compareImages(expectedRemote, decoded), 'matched',
      'The peer change and every untouched original remote record must survive in full');
    assert.equal(writes().length, 0);
    scope.assertPending(f);
  });
