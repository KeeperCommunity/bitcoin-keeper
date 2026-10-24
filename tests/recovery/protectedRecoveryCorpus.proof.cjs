// Two additive retained-data witnesses. The existing synthetic corpus is public
// and unfunded. Real production recovery/crypto/encrypted Realm/signed HTTP and
// current Relay remain unchanged. No token/provider or native UI path executes.
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { isDeepStrictEqual } = require('node:util');
const bip39 = require('bip39');
const { TronWeb } = require('tronweb');
const { test, beforeEach, afterEach, after } = require('node:test');
const { declarations, classMembers, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = bip39.mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
const check = (value, code) => assert.ok(value, code);
const equal = (a, b, code) => check(isDeepStrictEqual(a, b), code);
const tick = () => new Promise(resolve => setImmediate(resolve));
let server;
beforeEach(async () => { server = await createProtectedServer(); });
afterEach(async () => { await server?.close(); server = undefined; });
after(() => { seed.fill(0); Realm.shutdown(); });

function recoverySagas(f) {
  // Evaluate the same production crypto/worker setup used by the existing
  // recovery corpus and 43-case proof, without scheduling its historical lane.
  const scope = { require, crypto, bip39, declarations, classMembers, evaluate };
  evaluate(declarations('tests/recovery/automaticRecoveryRestore.integration.cjs', ['cryptoAndRecovery']),
    scope, 'unchanged-production-recovery-crypto-setup.ts');
  return scope.cryptoAndRecovery(f);
}

function populateExistingCorpus(f, saga) {
  // Reuse only the original record-building statements. Its public-v2 server
  // setup calls are outside this selection; current setup below uses genuine
  // seedLegacy/enrollment/repair and never changes that old file or fixture.
  const original = declarations('tests/recovery/automaticRecoveryRestore.integration.cjs', ['sourceFixture']);
  const start = original.indexOf('const fingerprint = source.scope.WalletUtilities.getFingerprintFromSeed(seed);');
  const end = original.indexOf('await server.seed(await f.payloadForCurrentImage());');
  check(start > 0 && end > start, 'CORPUS_SETUP_SELECTION_CHANGED');
  const selected = original.slice(start, end);
  check(!selected.includes('await server.') && !selected.includes('createRealmClient'), 'CORPUS_SETUP_BOUNDARY_CHANGED');
  check(crypto.createHash('sha256').update(selected).digest('hex') ===
    '852f8be219994ee9f8e0af5c2da91046f7dc11bd462cbb7d6591e2365ba80ce9', 'ORIGINAL_CORPUS_STATEMENT_BYTES_MUST_MATCH');
  // Original sourceFixture is a Node function. Realm.Mixed rejects VM-foreign
  // Object literals (first encountered by USDT accountStatus.fees). Compile
  // these exact public data statements with the original host constructors;
  // do not JSON-roundtrip, drop a field or replace a database/crypto result.
  const populate = vm.runInThisContext(`(function(f, source, assert, seed, mnemonic, TronWeb) {
${selected}
return { recoveryKey, fingerprint }; })`, { filename: 'unchanged-public-mixed-recovery-records.cjs' });
  check(Object.getPrototypeOf(populate) === Function.prototype, 'ORIGINAL_NODE_BUILDER_CONSTRUCTORS_REQUIRED');
  return populate(f, saga, assert, seed, mnemonic, TronWeb);
}

async function sourceCorpus(t) {
  await server.reset();
  const f = await createProtectedRealmClient(server.url, { appId, primarySeed: seed.toString('hex'), primaryMnemonic: mnemonic });
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  const identity = populateExistingCorpus(f, recoverySagas(f));
  const expected = await f.repair.captureBackupImage();
  // Provision the source fixture before measuring read-only recovery. Target
  // consent and authority are independent; no seeding state is copied to it.
  await server.seedLegacy(await f.payloadForCurrentImage());
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId, enabled: true }));
  await tick();
  const inspection = f.productionSagas(['currentBackupAppId', 'backupInspectionOwners', 'runBackupInspection']);
  assert.equal(await inspection.run('runBackupInspection', true, appId, true), true);
  const remote = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(remote.state, 'present');
  const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote.snapshot, remote.namespaceId);
  assert.equal(await f.image.compareImages(expected, decoded), 'matched');
  check(remote.namespaceId !== appId, 'PROTECTED_NAMESPACE_MUST_NOT_REPLACE_KEEPER_ID');
  return { source: f, expected, ...identity, remote };
}

