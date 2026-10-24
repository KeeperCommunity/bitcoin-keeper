// CI-only production-worker/native-storage witness. All transport, generation,
// dispatch and database selection adapters below are explicit test boundaries.
// This is not product UI, cryptography, backend or account-login acceptance.
const PHASE = 'keeper-r5-worker-native-phase-v1';
const SCENARIOS = Object.freeze([
  'production-setup-offline-retry-native-counts',
  'production-deletion-retained-native-references',
  'production-deletion-native-rollback',
  'production-worker-stale-session-rejection',
  'native-worker-process-relaunch-counts',
]);
const LIMITS = Object.freeze([
  'controlled-transport-no-backend-acceptance',
  'synthetic-wallet-generation-no-crypto-acceptance',
  'injected-dispatch-selection-no-login-acceptance',
  'no-product-ui-navigation-pin-or-biometric-acceptance',
  'probe-and-worker-timings-not-product-startup-ux',
]);
class FeatureFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
function check(value, code) {
  if (!value) throw new FeatureFailure(code);
}

// Build invalid public sentinel records from the *actual current* Realm schema.
// Required links are instantiated, arrays stay empty, optional fields omitted.
// No key-generation path or valid seed is used by this probe.
function recordBuilder(schema) {
  const schemas = new Map(schema.map((item) => [item.name, item]));
  function value(type, depth) {
    if (depth > 15) throw new FeatureFailure('schema-depth');
    if (typeof type === 'object') {
      if (Object.hasOwn(type, 'default')) return type.default;
      if (type.optional) return undefined;
      if (type.type === 'list' || type.type === 'set') return [];
      if (type.type === 'dictionary') return {};
      return value(type.objectType || type.type, depth + 1);
    }
    if (type.endsWith('?')) return undefined;
    if (type.endsWith('[]')) return [];
    if (schemas.has(type)) return record(type, {}, depth + 1);
    if (type === 'string') return '';
    if (['int', 'float', 'double'].includes(type)) return 0;
    if (type === 'bool') return false;
    if (type === 'date') return new Date(0);
    if (type === 'data') return new ArrayBuffer(0);
    if (type === 'mixed') return null;
    throw new FeatureFailure('unsupported-schema-property');
  }
  function record(name, overrides = {}, depth = 0) {
    const item = schemas.get(name);
    if (!item) throw new FeatureFailure('schema-missing');
    const result = {};
    for (const [key, type] of Object.entries(item.properties)) {
      const field = value(type, depth + 1);
      if (field !== undefined) result[key] = field;
    }
    return Object.assign(result, overrides);
  }
  return record;
}

