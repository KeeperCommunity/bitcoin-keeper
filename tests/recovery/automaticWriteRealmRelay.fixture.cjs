// Native Realm and real Redux/AES host fixture. Backup algorithms, database
// wrappers and schemas are loaded from production source; this is not the
// in-memory DB or Relay adapter used by the ordinary unit harness.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('typescript');
const { configureStore } = require('@reduxjs/toolkit');
const { combineReducers } = require('redux');
const { persistReducer, persistStore, createMigrate } = require('redux-persist');
const { runSaga } = require('redux-saga');
const effects = require('redux-saga/effects');
const Realm = require('realm');

const root = path.resolve(__dirname, '../..');
const plain = (value) => JSON.parse(JSON.stringify(value));

function declarations(file, names) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const matches = source.statements.filter((node) =>
    (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) => names.includes(declaration.name?.text))));
  assert.equal(matches.length, names.length, `Missing production declarations in ${file}`);
  return matches.map((node) => node.getText(source).replace(/^export /, '').replace(/^const /, 'var ')).join('\n');
}

function componentDeclarations(file, component, names) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === component);
  assert.ok(declaration?.body, `Missing production component ${component}`);
  const matches = declaration.body.statements.filter((node) => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((value) => names.includes(value.name?.text)));
  assert.equal(matches.length, names.length, `Missing production declarations in ${component}`);
  return matches.map((node) => node.getText(source).replace(/^const /, 'var ')).join('\n');
}

