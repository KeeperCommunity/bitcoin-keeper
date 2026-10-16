// Required enablement matrix, intentionally separate from the credential-free
// unit glob. It MUST use the native Realm binding and a real transactional Relay
// helper; missing prerequisites fail the command and are never a skipped pass.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { createRealmClient, componentDeclarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');

const fixtureModule = process.env.KEEPER_RELAY_FIXTURE_MODULE;
assert.ok(fixtureModule, 'Set KEEPER_RELAY_FIXTURE_MODULE to Relay tests/support/automaticBackupHttpFixture.cjs');
const { createFixture } = require(fixtureModule);
let server;
before(async () => { server = await createFixture(); });
after(async () => { await server?.close(); Realm.shutdown(); });

const tick = () => new Promise((resolve) => setImmediate(resolve));
function barrier() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}
const attemptedWrites = () => server.trace.filter((event) => event.path === '/revisionedBackupMutation');

function wallet(f, id = 'wallet-a', name = 'Initial wallet') {
  return f.defaults(f.RealmSchema.Wallet, {
    id, entityKind: f.enums.EntityKind.WALLET, type: f.enums.WalletType.DEFAULT,
    networkType: f.enums.NetworkType.TESTNET, scriptType: 'P2WPKH',
    derivationDetails: f.defaults(f.RealmSchema.WalletDerivationDetails, { instanceNum: 0, xDerivationPath: "m/84'/1'/0'" }),
    presentationData: f.defaults(f.RealmSchema.WalletPresentationData, { name, visibility: 'DEFAULT' }),
    specs: f.defaults(f.RealmSchema.WalletSpecs, { xpub: `disposable-public-${id}`, nextFreeAddressIndex: 1 }),
  });
}

function signer(f, fingerprint = 'aaaa0001') {
  const record = f.defaults(f.RealmSchema.Signer, {
    masterFingerprint: fingerprint, type: f.enums.SignerType.COLDCARD, storageType: f.enums.SignerStorage.COLD,
    signerName: 'Disposable public key', networkType: f.enums.NetworkType.TESTNET,
    signerXpubs: f.defaults(f.RealmSchema.SignerXpubs, {
      [f.enums.XpubTypes.P2WSH]: [{ xpub: 'disposable-vault-public-key', xpriv: null, derivationPath: "m/48'/1'/0'/2'" }],
    }),
  });
  record.id = f.utilities.getKeyUID(record);
  return record;
}

function vault(f, id = 'vault-a', key = signer(f)) {
  const publicKey = key.signerXpubs[f.enums.XpubTypes.P2WSH][0];
  const vaultSigner = f.defaults(f.RealmSchema.VaultSigner, {
    ...publicKey, masterFingerprint: key.masterFingerprint, xfp: key.masterFingerprint, registeredVaults: [],
  });
  return f.defaults(f.RealmSchema.Vault, {
    id, entityKind: f.enums.EntityKind.VAULT, type: f.enums.VaultType.DEFAULT,
    networkType: f.enums.NetworkType.TESTNET, isMultiSig: true, scriptType: 'P2WSH',
    scheme: f.defaults(f.RealmSchema.VaultScheme, { m: 1, n: 1 }),
    signers: [vaultSigner],
    presentationData: f.defaults(f.RealmSchema.VaultPresentationData, { name: 'Initial vault', visibility: 'DEFAULT' }),
    specs: f.defaults(f.RealmSchema.VaultSpecs, { xpubs: [publicKey.xpub], nextFreeAddressIndex: 1 }),
  });
}

function persist(f, schema, record) {
  assert.equal(f.dbManager.createObject(schema, record), true, `Actual Realm ${schema} fixture must persist`);
}

function persistVault(f, id) {
  const key = signer(f);
  if (!f.dbManager.getObjectById(f.RealmSchema.Signer, key.id)) persist(f, f.RealmSchema.Signer, key);
  persist(f, f.RealmSchema.Vault, vault(f, id, key));
}

async function vaultBody(f, id) {
  const snapshot = await f.repair.captureBackupImage();
  const value = snapshot.vaults[id];
  assert.ok(value, 'Vault body must come from current native Realm image');
  return {
    appId: f.appId, vaultId: id, vault: await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed), value),
    isArchived: !!value.archived, isUpdate: true,
    signersData: value.signers.map((key) => ({ signerId: f.utilities.getKeyUID(key), xfpHash: f.encryption.hash256(key.masterFingerprint) })),
  };
}

async function labelBody(f, addIds, deleteIds = []) {
  const current = await f.repair.captureBackupImage();
  const key = f.encryption.generateEncryptionKey(f.seed);
  const hashed = (id) => f.encryption.hash256(f.encryption.hash256(key + id));
  const addLabels = [];
  for (const id of addIds) addLabels.push({ id: hashed(id), content: await f.image.encryptRecord(key, current.labels[id]) });
  return { appId: f.appId, addLabels, deleteLabels: deleteIds.map(hashed) };
}

const operations = {
  updateAppImage: {
    prepare(f) { persist(f, f.RealmSchema.Wallet, wallet(f)); },
    mutate(realm) { realm.objectForPrimaryKey('Wallet', 'wallet-a').presentationData.name = 'Committed wallet'; },
    async body(f) {
      const current = await f.repair.captureBackupImage();
      return { appId: f.appId, walletsObject: { 'wallet-a': await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed), current.wallets['wallet-a']) } };
    },
    invoke(f, body, intent) { return f.Relay.updateAppImage(body, intent); },
  },
  migrateXfps: {
    prepare(f) { persist(f, f.RealmSchema.Signer, signer(f)); },
    mutate(realm, f) { realm.delete(realm.objectForPrimaryKey('Signer', signer(f).id)); realm.create('Signer', signer(f, 'bbbb0002')); },
    async body(f) {
      const oldKey = signer(f), newKey = signer(f, 'bbbb0002');
      const current = await f.repair.captureBackupImage();
      return { appId: f.appId, signerChanges: [{ oldSignerId: oldKey.id, newSignerId: newKey.id,
        newSignerDetails: await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed), current.signers[newKey.id]) }] };
    },
    invoke(f, body, intent) { return f.Relay.migrateXfp(body.appId, body.signerChanges, intent); },
  },
  deleteAppImageEntity: {
    prepare(f) { persist(f, f.RealmSchema.Wallet, wallet(f)); },
    mutate(realm) { realm.delete(realm.objectForPrimaryKey('Wallet', 'wallet-a')); },
    async body(f) { return { appId: f.appId, walletIds: ['wallet-a'], signers: [] }; },
    invoke(f, body, intent) { return f.Relay.deleteAppImageEntity(body, intent); },
  },
  deleteVaults: {
    prepare(f) { persistVault(f, 'vault-a'); },
    mutate(realm) { realm.delete(realm.objectForPrimaryKey('Vault', 'vault-a')); },
    async body(f) { return { appId: f.appId, vaults: ['vault-a'] }; },
    invoke(f, body, intent) { return f.Relay.deleteVaultImage(body, intent); },
  },
  updateVaultImage: {
    prepare(f) { persistVault(f, 'vault-a'); },
    mutate(realm) { realm.objectForPrimaryKey('Vault', 'vault-a').presentationData.name = 'Committed vault'; },
    async body(f) { return vaultBody(f, 'vault-a'); },
    invoke(f, body, intent) { return f.Relay.updateVaultImage(body, intent); },
  },
  modifyLabels: {
    prepare(f) { persist(f, f.RealmSchema.Tags, f.defaults(f.RealmSchema.Tags, { id: 'old-label', type: 'TX', ref: 'public-tx', label: 'Old label' })); },
    mutate(realm, f) {
      realm.delete(realm.objectForPrimaryKey('Tags', 'old-label'));
      realm.create('Tags', f.defaults(f.RealmSchema.Tags, { id: 'new-label', type: 'TX', ref: 'public-tx', label: 'Committed label' }));
    },
    async body(f) { return labelBody(f, ['new-label'], ['old-label']); },
    invoke(f, body, intent) { return f.Relay.modifyLabels(body.appId, body.addLabels, body.deleteLabels, intent); },
  },
  deleteBackup: {
    prepare(f) { persist(f, f.RealmSchema.Wallet, wallet(f)); },
    async body(f) { return { appId: f.appId }; },
    invoke(f, body, intent) { return f.Relay.deleteBackup(body, intent); },
  },
};

