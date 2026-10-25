// Whole-upgrade producer proof: production source, encrypted native Realm,
// real Redux/AES and transactional loopback Relay. Prerequisites fail loudly.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { runSaga } = require('redux-saga');
const { createRealmClient, declarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const fixtureModule = process.env.KEEPER_RELAY_FIXTURE_MODULE;
assert.ok(fixtureModule, 'Set KEEPER_RELAY_FIXTURE_MODULE to Relay tests/support/automaticBackupHttpFixture.cjs');
const { createFixture } = require(fixtureModule);
let server;
before(async () => { server = await createFixture(); });
after(async () => { await server?.close(); Realm.shutdown(); });
const writes = () => server.trace.filter((entry) => entry.path === '/revisionedBackupMutation');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function barrier() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

function wallet(f) {
  return f.defaults(f.RealmSchema.Wallet, {
    id: 'upgrade-wallet', entityKind: f.enums.EntityKind.WALLET, type: f.enums.WalletType.DEFAULT,
    networkType: f.enums.NetworkType.TESTNET, scriptType: 'P2WPKH',
    derivationDetails: f.defaults(f.RealmSchema.WalletDerivationDetails, { instanceNum: 0, xDerivationPath: "m/84'/1'/0'" }),
    presentationData: f.defaults(f.RealmSchema.WalletPresentationData, { name: 'Disposable legacy wallet', visibility: 'DEFAULT' }),
    specs: f.defaults(f.RealmSchema.WalletSpecs, { xpub: 'disposable-upgrade-public-wallet', nextFreeAddressIndex: 1 }),
  });
}

function persistVaults(f) {
  const key = f.defaults(f.RealmSchema.Signer, {
    masterFingerprint: 'AABB0011', type: f.enums.SignerType.COLDCARD,
    storageType: f.enums.SignerStorage.COLD, networkType: f.enums.NetworkType.TESTNET,
    signerName: 'Disposable public signer',
    signerXpubs: f.defaults(f.RealmSchema.SignerXpubs, {
      [f.enums.XpubTypes.P2WSH]: [{ xpub: 'disposable-upgrade-public-vault', xpriv: null,
        derivationPath: "m/48'/1'/0'/2'" }],
    }),
  });
  key.id = f.utilities.getKeyUID(key);
  assert.equal(f.dbManager.createObject(f.RealmSchema.Signer, key), true);
  for (const [id, archived] of [['upgrade-vault', false], ['upgrade-old-vault', true]]) {
    assert.equal(f.dbManager.createObject(f.RealmSchema.Vault, f.defaults(f.RealmSchema.Vault, {
      id, archived, entityKind: f.enums.EntityKind.VAULT, type: f.enums.VaultType.DEFAULT,
      networkType: f.enums.NetworkType.TESTNET, isMultiSig: true, scriptType: 'P2WSH',
      scheme: f.defaults(f.RealmSchema.VaultScheme, { m: 1, n: 1 }),
      signers: [f.defaults(f.RealmSchema.VaultSigner, {
        ...key.signerXpubs[f.enums.XpubTypes.P2WSH][0], masterFingerprint: key.masterFingerprint,
        xfp: 'CCDD0022', registeredVaults: [],
      })],
      presentationData: f.defaults(f.RealmSchema.VaultPresentationData, { name: id, visibility: 'DEFAULT' }),
      specs: f.defaults(f.RealmSchema.VaultSpecs, { xpubs: ['disposable-upgrade-public-vault'], nextFreeAddressIndex: 1 }),
    })), true);
  }
}

const upgradeDeclarations = [
  'LABELS_INTRODUCTION_VERSION', 'BIP329_INTRODUCTION_VERSION', 'KEY_MANAGEMENT_VERSION',
  'APP_KEY_UPGRADE_VERSION', 'HEALTH_CHECK_TIMELINE_MIGRATION_VERSION', 'SIGNER_POLICY_MIGRATION_VERSION',
  'upgradeAccountIsActive', 'beginUpgradeGroup', 'completeUpgradeGroup', 'stageVersionUpdate',
  'updateReleaseTopics', 'applyUpgradeSequence', 'updateVersionHistoryWorker', 'migrateLablesWorker',
  'migrateStructureforSignersInAppImage', 'migrateStructureforVaultInAppImage', 'updateAppKeysToEnableSigning',
  'mapAppKeysToWallets', 'generateExtendedKeysForSigners', 'updateVaultSigners', 'updateSignerDetails',
  'updateSignerXpubs', 'healthCheckTimelineMigration', 'migrateServerKeyPolicy',
];

async function setup(t) {
  await server.reset();
  const f = await createRealmClient(server.url);
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  f.nativeRealm().write(() => { f.nativeRealm().objectForPrimaryKey(f.RealmSchema.KeeperApp, f.appId).version = '1.0.5'; });
  assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet(f)), true);
  persistVaults(f);
  assert.equal(f.dbManager.createObject(f.RealmSchema.UTXOInfo, f.defaults(f.RealmSchema.UTXOInfo, {
    id: 'legacy-utxo', walletId: 'upgrade-wallet', txId: 'public-legacy-tx', vout: 0,
    labels: [f.defaults(f.RealmSchema.Label, { name: 'legacy note', type: 'OUTPUT' })],
  })), true);
  await tick();
  await server.seed(await f.payloadForCurrentImage());
  const sagas = f.productionSagas([
    'currentBackupAppId', 'backupInspectionOwners', 'runBackupInspection',
    'buildAutomaticAppMutation', 'buildAutomaticVaultMutation',
  ], {
    semver: require('semver'), DeviceInfo: { getBuildNumber: () => '627' },
    getApp: () => ({}), getMessaging: () => ({}), subscribeToTopic() {}, unsubscribeFromTopic() {},
    getReleaseTopic: (version) => version,
    ...f.load('src/models/interfaces/HeathCheckTypes'),
    // These unspendable public fixtures need only public label metadata. No
    // key derivation, encryption, Realm method or backup algorithm is mocked.
    generateAbbreviatedOutputDescriptors: () => 'disposable-public-upgrade-origin',
  });
  evaluate(declarations('src/store/sagas/upgrade.ts', upgradeDeclarations), sagas.scope, 'production-upgrade-producers.ts');
  assert.equal(await sagas.run('runBackupInspection', false, f.appId), true);
  f.sagas = sagas;
  f.origin = {
    originBackupAccountSession: f.transport.currentBackupAccountSession(),
    originBackupWriteIntent: f.transport.captureBackupWriteIntent(f.appId),
  };
  assert.ok(f.origin.originBackupWriteIntent);
  f.upgrade = (metadata = {}) => sagas.run('applyUpgradeSequence', {
    previousVersion: '1.0.5', newVersion: '2.6.4', ...f.origin, ...metadata,
  });
  f.imageNow = () => f.repair.captureBackupImage();
  f.remoteImage = async () => f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    await server.snapshot(f.appId), f.appId, () => {}, true);
  server.clearTrace();
  return f;
}

