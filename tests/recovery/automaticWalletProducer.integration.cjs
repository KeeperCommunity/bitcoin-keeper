// Production wallet/vault producers with native encrypted Realm, actual AES,
// branded source receipts and real transactional Relay HTTP. Factory adapters
// supply complete, intentionally unspendable public fixtures; no DB or backup
// commit/proof is mocked.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const { createRealmClient, declarations, componentDeclarations, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
const fixtureModule = process.env.KEEPER_RELAY_FIXTURE_MODULE;
assert.ok(fixtureModule, 'Set KEEPER_RELAY_FIXTURE_MODULE to the pinned production Relay fixture');
const { createFixture } = require(fixtureModule);
let server;
before(async () => { server = await createFixture(); });
after(async () => { await server?.close(); Realm.shutdown(); });
const writes = () => server.trace.filter(event => event.path === '/revisionedBackupMutation');

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
  const f = await createRealmClient(server.url);
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  f.store.dispatch(f.bhr.setAutomaticCloudBackup({ appId: f.appId, enabled: true }));
  prepare(f);
  await server.seed(await f.payloadForCurrentImage());
  assert.equal(await f.repair.inspectBackup(f.appId, false, () => {}), 'verified');
  server.clearTrace();
  const sagas = f.productionSagas([
    'currentBackupAppId', 'buildAutomaticAppMutation', 'buildAutomaticVaultMutation',
    'queueCommittedBackupWorker', 'updateAppImageWorker', 'updateVaultImageWorker',
    'deleteAppImageEntityWorker', 'deleteVaultImageWorker',
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
  f.run = (name, payload, metadata = {}) => sagas.run(name, {
    payload, originAppId: f.appId,
    originBackupAccountSession: f.transport.currentBackupAccountSession(),
    originBackupWriteIntent: f.transport.captureBackupWriteIntent(f.appId), ...metadata,
  });
  f.remoteImage = async () => f.image.decodeImage(f.encryption.generateEncryptionKey(f.seed),
    await server.snapshot(f.appId), f.appId, () => {}, true);
  return f;
}

const newWallets = (f, ...records) => records.map(record => ({
  walletType: f.enums.WalletType.DEFAULT, walletDetails: { fixture: record },
}));

test('actual wallet creation atomically saves both wallets before the first genuine HTTP mutation', async t => {
  const f = await setup(t);
  server.armFault({ beforeMutation() {
    for (const id of ['first', 'second']) assert.ok(f.dbManager.getObjectById(f.RealmSchema.Wallet, id));
  } });
  assert.equal(await f.run('addNewWalletsWorker', newWallets(f, wallet(f, 'first'), wallet(f, 'second'))), true);
  assert.equal(writes().length, 1);
  assert.equal(writes()[0].committed, true);
  assert.deepEqual(Object.keys((await f.remoteImage()).wallets).sort(), ['first', 'second']);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
});

test('actual second wallet insertion failure rolls back the first wallet and never reaches HTTP', async t => {
  const f = await setup(t);
  assert.equal(await f.run('addNewWalletsWorker', newWallets(f, wallet(f, 'duplicate'), wallet(f, 'duplicate'))), false);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Wallet).length, 0);
  assert.equal(writes().length, 0);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
});

test('actual wallet rename survives HTTP conflict and reports local success with backup pending', async t => {
  const f = await setup(t, f => assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet(f)), true));
  server.armFault({ mode: '409', operation: 'updateAppImage', beforeMutation() {
    assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet').presentationData.name, 'Committed rename');
  } });
  assert.equal(await f.run('updateWalletDetailsWorker', {
    wallet: wallet(f), details: { name: 'Committed rename', description: 'Local description' },
  }), true);
  assert.equal(writes().length, 1);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet').presentationData.name, 'Committed rename');
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.equal((await f.remoteImage()).wallets.wallet.presentationData.name, 'Initial wallet');
});

test('native Hide holds Delete until readback, then managed wallet deletion can use the new revision', async t => {
  const f = await setup(t, f => assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet(f)), true));
  let entered;
  const mutationStarted = new Promise(resolve => { entered = resolve; });
  server.armFault({ mode: 'delay-reply', operation: 'updateAppImage', delayMs: 350,
    beforeMutation() { entered(); } });
  let localCommit;
  const hiding = f.run('updateRecoveryVisibilityWorker', {
    entityId: 'wallet', entityKind: f.enums.EntityKind.WALLET,
    visibility: f.enums.VisibilityType.HIDDEN,
  }, { onLocalComplete: updated => { localCommit = updated; } });
  await mutationStarted;
  assert.equal(localCommit, true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet').presentationData.visibility, 'HIDDEN');
  assert.equal(f.canDeleteRecoveryEntity(wallet(f)), false);
  assert.equal(await hiding, true);
  assert.equal(f.canDeleteRecoveryEntity(wallet(f)), true);
  assert.equal((await f.remoteImage()).wallets.wallet.presentationData.visibility, 'HIDDEN');
  assert.equal(writes().length, 1);
  const removed = await f.run('deleteAppImageEntityWorker', { walletIds: ['wallet'] });
  assert.equal(removed.updated, true);
  assert.equal(removed.backupConfirmed, true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet'), undefined);
  assert.deepEqual(Object.keys((await f.remoteImage()).wallets), []);
  assert.equal(writes().length, 2);
});

