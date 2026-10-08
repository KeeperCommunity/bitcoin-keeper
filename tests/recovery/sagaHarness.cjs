// Runs the production saga functions with redux-saga and real AES encryption.
// Realm and the relay are disposable in-memory adapters; no user keys or network calls.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { runSaga } = require('redux-saga');
const effects = require('redux-saga/effects');

function functions(file, names) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  return source.statements
    .filter((n) => (ts.isFunctionDeclaration(n) && names.includes(n.name?.text)) ||
      (ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.includes(d.name?.text))))
    .map((n) => n.getText(source).replace(/^export /, '').replace(/^const /, 'var '))
    .join('\n');
}
function loadModule(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => (name in mocks ? mocks[name] : require(name)),
  });
  return module.exports;
}
const enums = loadModule('src/services/wallets/enums/index.ts');
const { NetworkType, WalletType, EntityKind } = enums;
const encryption = loadModule('src/utils/service-utilities/encryption.ts', {
  'react-native-rsa-native': { RSA: {} },
});
const { image } = require('./helpers.cjs');
const { prepareRecoveryImage } = loadModule('src/services/backup/restore.ts', { './image': image });
const account = loadModule('src/store/reducers/account.ts', {
  'src/services/wallets/enums': enums,
  'src/models/enums/BHR': loadModule('src/models/enums/BHR.ts'),
});
const wallet = (id, networkType, instanceNum = 0, type = WalletType.DEFAULT) => ({
  id,
  networkType,
  type,
  entityKind: EntityKind.WALLET,
  derivationDetails: { instanceNum, xDerivationPath: "m/84'/0'/0'" },
  presentationData: { name: 'Disposable fixture', visibility: 'DEFAULT' },
  specs: { receivingAddress: `${id}-address`, balances: { confirmed: 10000, unconfirmed: 0 } },
});
const signer = (fingerprint, networkType, type = enums.SignerType.COLDCARD, account = 0) => ({
  masterFingerprint: fingerprint,
  type,
  storageType: type === enums.SignerType.COLDCARD ? enums.SignerStorage.COLD : enums.SignerStorage.WARM,
  networkType,
  signerName: 'Disposable key',
  signerDescription: 'Key lifecycle regression fixture',
  signerXpubs: {
    [enums.XpubTypes.P2WPKH]: [{ xpub: `${fingerprint}-${networkType}-${account}-public`,
      derivationPath: `m/84'/${networkType === NetworkType.MAINNET ? 0 : 1}'/${account}'`,
      xpriv: null }],
  },
  addedOn: '2026-09-01T00:00:00.000Z',
  lastHealthCheck: '2026-09-01T00:00:00.000Z',
  healthCheckDetails: [{ type: 'fixture-check', actionDate: '2026-09-01T00:00:00.000Z' }],
  hidden: false,
  archived: false,
});
function fixture(options = {}) {
  const appId = require('crypto').createHash('sha256').update(Buffer.from('ab'.repeat(32), 'hex')).digest('hex');
  const state = {
    storage: { appId },
    bhr: {
      automaticCloudBackup: false,
      automaticCloudBackupByAppId: {
        [appId]: options.bhr?.automaticCloudBackup !== false,
        ...options.bhr?.automaticCloudBackupByAppId,
      },
      pendingAllBackup: false,
      pendingAllBackupByAppId: {},
      backupRepairCompletedByAppId: { [appId]: true },
      ...options.bhr,
    },
    settings: { bitcoinNetworkType: NetworkType.MAINNET, bitcoinNetwork: NetworkType.MAINNET },
    notifications: { fcmToken: 'disposable-token' },
    account: account.default(
      undefined,
      account.setTempDetails({ hash: 'fixture', realmId: 'fixture', accountIdentifier: '' })
    ),
  };
  const app = {
    id: appId,
    primarySeed: 'ab'.repeat(32),
    publicId: 'fixture',
    subscription: { level: 1 },
    networkType: NetworkType.MAINNET,
    version: '2.5.16',
  };
  const collections = {
    Wallet: [],
    USDTWallet: [],
    Signer: [],
    Vault: [],
    Tags: [],
    NodeConnect: [],
    UAI: [],
    VersionHistory: [],
    BackupHistory: [],
  };
  const remote = { appId, wallets: {}, signers: {}, nodes: [], version: '2.5.16' };
  const calls = [];
  const actions = [];
  const scope = {
    ...effects,
    markBackupMutation: () => {},
    store: { getState: () => state },
    isAutomaticCloudBackupEnabled: (backup, id) => !!backup.automaticCloudBackupByAppId?.[id],
    ...encryption,
    ...enums,
    ...account,
    prepareRecoveryImage,
    pauseBackup: image.pauseBackup,
    console: { log() {}, error() {} },
    Buffer,
    _: require('lodash'),
    // Metro normally transforms idx into guarded property access. The extracted
    // functions run in a separate VM realm, so emulate those access semantics.
    idx: (value, getter) => {
      try { return getter(value); } catch (error) {
        if (error.name === 'TypeError') return undefined;
        throw error;
      }
    },
    Realm: { UpdateMode: { Modified: 'modified' } },
    captureError: (error) => { throw error; },
    getJSONFromRealmObject: (object) => object,
    RealmSchema: new Proxy({}, { get: (_, name) => name }),
    dbManager: {
      getObjectByIndex: (schema, _index, all) =>
        schema === 'KeeperApp' ? app : all ? collections[schema] : collections[schema]?.[0],
      getCollection: (schema) => collections[schema] || [],
      getObjectByField: (schema) => collections[schema] || [],
      createObject: (schema, value) => {
        if (schema === 'KeeperApp') Object.assign(app, value);
        else {
          const rows = (collections[schema] ||= []);
          const index = rows.findIndex((row) => row.id && row.id === value.id);
          if (index < 0) rows.push(value);
          else rows[index] = value;
        }
        return true;
      },
      createObjectBulk: (schema, values) => {
        values.forEach((value) => scope.dbManager.createObject(schema, value));
        return true;
      },
      deleteObjectById: (schema, id) => {
        collections[schema] = collections[schema].filter((row) => String(row.id) !== String(id));
        return true;
      },
      deleteObjectByPrimaryKey: (schema, key, value) => {
        collections[schema] = collections[schema].filter((row) => String(row[key]) !== String(value));
        return true;
      },
      updateObjectById: (schema, id, patch) => {
        const row = collections[schema].find((record) => String(record.id) === String(id));
        if (!row) return false;
        Object.assign(row, patch);
        return true;
      },
      updateObjectByQuery: (schema, predicate, patch) => {
        collections[schema].filter(predicate).forEach((row) => Object.assign(row, patch));
      },
    },
    Relay: {
      updateAppImage: async (payload) => {
        calls.push(['incremental', payload]);
        if (options.incrementalError) throw Error('offline');
        if (options.rejectIncremental) return { updated: false, error: 'rejected' };
        Object.assign(remote.wallets, payload.walletsObject);
        Object.assign(remote.signers, payload.signersObject);
        if (payload.nodes?.length) remote.nodes = payload.nodes;
        return { updated: true, error: '' };
      },
      backupAllSignersAndVaults: async (payload) => {
        calls.push(['full', payload]);
        if (options.fullError) throw Error('offline');
        if (options.rejectFull) return { updated: false };
        remote.wallets = { ...payload.walletObject };
        return { updated: true, error: '' };
      },
      deleteAppImageEntity: async ({ walletIds }) => {
        calls.push(['delete']);
        walletIds.forEach((id) => delete remote.wallets[id]);
        return { updated: true, error: '' };
      },
      getAppImage: async () => ({ appImage: remote, labels: [], allVaultImages: [] }),
    },
    NetInfo: { fetch: async () => ({ isConnected: options.online !== false }) },
    addToUaiStackWorker: () => {},
    uaiActionedWorker: () => {},
    uaiType: { SERVER_BACKUP_FAILURE: 'backup-failed' },
    addNewWallet: (_type, details) => details.fixture,
    DeviceInfo: { getVersion: () => '2.5.16', getBuildNumber: () => '624' },
    bip39: {
      validateMnemonic: () => true,
      mnemonicToSeedSync: () => Buffer.from('ab'.repeat(32), 'hex'),
    },
    crypto: require('crypto'),
    BIP85: { bip39MnemonicToEntropy: () => Buffer.from('fixture') },
    config: { BIP85_IMAGE_ENCRYPTIONKEY_DERIVATION_PATH: 'fixture', isDevMode: () => false },
    WalletUtilities: { getFingerprintFromSeed: () => 'AAAAAAAA' },
    SubscriptionTier: { L1: 'L1', L3: 'L3' },
    SigningServer: { updatePolicy: async () => ({ updated: true }) },
    Alert: { alert: () => {} },
    AppSubscriptionLevel: { L1: 1, L3: 3 },
    BackupType: { SEED: 'SEED' },
    BackupAction: { SEED_BACKUP_CONFIRMED: 'confirmed' },
    moment: () => ({ unix: () => 1 }),
    semver: require('semver'),
    setupRecoveryKeySigningKey: () => signer('RECOVERY', NetworkType.MAINNET, enums.SignerType.SEED_WORDS),
    applyUpgradeSequence: () => {},
    refreshWalletsWorker: async () => {
      calls.push(['sync']);
      if (options.syncGate) await options.syncGate;
      if (options.switchAppDuringSync) state.storage.appId = 'another-app';
      return options.syncFails !== true;
    },
  };
  const names = [
    'setBackupRepairCompleted',
    'invalidateBackupRepair',
    'setBackupAllSuccess',
    'setBackupAllFailure',
    'setBackupAllLoading',
    'setDeleteBackupSuccess',
    'setDeleteBackupFailure',
    'setPendingAllBackup',
    'setAutomaticCloudBackup',
    'setHomeToastMessage',
    'setRelayWalletUpdateLoading',
    'relayWalletUpdateSuccess',
    'relayWalletUpdateFail',
    'setRelaySignersUpdateLoading',
    'relaySignersUpdateSuccess',
    'relaySignersUpdateFail',
    'hideDeletingKeyModal',
    'showDeletingKeyModal',
    'showKeyDeletedSuccessModal',
    'setSignerPolicyError',
    'updateDelayedPolicyUpdate',
    'setRelayVaultUpdateLoading',
    'relayVaultUpdateSuccess',
    'relayVaultUpdateFail',
    'setAppImageError',
    'setSeedConfirmed',
    'setBackupType',
    'uaiActioned',
    'setAppId',
    'setAppCreated',
    'autoSyncWallets',
    'checkBackupFreshness',
    'uaiChecks',
    'loadConciergeUser',
    'loadConciergeTickets',
    'appImagerecoveryRetry',
  ];
  names.forEach((name) => {
    scope[name] = (payload) => ({ type: name, payload });
  });
  const code =
    functions('src/constants/defaultData.tsx', ['RECOVERY_KEY_SIGNER_NAME']) + '\n' +
    functions('src/store/sagas/upgrade.ts', ['KEY_MANAGEMENT_VERSION']) + '\n' +
    functions('src/utils/utilities.ts', [
      'getAccountFromSigner', 'getKeyUID', 'checkSignerAccountsMatch',
      'sanitizeSeedKeyForBackup', 'sanitizeVaultSignersForSeedKeyBackup',
    ]) + '\n' +
    functions('src/store/sagas/bhr.ts', [
      'currentBackupAppId',
      'deleteAppImageEntityWorker',
      'deleteVaultImageWorker',
      'deleteBackupWorker',
      'checkBackupCondition',
      'setServerBackupFailed',
      'updateAppImageWorker',
      'updateVaultImageWorker',
      'recoverApp',
      'writeRecoveredObject',
      'getAppImageWorker',
    ]) +
    '\n' +
    functions('src/store/sagas/wallets.ts', [
      'currentWalletAccountId', 'assertWalletAccount',
      'addNewWalletsWorker', 'addSigningDeviceWorker', 'mergeSimilarKeysWorker',
      'deleteSigningDeviceWorker', 'deleteVaultWorker',
      'generateNewExternalAddressWorker', 'updateSignerPolicyWorker',
      'updateVaultSignerXprivWorker', 'updateSignerDetailsWorker',
      'updateKeyDetailsWorker', 'autoWalletsSyncWorker',
    ]);
  vm.runInNewContext(
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText,
    scope
  );
  const run = (name, ...args) =>
    runSaga(
      {
        getState: () => state,
        dispatch(action) {
          actions.push(action);
          if (action.type === 'setBackupRepairCompleted')
            state.bhr.backupRepairCompletedByAppId[action.payload] = true;
          if (action.type === 'setPendingAllBackup') {
            const { appId: pendingAppId, pending } = action.payload;
            state.bhr.pendingAllBackupByAppId[pendingAppId] = pending;
            state.bhr.pendingAllBackup = pending;
          }
          state.account = account.default(state.account, action);
        },
      },
      scope[name],
      ...args
    ).toPromise();
  return { scope, app, collections, remote, calls, actions, state, run };
}

module.exports = { fixture, enums, encryption, account, wallet, signer, loadModule, functions };