function assertPending(f) {
  const state = f.store.getState().bhr;
  assert.equal(state.pendingAllBackupByAppId[f.appId], true);
  assert.notEqual(state.backupRepairCompletedByAppId[f.appId], true);
  assert.notEqual(state.backupRepairStateByAppId[f.appId], 'verified');
}

function assertLocalUpgrade(f) {
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.KeeperApp, f.appId).version, '2.6.4');
  assert.equal(f.dbManager.getCollection(f.RealmSchema.VersionHistory).length, 1);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Tags).length, 1);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Vault, 'upgrade-old-vault').archived, true);
}

test('native launch upgrade commits labels, health and version before one app/live/archive/label CAS fanout', async (t) => {
  const f = await setup(t);
  assert.equal(await f.upgrade(), true);
  assertLocalUpgrade(f);
  assert.deepEqual(writes().map((entry) => entry.operation),
    ['updateAppImage', 'updateVaultImage', 'updateVaultImage', 'modifyLabels']);
  assert.ok(writes().every((entry) => entry.committed));
  const local = await f.imageNow();
  const remote = await f.remoteImage();
  assert.equal(await f.image.compareImages(local, remote), 'matched');
  assert.equal((await server.snapshot(f.appId)).appImage.version, '2.6.4');
  assert.equal(remote.vaults['upgrade-old-vault'].archived, true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[f.appId], true);
});