function classMembers(file, name, names) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing production class ${name}`);
  const members = declaration.members.filter((member) => names.includes(member.name?.getText(source)));
  assert.equal(members.length, names.length, `Missing production ${name} members`);
  return `var ${name} = class ${name} {\n${members.map((member) => member.getText(source)).join('\n')}\n};`;
}

function evaluate(source, globals, file) {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const defaults = {
    // Native Realm checks JavaScript constructor identity for Mixed values.
    // JSON must share the host that owns the genuine Realm binding, as Metro
    // production code and Realm do; no decoded fields are rewritten here.
    JSON, Date, Buffer, Uint8Array, Int8Array, ArrayBuffer, Promise, Set, Map, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, setImmediate, clearImmediate,
    console, Realm, process,
  };
  for (const [name, value] of Object.entries(defaults)) if (!Object.hasOwn(globals, name)) globals[name] = value;
  return vm.runInNewContext(code, globals, { filename: file });
}

function sourceLoader(bindings, options = {}) {
  const cache = new Map();
  // The separate protected proof imports these exact installed ESM namespaces
  // asynchronously before this synchronous Metro-style production loader runs.
  // Authority/proof/encryption modules themselves cannot be replaced here.
  const esmPackages = new Set(['@scure/bip32', '@scure/bip39',
    '@scure/bip39/wordlists/english.js', '@noble/hashes/hkdf.js',
    '@noble/hashes/sha2.js', '@noble/hashes/utils.js', '@noble/curves/secp256k1.js',
    '@noble/curves/utils.js', '@exodus/bytes/encoding-lite.js']);
  for (const [name, namespace] of Object.entries(options.moduleBindings || {})) {
    assert.ok(esmPackages.has(name), 'Only real external protected-crypto ESM packages may be supplied');
    assert.equal(Object.prototype.toString.call(namespace), '[object Module]', 'Supply an actual imported ESM namespace');
  }
  function load(file) {
    const absolute = path.isAbsolute(file) ? file : path.join(root, file);
    const candidate = [absolute, `${absolute}.ts`, `${absolute}.tsx`, `${absolute}.js`, path.join(absolute, 'index.ts')].find((name) => fs.existsSync(name) && fs.statSync(name).isFile());
    if (!candidate) throw new Error(`Production module is unavailable: ${file}`);
    if (cache.has(candidate)) return cache.get(candidate).exports;
    const module = { exports: {} };
    cache.set(candidate, module);
    evaluate(fs.readFileSync(candidate, 'utf8'), {
      module, exports: module.exports,
      // Timeout cases compress the real abort timers only. Axios still sends
      // actual HTTP and its AbortController cancels a genuinely delayed reply.
      ...(options.backupTimerCeilingMs ? { setTimeout: (callback, milliseconds, ...args) =>
        setTimeout(callback, Math.min(milliseconds, options.backupTimerCeilingMs), ...args) } : {}),
      require(name) {
        if (Object.hasOwn(options.moduleBindings || {}, name)) return options.moduleBindings[name];
        if (Object.hasOwn(bindings, name)) return bindings[name];
        if (name.startsWith('src/')) return load(name);
        if (name.startsWith('.')) {
          const resolved = path.resolve(path.dirname(candidate), name);
          const alias = path.relative(root, resolved);
          if (Object.hasOwn(bindings, alias)) return bindings[alias];
          return load(resolved);
        }
        return require(name);
      },
    }, candidate);
    return module.exports;
  }
  return load;
}

async function createRealmClient(url, options = {}) {
  assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/, 'Fixture must use a loopback HTTP Relay');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-native-realm-backup-'));
  const diagnostics = [];
  const persistedHostRecords = new Map();
  const persistedHostReads = [];
  const persistedBootStates = [];
  let firstPersistedKey;
  let secondaryPersistedRead;
  let failingPersistedKey;
  // Only the MMKV host storage boundary is replaced. When explicitly requested,
  // actual redux-persist reads and reconciles these serialized persisted bytes;
  // the adapter never supplies Realm records, backup evidence or HTTP replies.
  const reduxStorage = {
    getItem: async (key) => {
      persistedHostReads.push(key);
      // Controlling MMKV completion order must not replace any Redux action,
      // reducer, backup proof or server response in the genuine matrix.
      if (firstPersistedKey && key !== `persist:${firstPersistedKey}`)
        await secondaryPersistedRead.promise;
      if (key === `persist:${failingPersistedKey}`) throw new Error('Disposable host storage read failed');
      return persistedHostRecords.get(key) ?? null;
    },
    setItem: async (key, value) => { persistedHostRecords.set(key, value); },
    removeItem: async (key) => { persistedHostRecords.delete(key); },
  };
  const bindings = {
    realm: Realm,
    'src/services/sentry': { captureError(error) { diagnostics.push(error?.name || 'error'); } },
    // Localization is a host UI boundary; use the actual shipped English data
    // without bootstrapping React Native contexts in this Node source fixture.
    'src/context/Localization/LocContext': { translations: require('../../src/context/Localization/language/en.json') },
    'react-native': { Platform: { OS: 'fixture-host' } },
    'react-native-device-info': { getVersion: () => '2.6.4', getBuildNumber: () => '627' },
    'react-native-rsa-native': { RSA: new Proxy({}, { get: () => () => { throw new Error('Unexpected native RSA use'); } }) },
    'src/utils/service-utilities/config': { ...options.config,
      RELAY: url, HEXA_ID: 'disposable-fixture', ENVIRONMENT: 'DEVELOPMENT', isDevMode: () => true },
    'src/storage/realm/migrations': { runRealmMigrations() { throw new Error('A fresh fixture must never migrate an existing Realm'); } },
    'src/storage': { reduxStorage },
    'redux-persist/es/persistReducer': require('redux-persist/lib/persistReducer').default,
  };
  const load = sourceLoader(bindings, options);
  const enums = load('src/services/wallets/enums');
  const RealmSchema = load('src/storage/realm/enum').RealmSchema;
  let dbManager;
  const utilitiesScope = { ...enums, _: require('lodash'), dbManager: new Proxy({}, {
    get: (_target, name) => (...arguments_) => dbManager[name](...arguments_),
  }), RealmSchema,
    getJSONFromRealmObject: (object) => object.toJSON() };
  evaluate(declarations('src/constants/defaultData.tsx', ['RECOVERY_KEY_SIGNER_NAME']) + '\n' +
    declarations('src/utils/utilities.ts', ['getAccountFromSigner', 'getKeyUID', 'checkSignerAccountsMatch', 'sanitizeSeedKeyForBackup', 'sanitizeVaultSignersForSeedKeyBackup']), utilitiesScope, 'production-backup-utilities.ts');
  bindings['src/utils/utilities'] = utilitiesScope;
  const realmDatabase = load('src/storage/realm/realm').default;
  dbManager = load('src/storage/realm/dbManager').default;
  utilitiesScope.dbManager = dbManager;
  const schemas = load('src/storage/realm/schema').default;
  const encryption = load('src/utils/service-utilities/encryption');
  const image = load('src/services/backup/image');
  const transport = load('src/services/backup/transport');
  const bhr = load('src/store/reducers/bhr');
  const storage = load('src/store/reducers/storage');
  const account = load('src/store/reducers/account');
  const settings = load('src/store/reducers/settings');
  const network = options.withNetwork ? load('src/store/reducers/network') : undefined;
  const middlewareScope = { dbManager, RealmSchema, ...transport, ...bhr,
    isBackupVerificationCurrent: (...args) => load('src/services/backup/automatic').isBackupVerificationCurrent(...args) };
  evaluate(declarations('src/store/store.ts', ['accountOwnedActions', 'accountOwnedUtxoUiActions', 'bindActionOrigin']), middlewareScope, 'production-origin-middleware.ts');
  const actions = [];
  let beforeDispatch;
  // This Node fixture mounts the four production slices used by recovery. The
  // optional root wrapper uses the actual production declarations/config and
  // redux-persist reconciler, rather than simulating REHYDRATE with a reducer.
  let reducer = combineReducers({ bhr: bhr.default, storage: storage.default, account: account.default, settings: settings.default,
    ...(network ? { network: network.default } : {}) });
  if (options.persistedRedux) {
    const persistenceScope = { appReducer: reducer, storage: reduxStorage, reduxStorage,
      RESET_REDUX_STORE: 'RESET_REDUX_STORE', persistReducer, createMigrate,
      reduxPersistMigrations: load('src/store/migrations').default };
    evaluate(declarations('src/store/store.ts', ['rootReducer', 'persistConfig', 'persistedReducer']), persistenceScope, 'production-root-persistence.ts');
    reducer = persistenceScope.persistedReducer;
  }
  const store = configureStore({
    reducer,
    middleware: (defaults) => defaults({ serializableCheck: false, immutableCheck: false }).concat(() => (next) => (action) => {
      beforeDispatch?.(action);
      return next(action);
    }, middlewareScope.bindActionOrigin, () => (next) => (action) => {
      actions.push(action);
      const result = next(action);
      if (action.type === 'persist/REHYDRATE') {
        persistedBootStates.push({ key: action.key, bhr: plain(store.getState().bhr) });
        if (action.key === firstPersistedKey) secondaryPersistedRead.release();
      }
      return result;
    }),
  });
  store.dispatch(settings.setBitcoinNetwork(enums.NetworkType.TESTNET));
  bindings['src/store/store'] = { store };
  const repair = load('src/services/backup/repair');
  const Relay = load('src/services/backend/Relay').default;
  const nativeEvents = [];
  let selected;
  const accountFiles = new Map();
  const seed = options.primarySeed || 'ab'.repeat(32);
  const appId = options.appId || encryption.hash256(Buffer.from(seed, 'hex').toString('hex'));

  // Production schema defaults supply complete disposable objects without
  // replacing or weakening any production object schema.
  function defaults(name, patch = {}, ancestors = []) {
    const schema = schemas.find((value) => value.name === name);
    assert.ok(schema, `Unknown production schema ${name}`);
    assert.ok(!ancestors.includes(name), `Required schema cycle: ${name}`);
    const record = {};
    for (const [key, specification] of Object.entries(schema.properties)) {
      const property = typeof specification === 'string' ? { type: specification } : specification;
      const type = property.type;
      if (property.default !== undefined) record[key] = property.default;
      else if (property.optional || type.endsWith('?') || type === 'mixed') record[key] = null;
      else if (type === 'list' || type.endsWith('[]')) record[key] = [];
      else if (type === 'string') record[key] = '';
      else if (['int', 'float', 'double'].includes(type)) record[key] = 0;
      else if (type === 'bool') record[key] = false;
      else if (type === 'date') record[key] = new Date('2026-10-01T00:00:00Z');
      else if (type === 'data') record[key] = new ArrayBuffer(0);
      else record[key] = defaults(property.objectType || type, {}, [...ancestors, name]);
    }
    return { ...record, ...patch };
  }

  function nativeRealm() { return realmDatabase.getDatabase(); }
  async function selectAccount(id = appId) {
    let filename = accountFiles.get(id);
    if (!filename) {
      filename = path.join(directory, `${crypto.createHash('sha256').update(id).digest('hex')}.realm`);
      accountFiles.set(id, filename);
    }
    const result = await dbManager.initializeRealm(Buffer.alloc(64, 7), filename);
    assert.equal(result.success, true, 'Actual encrypted Realm must open');
    selected = id;
    if (!dbManager.getObjectById(RealmSchema.KeeperApp, id)) {
      assert.equal(dbManager.createObject(RealmSchema.KeeperApp, defaults(RealmSchema.KeeperApp, {
        id, publicId: options.publicId || 'disposable-public-id', primaryMnemonic: options.primaryMnemonic || 'public disposable fixture only',
        primarySeed: seed, imageEncryptionKey: encryption.generateEncryptionKey(seed), networkType: enums.NetworkType.TESTNET, version: '2.6.4',
      })), true);
    }
    store.dispatch(storage.setAppId(id));
    return nativeRealm();
  }
  await selectAccount();
  let persistor;

  async function rehydratePersistedRedux(recordsByKey, { firstKey, failKey } = {}) {
    assert.equal(options.persistedRedux, true, 'Actual root persistence must be requested before creating the store');
    assert.equal(persistor, undefined, 'Each fixture represents one cold Redux persistence boot');
    if (firstKey) {
      assert.ok(['bhr', 'root'].includes(firstKey));
      firstPersistedKey = firstKey;
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      secondaryPersistedRead = { promise, release };
    }
    failingPersistedKey = failKey;
    for (const [key, state] of Object.entries(recordsByKey)) {
      const serialized = Object.fromEntries(Object.entries(state).map(([name, value]) => [name, JSON.stringify(value)]));
      persistedHostRecords.set(`persist:${key}`, JSON.stringify(serialized));
    }
    await new Promise((resolve) => { persistor = persistStore(store, undefined, resolve); });
    assert.equal(persistor.getState().bootstrapped, true);
    assert.equal(store.getState()._persist.rehydrated, true);
    assert.equal(store.getState().bhr._persist.rehydrated, true);
    await persistor.flush();
  }

  async function flushPersistedRedux() {
    assert.ok(persistor, 'Actual persistStore must have booted before flush');
    await persistor.flush();
  }

  function readPersistedRedux(key) {
    const serialized = persistedHostRecords.get(`persist:${key}`);
    assert.equal(typeof serialized, 'string', `Actual redux-persist must have stored ${key}`);
    return Object.fromEntries(Object.entries(JSON.parse(serialized)).map(([name, value]) => [name, JSON.parse(value)]));
  }

  function installProductionStoreObservers(extra = {}) {
    const source = ts.createSourceFile('store.ts', fs.readFileSync(path.join(root, 'src/store/store.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const statements = source.statements.filter((statement) => {
      const text = statement.getText(source);
      return /^(observeBackupAccount\(|store\.subscribe\(|setBackupUploadGuard\(|setBackupReconciliationHandler\(|dbManager\.setRecovery(?:Mutation|Commit)Observer\(|set(?:Backup|AutomaticBackup|ProtectedBackup)\w*\()/.test(text);
    });
    assert.ok(statements.length >= 5, 'Production account/local mutation hooks are required');
    evaluate(statements.map((statement) => statement.getText(source)).join('\n'), {
      store, dbManager, RealmSchema, ...transport, ...bhr, ...repair,
      ...load('src/services/backup/protected'), ...extra,
    }, 'production-store-observers.ts');
  }

  function listen() {
    const realm = nativeRealm();
    const listener = (_realm, event) => nativeEvents.push(event);
    realm.addListener('change', listener);
    return () => { if (!realm.isClosed) realm.removeListener('change', listener); };
  }

  function productionSagas(names, extra = {}) {
    const scope = {
      ...require('redux-saga'), ...effects, ...encryption, ...enums, ...image, ...transport, ...bhr, ...storage, ...account,
      ...load('src/services/backup/automatic'),
      ...load('src/services/backup/protected'),
      ...bindings['src/context/Localization/LocContext'],
      ...utilitiesScope, dbManager, realm: realmDatabase, Realm, RealmSchema, store, Relay,
      inspectBackup: repair.inspectBackup, captureError: bindings['src/services/sentry'].captureError,
      getJSONFromRealmObject: (object) => object.toJSON(),
      NetInfo: { fetch: async () => ({ isConnected: true }) },
      addToUaiStackWorker: function* () {}, uaiActionedWorker: function* () {},
      uaiType: { SERVER_BACKUP_FAILURE: 'SERVER_BACKUP_FAILURE' },
      console: { log() {}, error() {} }, Buffer, ...extra,
    };
    evaluate(declarations('src/store/sagas/bhr.ts', names), scope, 'production-backup-sagas.ts');
    return {
      scope,
      run(name, ...args) { return runSaga({ getState: store.getState, dispatch: store.dispatch }, scope[name], ...args).toPromise(); },
    };
  }

  async function payloadForCurrentImage() {
    const current = await repair.captureBackupImage();
    const app = plain(dbManager.getObjectByIndex(RealmSchema.KeeperApp));
    const key = encryption.generateEncryptionKey(app.primarySeed);
    const payload = {
      appId: app.id, publicId: app.publicId, networkType: app.networkType, version: app.version,
      subscription: JSON.stringify(app.subscription), walletObject: {}, signersObject: {}, vaultObject: {}, nodes: [], labels: [],
    };
    for (const [kind, records] of Object.entries(current)) {
      for (const [id, record] of Object.entries(records)) {
        const encrypted = await image.encryptRecord(key, record);
        if (kind === 'wallets') payload.walletObject[id] = encrypted;
        if (kind === 'signers') payload.signersObject[id] = encrypted;
        if (kind === 'nodes') payload.nodes.push(encrypted);
        if (kind === 'labels') payload.labels.push({ id: encryption.hash256(encryption.hash256(key + id)), content: encrypted });
        if (kind === 'vaults') payload.vaultObject[id] = {
          vaultId: id, vault: encrypted, isArchived: !!record.archived, scheme: record.scheme,
          signersData: record.signers.map((signer) => ({ signerId: utilitiesScope.getKeyUID(signer), xfpHash: encryption.hash256(signer.masterFingerprint) })),
        };
      }
    }
    return payload;
  }

  return {
    appId, seed, directory, load, bindings, enums, RealmSchema, Realm, realmDatabase, dbManager, store,
    encryption, image, repair, transport, Relay, bhr, storage, account, settings, network, utilities: utilitiesScope,
    config: bindings['src/utils/service-utilities/config'],
    defaults, nativeRealm, selectAccount, selected: () => selected, nativeEvents, diagnostics, actions,
    listen, installProductionStoreObservers, productionSagas, payloadForCurrentImage,
    rehydratePersistedRedux, flushPersistedRedux, readPersistedRedux, persistedHostReads, persistedBootStates,
    setBeforeDispatch(callback) { beforeDispatch = callback; },
    async close() { persistor?.pause(); realmDatabase.closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

module.exports = { createRealmClient, declarations, componentDeclarations, classMembers, evaluate, sourceLoader, plain, Realm };
