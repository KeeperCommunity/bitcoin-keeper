// Additive genuine signed-v3 ports of all nine historical signer callers.
// Actual production workers, encrypted Realm, authority, AES and transactional
// HTTP remain real. Disposable public keys do not attest a physical signer.
// No historical case, production source, fixture admission or backend is changed.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const test = (name, run) => nodeTest(name, { timeout: 30000 }, run);
const BIP32Factory = require('bip32').default;
const vm = require('node:vm');
const ts = require('typescript');
const { networks } = require('bitcoinjs-lib');
const {
  declarations,
  evaluate,
  plain,
  Realm,
} = require('./automaticWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
let server;
// A fresh actual router keeps production admission limits unchanged per case.
beforeEach(async () => { server = await createProtectedServer(); });
afterEach(async () => { await server?.close(); server = undefined; });
after(() => { seed.fill(0); Realm.shutdown(); });
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');
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
  const f = await createProtectedRealmClient(server.url, {
    appId, primarySeed: seed.toString('hex'), primaryMnemonic: mnemonic,
  });
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
  const enqueue = f.sagas.scope.enqueueAutomaticBackupOperation;
  f.submissions = [];
  f.sagas.scope.enqueueAutomaticBackupOperation = (receipt, mutations) => {
    // Observe the actual caller arguments and delegate them unchanged.
    f.submissions.push({ receipt, mutations });
    return enqueue(receipt, mutations);
  };
  loadHostProducers(f.sagas.scope);
  assert.equal(await f.sagas.run('runBackupInspection', true, f.appId, true), true,
    'Only explicit actual opt-in may enroll, repair and verify the protected namespace');
  f.before = await f.repair.captureBackupImage();
  const vaultActions = f.load('src/store/sagaActions/vaults');
  const walletActions = f.load('src/store/sagaActions/wallets');
  f.mergeAction = f.store.dispatch(vaultActions.mergeSimilarKeys(plain(f.correctSigner)));
  f.registrationAction = f.store.dispatch(walletActions.updateKeyDetails(f.oldKey, 'registered', {
    vaultId: 'signer-live-vault', registered: true,
    registrationInfo: 'public-fixture-registration', hmac: 'public-fixture-hmac',
  }));
  f.origin = {
    originAppId: f.mergeAction.originAppId,
    originBackupAccountSession: f.mergeAction.originBackupAccountSession,
    originBackupWriteIntent: f.mergeAction.originBackupWriteIntent,
  };
  assert.equal(f.origin.originAppId, appId);
  assert.equal(f.origin.originBackupAccountSession, f.transport.currentBackupAccountSession());
  assert.equal(f.transport.isCapturedBackupWriteIntent(f.origin.originBackupWriteIntent), true);
  assert.ok(f.origin.originBackupWriteIntent.protectedBase);
  f.merge = (origin = f.origin) => f.sagas.run('mergeSimilarKeysWorker', { ...f.mergeAction, ...origin });
  f.register = () => f.sagas.run('updateKeyDetailsWorker', f.registrationAction);
  f.read = async () => {
    const found = await f.protected.readProtectedBackup(mnemonic, undefined, appId);
    assert.equal(found.state, 'present');
    return found;
  };
  f.remoteImage = async () => {
    const found = await f.read();
    return f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), found.snapshot, found.namespaceId);
  };
  f.submissions.length = 0;
  server.clearTrace();
  return f;
}

function assertPending(f) {
  const bhr = f.store.getState().bhr;
  assert.equal(bhr.pendingAllBackupByAppId[f.appId], true);
  assert.notEqual(bhr.backupRepairCompletedByAppId[f.appId], true);
  assert.notEqual(bhr.backupRepairStateByAppId[f.appId], 'verified');
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
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

function assertOwnTuple(previous, next) {
  assert.equal(next.namespaceId, previous.namespaceId);
  assert.equal(next.expectedRevision, previous.serverRevision);
  assert.equal(next.expectedGeneration, previous.serverGeneration);
  assert.equal(next.authEpoch, previous.serverAuthEpoch);
}

function assertOriginalTuple(event, intent) {
  assert.equal(event.namespaceId, intent.protectedBase.namespaceId);
  assert.equal(event.expectedRevision, intent.protectedBase.revision);
  assert.equal(event.expectedGeneration, intent.protectedBase.generation);
  assert.equal(event.authEpoch, intent.protectedBase.authEpoch);
}

async function assertConfirmed(f, count, intent = f.origin.originBackupWriteIntent) {
  assert.equal(writes().length, count);
  assert.ok(writes().every(event => event.committed && event.status === 200));
  assertOriginalTuple(writes()[0], intent);
  for (let index = 1; index < writes().length; index++) assertOwnTuple(writes()[index - 1], writes()[index]);
  const remote = await f.read();
  assert.equal(remote.snapshot.revision, writes().at(-1).serverRevision);
  assert.equal(remote.snapshot.generation, writes().at(-1).serverGeneration);
  assert.equal(remote.snapshot.authEpoch, writes().at(-1).serverAuthEpoch);
  assert.equal(await f.image.compareImages(await f.repair.captureBackupImage(), await f.remoteImage()), 'matched');
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified');
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[f.appId], true);
}

