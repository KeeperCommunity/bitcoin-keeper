const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { runSaga } = require('redux-saga');
const { call, put, select } = require('redux-saga/effects');

const root = path.join(__dirname, '../..');
function sourceFile(file) {
  return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function declarations(file, names) {
  const source = sourceFile(file);
  const matches = [];
  const walk = (node) => {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(source)))
      matches.push(`const ${node.getText(source)};`);
    ts.forEachChild(node, walk);
  };
  walk(source);
  return matches;
}

const code = ts.transpileModule([
  ...declarations('src/store/store.ts', [
    'accountOwnedActions', 'accountOwnedUtxoUiActions', 'bindActionOrigin',
  ]),
  ...declarations('src/store/sagaActions/send_and_receive.ts', [
    'SEND_PHASE_TWO', 'SEND_PHASE_THREE', 'DISCARD_BROADCASTED_TNX',
    'sendPhaseTwo', 'sendPhaseThree', 'discardBroadcastedTnx',
  ]),
  ...declarations('src/store/sagaActions/utxos.ts', ['IMPORT_LABELS', 'importLabels']),
  ...declarations('src/components/ImportExportLabels/index.tsx', ['handleImportLabels']),
  'globalThis.actions = { bindActionOrigin, sendPhaseTwo, sendPhaseThree, discardBroadcastedTnx, importLabels, handleImportLabels };',
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const scope = {
  Set,
  dbManager: { getObjectByIndex: () => ({ id: 'B' }) },
  RealmSchema: { KeeperApp: 'KeeperApp' },
  currentBackupAccountSession: () => 0,
  captureBackupWriteIntent: () => undefined,
  originAppId: 'A',
  vault: { id: 'A-vault' },
  generateAbbreviatedOutputDescriptors: () => 'descriptor',
  setIsSyncingLabels: () => {},
  onError: (error) => { throw Error(error); },
  onSuccess: () => {},
  console,
};
vm.runInNewContext(code, scope);

test('a delayed A send action keeps A as origin when dispatched on B', () => {
  const { bindActionOrigin, sendPhaseTwo, sendPhaseThree, discardBroadcastedTnx } = scope.actions;
  const middleware = bindActionOrigin({ getState: () => ({ storage: { appId: 'B' } }) });
  const seen = [];
  const dispatch = middleware((action) => { seen.push(action); return action; });
  dispatch(sendPhaseTwo({ wallet: { id: 'A-wallet' } }, 'A'));
  dispatch(sendPhaseThree({ wallet: { id: 'A-vault' } }, 'A'));
  dispatch(discardBroadcastedTnx({ cachedTxid: 'tx', vault: { id: 'A-vault' } }, 'A'));
  dispatch({ type: 'utxos/setSyncingUTXOs', payload: false, originAppId: 'A' });
  assert.equal(seen.length, 3);
  assert.ok(seen.every((action) => action.originAppId === 'A'));
});

test('send screens pass their captured owner to label-bearing actions', () => {
  for (const [file, actionName] of [
    ['src/screens/Send/SendConfirmation.tsx', 'sendPhaseTwo'],
    ['src/screens/SignTransaction/SignTransactionScreen.tsx', 'sendPhaseThree'],
    ['src/screens/Vault/VaultDetails.tsx', 'discardBroadcastedTnx'],
  ]) {
    const source = sourceFile(file);
    const calls = [];
    const walk = (node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === actionName)
        calls.push(node);
      ts.forEachChild(node, walk);
    };
    walk(source);
    assert.ok(calls.length, `${file} should dispatch ${actionName}`);
    assert.ok(calls.every((call) => call.arguments[1]?.getText(source) === 'originAppId'),
      `${file} must forward its captured owner`);
  }
});

test('a file import callback from A keeps A after the active account switches to B', async () => {
  const seen = [];
  const middleware = scope.actions.bindActionOrigin({
    getState: () => ({ storage: { appId: 'B' } }),
  });
  scope.dispatch = middleware((action) => { seen.push(action); return action; });
  scope.importFile = async (onFile) => onFile(JSON.stringify({
    type: 'tx', ref: 'txid', label: 'note', origin: 'descriptor',
  }));
  await scope.actions.handleImportLabels();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].type, 'IMPORT_LABELS');
  assert.equal(seen[0].originAppId, 'A');
});

