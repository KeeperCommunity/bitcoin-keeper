// Same persisted signer/vault ID with changed recovery identity. The actual
// queue reads its signed baseline and rejects projection before any mutation.
// Local commits, crypto, native Realm and backend readback are all genuine.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));
const builders = { assert, require, plain, Realm };
evaluate(declarations('tests/recovery/automaticWriteRealmRelay.integration.cjs', [
  'wallet', 'signer', 'vault', 'persist', 'persistVault', 'vaultBody', 'labelBody', 'operations', 'disposableExtendedKey',
]), builders, 'unchanged-disposable-record-and-real-extended-key-builders.ts');
const { operations, wallet, signer, persist, vaultBody, disposableExtendedKey } = builders;
const fixtureScope = { assert, createProtectedRealmClient, mnemonic, seed, appId, operations };
evaluate(declarations('tests/recovery/protectedWriteRealmRelay.proof.cjs', ['client']),
  fixtureScope, 'unchanged-real-protected-client-helper.ts');
const pendingScope = { assert, appId };
evaluate(declarations('tests/recovery/protectedAcknowledgementGrid.proof.cjs', ['assertPending']),
  pendingScope, 'unchanged-complete-pending-assertions.ts');
let server;
beforeEach(async () => { server = await createProtectedServer(); fixtureScope.server = server; });
afterEach(async () => { await server?.close(); server = undefined; fixtureScope.server = undefined; });
after(() => Realm.shutdown());
const mutations = () => server.trace.filter(event => event.path === '/backup/v3/mutate');
const IDENTITY_CASES = [['signer', 'xpub'], ['signer', 'private-key'], ['signer', 'network'],
  ['vault', 'key'], ['vault', 'policy']];

async function setup(t, kind) {
  await server.reset();
  const f = await fixtureScope.client(t);
  operations[kind === 'signer' ? 'migrateXfps' : 'updateVaultImage'].prepare(f);
  persist(f, f.RealmSchema.Wallet, wallet(f, 'retained-wallet', 'Retained local recovery record'));
  if (kind === 'signer') {
    // Establish the exact valid original xpub BEFORE genuine enrollment,
    // rather than replacing the remote state through a backend seed helper.
    const original = disposableExtendedKey(f, 0x31);
    f.nativeRealm().write(() => {
      f.nativeRealm().objectForPrimaryKey('Signer', signer(f).id)
        .signerXpubs[f.enums.XpubTypes.P2WSH][0].xpub = original.neutered().toBase58();
    });
  }
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
  await tick();
  assert.equal(await f.sagas.run('runBackupInspection', true, appId, true), true);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[appId], false);
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[appId], true);
  f.initialRemote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(f.initialRemote.state, 'present');
  f.initialImage = await f.repair.captureBackupImage();
  const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    f.initialRemote.snapshot, f.initialRemote.namespaceId, () => {}, true);
  assert.equal(await f.image.compareImages(f.initialImage, decoded), 'matched');
  f.initialApp = plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp));
  server.clearTrace();
  return f;
}