async function assertNoReplay(f) {
  assert.equal(f.submissions.length, 1, 'Observe one actual producer submission');
  const { receipt, mutations } = f.submissions[0];
  assert.equal(receipt.committed, true);
  const count = writes().length;
  const totalRequests = server.trace.length;
  const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, mutations);
  assert.notEqual(result.backupConfirmed, true);
  assert.equal(writes().length, count, 'An old receipt cannot replay any signer ciphertext');
  assert.equal(server.trace.length, totalRequests, 'An old receipt cannot read, enroll or repair either');
}

function peerAfterAck(f, operation, after = 0) {
  const witness = { event: undefined };
  server.armFault({ path: '/backup/v3/mutate', operation, after, async beforeReply({ body, event }) {
    assert.equal(event.committed, true, 'Hold a real completed caller ACK');
    const before = writes().length;
    const result = await f.protected.protectedBackupMutation(mnemonic, {
      namespaceId: event.namespaceId, revision: body.newRevision,
      generation: body.newGeneration, authEpoch: body.authEpoch,
    }, 'updateAppImage', { nodes: [], replaceNodes: true });
    assert.equal(result.updated, true, 'The independent signed peer CAS must actually commit');
    assert.equal(writes().length, before + 1);
    witness.event = writes().at(-1);
    assert.equal(witness.event.committed, true);
    assert.equal(witness.event.status, 200);
    assertOwnTuple(event, witness.event);
  } });
  return witness;
}

test('signer correction updates the new identity and live/archive origins before removing the old remote identity with signed-v3 ACK chaining', async t => {
  const f = await setup(t);
  assert.equal(await f.merge(), true);
  const local = await assertMergedLocal(f);
  assert.deepEqual(writes().map(event => event.operation), ['updateAppImage', 'updateVaultImage', 'updateVaultImage', 'migrateXfps']);
  const remote = await f.remoteImage();
  assert.equal(await f.image.compareImages(local, remote), 'matched');
  assert.equal(remote.signers[f.oldId], undefined);
  assert.ok(remote.signers[f.newId]);
  await assertConfirmed(f, 4);
  await assertNoReplay(f);
});

for (const mode of ['409', 'lost-reply']) test(`signer correction ${mode} keeps the complete local correction and real remote prefix pending`, async t => {
  const f = await setup(t);
  let peer;
  if (mode === '409') peer = peerAfterAck(f, 'updateAppImage');
  else server.armFault({ path: '/backup/v3/mutate', operation: 'updateAppImage', mode: 'lost-reply' });
  assert.equal(await f.merge(), true);
  await assertMergedLocal(f);
  const events = writes();
  assert.equal(events.length, mode === '409' ? 3 : 1, 'Count the real peer write separately from both caller attempts');
  assertOriginalTuple(events[0], f.origin.originBackupWriteIntent);
  assert.equal(events[0].committed, true);
  if (mode === '409') {
    assert.equal(events[1], peer.event);
    assert.deepEqual(events.map(event => event.status), [200, 200, 409]);
    assertOwnTuple(events[0], events[2]);
    assert.notEqual(events[2].expectedRevision, peer.event.serverRevision);
    assert.equal(events[2].committed, false);
  }
  const remote = await f.remoteImage();
  assert.ok(remote.signers[f.oldId]);
  assert.ok(remote.signers[f.newId]);
  assert.equal(remote.vaults['signer-live-vault'].signers[0].masterFingerprint, f.oldFingerprint);
  assertPending(f);
  await assertNoReplay(f);
  assertPending(f);
});

test('signer identity collision rolls back without replacing the existing target or either vault', async t => {
  const f = await setup(t, true);
  assert.equal(await f.merge(), false);
  assert.equal(server.trace.length, 0);
  assert.equal(f.submissions.length, 0);
  assert.equal(await f.image.compareImages(f.before, await f.repair.captureBackupImage()), 'matched');
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Signer, f.newId).signerName, 'Existing unrelated target');
});