test('an async label import from an old A session cannot rebase after A to B to A', async () => {
  let session = 3;
  let completeImport;
  const seen = [];
  const errors = [];
  scope.currentBackupAccountSession = () => session;
  scope.captureBackupWriteIntent = (appId) => ({
    appId, accountSession: session, baseRevision: 'a'.repeat(64), baselineEpoch: 0,
  });
  scope.onError = (message) => errors.push(message);
  scope.dispatch = scope.actions.bindActionOrigin({
    getState: () => ({ storage: { appId: 'A' } }),
  })((action) => { seen.push(action); return action; });
  scope.importFile = (onFile) => new Promise((resolve) => {
    completeImport = async () => {
      await onFile(JSON.stringify({
        type: 'tx', ref: 'txid', label: 'note', origin: 'descriptor',
      }));
      resolve();
    };
  });
  const started = scope.actions.handleImportLabels();
  session = 5;
  await completeImport();
  await started;
  assert.deepEqual(seen, []);
  assert.equal(errors.length, 1);
});

for (const phase of ['Two', 'Three']) test(`send phase ${phase} forwards note and change output through one child operation with the original intent`, async () => {
  const source = sourceFile('src/store/sagas/send_and_receive.ts');
  const names = new Set([`sendPhase${phase}Worker`, 'handleChangeOutputLabels']);
  const extracted = source.statements
    .filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
    .map(node => node.getText(source)).join('\n');
  const labels = [];
  const finalOutputs = [{ address: 'recipient' }, { address: 'change-address' }];
  const inputs = [{ txId: 'input', vout: 0 }];
  const intent = { appId: 'A', accountSession: 7, baseRevision: 'a'.repeat(64), baselineEpoch: 3 };
  const context = {
    call, put, select, console,
    _: require('lodash'), idx: (value, getter) => getter(value),
    EntityKind: { WALLET: 'WALLET', VAULT: 'VAULT' },
    ELECTRUM_CLIENT: { isClientConnected: true },
    ELECTRUM_NOT_CONNECTED_ERR: 'offline', ELECTRUM_NOT_CONNECTED_ERR_TOR: 'tor-offline',
    WalletOperations: {
      transferST2: async () => ({ txid: 'sent', finalOutputs, inputs }),
      transferST3: async () => ({ txid: 'sent', finalOutputs, inputs }),
    },
    transactionLabelsWorker: function* (action) { labels.push(action); },
    sendPhaseTwoExecuted: payload => ({ type: 'phase-two', payload }),
    sendPhaseThreeExecuted: payload => ({ type: 'phase-three', payload }),
    setElectrumNotConnectedErr: error => ({ type: 'error', error }),
  };
  vm.runInNewContext(ts.transpileModule(extracted, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  const actions = [];
  await runSaga({
    getState: () => ({ sendAndReceive: {
      sendPhaseOne: { outputs: { txPrerequisites: {} } },
      customPrioritySendPhaseOne: { outputs: { customTxPrerequisites: {} } },
      sendPhaseTwo: { serializedPSBTEnvelops: [] },
    } }),
    dispatch: action => actions.push(action),
  }, context[`sendPhase${phase}Worker`], {
    originAppId: 'A', originBackupAccountSession: 7, originBackupWriteIntent: intent,
    payload: { wallet: { id: 'wallet', entityKind: 'WALLET' }, note: 'one note' },
  }).toPromise();
  assert.equal(actions[0].payload.successful, true);
  assert.equal(labels.length, 1);
  assert.equal(labels[0].originAppId, 'A');
  assert.equal(labels[0].originBackupAccountSession, 7);
  assert.equal(labels[0].originBackupWriteIntent, intent);
  assert.equal(labels[0].payload.note, 'one note');
  assert.equal(labels[0].payload.finalOutputs, finalOutputs);
  assert.equal(labels[0].payload.inputs, inputs);
});