for (const [kind, field] of IDENTITY_CASES) nodeTest(
  `same-ID ${kind} ${field}: genuine local identity replacement cannot overwrite the original signed remote copy`,
  { timeout: 30_000 }, async t => {
    const f = await setup(t, kind);
    const id = kind === 'signer' ? signer(f).id : 'vault-a';
    const original = f.transport.captureBackupWriteIntent(appId);
    assert.ok(original?.protectedBase);
    const op = f.automatic.beginBackupLocalOperation(appId, original, f.transport.currentBackupAccountSession());
    const replacement = disposableExtendedKey(f, kind === 'signer' ? 0x32 : 0x33);
    let replacementObserved = false;
    const receipt = f.automatic.commitBackupLocalOperation(op, realm => {
      if (kind === 'signer') {
        const record = realm.objectForPrimaryKey('Signer', id);
        if (field === 'xpub') record.signerXpubs[f.enums.XpubTypes.P2WSH][0].xpub = replacement.neutered().toBase58();
        else if (field === 'private-key') record.signerXpubs[f.enums.XpubTypes.P2WSH][0].xpriv = replacement.toBase58();
        else record.networkType = f.enums.NetworkType.MAINNET;
        replacementObserved = record.id === id && (field === 'network'
          ? record.networkType === f.enums.NetworkType.MAINNET
          : record.signerXpubs[f.enums.XpubTypes.P2WSH][0][field === 'xpub' ? 'xpub' : 'xpriv'] ===
            (field === 'xpub' ? replacement.neutered().toBase58() : replacement.toBase58()));
      } else {
        const record = realm.objectForPrimaryKey('Vault', id);
        if (field === 'policy') record.scheme.m = 2;
        else {
          const xpub = replacement.neutered().toBase58();
          const previous = plain(record.signers[0]);
          record.signers = [realm.create('VaultSigner', { ...previous, xpub }, Realm.UpdateMode.Modified)];
          record.specs.xpubs = [xpub];
          realm.objectForPrimaryKey('Signer', signer(f).id).signerXpubs[f.enums.XpubTypes.P2WSH][0].xpub = xpub;
        }
        replacementObserved = record.id === id && (field === 'policy'
          ? record.scheme.m === 2
          : record.signers[0].xpub === replacement.neutered().toBase58());
      }
    });
    assert.equal(receipt.committed, true);
    assert.ok(receipt.intent?.protectedBase);
    assert.equal(replacementObserved, true, 'The exact same persisted ID must contain the actual replacement');
    const current = await f.repair.captureBackupImage();
    assert.equal(current[kind === 'signer' ? 'signers' : 'vaults'][id].id, id);
    assert.equal(await f.image.compareImages(f.initialImage, current), 'conflict',
      'Production image comparison must positively recognize immutable recovery identity change');
    const body = kind === 'signer' ? { appId, signersObject: {
      [id]: await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed), current.signers[id]),
    } } : await vaultBody(f, id);
    const mutation = { operation: kind === 'signer' ? 'updateAppImage' : 'updateVaultImage', body };
    const cipher = kind === 'signer' ? body.signersObject[id] : body.vault;
    assert.deepEqual(plain(await f.image.decryptRecord(f.encryption.generateEncryptionKey(f.seed), cipher)),
      plain(current[kind === 'signer' ? 'signers' : 'vaults'][id]), 'Submission must contain the actual committed replacement');
    const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, [mutation]);
    assert.notEqual(result.updated, true);
    assert.notEqual(result.backupConfirmed, true);
    assert.equal(mutations().length, 0, 'Original legacy assertion: no mutation may overwrite the remote identity');
    assert.equal(server.trace.length, 1);
    assert.equal(server.trace[0].path, '/backup/v3/snapshot');
    assert.equal(server.trace[0].status, 200, 'Real valid original snapshot must reach the actual projection guard');
    pendingScope.assertPending(f);
    assert.equal(await f.image.compareImages(current, await f.repair.captureBackupImage()), 'matched');
    assert.deepEqual(plain(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp)), f.initialApp);
    assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'retained-wallet'));
    assert.ok(f.dbManager.getObjectById(kind === 'signer' ? f.RealmSchema.Signer : f.RealmSchema.Vault, id));
    const beforeReplay = server.trace.length;
    const replay = await f.automatic.enqueueAutomaticBackupOperation(receipt, [mutation]);
    assert.notEqual(replay.backupConfirmed, true);
    assert.equal(server.trace.length, beforeReplay, 'Invalidated original receipt cannot borrow authority or replay');
    const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
    assert.equal(remote.state, 'present');
    assert.deepEqual(plain(remote.snapshot), plain(f.initialRemote.snapshot));
    const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot,
      remote.namespaceId, () => {}, true);
    assert.equal(await f.image.compareImages(f.initialImage, decoded), 'matched');
    assert.equal(await f.image.compareImages(current, decoded), 'conflict');
    assert.equal(mutations().length, 0);
    pendingScope.assertPending(f);
  });