function assertBlankRecovery(f) {
  for (const schema of ['KeeperApp', 'Wallet', 'USDTWallet', 'Vault', 'VaultSigner', 'Signer', 'Tags', 'NodeConnect', 'BackupHistory', 'VersionHistory'])
    assert.equal(f.nativeRealm().objects(schema).length, 0);
  assert.equal(f.store.getState().storage.appCreated, false);
}

async function target(t) {
  const f = await createProtectedRealmClient(server.url, { appId, primarySeed: seed.toString('hex'), primaryMnemonic: mnemonic });
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  const saga = recoverySagas(f);
  f.realmDatabase.closeDatabase();
  const filename = path.join(f.directory, 'mixed-corpus-restore.realm');
  assert.equal((await f.dbManager.initializeRealm(Buffer.alloc(64, 7), filename)).success, true);
  f.store.dispatch(f.storage.setAppId(''));
  f.store.dispatch(f.account.setTempDetails({ hash: f.encryption.hash256('public-disposable-passcode-fixture'),
    realmId: filename, accountIdentifier: 'disposable mixed corpus restore' }));
  assertBlankRecovery(f);
  check(f.store.getState().bhr.automaticCloudBackupByAppId[appId] !== true, 'TARGET_MUST_BEGIN_WITHOUT_CONSENT');
  let consentGranted = false;
  const unsubscribe = f.store.subscribe(() => {
    if (f.store.getState().bhr.automaticCloudBackupByAppId[appId] === true) consentGranted = true;
  });
  t.after(unsubscribe);
  return { f, saga, filename, consentGranted: () => consentGranted };
}

async function storedProjection() {
  const db = server.backend.mongoose.connection.db;
  // Only this fixture's owned database; raw documents remain in memory and
  // never enter TAP diagnostics, files or artifacts, even on comparison failure.
  const result = {};
  for (const collection of ['apps', 'appimages', 'appVaultImages', 'labels', 'protectedBackupNamespaces', 'protectedBackupRecords'])
    result[collection] = await db.collection(collection).find({}).sort({ _id: 1 }).toArray();
  return result;
}

function readOnlyRecovery(destination, expectedSource) {
  const { f } = destination;
  assert.equal(destination.consentGranted(), false, 'Recovery cannot temporarily grant consent');
  assert.equal(server.trace.filter(event => event.path === '/backup/v3/mutate').length, 0);
  assert.equal(server.trace.filter(event => event.path === '/backup/v3/enroll').length, 0);
  assert.equal(server.trace.filter(event => event.path === '/getAppImage').length, expectedSource === 'protected' ? 0 : 1);
  assert.equal(server.trace.filter(event => event.legacyRead && event.path !== '/getAppImage').length, 0);
  check(server.backend.loader.blockedProviderCalls.length === 0, 'NO_PROVIDER_OPERATION_ALLOWED');
  const state = f.store.getState();
  assert.equal(state.bhr.automaticCloudBackupByAppId[appId], false);
  assert.equal(f.automatic.isBackupVerificationCurrent(appId), false);
  assert.equal(f.transport.captureBackupWriteIntent(appId), undefined);
  assert.equal(state.account.recoveryKeyStatusByAppId[appId], 'confirmed');
  assert.equal(state.bhr.recoveryDiscovery.status, 'restored');
  assert.equal(state.bhr.recoveryDiscovery.provenance.source, expectedSource);
  check(state.bhr.recoveryDiscovery.provenance.keeperAppId === appId, 'RECOVERY_PROVENANCE_MUST_RETAIN_KEEPER_ID');
  check(state.storage.appId === appId, 'KEEPER_ID_MUST_REMAIN_ORIGINAL');
}

