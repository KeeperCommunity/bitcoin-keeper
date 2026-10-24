'use strict';
// Execute the actual TS handler/effect closures with synthetic host inputs.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const onboarding = 'src/screens/Splash/OnBoardingSlides.tsx';
const keeper = 'src/screens/NewKeeperAppScreen/NewKeeperAppScreen.tsx';
const helper = 'src/utils/onboarding-boundary-observer.ts';
const stages = ['ONBOARDING_EFFECT', 'SKIP_PRESS', 'SKIP_RESET_RETURNED', 'SKIP_RESET_THROWN', 'NEW_KEEPER_EFFECT'];
const plain = value => JSON.parse(JSON.stringify(value));
function compile(source, extra = {}) {
  const context = { exports: {}, global: {}, __DEV__: true,
    require(name) { assert.equal(name, 'react-native'); return { Platform: { OS: 'android' } }; },
    console: new Proxy({}, { get() { throw new Error('No console/LogBox'); } }),
    Date: new Proxy({}, { get() { throw new Error('No clock'); } }),
    setTimeout() { throw new Error('No new timer'); }, fetch() { throw new Error('No network'); }, ...extra };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  } }).outputText, context);
  return context;
}
function observer(extra = {}) {
  const markers = [];
  const context = compile(fs.readFileSync(path.join(root, helper), 'utf8'), {
    global: { nativeLoggingHook: (...args) => markers.push(args) }, ...extra });
  return { run: context.exports.observeOnboardingBoundary, markers };
}
function tree(file) {
  return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function findAll(source, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(source); return found;
}
function skipHandler(extra) {
  const source = tree(onboarding);
  const elements = findAll(source, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
    node.attributes.properties.some(prop => ts.isJsxAttribute(prop) && prop.name.text === 'testID' &&
      ts.isStringLiteral(prop.initializer) && prop.initializer.text === 'btn_skip'));
  assert.equal(elements.length, 1);
  assert.equal(elements[0].tagName.getText(source), 'TouchableOpacity');
  const prop = elements[0].attributes.properties.find(prop => prop.name?.text === 'onPress');
  return compile('exports.run = ' + prop.initializer.expression.getText(source), extra).exports.run;
}
function effect(file, anchor, extra) {
  const source = tree(file);
  const all = findAll(source, node => ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect');
  assert.equal(all.length, file === onboarding ? 1 : 6, 'observer must not add effects');
  const found = all.filter(node => node.arguments[0].getText(source).includes(anchor));
  assert.equal(found.length, 1);
  assert.equal(found[0].arguments[1].getText(source), '[]', 'existing mount dependency list is unchanged');
  return compile('exports.run = ' + found[0].arguments[0].getText(source), extra).exports.run;
}

test('Android dev hook emits bounded fixed stages at level3 with no payload/console/timer/network', () => {
  const h = observer();
  for (const stage of stages) for (let n = 0; n < 9; n++) h.run(stage);
  assert.equal(h.markers.length, 20);
  for (const stage of stages) assert.equal(h.markers.filter(row => row[0] === 'KEEPER_ONBOARDING_BOUNDARY|v1|' + stage).length, 4);
  assert.ok(h.markers.every(row => row.length === 2 && row[1] === 3 && row[0].length < 100));
  for (const bad of ['PRIVATE_SENTINEL', 'SKIP_PRESS\nPRIVATE_SENTINEL', {}, null]) h.run(bad);
  assert.equal(h.markers.length, 20);
  assert.equal(JSON.stringify(h.markers).includes('PRIVATE_SENTINEL'), false);
});

test('release guard precedes platform/hook inspection; iOS and broken hooks stay quiet', () => {
  let inspected = 0;
  const platform = new Proxy({}, { get() { inspected++; throw new Error('PRIVATE_SENTINEL'); } });
  const global = new Proxy({}, { get() { inspected++; throw new Error('PRIVATE_SENTINEL'); } });
  const release = observer({ __DEV__: false, global, require: () => platform });
  assert.doesNotThrow(() => release.run('SKIP_PRESS'));
  assert.equal(inspected, 0);
  const ios = observer({ global, require: () => ({ Platform: { OS: 'ios' } }) });
  assert.doesNotThrow(() => ios.run('SKIP_PRESS'));
  assert.equal(inspected, 0);
  for (const input of [{ global }, { global: { nativeLoggingHook() { throw new Error('PRIVATE_SENTINEL'); } } },
                       { require: () => ({ get Platform() { throw new Error('PRIVATE_SENTINEL'); } }) }]) {
    assert.doesNotThrow(() => observer(input).run('SKIP_PRESS'));
  }
});

test('actual Skip handler preserves reset receiver/arguments/count and immediate return identity', () => {
  const order = [], result = { get then() { throw new Error('Must not await/inspect return'); } };
  const h = observer({ global: { nativeLoggingHook: text => order.push(text.split('|')[2]) } });
  const navigation = { reset(...args) {
    assert.equal(this, navigation); order.push('RESET');
    assert.deepEqual(plain(args), [{ index: 0, routes: [{ name: 'NewKeeperApp' }] }]);
    return result;
  } };
  const run = skipHandler({ navigation, observeOnboardingBoundary: h.run });
  assert.equal(run(), result);
  assert.deepEqual(order, ['SKIP_PRESS', 'RESET', 'SKIP_RESET_RETURNED']);
});

test('actual Skip original throw wins and no error property is read even when the native hook throws', () => {
  let reads = 0, calls = 0;
  const original = new Proxy({}, { get() { reads++; throw new Error('PRIVATE_SENTINEL'); } });
  const hook = observer({ global: { nativeLoggingHook() { throw new Error('PRIVATE_SENTINEL observer'); } } });
  const run = skipHandler({ navigation: { reset() { calls++; throw original; } }, observeOnboardingBoundary: hook.run });
  assert.throws(run, caught => caught === original);
  assert.equal(calls, 1); assert.equal(reads, 0);
  const seen = observer();
  const failed = skipHandler({ navigation: { reset() { throw original; } }, observeOnboardingBoundary: seen.run });
  assert.throws(failed, caught => caught === original);
  assert.deepEqual(seen.markers.map(row => row[0].split('|')[2]), ['SKIP_PRESS', 'SKIP_RESET_THROWN']);
});

test('actual existing Onboarding effect keeps one original listener and cleanup without adding effects', () => {
  const order = [], h = observer();
  const cleanup = effect(onboarding, 'BackHandler.addEventListener', {
    observeOnboardingBoundary: h.run,
    BackHandler: { addEventListener(name, callback) {
      order.push(name); assert.equal(callback(), true);
      return { remove() { order.push('remove'); } };
    } },
  })();
  assert.deepEqual(order, ['hardwareBackPress']); cleanup();
  assert.deepEqual(order, ['hardwareBackPress', 'remove']);
  assert.deepEqual(h.markers.map(row => row[0].split('|')[2]), ['ONBOARDING_EFFECT']);
});

test('actual existing NewKeeper mount effect keeps navigation ref and original timer cleanup', () => {
  const h = observer(), navigationActive = { current: false }, timer = {}, cleared = [];
  const cleanup = effect(keeper, 'navigationActive.current = true', {
    observeOnboardingBoundary: h.run, navigationActive, nextNavigation: { current: timer },
    clearTimeout(value) { cleared.push(value); },
  })();
  assert.equal(navigationActive.current, true); assert.deepEqual(cleared, []);
  cleanup(); assert.equal(navigationActive.current, false); assert.deepEqual(cleared, [timer]);
  assert.deepEqual(h.markers.map(row => row[0].split('|')[2]), ['NEW_KEEPER_EFFECT']);
});
