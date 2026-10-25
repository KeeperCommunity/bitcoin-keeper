const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { runSaga } = require('redux-saga');
const { call, delay, put } = require('redux-saga/effects');
const { encryption } = require('./sagaHarness.cjs');

const file = 'src/store/sagas/utxos.ts';
const source = ts.createSourceFile(
  file, fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), ts.ScriptTarget.Latest, true
);
const names = new Set([
  'currentOriginApp', 'persistTagsForOrigin', 'persistSpendabilityForOrigin',
  'originUiAction', 'backupCommittedLabels', 'transactionLabelsWorker',
  'addLabelsWorker', 'bulkUpdateLabelsWorker', 'importLabelsWorker', 'markUTXOSpendabilityWorker',
]);
const extracted = source.statements
  .filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map((node) => node.getText(source).replace(/^export /, ''))
  .join('\n');
const code = ts.transpileModule(extracted, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;

function fixture({ consent = true, switchDuringCheck = false, switchDuringWalletRead = false, switchDuringDescriptor = false, rejectCreateAt = 0, rejectDelete = false } = {}) {
  const state = { active: 'A', reduxActive: 'A', session: 0, generation: 0, networkType: 'MAINNET', saved: [], deleted: [], uploaded: [], uiActions: [], failed: 0, consent, tags: [] };
  const walletRecord = { id: 'wallet', specs: {
    confirmedUTXOs: [{ txId: 'tx', vout: 0, spendability: 'spendable' }],
  } };
  const dbManager = {
    getObjectByIndex: () => ({ id: state.active, primarySeed: 'ab'.repeat(32) }),
    createObjectBulk: (_schema, tags) => {
      state.saved.push({ appId: state.active, tags });
      return true;
    },
    deleteObjectById: (_schema, id) => {
      state.deleted.push({ appId: state.active, id });
      return true;
    },
    getObjectById: (schema, id) => {
      if (schema === 'Tags') return state.tags.find(tag => tag.id === id);
      if (switchDuringWalletRead) state.active = 'B';
      return walletRecord;
    },
    getCollection: (schema) => schema === 'Tags' ? state.tags : [],
    updateObjectById: () => {
      state.saved.push({ appId: state.active, walletUpdated: true });
      return true;
    },
  };
  const scope = {
    call, delay, put, dbManager, console,
    currentBackupAccountSession: () => state.session,
    Realm: { UpdateMode: { All: 'all' } },
    beginBackupLocalOperation: (appId, originIntent, accountSession) => ({ appId, accountSession, originIntent }),
    commitBackupLocalOperation: (operation, write) => {
      if (operation.appId !== state.active || operation.accountSession !== state.session)
        return { committed: false };
      const previousTags = structuredClone(state.tags);
      const previousSpecs = structuredClone(walletRecord.specs);
      const added = [], deleted = [];
      let creations = 0;
      try {
        write({
          create: (schema, tag) => {
            assert.equal(schema, 'Tags');
            if (++creations === rejectCreateAt) throw Error('disposable write failure');
            const index = state.tags.findIndex(saved => saved.id === tag.id);
            if (index === -1) state.tags.push(structuredClone(tag));
            else state.tags[index] = structuredClone(tag);
            added.push(structuredClone(tag));
          },
          objectForPrimaryKey: (schema, id) => schema === 'Tags'
            ? state.tags.find(tag => tag.id === id) : walletRecord,
          delete: (tag) => {
            if (rejectDelete) throw Error('disposable delete failure');
            state.tags = state.tags.filter(saved => saved.id !== tag.id);
            deleted.push(tag.id);
          },
        });
      } catch {
        state.tags = previousTags;
        walletRecord.specs = previousSpecs;
        return { committed: false };
      }
      state.generation++;
      if (added.length) state.saved.push({ appId: state.active, tags: added });
      for (const id of deleted) state.deleted.push({ appId: state.active, id });
      if (JSON.stringify(walletRecord.specs) !== JSON.stringify(previousSpecs))
        state.saved.push({ appId: state.active, walletUpdated: true });
      return { committed: true, intent: { ...operation, generation: state.generation } };
    },
    enqueueAutomaticBackupOperation: async (commit, mutations) => {
      if (switchDuringCheck) {
        state.active = 'B';
        state.reduxActive = 'B';
        state.session++;
      }
      if (!state.consent || commit.intent.appId !== state.active ||
          commit.intent.accountSession !== state.session)
        return { updated: false, backupPending: true };
      for (const mutation of mutations) {
        assert.equal(mutation.operation, 'modifyLabels');
        state.uploaded.push({
          appId: mutation.body.appId,
          added: mutation.body.addLabels,
          removed: mutation.body.deleteLabels,
        });
      }
      return { updated: true, backupConfirmed: true };
    },
    store: { getState: () => ({ storage: { appId: state.reduxActive }, settings: { bitcoinNetworkType: state.networkType } }) },
    RealmSchema: { KeeperApp: 'KeeperApp', Tags: 'Tags', Wallet: 'Wallet', Vault: 'Vault' },
    LabelRefType: { TXN: 'TXN', ADDR: 'ADDR', OUTPUT: 'OUTPUT' },
    EntityKind: { VAULT: 'VAULT' },
    generateAbbreviatedOutputDescriptors: () => {
      if (switchDuringDescriptor) state.networkType = 'TESTNET';
      return 'disposable-origin';
    },
    ...encryption,
    getJSONFromRealmObject: (value) => structuredClone(value),
    Relay: { modifyLabels: async (appId, added, removed) => {
      state.uploaded.push({ appId, added, removed });
      return { updated: true };
    } },
    checkBackupCondition: function* (appId) {
      assert.equal(appId, 'A');
      if (switchDuringCheck) {
        state.active = 'B';
        state.reduxActive = 'B';
      }
      return !state.consent;
    },
    setServerBackupFailed: function* (appId) {
      assert.equal(appId, 'A');
      state.failed++;
    },
    updateAppImageWorker: function* () { throw Error('unexpected backup'); },
    updateVaultImageWorker: function* () { throw Error('unexpected backup'); },
    setSyncingUTXOs: (value) => ({ type: 'sync', value }),
    setSyncingUTXOError: (value) => ({ type: 'error', value }),
    resetState: () => ({ type: 'reset' }),
  };
  vm.runInNewContext(code, scope);
  const run = (name, payload, originAppId = 'A', metadata = {}) => runSaga(
    { dispatch: (action) => state.uiActions.push({ ...action, active: state.active }),
      getState: () => ({}) }, scope[name], { payload, originAppId, ...metadata }
  ).toPromise();
  return { state, run };
}

const wallet = { id: 'wallet', entityKind: 'WALLET' };
const add = { txId: 'tx', wallet, labels: [{ name: 'note', isSystem: false }], type: 'TXN' };

test('an A label action starting after switch to B writes neither Realm nor relay', async () => {
  const f = fixture();
  f.state.active = 'B';
  f.state.reduxActive = 'B';
  await f.run('addLabelsWorker', add);
  assert.deepEqual(f.state.saved, []);
  assert.deepEqual(f.state.uploaded, []);
});

test('Redux account B with A Realm still open cannot persist A labels', async () => {
  const f = fixture();
  f.state.reduxActive = 'B';
  await f.run('addLabelsWorker', add);
  assert.deepEqual(f.state.saved, []);
  assert.deepEqual(f.state.uploaded, []);
});

test('switch during connectivity check leaves A local label and makes no B upload', async () => {
  const f = fixture({ switchDuringCheck: true });
  await f.run('addLabelsWorker', add);
  assert.equal(f.state.saved.length, 1);
  assert.equal(f.state.saved[0].appId, 'A');
  assert.deepEqual(f.state.uploaded, []);
  assert.equal(f.state.failed, 0);
  assert.ok(f.state.uiActions.filter((action) => action.active === 'B').every(
    (action) => action.originAppId === 'A'
  ));
});

test('unconsented A can label locally with zero backup upload', async () => {
  const f = fixture({ consent: false });
  await f.run('importLabelsWorker', { labels: [{ type: 'TX', ref: 'tx', label: 'note', origin: 'fixture' }] });
  assert.equal(f.state.saved[0].appId, 'A');
  assert.deepEqual(f.state.uploaded, []);
});

test('network switch before scoped label persistence writes neither Realm nor relay', async () => {
  const f = fixture({ switchDuringDescriptor: true });
  await f.run('bulkUpdateLabelsWorker', {
    labelChanges: { added: [{ name: 'note', isSystem: false }], deleted: [] },
    UTXO: { txId: 'tx', vout: 0 },
    wallet: { ...wallet, networkType: 'MAINNET' },
    scope: { appId: 'A', networkType: 'MAINNET' },
  });
  assert.deepEqual(f.state.saved, []);
  assert.deepEqual(f.state.uploaded, []);
});

test('UTXO spendability cannot persist into B after an A action waits for Realm', async () => {
  const f = fixture({ switchDuringWalletRead: true });
  await f.run('markUTXOSpendabilityWorker', {
    wallet, txId: 'tx', vout: 0, spendability: 'doNotSpend',
  });
  assert.equal(f.state.active, 'B');
  assert.deepEqual(f.state.saved, []);
  assert.deepEqual(f.state.uploaded, []);
});

test('a failed multi-label import rolls back the complete local batch and queues nothing', async () => {
  const f = fixture({ rejectCreateAt: 2 });
  await f.run('importLabelsWorker', { labels: [
    { type: 'TX', ref: 'first', label: 'one', origin: 'fixture' },
    { type: 'TX', ref: 'second', label: 'two', origin: 'fixture' },
  ] });
  assert.deepEqual(f.state.tags, []);
  assert.deepEqual(f.state.saved, []);
  assert.deepEqual(f.state.uploaded, []);
  assert.equal(f.state.generation, 0);
});

test('a failed removal rolls back label additions and preserves the existing label', async () => {
  const f = fixture({ rejectDelete: true });
  const existing = { id: 'txold', label: 'old', ref: 'tx', type: 'TXN', origin: 'fixture', isSystem: false };
  f.state.tags.push(existing);
  await f.run('bulkUpdateLabelsWorker', {
    txId: 'tx', wallet,
    labelChanges: { added: [{ name: 'new', isSystem: false }], deleted: [{ name: 'old', isSystem: false }] },
  });
  assert.deepEqual(f.state.tags, [existing]);
  assert.deepEqual(f.state.saved, []);
  assert.deepEqual(f.state.uploaded, []);
});

test('overlapping label edit queues only the deletion matching the committed local image', async () => {
  const f = fixture();
  const change = { name: 'same', isSystem: false };
  await f.run('bulkUpdateLabelsWorker', {
    txId: 'tx', wallet, labelChanges: { added: [change], deleted: [change] },
  });
  assert.deepEqual(f.state.tags, []);
  assert.equal(f.state.generation, 1);
  assert.equal(f.state.uploaded.length, 1);
  assert.equal(f.state.uploaded[0].added.length, 0);
  const key = encryption.generateEncryptionKey('ab'.repeat(32));
  assert.deepEqual(Array.from(f.state.uploaded[0].removed), [encryption.hash256(encryption.hash256(key + 'txsame'))]);
});

test('send note and inherited change-output labels share one atomic local operation and one encrypted mutation', async () => {
  const f = fixture();
  f.state.tags.push({ id: 'input:0salary', ref: 'input:0', label: 'salary', isSystem: false });
  await f.run('transactionLabelsWorker', {
    txId: 'sent', wallet: { ...wallet, specs: { addresses: { internal: { 0: 'change-address' } } } },
    note: 'transaction note', finalOutputs: [{ address: 'recipient' }, { address: 'change-address' }],
    inputs: [{ txId: 'input', vout: 0 }],
  });
  assert.equal(f.state.generation, 1);
  assert.equal(f.state.saved.length, 1);
  assert.equal(f.state.saved[0].tags.length, 3);
  assert.equal(f.state.uploaded.length, 1);
  const key = encryption.generateEncryptionKey('ab'.repeat(32));
  const tags = Array.from(f.state.uploaded[0].added, row => {
    const tag = JSON.parse(encryption.decrypt(key, row.content));
    assert.equal(row.id, encryption.hash256(encryption.hash256(key + tag.id)));
    assert.deepEqual(tag, f.state.tags.find(saved => saved.id === tag.id));
    return tag;
  });
  assert.deepEqual(tags.map(tag => tag.id).sort(), ['sent:1Change', 'sent:1salary', 'senttransaction note']);
});

test('old A session send labels cannot commit after A to B to A', async () => {
  const f = fixture();
  f.state.session = 2;
  await f.run('transactionLabelsWorker', { txId: 'sent', wallet, note: 'old session' }, 'A', {
    originBackupAccountSession: 0,
  });
  assert.equal(f.state.generation, 0);
  assert.deepEqual(f.state.tags, []);
  assert.deepEqual(f.state.uploaded, []);
});

test('an empty transaction note with no change output commits and queues nothing', async () => {
  const f = fixture();
  await f.run('transactionLabelsWorker', { txId: 'sent', wallet, note: '' });
  assert.equal(f.state.generation, 0);
  assert.deepEqual(f.state.tags, []);
  assert.deepEqual(f.state.uploaded, []);
});
