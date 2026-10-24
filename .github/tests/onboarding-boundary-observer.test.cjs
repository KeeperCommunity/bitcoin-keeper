'use strict';
// Execute the actual TS handler/effect closures with synthetic host inputs.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const sourceRoot = process.env.KEEPER_ONBOARDING_SOURCE_ROOT || root;
const onboarding = 'src/screens/Splash/OnBoardingSlides.tsx';
const keeper = 'src/screens/NewKeeperAppScreen/NewKeeperAppScreen.tsx';
const helper = 'src/utils/onboarding-boundary-observer.ts';
const stages = ['ONBOARDING_EFFECT', 'SKIP_PRESS_IN', 'SKIP_PRESS_OUT', 'SKIP_PRESS',
  'SKIP_RESET_RETURNED', 'SKIP_RESET_THROWN', 'NEW_KEEPER_EFFECT'];
const plain = value => JSON.parse(JSON.stringify(value));
function compile(source, extra = {}) {
  const context = { exports: {}, global: {}, __DEV__: true,
    require(name) { assert.equal(name, 'react-native'); return { Platform: { OS: 'android' } }; },
    console: new Proxy({}, { get() { throw new Error('No console/LogBox'); } }),
    Date: new Proxy({}, { get() { throw new Error('No clock'); } }),
    setTimeout() { throw new Error('No new timer'); }, fetch() { throw new Error('No network'); }, ...extra };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React,
  } }).outputText, context);
  return context;
}
function observer(extra = {}) {
  const markers = [];
  const context = compile(fs.readFileSync(path.join(sourceRoot, helper), 'utf8'), {
    global: { nativeLoggingHook: (...args) => markers.push(args) }, ...extra });
  return { run: context.exports.observeOnboardingBoundary, markers };
}
function tree(file) {
  return ts.createSourceFile(file, fs.readFileSync(path.join(sourceRoot, file), 'utf8'),
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

function renderedSkip(options = {}) {
  const order = [], effects = [], navigation = options.navigation || { reset() { order.push('RESET'); return 71; } };
  const platform = options.platform || { OS: 'android' };
  const h = observer({ __DEV__: options.dev ?? true,
    require: () => ({ Platform: platform }), ...(options.global ? { global: options.global } : {}) });
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useContext: () => ({ translations: { onboarding: {}, common: {} } }),
    useState: value => [value, () => {}], useRef: value => ({ current: value }),
    useEffect: callback => effects.push(callback) };
  const context = compile(fs.readFileSync(path.join(sourceRoot, onboarding), 'utf8'), {
    __DEV__: options.dev ?? true,
    require(name) {
      if (name === 'react') return { ...React, default: React };
      if (name === 'react-native') return { Platform: platform, StyleSheet: { create: value => value },
        SafeAreaView: 'SafeAreaView', TouchableOpacity: 'TouchableOpacity', FlatList: 'FlatList',
        Dimensions: { get: () => ({ width: 360, height: 731 }) },
        BackHandler: { addEventListener: () => ({ remove() {} }) } };
      if (name === '@gluestack-ui/themed-native-base') return { Box: 'Box', useColorMode: () => ({ colorMode: 'light' }) };
      if (name === 'src/context/Localization/LocContext') return { LocalizationContext: {} };
      if (name === 'src/constants/responsive') return { windowHeight: 731, hp: value => value, wp: value => value };
      if (name === 'src/utils/service-utilities/config') return { KEEPER_KNOWLEDGEBASE: 'SYNTHETIC' };
      if (name === 'src/utils/onboarding-boundary-observer') return { observeOnboardingBoundary: h.run };
      if (name === 'src/hooks/useSmallDevices') return { default: () => false };
      if (name === 'src/components/ThemedColor/ThemedColor') return { default: () => '' };
      return { default: name };
    },
  });
  const rendered = context.exports.default({ navigation });
  const pending = [rendered], matches = [];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) { pending.push(...value); continue; }
    if (value.props?.testID === 'btn_skip') matches.push(value);
    if (value.props) pending.push(value.props.children);
  }
  assert.equal(matches.length, 1);
  assert.equal(matches[0].type, 'TouchableOpacity');
  return { props: matches[0].props, h, order, effects };
}

