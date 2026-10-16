// Clean Recovery Key restore through the actual production recovery saga, real
// BIP39/BIP32/BIP85/AES, a blank encrypted native Realm and real Relay HTTP reads.
// This historical public-Relay lane explicitly selects the older read-only copy;
// protected-default recovery has a separate exact-private-Relay proof lane.
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const bip39 = require('bip39');
const { TronWeb } = require('tronweb');
const { test, before, after } = require('node:test');
const { createRealmClient, declarations, classMembers, evaluate, plain, Realm } = require('./automaticWriteRealmRelay.fixture.cjs');
assert.ok(process.env.KEEPER_RELAY_FIXTURE_MODULE, 'The genuine paired Relay fixture is required');
const { createFixture } = require(process.env.KEEPER_RELAY_FIXTURE_MODULE);
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seed = bip39.mnemonicToSeedSync(mnemonic);
const appId = crypto.createHash('sha256').update(seed).digest('hex');
let server;
before(async () => { server = await createFixture(); });
after(async () => { await server?.close(); Realm.shutdown(); });

function cryptoAndRecovery(f) {
  const saga = f.productionSagas([
    'currentBackupAppId', 'recoverApp', 'writeRecoveredObject', 'getAppImageWorker', 'latestRecoveryReadRequest',
    'buildAutomaticAppMutation', 'buildAutomaticVaultMutation', 'queueCommittedBackupWorker', 'updateAppImageWorker',
  ], {
    ...f.load('src/store/reducers/wallets'), ...f.load('src/store/reducers/concierge'),
    ...f.load('src/store/sagaActions/wallets'), ...f.load('src/store/sagaActions/uai'),
    ...f.load('src/models/enums/SubscriptionTier'), ...f.load('src/models/enums/BHR'),
    ...f.load('src/models/interfaces/HeathCheckTypes'),
    ...f.load('src/models/enums/Hardware'), HWError: f.load('src/hardware/HWErrorState').default,
    ...f.utilities, _: require('lodash'), crypto, bip39, semver: require('semver'), moment: require('moment'),
    config: f.config, DeviceInfo: { getVersion: () => '2.6.4', getBuildNumber: () => '627' },
    ...f.load('src/services/backup/restore'),
    readProtectedBackup: f.load('src/services/backup/protected').readProtectedBackup,
    // Metro normally expands idx at build time; this host adapter performs the
    // same guarded field access, never supplies database or crypto results.
    idx(value, getter) { try { return getter(value); } catch (error) { if (error.name === 'TypeError') return undefined; throw error; } },
  });
  saga.scope.config.BIP85_IMAGE_ENCRYPTIONKEY_DERIVATION_PATH = "m/83696968'/39'/0'/12'/83696968'";
  saga.scope.bitcoinJS = require('bitcoinjs-lib');
  saga.scope.bs58check = require('bs58check');
  const ecc = f.load('src/services/wallets/operations/taproot-utils/noble_ecc').default;
  saga.scope.bip32 = require('bip32').default(ecc);
  evaluate(classMembers('src/services/wallets/operations/utils.ts', 'WalletUtilities', [
    'getNetworkByType', 'getFingerprintFromNode', 'getFingerprintFromSeed', 'getFingerprintFromExtendedKey',
    'getDerivationPath', 'getPurpose', 'generateExtendedKeyPairFromSeed', 'getXpubFromExtendedKey',
    'getScriptTypeFromDerivationPath', 'getNetworkFromPrefix', 'getSignerPurposeFromPath',
  ]), saga.scope, 'production-bitcoin-key-utilities.ts');
  saga.scope.BIP85 = f.load('src/services/wallets/operations/BIP85').default;
  evaluate(declarations('src/services/wallets/factories/VaultFactory.ts', ['generateSeedWordsKey']) + '\n' +
    declarations('src/hardware/index.ts', ['getSignerNameFromType', 'generateSignerFromMetaData']) + '\n' +
    declarations('src/hardware/signerSetup.ts', ['setupSeedWordsBasedKey', 'setupRecoveryKeySigningKey']) + '\n' +
    declarations('src/store/sagas/upgrade.ts', ['KEY_MANAGEMENT_VERSION']) + '\n' +
    declarations('src/store/sagas/wallets.ts', [
      'currentWalletAccountId', 'assertWalletAccount', 'rewriteSignerFingerprintReferences', 'planSignerIdentityMerges',
      'applySignerIdentityMerges', 'applySignerXprivUpdates', 'buildSignerMigrationMutation', 'addSigningDeviceWorker',
    ]), saga.scope, 'production-recovery-key-and-persistence.ts');
  return saga;
}