test('a genuine conflict before final signer removal keeps both remote identities and every corrected vault recoverable', async t => {
  const f = await setup(t), peer = peerAfterAck(f, 'updateVaultImage', 1);
  assert.equal(await f.merge(), true);
  await assertMergedLocal(f);
  const events = writes();
  assert.equal(events.length, 5, 'Three committed caller prefix writes, one real peer and one rejected removal');
  assert.deepEqual(events.map(event => event.operation), ['updateAppImage', 'updateVaultImage', 'updateVaultImage', 'updateAppImage', 'migrateXfps']);
  assert.deepEqual(events.map(event => event.status), [200, 200, 200, 200, 409]);
  assert.equal(events[3], peer.event);
  assertOriginalTuple(events[0], f.origin.originBackupWriteIntent);
  assertOwnTuple(events[0], events[1]);
  assertOwnTuple(events[1], events[2]);
  assertOwnTuple(events[2], events[4]);
  assert.notEqual(events[4].expectedRevision, peer.event.serverRevision);
  assert.equal(events[4].committed, false);
  const remote = await f.remoteImage();
  assert.ok(remote.signers[f.oldId]);
  assert.ok(remote.signers[f.newId]);
  for (const id of ['signer-live-vault', 'signer-archived-vault'])
    assert.equal(remote.vaults[id].signers[0].masterFingerprint, f.correctKey.masterFingerprint);
  assertPending(f);
  await assertNoReplay(f);
});

test('actual registration updates the persisted shared key and both live/archive ciphertexts with signed-v3 tuples', async t => {
  const f = await setup(t);
  assert.equal(await f.register(), true);
  const local = await f.repair.captureBackupImage();
  assert.deepEqual(writes().map(event => event.operation), ['updateVaultImage', 'updateVaultImage']);
  for (const id of ['signer-live-vault', 'signer-archived-vault']) {
    const registrations = local.vaults[id].signers[0].registeredVaults;
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].registered, true);
    assert.equal(registrations[0].registrationInfo, 'public-fixture-registration');
    assert.equal(registrations[0].hmac, 'public-fixture-hmac');
    assert.deepEqual(local.vaults[id].scheme, f.before.vaults[id].scheme);
  }
  assert.equal(await f.image.compareImages(local, await f.remoteImage()), 'matched');
  await assertConfirmed(f, 2, f.registrationAction.originBackupWriteIntent);
  await assertNoReplay(f);
});

test('a genuine conflict during the second registration vault CAS preserves local registration and pending status', async t => {
  const f = await setup(t), peer = peerAfterAck(f, 'updateVaultImage');
  assert.equal(await f.register(), true);
  const local = await f.repair.captureBackupImage();
  for (const id of ['signer-live-vault', 'signer-archived-vault'])
    assert.equal(local.vaults[id].signers[0].registeredVaults[0].registered, true);
  const events = writes();
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(event => event.status), [200, 200, 409]);
  assert.equal(events[1], peer.event);
  assertOriginalTuple(events[0], f.registrationAction.originBackupWriteIntent);
  assertOwnTuple(events[0], events[2]);
  assert.equal(events[2].committed, false);
  assert.notEqual(events[2].expectedRevision, peer.event.serverRevision);
  assertPending(f);
  await assertNoReplay(f);
});

test('the actual signer producer preserves its local correction without an original base and sends zero HTTP', async t => {
  const f = await setup(t);
  assert.equal(await f.merge({ ...f.origin, originBackupWriteIntent: undefined }), true);
  await assertMergedLocal(f);
  assert.equal(server.trace.length, 0);
  assertPending(f);
  assert.equal(f.submissions.length, 1);
  assert.equal(f.submissions[0].receipt.intent, undefined);
  await assertNoReplay(f);
});

test('an original signer action cannot commit or send after A to B to A', async t => {
  const f = await setup(t);
  await f.selectAccount('disposable-other-account');
  await f.selectAccount(f.appId);
  assert.notEqual(f.transport.currentBackupAccountSession(), f.mergeAction.originBackupAccountSession);
  assert.equal(await f.merge(), false);
  assert.equal(server.trace.length, 0);
  assert.equal(f.submissions.length, 0);
  assert.equal(await f.image.compareImages(f.before, await f.repair.captureBackupImage()), 'matched');
});