async function setup(t, operation, options = {}) {
  await server.reset();
  const f = await createRealmClient(server.url, options);
  t.after(async () => { await f.close(); });
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  f.removeNativeListener = f.listen();
  t.after(() => f.removeNativeListener());
  operations[operation].prepare(f);
  persist(f, f.RealmSchema.Wallet, wallet(f, 'retained-wallet', 'Retained local recovery record'));
  if (operation === 'deleteVaults') persistVault(f, 'retained-vault');
  await tick();
  await server.seed(await f.payloadForCurrentImage());
  f.sagas = f.productionSagas(['currentBackupAppId', 'backupInspectionOwners', 'runBackupInspection']);
  assert.equal(await f.sagas.run('runBackupInspection', false, f.appId), true, 'Production saga baseline comes from actual encrypted HTTP readback');
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified');
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
  assert.ok(f.transport.captureBackupWriteIntent(f.appId), 'Actual inspection must provide the baseline');
  server.clearTrace();
  return f;
}

async function committedRequest(f, operation) {
  const contract = operations[operation];
  let intent;
  let receipt;
  if (operation === 'deleteBackup') {
    receipt = await f.automatic.beginBackupDeleteOperation(f.appId, f.transport.currentBackupAccountSession());
    assert.equal(receipt.committed, true);
    intent = receipt.intent;
  } else {
    const op = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
    receipt = f.automatic.commitBackupLocalOperation(op, (realm) => contract.mutate(realm, f));
    assert.equal(receipt.committed, true, 'Logical operation must commit a real Realm transaction');
    assert.ok(receipt.intent, 'A committed operation with a verified originating base requires a branded intent');
    intent = receipt.intent;
  }
  assert.ok(intent);
  const body = await contract.body(f);
  return { receipt, intent, body, invoke: () => contract.invoke(f, body, intent) };
}

async function settled(request) {
  try { return await request.invoke(); }
  catch (error) { return { updated: false, failure: error.name }; }
}

function assertPending(f) {
  const state = f.store.getState().bhr;
  assert.equal(state.pendingAllBackupByAppId[f.appId], true, 'Failed/uncertain operation must remain pending');
  assert.notEqual(state.backupRepairStateByAppId[f.appId], 'verified');
  assert.notEqual(state.backupRepairCompletedByAppId[f.appId], true);
}

async function awaitCommittedReplyBarrier(request, appId) {
  const deadline = Date.now() + 2000;
  while (!server.trace.some((event) => event.path === '/revisionedBackupMutation' && event.appId === appId && event.committed)) {
    assert.equal(request.isSettled(), false, 'The client must still be waiting for the actual held HTTP acknowledgement');
    assert.ok(Date.now() < deadline, 'The real route must commit before the bounded reply window expires');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(request.isSettled(), false, 'Observe a real committed transaction while its HTTP acknowledgement is still outstanding');
}

function outstanding(invoke) {
  let isSettled = false;
  const result = invoke().then((value) => { isSettled = true; return value; }, (error) => {
    isSettled = true;
    throw error;
  });
  return { result, isSettled: () => isSettled };
}

function accountBackupFlags(f, appId) {
  return Object.fromEntries(Object.entries(f.store.getState().bhr)
    .filter(([name]) => name.endsWith('ByAppId'))
    .map(([name, values]) => [name, values[appId]]));
}

for (const operation of Object.keys(operations)) {
  test(`${operation}: matching committed native payload/target reaches real v2 once`, async (t) => {
    const f = await setup(t, operation);
    const request = await committedRequest(f, operation);
    const result = await settled(request);
    assert.equal(result.updated, true);
    assert.equal(attemptedWrites().length, 1);
    assert.equal(attemptedWrites()[0].operation, operation);
    assert.equal(attemptedWrites()[0].committed, true);
    if (operation !== 'deleteBackup') {
      const remote = await server.snapshot(f.appId);
      const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote, f.appId);
      assert.equal(await f.image.compareImages(await f.repair.captureBackupImage(), decoded), 'matched');
      assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified');
      assert.ok(f.nativeEvents.length > 0, 'Actual native change listeners must observe persistence');
    } else {
      assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a'), 'Opt-out retains native local wallet');
      assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], false);
    }
  });

  test(`${operation}: queued receipt is invalid after a subsequent native local mutation`, async (t) => {
    const f = await setup(t, operation);
    const request = await committedRequest(f, operation);
    const gate = barrier();
    t.after(gate.release);
    f.transport.withBackupSession(f.appId, () => gate.promise);
    const result = settled(request);
    persist(f, f.RealmSchema.Tags, f.defaults(f.RealmSchema.Tags, { id: 'later-local-change', type: 'TX', ref: 'later', label: 'Changed after receipt' }));
    gate.release();
    await result;
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
  });

  test(`${operation}: queued A to B to A receipt cannot send in the new session`, async (t) => {
    const f = await setup(t, operation);
    const request = await committedRequest(f, operation);
    const gate = barrier();
    t.after(gate.release);
    f.transport.withBackupSession(f.appId, () => gate.promise);
    const result = settled(request);
    await f.selectAccount('disposable-account-b');
    await f.selectAccount(f.appId);
    gate.release();
    await result;
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
  });

  for (const mode of ['409', '404', 'malformed', 'lost-reply', 'equal-old-ack']) {
    test(`${operation}: actual HTTP ${mode} stops the write and never reports verified`, async (t) => {
      const f = await setup(t, operation);
      const request = await committedRequest(f, operation);
      server.armFault({ mode, operation });
      const result = await settled(request);
      assert.notEqual(result.backupConfirmed, true);
      assert.equal(attemptedWrites().length, 1);
      assertPending(f);
      if (operation === 'deleteBackup') assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], true, 'Opt-out consent changes only after a positive acknowledged deletion');
      const generation = f.transport.backupRevision(f.appId);
      const check = await f.repair.inspectBackup(f.appId, false, () => {});
      assert.ok(['verified', 'different', 'unverified', 'conflict'].includes(check));
      assert.equal(attemptedWrites().length, 1, 'Read-only reconciliation cannot repeat an uncertain write');
      assert.ok(f.transport.backupRevision(f.appId) >= generation);
    });
  }

  for (const [failure, acknowledgement] of Object.entries({
    'updated false': { updated: false, preconditionApplied: true, newRevision: 'c'.repeat(64) },
    'missing updated': { preconditionApplied: true, newRevision: 'c'.repeat(64) },
    'precondition false': { updated: true, preconditionApplied: false, newRevision: 'c'.repeat(64) },
    'missing precondition': { updated: true, newRevision: 'c'.repeat(64) },
    'missing new revision': { updated: true, preconditionApplied: true },
  })) test(`${operation}: a real committed write with ${failure} acknowledgement remains pending`, async (t) => {
    const f = await setup(t, operation);
    const request = await committedRequest(f, operation);
    server.armFault({ mode: 'malformed', operation, acknowledgement });
    await settled(request);
    assert.equal(attemptedWrites().length, 1);
    assert.equal(attemptedWrites()[0].committed, true);
    assertPending(f);
    if (operation === 'deleteBackup') assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], true);
  });

  test(`${operation}: genuine delayed HTTP reply is aborted and remains pending`, async (t) => {
    const f = await setup(t, operation, { backupTimerCeilingMs: 200 });
    const request = await committedRequest(f, operation);
    server.armFault({ mode: 'delay-reply', operation, delayMs: 1000 });
    await settled(request);
    assert.equal(attemptedWrites().length, 1);
    assertPending(f);
    if (operation === 'deleteBackup') assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], true);
  });

  for (const remoteChange of ['remote-only', 'key-conflict']) {
    test(`${operation}: a peer ${remoteChange} snapshot cannot be overwritten by the old local receipt`, async (t) => {
      const f = await setup(t, operation);
      const baseline = await f.payloadForCurrentImage();
      const request = await committedRequest(f, operation);
      const peerPayload = { ...baseline, walletObject: { ...baseline.walletObject } };
      const value = wallet(f, remoteChange === 'remote-only' ? 'server-only-wallet' : 'retained-wallet');
      if (remoteChange === 'key-conflict') value.specs.xpub = 'different-public-key-identity';
      peerPayload.walletObject[value.id] = await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed), value);
      await server.seed(peerPayload);
      server.clearTrace();
      await settled(request);
      assert.equal(attemptedWrites().length, 0);
      assertPending(f);
      const remote = await server.snapshot(f.appId);
      const decoded = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), remote, f.appId);
      assert.equal(decoded.wallets[value.id].specs.xpub, value.specs.xpub, 'Peer recovery content must survive intact');
    });
  }

  test(`${operation}: current generation cannot authorize a mismatched decrypted payload or deletion target`, async (t) => {
    const f = await setup(t, operation);
    const request = await committedRequest(f, operation);
    const key = f.encryption.generateEncryptionKey(f.seed);
    async function staleCipher(cipher, mutate) {
      const value = await f.image.decryptRecord(key, cipher);
      mutate(value);
      return f.image.encryptRecord(key, value);
    }
    if (operation === 'updateAppImage') request.body.walletsObject['wallet-a'] = await staleCipher(request.body.walletsObject['wallet-a'], (value) => { value.presentationData.name = 'Uncommitted action data'; });
    if (operation === 'migrateXfps') request.body.signerChanges[0].newSignerDetails = await staleCipher(request.body.signerChanges[0].newSignerDetails, (value) => { value.signerName = 'Uncommitted action data'; });
    if (operation === 'deleteAppImageEntity') request.body.walletIds = ['retained-wallet'];
    if (operation === 'deleteVaults') request.body.vaults = ['retained-vault'];
    if (operation === 'updateVaultImage') request.body.vault = await staleCipher(request.body.vault, (value) => { value.presentationData.name = 'Uncommitted action data'; });
    if (operation === 'modifyLabels') request.body.addLabels[0].content = await staleCipher(request.body.addLabels[0].content, (value) => { value.label = 'Uncommitted action data'; });
    if (operation === 'deleteBackup') request.body.appId = 'different-disposable-account';
    await settled(request);
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
  });

  test(`${operation}: failed actual Realm commit supplies no usable write intent`, async (t) => {
    const f = await setup(t, operation);
    const local = plain(f.nativeRealm().objects('Tags'));
    const op = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
    const receipt = f.automatic.commitBackupLocalOperation(op, (realm) => {
      realm.create('Tags', f.defaults(f.RealmSchema.Tags, { id: 'rolled-back', type: 'TX', ref: 'rollback', label: 'Must never persist' }));
      throw new Error('Disposable native transaction failure');
    });
    assert.equal(receipt.committed, false);
    assert.equal(receipt.intent, undefined);
    assert.deepEqual(plain(f.nativeRealm().objects('Tags')), local, 'Real native transaction rollback must preserve the entire prior collection');
    const body = { appId: f.appId };
    await settled({ invoke: () => operations[operation].invoke(f, body, receipt.intent) });
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
  });

  test(`${operation}: copying a branded committed intent never authorizes a request`, async (t) => {
    const f = await setup(t, operation);
    const request = await committedRequest(f, operation);
    await settled({ invoke: () => operations[operation].invoke(f, request.body, { ...request.intent }) });
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
  });

  test(`${operation}: a missing committed receipt sends nothing and never borrows the current baseline`, async (t) => {
    const f = await setup(t, operation);
    const request = await committedRequest(f, operation);
    await f.automatic.enqueueAutomaticBackupOperation(undefined, [{ operation, body: request.body }]);
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
  });

  test(`${operation}: closed and reopened native Realm rejects the old queued receipt`, async (t) => {
    const f = await setup(t, operation);
    const request = await committedRequest(f, operation);
    const gate = barrier();
    t.after(gate.release);
    f.transport.withBackupSession(f.appId, () => gate.promise);
    const result = settled(request);
    const original = f.nativeRealm();
    f.realmDatabase.closeDatabase();
    await f.selectAccount(f.appId);
    assert.equal(original.isClosed, true);
    assert.notEqual(f.nativeRealm(), original);
    gate.release();
    await result;
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
  });

  test(`${operation}: a malformed missing-reference snapshot authorizes no mutation`, async (t) => {
    const f = await setup(t, operation);
    const request = await committedRequest(f, operation);
    server.armFault({ mode: 'before-snapshot-reply', appId: f.appId, beforeReply({ body }) {
      return { ...body, appImage: { ...body.appImage, vaults: [...body.appImage.vaults, 'missing-vault-reference'] } };
    } });
    await settled(request);
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
  });

  test(`${operation}: a later consent-off choice invalidates the previously prepared operation`, async (t) => {
    const f = await setup(t, operation);
    const request = await committedRequest(f, operation);
    f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: false }));
    await settled(request);
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], false);
  });

  test(`${operation}: wrong-key final ciphertext leaves the acknowledged update pending`, async (t) => {
    const f = await setup(t, operation);
    const request = await committedRequest(f, operation);
    const wrongCipher = await f.image.encryptRecord(f.encryption.generateEncryptionKey('different-public-fixture-key'), wallet(f, 'retained-wallet'));
    server.armFault({ mode: 'before-snapshot-reply', appId: f.appId, after: 1, beforeReply({ body }) {
      return { ...body, appImage: { ...body.appImage, wallets: { ...body.appImage.wallets, 'retained-wallet': wrongCipher } } };
    } });
    await settled(request);
    assert.equal(attemptedWrites().length, 1);
    assert.equal(attemptedWrites()[0].committed, true);
    assertPending(f);
    if (operation === 'deleteBackup') assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], true);
  });
}

