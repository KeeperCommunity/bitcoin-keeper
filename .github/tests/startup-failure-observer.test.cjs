'use strict';
// Execute actual production TS boundaries with synthetic native/store inputs only.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const helperPath = 'src/storage/startup-failure-observer.ts';

function compile(source, extra = {}) {
  const context = { exports: {}, global: {}, __DEV__: true,
    console: new Proxy({}, { get() { throw new Error('Console must not be used'); } }), ...extra };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  } }).outputText, context);
  return context;
}
function helper(extra) { return compile(fs.readFileSync(path.join(root, helperPath), 'utf8'), extra); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function store({ getState = () => ({ account: { allAccounts: [] } }), read, observer } = {}) {
  const observed = [], calls = [], h = helper();
  const context = compile(fs.readFileSync(path.join(root, 'src/storage/secure-store.ts'), 'utf8'), {
    require(name) {
      if (name === 'react-native-keychain') return { getGenericPassword(options) { calls.push(options); return read(options); } };
      if (name === 'src/store/store') return { store: { getState } };
      if (name === './startup-failure-observer') return h.exports;
      if (name === 'node-rsa') return function NodeRSA() {};
      if (name === '../utils/service-utilities/config') return {};
      throw new Error('Unexpected synthetic require');
    },
  });
  return { call: (options = { throwOnError: true }, observe = observer || (row => observed.push(plain(row)))) =>
    context.exports.hasPin(options, observe), observed, calls, raw: context.exports.hasPin };
}

test('existing native call arguments/count/results are unchanged and successes emit nothing', async () => {
  const f = store({ getState: () => ({ account: { allAccounts: [
    { accountIdentifier: '' }, { accountIdentifier: 'synthetic-second-account' },
  ] } }), read: options => Promise.resolve(options.service ? { password: '{"hash":"synthetic"}' } : false) });
  assert.equal(await f.call(), true);
  assert.deepEqual(plain(f.calls), [{}, { service: 'synthetic-second-account' }]);
  assert.equal(Object.hasOwn(f.calls[0], 'service'), true);
  assert.equal(f.calls[0].service, undefined);
  assert.deepEqual(f.observed, []);
  const empty = store({ read: () => Promise.resolve(false) });
  assert.equal(await empty.call(), false); assert.equal(empty.calls.length, 1);
  assert.deepEqual(empty.observed, []);
});

test('account state, synchronous native throw, native rejection and JSON failure remain distinct', async () => {
  const error = Object.assign(new Error('PRIVATE_SENTINEL'), { code: '-34018' });
  for (const [phase, outcome, settings, code] of [
    ['ACCOUNT_STATE', 'THREW', { getState() { throw error; } }, null],
    ['NATIVE_CREDENTIAL_READ', 'THREW', { read() { throw error; } }, null],
    ['NATIVE_CREDENTIAL_READ', 'REJECTED', { read: () => Promise.reject(error) }, -34018],
  ]) {
    const f = store(settings);
    await assert.rejects(f.call(), caught => caught === error);
    assert.deepEqual(f.observed, [{ phase, outcome, errorName: 'Error', nativeCode: code }]);
    assert.equal(f.calls.length, phase === 'ACCOUNT_STATE' ? 0 : 1);
    assert.equal(JSON.stringify(f.observed).includes('PRIVATE_SENTINEL'), false);
  }
  const json = store({ read: () => Promise.resolve({ password: 'PRIVATE_SENTINEL' }) });
  await assert.rejects(json.call(), error => error.name === 'SyntaxError');
  assert.deepEqual(json.observed, [{ phase: 'CREDENTIAL_JSON', outcome: 'THREW', errorName: 'SyntaxError', nativeCode: null }]);
});

test('legacy false-on-error and original rejection identity survive observer/getter failures', async () => {
  let getters = 0;
  const error = {};
  Object.defineProperties(error, { name: { get() { getters++; throw new Error('PRIVATE_SENTINEL'); } },
    code: { get() { getters++; throw new Error('PRIVATE_SENTINEL'); } } });
  const f = store({ read: () => Promise.reject(error), observer() { throw new Error('PRIVATE_OBSERVER'); } });
  await assert.rejects(f.call(), caught => caught === error);
  assert.equal(await f.call({ throwOnError: false }), false);
  assert.equal(f.calls.length, 2);
  const before = getters;
  await assert.rejects(f.raw({ throwOnError: true }), caught => caught === error);
  assert.equal(getters, before); // No observer means no error-property inspection.
});

test('only canonical decimal int32 codes at native rejection are retained without coercion', () => {
  const { reportStartupFailure } = helper().exports;
  for (const [code, expected] of [['-2147483648', -2147483648], ['2147483647', 2147483647], ['0', 0],
    ['2147483648', null], ['-2147483649', null], ['-0', null], ['+1', null], ['01', null],
    [' 1', null], ['-34018\n', null], ['-34018\r\n', null], ['-34018\u2028', null],
    ['-34018\u2029', null], ['1e3', null], ['1.0', null], ['\u22121', null], [1, null],
    [{ toString() { throw new Error('PRIVATE_SENTINEL'); } }, null]]) {
    const rows = [];
    reportStartupFailure(row => rows.push(plain(row)), 'NATIVE_CREDENTIAL_READ', 'REJECTED', { name: 'Error', code });
    assert.equal(rows[0].nativeCode, expected);
    assert.equal(JSON.stringify(rows).includes('PRIVATE_SENTINEL'), false);
  }
  let codeRead = false;
  reportStartupFailure(() => {}, 'NAVIGATION', 'THREW', { get code() { codeRead = true; return '-34018'; } });
  assert.equal(codeRead, false);
  const rows = [];
  reportStartupFailure(row => rows.push(row), 'PRIVATE_SENTINEL', 'THREW', {});
  reportStartupFailure(row => rows.push(row), 'ACCOUNT_STATE', 'REJECTED', {});
  assert.deepEqual(rows, []);
});

test('dev-only native hook emits one fixed Error-level marker and never invokes console/LogBox', () => {
  const calls = [];
  const h = helper({ global: { nativeLoggingHook: (...args) => calls.push(args) }, Date: { now: () => 1700000000123 } });
  h.exports.reportStartupFailure(h.exports.observeStartupFailure, 'NATIVE_CREDENTIAL_READ', 'REJECTED',
    { name: 'PRIVATE_SENTINEL', code: '-34018', message: 'PRIVATE_SENTINEL', stack: 'PRIVATE_SENTINEL' });
  assert.deepEqual(calls, [['KEEPER_STARTUP_FAILURE_V1|1700000000123|NATIVE_CREDENTIAL_READ|REJECTED|OTHER|-34018', 3]]);
  const quiet = helper({ __DEV__: false, global: { nativeLoggingHook() { throw new Error('must not call'); } } });
  quiet.exports.observeStartupFailure({ phase: 'ACCOUNT_STATE', outcome: 'THREW', errorName: 'Error', nativeCode: null });
  const broken = helper({ global: Object.defineProperty({}, 'nativeLoggingHook', { get() { throw new Error('PRIVATE_SENTINEL'); } }) });
  assert.doesNotThrow(() => broken.exports.observeStartupFailure(null));
  assert.doesNotThrow(() => helper({ global: { nativeLoggingHook() { throw new Error('PRIVATE_SENTINEL'); } } }).exports
    .observeStartupFailure({ phase: 'ACCOUNT_STATE', outcome: 'THREW', errorName: 'Error', nativeCode: null }));
});

function navigate({ read, replace, current = true, report } = {}) {
  const source = fs.readFileSync(path.join(root, 'src/screens/Splash/SplashScreen.tsx'), 'utf8');
  const tree = ts.createSourceFile('Splash.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let selected;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'navigateToApp') {
      assert.equal(selected, undefined); selected = node.initializer.getText(tree);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(selected);
  const failures = [], flags = [], reads = [], marker = () => {};
  const context = { current, readPending: { current: true }, setStartupError: value => flags.push(value),
    SecureStore: { hasPin(...args) { reads.push(args); return read(); } },
    startupFailureObserver: marker, reportStartupFailure: report || ((...args) => failures.push(args)),
    navigation: { replace }, exports: {} };
  vm.runInNewContext(ts.transpileModule('exports.run = ' + selected, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return { run: context.exports.run, failures, flags, reads, marker, context };
}

test('actual Splash closure records navigation throws separately without duplicating credential failures', async () => {
  const error = new Error('PRIVATE_SENTINEL');
  const nav = navigate({ read: () => Promise.resolve(false), replace() { throw error; } });
  await nav.run(); assert.equal(nav.failures.length, 1);
  assert.deepEqual(nav.failures[0].slice(1, 3), ['NAVIGATION', 'THREW']);
  assert.equal(nav.failures[0][3], error); assert.deepEqual(nav.flags, [true]);
  assert.equal(nav.reads.length, 1); assert.equal(nav.reads[0][1], nav.marker);
  const native = navigate({ read: () => Promise.reject(error), replace() { throw new Error('must not navigate'); } });
  await native.run(); assert.deepEqual(native.failures, []); assert.deepEqual(native.flags, [true]);
  const stale = navigate({ current: false, read: () => Promise.resolve(true), replace() { throw new Error('must not navigate'); } });
  await stale.run(); assert.deepEqual(stale.flags, []); assert.deepEqual(stale.failures, []);
});
