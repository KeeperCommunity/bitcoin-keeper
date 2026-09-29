const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = 'src/screens/Recovery/EnterSeedScreen.tsx';
const source = ts.createSourceFile(file,
  fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' &&
      node.arguments[1]?.getText(source) === '[appImageError]')
    callback = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, 'Production recovery error feedback effect exists');
const code = ts.transpileModule(`(${callback})()`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText;
const seed = require('../../src/context/Localization/language/en.json').seed;

function feedback(appImageError) {
  const observed = { loading: true, invalid: false, network: false, messages: [], actions: [] };
  vm.runInNewContext(code, {
    appImageError,
    seed,
    React: { createElement: (type) => ({ type }) },
    ToastErrorIcon: 'error-icon',
    dispatch: (action) => observed.actions.push(action),
    setAppImageError: (payload) => ({ type: 'setAppImageError', payload }),
    setRecoveryLoading: (value) => { observed.loading = value; },
    setShowNetworkModal: (value) => { observed.network = value; },
    openInvalidSeedsModal: () => { observed.loading = false; observed.invalid = true; },
    showToast: (message) => observed.messages.push(message),
  });
  return observed;
}

test('invalid mnemonic retains the invalid Recovery Key feedback', () => {
  const result = feedback('Invalid mnemonic');
  assert.equal(result.invalid, true);
  assert.equal(result.loading, false);
  assert.equal(result.network, false);
  assert.deepEqual(result.messages, []);
});

test('network error stops recovery and retains the existing network modal', () => {
  const result = feedback('Network Error');
  assert.equal(result.network, true);
  assert.equal(result.loading, false);
  assert.equal(result.invalid, false);
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.actions, [{ type: 'setAppImageError', payload: '' }]);
});

for (const error of ['Recovery data unavailable', 'Incomplete backup response',
  'Invalid backup record', 'Backup request could not be completed']) {
  test(`${error} offers retry without blaming the Recovery Key or clearing entered words`, () => {
    const result = feedback(error);
    assert.equal(result.loading, false);
    assert.equal(result.invalid, false);
    assert.equal(result.network, false);
    assert.deepEqual(result.messages, [seed.recoveryIncomplete]);
    assert.match(result.messages[0], /try again/i);
    assert.doesNotMatch(result.messages[0], /invalid (seed|mnemonic|recovery key)/i);
    assert.deepEqual(result.actions, [{ type: 'setAppImageError', payload: '' }]);
  });
}

test('empty recovery error does not interrupt loading or display an error', () => {
  const result = feedback('');
  assert.equal(result.loading, true);
  assert.equal(result.invalid, false);
  assert.equal(result.network, false);
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.actions, []);
});