async function sourceFixture(t) {
  await server.reset();
  const f = await createRealmClient(server.url, { appId, primarySeed: seed.toString('hex'), primaryMnemonic: mnemonic });
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  const source = cryptoAndRecovery(f);
  const fingerprint = source.scope.WalletUtilities.getFingerprintFromSeed(seed);
  assert.equal(f.dbManager.updateObjectById(f.RealmSchema.KeeperApp, f.appId, { publicId: fingerprint }), true);
  const recoveryKey = source.scope.setupRecoveryKeySigningKey(mnemonic);
  assert.equal(f.dbManager.createObject(f.RealmSchema.Signer, recoveryKey), true);
  const network = source.scope.WalletUtilities.getNetworkByType(f.enums.NetworkType.TESTNET);
  const xpub = source.scope.WalletUtilities.generateExtendedKeyPairFromSeed(seed.toString('hex'), network, "m/84'/1'/0'").xpub;
  const wallet = f.defaults(f.RealmSchema.Wallet, {
    id: 'native-recovery-wallet', entityKind: f.enums.EntityKind.WALLET, type: f.enums.WalletType.DEFAULT,
    networkType: f.enums.NetworkType.TESTNET, scriptType: 'P2WPKH',
    derivationDetails: f.defaults(f.RealmSchema.WalletDerivationDetails, { instanceNum: 0, xDerivationPath: "m/84'/1'/0'" }),
    presentationData: f.defaults(f.RealmSchema.WalletPresentationData, { name: 'Disposable recovery wallet', visibility: 'DEFAULT' }),
    specs: f.defaults(f.RealmSchema.WalletSpecs, { xpub, nextFreeAddressIndex: 9, nextFreeChangeAddressIndex: 4, totalExternalAddresses: 12,
      confirmedUTXOs: [f.defaults(f.RealmSchema.UTXO, { txId: '11'.repeat(32), vout: 0, value: 1000, spendability: 'doNotSpend', isManualOverride: true })] }),
  });
  assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, wallet), true);
  const mainnet = source.scope.WalletUtilities.getNetworkByType(f.enums.NetworkType.MAINNET);
  const mainnetXpub = source.scope.WalletUtilities.generateExtendedKeyPairFromSeed(seed.toString('hex'), mainnet, "m/84'/0'/1'").xpub;
  assert.equal(f.dbManager.createObject(f.RealmSchema.Wallet, f.defaults(f.RealmSchema.Wallet, {
    ...wallet, id: 'mainnet-recovery-wallet', type: f.enums.WalletType.IMPORTED,
    networkType: f.enums.NetworkType.MAINNET,
    derivationDetails: f.defaults(f.RealmSchema.WalletDerivationDetails, { instanceNum: 1, xDerivationPath: "m/84'/0'/1'" }),
    presentationData: f.defaults(f.RealmSchema.WalletPresentationData, { name: 'Retained mainnet wallet', visibility: 'HIDDEN' }),
    specs: f.defaults(f.RealmSchema.WalletSpecs, { xpub: mainnetXpub, nextFreeAddressIndex: 13, nextFreeChangeAddressIndex: 6, totalExternalAddresses: 15 }),
  })), true);
  // Existing USDT records only: disposable, public keys and real address
  // validation. No wallet creation, provider call, token transfer or opt-in.
  for (const [type, privateKey, gasFreeKey] of [
    ['DEFAULT', '11'.repeat(32), '33'.repeat(32)],
    ['IMPORTED', '22'.repeat(32), '44'.repeat(32)],
  ]) {
    const address = TronWeb.address.fromPrivateKey(privateKey);
    const gasFreeAddress = TronWeb.address.fromPrivateKey(gasFreeKey);
    assert.ok(TronWeb.isAddress(address) && TronWeb.isAddress(gasFreeAddress));
    assert.equal(f.dbManager.createObject(f.RealmSchema.USDTWallet, f.defaults(f.RealmSchema.USDTWallet, {
      id: `retained-usdt-${type}`, type, entityKind: f.enums.EntityKind.USDT_WALLET,
      networkType: f.enums.NetworkType.MAINNET,
      derivationDetails: f.defaults(f.RealmSchema.USDTWalletDerivationDetails, {
        instanceNum: type === 'DEFAULT' ? 0 : null, mnemonic: type === 'DEFAULT' ? mnemonic : null,
        xDerivationPath: "m/44'/195'/0'/0/0",
      }),
      presentationData: f.defaults(f.RealmSchema.USDTWalletPresentationData, {
        name: `Existing ${type} USDT wallet`, description: 'Retained token-wallet metadata', visibility: 'HIDDEN',
      }),
      specs: f.defaults(f.RealmSchema.USDTWalletSpecs, {
        address, privateKey, balance: 23, lastSynched: 1710000000, hasNewUpdates: false,
        transactions: [f.defaults(f.RealmSchema.USDTTransaction, {
          txId: 'public-disposable-cached-token-transaction', from: address, to: gasFreeAddress,
          amount: '5', fee: '1', status: 'CONFIRMED', timestamp: 1700000000, isGasFree: true,
        })],
      }),
      accountStatus: f.defaults(f.RealmSchema.USDTWalletAccountStatus, {
        address, gasFreeAddress, isActive: true, frozen: 0, canTransfer: false, nextNonce: 4,
        fees: { transferFee: 1, activateFee: 2 },
      }),
    })), true);
  }
  const vaultKey = source.scope.generateSeedWordsKey('legal winner thank year wave sausage worth useful legal winner thank yellow', f.enums.NetworkType.TESTNET, true);
  const cold = f.defaults(f.RealmSchema.Signer, { masterFingerprint: vaultKey.masterFingerprint, type: f.enums.SignerType.COLDCARD,
    storageType: f.enums.SignerStorage.COLD, networkType: f.enums.NetworkType.TESTNET, signerXpubs: f.defaults(f.RealmSchema.SignerXpubs, {
      [f.enums.XpubTypes.P2WSH]: [{ xpub: vaultKey.xpub, xpriv: null, derivationPath: vaultKey.derivationPath }],
    }) });
  cold.id = f.utilities.getKeyUID(cold);
  assert.equal(f.dbManager.createObject(f.RealmSchema.Signer, cold), true);
  const vaultSigner = f.defaults(f.RealmSchema.VaultSigner, { ...vaultKey, xpriv: null, xfp: vaultKey.masterFingerprint,
    registeredVaults: [
      { vaultId: 'archived-recovery-vault', registered: true, hmac: 'public-disposable-archived-registration' },
      { vaultId: 'active-recovery-vault', registered: true, hmac: 'public-disposable-active-registration' },
    ] });
  const vault = f.defaults(f.RealmSchema.Vault, { id: 'archived-recovery-vault', entityKind: f.enums.EntityKind.VAULT, type: f.enums.VaultType.DEFAULT,
    networkType: f.enums.NetworkType.TESTNET, isMultiSig: true, scriptType: 'P2WSH', archived: true,
    scheme: f.defaults(f.RealmSchema.VaultScheme, { m: 1, n: 1 }), signers: [vaultSigner],
    presentationData: f.defaults(f.RealmSchema.VaultPresentationData, { name: 'Retained archived vault', visibility: 'HIDDEN' }),
    specs: f.defaults(f.RealmSchema.VaultSpecs, { xpubs: [vaultKey.xpub], nextFreeAddressIndex: 7 }) });
  assert.equal(f.dbManager.createObject(f.RealmSchema.Vault, vault), true);
  assert.equal(f.dbManager.createObject(f.RealmSchema.Vault, {
    ...vault, id: 'active-recovery-vault', archived: false,
    presentationData: f.defaults(f.RealmSchema.VaultPresentationData, { name: 'Retained active vault', visibility: 'DEFAULT' }),
    specs: f.defaults(f.RealmSchema.VaultSpecs, { xpubs: [vaultKey.xpub], nextFreeAddressIndex: 10, nextFreeChangeAddressIndex: 3 }),
  }), true);
  assert.equal(f.dbManager.createObject(f.RealmSchema.Tags, f.defaults(f.RealmSchema.Tags, { id: 'recovered-label', type: 'TXN', ref: 'public-disposable-transaction', label: 'Recovery label' })), true);
  assert.equal(f.dbManager.createObject(f.RealmSchema.NodeConnect, f.defaults(f.RealmSchema.NodeConnect, {
    id: 42, host: 'public-recovery-node.invalid', port: '50002', useSSL: true, networkType: f.enums.NetworkType.TESTNET,
  })), true);
  assert.equal(f.dbManager.createObject(f.RealmSchema.NodeConnect, f.defaults(f.RealmSchema.NodeConnect, {
    id: 43, host: 'public-mainnet-recovery-node.invalid', port: '50002', useSSL: true, networkType: f.enums.NetworkType.MAINNET,
  })), true);
  await server.seed(await f.payloadForCurrentImage());
  await server.prepareRestore(f.appId);
  return { source: f, expected: await f.repair.captureBackupImage(), recoveryKey, fingerprint };
}

