const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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
