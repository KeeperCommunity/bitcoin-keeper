// Additive signed-v3 port of all 11 historical wallet/vault caller cases.
// Actual production workers, origin middleware, encrypted native Realm, AES,
// authority, HTTP and transactional Relay are real. Only the original complete,
// intentionally unspendable wallet/vault factory inputs and unrelated UI actions
// are adapters. No successful write, receipt or verification is fabricated.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test: nodeTest, beforeEach, afterEach, after } = require('node:test');
const { declarations, componentDeclarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const { createProtectedServer, createProtectedRealmClient } = require('./protectedWriteRealmRelay.fixture.cjs');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = require('bip39').mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
let server;
// Every case owns fresh genuine router admission buckets and cleanup.
beforeEach(async () => { server = await createProtectedServer(); });
afterEach(async () => { await server?.close(); server = undefined; });
after(() => Realm.shutdown());
const test = (name, run) => nodeTest(name, { timeout: 20_000 }, run);
const writes = () => server.trace.filter(event => event.path === '/backup/v3/mutate');

function deferred(t) {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  t.after(() => resolve());
  return { promise, resolve };
}

// Observe the actual incoming HTTP trace before the fixture forwards a mutation.
// No request, response, transaction or source record is replaced by this hook.
function observeMutationAdmission(t, capture) {
  const observed = [];
  const original = server.trace.push;
  const trace = server.trace;
  trace.push = function (...events) {
    for (const event of events) if (event.path === '/backup/v3/mutate') observed.push(capture(event));
    return original.apply(this, events);
  };
  t.after(() => { trace.push = original; });
  return observed;
}

function assertOwnNextTuple(previous, next) {
  assert.equal(next.namespaceId, previous.namespaceId);
  assert.equal(next.expectedRevision, previous.serverRevision);
  assert.equal(next.expectedGeneration, previous.serverGeneration);
  assert.equal(next.authEpoch, previous.serverAuthEpoch);
}

function assertPending(f) {
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), false);
  assert.notEqual(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified');
}

async function assertConfirmed(f, count = 1) {
  assert.equal(writes().length, count);
  assert.ok(writes().every(event => event.committed));
  const remote = await f.read();
  assert.equal(remote.snapshot.revision, writes().at(-1).serverRevision);
  assert.equal(remote.snapshot.generation, writes().at(-1).serverGeneration);
  assert.equal(remote.snapshot.authEpoch, writes().at(-1).serverAuthEpoch);
  const image = await f.decode(remote);
  assert.equal(await f.image.compareImages(await f.repair.captureBackupImage(), image), 'matched');
  assert.equal(f.automatic.isBackupVerificationCurrent(f.appId), true);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
  assert.equal(f.store.getState().bhr.backupRepairStateByAppId[f.appId], 'verified');
  assert.equal(f.store.getState().bhr.backupRepairCompletedByAppId[f.appId], true);
  return image;
}

async function assertConsumedNoReplay(f) {
  const queued = f.queueCalls.at(-1);
  assert.ok(queued, 'The actual producer must have submitted its genuine receipt');
  const count = writes().length;
  const result = await f.automatic.enqueueAutomaticBackupOperation(queued.receipt, queued.mutations);
  assert.notEqual(result.backupConfirmed, true);
  assert.equal(writes().length, count, 'A consumed uncertain or partial receipt cannot replay ciphertext');
}

function wallet(f, id = 'wallet') {
  return f.defaults(f.RealmSchema.Wallet, {
    id, entityKind: f.enums.EntityKind.WALLET, type: f.enums.WalletType.DEFAULT,
    networkType: f.enums.NetworkType.TESTNET, scriptType: 'P2WPKH',
    derivationDetails: f.defaults(f.RealmSchema.WalletDerivationDetails, { instanceNum: 0, xDerivationPath: "m/84'/1'/0'" }),
    presentationData: f.defaults(f.RealmSchema.WalletPresentationData, { name: 'Initial wallet', visibility: 'DEFAULT' }),
    specs: f.defaults(f.RealmSchema.WalletSpecs, { xpub: `disposable-public-${id}`, nextFreeAddressIndex: 1 }),
  });
}