function optionalDependency(name) {
  try { return require.resolve(name); }
  catch (error) { if (error.code === 'MODULE_NOT_FOUND') return null; throw error; }
}
const pinnedPackage = optionalDependency('react-native/package.json');
const babelPackage = optionalDependency('@babel/core');
const babelPreset = optionalDependency('@react-native/babel-preset');
const pinnedControl = { skip: pinnedPackage && babelPackage && babelPreset ? false :
  'Pinned mobile dependency graph unavailable; actual TouchableOpacity/Pressability control not run.' };

function pinnedTouchable(props, order) {
  const crypto = require('node:crypto'), babel = require(babelPackage);
  const mobileRoot = path.dirname(pinnedPackage);
  assert.equal(require(pinnedPackage).version, '0.83.9');
  const touchable = fs.readFileSync(path.join(mobileRoot, 'Libraries/Components/Touchable/TouchableOpacity.js'), 'utf8');
  const pressability = fs.readFileSync(path.join(mobileRoot, 'Libraries/Pressability/Pressability.js'), 'utf8');
  assert.equal(crypto.createHash('sha256').update(touchable).digest('hex'),
    'bb0441965dd3fd2b6759575b681e642c18b3a7bd7a1fe16c04d91f80b41f0412');
  assert.equal(crypto.createHash('sha256').update(pressability).digest('hex'),
    '834d76342e00db633f0776484cf8df79849598ba1986be1d03cdd0a55df126f6');
  const transform = (text, filename) => babel.transformSync(text, {
    filename, babelrc: false, configFile: false, presets: [babelPreset],
  }).code;
  const nativeContext = { module: { exports: {} }, exports: null, __DEV__: true,
    process: { env: { NODE_ENV: 'test' } }, setTimeout, clearTimeout, Date,
    require(name) {
      if (name.startsWith('@babel/runtime/')) return require(name);
      if (name.includes('ReactNativeFeatureFlags')) return { shouldPressibilityUseW3CPointerEventsForHover: () => false };
      if (name.endsWith('SoundManager')) return { playTouchSound() {} };
      if (name.endsWith('UIManager')) return { measure: (_, callback) => callback(0, 78, 1038, 56, 0, 78) };
      if (name.endsWith('/Rect')) return { normalizeRect: value => value };
      if (name.endsWith('/Platform')) return { OS: 'android' };
      if (name.endsWith('HoverState')) return { isHoverEnabled: () => false };
      if (name.endsWith('PressabilityPerformanceEventEmitter.js')) return { emitEvent() {} };
      if (name === 'invariant') return (condition, message) => assert.ok(condition, message);
      throw Error('Unexpected pinned control dependency');
    },
  };
  nativeContext.exports = nativeContext.module.exports;
  vm.runInNewContext(transform(pressability, 'Pressability.js'), nativeContext);
  const Pressability = nativeContext.module.exports.default;
  const ast = babel.parseSync(touchable, { filename: 'TouchableOpacity.js', babelrc: false,
    configFile: false, presets: [babelPreset] });
  const pending = [ast], methods = {};
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (value.type === 'ClassMethod' && ['_createPressabilityConfig', 'render'].includes(value.key.name)) methods[value.key.name] = value;
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) pending.push(...child);
      else if (child && typeof child === 'object') pending.push(child);
    }
  }
  const method = name => {
    assert.ok(methods[name]);
    const context = { Platform: { isTV: false }, Animated: { View: 'Animated.View' },
      PressabilityDebugView: 'PressabilityDebugView', __DEV__: true,
      require(name) {
        if (name.startsWith('@babel/runtime/')) return require(name);
        assert.equal(name, 'react/jsx-runtime');
        return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      } };
    return vm.runInNewContext(transform('(function()' + touchable.slice(methods[name].body.start, methods[name].body.end) + ')', name + '.js'), context);
  };
  const receiver = { props, _opacityActive: value => order.push('OPACITY_ACTIVE:' + value),
    _opacityInactive: value => order.push('OPACITY_INACTIVE:' + value) };
  const config = method('_createPressabilityConfig').call(receiver);
  assert.equal(config.onPress, props.onPress);
  assert.equal(config.disabled, undefined);
  receiver.state = { anim: 1, pressability: new Pressability(config) };
  const rendered = method('render').call(receiver);
  assert.equal(rendered.type, 'Animated.View');
  assert.equal(rendered.props.testID, 'btn_skip');
  assert.equal(rendered.props.focusable, true);
  return { config, nativeProps: rendered.props, pressability: receiver.state.pressability };
}

