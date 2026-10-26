// Genuine signed-v3 receipt provenance/lifetime grid. Native Realm commits,
// rollback, selection, queue ownership, crypto and signed HTTP remain real.
// No receipt, originating baseline, backend result or successful write is mocked.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
function barrier() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
const builders = { assert };
evaluate(declarations('tests/recovery/automaticWriteRealmRelay.integration.cjs', [
  'wallet', 'signer', 'vault', 'persist', 'persistVault', 'vaultBody', 'labelBody', 'operations',
]), builders, 'unchanged-public-disposable-operation-builders.ts');
const { operations, wallet, persist, persistVault } = builders;
const operationNames = ['updateAppImage', 'migrateXfps', 'deleteAppImageEntity', 'deleteVaults',
  'updateVaultImage', 'modifyLabels', 'deleteBackup'];
assert.deepEqual(Object.keys(operations), operationNames);
const fixtureScope = { assert, createProtectedRealmClient, mnemonic, seed, appId, operations };
evaluate(declarations('tests/recovery/protectedWriteRealmRelay.proof.cjs', ['client', 'committedRequest']),
  fixtureScope, 'unchanged-real-protected-client-and-receipt-helpers.ts');
let server;
beforeEach(async () => { server = await createProtectedServer(); fixtureScope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; fixtureScope.server = undefined; });
after(() => Realm.shutdown());
const test = (name, body) => nodeTest(name, { timeout: 30_000 }, body);
const mutations = () => server.trace.filter(event => event.path === '/backup/v3/mutate');
const RECEIPT_FAULTS = ['later-local-commit', 'A-to-B-to-A', 'failed-native-commit',
  'copied-intent', 'missing-whole-receipt', 'post-commit-Realm-reopen'];

async function setup(t, operation) {
  await server.reset();
  const f = await fixtureScope.client(t);
  operations[operation].prepare(f);
  persist(f, f.RealmSchema.Wallet, wallet(f, 'retained-wallet', 'Retained local recovery record'));
  if (operation === 'deleteVaults') persistVault(f, 'retained-vault');
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
  await tick();
  assert.equal(await f.sagas.run('runBackupInspection', true, appId, true), true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], false);
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), true);
  assert.ok(f.transport.captureBackupWriteIntent(appId)?.protectedBase);
  f.initialRemote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(f.initialRemote.state, 'present');
  f.initialImage = await f.repair.captureBackupImage();
  const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    f.initialRemote.snapshot, f.initialRemote.namespaceId);
  assert.equal(await f.image.compareImages(f.initialImage, decoded), 'matched');
  f.initialApp = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
  server.clearTrace();
  return f;
}

function assertPending(f) {
  const state = f.store.getState().bhr;
  assert.equal(state.pendingAllBackupByAppId[appId], true);
  assert.notEqual(state.backupRepairStateByAppId[appId], 'verified');
  assert.notEqual(state.backupRepairCompletedByAppId[appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), false);
  assert.equal(f.transport.captureBackupWriteIntent(appId), undefined);
  assert.equal(state.automaticCloudBackupByAppId[appId], true,
    'A rejected receipt cannot opt out even when its requested operation was Delete');
}

async function observe(invoke) {
  try { return await invoke(); }
  catch (error) { return { updated: false, failure: error.name }; }
}

async function assertRejectedWithoutRequest(f, result, expectedImage, totalRequests = 0) {
  assert.notEqual(result?.updated, true);
  assert.notEqual(result?.backupConfirmed, true);
  assert.equal(server.trace.length, totalRequests,
    'Rejected receipt must not read, mutate, enroll, repair or borrow fresh authority');
  assert.equal(mutations().length, 0);
  assertPending(f);
  assert.equal(await f.image.compareImages(expectedImage, await f.repair.captureBackupImage()), 'matched');
  assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
  assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
}

async function assertRemoteUnchanged(f) {
  const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(remote.state, 'present', 'A rejected Delete must leave its existing protected copy present');
  assert.equal(remote.namespaceId, f.initialRemote.namespaceId);
  assert.deepEqual(plain(remote.snapshot), plain(f.initialRemote.snapshot),
    'Actual signed backend tuple and complete encrypted records must remain unchanged');
  const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot, remote.namespaceId);
  assert.equal(await f.image.compareImages(f.initialImage, decoded), 'matched');
  assert.equal(mutations().length, 0);
  assertPending(f);
}