async function runFeatures({
  Realm,
  schema,
  storage,
  createWorkers,
  effects,
  runSaga,
  enums,
  RealmSchema,
  subscription,
  DeviceInfo,
  now,
  startedAt,
}) {
  const make = recordBuilder(schema);
  const directory = Realm.defaultPath.slice(0, Realm.defaultPath.lastIndexOf('/') + 1);
  check(directory, 'native-directory-missing');
  const config = (iteration, suffix) => ({
    path: `${directory}keeper-r5-worker-${iteration}-${suffix}.realm`,
    schema,
    schemaVersion: 1,
    encryptionKey: new Uint8Array(64).fill(suffix === 'a' ? 17 : 18),
  });
  let saved;
  try {
    saved = JSON.parse(storage.getString(PHASE) || '{"iteration":0,"measurements":[]}');
  } catch {
    throw new FeatureFailure('invalid-phase');
  }
  check(
    Number.isInteger(saved.iteration) &&
      saved.iteration >= 0 &&
      saved.iteration <= 5 &&
      Array.isArray(saved.measurements) &&
      saved.measurements.length === saved.iteration,
    'invalid-phase'
  );
  // Every process verifies the previous process's committed wallet/key counts.
  for (let index = 1; index <= saved.iteration; index += 1) {
    for (const suffix of ['a', 'b']) {
      const prior = await Realm.open(config(index, suffix));
      try {
        check(prior.objects('Wallet').length === (suffix === 'a' ? 1 : 0), 'relaunch-wallet-count');
        check(prior.objects('Signer').length === (suffix === 'a' ? 2 : 0), 'relaunch-signer-count');
        check(prior.objects('Vault').length === 0, 'relaunch-vault-count');
      } finally {
        prior.close();
      }
    }
  }
  if (saved.iteration === 5) {
    for (let index = 1; index <= 5; index += 1) {
      Realm.deleteFile(config(index, 'a'));
      Realm.deleteFile(config(index, 'b'));
    }
    storage.deleteItem(PHASE);
    return {
      stage: 'pass',
      measurements: saved.measurements,
      scenarios: SCENARIOS.map((id) => ({ id, status: 'PASS' })),
    };
  }
  const iteration = saved.iteration + 1;
  let a;
  let b;
  try {
    a = await Realm.open(config(iteration, 'a'));
    b = await Realm.open(config(iteration, 'b'));
    check(
      a.objects('KeeperApp').length === 0 && b.objects('KeeperApp').length === 0,
      'fixture-not-fresh'
    );
    const appA = 'keeper-ci-r5-account-a';
    const appB = 'keeper-ci-r5-account-b';
    const appRecord = (id) =>
      make('KeeperApp', {
        id,
        publicId: 'CI-NOT-A-PUBLIC-KEY',
        primaryMnemonic: 'CI INVALID NOT A MNEMONIC',
        primarySeed: 'CI INVALID NOT A SEED',
        imageEncryptionKey: 'CI INVALID NOT A KEY',
        networkType: 'TESTNET',
        version: 'CI',
      });
    a.write(() => a.create('KeeperApp', appRecord(appA)));
    b.write(() => b.create('KeeperApp', appRecord(appB)));
    let active = a;
    const state = {
      settings: { bitcoinNetworkType: 'TESTNET', loginMethod: 'PIN' },
      storage: { appId: appA, appCreated: false },
      account: { allAccounts: [] },
    };
    const actions = [];
    const action = (name) => (payload) => ({ type: name, payload });
    const dispatch = (item) => {
      actions.push(item);
      if (item.type === 'setAppId') state.storage.appId = item.payload;
      if (item.type === 'setAppCreated') state.storage.appCreated = item.payload;
      if (item.type === 'addAccount') state.account.allAccounts = [{ appId: item.payload }];
      return item;
    };
    const dbManager = {
      getObjectByIndex: (name) => active.objects(name)[0],
      getCollection: (name) => Array.from(active.objects(name)),
      createObject: (name, object) => {
        active.write(() => active.create(name, object, Realm.UpdateMode.All));
        return true;
      },
    };
    let online = false;
    let allowKey = false;
    let generationCount = 0;
    let firstWalletAt;
    const signer = (fingerprint) =>
      make('Signer', {
        id: `${fingerprint}0T`,
        masterFingerprint: fingerprint,
        type: 'SEED_WORDS',
        networkType: 'TESTNET',
        signerXpubs: {
          P2WPKH: [{ xpub: `CI INVALID XPUB ${fingerprint}`, derivationPath: "m/84'/1'/0'" }],
        },
      });
    const recovery = signer('C1C1C1C1');
    const deps = {
      ...effects,
      RealmSchema,
      ...enums,
      ...subscription,
      DeviceInfo,
      dbManager,
      realm: { getDatabase: () => active },
      store: { getState: () => state, dispatch },
      getJSONFromRealmObject: (item) => (item.toJSON ? item.toJSON() : item),
      Relay: { createNewApp: async () => ({ created: online }) },
      WalletUtilities: { getDerivationPath: () => "m/84'/1'/0'" },
      setupRecoveryKeySigningKey: () => recovery,
      addNewWalletsWorker: function* () {
        generationCount += 1;
        dbManager.createObject(
          'Wallet',
          make('Wallet', {
            id: 'keeper-ci-r5-mobile-wallet',
            type: 'DEFAULT',
            networkType: 'TESTNET',
            entityKind: 'WALLET',
            scriptType: 'P2WPKH',
            derivationDetails: make('WalletDerivationDetails', {
              instanceNum: 0,
              xDerivationPath: "m/84'/1'/0'",
              mnemonic: 'CI INVALID',
            }),
            specs: make('WalletSpecs', { xpub: 'CI INVALID XPUB' }),
          })
        );
        firstWalletAt = now();
        return true;
      },
      addSigningDeviceWorker: function* () {
        if (allowKey) dbManager.createObject('Signer', recovery);
        return allowKey;
      },
      LoginMethod: { BIOMETRIC: 'BIOMETRIC' },
      beginBackupLocalOperation: (appId, _origin, session) => ({
        appId,
        session,
        database: active,
      }),
      commitBackupLocalOperation: (operation, write) => {
        if (
          operation.database !== active ||
          operation.appId !== state.storage.appId ||
          operation.session !== workers.currentBackupAccountSession()
        )
          return { committed: false };
        try {
          active.write(() => write(active));
          return { committed: true };
        } catch {
          return { committed: false };
        }
      },
      // Deliberately no remote request and no Verified/backup-confirmed assertion.
      queueCommittedBackupWorker: function* () {
        return { updated: true, backupPending: true };
      },
      captureError: () => undefined,
      uaiType: { SIGNING_DEVICES_HEALTH_CHECK: 'health' },
    };
    for (const name of [
      'setAppId',
      'addAccount',
      'updateDefaultWalletCreatedByAppId',
      'setAppCreated',
      'resetRealyWalletState',
      'loadConciergeUser',
      'loadConciergeTickets',
      'setBiometricEnabledAppId',
      'setAppCreationError',
      'uaiChecks',
      'showDeletingKeyModal',
      'hideDeletingKeyModal',
      'showKeyDeletedSuccessModal',
      'relaySignersUpdateFail',
    ])
      deps[name] = action(name);
    const workers = createWorkers(deps);
    workers.observeBackupAccount(appA);
    const run = (name, args) =>
      runSaga({ getState: () => state, dispatch }, workers[name], args).toPromise();
    const setup = () =>
      run('setupKeeperAppWorker', { payload: { appName: 'CI disposable', fcmToken: '' } });
    const readyAt = now();
    await setup();
    check(
      a.objects('Wallet').length === 0 && state.storage.appCreated === false,
      'offline-setup-ready'
    );
    online = true;
    const setupAt = now();
    await setup();
    check(
      a.objects('Wallet').length === 1 && state.storage.appCreated === false,
      'key-failure-ready'
    );
    allowKey = true;
    await setup();
    check(
      a.objects('Wallet').length === 1 && generationCount === 1 && state.storage.appCreated,
      'retry-wallet-duplicate'
    );
    check(
      a.objects('Signer').length === 1 && state.account.allAccounts.length === 1,
      'retry-account-duplicate'
    );
    check(Number.isFinite(firstWalletAt) && firstWalletAt >= setupAt, 'first-wallet-clock');

    const target = signer('D1D1D1D1');
    const unrelated = signer('E1E1E1E1');
    dbManager.createObject('Signer', target);
    dbManager.createObject('Signer', unrelated);
    const request = (signers) => ({
      payload: { signers },
      originAppId: appA,
      originBackupAccountSession: workers.currentBackupAccountSession(),
    });
    for (const kind of ['active', 'hidden', 'canary', 'archived']) {
      dbManager.createObject(
        'Vault',
        make('Vault', {
          id: 'keeper-ci-r5-reference',
          entityKind: 'VAULT',
          type: kind === 'canary' ? 'CANARY' : 'DEFAULT',
          networkType: 'TESTNET',
          archived: kind === 'archived',
          presentationData: {
            name: 'CI concealed sentinel',
            description: '',
            visibility: kind === 'hidden' ? 'HIDDEN' : 'DEFAULT',
          },
          signers: [
            make('VaultSigner', {
              masterFingerprint: target.masterFingerprint,
              xpub: 'CI INVALID VAULT XPUB',
              xfp: target.masterFingerprint,
              derivationPath: "m/48'/1'/0'/2'",
            }),
          ],
        })
      );
      check(
        (await run('deleteSigningDeviceWorker', request([target]))) === false,
        'retained-reference-accepted'
      );
      check(
        a.objectForPrimaryKey('Signer', target.id) && a.objectForPrimaryKey('Signer', unrelated.id),
        'retained-reference-deleted'
      );
      active.write(() => active.delete(active.objects('Vault')));
    }
    // Missing later target must roll back an earlier native deletion atomically.
    const missing = signer('F1F1F1F1');
    check(
      (await run('deleteSigningDeviceWorker', request([target, missing]))) === false,
      'partial-delete-accepted'
    );
    check(a.objectForPrimaryKey('Signer', target.id), 'partial-delete-not-rolled-back');
    const stale = request([target]);
    active = b;
    state.storage.appId = appB;
    workers.observeBackupAccount(appB);
    active = a;
    state.storage.appId = appA;
    workers.observeBackupAccount(appA);
    check((await run('deleteSigningDeviceWorker', stale)) === false, 'stale-session-accepted');
    check(a.objectForPrimaryKey('Signer', target.id), 'stale-session-mutated');
    check(
      (await run('deleteSigningDeviceWorker', request([target]))) === true,
      'unreferenced-delete-rejected'
    );
    check(
      !a.objectForPrimaryKey('Signer', target.id) && a.objectForPrimaryKey('Signer', unrelated.id),
      'targeted-delete-wrong-record'
    );
    check(
      b.objects('Wallet').length === 0 && b.objects('Signer').length === 0,
      'other-native-account-mutated'
    );
    const measurement = {
      iteration,
      probe_ready_ms: readyAt - startedAt,
      setup_first_wallet_ms: firstWalletAt - setupAt,
    };
    check(
      Object.values(measurement).every(Number.isFinite) &&
        measurement.probe_ready_ms >= 0 &&
        measurement.setup_first_wallet_ms >= 0,
      'invalid-clock-measurement'
    );
    const measurements = [...saved.measurements, measurement];
    storage.setItem(PHASE, JSON.stringify({ iteration, measurements }));
    return {
      stage: 'next',
      measurements,
      scenarios: SCENARIOS.map((id) => ({
        id,
        status: id === 'native-worker-process-relaunch-counts' ? 'NOT RUN' : 'PASS',
      })),
    };
  } finally {
    if (a && !a.isClosed) a.close();
    if (b && !b.isClosed) b.close();
  }
}
module.exports = { runFeatures, recordBuilder, FeatureFailure, PHASE, SCENARIOS, LIMITS };
