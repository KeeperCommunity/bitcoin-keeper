// Actual raw-operation CAS409 after a real peer commit between original
// snapshot and mutation. No HTTP error, commit or response is fabricated.
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
let server;
beforeEach(async () => { server = await createProtectedServer(); scope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; scope.server = undefined; });
after(() => Realm.shutdown());
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

for (const operation of operationNames) nodeTest(
  `${operation}: real competing CAS after original snapshot causes actual409 without retry, rebase or verified claim`,
  { timeout: 30_000 }, async t => {
    const f = await scope.setup(t, operation);
    const request = await scope.committedRequest(f, operation);
    const base = request.receipt.intent.protectedBase;
    const local = await f.repair.captureBackupImage();
    const expectedRemote = plain(f.initialImage);
    const peerWallet = builders.wallet(f, 'real-conflict-peer', 'Independent conflict peer recovery');
    expectedRemote.wallets[peerWallet.id] = plain(peerWallet);
    // Real explicit Delete preparation is complete before fault admission.
    server.clearTrace();
    let peerAck, injected = false;
    server.armFault({ path: '/backup/v3/snapshot', async beforeReply() {
      injected = true;
      peerAck = await f.protected.protectedBackupMutation(mnemonic, base, 'updateAppImage', { walletsObject: {
        [peerWallet.id]: await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed), plain(peerWallet)),
      } });
    } });
    const result = await request.invoke();
    assert.equal(injected, true);
    assert.ok(peerAck);
    scope.assertOriginalPositiveAck(peerAck, base, 'updateAppImage');
    assert.notEqual(result.updated, true);
    assert.notEqual(result.backupConfirmed, true);
    const attempts = writes();
    assert.equal(attempts.length, 2, 'Exactly one independent peer CAS and one own failed CAS');
    assert.equal(attempts[0].operation, 'updateAppImage');
    assert.equal(attempts[0].status, 200);
    assert.equal(attempts[0].committed, true);
    assert.equal(attempts[0].serverRevision, peerAck.base.revision);
    const own = attempts[1];
    assert.equal(own.operation, operation);
    assert.equal(own.status, 409, 'The actual router, not a fault response, must reject the stale original CAS');
    assert.equal(own.committed, false);
    assert.equal(own.namespaceId, base.namespaceId);
    assert.equal(own.expectedRevision, base.revision);
    assert.equal(own.expectedGeneration, base.generation);
    assert.equal(own.authEpoch, base.authEpoch);
    assert.notEqual(own.expectedRevision, peerAck.base.revision);
    scope.assertPending(f);
    assert.equal(await f.image.compareImages(local, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
    assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
    const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
    assert.equal(remote.state, 'present', 'Conflicting old Delete cannot erase the genuine newer peer copy');
    assert.equal(remote.snapshot.revision, peerAck.base.revision);
    assert.equal(remote.snapshot.generation, peerAck.base.generation);
    assert.equal(remote.snapshot.authEpoch, peerAck.base.authEpoch);
    const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
      remote.namespaceId, () => {}, true);
    assert.equal(await f.image.compareImages(expectedRemote, decoded), 'matched');
    assert.deepEqual(plain(decoded.wallets[peerWallet.id]), plain(peerWallet));
    const beforeReplay = server.trace.length;
    assert.notEqual((await request.invoke()).backupConfirmed, true);
    assert.equal(server.trace.length, beforeReplay, 'Consumed conflicting receipt cannot read, rebase, repair or replay');
    const revision = f.transport.backupRevision(appId);
    const phase = await f.repair.inspectBackup(appId, false, () => {});
    assert.ok(['different', 'conflict', 'unverified'].includes(phase), 'Read-only reconciliation cannot claim the distinct peer image verified');
    assert.equal(writes().length, 2, 'Read-only reconciliation sends no additional own mutation');
    assert.ok(f.transport.backupRevision(appId) >= revision);
    const afterInspection = server.trace.length;
    assert.notEqual((await request.invoke()).backupConfirmed, true);
    assert.equal(server.trace.length, afterInspection);
    scope.assertPending(f);
  });