test('actual Recovery Key worker restores real crypto and every retained recovery collection into blank native Realm', async (t) => {
  const origin = await sourceFixture(t);
  const f = await createRealmClient(server.url, { appId, primarySeed: seed.toString('hex'), primaryMnemonic: mnemonic, publicId: origin.fingerprint });
  t.after(() => f.close());
  f.automatic = f.load('src/services/backup/automatic');
  f.installProductionStoreObservers(f.automatic);
  const saga = cryptoAndRecovery(f);
  f.realmDatabase.closeDatabase();
  assert.equal((await f.dbManager.initializeRealm(Buffer.alloc(64, 7), path.join(f.directory, 'clean-restore.realm'))).success, true);
  assert.equal(f.nativeRealm().objects('KeeperApp').length, 0);
  assert.equal(f.nativeRealm().objects('Wallet').length, 0);
  f.store.dispatch(f.storage.setAppId(''));
  f.store.dispatch(f.account.setTempDetails({ hash: f.encryption.hash256('public-disposable-passcode-fixture'),
    realmId: path.join(f.directory, 'clean-restore.realm'), accountIdentifier: 'disposable restore' }));
  server.clearTrace();
  await saga.run('getAppImageWorker', { payload: { primaryMnemonic: mnemonic,
    selection: { source: 'legacy-older', olderCopyConfirmed: true } } });
  assert.equal(f.store.getState().storage.appCreated, true, `Production recovery failed: ${f.store.getState().bhr.appImageError || 'no diagnostic'}`);
  assert.equal(f.store.getState().storage.appId, appId);
  assert.equal(f.store.getState().bhr.appImageError, '');
  assert.equal(server.trace.filter((entry) => entry.path === '/getAppImage').length, 1);
  assert.equal(server.trace.filter((entry) => entry.path === '/revisionedBackupMutation').length, 0, 'Recovery does not opt in or upload');
  const restored = await f.repair.captureBackupImage();
  assert.equal(await f.image.compareImages(origin.expected, restored), 'matched', 'The entire retained recovery image must match after the actual worker finishes');
  assert.deepEqual(Object.keys(restored.wallets).sort(), Object.keys(origin.expected.wallets).sort());
  for (const id of ['native-recovery-wallet', 'mainnet-recovery-wallet']) {
    assert.equal(f.image.canonical(f.image.recoveryContent('wallets', restored.wallets[id])),
      f.image.canonical(f.image.recoveryContent('wallets', origin.expected.wallets[id])));
  }
  assert.deepEqual(new Set(['native-recovery-wallet', 'mainnet-recovery-wallet'].map(id => restored.wallets[id].networkType)),
    new Set([f.enums.NetworkType.MAINNET, f.enums.NetworkType.TESTNET]));
  for (const type of ['DEFAULT', 'IMPORTED']) {
    const recovered = restored.wallets[`retained-usdt-${type}`];
    assert.deepEqual(plain(recovered), plain(origin.expected.wallets[recovered.id]), 'Every existing USDT key, address, cached history and metadata field survives actual restore');
    assert.ok(TronWeb.isAddress(recovered.accountStatus.address) && TronWeb.isAddress(recovered.accountStatus.gasFreeAddress));
    assert.equal(recovered.presentationData.visibility, 'HIDDEN');
  }
  assert.deepEqual(plain(restored.vaults), plain(origin.expected.vaults));
  assert.equal(restored.vaults['active-recovery-vault'].archived, false);
  assert.equal(restored.vaults['archived-recovery-vault'].archived, true);
  assert.deepEqual(plain(restored.labels), plain(origin.expected.labels));
  assert.equal(restored.nodes['42'].host, 'public-recovery-node.invalid');
  assert.equal(restored.nodes['43'].host, 'public-mainnet-recovery-node.invalid');
  assert.deepEqual(Object.fromEntries(Object.entries(restored.nodes).map(([id, node]) => [id, plain(f.image.recoveryContent('nodes', node))])),
    Object.fromEntries(Object.entries(origin.expected.nodes).map(([id, node]) => [id, plain(f.image.recoveryContent('nodes', node))])));
  assert.deepEqual(plain(restored.signers), plain(origin.expected.signers), 'Every retained signer field, not only the Recovery Key xpubs, survives');
  const recoveryId = f.utilities.getKeyUID(origin.recoveryKey);
  assert.deepEqual(plain(restored.signers[recoveryId].signerXpubs), plain(origin.expected.signers[recoveryId].signerXpubs));
  assert.ok(Object.values(restored.signers[recoveryId].signerXpubs).some((keys) => keys.length));
  assert.notEqual(f.store.getState().bhr.automaticCloudBackupByAppId[appId], true);
  assert.equal(f.dbManager.getObjectByIndex(f.RealmSchema.KeeperApp).primarySeed, seed.toString('hex'));
});