const event = (target = 7, currentTarget = 7, extra = {}) => ({ target, currentTarget,
  nativeEvent: { pageX: 519, pageY: 106, touches: [{ pageX: 519, pageY: 106 }], ...extra },
  dispatchConfig: { registrationName: 'onResponderGrant' }, persist() {}, stopPropagation() {} });

test('Android dev hook emits bounded fixed stages at level3 with no payload/console/timer/network', () => {
  const h = observer();
  for (const stage of stages) for (let n = 0; n < 9; n++) h.run(stage);
  assert.equal(h.markers.length, 28);
  for (const stage of stages) assert.equal(h.markers.filter(row => row[0] === 'KEEPER_ONBOARDING_BOUNDARY|v1|' + stage).length, 4);
  assert.ok(h.markers.every(row => row.length === 2 && row[1] === 3 && row[0].length < 100));
  for (const bad of ['PRIVATE_SENTINEL', 'SKIP_PRESS\nPRIVATE_SENTINEL', {}, null]) h.run(bad);
  assert.equal(h.markers.length, 28);
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

test('actual JSX adds only supported Android development callbacks without inspecting events or returning values', () => {
  const { props, h } = renderedSkip();
  const hostile = new Proxy({}, { get() { throw Error('PRIVATE_SENTINEL_EVENT'); } });
  for (const name of ['onPressIn', 'onPressOut']) {
    assert.equal(typeof props[name], 'function');
    assert.equal(props[name](hostile), undefined);
  }
  for (const name of ['onTouchStart', 'onStartShouldSetResponder', 'onResponderGrant', 'onResponderRelease',
    'onResponderTerminationRequest', 'onResponderTerminate', 'pointerEvents', 'disabled']) {
    assert.equal(props[name], undefined, 'no new touch interception or unsupported prop: ' + name);
  }
  assert.deepEqual(h.markers.map(row => row[0].split('|')[2]), ['SKIP_PRESS_IN', 'SKIP_PRESS_OUT']);
  assert.equal(JSON.stringify(h.markers).includes('PRIVATE_SENTINEL'), false);
});

test('actual release and iOS JSX omit callbacks and never inspect native logging hook', () => {
  let reads = 0;
  const global = new Proxy({}, { get() { reads++; throw Error('PRIVATE_SENTINEL_HOOK'); } });
  const platform = new Proxy({}, { get() { reads++; throw Error('Release must not inspect platform'); } });
  for (const options of [{ dev: false, platform, global }, { platform: { OS: 'ios' }, global }]) {
    const { props } = renderedSkip(options);
    for (const name of ['onTouchStart', 'onPressIn', 'onPressOut']) assert.equal(props[name], undefined);
  }
  assert.equal(reads, 0);
});

test('pinned Touchable native render drops onTouchStart and preserves actual Pressability animation and navigation', pinnedControl, () => {
  const fixture = renderedSkip(), order = fixture.order;
  let unsupportedCalls = 0;
  const pinned = pinnedTouchable({ ...fixture.props, onTouchStart() { unsupportedCalls++; } }, order);
  try {
    assert.equal(pinned.nativeProps.onTouchStart, undefined,
      'TouchableOpacity does not forward an arbitrary onTouchStart prop; do not claim a raw-touch receipt');
    assert.equal(pinned.nativeProps.onStartShouldSetResponder(), true);
    pinned.nativeProps.onResponderGrant(event());
    assert.deepEqual(fixture.h.markers.map(row => row[0].split('|')[2]), ['SKIP_PRESS_IN']);
    assert.deepEqual(order, ['OPACITY_ACTIVE:0']);
    pinned.nativeProps.onResponderRelease(event());
    assert.deepEqual(fixture.h.markers.map(row => row[0].split('|')[2]),
      ['SKIP_PRESS_IN', 'SKIP_PRESS_OUT', 'SKIP_PRESS', 'SKIP_RESET_RETURNED']);
    assert.deepEqual(order, ['OPACITY_ACTIVE:0', 'OPACITY_INACTIVE:250', 'RESET']);
    assert.equal(unsupportedCalls, 0);
  } finally { pinned.pressability.reset(); }
});

test('actual pinned termination and suppressed clicks diverge from completed press without claiming native cause', pinnedControl, () => {
  const terminated = renderedSkip(), first = pinnedTouchable(terminated.props, terminated.order);
  try {
    first.nativeProps.onResponderGrant(event());
    first.nativeProps.onResponderTerminate(event());
    assert.deepEqual(terminated.h.markers.map(row => row[0].split('|')[2]), ['SKIP_PRESS_IN', 'SKIP_PRESS_OUT']);
    assert.deepEqual(terminated.order, ['OPACITY_ACTIVE:0', 'OPACITY_INACTIVE:250']);
  } finally { first.pressability.reset(); }
  const clicked = renderedSkip(), second = pinnedTouchable(clicked.props, clicked.order);
  try {
    second.nativeProps.onClick(event(8, 7));
    second.nativeProps.onClick(event(7, 7, { pointerType: 'touch' }));
    assert.deepEqual(clicked.h.markers, []);
    assert.deepEqual(clicked.order, []);
    second.nativeProps.onClick(event());
    assert.deepEqual(clicked.h.markers.map(row => row[0].split('|')[2]), ['SKIP_PRESS', 'SKIP_RESET_RETURNED']);
    assert.deepEqual(clicked.order, ['RESET']);
  } finally { second.pressability.reset(); }
});

test('actual JS native hook stages roundtrip through framed synthetic Android parser in producer order', () => {
  const { spawnSync } = require('node:child_process');
  const h = observer();
  for (const stage of stages) h.run(stage);
  const payload = h.markers.map(([text, level], index) => {
    assert.equal(level, 3);
    return `10-24 12:00:00.${String(index).padStart(3, '0')} 123 124 E ReactNativeJS: ${text}\n`;
  }).join('');
  const python = spawnSync('python3', ['-B', '-c',
    "import json,sys;sys.path.insert(0,'.github/native');import onboarding_failure_receipts as r;print(json.dumps(r.parse(sys.stdin.read(),{123})))"],
  { cwd: root, input: payload, encoding: 'utf8' });
  assert.equal(python.status, 0, python.stderr);
  const result = JSON.parse(python.stdout);
  assert.equal(result.producer_total_limit, 28);
  assert.equal(result.state, 'OBSERVED');
  assert.deepEqual(result.ordered_stages, stages);
  assert.equal(result.owned_marker_records, stages.length);
  assert.equal(result.cause, 'UNDETERMINED');
  assert.equal(result.scope, 'DEV_MARKERS_NOT_ROUTE_TAP_DELIVERY_OR_CAUSE_PROOF');
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