for (const fanout of ['create-and-archive-vaults', 'shared-vault-registration', 'label-import-and-delete']) {
  test(`${fanout}: first real CAS succeeds, second fails, remaining effects stop and all local data survives`, async (t) => {
    const f = await setup(t, fanout === 'label-import-and-delete' ? 'modifyLabels' : 'updateVaultImage');
    if (fanout !== 'label-import-and-delete') {
      persistVault(f, 'vault-b'); persistVault(f, 'vault-c');
      await server.seed(await f.payloadForCurrentImage());
      assert.equal(await f.sagas.run('runBackupInspection', false, f.appId), true);
      server.clearTrace();
    }
    const op = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
    const receipt = f.automatic.commitBackupLocalOperation(op, (realm) => {
      if (fanout === 'create-and-archive-vaults') {
        realm.objectForPrimaryKey('Vault', 'vault-a').archived = true;
        realm.create('Vault', vault(f, 'new-vault'), Realm.UpdateMode.Modified);
        realm.objectForPrimaryKey('Vault', 'vault-c').presentationData.name = 'Third prepared effect';
      } else if (fanout === 'shared-vault-registration') {
        realm.objectForPrimaryKey('VaultSigner', 'disposable-vault-public-key').registeredVaults = [
          { vaultId: 'vault-a', registered: true }, { vaultId: 'vault-b', registered: true }, { vaultId: 'vault-c', registered: true },
        ];
      } else {
        realm.delete(realm.objectForPrimaryKey('Tags', 'old-label'));
        for (const id of ['label-one', 'label-two', 'label-three']) realm.create('Tags', f.defaults(f.RealmSchema.Tags, { id, type: 'TX', ref: id, label: id }));
      }
    });
    assert.equal(receipt.committed, true);
    const before = await f.repair.captureBackupImage();
    const mutations = [];
    if (fanout === 'label-import-and-delete') {
      for (const [index, id] of ['label-one', 'label-two', 'label-three'].entries()) mutations.push({ operation: 'modifyLabels', body: await labelBody(f, [id], index === 0 ? ['old-label'] : []) });
    } else {
      for (const id of fanout === 'create-and-archive-vaults' ? ['vault-a', 'new-vault', 'vault-c'] : ['vault-a', 'vault-b', 'vault-c']) mutations.push({ operation: 'updateVaultImage', body: await vaultBody(f, id) });
    }
    server.armFault({ mode: '409', operation: mutations[0].operation, after: 1 });
    const result = await f.automatic.enqueueAutomaticBackupOperation(receipt.intent, mutations);
    assert.notEqual(result.backupConfirmed, true);
    assert.equal(attemptedWrites().length, 2);
    assert.equal(attemptedWrites()[0].committed, true);
    assert.equal(attemptedWrites()[1].committed, false);
    assert.equal(await f.image.compareImages(before, await f.repair.captureBackupImage()), 'matched');
    assertPending(f);
  });
}