function signer(f) {
  const record = f.defaults(f.RealmSchema.Signer, {
    masterFingerprint: 'aaaa0001', type: f.enums.SignerType.COLDCARD, storageType: f.enums.SignerStorage.COLD,
    signerName: 'Disposable public key', networkType: f.enums.NetworkType.TESTNET,
    signerXpubs: f.defaults(f.RealmSchema.SignerXpubs, {
      [f.enums.XpubTypes.P2WSH]: [{ xpub: 'disposable-vault-public-key', xpriv: null, derivationPath: "m/48'/1'/0'/2'" }],
    }),
  });
  record.id = f.utilities.getKeyUID(record);
  return record;
}

function vault(f, id, key) {
  return f.defaults(f.RealmSchema.Vault, {
    id, entityKind: f.enums.EntityKind.VAULT, type: f.enums.VaultType.DEFAULT,
    networkType: f.enums.NetworkType.TESTNET, isMultiSig: true, scriptType: 'P2WSH',
    scheme: f.defaults(f.RealmSchema.VaultScheme, { m: 1, n: 1 }), signers: [key],
    presentationData: f.defaults(f.RealmSchema.VaultPresentationData, { name: id, visibility: 'DEFAULT' }),
    specs: f.defaults(f.RealmSchema.VaultSpecs, { xpubs: [key.xpub], nextFreeAddressIndex: 1 }),
  });
}

async function setup(t, prepare = () => {}) {
  await server.reset();
  const f = await createProtectedRealmClient(server.url, {
    appId, primarySeed: seed.toString('hex'), primaryMnemonic: mnemonic,
  });
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  prepare(f);
  const sagas = f.productionSagas([
    'currentBackupAppId', 'buildAutomaticAppMutation', 'buildAutomaticVaultMutation',
    'queueCommittedBackupWorker', 'updateAppImageWorker', 'updateVaultImageWorker',
    'deleteAppImageEntityWorker', 'deleteVaultImageWorker',
    'backupInspectionOwners', 'runBackupInspection',
  ], {
    ...f.automatic,
    addNewWallet: async (_type, details) => details.fixture,
    generateVault: async ({ signers }) => vault(f, 'new-vault', signers[0]),
    uaiChecks: payload => ({ type: 'fixture-uai', payload }),
    uaiType: { SECURE_VAULT: 'SECURE_VAULT' },
    initiateVaultMigration: payload => ({ type: 'fixture-migration', payload }),
    vaultCreated: payload => ({ type: 'fixture-vault-created', payload }),
    setIsCloudBsmsBackupRequired: payload => ({ type: 'fixture-bsms-required', payload }),
    backupBsmsOnCloud: () => ({ type: 'fixture-bsms-queue' }),
  });
  assert.equal(await sagas.run('runBackupInspection', true, f.appId, true), true,
    'Only explicit production opt-in may enroll and verify the current namespace');
  assert.ok(f.transport.captureBackupWriteIntent(f.appId)?.protectedBase);
  evaluate(declarations('src/store/sagas/wallets.ts', [
    'currentWalletAccountId', 'assertWalletAccount', 'addNewWalletsWorker',
    'updateWalletDetailsWorker', 'updateRecoveryVisibilityWorker', 'addNewVaultWorker',
    'deleteVaultWorker',
  ]), sagas.scope, 'production-wallet-producers.ts');
  const uiScope = {
    ...sagas.scope,
    activeRealmAppId: () => f.appId,
    isBackupVerificationCurrent: f.automatic.isBackupVerificationCurrent,
  };
  evaluate(componentDeclarations(
    'src/screens/AppSettings/ManageWallets.tsx', 'ManageWallets', ['canDeleteRecoveryEntity']
  ), uiScope, 'production-manage-wallets-delete-gate.tsx');
  f.scope = sagas.scope;
  f.canDeleteRecoveryEntity = uiScope.canDeleteRecoveryEntity;
  const actionTypes = {
    addNewWalletsWorker: 'ADD_NEW_WALLETS', updateWalletDetailsWorker: 'UPDATE_WALLET_DETAILS',
    updateRecoveryVisibilityWorker: 'UPDATE_RECOVERY_VISIBILITY', addNewVaultWorker: 'ADD_NEW_VAULT',
    deleteVaultWorker: 'DELETE_VAULT', deleteAppImageEntityWorker: 'DELETE_APP_IMAGE_ENTITY',
  };
  f.run = (name, payload, metadata = {}) => {
    assert.ok(actionTypes[name], 'Use an actual production action type');
    const action = f.store.dispatch({ type: actionTypes[name], payload, ...metadata });
    assert.equal(action.originAppId, f.appId);
    assert.equal(action.originBackupAccountSession, f.transport.currentBackupAccountSession());
    assert.equal(f.transport.isCapturedBackupWriteIntent(action.originBackupWriteIntent), true);
    f.lastAction = action;
    return sagas.run(name, action);
  };
  f.queueCalls = [];
  const queue = sagas.scope.queueCommittedBackupWorker;
  sagas.scope.queueCommittedBackupWorker = function* (...args) {
    // Capture exact arguments, then delegate unchanged to the actual generator.
    // The retained receipt identity and ciphertext prove no-replay behavior.
    f.queueCalls.push({ receipt: args[1], mutations: args[2] });
    return yield* queue(...args);
  };
  f.read = async () => {
    const result = await f.protected.readProtectedBackup(mnemonic, undefined, f.appId);
    assert.equal(result.state, 'present');
    return result;
  };
  f.decode = remote => f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    remote.snapshot, remote.namespaceId, () => {}, true);
  f.remoteImage = async () => f.decode(await f.read());
  f.initial = await f.read();
  server.clearTrace();
  return f;
}

