const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { runSaga } = require('redux-saga');
const effects = require('redux-saga/effects');

const root = path.resolve(__dirname, '../..');
function compile(source, scope) {
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  } }).outputText, scope);
}
const loginSource = ts.createSourceFile('login.ts',
  fs.readFileSync(path.join(root, 'src/store/sagas/login.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const worker = loginSource.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'credentialsAuthWorker');
assert.ok(worker);

// Execute production lookup and login together. Native reads/Realm are modeled;
// the separate owned-device missing-ack/cold-login receipt supplies native proof.
function fixture(options = {}) {
  const owner = options.owner ?? 'B';
  const accounts = [
    { appId: 'A', accountIdentifier: '', realmId: 'keeper.realm', hash: 'old-A', isDefault: true },
    { appId: 'B', accountIdentifier: 'service-B', realmId: 'B.realm', hash: 'old-B', isDefault: false },
  ];
  const state = { storage: { appId: 'A', appVersion: '2.6.5', defaultWalletCreated: {} },
    account: { allAccounts: options.legacy ? [] : accounts, backupMethodByAppId: {} },
    wallet: { retained: 'A-cache' } };
  const actions = [], reads = [], opens = [];
  let session = 1;
  const control = { state, actions, reads, opens, changeSession: () => { session += 2; } };
  const records = new Map(accounts.map(account => [account.accountIdentifier || undefined, {
    username: 'synthetic', password: JSON.stringify({
      hash: account.appId === owner ? 'new-' + owner : account.hash,
      enc_key: 'wrap-' + account.appId,
      pubKey: Buffer.from('synthetic public key').toString('base64'),
    }),
  }]));
  const native = { async getGenericPassword({ service }) {
    reads.push(service);
    const value = records.get(service) ?? false;
    await options.onRead?.(control, service);
    return value;
  } };
  const scope = { ...effects, exports: {}, Buffer, console: { log() {} },
    currentBackupAccountSession: () => session, store: { getState: () => state },
    LoginMethod: { PIN: 'PIN', BIOMETRIC: 'BIO' }, hash512: () => options.hash ?? 'new-' + owner,
    decrypt: (hash, encrypted) => {
      assert.equal(hash, 'new-' + owner); assert.equal(encrypted, 'wrap-' + owner);
      return '!'.repeat(64);
    },
    stringToArrayBuffer: key => new Uint8Array(Array.from(key, c => c.charCodeAt(0))),
    RealmSchema: { KeeperApp: 'KeeperApp' }, REALM_FILE: 'keeper.realm',
    dbManager: {
      async initializeRealm(key, realmId) {
        opens.push(realmId);
        assert.equal(key.length, 64); assert.ok(Array.from(key).every(n => n === 33));
        await options.onOpen?.(control);
        return options.openFails ? { success: false, error: 'synthetic open failure' } : { success: true };
      },
      getObjectByIndex: () => ({ id: options.realmOwner ?? owner, version: '2.6.5' }),
    },
    captureBackupWriteIntent: () => undefined,
    DeviceInfo: { getVersion: () => '2.6.5', getBuildNumber: () => '621' },
    semver: require('semver'), observeCurrentVersionHistory() {},
    uaiType: new Proxy({}, { get: (_, name) => name }),
    require(name) {
      if (name === 'react-native-keychain') return native;
      if (name === 'src/store/store') return { store: scope.store };
      if (name === 'src/services/backup/transport') return { currentBackupAccountSession: () => session };
      if (name === 'src/store/reducers/account') return { updatePasscodeHash: scope.updatePasscodeHash };
      if (name === '../utils/service-utilities/config' || name === './startup-failure-observer') return {};
      if (name === 'node-rsa') return { default: class {
        importKey() { return { verify: () => options.signatureAccepted !== false }; }
      } };
      throw Error('Unexpected dependency: ' + name);
    },
  };
  for (const name of ['credsAuthenticatedError', 'setRecepitVerificationError',
    'setRecepitVerificationFailed', 'setupLoading', 'setKey', 'setPinHash', 'updatePasscodeHash',
    'migrateLegacyAutomaticCloudBackup', 'setAppId', 'setTempDetails', 'credsAuthenticated',
    'connectToNode', 'fetchExchangeRates', 'fetchSignedDelayedTransaction', 'fetchDelayedPolicyUpdate',
    'resetSyncing', 'autoSyncWallets', 'uaiChecks', 'loadConciergeUserOnLogin', 'setLoginMethod'])
    scope[name] = payload => ({ type: name, payload });
  const credentialScope = { ...scope, exports: {} };
  compile(fs.readFileSync(path.join(root, 'src/storage/secure-store.ts'), 'utf8'), credentialScope);
  scope.SecureStore = credentialScope.exports;
  compile(worker.getText(loginSource), scope);
  control.api = scope.SecureStore;
  control.records = records;
  control.run = () => runSaga({ getState: () => state, onError() {}, dispatch(action) {
    actions.push(action);
    if (action.type === 'updatePasscodeHash') state.account.allAccounts = state.account.allAccounts.map(a =>
      a.appId === action.payload.appId ? { ...a, hash: action.payload.newHash } : a);
    if (action.type === 'setAppId') state.storage.appId = action.payload;
  } }, scope.credentialsAuthWorker, { payload: {
    method: options.biometric ? 'BIO' : 'PIN', reLogin: false, appId: owner,
    passcode: 'synthetic signature or PIN',
  } }).toPromise();
  return control;
}
const updates = f => f.actions.filter(a => a.type === 'updatePasscodeHash');
const publishesKey = f => f.actions.some(a => a.type === 'setKey' || a.type === 'setPinHash');

for (const owner of ['A', 'B']) test(`${owner} cold login routes by native service after committed write loses catalog acknowledgement`, async () => {
  const f = fixture({ owner });
  const other = JSON.stringify(f.state.account.allAccounts.find(a => a.appId !== owner));
  const credentials = JSON.stringify([...f.records]);
  await f.run();
  const failure = f.actions.find(a => a.type === 'credsAuthenticatedError' && a.payload);
  assert.equal(failure, undefined, failure?.payload?.stack);
  assert.deepEqual(f.opens, [owner === 'A' ? 'keeper.realm' : 'B.realm']);
  assert.deepEqual(updates(f).map(a => ({ ...a.payload })), [{ newHash: 'new-' + owner, appId: owner }]);
  assert.equal(f.state.account.allAccounts.find(a => a.appId === owner).hash, 'new-' + owner);
  assert.equal(JSON.stringify(f.state.account.allAccounts.find(a => a.appId !== owner)), other);
  assert.equal(JSON.stringify([...f.records]), credentials);
  assert.equal(f.state.wallet.retained, 'A-cache');
  assert.ok(f.actions.some(a => a.type === 'credsAuthenticated' && a.payload === true));
});

test('old PIN after native replacement cannot open Realm or update catalog', async () => {
  const f = fixture({ hash: 'old-B' }); await f.run();
  assert.deepEqual(f.opens, []); assert.deepEqual(updates(f), []); assert.equal(publishesKey(f), false);
});
for (const options of [{ openFails: true }, { realmOwner: 'A' }])
  test(`failed or foreign Realm refuses owner reconciliation: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await f.run();
    assert.deepEqual(updates(f), []); assert.equal(publishesKey(f), false);
    assert.ok(f.actions.some(a => a.type === 'credsAuthenticated' && a.payload === false));
  });
for (const boundary of ['onRead', 'onOpen']) for (const change of ['session', 'realmId', 'accountIdentifier', 'hash', 'remove'])
  test(`${change} change during ${boundary} suppresses stale login and metadata reconciliation`, async () => {
    let changed = false;
    const f = fixture({ [boundary](c, service) {
      if (changed || (boundary === 'onRead' && service !== 'service-B')) return;
      changed = true;
      if (change === 'session') c.changeSession();
      else if (change === 'remove') c.state.account.allAccounts = c.state.account.allAccounts.filter(a => a.appId !== 'B');
      else c.state.account.allAccounts = c.state.account.allAccounts.map(a => a.appId === 'B' ? { ...a, [change]: 'changed' } : a);
    } });
    await f.run(); assert.deepEqual(updates(f), []); assert.equal(publishesKey(f), false);
    assert.equal(f.actions.some(a => a.type === 'setAppId'), false);
  });
test('ambiguous catalog service identity cannot open a Realm', async () => {
  const f = fixture(); f.state.account.allAccounts.push({ ...f.state.account.allAccounts[1], appId: 'C' });
  await f.run(); assert.deepEqual(f.opens, []); assert.deepEqual(updates(f), []);
});
test('legacy default-service lookup retains absence of catalog owner', async () => {
  const f = fixture({ legacy: true, owner: 'A' });
  const result = await f.api.fetch('new-A');
  assert.equal(result.encryptedKey, 'wrap-A'); assert.equal(result.account, undefined);
  assert.deepEqual(f.reads, [undefined]);
});
test('unknown biometric account cannot read the default credential service', async () => {
  const f = fixture(); const result = await f.api.verifyBiometricAuth('synthetic', 'UNKNOWN');
  assert.equal(result.success, false); assert.deepEqual(f.reads, []);
});
for (const owner of ['A', 'B']) test(`${owner} biometric login retains native credential owner after stale catalog hash`, async () => {
  const f = fixture({ owner, biometric: true }); await f.run();
  assert.deepEqual(f.opens, [owner === 'A' ? 'keeper.realm' : 'B.realm']);
  assert.deepEqual(updates(f).map(a => ({ ...a.payload })), [{ newHash: 'new-' + owner, appId: owner }]);
  assert.ok(f.actions.some(a => a.type === 'credsAuthenticated' && a.payload === true));
});
test('rejected biometric signature cannot open Realm or reconcile catalog', async () => {
  const f = fixture({ biometric: true, signatureAccepted: false }); await f.run();
  assert.deepEqual(f.opens, []); assert.deepEqual(updates(f), []); assert.equal(publishesKey(f), false);
});