test('a genuine native write between fanout members stops every later member after the first real CAS', async (t) => {
  const f = await setup(t, 'modifyLabels');
  const op = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, (realm) => {
    realm.delete(realm.objectForPrimaryKey('Tags', 'old-label'));
    for (const id of ['first-imported-label', 'second-imported-label', 'third-imported-label']) {
      realm.create('Tags', f.defaults(f.RealmSchema.Tags, { id, type: 'TX', ref: id, label: id }));
    }
  });
  assert.equal(receipt.committed, true);
  const before = await f.repair.captureBackupImage();
  const mutations = [];
  for (const [index, id] of ['first-imported-label', 'second-imported-label', 'third-imported-label'].entries()) {
    mutations.push({ operation: 'modifyLabels', body: await labelBody(f, [id], index === 0 ? ['old-label'] : []) });
  }
  server.armFault({ mode: 'delay-reply', operation: 'modifyLabels', delayMs: 3000 });
  const request = outstanding(() => f.automatic.enqueueAutomaticBackupOperation(receipt, mutations));
  await awaitCommittedReplyBarrier(request, f.appId);
  persist(f, f.RealmSchema.Tags, f.defaults(f.RealmSchema.Tags, { id: 'interleaved-local-label', type: 'TX', ref: 'interleaved', label: 'A later committed local write' }));
  assert.equal(request.isSettled(), false, 'The local write must finish before the real timed acknowledgement arrives');
  const result = await request.result;
  assert.notEqual(result.backupConfirmed, true);
  assert.equal(attemptedWrites().length, 1, 'The second and third prepared members must send no HTTP request');
  assert.equal(attemptedWrites()[0].committed, true);
  assertPending(f);
  const after = await f.repair.captureBackupImage();
  for (const [id, label] of Object.entries(before.labels)) assert.deepEqual(plain(after.labels[id]), plain(label));
  assert.equal(after.labels['interleaved-local-label'].label, 'A later committed local write');
  const remote = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), await server.snapshot(f.appId), f.appId);
  assert.ok(remote.labels['first-imported-label']);
  assert.equal(remote.labels['second-imported-label'], undefined);
  assert.equal(remote.labels['third-imported-label'], undefined);
  assert.equal(remote.labels['old-label'], undefined);
});

for (const operation of Object.keys(operations)) {
  test(`${operation}: after-send A to B to A rejects an outstanding real acknowledgement without changing the new account UI`, async (t) => {
    const f = await setup(t, operation);
    const prepared = await committedRequest(f, operation);
    const expectedA = await f.repair.captureBackupImage();
    server.armFault({ mode: 'delay-reply', operation, delayMs: 3000 });
    const request = outstanding(() => settled(prepared));
    await awaitCommittedReplyBarrier(request, f.appId);
    const seedB = 'cd'.repeat(32);
    const appIdB = f.encryption.hash256(seedB);
    await f.selectAccount(appIdB);
    assert.equal(f.dbManager.updateObjectById(f.RealmSchema.KeeperApp, appIdB, {
      primarySeed: seedB, publicId: appIdB.slice(0, 8), imageEncryptionKey: f.encryption.generateEncryptionKey(seedB),
    }), true);
    persist(f, f.RealmSchema.Wallet, wallet(f, 'distinct-account-b-wallet', 'A separate account B record'));
    f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: appIdB, enabled: true }));
    const expectedB = await f.repair.captureBackupImage();
    assert.notEqual(f.dbManager.getObjectById(f.RealmSchema.KeeperApp, appIdB).primarySeed, f.seed);
    await server.seed(await f.payloadForCurrentImage());
    assert.equal(await f.sagas.run('runBackupInspection', false, appIdB), true, 'Account B gets its own genuine baseline and UI state');
    await f.selectAccount(f.appId);
    const newAFlags = accountBackupFlags(f, f.appId);
    const unchangedBFlags = accountBackupFlags(f, appIdB);
    assert.equal(request.isSettled(), false, 'All distinct-key B setup and the A return must finish while the real acknowledgement is outstanding');
    const actionBoundary = f.actions.length;
    const result = await request.result;
    assert.notEqual(result.backupConfirmed, true);
    assert.equal(server.trace.filter((event) => event.path === '/revisionedBackupMutation' && event.appId === f.appId).length, 1);
    assertPending(f);
    assert.deepEqual(accountBackupFlags(f, f.appId), newAFlags, 'The old completion cannot change the newly selected A UI');
    assert.deepEqual(accountBackupFlags(f, appIdB), unchangedBFlags, 'The old A completion cannot change B backup state');
    assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], true, 'Old delete acknowledgements cannot disable new-session consent');
    assert.equal(f.actions.slice(actionBoundary).some((action) => action.type === f.bhr.commitBackupInspection.type), false);
    assert.equal(await f.image.compareImages(expectedA, await f.repair.captureBackupImage()), 'matched', 'Every committed native A record survives');
    const remoteB = await f.image.decodeImage(f.encryption.generateEncryptionKey(seedB), await server.snapshot(appIdB), appIdB);
    assert.equal(await f.image.compareImages(expectedB, remoteB), 'matched', 'B records and its independently encrypted backup remain untouched');
    await f.selectAccount(appIdB);
    assert.equal(await f.image.compareImages(expectedB, await f.repair.captureBackupImage()), 'matched', 'Native B records remain untouched after the old A completion');
  });
}

test('real native mutation immediately before Redux final verification commit prevents a verified claim', async (t) => {
  const f = await setup(t, 'updateAppImage');
  const request = await committedRequest(f, 'updateAppImage');
  let injected = false;
  f.setBeforeDispatch((action) => {
    if (!injected && action.type === f.bhr.commitBackupInspection.type) {
      injected = true;
      persist(f, f.RealmSchema.Tags, f.defaults(f.RealmSchema.Tags, { id: 'final-commit-race', type: 'TX', ref: 'race', label: 'Native change at final Redux gate' }));
    }
  });
  await settled(request);
  assert.equal(injected, true, 'The actual production verification dispatch must be exercised');
  assert.equal(attemptedWrites().length, 1);
  assertPending(f);
});

test('actual BHR app producer builds ciphertext from committed native IDs rather than stale action data', async (t) => {
  const f = await setup(t, 'updateAppImage');
  const request = await committedRequest(f, 'updateAppImage');
  const producer = f.productionSagas(['currentBackupAppId', 'buildAutomaticAppMutation', 'queueCommittedBackupWorker', 'updateAppImageWorker']);
  const result = await producer.run('updateAppImageWorker', {
    payload: { wallets: [wallet(f, 'wallet-a', 'Old delayed action name')] },
    originAppId: f.appId, originBackupAccountSession: f.transport.currentBackupAccountSession(), committedOperation: request.receipt,
  });
  assert.equal(result.backupConfirmed, true);
  assert.equal(attemptedWrites().length, 1);
  const restored = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), await server.snapshot(f.appId), f.appId);
  assert.equal(restored.wallets['wallet-a'].presentationData.name, 'Committed wallet');
});

test('actual BHR node producer reads the genuine persisted collection and clears nodes with an exact set', async (t) => {
  const f = await setup(t, 'updateAppImage');
  const producer = f.productionSagas(['currentBackupAppId', 'buildAutomaticAppMutation', 'queueCommittedBackupWorker', 'updateAppImageWorker']);
  const origin = f.transport.captureBackupWriteIntent(f.appId);
  const op = f.automatic.beginBackupLocalOperation(f.appId, origin, f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, (realm) => realm.create('NodeConnect', f.defaults(f.RealmSchema.NodeConnect, {
    id: 12, host: 'public-disposable-node.invalid', port: '50002', useSSL: true, networkType: f.enums.NetworkType.TESTNET,
  })));
  assert.equal(receipt.committed, true);
  const result = await producer.run('updateAppImageWorker', { payload: { updateNodes: true }, originAppId: f.appId,
    originBackupAccountSession: f.transport.currentBackupAccountSession(), committedOperation: receipt });
  assert.equal(result.backupConfirmed, true);
  assert.equal(attemptedWrites().length, 1);
  let remote = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), await server.snapshot(f.appId), f.appId);
  assert.equal(remote.nodes['12'].host, 'public-disposable-node.invalid');
  server.clearTrace();
  const deletion = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
  const removed = f.automatic.commitBackupLocalOperation(deletion, (realm) => realm.delete(realm.objects('NodeConnect')));
  const cleared = await producer.run('updateAppImageWorker', { payload: { updateNodes: true }, originAppId: f.appId,
    originBackupAccountSession: f.transport.currentBackupAccountSession(), committedOperation: removed });
  assert.equal(cleared.backupConfirmed, true);
  assert.equal(attemptedWrites().length, 1);
  remote = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), await server.snapshot(f.appId), f.appId);
  assert.deepEqual(Object.keys(remote.nodes), []);
});

