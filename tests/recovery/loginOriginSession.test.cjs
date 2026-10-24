const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { runSaga } = require('redux-saga');
const { call, put, select } = require('redux-saga/effects');

const file = path.join(__dirname, '../../src/store/sagas/login.ts');
const source = ts.createSourceFile(
  file,
  fs.readFileSync(file, 'utf8'),
  ts.ScriptTarget.Latest,
  true
);
const worker = source.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'credentialsAuthWorker'
);
assert.ok(worker, 'production authentication worker exists');
const code = ts.transpileModule(worker.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(pauseAt, options = {}) {
  const {
    persistedAppId = 'A',
    keeperApp = { id: 'A' },
    allAccounts = [
      {
        appId: 'A',
        hash: 'disposable-hash',
        realmId: 'A.realm',
      },
    ],
    appVersion = '2.5.0',
  } = options;
  const state = {
    storage: { appId: persistedAppId, appVersion, defaultWalletCreated: {} },
    account: {
      allAccounts,
      backupMethodByAppId: {},
    },
  };
  let session = 7;
  const paused = deferred();
  const resume = deferred();
  const actions = [];
  const realmOpens = [];
  const upgradeCalls = [];
  const gate = (value) => {
    paused.resolve();
    return resume.promise.then(() => value);
  };
  const scope = {
    call,
    put,
    select,
    currentBackupAccountSession: () => session,
    LoginMethod: { PIN: 'PIN' },
    hash512: () => 'disposable-hash',
    decrypt: () => 'disposable-key',
    SecureStore: { fetch: () => (pauseAt === 'credential' ? gate('cipher') : 'cipher') },
    stringToArrayBuffer: () => new Uint8Array([1]),
    dbManager: {
      initializeRealm: (_key, realmId) => {
        realmOpens.push(realmId);
        return pauseAt === 'realm' ? gate({ success: true }) : { success: true };
      },
      getObjectByIndex: () => keeperApp,
      getCollection: () => [{ version: `${appVersion}(2)` }],
    },
    RealmSchema: { KeeperApp: 'KeeperApp', VersionHistory: 'VersionHistory' },
    REALM_FILE: 'keeper.realm',
    store: { getState: () => state },
    DeviceInfo: { getVersion: () => '2.5.16', getBuildNumber: () => '2' },
    semver: require('semver'),
    applyUpgradeSequence: (args) => {
      upgradeCalls.push(args);
      throw Error('fixture stop');
    },
    console: { log() {} },
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
  ])
    scope[name] = (payload) => ({ type: name, payload });
  vm.runInNewContext(code, scope);
  const run = () =>
    runSaga(
      { getState: () => state, dispatch: (action) => actions.push(action), onError: () => {} },
      scope.credentialsAuthWorker,
      { payload: { method: 'PIN', passcode: 'disposable passcode', reLogin: false } }
    ).toPromise();
  const switchRoundTrip = () => {
    state.storage.appId = 'B';
    session += 1;
    state.storage.appId = 'A';
    session += 1;
  };
  return { paused, resume, actions, realmOpens, upgradeCalls, run, switchRoundTrip };
}

test('old login cannot reopen Realm after A -> B -> A while credentials are pending', async () => {
  const f = fixture('credential');
  const pending = f.run();
  await f.paused.promise;
  f.switchRoundTrip();
  f.resume.resolve();
  await pending;
  assert.deepEqual(f.realmOpens, []);
  assert.equal(
    f.actions.some((action) => action.type === 'setKey'),
    false
  );
  assert.equal(f.upgradeCalls.length, 0);
});

test('old login cannot start upgrade after A -> B -> A during Realm open', async () => {
  const f = fixture('realm');
  const pending = f.run();
  await f.paused.promise;
  f.switchRoundTrip();
  f.resume.resolve();
  await pending;
  assert.equal(f.realmOpens.length, 1);
  assert.equal(
    f.actions.some((action) => action.type === 'setAppId'),
    false
  );
  assert.equal(f.upgradeCalls.length, 0);
});

test('fresh account without KeeperApp completes login when persisted app ID is empty', async () => {
  const f = fixture(null, {
    persistedAppId: '',
    keeperApp: null,
    allAccounts: [],
    appVersion: '2.5.16',
  });
  await f.run();
  assert.equal(f.realmOpens.length, 1);
  assert.equal(
    f.actions.some((action) => action.type === 'setTempDetails'),
    true
  );
  assert.equal(
    f.actions.some((action) => action.type === 'credsAuthenticated' && action.payload === true),
    true
  );
  assert.equal(f.upgradeCalls.length, 0);
});

test('fresh account login rejects a stale nonempty persisted app ID', async () => {
  const f = fixture(null, {
    persistedAppId: 'STALE',
    keeperApp: null,
    allAccounts: [],
    appVersion: '2.5.16',
  });
  await f.run();
  assert.equal(f.realmOpens.length, 1);
  assert.equal(
    f.actions.some((action) => action.type === 'setTempDetails'),
    false
  );
  assert.equal(
    f.actions.some((action) => action.type === 'credsAuthenticated'),
    false
  );
  assert.equal(f.upgradeCalls.length, 0);
});

test('known account with missing KeeperApp fails authentication', async () => {
  const f = fixture(null, {
    persistedAppId: '',
    keeperApp: null,
    appVersion: '2.5.16',
  });
  await f.run();
  assert.equal(f.realmOpens.length, 1);
  assert.equal(
    f.actions.some((action) => action.type === 'credsAuthenticated' && action.payload === true),
    false
  );
  assert.equal(
    f.actions.some((action) => action.type === 'credsAuthenticated' && action.payload === false),
    true
  );
  assert.equal(f.upgradeCalls.length, 0);
});