async function completeCorpus(f, origin) {
  const state = f.store.getState();
  assert.equal(state.storage.appCreated, true);
  assert.equal(state.bhr.appImageError, '');
  const app = f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp);
  check(app.id === appId && app.primarySeed === seed.toString('hex') && app.primaryMnemonic === mnemonic &&
    app.publicId === origin.fingerprint, 'RECOVERED_ACCOUNT_IDENTITY_MUST_MATCH_SOURCE');
  const restored = await f.repair.captureBackupImage();
  assert.equal(await f.image.compareImages(origin.expected, restored), 'matched');
  equal(Object.fromEntries(Object.entries(restored).map(([kind, records]) => [kind, Object.keys(records).length])),
    { wallets: 4, signers: 2, vaults: 2, nodes: 2, labels: 1 }, 'EVERY_CORPUS_COLLECTION_MUST_SURVIVE');
  for (const [id, external, change, total] of [['native-recovery-wallet', 9, 4, 12], ['mainnet-recovery-wallet', 13, 6, 15]]) {
    equal(plain(restored.wallets[id]), plain(origin.expected.wallets[id]), 'ENTIRE_EXISTING_BTC_RECORD_MUST_SURVIVE');
    const specs = restored.wallets[id].specs;
    equal([specs.nextFreeAddressIndex, specs.nextFreeChangeAddressIndex, specs.totalExternalAddresses],
      [external, change, total], 'RETAINED_ADDRESS_COUNTERS_MUST_MATCH');
  }
  equal(new Set(['native-recovery-wallet', 'mainnet-recovery-wallet'].map(id => restored.wallets[id].networkType)),
    new Set([f.enums.NetworkType.MAINNET, f.enums.NetworkType.TESTNET]), 'BOTH_BTC_NETWORKS_MUST_SURVIVE');
  const manual = restored.wallets['native-recovery-wallet'].specs.confirmedUTXOs;
  check(manual.length === 1 && manual[0].txId === '11'.repeat(32) && manual[0].vout === 0 &&
    manual[0].spendability === 'doNotSpend' && manual[0].isManualOverride === true, 'MANUAL_COIN_CHOICE_MUST_SURVIVE');
  for (const type of ['DEFAULT', 'IMPORTED']) {
    const record = restored.wallets['retained-usdt-' + type];
    equal(plain(record), plain(origin.expected.wallets[record.id]), 'EVERY_EXISTING_USDT_PRIVATE_CACHE_AND_METADATA_FIELD_MUST_SURVIVE');
    check(TronWeb.isAddress(record.accountStatus.address) && TronWeb.isAddress(record.accountStatus.gasFreeAddress), 'PUBLIC_STATIC_USDT_ADDRESSES_MUST_REMAIN_VALID');
    assert.equal(record.presentationData.visibility, 'HIDDEN');
  }
  equal(plain(restored.signers), plain(origin.expected.signers), 'ALL_SIGNER_FIELDS_MUST_SURVIVE');
  const recoveryId = f.utilities.getKeyUID(origin.recoveryKey);
  equal(plain(restored.signers[recoveryId].signerXpubs), plain(origin.expected.signers[recoveryId].signerXpubs),
    'PRODUCTION_RECOVERY_KEY_MATERIAL_MUST_MATCH');
  equal(plain(restored.vaults), plain(origin.expected.vaults), 'ACTIVE_ARCHIVED_VAULT_POLICIES_AND_REGISTRATIONS_MUST_SURVIVE');
  const active = f.dbManager.getObjectById(f.RealmSchema.Vault, 'active-recovery-vault');
  const archived = f.dbManager.getObjectById(f.RealmSchema.Vault, 'archived-recovery-vault');
  assert.equal(active.archived, false); assert.equal(archived.archived, true);
  assert.equal(f.nativeRealm().objects(f.RealmSchema.VaultSigner).length, 1);
  check(active.signers[0].xpub === archived.signers[0].xpub && active.signers[0].xpriv === null,
    'NATIVE_VAULTS_MUST_SHARE_THE_RETAINED_PUBLIC_SIGNER');
  equal(plain(active.signers[0].registeredVaults), plain(origin.expected.vaults['active-recovery-vault'].signers[0].registeredVaults),
    'BOTH_ACTIVE_AND_ARCHIVED_REGISTRATION_RECEIPTS_MUST_SURVIVE');
  equal(plain(restored.labels), plain(origin.expected.labels), 'ALL_LABELS_MUST_SURVIVE');
  const nodeContent = image => Object.fromEntries(Object.entries(image.nodes).map(([id, node]) =>
    [id, plain(f.image.recoveryContent('nodes', node))]));
  equal(nodeContent(restored), nodeContent(origin.expected), 'BOTH_NETWORK_NODE_CONFIGURATIONS_MUST_SURVIVE');
  const nodes = Array.from(f.dbManager.getCollection(f.RealmSchema.NodeConnect));
  assert.equal(nodes[0].isConnected, true); check(nodes.slice(1).every(node => !node.isConnected), 'ONLY_LOCAL_FIRST_NODE_SELECTION_IS_EXPECTED');
}

