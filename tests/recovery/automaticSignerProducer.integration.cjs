// Real signer producers, native encrypted Realm, Redux, AES and transactional
// HTTP Relay. Public disposable derivation/compiler fixtures never sign funds.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const BIP32Factory = require('bip32').default;
const vm = require('node:vm');
const ts = require('typescript');
const { networks } = require('bitcoinjs-lib');
const {
  createRealmClient,
  declarations,
  evaluate,
  plain,
  Realm,
} = require('./automaticWriteRealmRelay.fixture.cjs');
const fixtureModule = process.env.KEEPER_RELAY_FIXTURE_MODULE;
assert.ok(fixtureModule, 'Set KEEPER_RELAY_FIXTURE_MODULE to the disposable Relay fixture');
const { createFixture } = require(fixtureModule);
let server;
before(async () => {
  server = await createFixture();
});
after(async () => {
  await server?.close();
  Realm.shutdown();
});
const writes = () => server.trace.filter((entry) => entry.path === '/revisionedBackupMutation');
const names = [
  'currentWalletAccountId',
  'assertWalletAccount',
  'rewriteSignerFingerprintReferences',
  'planSignerIdentityMerges',
  'applySignerIdentityMerges',
  'applySignerXprivUpdates',
  'buildSignerMigrationMutation',
  'mergeSimilarKeysWorker',
  'updateKeyDetailsWorker',
];

function publicKey(f, seedByte = 11) {
  const ecc = f.load('src/services/wallets/operations/taproot-utils/noble_ecc').default;
  const root = BIP32Factory(ecc).fromSeed(Buffer.alloc(32, seedByte), networks.testnet);
  const derivationPath = "m/48'/1'/0'/2'";
  const child = root.derivePath(derivationPath);
  return {
    masterFingerprint: root.fingerprint.toString('hex').toUpperCase(),
    xfp: child.fingerprint.toString('hex').toUpperCase(),
    xpub: child.neutered().toBase58(),
    derivationPath,
  };
}