test('actual BHR vault producer builds from shared native registrations and acknowledges the complete fanout', async (t) => {
  const f = await setup(t, 'updateVaultImage');
  persistVault(f, 'vault-b');
  await server.seed(await f.payloadForCurrentImage());
  assert.equal(await f.sagas.run('runBackupInspection', false, f.appId), true);
  server.clearTrace();
  const producer = f.productionSagas(['currentBackupAppId', 'buildAutomaticVaultMutation', 'queueCommittedBackupWorker']);
  const op = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, (realm) => {
    realm.objectForPrimaryKey('VaultSigner', 'disposable-vault-public-key').registeredVaults = [
      { vaultId: 'vault-a', registered: true, hmac: 'disposable-receipt' }, { vaultId: 'vault-b', registered: true, hmac: 'disposable-receipt' },
    ];
  });
  const mutations = ['vault-a', 'vault-b'].map((id) => producer.scope.buildAutomaticVaultMutation(id, f.appId));
  const result = await producer.run('queueCommittedBackupWorker', f.appId, receipt, mutations, f.transport.currentBackupAccountSession());
  assert.equal(result.backupConfirmed, true);
  assert.equal(attemptedWrites().length, 2);
  const remote = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), await server.snapshot(f.appId), f.appId);
  for (const id of ['vault-a', 'vault-b']) assert.equal(remote.vaults[id].signers[0].registeredVaults.length, 2);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
});

test('create plus archive fanout proves archive target before mutation and verifies the full actual image', async (t) => {
  const f = await setup(t, 'updateVaultImage');
  const op = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, (realm) => {
    realm.objectForPrimaryKey('Vault', 'vault-a').archived = true;
    realm.create('Vault', vault(f, 'new-vault'), Realm.UpdateMode.Modified);
  });
  assert.equal(receipt.committed, true);
  const producer = f.productionSagas(['currentBackupAppId', 'buildAutomaticVaultMutation', 'queueCommittedBackupWorker']);
  const create = producer.scope.buildAutomaticVaultMutation('new-vault', f.appId, false);
  create.body.archiveVaultId = 'vault-a';
  const archived = producer.scope.buildAutomaticVaultMutation('vault-a', f.appId);
  const result = await producer.run('queueCommittedBackupWorker', f.appId, receipt, [archived, create], f.transport.currentBackupAccountSession());
  assert.equal(result.backupConfirmed, true);
  assert.equal(attemptedWrites().length, 2);
  const remote = await f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed), await server.snapshot(f.appId), f.appId);
  assert.equal(remote.vaults['vault-a'].archived, true);
  assert.equal(remote.vaults['new-vault'].archived, false);
});

test('an archive alias without its preceding committed archive ciphertext sends nothing', async (t) => {
  const f = await setup(t, 'updateVaultImage');
  const op = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, (realm) => {
    realm.objectForPrimaryKey('Vault', 'vault-a').archived = true;
    realm.create('Vault', vault(f, 'new-vault'), Realm.UpdateMode.Modified);
  });
  const body = await vaultBody(f, 'new-vault');
  body.archiveVaultId = 'vault-a';
  const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, [{ operation: 'updateVaultImage', body }]);
  assert.notEqual(result.backupConfirmed, true);
  assert.equal(attemptedWrites().length, 0);
  assertPending(f);
});

for (const field of ['publicId', 'version', 'subscription']) {
  test(`complete final readback with malformed ${field} cannot claim verification`, async (t) => {
    const f = await setup(t, 'updateAppImage');
    const request = await committedRequest(f, 'updateAppImage');
    server.armFault({ mode: 'malformed-metadata', appId: f.appId, after: 1,
      metadata: { [field]: field === 'subscription' ? '{}' : 'not-the-committed-value' } });
    await settled(request);
    assert.equal(attemptedWrites().length, 1);
    assert.equal(attemptedWrites()[0].committed, true);
    assertPending(f);
  });
}

function disposableExtendedKey(f, byte) {
  const ecc = f.load('src/services/wallets/operations/taproot-utils/noble_ecc').default;
  const bip32 = require('bip32').default(ecc);
  return bip32.fromSeed(Buffer.alloc(32, byte), require('bitcoinjs-lib').networks.testnet).derivePath("m/48'/1'/0'/2'");
}

for (const field of ['xpub', 'private-key', 'network']) {
  test(`a same-ID signer ${field} identity replacement cannot upload committed native data`, async (t) => {
    const f = await setup(t, 'migrateXfps');
    const id = signer(f).id;
    const original = disposableExtendedKey(f, 0x31);
    const replacement = disposableExtendedKey(f, 0x32);
    f.nativeRealm().write(() => {
      f.nativeRealm().objectForPrimaryKey('Signer', id).signerXpubs[f.enums.XpubTypes.P2WSH][0].xpub = original.neutered().toBase58();
    });
    await server.seed(await f.payloadForCurrentImage());
    assert.equal(await f.sagas.run('runBackupInspection', false, f.appId), true);
    server.clearTrace();
    const op = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
    const receipt = f.automatic.commitBackupLocalOperation(op, (realm) => {
      const record = realm.objectForPrimaryKey('Signer', id);
      if (field === 'xpub') record.signerXpubs[f.enums.XpubTypes.P2WSH][0].xpub = replacement.neutered().toBase58();
      if (field === 'private-key') record.signerXpubs[f.enums.XpubTypes.P2WSH][0].xpriv = replacement.toBase58();
      if (field === 'network') record.networkType = f.enums.NetworkType.MAINNET;
    });
    assert.equal(receipt.committed, true);
    const current = await f.repair.captureBackupImage();
    const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, [{ operation: 'updateAppImage', body: {
      appId: f.appId, signersObject: { [id]: await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed), current.signers[id]) },
    } }]);
    assert.notEqual(result.backupConfirmed, true);
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
    assert.equal(current.signers[id].id, id, 'The rejection is for a changed identity at the same persisted ID');
  });
}

for (const field of ['key', 'policy']) {
  test(`a same-ID vault ${field} replacement cannot upload committed native data`, async (t) => {
    const f = await setup(t, 'updateVaultImage');
    const op = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
    const receipt = f.automatic.commitBackupLocalOperation(op, (realm) => {
      const record = realm.objectForPrimaryKey('Vault', 'vault-a');
      if (field === 'policy') record.scheme.m = 2;
      else {
        const xpub = disposableExtendedKey(f, 0x33).neutered().toBase58();
        const previous = plain(record.signers[0]);
        record.signers = [realm.create('VaultSigner', { ...previous, xpub }, Realm.UpdateMode.Modified)];
        record.specs.xpubs = [xpub];
        realm.objectForPrimaryKey('Signer', signer(f).id).signerXpubs[f.enums.XpubTypes.P2WSH][0].xpub = xpub;
      }
    });
    assert.equal(receipt.committed, true);
    const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, [{ operation: 'updateVaultImage', body: await vaultBody(f, 'vault-a') }]);
    assert.notEqual(result.backupConfirmed, true);
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
    assert.ok(f.dbManager.getObjectById(f.RealmSchema.Vault, 'vault-a'), 'The committed local record remains available for an explicit repair choice');
  });
}

test('a cloned originating baseline cannot mint an automatic receipt from a genuine local commit', async (t) => {
  const f = await setup(t, 'updateAppImage');
  const original = f.transport.captureBackupWriteIntent(f.appId);
  const op = f.automatic.beginBackupLocalOperation(f.appId, { ...original }, f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, (realm) => operations.updateAppImage.mutate(realm, f));
  assert.equal(receipt.committed, true, 'Local saving remains available without cloud proof');
  assert.equal(receipt.intent, undefined);
  await f.automatic.enqueueAutomaticBackupOperation(receipt, [{ operation: 'updateAppImage', body: await operations.updateAppImage.body(f) }]);
  assert.equal(attemptedWrites().length, 0);
  assertPending(f);
});