async function reopenEncrypted(target, origin) {
  const { f, filename } = target;
  check(!fs.readFileSync(filename).includes(Buffer.from(mnemonic)), 'NATIVE_REALM_MUST_NOT_STORE_PLAINTEXT_RECOVERY_WORDS');
  f.realmDatabase.closeDatabase();
  assert.throws(() => new Realm({ path: filename, encryptionKey: Buffer.alloc(64, 8), readOnly: true }));
  assert.equal((await f.dbManager.initializeRealm(Buffer.alloc(64, 7), filename)).success, true);
  await completeCorpus(f, origin);
}

test('protected-default actual recovery preserves the entire mixed corpus without writes enrollment consent or implicit older selection', { timeout: 35_000 }, async t => {
  const origin = await sourceCorpus(t), destination = await target(t);
  const before = await storedProjection();
  server.clearTrace();
  await destination.saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic } });
  await completeCorpus(destination.f, origin);
  readOnlyRecovery(destination, 'protected');
  check(destination.f.store.getState().bhr.recoveryDiscovery.provenance.namespaceId === origin.remote.namespaceId,
    'PROTECTED_PROVENANCE_MUST_BIND_ORIGINAL_NAMESPACE');
  equal(await storedProjection(), before, 'RECOVERY_MUST_NOT_CHANGE_ANY_REMOTE_PROJECTION');
  assert.equal(server.trace.filter(event => event.path === '/backup/v3/snapshot').length, 1);
  await reopenEncrypted(destination, origin);
});

test('protected tombstone suppresses implicit fallback and explicit older selection preserves the entire mixed corpus read-only', { timeout: 35_000 }, async t => {
  const origin = await sourceCorpus(t), f = origin.source;
  const receipt = await f.automatic.beginBackupDeleteOperation(appId, f.transport.currentBackupAccountSession());
  assert.equal(receipt.committed, true); check(!!receipt.intent?.protectedBase, 'SOURCE_DELETE_REQUIRES_ORIGINAL_AUTHORITY');
  assert.equal((await f.Relay.deleteBackup({ appId }, receipt.intent)).backupConfirmed, true);
  const deleted = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(deleted.state, 'deleted'); assert.equal(deleted.snapshot.suppressLegacyFallback, true);
  check(deleted.namespaceId === origin.remote.namespaceId, 'DELETE_MUST_RETAIN_ORIGINAL_NAMESPACE');
  const destination = await target(t), before = await storedProjection();
  server.clearTrace();
  await destination.saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic } });
  assert.equal(destination.f.store.getState().bhr.recoveryDiscovery.status, 'protected-deleted');
  assertBlankRecovery(destination.f);
  assert.equal(server.trace.filter(event => event.legacyRead).length, 0);
  check(destination.f.store.getState().bhr.automaticCloudBackupByAppId[appId] !== true, 'TOMBSTONE_CANNOT_GRANT_CONSENT');
  equal(await storedProjection(), before, 'DEFAULT_TOMBSTONE_DISCOVERY_MUST_REMAIN_READ_ONLY');
  await destination.saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic,
    selection: { source: 'legacy-older', olderCopyConfirmed: true } } });
  await completeCorpus(destination.f, origin);
  readOnlyRecovery(destination, 'legacy-older');
  assert.equal(destination.f.store.getState().bhr.recoveryDiscovery.provenance.legacyMayPredateDeletion, true);
  equal(await storedProjection(), before, 'EXPLICIT_OLDER_RECOVERY_MUST_RETAIN_TOMBSTONE_AND_OLDER_BYTES');
  const after = await destination.f.protected.readProtectedBackup(mnemonic, undefined, appId);
  assert.equal(after.state, 'deleted');
  equal(after.snapshot, deleted.snapshot, 'RECOVERY_MUST_PRESERVE_TOMBSTONE_GENERATION_EPOCH_AND_CONTENT');
  check(after.namespaceId === deleted.namespaceId, 'EXPLICIT_OLDER_RECOVERY_CANNOT_CHANGE_PROTECTED_NAMESPACE');
  assert.equal(server.trace.filter(event => event.path === '/backup/v3/snapshot').length, 2);
  await reopenEncrypted(destination, origin);
});