function loadHostProducers(scope) {
  // Native Realm's Mixed conversion requires this host's Object constructor.
  // Compile the unchanged production declarations into the same JS host as
  // Realm rather than wrapping/normalizing their native writes or schemas.
  const bindings = Object.keys(scope).filter(
    (name) => name !== 'default' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
  );
  const code = ts.transpileModule(declarations('src/store/sagas/wallets.ts', names), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const factory = vm.runInThisContext(
    '(function (' + bindings.join(',') + ') {\n' + code + '\nreturn {' + names.join(',') + '};\n})',
    { filename: 'actual-host-signer-producers.ts' }
  );
  Object.assign(scope, factory(...bindings.map((name) => scope[name])));
}

function miniscript(f, key) {
  const scope = {
    ...f.enums,
    ...f.utilities,
    ...f.load('src/services/wallets/operations/miniscript/policy-generator'),
    ...f.load('src/services/wallets/operations/miniscript/miniscript'),
  };
  evaluate(
    declarations('src/utils/service-utilities/utils.ts', ['getDerivationPath']),
    scope,
    'public-derivation-path.ts'
  );
  evaluate(
    declarations('src/services/wallets/operations/miniscript/default/EnhancedVault.ts', [
      'INHERITANCE_KEY_IDENTIFIER',
      'EMERGENCY_KEY_IDENTIFIER',
      'generateEnhancedVaultElements',
    ]),
    scope,
    'actual-enhanced-policy.ts'
  );
  evaluate(
    declarations('src/services/wallets/factories/VaultFactory.ts', ['generateMiniscriptScheme']),
    scope,
    'actual-miniscript-scheme.ts'
  );
  const elements = scope.generateEnhancedVaultElements([key], [], [], { m: 1, n: 1 }, 1800000000);
  const scheme = scope.generateMiniscriptScheme(elements, [f.enums.MiniscriptTypes.TIMELOCKED]);
  assert.ok(scheme.miniscriptPolicy.includes('after(1800000000)'));
  assert.ok(scheme.miniscript);
  return scheme;
}

async function setup(t, collision = false) {
  await server.reset();
  const f = await createRealmClient(server.url);
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  f.correctKey = publicKey(f);
  f.oldFingerprint = '00000001';
  f.oldKey = { ...f.correctKey, masterFingerprint: f.oldFingerprint };
  const signer = f.defaults(f.RealmSchema.Signer, {
    masterFingerprint: f.oldFingerprint,
    type: f.enums.SignerType.COLDCARD,
    networkType: f.enums.NetworkType.TESTNET,
    storageType: f.enums.SignerStorage.COLD,
    signerName: 'Disposable public fixture',
    signerXpubs: f.defaults(f.RealmSchema.SignerXpubs, {
      [f.enums.XpubTypes.P2WSH]: [
        { xpub: f.correctKey.xpub, xpriv: null, derivationPath: f.correctKey.derivationPath },
      ],
    }),
  });
  signer.id = f.utilities.getKeyUID(signer);
  f.oldId = signer.id;
  f.correctSigner = { ...signer, masterFingerprint: f.correctKey.masterFingerprint };
  f.correctSigner.id = f.utilities.getKeyUID(f.correctSigner);
  f.newId = f.correctSigner.id;
  assert.notEqual(f.oldId, f.newId);
  assert.equal(f.dbManager.createObject(f.RealmSchema.Signer, signer), true);
  if (collision) {
    f.collision = {
      ...f.correctSigner,
      signerName: 'Existing unrelated target',
      signerXpubs: f.defaults(f.RealmSchema.SignerXpubs, {
        [f.enums.XpubTypes.P2WSH]: [
          { xpub: publicKey(f, 12).xpub, xpriv: null, derivationPath: f.correctKey.derivationPath },
        ],
      }),
    };
    assert.equal(f.dbManager.createObject(f.RealmSchema.Signer, f.collision), true);
  }
  const compiled = plain(miniscript(f, f.oldKey));
  for (const [id, archived] of [
    ['signer-live-vault', false],
    ['signer-archived-vault', true],
  ]) {
    assert.equal(
      f.dbManager.createObject(
        f.RealmSchema.Vault,
        f.defaults(f.RealmSchema.Vault, {
          id,
          archived,
          entityKind: f.enums.EntityKind.VAULT,
          type: f.enums.VaultType.MINISCRIPT,
          networkType: f.enums.NetworkType.TESTNET,
          isMultiSig: true,
          scriptType: 'P2WSH',
          scheme: f.defaults(f.RealmSchema.VaultScheme, {
            m: 1,
            n: 1,
            multisigScriptType: f.enums.MultisigScriptType.MINISCRIPT_MULTISIG,
            miniscriptScheme: compiled,
          }),
          signers: [
            f.defaults(f.RealmSchema.VaultSigner, {
              ...f.oldKey,
              xpriv: null,
              registeredVaults: [],
            }),
          ],
          presentationData: f.defaults(f.RealmSchema.VaultPresentationData, {
            name: id,
            visibility: archived ? 'HIDDEN' : 'DEFAULT',
          }),
          specs: f.defaults(f.RealmSchema.VaultSpecs, {
            xpubs: [f.correctKey.xpub],
            nextFreeAddressIndex: 1,
          }),
        })
      ),
      true
    );
  }
  await server.seed(await f.payloadForCurrentImage());
  f.sagas = f.productionSagas(
    [
      'currentBackupAppId',
      'backupInspectionOwners',
      'runBackupInspection',
      'buildAutomaticAppMutation',
      'buildAutomaticVaultMutation',
      'queueCommittedBackupWorker',
    ],
    { _: require('lodash') }
  );
  loadHostProducers(f.sagas.scope);
  assert.equal(await f.sagas.run('runBackupInspection', false, f.appId), true);
  f.before = await f.repair.captureBackupImage();
  f.origin = {
    originAppId: f.appId,
    originBackupAccountSession: f.transport.currentBackupAccountSession(),
    originBackupWriteIntent: f.transport.captureBackupWriteIntent(f.appId),
  };
  assert.ok(f.origin.originBackupWriteIntent);
  f.merge = (origin = f.origin) =>
    f.sagas.run('mergeSimilarKeysWorker', {
      ...origin,
      payload: { signer: plain(f.correctSigner) },
    });
  f.register = () =>
    f.sagas.run('updateKeyDetailsWorker', {
      ...f.origin,
      payload: {
        signer: f.oldKey,
        key: 'registered',
        value: {
          vaultId: 'signer-live-vault',
          registered: true,
          registrationInfo: 'public-fixture-registration',
          hmac: 'public-fixture-hmac',
        },
      },
    });
  f.remoteImage = async () =>
    f.image.decodeImage(
      f.encryption.generateEncryptionKey(f.seed),
      await server.snapshot(f.appId),
      f.appId,
      () => {},
      true
    );
  server.clearTrace();
  return f;
}

function assertPending(f) {
  const bhr = f.store.getState().bhr;
  assert.equal(bhr.pendingAllBackupByAppId[f.appId], true);
  assert.notEqual(bhr.backupRepairCompletedByAppId[f.appId], true);
  assert.notEqual(bhr.backupRepairStateByAppId[f.appId], 'verified');
}

async function assertMergedLocal(f) {
  const image = await f.repair.captureBackupImage();
  assert.ok(image.signers[f.newId]);
  assert.equal(image.signers[f.oldId], undefined);
  for (const id of ['signer-live-vault', 'signer-archived-vault']) {
    const before = f.before.vaults[id],
      after = image.vaults[id];
    const original = before.scheme.miniscriptScheme,
      corrected = after.scheme.miniscriptScheme;
    assert.equal(after.signers[0].masterFingerprint, f.correctKey.masterFingerprint);
    for (const field of ['xpub', 'xfp', 'derivationPath', 'xpriv', 'registeredVaults'])
      assert.deepEqual(after.signers[0][field], before.signers[0][field]);
    assert.equal(corrected.miniscript, original.miniscript);
    assert.equal(corrected.miniscriptPolicy, original.miniscriptPolicy);
    assert.deepEqual(corrected.miniscriptElements.timelocks, original.miniscriptElements.timelocks);
    assert.deepEqual(corrected.miniscriptElements.signerFingerprints, {
      K1: f.correctKey.masterFingerprint,
    });
    assert.ok(
      corrected.miniscriptElements.keysInfo.every((key) =>
        key.descriptor.startsWith('[' + f.correctKey.masterFingerprint + '/')
      )
    );
    for (const phase of corrected.miniscriptElements.phases)
      for (const path of phase.paths)
        for (const key of path.keys)
          assert.ok(key.descriptor.startsWith('[' + f.correctKey.masterFingerprint + '/'));
    assert.ok(
      Object.values(corrected.keyInfoMap).every((value) =>
        value.startsWith('[' + f.correctKey.masterFingerprint + '/')
      )
    );
    assert.deepEqual(Object.keys(corrected.keyInfoMap), Object.keys(original.keyInfoMap));
    assert.equal(after.archived, before.archived);
  }
  return image;
}

test('native signer correction updates new identity and live/archive origins before removing old remote identity', async (t) => {
  const f = await setup(t);
  assert.equal(await f.merge(), true);
  const local = await assertMergedLocal(f);
  assert.deepEqual(
    writes().map((entry) => entry.operation),
    ['updateAppImage', 'updateVaultImage', 'updateVaultImage', 'migrateXfps']
  );
  assert.ok(writes().every((entry) => entry.committed));
  const remote = await f.remoteImage();
  assert.equal(await f.image.compareImages(local, remote), 'matched');
  assert.equal(remote.signers[f.oldId], undefined);
  assert.ok(remote.signers[f.newId]);
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[f.appId], true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
});

for (const mode of ['409', 'lost-reply'])
  test(`native signer correction ${mode} keeps complete local correction and remote prefix pending`, async (t) => {
    const f = await setup(t);
    server.armFault({ mode, operation: mode === '409' ? 'updateVaultImage' : 'updateAppImage' });
    assert.equal(await f.merge(), true);
    await assertMergedLocal(f);
    assert.equal(writes().length, mode === '409' ? 2 : 1);
    assert.equal(writes()[0].committed, true);
    const remote = await f.remoteImage();
    assert.ok(remote.signers[f.oldId], 'old identity survives an incomplete fanout');
    assert.ok(remote.signers[f.newId], 'new identity was added without removing old identity');
    assert.equal(remote.vaults['signer-live-vault'].signers[0].masterFingerprint, f.oldFingerprint);
    assertPending(f);
  });

test('native signer identity collision rolls back without replacing the existing target or any vault', async (t) => {
  const f = await setup(t, true);
  assert.equal(await f.merge(), false);
  assert.equal(writes().length, 0);
  assert.equal(
    await f.image.compareImages(f.before, await f.repair.captureBackupImage()),
    'matched'
  );
  assert.equal(
    f.dbManager.getObjectById(f.RealmSchema.Signer, f.newId).signerName,
    'Existing unrelated target'
  );
});

test('native final signer removal rejection keeps both remote identities and every corrected vault recoverable', async (t) => {
  const f = await setup(t);
  server.armFault({ mode: '409', operation: 'migrateXfps' });
  assert.equal(await f.merge(), true);
  await assertMergedLocal(f);
  assert.equal(writes().length, 4);
  assert.ok(
    writes()
      .slice(0, 3)
      .every((entry) => entry.committed)
  );
  assert.equal(writes()[3].committed, false);
  const remote = await f.remoteImage();
  assert.ok(remote.signers[f.oldId]);
  assert.ok(remote.signers[f.newId]);
  for (const id of ['signer-live-vault', 'signer-archived-vault'])
    assert.equal(remote.vaults[id].signers[0].masterFingerprint, f.correctKey.masterFingerprint);
  assertPending(f);
});

test('native registration updates the persisted shared key and both live/archive ciphertexts', async (t) => {
  const f = await setup(t);
  assert.equal(await f.register(), true);
  const local = await f.repair.captureBackupImage();
  assert.deepEqual(
    writes().map((entry) => entry.operation),
    ['updateVaultImage', 'updateVaultImage']
  );
  assert.ok(writes().every((entry) => entry.committed));
  for (const id of ['signer-live-vault', 'signer-archived-vault']) {
    const registrations = local.vaults[id].signers[0].registeredVaults;
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].registered, true);
    assert.equal(registrations[0].registrationInfo, 'public-fixture-registration');
    assert.equal(registrations[0].hmac, 'public-fixture-hmac');
    assert.deepEqual(local.vaults[id].scheme, f.before.vaults[id].scheme);
  }
  assert.equal(await f.image.compareImages(local, await f.remoteImage()), 'matched');
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[f.appId], true);
});

