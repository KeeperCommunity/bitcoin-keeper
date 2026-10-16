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
const { prepareRecoveryImage, prepareRecoverySourceImage, hasRecoveryRecords } =
  loadModule('src/services/backup/restore.ts', { './image': image });
const { selectWalletsForSync } = loadModule('src/store/sagas/walletSyncSelection.js');
const { acquireWalletRefresh } = loadModule('src/store/sagas/walletRefreshCoordinator.js');
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
    VaultSigner: [],
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
    translations: require('../../src/context/Localization/language/en.json'),
    ...enums,
    ...account,
    selectWalletsForSync,
    acquireWalletRefresh,
    finishRefreshRequest: (payload) => ({ type: 'finishRefreshRequest', payload }),
    prepareRecoveryImage,
    prepareRecoverySourceImage,
    hasRecoveryRecords,
    // Protected discovery must be supplied explicitly by tests of that source.
    // Existing read-only legacy fixtures do not confer authenticated ownership.
    readProtectedBackup: async () => { throw new Error('Protected fixture not configured'); },
    pauseBackup: image.pauseBackup,
    validateProtectedRecoveryMetadata: image.validateProtectedRecoveryMetadata,
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
    getJSONFromRealmObject: (object) => object?.toJSON ? object.toJSON() : JSON.parse(JSON.stringify(object)),
    RealmSchema: new Proxy({}, { get: (_, name) => name }),
    dbManager: {
      getObjectByIndex: (schema, _index, all) =>
        schema === 'KeeperApp' ? app : all ? collections[schema] : collections[schema]?.[0],
      getObjectById: (schema, id) => collections[schema]?.find((row) => row.id === id),
      getObjectByPrimaryId: (schema, key, value) =>
        collections[schema]?.find((row) => String(row[key]) === String(value)),
      getCollection: (schema) => JSON.parse(JSON.stringify(collections[schema] || [])),
      getObjectByField: (schema) => collections[schema] || [],
      createObject: (schema, value) => {
        if (schema === 'KeeperApp') Object.assign(app, value);
        else {
          const rows = (collections[schema] ||= []);
          const primary = schema === 'VaultSigner' ? 'xpub' : 'id';
          const index = rows.findIndex((row) => row[primary] && row[primary] === value[primary]);
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
        const row = schema === 'KeeperApp' ? scope.dbManager.getObjectByIndex(schema)
          : collections[schema]?.find((record) => String(record.id) === String(id));
        if (!row) return false;
        Object.assign(row, patch);
        return true;
      },
      updateObjectByQuery: (schema, predicate, patch) => {
        const row = collections[schema]?.find(predicate);
        if (!row) return false;
        Object.assign(row, patch);
        return true;
      },
      updateObjectByPrimaryId: (schema, key, value, patch) => {
        const row = collections[schema]?.find((record) => String(record[key]) === String(value));
        if (!row) return false;
        Object.assign(row, patch);
        return true;
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

  // Producer-boundary UNIT adapter only. It exercises source saga ordering,
  // committed-record builders and real AES with mutable in-memory DB/Relay
  // controls. It is not the branded generation/CAS/readback implementation or
  // native/HTTP proof; automaticWriteRealmRelay.integration owns that evidence.
  let selectedAppId = state.storage.appId;
  let accountSession = 0;
  Object.defineProperty(state.storage, 'appId', {
    enumerable: true,
    get: () => selectedAppId,
    set: (value) => {
      if (value !== selectedAppId) accountSession += 1;
      selectedAppId = value;
    },
  });
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const receipts = new WeakMap();
  const results = new WeakMap();
  const consentEpochs = new Map();
  const consentCompletions = new WeakMap();
  const recoveryDisables = new WeakMap();
  scope.backupConsentEpoch = (id) => consentEpochs.get(id) || 0;
  // Unit model of the middleware's opaque OFF-only recovery action, not remote
  // authentication. Consent epochs and canonical per-account choices stay real
  // state transitions in this orchestration fixture.
  scope.protectBackupRecoveryConsentDisable = (action, appId, session) => {
    recoveryDisables.set(action, { appId, session });
    return action;
  };
  scope.protectBackupConsentCompletion = (action, id, epoch) => {
    consentCompletions.set(action, { appId: id, epoch });
    return action;
  };
  const rawReferences = new WeakMap();
  const fingerprint = () => JSON.stringify({
    app: scope.dbManager.getObjectByIndex('KeeperApp'), collections,
  });
  const primary = (schema) => schema === 'VaultSigner' ? 'xpub' : 'id';
  const managed = (schema, row) => {
    if (!row) return undefined;
    const proxy = new Proxy(row, {
      get: (target, key) => key === 'toJSON' ? () => clone(target) : target[key],
      set: (target, key, value) => {
        const saved = schema === 'VaultSigner'
          ? scope.dbManager.updateObjectByPrimaryId(schema, 'xpub', target.xpub, { [key]: value })
          : scope.dbManager.updateObjectById(schema, target.id, { [key]: value });
        if (saved !== true) throw new Error('Unit local write failed');
        return true;
      },
    });
    rawReferences.set(proxy, { schema, row });
    return proxy;
  };
  const localRealm = {
    objects: (schema) => (schema === 'KeeperApp' ? [scope.dbManager.getObjectByIndex(schema)] : collections[schema] || [])
      .filter(Boolean).map((row) => managed(schema, row)),
    objectForPrimaryKey: (schema, value) => managed(schema,
      schema === 'KeeperApp' ? scope.dbManager.getObjectByIndex(schema)
        : (collections[schema] || []).find((row) => String(row[primary(schema)]) === String(value))),
    create: (schema, value, mode) => {
      if (scope.dbManager.createObject(schema, value, mode) !== true) throw new Error('Unit local creation failed');
      return localRealm.objectForPrimaryKey(schema, value[primary(schema)]);
    },
    delete: (object) => {
      const record = rawReferences.get(object);
      if (!record) throw new Error('Unit deletion target missing');
      const key = primary(record.schema);
      const deleted = record.schema === 'Signer' || record.schema === 'VaultSigner'
        ? scope.dbManager.deleteObjectByPrimaryKey(record.schema, key, record.row[key])
        : scope.dbManager.deleteObjectById(record.schema, record.row[key]);
      if (deleted !== true || (collections[record.schema] || []).includes(record.row))
        throw new Error('Unit deletion was not persisted');
    },
  };
  scope.realm = { getDatabase: () => localRealm };
  scope.currentBackupAccountSession = () => accountSession;
  const sessionNow = () => scope.currentBackupAccountSession();
  const markUnitPending = (id, markRevision = true) => {
    // Production automatic.ts notifies reconciliation after a failed local
    // commit. This adapter models that state boundary without claiming proof.
    if (markRevision) scope.markBackupMutation(id);
    if (scope.invalidateBackupRepair && scope.store.dispatch)
      scope.store.dispatch(scope.invalidateBackupRepair(id));
    if (scope.setPendingAllBackup && scope.store.dispatch)
      scope.store.dispatch(scope.setPendingAllBackup({ appId: id, pending: true }));
  };
  scope.clearVerifiedRemoteRevision = (id) => { state.bhr.backupRepairCompletedByAppId[id] = false; };
  scope.notifyBackupReconciliation = (id) => markUnitPending(id, false);
  scope.beginBackupLocalOperation = (id, intent, session = sessionNow()) => {
    const current = scope.dbManager.getObjectByIndex('KeeperApp');
    if (current?.id !== id || state.storage.appId !== id || session !== sessionNow())
      throw new Error('Unit account session changed');
    return { appId: id, accountSession: session, database: scope.realm.getDatabase(),
      before: fingerprint(), origin: intent, consentEpoch: scope.backupConsentEpoch(id) };
  };
  scope.commitBackupLocalOperation = (operation, callback) => {
    const active = scope.dbManager.getObjectByIndex('KeeperApp');
    if (active?.id !== operation.appId || state.storage.appId !== operation.appId ||
      operation.accountSession !== sessionNow() || operation.database !== scope.realm.getDatabase() ||
      operation.consentEpoch !== scope.backupConsentEpoch(operation.appId))
      return { committed: false };
    const before = new Map(Object.entries(collections).map(([schema, rows]) =>
      [schema, rows.map((row) => ({ row, value: clone(row) }))]));
    const appBefore = clone(active);
    try {
      const value = callback(localRealm);
      if (value?.then) throw new Error('Unit local commit must be synchronous');
      const receipt = { committed: true,
        intent: operation.origin && operation.origin.appId === operation.appId &&
          operation.origin.accountSession === sessionNow() &&
          (operation.origin.consentEpoch === undefined ||
            operation.origin.consentEpoch === scope.backupConsentEpoch(operation.appId))
          ? operation.origin : undefined };
      receipts.set(receipt, { appId: operation.appId, session: sessionNow(),
        fingerprint: fingerprint(), consentEpoch: operation.consentEpoch, deletion: false });
      markUnitPending(operation.appId);
      return receipt;
    } catch {
      for (const key of Object.keys(active)) delete active[key];
      Object.assign(active, appBefore);
      for (const [schema, saved] of before) {
        for (const { row, value } of saved) {
          for (const key of Object.keys(row)) delete row[key];
          Object.assign(row, value);
        }
        collections[schema] = saved.map(({ row }) => row);
      }
      markUnitPending(operation.appId);
      return { committed: false };
    }
  };
  scope.beginBackupDeleteOperation = async (id, session = sessionNow()) => {
    const operation = scope.beginBackupLocalOperation(id, undefined, session);
    const receipt = { committed: true, intent: { appId: id, accountSession: session } };
    receipts.set(receipt, { appId: id, session, fingerprint: operation.before,
      consentEpoch: operation.consentEpoch, deletion: true });
    return receipt;
  };
  scope.isAutomaticBackupResultCurrent = (result, id) => {
    const evidence = results.get(result);
    return !!evidence && evidence.appId === id && id === state.storage.appId &&
      evidence.session === sessionNow() && evidence.consentEpoch === scope.backupConsentEpoch(id) &&
      evidence.fingerprint === fingerprint();
  };
  scope.isBackupVerificationCurrent = (id) => id === state.storage.appId && !!state.bhr.backupRepairCompletedByAppId[id];
  scope.enqueueAutomaticBackupOperation = async (receipt, mutations) => {
    const evidence = receipt && receipts.get(receipt);
    const appId = evidence?.appId || receipt?.intent?.appId || mutations[0]?.body?.appId;
    if (appId) markUnitPending(appId);
    const finish = (updated, confirmed = false) => {
      const result = { updated, localCommitted: receipt?.committed === true,
        backupConfirmed: confirmed, backupPending: !confirmed };
      if (evidence) results.set(result, evidence);
      return result;
    };
    if (!evidence || !receipt.intent || evidence.appId !== state.storage.appId ||
      evidence.session !== sessionNow() || evidence.consentEpoch !== scope.backupConsentEpoch(evidence.appId) ||
      evidence.fingerprint !== fingerprint()) return finish(false);
    if (options.online === false) return finish(false);
    try {
      for (const mutation of mutations) {
        const { body, operation } = mutation;
        let reply;
        if (operation === 'updateAppImage') reply = await scope.Relay.updateAppImage(body);
        else if (operation === 'updateVaultImage') reply = await scope.Relay.updateVaultImage(body);
        else if (operation === 'deleteAppImageEntity') reply = await scope.Relay.deleteAppImageEntity(body);
        else if (operation === 'deleteVaults') reply = await scope.Relay.deleteVaults(body);
        else if (operation === 'modifyLabels') reply = await scope.Relay.modifyLabels(body.appId, body.addLabels, body.deleteLabels);
        else if (operation === 'migrateXfps') reply = await scope.Relay.migrateXfp(body.appId, body.signerChanges);
        else if (operation === 'deleteBackup') reply = await scope.Relay.deleteBackup(body);
        else throw new Error('Unsupported unit mutation');
        if (reply !== true && reply?.updated !== true) return finish(false);
        if (evidence.appId !== state.storage.appId || evidence.session !== sessionNow() ||
          evidence.consentEpoch !== scope.backupConsentEpoch(evidence.appId) ||
          evidence.fingerprint !== fingerprint()) return finish(false);
      }
      // The disposable Relay adapter provides only acknowledgements. A native
      // readback proof is not invented here. Explicit unit opt-out tests may
      // mock that separate confirmation contract via this named option.
      const confirmed = evidence.deletion && options.confirmBackupDeletion === true;
      if (confirmed) {
        // Explicitly mocked confirmation models the coordinator's protected
        // completion. It preserves the choice epoch and emits opt-out once.
        scope.store.dispatch(scope.protectBackupConsentCompletion(
          scope.setAutomaticCloudBackup({ appId: evidence.appId, enabled: false }),
          evidence.appId, evidence.consentEpoch));
      }
      return finish(true, confirmed);
    } catch { return finish(false); }
  };
  scope.Relay.updateVaultImage = async (body) => {
    calls.push(['vault', body]);
    if (options.incrementalError) throw new Error('offline');
    return { updated: true };
  };
  scope.Relay.deleteVaults = async (body) => { calls.push(['delete-vault', body]); return { updated: true }; };
  scope.Relay.migrateXfp = async (id, changes) => {
    calls.push(['migrate', changes]);
    for (const change of changes) {
      delete remote.signers[change.oldSignerId];
      remote.signers[change.newSignerId] = change.newSignerDetails;
    }
    return true;
  };
  scope.Relay.deleteBackup = async () => { calls.push(['delete-backup']); return { updated: true }; };
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
    'setRecoveryDiscovery',
    'setProtectedBackupState',
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
      'buildAutomaticAppMutation', 'buildAutomaticVaultMutation', 'queueCommittedBackupWorker',
      'flagUncertainBackupOutcome',
      'deleteAppImageEntityWorker',
      'deleteAppImageEntityRequestWorker',
      'deleteVaultImageWorker',
      'deleteBackupWorker',
      'backupAllSignersAndVaultsWorker',
      'checkBackupCondition',
      'setServerBackupFailed',
      'updateAppImageWorker',
      'updateVaultImageWorker',
      'recoverApp',
      'writeRecoveredObject',
      'getAppImageWorker',
      'latestRecoveryReadRequest',
    ]) +
    '\n' +
    functions('src/store/sagas/wallets.ts', [
      'currentWalletAccountId', 'assertWalletAccount',
      'rewriteSignerFingerprintReferences', 'planSignerIdentityMerges', 'applySignerIdentityMerges',
      'applySignerXprivUpdates', 'buildSignerMigrationMutation',
      'addNewWalletsWorker', 'addSigningDeviceWorker', 'mergeSimilarKeysWorker',
      'deleteSigningDeviceWorker', 'deleteVaultWorker',
      'deleteVaultRequestWorker',
      'generateNewExternalAddressWorker', 'updateSignerPolicyWorker',
      'updateVaultSignerXprivWorker', 'updateSignerDetailsWorker',
      'updateKeyDetailsWorker', 'autoWalletsSyncWorker',
    ]);
  vm.runInNewContext(
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText,
    scope
  );
  const dispatch = (action) => {
    const recoveryDisable = recoveryDisables.get(action);
    if (recoveryDisable) {
      recoveryDisables.delete(action);
      if (recoveryDisable.appId !== action.payload?.appId || recoveryDisable.session !== sessionNow() ||
        action.type !== 'setAutomaticCloudBackup' || action.payload.enabled !== false) return;
    }
    if (action.type === 'setAutomaticCloudBackup') {
      const id = action.payload.appId;
      const completion = consentCompletions.get(action);
      if (completion) {
        consentCompletions.delete(action);
        if (completion.appId !== id || completion.epoch !== scope.backupConsentEpoch(id)) return;
      } else consentEpochs.set(id, scope.backupConsentEpoch(id) + 1);
    }
    actions.push(action);
    if (action.type === 'setAppId') state.storage.appId = action.payload;
    if (action.type === 'setAppCreated') state.storage.appCreated = action.payload;
    if (action.type === 'setRecoveryDiscovery') state.bhr.recoveryDiscovery = action.payload;
    if (action.type === 'setProtectedBackupState')
      (state.bhr.protectedBackupStateByAppId ||= {})[action.payload.appId] = action.payload.state;
    if (action.type === 'setBackupRepairCompleted')
      state.bhr.backupRepairCompletedByAppId[action.payload] = true;
    if (action.type === 'invalidateBackupRepair')
      state.bhr.backupRepairCompletedByAppId[action.payload] = false;
    if (action.type === 'setPendingAllBackup') {
      const { appId: pendingAppId, pending } = action.payload;
      state.bhr.pendingAllBackupByAppId[pendingAppId] = pending;
      state.bhr.pendingAllBackup = pending;
    }
    if (action.type === 'setAutomaticCloudBackup')
      state.bhr.automaticCloudBackupByAppId[action.payload.appId] = action.payload.enabled;
    state.account = account.default(state.account, action);
  };
  scope.store.dispatch = dispatch;
  const mutationActions = new Set([
    'addNewWalletsWorker', 'addSigningDeviceWorker', 'mergeSimilarKeysWorker', 'deleteSigningDeviceWorker',
    'deleteAppImageEntityWorker', 'deleteAppImageEntityRequestWorker',
    'deleteVaultWorker', 'deleteVaultRequestWorker', 'updateSignerPolicyWorker',
    'updateVaultSignerXprivWorker', 'updateSignerDetailsWorker', 'updateKeyDetailsWorker',
  ]);
  const run = (name, ...args) => {
    if (mutationActions.has(name) && args[0] && typeof args[0] === 'object') {
      const action = args[0];
      args[0] = { originAppId: state.storage.appId, originBackupAccountSession: sessionNow(), ...action,
        // A top-level source mutation receives the unit middleware intent.
        // Direct BHR payloads never receive a fabricated committed receipt.
        ...(Object.hasOwn(action, 'originBackupWriteIntent') ? {} : {
          originBackupWriteIntent: state.bhr.backupRepairCompletedByAppId[state.storage.appId]
            ? { appId: state.storage.appId, accountSession: sessionNow(),
              consentEpoch: scope.backupConsentEpoch(state.storage.appId) }
            : undefined,
        }),
      };
    }
    return runSaga(
      {
        getState: () => state,
        dispatch,
      },
      scope[name],
      ...args
    ).toPromise();
  };
  const mockVerifiedBackupBaseline = () => {
    // Unit-only stand-in for a successful fresh read-only inspection. Never
    // called automatically after an ACK; native CAS/readback proof is separate.
    state.bhr.backupRepairCompletedByAppId[state.storage.appId] = true;
    state.bhr.backupRepairStateByAppId ||= {};
    state.bhr.backupRepairStateByAppId[state.storage.appId] = 'verified';
    state.bhr.pendingAllBackupByAppId[state.storage.appId] = false;
    state.bhr.pendingAllBackup = false;
  };
  return { scope, app, collections, remote, calls, actions, state, run, mockVerifiedBackupBaseline };
}

module.exports = { fixture, enums, encryption, account, wallet, signer, loadModule, functions };
