const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const semver = require('semver');
const { runSaga } = require('redux-saga');
const { call, put, select } = require('redux-saga/effects');
const { encryption } = require('./helpers.cjs');
const plain = (value) => JSON.parse(JSON.stringify(value));
const writeIntent = Object.freeze({ appId: 'A', accountSession: 7,
  baseRevision: 'a'.repeat(64), baselineEpoch: 0 });
const source = ts.createSourceFile('upgrade.ts',
  fs.readFileSync(path.join(__dirname, '../../src/store/sagas/upgrade.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const declarations = source.statements.filter((node) =>
  ts.isFunctionDeclaration(node) || (ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((value) => value.name.getText(source) === 'upgradeAccountIsActive')));
const code = ts.transpileModule(declarations.map((node) => node.getText(source).replace(/^export /, '')).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

// Producer/account tests only: the separate native Realm/HTTP Relay fixture
// proves commit-generation, atomic rollback, encrypted CAS and readback itself.
// AES, key derivation for encryption and hashing here are production primitives.
function fixture() {
  const state = { appId: 'A', session: 7, actions: [], queued: [], events: [], commits: 0,
    failSchema: null, topics: [], records: {
      KeeperApp: [{ id: 'A', primarySeed: 'ab'.repeat(32), version: '2.5.16' }],
      Wallet: [{ id: 'wallet' }], Signer: [], Tags: [], VersionHistory: [], VaultSigner: [],
      Vault: [{ id: 'vault', archived: false }, { id: 'old-vault', archived: true }],
      UTXOInfo: [{ walletId: 'wallet', txId: 'tx', vout: 0, labels: [{ name: 'note' }] }],
    } };
  const rawRealm = {
    objectForPrimaryKey(schema, id) { return state.records[schema].find((value) => value.id === id); },
    objects(schema) { return state.records[schema]; },
    create(schema, value) {
      if (state.failSchema === schema) throw Error('disposable local transaction failure');
      const rows = state.records[schema];
      const primary = schema === 'VersionHistory' ? 'version' : 'id';
      const existing = rows.findIndex((row) => row[primary] === value[primary]);
      if (existing >= 0) rows[existing] = plain(value);
      else rows.push(plain(value));
    },
  };
  const dbManager = {
    getObjectByIndex: () => state.records.KeeperApp[0],
    getCollection: (schema) => plain(state.records[schema]),
  };
  const scope = {
    call, put, select, semver, dbManager, Realm: { UpdateMode: { Modified: 'modified' } },
    RealmSchema: Object.fromEntries(Object.keys(state.records).map((schema) => [schema, schema])),
    store: { getState: () => ({ storage: { appId: state.appId } }) },
    currentBackupAccountSession: () => state.session,
    notifyBackupReconciliation: () => state.events.push('pending'),
    LABELS_INTRODUCTION_VERSION: '1.0.4', BIP329_INTRODUCTION_VERSION: '1.0.7',
    KEY_MANAGEMENT_VERSION: '1.1.9', APP_KEY_UPGRADE_VERSION: '1.1.12',
    HEALTH_CHECK_TIMELINE_MIGRATION_VERSION: '1.2.6', SIGNER_POLICY_MIGRATION_VERSION: '2.1.0',
    beginBackupLocalOperation(appId, intent, session) { return { appId, intent, session }; },
    commitBackupLocalOperation(operation, write) {
      if (operation.appId !== state.appId || operation.session !== state.session)
        return { committed: false };
      const previous = plain(state.records);
      try { write(rawRealm); } catch {
        state.records = previous;
        state.events.push('rollback');
        return { committed: false };
      }
      state.commits++;
      state.events.push('commit');
      return Object.freeze({ committed: true, intent: operation.intent });
    },
    async enqueueAutomaticBackupOperation(receipt, mutations) {
      state.events.push('queue');
      state.queued.push({ receipt, mutations: plain(mutations), local: plain(state.records) });
      return { updated: true, backupConfirmed: !!receipt.intent, backupPending: !receipt.intent };
    },
    buildAutomaticAppMutation(payload, appId) {
      const app = state.records.KeeperApp[0];
      return { operation: 'updateAppImage', body: { appId, version: app.version,
        wallets: plain(payload.wallets), signers: plain(payload.signers) } };
    },
    buildAutomaticVaultMutation(id, appId) {
      return { operation: 'updateVaultImage', body: { appId,
        vault: plain(state.records.Vault.find((value) => value.id === id)) } };
    },
    DeviceInfo: { getBuildNumber: () => '1' },
    getApp: () => ({}), getMessaging: () => ({}),
    unsubscribeFromTopic: (_messaging, topic) => state.topics.push(['old', topic]),
    subscribeToTopic: (_messaging, topic) => state.topics.push(['new', topic]),
    getReleaseTopic: (version) => version,
    setAppVersion: (version) => ({ type: 'setAppVersion', version }),
    generateAbbreviatedOutputDescriptors: () => 'disposable-origin',
    LabelRefType: { OUTPUT: 'OUTPUT' }, ...encryption,
    SignerType: { KEEPER: 'KEEPER', MOBILE_KEY: 'MOBILE_KEY', MY_KEEPER: 'MY_KEEPER', POLICY_SERVER: 'POLICY_SERVER' },
    XpubTypes: { P2WSH: 'P2WSH' },
    hcStatusType: { HEALTH_CHECK_SUCCESSFULL: 'HEALTH_CHECK_SUCCESSFULL' },
    captureError() {},
  };
  vm.runInNewContext(code, scope);
  const run = (name, ...args) => runSaga({
    getState: () => ({ storage: { appId: state.appId }, settings: {}, bhr: {} }),
    dispatch: (action) => state.actions.push(plain(action)),
  }, scope[name], ...args).toPromise();
  return { state, scope, dbManager, run };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const versionAction = { originAppId: 'A', originBackupAccountSession: 7, originBackupWriteIntent: writeIntent,
  payload: { previousVersion: '2.5.16', newVersion: '2.5.17', isRecovery: true } };

test('launch upgrade commits all migrations and version once before one original-intent queue', async () => {
  const f = fixture();
  assert.equal(await f.run('applyUpgradeSequence', {
    previousVersion: '1.0.5', newVersion: '2.5.17', originBackupAccountSession: 7,
    originBackupWriteIntent: writeIntent,
  }), true);
  assert.equal(f.state.commits, 1);
  assert.deepEqual(f.state.events, ['commit', 'queue']);
  assert.equal(f.state.queued.length, 1);
  const queued = f.state.queued[0];
  assert.equal(queued.receipt.intent, writeIntent);
  assert.equal(queued.local.KeeperApp[0].version, '2.5.17');
  assert.equal(queued.local.VersionHistory.length, 1);
  assert.equal(queued.local.Tags.length, 1);
  assert.deepEqual(queued.mutations.map((value) => value.operation),
    ['updateAppImage', 'updateVaultImage', 'updateVaultImage', 'modifyLabels']);
  assert.equal(queued.mutations[2].body.vault.archived, true);
  assert.deepEqual(f.state.actions, [{ type: 'setAppVersion', version: '2.5.17' }]);
});

test('paused launch upgrade stops after A to B to A without any local commit or queue', async () => {
  const f = fixture();
  const entered = deferred(), resume = deferred();
  const getCollection = f.dbManager.getCollection;
  f.dbManager.getCollection = (schema) => {
    if (schema === 'UTXOInfo') { entered.resolve(); return resume.promise; }
    return getCollection(schema);
  };
  const pending = f.run('applyUpgradeSequence', { previousVersion: '1.0.5', newVersion: '2.5.17' });
  await entered.promise;
  f.state.appId = 'B'; f.state.session = 8;
  f.state.appId = 'A'; f.state.session = 9;
  resume.resolve(getCollection('UTXOInfo'));
  assert.equal(await pending, false);
  assert.equal(f.state.commits, 0);
  assert.deepEqual(f.state.queued, []);
  assert.deepEqual(f.state.actions, []);
});

test('a caller original session is rejected before upgrade after A to B to A', async () => {
  const f = fixture();
  f.state.session = 9;
  assert.equal(await f.run('applyUpgradeSequence', { previousVersion: '1.0.5', newVersion: '2.5.17',
    originBackupAccountSession: 7 }), false);
  assert.equal(await f.run('updateVersionHistoryWorker', versionAction), false);
  assert.equal(f.state.commits, 0);
  assert.deepEqual(f.state.queued, []);
});

test('version update persists the new KeeperApp version before queue and preserves recovery history', async () => {
  const f = fixture();
  assert.equal(await f.run('updateVersionHistoryWorker', versionAction), true);
  assert.deepEqual(f.state.events, ['commit', 'queue']);
  const queued = f.state.queued[0];
  assert.equal(queued.receipt.intent, writeIntent);
  assert.equal(queued.local.KeeperApp[0].version, '2.5.17');
  assert.equal(queued.mutations[0].body.version, '2.5.17');
  assert.deepEqual(f.state.records.VersionHistory, []);
});

test('version history failure rolls back the version and never queues a cloud operation', async () => {
  const f = fixture();
  f.state.failSchema = 'VersionHistory';
  assert.equal(await f.run('updateVersionHistoryWorker', {
    ...versionAction, payload: { ...versionAction.payload, isRecovery: false },
  }), false);
  assert.equal(f.state.records.KeeperApp[0].version, '2.5.16');
  assert.deepEqual(f.state.records.VersionHistory, []);
  assert.deepEqual(f.state.events, ['rollback']);
  assert.deepEqual(f.state.queued, []);
  assert.deepEqual(f.state.topics, []);
});

test('migrated label ciphertext encodes the committed tag with production AES and hashed label ID', async () => {
  const f = fixture();
  await f.run('migrateLablesWorker', { originAppId: 'A', originBackupAccountSession: 7,
    originBackupWriteIntent: writeIntent });
  const queued = f.state.queued[0];
  assert.equal(queued.receipt.intent, writeIntent);
  const label = queued.mutations[0].body.addLabels[0];
  const key = encryption.generateEncryptionKey(f.state.records.KeeperApp[0].primarySeed);
  assert.equal(label.id, encryption.hash256(encryption.hash256(key + f.state.records.Tags[0].id)));
  assert.deepEqual(JSON.parse(encryption.decrypt(key, label.content)), f.state.records.Tags[0]);
  assert.notEqual(label.content, JSON.stringify(f.state.records.Tags[0]));
  assert.deepEqual(f.state.events, ['commit', 'queue']);
});

test('paused label migration stops after A to B to A before committing staged tags', async () => {
  const f = fixture();
  const entered = deferred(), resume = deferred();
  const getCollection = f.dbManager.getCollection;
  f.dbManager.getCollection = (schema) => {
    if (schema === 'UTXOInfo') { entered.resolve(); return resume.promise; }
    return getCollection(schema);
  };
  const pending = f.run('migrateLablesWorker', { originAppId: 'A', originBackupAccountSession: 7,
    originBackupWriteIntent: writeIntent });
  await entered.promise;
  f.state.appId = 'B'; f.state.session = 8;
  f.state.appId = 'A'; f.state.session = 9;
  resume.resolve(getCollection('UTXOInfo'));
  assert.equal(await pending, false);
  assert.equal(f.state.commits, 0);
  assert.deepEqual(f.state.records.Tags, []);
  assert.deepEqual(f.state.queued, []);
});

test('a missing original verification baseline never gets recaptured by an upgrade producer', async () => {
  const f = fixture();
  await f.run('updateVersionHistoryWorker', { ...versionAction, originBackupWriteIntent: undefined });
  assert.equal(f.state.records.KeeperApp[0].version, '2.5.17');
  assert.equal(f.state.queued[0].receipt.intent, undefined);
});

test('cloud payload preparation failure preserves the committed local upgrade and marks pending', async () => {
  const f = fixture();
  f.scope.buildAutomaticAppMutation = () => { throw Error('disposable payload preparation failure'); };
  assert.equal(await f.run('updateVersionHistoryWorker', versionAction), true);
  assert.equal(f.state.records.KeeperApp[0].version, '2.5.17');
  assert.deepEqual(f.state.events, ['commit', 'pending']);
  assert.deepEqual(f.state.queued, []);
});