const newWallets = (f, ...records) => records.map(record => ({
  walletType: f.enums.WalletType.DEFAULT, walletDetails: { fixture: record },
}));

test('actual wallet creation atomically saves both wallets before the first genuine HTTP mutation', async t => {
  const f = await setup(t);
  const observed = observeMutationAdmission(t, () => ['first', 'second'].map(id =>
    !!f.dbManager.getObjectById(f.RealmSchema.Wallet, id)));
  assert.equal(await f.run('addNewWalletsWorker', newWallets(f, wallet(f, 'first'), wallet(f, 'second'))), true);
  assert.deepEqual(observed, [[true, true]]);
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].committed, true);
  assert.deepEqual(Object.keys((await assertConfirmed(f)).wallets).sort(), ['first', 'second']);
  assert.equal(writes()[0].expectedRevision, f.initial.snapshot.revision);
  assert.equal(writes()[0].expectedGeneration, f.initial.snapshot.generation);
  assert.equal(writes()[0].authEpoch, f.initial.snapshot.authEpoch);
});

test('actual second wallet insertion failure rolls back the first wallet and never reaches HTTP', async t => {
  const f = await setup(t);
  assert.equal(await f.run('addNewWalletsWorker', newWallets(f, wallet(f, 'duplicate'), wallet(f, 'duplicate'))), false);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Wallet).length, 0);
  assert.equal(writes().length, 0);
  assert.equal(server.trace.length, 0, 'Native rollback cannot enter backup HTTP');
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.equal((await f.read()).snapshot.revision, f.initial.snapshot.revision);
});