test('native registration rejected during second vault CAS preserves local registration and remains pending', async (t) => {
  const f = await setup(t);
  server.armFault({ mode: '409', operation: 'updateVaultImage', after: 1 });
  assert.equal(await f.register(), true);
  const local = await f.repair.captureBackupImage();
  assert.equal(local.vaults['signer-live-vault'].signers[0].registeredVaults[0].registered, true);
  assert.equal(
    local.vaults['signer-archived-vault'].signers[0].registeredVaults[0].registered,
    true
  );
  assert.equal(writes().length, 2);
  assert.equal(writes()[0].committed, true);
  assert.equal(writes()[1].committed, false);
  assertPending(f);
});

test('native signer producer keeps local correction without an originating base and sends no HTTP mutation', async (t) => {
  const f = await setup(t);
  assert.equal(await f.merge({ ...f.origin, originBackupWriteIntent: undefined }), true);
  await assertMergedLocal(f);
  assert.equal(writes().length, 0);
  assertPending(f);
});

test('native signer producer rejects the old account session after A to B to A', async (t) => {
  const f = await setup(t);
  await f.selectAccount('disposable-other-account');
  await f.selectAccount(f.appId);
  assert.equal(await f.merge(), false);
  assert.equal(writes().length, 0);
  assert.equal(
    await f.image.compareImages(f.before, await f.repair.captureBackupImage()),
    'matched'
  );
});
