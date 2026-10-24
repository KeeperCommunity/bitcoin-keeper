const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { runSaga } = require('redux-saga');
const effects = require('redux-saga/effects');
const plain = (value) => JSON.parse(JSON.stringify(value));

function declarations(file, names) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  return ts.transpileModule(
    source.statements
      .filter(
        (node) =>
          (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) ||
          (ts.isVariableStatement(node) &&
            node.declarationList.declarations.some((value) =>
              names.includes(value.name.getText(source))
            ))
      )
      .map((node) =>
        node
          .getText(source)
          .replace(/^export /, '')
          .replace(/^const /, 'var ')
      )
      .join('\n'),
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } }
  ).outputText;
}

// Production login/observation orchestration; disposable synchronous transaction
// adapter only. Native Realm and the owner's installation are not exercised.
function fixture(options = {}) {
  const app = { id: 'A', version: '2.6.4', ...options.app };
  const state = {
    session: 7,
    writes: 0,
    upgrades: [],
    actions: [],
    history: plain(
      options.history ?? [{ version: '2.6.3(620)', date: 'old date', title: 'Old entry' }]
    ),
    storage: {
      appId: 'A',
      appVersion: options.persistedVersion ?? '2.6.4',
      defaultWalletCreated: {},
    },
    account: {
      allAccounts: [{ hash: 'fixture-hash', appId: 'A', realmId: 'fixture.realm' }],
      backupMethodByAppId: {},
    },
  };
  let selectedDatabase;
  const database = {
    objectForPrimaryKey: (schema, key) =>
      schema === 'KeeperApp'
        ? app.id === key
          ? app
          : undefined
        : state.history.find((row) => row.version === key),
    write(callback) {
      const before = plain(state.history);
      const previousVersion = app.version;
      try {
        callback();
      } catch (error) {
        state.history = before;
        app.version = previousVersion;
        throw error;
      }
    },
    create(_schema, record) {
      if (options.failHistory) throw Error('disposable history failure');
      const index = state.history.findIndex((row) => row.version === record.version);
      if (index < 0) state.history.push(plain(record));
      else state.history[index] = plain(record);
      state.writes++;
      options.onCreate?.({
        state,
        replaceDatabase: () => {
          selectedDatabase = {};
        },
      });
    },
  };
  selectedDatabase = database;
  const scope = {
    ...effects,
    store: { getState: () => state },
    semver: require('semver'),
    RealmSchema: { KeeperApp: 'KeeperApp', VersionHistory: 'VersionHistory' },
    realmDatabase: { getDatabase: () => selectedDatabase },
    currentBackupAccountSession: () => state.session,
    captureBackupWriteIntent: () => undefined,
    LoginMethod: { PIN: 'PIN' },
    hash512: () => 'fixture-hash',
    decrypt: () => 'fixture-key',
    SecureStore: { fetch: () => 'fixture-ciphertext' },
    stringToArrayBuffer: () => new Uint8Array([1]),
    DeviceInfo: { getVersion: () => '2.6.4', getBuildNumber: () => options.build ?? '620' },
    console: { log() {} },
    dbManager: {
      initializeRealm: () => ({ success: true }),
      getObjectByIndex: () => app,
      getCollection: (schema) => (schema === 'VersionHistory' ? state.history : []),
      createObject: database.create,
    },
    Realm: { UpdateMode: { Modified: 'modified' } },
    beginBackupLocalOperation: (appId, _intent, session) => ({ appId, session }),
    commitBackupLocalOperation: (_operation, callback) => {
      if (options.migrationResult === false) return { committed: false };
      database.write(() => callback(database));
      return { committed: true };
    },
    buildAutomaticAppMutation: () => ({ operation: 'updateAppImage' }),
    enqueueAutomaticBackupOperation: async () => ({ backupConfirmed: false }),
    notifyBackupReconciliation() {},
    captureError() {},
    getApp: () => ({}),
    getMessaging: () => ({}),
    getReleaseTopic: (value) => value,
    unsubscribeFromTopic() {},
    subscribeToTopic() {},
    uaiType: new Proxy({}, { get: (_, name) => name }),
  };
  for (const name of [
    'credsAuthenticatedError',
    'setRecepitVerificationError',
    'setRecepitVerificationFailed',
    'setupLoading',
    'setKey',
    'setPinHash',
    'migrateLegacyAutomaticCloudBackup',
    'setAppId',
    'setTempDetails',
    'credsAuthenticated',
    'connectToNode',
    'fetchExchangeRates',
    'fetchSignedDelayedTransaction',
    'fetchDelayedPolicyUpdate',
    'resetSyncing',
    'autoSyncWallets',
    'uaiChecks',
    'loadConciergeUserOnLogin',
    'setLoginMethod',
    'setAppVersion',
  ])
    scope[name] = (payload) => ({ type: name, payload });
  vm.createContext(scope);
  vm.runInContext(
    declarations('src/store/sagas/upgrade.ts', [
      'upgradeAccountIsActive',
      'observeCurrentVersionHistory',
      'beginUpgradeGroup',
      'completeUpgradeGroup',
      'stageVersionUpdate',
      'updateReleaseTopics',
      'applyUpgradeSequence',
      'LABELS_INTRODUCTION_VERSION',
      'BIP329_INTRODUCTION_VERSION',
      'KEY_MANAGEMENT_VERSION',
      'APP_KEY_UPGRADE_VERSION',
      'HEALTH_CHECK_TIMELINE_MIGRATION_VERSION',
      'SIGNER_POLICY_MIGRATION_VERSION',
    ]),
    scope
  );
  const productionUpgrade = scope.applyUpgradeSequence;
  scope.applyUpgradeSequence = function* (action) {
    state.upgrades.push(plain(action));
    return yield* productionUpgrade(action);
  };
  vm.runInContext(declarations('src/store/sagas/login.ts', ['credentialsAuthWorker']), scope);
  const login = () =>
    runSaga(
      { getState: () => state, dispatch: (action) => state.actions.push(action), onError() {} },
      scope.credentialsAuthWorker,
      { payload: { method: 'PIN', reLogin: false } }
    ).toPromise();
  const observe = (session = state.session) =>
    scope.observeCurrentVersionHistory('A', '2.6.4', options.build ?? '620', session);
  return { app, state, login, observe };
}

