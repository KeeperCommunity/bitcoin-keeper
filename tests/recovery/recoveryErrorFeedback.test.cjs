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
      node.arguments[0]?.getText(source).includes('if (appImageError && isRecovery)'))
    callback = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(callback, 'Production recovery error feedback effect exists');
const code = ts.transpileModule(`(${callback})()`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
}).outputText;
const seed = require('../../src/context/Localization/language/en.json').seed;

function feedback(appImageError, recoveryDiscovery = { status: 'idle', source: 'protected' }, isRecovery = true) {
  const observed = { loading: true, invalid: false, network: false, messages: [], actions: [] };
  vm.runInNewContext(code, {
    appImageError,
    recoveryDiscovery,
    isRecovery,
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
    assert.match(result.messages[0], /not completed/i);
    assert.match(result.messages[0], /No older copy was selected automatically/i);
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


test('typed read errors keep the provenance modal as the only error surface', () => {
  const result = feedback('Network Error', { status: 'read-error', source: 'protected' });
  assert.equal(result.invalid, false);
  assert.equal(result.network, false);
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.actions, [{ type: 'setAppImageError', payload: '' }]);
});

test('non-recovery seed entry does not show protected backup errors', () => {
  const result = feedback('Network Error', { status: 'read-error', source: 'protected' }, false);
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.actions, []);
  assert.equal(result.network, false);
});

function productionExpression(name) {
  let expression;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      expression = node.initializer?.getText(source);
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(expression, `Production ${name} exists`);
  return ts.transpileModule(`(${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
}

function discoveryEffect() {
  let expression;
  function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' &&
        node.arguments[0]?.getText(source).includes("recoveryDiscovery.status === 'restored'"))
      expression = node.arguments[0].getText(source);
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(expression, 'Production typed recovery completion effect exists');
  return ts.transpileModule(`(${expression})()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
}

function discovery(recoveryDiscovery, selectedSource = 'protected', activeAppId = 'fixture-account') {
  const result = { loading: true, success: false, chooser: false, source: null, messages: [], actions: [] };
  vm.runInNewContext(discoveryEffect(), {
    recoveryDiscovery, recoveryLoading: true, isRecovery: true, activeAppId,
    appImageError: '', pendingRecoverySource: { current: selectedSource }, seed,
    React: { createElement: (type) => ({ type }) }, ToastErrorIcon: 'error-icon',
    setRecoveryLoading: (value) => { result.loading = value; },
    setRecoverySuccessModal: (value) => { result.success = value; },
    setShowRecoveryDiscovery: (value) => { result.chooser = value; },
    setRecoverySuccessSource: (value) => { result.source = value; },
    showToast: (message) => result.messages.push(message),
    dispatch: (action) => result.actions.push(action),
    resetSeedWords: () => ({ type: 'resetSeedWords' }),
    resetPasscodeTimeout: () => ({ type: 'resetPasscodeTimeout' }),
  });
  return result;
}

for (const status of ['protected-absent', 'protected-empty', 'protected-deleted', 'read-error']) {
  test(`${status} opens its explanation without fetching an older copy or clearing words`, () => {
    const result = discovery({ status, source: 'protected' });
    assert.equal(result.loading, false);
    assert.equal(result.chooser, true);
    assert.equal(result.success, false);
    assert.deepEqual(result.actions, []);
    const available = vm.runInNewContext(productionExpression('olderCopyAvailable'), {
      recoveryDiscovery: { status, source: 'protected' },
    });
    assert.equal(available, status !== 'read-error', 'read/auth errors cannot select older recovery');
  });
}

test('typed invalid mnemonic never opens the backup-source chooser before the legacy error signal arrives', () => {
  const result = discovery({ status: 'read-error', source: 'protected', error: 'Invalid mnemonic' });
  assert.equal(result.loading, false);
  assert.equal(result.chooser, false);
  assert.equal(result.success, false);
  assert.deepEqual(result.actions, []);
});

test('found-but-not-restored protected records never report recovery success', () => {
  const result = discovery({ status: 'protected-found', source: 'protected' });
  assert.equal(result.loading, true);
  assert.equal(result.success, false);
  assert.deepEqual(result.actions, []);
});

for (const source of ['protected', 'legacy-older']) {
  test(`complete ${source} restoration reports its matching current-account provenance`, () => {
    const result = discovery({ status: 'restored', source, provenance: {
      source, keeperAppId: 'fixture-account', legacyMayPredateDeletion: source === 'legacy-older',
      legacyCopiesMayRemain: true,
    } }, source);
    assert.equal(result.success, true);
    assert.equal(result.source, source);
    assert.deepEqual(result.actions, [{ type: 'resetSeedWords' }, { type: 'resetPasscodeTimeout' }]);
  });
}

for (const provenance of [undefined,
  { source: 'legacy-older', keeperAppId: 'fixture-account' },
  { source: 'protected', keeperAppId: 'other-account' }]) {
  test(`missing, stale-account or unexpected-source provenance withholds success: ${JSON.stringify(provenance)}`, () => {
    const result = discovery({ status: 'restored', source: 'protected', provenance });
    assert.equal(result.loading, false);
    assert.equal(result.success, false);
    assert.deepEqual(result.actions, [], 'entered Recovery Key is retained');
    assert.deepEqual(result.messages, [seed.recoveryIncomplete]);
  });
}

test('only the deliberate older-copy callback supplies explicit legacy confirmation', () => {
  const actions = [], pendingRecoverySource = { current: 'protected' }, ui = [];
  const callback = vm.runInNewContext(productionExpression('recoverOlderCopy'), {
    seedWords: [{ name: 'disposable' }, { name: 'fixture' }], isForgot: false,
    pendingRecoverySource,
    setShowRecoveryDiscovery: (value) => ui.push(['chooser', value]),
    setRecoveryLoading: (value) => ui.push(['loading', value]),
    dispatch: (action) => actions.push(action),
    resetRecoveryDiscovery: () => ({ type: 'resetRecoveryDiscovery' }),
    getAppImage: (primaryMnemonic, isForgot, selection) => ({
      type: 'getAppImage', primaryMnemonic, isForgot, selection,
    }),
  });
  assert.deepEqual(actions, [], 'rendering a choice must not start older recovery');
  callback();
  assert.equal(pendingRecoverySource.current, 'legacy-older');
  assert.equal(actions.length, 2);
  assert.equal(actions[1].type, 'getAppImage');
  assert.equal(actions[1].selection.source, 'legacy-older');
  assert.equal(actions[1].selection.olderCopyConfirmed, true);
  assert.deepEqual(ui, [['chooser', false], ['loading', true]]);
});


test('read-error acknowledgement says OK and only closes the explanation', () => {
  let label;
  function find(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'KeeperModal' &&
        node.attributes.properties.some((prop) => prop.name?.getText(source) === 'visible' &&
          prop.initializer?.expression?.getText(source) === 'isRecovery && showRecoveryDiscovery'))
      label = node.attributes.properties.find((prop) => prop.name?.getText(source) === 'buttonText')
        .initializer.expression.getText(source);
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(label);
  const labelCode = ts.transpileModule(`(${label})`, { compilerOptions: {
    target: ts.ScriptTarget.ES2020,
  } }).outputText;
  for (const language of ['en', 'es']) {
    const common = require(`../../src/context/Localization/language/${language}.json`).common;
    assert.equal(vm.runInNewContext(labelCode, { olderCopyAvailable: false, seed, common }), common.ok);
    assert.equal(vm.runInNewContext(labelCode, { olderCopyAvailable: true, seed, common }), seed.recoverOlderCopy);
  }
  const actions = [], ui = [];
  const close = vm.runInNewContext(productionExpression('closeRecoveryDiscovery'), {
    setShowRecoveryDiscovery: (value) => ui.push(value),
    dispatch: (action) => actions.push(action),
    resetRecoveryDiscovery: () => ({ type: 'resetRecoveryDiscovery' }),
  });
  close();
  assert.deepEqual(ui, [false]);
  assert.deepEqual(actions, [{ type: 'resetRecoveryDiscovery' }], 'acknowledgement cannot retry or select an older copy');
});