test('lost Hide acknowledgement keeps the local change but withholds Delete and does not replay it', async t => {
  const f = await setup(t, f => assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet(f)), true));
  server.armFault({ mode: 'lost-reply', operation: 'updateAppImage' });
  let localCommit;
  assert.equal(await f.run('updateRecoveryVisibilityWorker', {
    entityId: 'wallet', entityKind: f.enums.EntityKind.WALLET,
    visibility: f.enums.VisibilityType.HIDDEN,
  }, { onLocalComplete: updated => { localCommit = updated; } }), true);
  assert.equal(localCommit, true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet').presentationData.visibility, 'HIDDEN');
  assert.equal(f.canDeleteRecoveryEntity(wallet(f)), false);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], true);
  assert.equal(writes().length, 1);
  assert.equal((await f.remoteImage()).wallets.wallet.presentationData.visibility, 'HIDDEN');
  assert.equal(writes().length, 1);
});

test('actual old-session wallet factory completion cannot save after A to B to A', async t => {
  const f = await setup(t);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  f.scope.addNewWallet = async (_type, details) => { entered(); await gate; return details.fixture; };
  const running = f.run('addNewWalletsWorker', newWallets(f, wallet(f)));
  await started;
  await f.selectAccount('disposable-other-account');
  await f.selectAccount(f.appId);
  release();
  assert.equal(await running, false);
  assert.equal(f.dbManager.getCollection(f.RealmSchema.Wallet).length, 0);
  assert.equal(writes().length, 0);
});

test('a current wallet receipt cannot send stale encrypted presentation data', async t => {
  const f = await setup(t, f => assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet(f)), true));
  const operation = f.automatic.beginBackupLocalOperation(f.appId, f.transport.captureBackupWriteIntent(f.appId));
  const receipt = f.automatic.commitBackupLocalOperation(operation, realm => {
    realm.objectForPrimaryKey('Wallet', 'wallet').presentationData.name = 'Committed rename';
  });
  const body = { appId: f.appId, walletsObject: {
    wallet: await f.image.encryptRecord(f.encryption.generateEncryptionKey(f.seed), wallet(f)),
  } };
  const result = await f.automatic.enqueueAutomaticBackupOperation(receipt, [{ operation: 'updateAppImage', body }]);
  assert.equal(result.backupPending, true);
  assert.equal(writes().length, 0);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Wallet, 'wallet').presentationData.name, 'Committed rename');
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

test('native vault Hide and managed Delete both advance the verified remote image', async t => {
  const f = await vaultSetup(t);
  const hiding = await f.run('updateRecoveryVisibilityWorker', {
    entityId: 'old-vault', entityKind: f.enums.EntityKind.VAULT,
    visibility: f.enums.VisibilityType.HIDDEN,
  });
  assert.equal(hiding, true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Vault, 'old-vault').presentationData.visibility, 'HIDDEN');
  assert.equal(f.canDeleteRecoveryEntity({ entityKind: f.enums.EntityKind.VAULT }), true);
  assert.equal((await f.remoteImage()).vaults['old-vault'].presentationData.visibility, 'HIDDEN');
  assert.equal(writes().length, 1);
  assert.equal(await f.run('deleteVaultWorker', { vaultId: 'old-vault' }), true);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Vault, 'old-vault'), undefined);
  assert.deepEqual(Object.keys((await f.remoteImage()).vaults), []);
  assert.equal(writes().length, 2);
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
  const image = await f.remoteImage();
  assert.ok(image.vaults['old-vault']);
  assert.ok(image.vaults['new-vault']);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], false);
});

for (const failSecond of [false, true]) test(`actual vault migration commits both local effects then sends old archive before new vault (second fails=${failSecond})`, async t => {
  const f = await vaultSetup(t);
  const sent = [];
  if (failSecond) server.armFault({ mode: '409', operation: 'updateVaultImage', after: 1 });
  else {
    for (let i = 0; i < 2; i++) server.armFault({ beforeMutation({ body }) {
      sent.push(body.vaultId);
      assert.equal(f.dbManager.getObjectById(f.RealmSchema.Vault, 'old-vault').archived, true);
      assert.ok(f.dbManager.getObjectById(f.RealmSchema.Vault, 'new-vault'));
    } });
  }
  assert.equal(await f.run('addNewVaultWorker', newVaultPayload(f, true)), true);
  assert.equal(writes().length, 2);
  assert.equal(writes()[0].committed, true);
  if (!failSecond) assert.deepEqual(sent, ['old-vault', 'new-vault']);
  assert.equal(f.dbManager.getObjectById(f.RealmSchema.Vault, 'old-vault').archived, true);
  assert.ok(f.dbManager.getObjectById(f.RealmSchema.Vault, 'new-vault'));
  const image = await f.remoteImage();
  assert.equal(image.vaults['old-vault'].archived, true);
  assert.equal(!!image.vaults['new-vault'], !failSecond);
  assert.equal(f.store.getState().bhr.pendingAllBackupByAppId[f.appId], failSecond);
});