test('an uncommitted native image or caller boolean cannot issue a committed-generation proof', async (t) => {
  const f = await setup(t, 'updateAppImage');
  const op = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
  let observedInside;
  assert.throws(() => f.nativeRealm().write(() => {
    f.nativeRealm().create('Tags', f.defaults(f.RealmSchema.Tags, { id: 'uncommitted-tag', type: 'TX', ref: 'pending', label: 'Must roll back' }));
    observedInside = f.transport.captureBackupWriteIntent(f.appId);
    assert.throws(() => f.automatic.beginBackupLocalOperation(f.appId, observedInside));
    throw new Error('Deliberate rollback');
  }), /Deliberate rollback/);
  assert.equal(observedInside, undefined);
  assert.equal(f.nativeRealm().objectForPrimaryKey('Tags', 'uncommitted-tag'), null);
  const forgedCompletion = f.automatic.completeBackupLocalOperation(op, true);
  assert.equal(forgedCompletion.intent, undefined);
  assert.equal(attemptedWrites().length, 0);
});

test('a selected-account switch inside the final native transaction callback rolls back the whole operation', async (t) => {
  const f = await setup(t, 'updateAppImage');
  const before = plain(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a'));
  const op = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
  const receipt = f.automatic.commitBackupLocalOperation(op, (realm) => {
    operations.updateAppImage.mutate(realm, f);
    f.store.dispatch(f.storage.setAppId('different-disposable-account'));
  });
  assert.equal(receipt.committed, false);
  assert.equal(receipt.intent, undefined);
  assert.deepEqual(plain(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a')), before);
  assert.equal(attemptedWrites().length, 0);
});

test('fixture authorization never permits a hosted Relay target', async (t) => {
  const f = await setup(t, 'updateAppImage');
  const request = await committedRequest(f, 'updateAppImage');
  f.config.RELAY = 'https://hosted-recovery-fixture.invalid/';
  await settled(request);
  assert.equal(attemptedWrites().length, 0);
  assertPending(f);
});

for (const mode of ['development-loopback', 'production-environment', 'development-disabled', 'missing-explicit-port']) {
  test(`without the Node fixture override ${mode} obeys the native source and rollout gates`, async (t) => {
    const f = await setup(t, 'updateAppImage');
    const request = await committedRequest(f, 'updateAppImage');
    if (mode === 'production-environment') f.config.ENVIRONMENT = 'PRODUCTION';
    if (mode === 'development-disabled') f.config.isDevMode = () => false;
    if (mode === 'missing-explicit-port') f.config.RELAY = 'http://127.0.0.1/';
    const fixtureModule = process.env.KEEPER_RELAY_FIXTURE_MODULE;
    delete process.env.KEEPER_RELAY_FIXTURE_MODULE;
    try {
      await settled(request);
    } finally {
      process.env.KEEPER_RELAY_FIXTURE_MODULE = fixtureModule;
    }
    if (mode === 'development-loopback' && f.automatic.AUTOMATIC_BACKUP_SOURCE_READY) {
      assert.equal(attemptedWrites().length, 1);
      assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
    } else {
      assert.equal(attemptedWrites().length, 0);
      assertPending(f);
    }
    assert.equal(f.automatic.AUTOMATIC_BACKUP_RELAY_ROLLOUT_READY, false, 'Disposable source proof never enables the hosted Relay fleet');
  });
}

test('a counterfeit local operation never executes its native transaction callback', async (t) => {
  const f = await setup(t, 'updateAppImage');
  const genuine = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId), f.transport.currentBackupAccountSession());
  let entered = false;
  const receipt = f.automatic.commitBackupLocalOperation({ ...genuine }, (realm) => {
    entered = true;
    operations.updateAppImage.mutate(realm, f);
  });
  assert.equal(entered, false);
  assert.equal(receipt.committed, false);
  assert.equal(receipt.intent, undefined);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a').presentationData.name, 'Initial wallet');
  assert.equal(attemptedWrites().length, 0);
});

test('actual BHR Delete Backup worker acknowledges an explicit deletion without discarding native data', async (t) => {
  const f = await setup(t, 'deleteBackup');
  const worker = f.productionSagas(['currentBackupAppId', 'deleteBackupWorker']);
  await worker.run('deleteBackupWorker', { appId: f.appId, originBackupAccountSession: f.transport.currentBackupAccountSession() });
  assert.equal(attemptedWrites().length, 1);
  assert.equal(attemptedWrites()[0].committed, true);
  assert.equal(f.store.getState().bhr.deleteBackupSuccessByAppId[f.appId], true);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], false);
  assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a'));
});

test('a fresh explicit whole-account deletion works after automatic consent is already off', async (t) => {
  const f = await setup(t, 'deleteBackup');
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: false }));
  const request = await committedRequest(f, 'deleteBackup');
  const result = await settled(request);
  assert.equal(result.backupConfirmed, true);
  assert.equal(attemptedWrites().length, 1);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], false);
});

test('a newer off-to-on choice while the actual delete reply is delayed cannot be overwritten', async (t) => {
  const f = await setup(t, 'deleteBackup');
  const request = await committedRequest(f, 'deleteBackup');
  server.armFault({ mode: 'delay-reply', operation: 'deleteBackup', delayMs: 250 });
  const completion = settled(request);
  const deadline = Date.now() + 5000;
  while (!attemptedWrites().some((entry) => entry.committed)) {
    assert.ok(Date.now() < deadline, 'The genuine server deletion must reach its delayed reply');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: false }));
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  const result = await completion;
  assert.notEqual(result.backupConfirmed, true);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], true);
  assertPending(f);
});

test('a reentrant newer enable choice immediately before final consent disable remains selected', async (t) => {
  const f = await setup(t, 'deleteBackup');
  const request = await committedRequest(f, 'deleteBackup');
  let changed = false;
  f.setBeforeDispatch((action) => {
    if (!changed && action.type === f.bhr.setAutomaticCloudBackup.type && action.payload?.enabled === false) {
      changed = true;
      f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
    }
  });
  const result = await settled(request);
  assert.equal(changed, true);
  assert.notEqual(result.backupConfirmed, true);
  assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], true);
  assertPending(f);
});