test('actual wallet rename survives HTTP conflict and reports local success with backup pending', async t => {
  const f = await setup(t, f => assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet(f)), true));
  const base = f.transport.captureBackupWriteIntent(f.appId).protectedBase;
  server.armFault({ path: '/backup/v3/snapshot', async beforeReply() {
    assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet').presentationData.name, 'Committed rename');
    // A genuine competing signed no-op node update advances the actual CAS.
    await f.protected.protectedBackupMutation(mnemonic, base, 'updateAppImage', { nodes: [], replaceNodes: true });
  } });
  assert.equal(await f.run('updateWalletDetailsWorker', {
    wallet: wallet(f), details: { name: 'Committed rename', description: 'Local description' },
  }), true);
  assert.equal(writes().length, 2, 'One actual peer CAS and one rejected caller CAS');
  assert.deepEqual(writes().map(event => event.status), [200, 409]);
  assert.equal(writes()[0].committed, true);
  assert.equal(writes()[1].committed, false);
  assert.equal(writes()[1].expectedRevision, base.revision);
  assert.equal(writes()[1].expectedGeneration, base.generation);
  assert.equal(writes()[1].authEpoch, base.authEpoch);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet').presentationData.name, 'Committed rename');
  assertPending(f);
  assert.equal((await f.remoteImage()).wallets.wallet.presentationData.name, 'Initial wallet');
  await assertConsumedNoReplay(f);
});

test('encrypted Realm Hide holds Delete until readback, then managed wallet deletion uses its own new tuple', async t => {
  const f = await setup(t, f => assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet(f)), true));
  const entered = deferred(t);
  const release = deferred(t);
  server.armFault({ path: '/backup/v3/mutate', operation: 'updateAppImage',
    beforeReply() { entered.resolve(); return release.promise; } });
  let localCommit;
  const hiding = f.run('updateRecoveryVisibilityWorker', {
    entityId: 'wallet', entityKind: f.enums.EntityKind.WALLET,
    visibility: f.enums.VisibilityType.HIDDEN,
  }, { onLocalComplete: updated => { localCommit = updated; } });
  await entered.promise;
  assert.equal(localCommit, true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet').presentationData.visibility, 'HIDDEN');
  assert.equal(f.canDeleteRecoveryEntity(wallet(f)), false);
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].committed, true, 'The held ACK follows an actual backend commit');
  release.resolve();
  assert.equal(await hiding, true);
  assert.equal(f.canDeleteRecoveryEntity(wallet(f)), true);
  assert.equal((await assertConfirmed(f)).wallets.wallet.presentationData.visibility, 'HIDDEN');
  const removed = await f.run('deleteAppImageEntityWorker', { walletIds: ['wallet'] });
  assert.equal(removed.updated, true);
  assert.equal(removed.backupConfirmed, true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet'), undefined);
  assert.deepEqual(Object.keys((await assertConfirmed(f, 2)).wallets), []);
  assertOwnNextTuple(writes()[0], writes()[1]);
  assert.equal(writes()[1].operation, 'deleteAppImageEntity');
});

test('lost Hide acknowledgement keeps the local change but withholds Delete and does not replay it', async t => {
  const f = await setup(t, f => assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet(f)), true));
  server.armFault({ path: '/backup/v3/mutate', mode: 'lost-reply', operation: 'updateAppImage' });
  let localCommit;
  assert.equal(await f.run('updateRecoveryVisibilityWorker', {
    entityId: 'wallet', entityKind: f.enums.EntityKind.WALLET,
    visibility: f.enums.VisibilityType.HIDDEN,
  }, { onLocalComplete: updated => { localCommit = updated; } }), true);
  assert.equal(localCommit, true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet').presentationData.visibility, 'HIDDEN');
  assert.equal(f.canDeleteRecoveryEntity(wallet(f)), false);
  assertPending(f);
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].committed, true);
  assert.equal((await f.remoteImage()).wallets.wallet.presentationData.visibility, 'HIDDEN');
  assert.equal(f.canDeleteRecoveryEntity(wallet(f)), false, 'A matching independent read cannot replace the missing ACK');
  await assertConsumedNoReplay(f);
  assert.equal(writes().length, 1);
});