test('native invalid late version field rolls back every staged label/health edit and sends nothing', async (t) => {
  const f = await setup(t);
  const before = await f.imageNow();
  assert.equal(await f.upgrade({ newVersion: null }), false);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.KeeperApp, f.appId).version, '1.0.5');
  assert.equal(f.dbManager.getCollection(f.RealmSchema.VersionHistory).length, 0);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Tags).length, 0);
  assert.equal(await f.image.compareImages(before, await f.imageNow()), 'matched');
  assert.equal(writes().length, 0);
  assert.equal((await server.snapshot(f.appId)).appImage.version, '1.0.5');
});

test('native no-original-baseline upgrade preserves local migrated data with zero HTTP mutations', async (t) => {
  const f = await setup(t);
  assert.equal(await f.upgrade({ originBackupWriteIntent: undefined }), true);
  assertLocalUpgrade(f);
  assert.equal(writes().length, 0);
  assert.equal((await server.snapshot(f.appId)).appImage.version, '1.0.5');
  assertPending(f);
});

test('native A to B to A rejects an older originating upgrade before any local migration', async (t) => {
  const f = await setup(t);
  await f.selectAccount('disposable-other-account');
  await f.selectAccount(f.appId);
  assert.equal(await f.upgrade(), false);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.KeeperApp, f.appId).version, '1.0.5');
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Tags).length, 0);
  assert.equal(writes().length, 0);
});

test('native upgrade captured before async label read cannot commit after A to B to A', async (t) => {
  const f = await setup(t);
  const entered = barrier(), resume = barrier();
  let paused = false;
  const gate = (next) => (effect) => {
    if (!paused && effect.type === 'CALL' && effect.payload.fn === f.dbManager.getCollection &&
      effect.payload.args[0] === f.RealmSchema.UTXOInfo) {
      paused = true;
      next({ ...effect, payload: { ...effect.payload, fn: async (...args) => {
        entered.release(); await resume.promise;
        return f.dbManager.getCollection(...args);
      } } });
    } else next(effect);
  };
  const pending = runSaga({ getState: f.store.getState, dispatch: f.store.dispatch,
    effectMiddlewares: [gate] }, f.sagas.scope.applyUpgradeSequence, {
    previousVersion: '1.0.5', newVersion: '2.6.4', ...f.origin,
  }).toPromise();
  await entered.promise;
  await f.selectAccount('disposable-other-account');
  await f.selectAccount(f.appId);
  resume.release();
  assert.equal(await pending, false);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.KeeperApp, f.appId).version, '1.0.5');
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Tags).length, 0);
  assert.equal(writes().length, 0);
});

for (const mode of ['409', 'lost-reply']) {
  test(`native upgrade ${mode} keeps all committed local migrations pending`, async (t) => {
    const f = await setup(t);
    server.armFault({ mode, operation: mode === '409' ? 'updateVaultImage' : 'updateAppImage' });
    assert.equal(await f.upgrade(), true);
    assertLocalUpgrade(f);
    assert.equal(writes().length, mode === '409' ? 2 : 1);
    assert.equal(writes()[0].committed, true);
    assertPending(f);
  });
}

test('native complete upgrade rejects malformed final metadata readback without losing local data', async (t) => {
  const f = await setup(t);
  server.armFault({ mode: 'malformed-metadata', after: 1, metadata: { version: 'wrong-version' } });
  assert.equal(await f.upgrade(), true);
  assertLocalUpgrade(f);
  assert.equal(writes().length, 4);
  assert.ok(writes().every((entry) => entry.committed));
  assertPending(f);
});

test('native already-consumed original baseline never uploads a second launch upgrade', async (t) => {
  const f = await setup(t);
  assert.equal(await f.upgrade(), true);
  assert.equal(writes().length, 4);
  server.clearTrace();
  assert.equal(await f.upgrade(), true);
  assert.equal(writes().length, 0);
  assertLocalUpgrade(f);
  assertPending(f);
});