test('selected older Realm account still upgrades when another account advanced the Redux version', async () => {
  const f = fixture({ app: { version: '2.6.3' } });
  await f.login();
  assert.equal(f.state.upgrades.length, 1);
  assert.equal(f.state.upgrades[0].previousVersion, '2.6.3');
  assert.equal(f.app.version, '2.6.4');
  assert.match(f.state.history.at(-1).title, /^Upgraded from 2\.6\.3 to 2\.6\.4$/);
});

test('missing current tuple is observed even when a stale marketing row has the same build', async () => {
  const f = fixture();
  const old = plain(f.state.history[0]);
  await f.login();
  assert.equal(f.state.upgrades.length, 0);
  assert.equal(f.state.history.length, 2);
  assert.deepEqual(f.state.history[0], old);
  assert.equal(f.state.history[1].version, '2.6.4(620)');
  assert.equal(f.state.history[1].title, 'Current installation observed');
});

test('empty history does not block login and records only current installation evidence', async () => {
  const f = fixture({ history: [] });
  await f.login();
  assert.ok(
    f.state.actions.some(
      (action) => action.type === 'credsAuthenticated' && action.payload === true
    )
  );
  assert.equal(f.state.history.length, 1);
  assert.equal(f.state.history[0].title, 'Current installation observed');
});

test('current recovery entry anywhere in history retains its provenance and date', async () => {
  const history = [
    { version: '2.6.4(620)', title: 'Recovered Wallet', date: 'recovery date' },
    { version: '2.6.3(619)', title: 'Old imported entry', date: 'older date' },
  ];
  const f = fixture({ history });
  await f.login();
  assert.deepEqual(f.state.history, history);
  assert.equal(f.state.writes, 0);
});

test('repeated login does not duplicate or replace an observed entry', async () => {
  const f = fixture({ history: [] });
  await f.login();
  const observed = plain(f.state.history);
  await f.login();
  assert.deepEqual(f.state.history, observed);
  assert.equal(f.state.writes, 1);
});

test('unsuccessful migrations never append current history or claim an upgrade', async () => {
  const f = fixture({ app: { version: '2.6.3' }, migrationResult: false });
  const before = plain(f.state.history);
  await f.login();
  assert.equal(f.state.upgrades.length, 1);
  assert.equal(f.app.version, '2.6.3');
  assert.deepEqual(f.state.history, before);
});

test('legacy missing account version uses the existing persisted baseline', async () => {
  const f = fixture({ app: { version: undefined }, persistedVersion: '2.6.3' });
  await f.login();
  assert.equal(f.state.upgrades.length, 1);
  assert.equal(f.state.upgrades[0].previousVersion, '2.6.3');
  assert.equal(f.app.version, '2.6.4');
  assert.equal(f.state.history.at(-1).title, 'Upgraded from 2.6.3 to 2.6.4');
  assert.equal(f.state.history.filter((row) => row.version === '2.6.4(620)').length, 1);
});

test('legacy missing account version cannot infer current history from Redux alone', async () => {
  const f = fixture({ app: { version: undefined }, history: [] });
  await f.login();
  assert.equal(f.state.upgrades.length, 0);
  assert.equal(f.app.version, undefined);
  assert.deepEqual(f.state.history, []);
  assert.ok(
    f.state.actions.some(
      (action) => action.type === 'credsAuthenticated' && action.payload === true
    )
  );
});

test('defined invalid account version cannot silently use another account version', async () => {
  const f = fixture({ app: { version: 'invalid' }, persistedVersion: '2.6.3' });
  const before = plain(f.state.history);
  await f.login();
  assert.equal(f.state.upgrades.length, 0);
  assert.deepEqual(f.state.history, before);
  assert.ok(
    f.state.actions.some(
      (action) => action.type === 'credsAuthenticated' && action.payload === false
    )
  );
});

test('history observation cannot run under an old A to B to A account session', () => {
  const f = fixture();
  f.state.session += 2;
  assert.equal(f.observe(7), false);
  assert.equal(f.state.writes, 0);
});

test('history observation requires the account version to be current', () => {
  const f = fixture({ app: { version: '2.6.3' } });
  assert.equal(f.observe(), false);
  assert.equal(f.state.writes, 0);
});

test('account or Realm replacement during history transaction rolls back its row', () => {
  for (const change of [
    ({ state }) => {
      state.session++;
    },
    ({ replaceDatabase }) => replaceDatabase(),
  ]) {
    const f = fixture({ onCreate: change });
    const before = plain(f.state.history);
    assert.equal(f.observe(), false);
    assert.deepEqual(f.state.history, before);
  }
});

test('local history write failure leaves existing history intact', () => {
  const f = fixture({ failHistory: true });
  const before = plain(f.state.history);
  assert.equal(f.observe(), false);
  assert.deepEqual(f.state.history, before);
});