test('actual old-session wallet factory completion cannot save after A to B to A', async t => {
  const f = await setup(t);
  const entered = deferred(t);
  const gate = deferred(t);
  f.scope.addNewWallet = async (_type, details) => { entered.resolve(); await gate.promise; return details.fixture; };
  const running = f.run('addNewWalletsWorker', newWallets(f, wallet(f)));
  await entered.promise;
  const originalSession = f.lastAction.originBackupAccountSession;
  await f.selectAccount('disposable-other-account');
  await f.selectAccount(f.appId);
  assert.notEqual(f.transport.currentBackupAccountSession(), originalSession);
  gate.resolve();
  assert.equal(await running, false);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Wallet).length, 0);
  assert.equal(writes().length, 0);
  assert.equal((await f.read()).snapshot.revision, f.initial.snapshot.revision);
});

test('a current wallet receipt cannot send stale encrypted presentation data', async t => {
  const f = await setup(t, f => assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet(f)), true));
  const operation = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId));
  const receipt = f.automatic.commitBackupLocalOperation(operation, realm => {
    realm.objectForPrimaryKey('Wallet', 'wallet').presentationData.name = 'Committed rename';
  });
  assert.equal(receipt.committed, true);
  assert.equal(receipt.intent.protectedBase.revision, f.initial.snapshot.revision);
  const body = { appId: f.appId, walletsObject: {
    wallet: await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed), wallet(f)),
  } };
  const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, [{ operation: 'updateAppImage', body }]);
  assert.equal(result.backupPending, true);
  assert.equal(writes().length, 0);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet').presentationData.name, 'Committed rename');
  assertPending(f);
  assert.equal((await f.remoteImage()).wallets.wallet.presentationData.name, 'Initial wallet');
});

async function vaultSetup(t) {
  return setup(t, f => {
    const parent = signer(f);
    const key = f.defaults(f.RealmSchema.VaultSigner, {
      ...parent.signerXpubs[f.enums.XpubTypes.P2WSH][0], masterFingerprint: parent.masterFingerprint, xfp: parent.masterFingerprint,
      xpriv: 'unspendable-disposable-private-material',
      registeredVaults: [{ vaultId: 'old-vault', registered: true, hmac: 'disposable-hmac' }],
    });
    assert.equal(f.dbManager.createObject(f.RealmSchema.Signer, parent), true);
    assert.equal(f.dbManager.createObject(f.RealmSchema.Vault, vault(f, 'old-vault', key)), true);
  });
}

test('encrypted Realm vault Hide and managed Delete both advance the verified remote image', async t => {
  const f = await vaultSetup(t);
  const hiding = await f.run('updateRecoveryVisibilityWorker', {
    entityId: 'old-vault', entityKind: f.enums.EntityKind.VAULT,
    visibility: f.enums.VisibilityType.HIDDEN,
  });
  assert.equal(hiding, true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Vault, 'old-vault').presentationData.visibility, 'HIDDEN');
  assert.equal(f.canDeleteRecoveryEntity({ entityKind: f.enums.EntityKind.VAULT }), true);
  assert.equal((await assertConfirmed(f)).vaults['old-vault'].presentationData.visibility, 'HIDDEN');
  assert.equal(await f.run('deleteVaultWorker', { vaultId: 'old-vault' }), true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Vault, 'old-vault'), undefined);
  assert.deepEqual(Object.keys((await assertConfirmed(f, 2)).vaults), []);
  assertOwnNextTuple(writes()[0], writes()[1]);
  assert.equal(writes()[1].operation, 'deleteVaults');
});

function newVaultPayload(f, migrated = false) {
  const key = plain(f.dbManager.getObjectByPrimaryId(f.RealmSchema.VaultSigner, 'xpub', 'disposable-vault-public-key'));
  return { isMigrated: migrated, oldVaultId: migrated ? 'old-vault' : undefined, newVaultInfo: {
    vaultType: f.enums.VaultType.DEFAULT, vaultScheme: { m: 1, n: 1 },
    vaultSigners: [{ ...key, registeredVaults: [], xpriv: null }],
    vaultDetails: { name: 'New vault', description: '' },
  } };
}