for (const persistedKey of ['bhr', 'root']) {
  test(`actual ${persistedKey} Redux Persist boot expires historical verification until fresh encrypted readback`, async (t) => {
    await server.reset();
    const f = await createRealmClient(server.url, { persistedRedux: true });
    t.after(async () => { await f.close(); });
    f.automatic = f.load('src/services/backup/automatic');
    f.installProductionStoreObservers(f.automatic);
    persist(f, f.RealmSchema.Wallet, wallet(f));
    await tick();
    const localBeforeBoot = await f.repair.captureBackupImage();
    await server.seed(await f.payloadForCurrentImage());
    server.clearTrace();

    const interrupted = 'disposable-interrupted-account';
    const completedOnly = 'disposable-completed-only-account';
    const runningOnly = 'disposable-running-only-account';
    const knownDifferent = 'disposable-known-different-account';
    const consentOnly = 'disposable-consent-only-account';
    const consent = {
      [f.appId]: true, [interrupted]: false, [completedOnly]: true,
      [runningOnly]: true, [knownDifferent]: false, [consentOnly]: false,
    };
    const historicalBhr = {
      ...plain(f.store.getState().bhr),
      backupMethod: 'SEED', seedConfirmed: true,
      automaticCloudBackupByAppId: consent,
      backupAllLoading: true, backupAllSuccess: true, backupAllFailure: true,
      deleteBackupSuccess: true, deleteBackupFailure: true,
      backupAllLoadingByAppId: { [f.appId]: true },
      backupAllSuccessByAppId: { [f.appId]: true, [completedOnly]: true },
      backupAllFailureByAppId: { [interrupted]: true },
      deleteBackupSuccessByAppId: { [f.appId]: true },
      deleteBackupFailureByAppId: { [interrupted]: true },
      backupRepairStateByAppId: { [f.appId]: 'verified', [interrupted]: 'uploading', [knownDifferent]: 'different' },
      backupRepairCompletedByAppId: { [f.appId]: true, [completedOnly]: true, [knownDifferent]: false },
      pendingAllBackupByAppId: { [f.appId]: false, [interrupted]: false, [completedOnly]: false, [runningOnly]: false, [knownDifferent]: true },
      // Older snapshots may contain running state despite today's blacklist.
      backupRepairRunningByAppId: { [interrupted]: true, [runningOnly]: true },
      _persist: { version: -1, rehydrated: true },
    };
    const rootSnapshot = {
      storage: { ...plain(f.store.getState().storage), appVersion: 'persisted-safe-version' },
      account: plain(f.store.getState().account),
      _persist: { version: 4, rehydrated: true },
      ...(persistedKey === 'root' ? { bhr: historicalBhr } : {}),
    };
    const inboundBeforeBoot = plain(historicalBhr);
    await f.rehydratePersistedRedux({ root: rootSnapshot, ...(persistedKey === 'bhr' ? { bhr: historicalBhr } : {}) }, { firstKey: persistedKey });
    const state = f.store.getState();
    assert.ok(f.persistedHostReads.includes('persist:root'));
    assert.ok(f.persistedHostReads.includes('persist:bhr'));
    assert.ok(f.actions.some((action) => action.type === 'persist/REHYDRATE' && action.key === persistedKey),
      'Actual persistStore must dispatch through production middleware before the real reconciler merges');
    assert.equal(f.persistedBootStates[0].key, persistedKey, 'The real storage adapter must exercise the requested reconciliation order');
    if (persistedKey === 'root') {
      assert.notEqual(f.persistedBootStates[0].bhr.automaticCloudBackupByAppId[f.appId], true,
        'Legacy consent waits until the nested read actually confirms absence');
      assert.equal(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], true,
        'An absent canonical snapshot allows sanitized legacy consent fallback');
    }
    assert.deepEqual(state.bhr.automaticCloudBackupByAppId, consent, 'Stored per-account consent must remain unchanged');
    assert.equal(state.bhr.backupMethod, 'SEED');
    assert.equal(state.bhr.seedConfirmed, true);
    for (const field of ['backupAllLoading', 'backupAllSuccess', 'backupAllFailure', 'deleteBackupSuccess', 'deleteBackupFailure'])
      assert.equal(state.bhr[field], false, `Historical ${field} must not reappear after a cold boot`);
    for (const field of ['backupAllLoadingByAppId', 'backupAllSuccessByAppId', 'backupAllFailureByAppId', 'deleteBackupSuccessByAppId', 'deleteBackupFailureByAppId'])
      assert.ok(Object.values(state.bhr[field]).every((value) => value === false), `Historical ${field} must not reappear after a cold boot`);
    assert.equal(state.storage.appVersion, 'persisted-safe-version');
    assert.equal(state.storage.appId, f.appId);
    for (const id of [f.appId, interrupted, completedOnly, runningOnly]) {
      assert.equal(state.bhr.backupRepairStateByAppId[id], 'unverified');
      assert.equal(state.bhr.backupRepairCompletedByAppId[id], false);
      assert.equal(state.bhr.pendingAllBackupByAppId[id], true);
      assert.notEqual(state.bhr.backupRepairRunningByAppId[id], true);
    }
    assert.equal(state.bhr.backupRepairStateByAppId[knownDifferent], 'different', 'Existing negative findings are retained');
    assert.equal(state.bhr.pendingAllBackupByAppId[knownDifferent], true);
    assert.equal(state.bhr.backupRepairStateByAppId[consentOnly], undefined, 'Consent alone never manufactures proof or an interrupted job');
    assert.deepEqual(historicalBhr, inboundBeforeBoot, 'Sanitizing the inbound action must not mutate the host snapshot');
    assert.deepEqual(await f.repair.captureBackupImage(), localBeforeBoot, 'Boot must preserve every native recovery record');
    assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined, 'Saved UI status cannot supply a fresh session revision');
    assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
    await tick();
    assert.equal(server.trace.length, 0, 'Rehydration must not replay a read, repair or encrypted write');

    // This is a genuine native commit without a baseline, not a fabricated
    // pending receipt. Saving the unchanged presentation field stays local.
    const noBaseline = f.automatic.beginBackupLocalOperation(f.appId, undefined, f.transport.currentBackupAccountSession());
    const localReceipt = f.automatic.commitBackupLocalOperation(noBaseline, (realm) => {
      realm.objectForPrimaryKey('Wallet', 'wallet-a').presentationData.name = 'Initial wallet';
    });
    assert.equal(localReceipt.committed, true);
    assert.equal(localReceipt.intent, undefined);
    const pending = await f.automatic.enqueueAutomaticBackupOperation(localReceipt, [{
      operation: 'updateAppImage', body: await operations.updateAppImage.body(f),
    }]);
    assert.notEqual(pending.backupConfirmed, true);
    assertPending(f);
    assert.equal(server.trace.length, 0, 'No saved completion may authorize this commit or replay its payload');

    const sagas = f.productionSagas(['currentBackupAppId', 'backupInspectionOwners', 'runBackupInspection']);
    assert.equal(await sagas.run('runBackupInspection', false, f.appId), true,
      'Only current native capture and genuine encrypted HTTP snapshot comparison may earn verification');
    assert.ok(server.trace.some((event) => event.path === '/getBackupSnapshot'));
    assert.equal(attemptedWrites().length, 0, 'Read-only verification must not repair or replay the earlier local operation');
    assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
    assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified');
    assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
    assert.deepEqual(f.store.getState().bhr.automaticCloudBackupByAppId, consent);

    const fresh = await committedRequest(f, 'updateAppImage');
    const uploaded = await settled(fresh);
    assert.equal(uploaded.backupConfirmed, true);
    assert.equal(attemptedWrites().length, 1, 'Only a fresh post-inspection operation may upload');
    assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
    assert.equal(f.store.getState().bhr.backupRepairStateByAppId[completedOnly], 'unverified', 'Current-account proof never restores another account completion');
  });
}

async function persistedConsentFixture(t) {
  await server.reset();
  const f = await createRealmClient(server.url, { persistedRedux: true });
  t.after(async () => { await f.close(); });
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  persist(f, f.RealmSchema.Wallet, wallet(f));
  await tick();
  const localBeforeBoot = await f.repair.captureBackupImage();
  await server.seed(await f.payloadForCurrentImage());
  server.clearTrace();
  const legacy = {
    ...plain(f.store.getState().bhr),
    automaticCloudBackupByAppId: { [f.appId]: true, 'legacy-only-disposable-account': true },
    backupRepairStateByAppId: { [f.appId]: 'verified' },
    backupRepairCompletedByAppId: { [f.appId]: true },
    pendingAllBackupByAppId: { [f.appId]: false },
    _persist: { version: -1, rehydrated: true },
  };
  const canonicalConsent = { [f.appId]: false, 'canonical-disposable-peer': false };
  const canonical = { ...legacy, backupMethod: 'SEED', seedConfirmed: true, automaticCloudBackupByAppId: canonicalConsent };
  const rootSnapshot = {
    storage: plain(f.store.getState().storage), account: plain(f.store.getState().account),
    bhr: legacy, _persist: { version: 4, rehydrated: true },
  };
  const subscriberConsent = [];
  const unsubscribe = f.store.subscribe(() => {
    subscriberConsent.push(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId]);
  });
  t.after(unsubscribe);
  return { f, canonical, canonicalConsent, rootSnapshot, localBeforeBoot, subscriberConsent };
}