for (const operation of operationNames) for (const fault of RECEIPT_FAULTS) {
  test(`${operation}: signed-v3 ${fault} rejects receipt before HTTP and retains complete local and remote records`, async t => {
    const f = await setup(t, operation);
    let result, expectedImage, retry;
    if (fault === 'failed-native-commit') {
      const beforeTags = plain(f.nativeRealm().objects('Tags'));
      const op = f.automatic.beginBackupLocalOperation(appId, f.transport.captureBackupWriteIntent(appId),
        f.transport.currentBackupAccountSession());
      let enteredTransaction = false, stagedTag = false;
      const receipt = f.automatic.commitBackupLocalOperation(op, realm => {
        enteredTransaction = true;
        realm.create('Tags', f.defaults(f.RealmSchema.Tags, {
          id: 'rolled-back', type: 'TX', ref: 'rollback', label: 'Must never persist',
        }));
        stagedTag = realm.objectForPrimaryKey('Tags', 'rolled-back')?.label === 'Must never persist';
        throw new Error('Disposable native transaction failure');
      });
      assert.equal(enteredTransaction, true);
      assert.equal(stagedTag, true, 'The real transaction must contain the staged record before its deliberate rollback');
      assert.equal(receipt.committed, false);
      assert.equal(receipt.intent, undefined);
      assert.deepEqual(plain(f.nativeRealm().objects('Tags')), beforeTags);
      assert.equal(f.nativeRealm().objectForPrimaryKey('Tags', 'rolled-back'), null);
      expectedImage = f.initialImage;
      // Preserve the original legacy failed-commit wrapper input exactly.
      result = await observe(() => operations[operation].invoke(f, { appId }, receipt.intent));
      retry = () => f.automatic.enqueueAutomaticBackupOperation(receipt, [{ operation, body: { appId } }]);
    } else {
      const request = await fixtureScope.committedRequest(f, operation);
      retry = request.invoke;
      assert.equal(request.receipt.committed, true);
      assert.ok(request.receipt.intent?.protectedBase);
      assert.equal(request.receipt.intent.protectedBase.revision, f.initialRemote.snapshot.revision);
      expectedImage = await f.repair.captureBackupImage();
      // Explicit Delete preparation is allowed its own real read. It occurs
      // BEFORE the invalid queued request whose no-HTTP obligation is measured.
      if (operation === 'deleteBackup') {
        assert.ok(server.trace.some(event => event.path === '/backup/v3/snapshot'));
        assert.equal(mutations().length, 0);
      }
      server.clearTrace();
      if (fault === 'copied-intent') {
        assert.ok(f.transport.captureBackupWriteIntent(appId)?.protectedBase);
        const copy = { ...request.receipt.intent };
        assert.notEqual(copy, request.receipt.intent);
        assert.deepEqual(plain(copy), plain(request.receipt.intent));
        result = await observe(() => operations[operation].invoke(f, request.body, copy));
      } else if (fault === 'missing-whole-receipt') {
        // The whole receipt is absent while the genuine global baseline still
        // exists. This differs from a committed receipt with undefined intent.
        assert.ok(f.transport.captureBackupWriteIntent(appId)?.protectedBase);
        result = await f.automatic.enqueueAutomaticBackupOperation(undefined, [{ operation, body: request.body }]);
      } else {
        const gate = barrier(), entered = barrier();
        t.after(gate.release);
        const preceding = f.transport.withBackupSession(appId, () => { entered.release(); return gate.promise; });
        await entered.promise;
        let writingSettled = false;
        const writing = observe(request.invoke).finally(() => { writingSettled = true; });
        try {
          await tick();
          assert.equal(writingSettled, false, 'Actual operation must still wait behind the entered owned session before invalidation');
          assert.equal(server.trace.length, 0, 'Original receipt is queued behind the owned session before invalidation');
          if (fault === 'later-local-commit') {
            persist(f, f.RealmSchema.Tags, f.defaults(f.RealmSchema.Tags, {
              id: 'later-local-change', type: 'TX', ref: 'later', label: 'Changed after receipt',
            }));
            assert.equal(f.nativeRealm().objectForPrimaryKey('Tags', 'later-local-change').label, 'Changed after receipt');
            expectedImage = await f.repair.captureBackupImage();
          } else if (fault === 'A-to-B-to-A') {
            const originalSession = f.transport.currentBackupAccountSession();
            await f.selectAccount('disposable-account-b');
            assert.equal(f.selected(), 'disposable-account-b');
            await f.selectAccount(appId);
            assert.equal(f.selected(), appId);
            assert.ok(f.transport.currentBackupAccountSession() > originalSession);
          } else {
            assert.equal(fault, 'post-commit-Realm-reopen');
            const original = f.nativeRealm();
            f.realmDatabase.closeDatabase();
            await f.selectAccount(appId);
            assert.equal(original.isClosed, true);
            assert.notEqual(f.nativeRealm(), original);
            assert.equal(f.nativeRealm().isClosed, false);
          }
        } finally {
          gate.release();
          await preceding;
          result = await writing;
        }
      }
    }
    await assertRejectedWithoutRequest(f, result, expectedImage);
    const replay = await observe(retry);
    await assertRejectedWithoutRequest(f, replay, expectedImage);
    await assertRemoteUnchanged(f);
  });
}

test('a cloned original protected baseline permits the genuine local commit but cannot mint a branded automatic receipt', async t => {
  const f = await setup(t, 'updateAppImage');
  const original = f.transport.captureBackupWriteIntent(appId);
  assert.ok(original?.protectedBase);
  const copy = { ...original };
  assert.notEqual(copy, original);
  assert.deepEqual(plain(copy), plain(original));
  const op = f.automatic.beginBackupLocalOperation(appId, copy, f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, realm => operations.updateAppImage.mutate(realm, f));
  assert.equal(receipt.committed, true, 'Local saving remains available without cloud proof');
  assert.equal(receipt.intent, undefined);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a').presentationData.name, 'Committed wallet');
  const expectedImage = await f.repair.captureBackupImage();
  const mutations = [{ operation: 'updateAppImage', body: await operations.updateAppImage.body(f) }];
  const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, mutations);
  await assertRejectedWithoutRequest(f, result, expectedImage);
  const replay = await f.automatic.enqueueAutomaticBackupOperation(receipt, mutations);
  await assertRejectedWithoutRequest(f, replay, expectedImage);
  await assertRemoteUnchanged(f);
});