test('actual vault creation preserves shared signer registrations and remembered private material', async t => {
  const f = await vaultSetup(t);
  assert.equal(await f.run('addNewVaultWorker', newVaultPayload(f)), true);
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].committed, true);
  const stored = f.dbManager.getObjectByPrimaryId(f.RealmSchema.VaultSigner, 'xpub', 'disposable-vault-public-key');
  assert.equal(stored.xpriv, 'unspendable-disposable-private-material');
  assert.equal(stored.registeredVaults[0].vaultId, 'old-vault');
  assert.equal(stored.registeredVaults[0].hmac, 'disposable-hmac');
  const image = await assertConfirmed(f);
  assert.ok(image.vaults['old-vault']);
  assert.ok(image.vaults['new-vault']);
});

for (const failSecond of [false, true]) test(`actual vault migration commits both local effects then sends old archive before new vault (second fails=${failSecond})`, async t => {
  const f = await vaultSetup(t);
  const localAtAdmission = observeMutationAdmission(t, () => ({
    archived: f.dbManager.getObjectById(f.RealmSchema.Vault, 'old-vault').archived,
    created: !!f.dbManager.getObjectById(f.RealmSchema.Vault, 'new-vault'),
  }));
  const imagesAfterOwnWrites = [];
  if (failSecond) {
    server.armFault({ path: '/backup/v3/mutate', operation: 'updateVaultImage', async beforeReply({ body }) {
      // Member1 already committed. Commit a real peer mutation before ACK1 is
      // delivered; member2 must retain ACK1's tuple and encounter actual 409.
      await f.protected.protectedBackupMutation(mnemonic, {
        namespaceId: f.initial.namespaceId, revision: body.newRevision,
        generation: body.newGeneration, authEpoch: body.authEpoch,
      }, 'updateAppImage', { nodes: [], replaceNodes: true });
    } });
  } else {
    for (let i = 0; i < 2; i++) server.armFault({
      path: '/backup/v3/mutate', operation: 'updateVaultImage', async beforeReply() {
        const image = await f.remoteImage();
        imagesAfterOwnWrites.push({ archived: image.vaults['old-vault'].archived,
          created: !!image.vaults['new-vault'] });
      },
    });
  }
  assert.equal(await f.run('addNewVaultWorker', newVaultPayload(f, true)), true);
  assert.equal(writes().length, failSecond ? 3 : 2);
  assert.deepEqual(localAtAdmission, Array.from({ length: failSecond ? 3 : 2 }, () => ({ archived: true, created: true })),
    'Both local effects must exist at every actual incoming mutation, including the first');
  assert.equal(writes()[0].committed, true);
  if (!failSecond) {
    assert.deepEqual(imagesAfterOwnWrites, [{ archived: true, created: false }, { archived: true, created: true }],
      'Genuine intermediate snapshots must show old archive before new vault');
    assertOwnNextTuple(writes()[0], writes()[1]);
    assert.ok(writes().every(event => event.operation === 'updateVaultImage'));
  } else {
    assert.deepEqual(writes().map(event => event.status), [200, 200, 409]);
    assert.deepEqual(writes().map(event => event.operation), ['updateVaultImage', 'updateAppImage', 'updateVaultImage']);
    assertOwnNextTuple(writes()[0], writes()[2]);
    assert.notEqual(writes()[2].expectedRevision, writes()[1].serverRevision, 'Member2 must not borrow the peer CAS');
    assert.equal(writes()[2].committed, false);
  }
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Vault, 'old-vault').archived, true);
  assert.ok(f.dbManager.getObjectById(f.RealmSchema.Vault, 'new-vault'));
  const image = await f.remoteImage();
  assert.equal(image.vaults['old-vault'].archived, true);
  assert.equal(!!image.vaults['new-vault'], !failSecond);
  if (failSecond) {
    assertPending(f);
    await assertConsumedNoReplay(f);
    assert.equal(writes().length, 3);
  } else await assertConfirmed(f, 2);
});