for (const firstKey of ['root', 'bhr']) {
  test(`actual persisted ${firstKey}-first reconciliation never lets legacy consent override canonical opt-out`, async (t) => {
    const { f, canonical, canonicalConsent, rootSnapshot, localBeforeBoot, subscriberConsent } = await persistedConsentFixture(t);
    await f.rehydratePersistedRedux({ root: rootSnapshot, bhr: canonical }, { firstKey });
    assert.deepEqual(f.persistedBootStates.map((state) => state.key).filter((key) => ['root', 'bhr'].includes(key)), [firstKey, firstKey === 'root' ? 'bhr' : 'root']);
    assert.ok(subscriberConsent.every((value) => value !== true),
      'Actual subscribers must never observe legacy opt-in while the canonical MMKV read is unresolved or opted out');
    assert.deepEqual(f.store.getState().bhr.automaticCloudBackupByAppId, canonicalConsent,
      'Canonical consent is authoritative for every account; legacy-only consent cannot survive either reconciliation order');
    assert.equal(f.store.getState().bhr.seedConfirmed, true);
    assert.equal(f.store.getState().bhr.backupMethod, 'SEED');
    assertPending(f);
    assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
    assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
    assert.deepEqual(await f.repair.captureBackupImage(), localBeforeBoot);
    await tick();
    assert.equal(server.trace.length, 0, 'Persistence reconciliation must not request or replay a backup');

    const sagas = f.productionSagas(['currentBackupAppId', 'backupInspectionOwners', 'runBackupInspection']);
    assert.equal(await sagas.run('runBackupInspection', false, f.appId, true), true,
      'An explicit read-only check can earn a genuine current proof without re-enabling automatic backup');
    assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
    assert.deepEqual(f.store.getState().bhr.automaticCloudBackupByAppId, canonicalConsent);
    assert.ok(server.trace.some((event) => event.path === '/getBackupSnapshot'));
    assert.equal(attemptedWrites().length, 0);
    const readsBeforeCommit = server.trace.length;
    const request = await committedRequest(f, 'updateAppImage');
    const pending = await f.automatic.enqueueAutomaticBackupOperation(request.receipt, [{ operation: 'updateAppImage', body: request.body }]);
    assert.notEqual(pending.backupConfirmed, true);
    assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet-a').presentationData.name, 'Committed wallet');
    assert.equal(server.trace.length, readsBeforeCommit, 'A fresh proof still cannot authorize an automatic write against saved opt-out');
    assert.equal(attemptedWrites().length, 0);
    assertPending(f);
    assert.deepEqual(f.store.getState().bhr.automaticCloudBackupByAppId, canonicalConsent);
  });
}

test('an actual failed canonical persistence read cannot fall back to older root consent', async (t) => {
  const { f, rootSnapshot, localBeforeBoot, subscriberConsent } = await persistedConsentFixture(t);
  await f.rehydratePersistedRedux({ root: rootSnapshot }, { firstKey: 'root', failKey: 'bhr' });
  assert.deepEqual(f.persistedBootStates.map((state) => state.key).filter((key) => ['root', 'bhr'].includes(key)), ['root', 'bhr']);
  assert.ok(f.actions.some((action) => action.type === 'persist/REHYDRATE' && action.key === 'bhr' && action.err),
    'The actual persistStore failure path must reach production middleware');
  assert.ok(subscriberConsent.every((value) => value !== true), 'A failed read must never expose the older opt-in to subscribers');
  assert.notEqual(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], true);
  assert.notEqual(f.store.getState().bhr.backupRepairCompletedByAppId[f.appId], true);
  assert.notEqual(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified');
  assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.deepEqual(await f.repair.captureBackupImage(), localBeforeBoot);
  await tick();
  assert.equal(server.trace.length, 0);
  const sagas = f.productionSagas(['currentBackupAppId', 'backupInspectionOwners', 'runBackupInspection']);
  assert.equal(await sagas.run('runBackupInspection', false, f.appId, true), true);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  assert.notEqual(f.store.getState().bhr.automaticCloudBackupByAppId[f.appId], true,
    'A subsequent real read-only verification cannot turn unavailable stored consent into opt-in');
  assert.equal(attemptedWrites().length, 0);
});

test('actual absent-first legacy fallback without persistence metadata retains future nested writes', async (t) => {
  const { f, rootSnapshot, localBeforeBoot } = await persistedConsentFixture(t);
  const pendingPeer = 'disposable-persisted-pending-peer';
  // This is the raw shape of an older root snapshot, before BHR had nested
  // persistence. It deliberately omits live initialized fields and _persist.
  rootSnapshot.bhr = {
    backupMethod: 'SEED', automaticCloudBackupByAppId: { [f.appId]: true },
    backupRepairStateByAppId: { [f.appId]: 'verified' },
    backupRepairCompletedByAppId: { [f.appId]: true },
    pendingAllBackupByAppId: { [f.appId]: false, [pendingPeer]: false },
  };
  await f.rehydratePersistedRedux({ root: rootSnapshot }, { firstKey: 'bhr' });
  assert.deepEqual(f.persistedBootStates.map((state) => state.key).filter((key) => ['root', 'bhr'].includes(key)), ['bhr', 'root']);
  const restored = f.store.getState().bhr;
  assert.equal(restored.automaticCloudBackupByAppId[f.appId], true, 'Confirmed nested absence permits sanitized raw legacy fallback');
  assert.equal(restored.backupMethod, 'SEED');
  assertPending(f);
  assert.equal(restored._persist.rehydrated, true, 'The late root merge must retain live nested persistence metadata');
  assert.equal(restored._persist.version, -1);
  assert.deepEqual(plain(restored.backupAllLoadingByAppId), {});
  assert.deepEqual(plain(restored.seedWords), [], 'Initialized fields absent from old payloads must remain available');
  assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.deepEqual(await f.repair.captureBackupImage(), localBeforeBoot);
  assert.equal(server.trace.length, 0);

  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: false }));
  f.store.dispatch(f.bhr.setPendingAllBackup({ appId: pendingPeer, pending: true }));
  await f.flushPersistedRedux();
  const saved = f.readPersistedRedux('bhr');
  assert.equal(saved.automaticCloudBackupByAppId[f.appId], false, 'Actual nested persistence must store a later consent opt-out');
  assert.equal(saved.pendingAllBackupByAppId[pendingPeer], true, 'Actual nested persistence must store a later pending-state change');
  assert.equal(saved.backupRepairStateByAppId[f.appId], 'unverified');
  assert.equal(saved.backupRepairCompletedByAppId[f.appId], false);
  assert.equal(saved.backupMethod, 'SEED');
  assert.equal(saved._persist.rehydrated, true);
  assert.equal(f.store.getState().bhr._persist.rehydrated, true);
  assert.equal(f.transport.captureBackupWriteIntent(f.appId), undefined);
  assert.deepEqual(await f.repair.captureBackupImage(), localBeforeBoot);
  await tick();
  assert.equal(server.trace.length, 0, 'Legacy fallback and subsequent storage flush must never replay a backup request');
});

test('actual AssistedBackupStatus phase expression requires current native session proof', async (t) => {
  const f = await setup(t, 'updateAppImage');
  // Execute the exact production phase declarations only. This is a native
  // proof/HTTP integration contract, not a React render or native UI test.
  const expression = componentDeclarations('src/screens/AppSettings/AssistedBackupStatus.tsx',
    'AssistedBackupStatus', ['recordedPhase', 'phase']);
  function displayedPhase() {
    const scope = { id: f.appId, backupRepairStateByAppId: f.store.getState().bhr.backupRepairStateByAppId,
      isBackupVerificationCurrent: f.automatic.isBackupVerificationCurrent };
    evaluate(expression, scope, 'production-assisted-backup-phase.ts');
    return scope.phase;
  }
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  assert.equal(displayedPhase(), 'verified', 'Fresh complete encrypted HTTP comparison may display Verified');
  await f.selectAccount('disposable-status-other-account');
  await f.selectAccount();
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified',
    'Historical Redux phase deliberately remains present while session proof has expired');
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.equal(displayedPhase(), 'unverified', 'Returning to A cannot reuse the first A session display claim');
  assert.equal(server.trace.length, 0, 'Evaluating status must never request or replay a backup');
  assert.equal(await f.sagas.run('runBackupInspection', false, f.appId), true);
  assert.ok(server.trace.some((event) => event.path === '/getBackupSnapshot'));
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  assert.equal(displayedPhase(), 'verified', 'A fresh genuine readback may restore the display claim');
  const beforeLocalChange = server.trace.length;
  f.nativeRealm().write(() => {
    f.nativeRealm().objectForPrimaryKey('Wallet', 'wallet-a').presentationData.name = 'Changed native recovery record';
  });
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified',
    'The display predicate must also reject a stale phase before Redux has received a mutation notification');
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.equal(displayedPhase(), 'unverified');
  assert.equal(server.trace.length, beforeLocalChange);
  assert.equal(attemptedWrites().length, 0);
});
