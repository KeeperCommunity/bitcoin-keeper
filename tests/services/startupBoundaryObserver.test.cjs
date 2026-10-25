// Actual app/provider source with disposable native boundaries; no native calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const babel = require('@babel/core');
const React = require('react');
const Renderer = require('react-test-renderer');
const { PersistGate } = require('redux-persist/integration/react');
const sourceFrames = require('../../.github/native/startup_source_frames.cjs');

const root = path.resolve(__dirname, '../..');
const helperFile = path.join(root, 'src/utils/startup-boundary-observer.tsx');
const dependencyRoot = (name) => path.dirname(require.resolve(`${name}/package.json`));
const plain = (value) => JSON.parse(JSON.stringify(value));
global.IS_REACT_ACT_ENVIRONMENT = true;

function compile(source, extra = {}) {
  const context = {
    exports: {},
    module: { exports: {} },
    global: {},
    __DEV__: true,
    require(name) {
      if (name === 'react') return React;
      throw Error('Unexpected import');
    },
    ...extra,
  };
  context.module.exports = context.exports;
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText,
    context
  );
  return context;
}
function helper(options = {}) {
  const records = [],
    platform = { OS: options.platform || 'android' };
  const c = compile(fs.readFileSync(helperFile, 'utf8'), {
    __DEV__: options.dev ?? true,
    global: { nativeLoggingHook: (...args) => records.push(args), ...(options.global || {}) },
    require(name) {
      return name === 'react' ? React : { Platform: platform };
    },
  });
  return { ...c.exports, records, platform };
}
function functions(file, names) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = tree.statements.filter(
    (n) => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)
  );
  assert.equal(nodes.length, names.length);
  return nodes.map((n) => n.getText(tree)).join('\n');
}
function loadCommonJS(file, imports) {
  const context = {
    exports: {},
    module: { exports: {} },
    require: imports,
    process: { env: { NODE_ENV: 'test' } },
    console,
  };
  context.module.exports = context.exports;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.exports;
}
function safeArea() {
  return loadCommonJS(
    path.join(dependencyRoot('react-native-safe-area-context'), 'lib/commonjs/SafeAreaContext.js'),
    (name) => {
      if (name === 'react') return React;
      if (name === 'react-native')
        return {
          StyleSheet: { create: (x) => x },
          Dimensions: { get: () => ({ width: 360, height: 760 }) },
        };
      if (name === './NativeSafeAreaProvider')
        return { NativeSafeAreaProvider: 'NativeSafeAreaProvider' };
      throw Error('Unexpected SafeArea import');
    }
  ).SafeAreaProvider;
}
function hce() {
  const calls = [],
    control = {};
  const pending = new Promise((resolve, reject) => {
    Object.assign(control, { resolve, reject });
  });
  function DisposableEmitter() {
    this.addListener = () => ({ remove() {} });
  }
  const native = {
    getConstants: () => ({}),
    getContent: () => {
      calls.push('GET_CONTENT');
      return pending;
    },
    getEnabled: async () => {
      calls.push('GET_ENABLED');
      return false;
    },
  };
  const source = fs.readFileSync(
    path.join(dependencyRoot('react-native-hce'), 'dist/index.js'),
    'utf8'
  );
  const compiled = babel.transformSync(source, {
    babelrc: false,
    configFile: false,
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const c = {
    exports: {},
    module: { exports: {} },
    require(name) {
      if (name === 'react') return React;
      if (name === 'react-native')
        return {
          Platform: { OS: 'android' },
          NativeModules: { Hce: native },
          NativeEventEmitter: DisposableEmitter,
        };
      throw Error('Unexpected HCE import');
    },
  };
  c.module.exports = c.exports;
  vm.runInNewContext(compiled, c);
  return { Provider: c.exports.HCESessionProvider, calls, ...control };
}
const metrics = {
  insets: { top: 20, bottom: 0, left: 0, right: 0 },
  frame: { x: 0, y: 0, width: 360, height: 760 },
};
async function fixture({ bootstrapped = true, initialMetrics = metrics, throws = false } = {}) {
  const h = helper(),
    native = hce(),
    mounts = [],
    callbacks = [];
  const persistor = {
    getState: () => ({ bootstrapped }),
    subscribe(fn) {
      callbacks.push(fn);
      return () => {};
    },
  };
  const Pass = ({ children }) => children;
  function Probe() {
    React.useEffect(() => {
      mounts.push('CHILD');
    }, []);
    if (throws) throw Error('DISPOSABLE_RENDER_FAILURE');
    return React.createElement('Probe');
  }
  const c = compile(
    `${functions('App.tsx', ['AndroidProvider', 'App', 'AppWrapper'])}\nexports.Root = AppWrapper;`,
    {
      React,
      useEffect: React.useEffect,
      Platform: h.platform,
      observeStartupBoundary: h.observeStartupBoundary,
      withStartupBoundary: h.withStartupBoundary,
      HCESessionProvider: native.Provider,
      SafeAreaProvider: safeArea(),
      initialWindowMetrics: initialMetrics,
      PersistGate,
      persistor,
      store: {},
      Provider: Pass,
      GestureHandlerRootView: 'GestureRoot',
      ThemeContextProvider: Pass,
      LocalizationProvider: Pass,
      AppContextProvider: Pass,
      TorContextProvider: Pass,
      NotificationHandler: () => null,
      StatusBar: () => null,
      Navigator: Probe,
      initConnection: () => Promise.resolve(true),
      endConnection: () => Promise.resolve(true),
    }
  );
  class Boundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { failed: false };
    }

    static getDerivedStateFromError() {
      return { failed: true };
    }

    render() {
      const { failed } = this.state;
      return failed
        ? React.createElement('ControlledFallback')
        : React.createElement(c.exports.Root);
    }
  }
  let instance;
  await Renderer.act(async () => {
    instance = Renderer.create(React.createElement(Boundary));
  });
  return {
    ...h,
    native,
    mounts,
    instance,
    lift() {
      bootstrapped = true;
      callbacks.forEach((fn) => fn());
    },
  };
}
const names = (h) => h.records.map(([message]) => message.split('|')[2]);
async function quiet(run) {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
}

test('fixed stage producer is INFO, once per JS boot, and never coerces private values', () => {
  const h = helper();
  assert(Object.isFrozen(h.STARTUP_BOUNDARY_STAGES));
  for (const stage of h.STARTUP_BOUNDARY_STAGES) {
    h.observeStartupBoundary(stage);
    h.observeStartupBoundary(stage);
  }
  assert.equal(h.records.length, 20);
  assert(
    h.records.every(
      ([message, level]) => level === 1 && /^KEEPER_STARTUP_BOUNDARY\|v1\|[A-Z_]+$/.test(message)
    )
  );
  let touched = 0;
  h.observeStartupBoundary({
    toString() {
      touched++;
      throw Error('PRIVATE_SENTINEL');
    },
  });
  h.observeStartupBoundary('PRIVATE_SENTINEL');
  assert.equal(touched, 0);
  assert.equal(h.records.length, 20);
});

test('release and iOS return original children and emit nothing; absent/throwing hooks cannot affect startup', () => {
  for (const options of [{ dev: false }, { platform: 'ios' }]) {
    const h = helper(options),
      child = React.createElement('Probe');
    h.observeStartupBoundary('APP_RENDERED');
    assert.equal(h.withStartupBoundary(child, 'APP_RENDERED', 'APP_COMMITTED'), child);
    assert.deepEqual(h.records, []);
  }
  for (const nativeLoggingHook of [
    undefined,
    17,
    () => {
      throw Error('PRIVATE_SENTINEL');
    },
  ]) {
    const h = helper({ global: { nativeLoggingHook } });
    assert.doesNotThrow(() => h.observeStartupBoundary('APP_RENDERED'));
    assert.deepEqual(h.records, []);
  }
});

test('actual entrypoint preserves Sentry, font setup and exact component registration order', () => {
  const h = helper();
  const calls = [];
  const NativeText = {};
  const Input = {};
  const Svg = {};
  function App() {
    return null;
  }
  const originalObserve = h.observeStartupBoundary;
  const c = compile(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), {
    require(name) {
      if (name === 'base-64') return { decode: (value) => value };
      if (name === 'react-native')
        return {
          Text: NativeText,
          AppRegistry: {
            registerComponent(appName, getApp) {
              assert.equal(appName, 'hexa_keeper');
              assert.equal(getApp(), App);
              calls.push('REGISTER');
            },
          },
        };
      if (name === '@gluestack-ui/themed-native-base') return { Text: {}, Input };
      if (name === 'react-native-svg') return { Svg };
      if (name === './App') return { __esModule: true, default: App };
      if (name === './app.json') return { name: 'hexa_keeper' };
      if (name === './AndroidFontFix')
        return { enableAndroidFontFix: () => calls.push('FONT_FIX') };
      if (name === 'src/services/sentry') return { initSentrySDK: () => calls.push('SENTRY') };
      if (name === 'src/utils/startup-boundary-observer')
        return {
          observeStartupBoundary(stage) {
            calls.push(stage);
            originalObserve(stage);
          },
        };
      if (
        [
          'react-native-reanimated',
          'react-native-gesture-handler',
          './shim',
          './src/services/backup/encoding',
          'react-native-get-random-values',
        ].includes(name)
      )
        return {};
      throw Error('Unexpected entrypoint import');
    },
  });
  assert.deepEqual(calls, [
    'ENTRYPOINT_READY',
    'SENTRY',
    'FONT_FIX',
    'REGISTER',
    'ENTRYPOINT_REGISTERED',
  ]);
  assert.equal(typeof c.global.atob, 'function');
  assert.equal(NativeText.defaultProps.allowFontScaling, false);
  assert.equal(Input.defaultProps.allowFontScaling, false);
  assert.equal(Svg.defaultProps.pointerEvents, 'none');
});

test('actual PersistGate, SafeArea and HCE gates produce distinct render/commit witnesses without extra HCE calls', async () =>
  quiet(async () => {
    const h = await fixture({ bootstrapped: false, initialMetrics: null });
    assert.deepEqual(names(h), ['ROOT_WRAPPER_RENDERED']);
    assert.deepEqual(h.native.calls, []);
    await Renderer.act(async () => h.lift());
    assert(names(h).includes('APP_RENDERED'));
    assert(names(h).includes('APP_COMMITTED'));
    assert(!names(h).includes('SAFE_AREA_CHILDREN_RENDERED'));
    assert.deepEqual(h.native.calls, []);
    await Renderer.act(async () =>
      h.instance.root
        .findByType('NativeSafeAreaProvider')
        .props.onInsetsChange({ nativeEvent: metrics })
    );
    assert(names(h).includes('SAFE_AREA_CHILDREN_COMMITTED'));
    assert(names(h).includes('HCE_WRAPPER_COMMITTED'));
    assert(!names(h).includes('HCE_CHILDREN_RENDERED'));
    assert.deepEqual(h.native.calls, ['GET_CONTENT']);
    assert.deepEqual(h.mounts, []);
    await Renderer.act(async () => h.native.resolve(null));
    assert(names(h).includes('HCE_CHILDREN_RENDERED'));
    assert(names(h).includes('HCE_CHILDREN_COMMITTED'));
    assert.deepEqual(h.native.calls, ['GET_CONTENT']);
    assert.deepEqual(h.mounts, ['CHILD']);
    await Renderer.act(async () =>
      h.instance.root
        .findByType('NativeSafeAreaProvider')
        .props.onInsetsChange({ nativeEvent: metrics })
    );
    assert.deepEqual(h.mounts, ['CHILD']);
    assert.equal(new Set(names(h)).size, h.records.length);
    await Renderer.act(async () => h.instance.unmount());
  }));

test('a descendant render failure records released HCE children without claiming their commit or visibility', async () =>
  quiet(async () => {
    const h = await fixture({ throws: true });
    assert(names(h).includes('APP_COMMITTED'));
    assert(!names(h).includes('HCE_CHILDREN_RENDERED'));
    await Renderer.act(async () => h.native.resolve(null));
    assert(names(h).includes('HCE_CHILDREN_RENDERED'));
    assert(!names(h).includes('HCE_CHILDREN_COMMITTED'));
    assert.deepEqual(h.mounts, []);
    assert.equal(h.instance.root.findAllByType('ControlledFallback').length, 1);
    assert.deepEqual(h.native.calls, ['GET_CONTENT']);
    await Renderer.act(async () => h.instance.unmount());
  }));

function credentialEffect(h, result, { stale = false, throwNavigation = false } = {}) {
  const file = 'src/screens/Splash/SplashScreen.tsx';
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(root, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const found = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === 'useEffect' &&
      node.arguments[0].getText(source).includes('SecureStore.hasPin')
    )
      found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(found.length, 1);
  assert.equal(found[0].arguments[1].getText(source), '[attempt, navigation]');
  const calls = [],
    routes = [],
    failures = [],
    states = [];
  const c = compile(`exports.run = (${found[0].arguments[0].getText(source)});`, {
    readPending: { current: false },
    observeStartupBoundary: h.observeStartupBoundary,
    observeStartupFailure: () => {},
    SecureStore: {
      hasPin(...args) {
        calls.push(args);
        return result;
      },
    },
    navigation: {
      replace(...args) {
        routes.push(args);
        if (throwNavigation) throw Error('PRIVATE_SENTINEL');
      },
    },
    reportStartupFailure: (...args) => failures.push(args),
    setStartupError: (value) => states.push(value),
  });
  const cleanup = c.exports.run();
  if (stale) cleanup();
  return { calls, routes, failures, states, cleanup };
}

test('actual credential effect preserves one native probe, rejection handling and stale-navigation guards without exporting results', async () => {
  await Promise.all(
    [false, true].map(async (hasCreds) => {
      const h = helper(),
        c = credentialEffect(h, Promise.resolve(hasCreds));
      await new Promise(setImmediate);
      assert.deepEqual(names(h), [
        'CREDENTIAL_PROBE_ENTERED',
        'CREDENTIAL_PROBE_RESOLVED',
        'ROUTE_REPLACE_ENTERED',
        'ROUTE_REPLACE_RETURNED',
      ]);
      assert.equal(c.calls.length, 1);
      assert.equal(c.calls[0][0].throwOnError, true);
      assert.equal(typeof c.calls[0][1], 'function');
      assert.equal(c.routes[0][0], hasCreds ? 'Login' : 'CreatePin');
      assert.equal(c.failures.length, 0);
      assert.deepEqual(c.states, []);
      c.cleanup();
    })
  );
  const rejected = helper(),
    rejectedCall = credentialEffect(rejected, Promise.reject(Error('PRIVATE_SENTINEL')));
  await new Promise(setImmediate);
  assert.deepEqual(names(rejected), ['CREDENTIAL_PROBE_ENTERED', 'CREDENTIAL_PROBE_REJECTED']);
  assert.deepEqual(rejectedCall.states, [true]);
  assert.equal(rejectedCall.routes.length, 0);
  const nav = helper(),
    navCall = credentialEffect(nav, Promise.resolve(false), { throwNavigation: true });
  await new Promise(setImmediate);
  assert.deepEqual(names(nav), [
    'CREDENTIAL_PROBE_ENTERED',
    'CREDENTIAL_PROBE_RESOLVED',
    'ROUTE_REPLACE_ENTERED',
    'ROUTE_REPLACE_THROWN',
  ]);
  assert.equal(navCall.failures.length, 1);
  assert.deepEqual(navCall.states, [true]);
  const stale = helper(),
    staleCall = credentialEffect(stale, Promise.resolve(false), { stale: true });
  await new Promise(setImmediate);
  assert.deepEqual(names(stale), ['CREDENTIAL_PROBE_ENTERED', 'CREDENTIAL_PROBE_RESOLVED']);
  assert.equal(staleCall.routes.length, 0);
  const pending = helper(),
    pendingCall = credentialEffect(pending, new Promise(() => {}));
  await new Promise(setImmediate);
  assert.deepEqual(names(pending), ['CREDENTIAL_PROBE_ENTERED']);
  assert.equal(pendingCall.calls.length, 1);
  assert.equal(pendingCall.routes.length, 0);
  pendingCall.cleanup();
  assert(
    !JSON.stringify([rejected.records, nav.records, stale.records, pending.records]).includes(
      'PRIVATE_SENTINEL'
    )
  );
});

function nativeEmitter(platform) {
  const file = path.join(
    dependencyRoot('react-native'),
    'Libraries/EventEmitter/NativeEventEmitter.js'
  );
  const source = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    babelrc: false,
    configFile: false,
    plugins: [
      [
        createRequire(require.resolve('@react-native/babel-preset/package.json')).resolve(
          '@babel/plugin-transform-flow-strip-types'
        ),
        { allowDeclareFields: true },
      ],
      '@babel/plugin-transform-modules-commonjs',
    ],
  }).code;
  const warnings = [],
    c = {
      exports: {},
      module: { exports: {} },
      console: { warn: (text) => warnings.push(text) },
      require(name) {
        if (name === '../Utilities/Platform') return { OS: platform };
        if (name === './RCTDeviceEventEmitter') return {};
        if (name === 'invariant')
          return (condition, message) => {
            if (!condition) throw Error(message);
          };
        throw Error('Unexpected native emitter import');
      },
    };
  c.module.exports = c.exports;
  vm.runInNewContext(source, c);
  return { NativeEventEmitter: c.exports.default, warnings };
}
function runtimeFailure() {
  const file = path.join(root, '.github/native/startup_reporter.cjs');
  const imports = {
    'node:fs': fs,
    'node:path': path,
    'node:os': require('node:os'),
    './startup_source_frames.cjs': sourceFrames,
  };
  const c = {
    module: { exports: {} },
    exports: {},
    process: { env: {} },
    require(name) {
      assert(Object.hasOwn(imports, name));
      return imports[name];
    },
  };
  vm.runInNewContext(`${fs.readFileSync(file, 'utf8')}\nmodule.exports = runtimeFailure;`, c);
  return c.module.exports;
}
test('actual pinned NativeEventEmitter warnings are not null invariants, and the real iOS invariant remains classified', () => {
  const project = runtimeFailure(),
    android = nativeEmitter('android');
  const incomplete = new android.NativeEventEmitter({});
  assert(incomplete);
  assert.equal(android.warnings.length, 2);
  for (const text of android.warnings)
    assert.deepEqual(plain(project({ type: 'client_log', data: [text] }).diagnostic_codes), []);
  assert.doesNotThrow(() => new android.NativeEventEmitter(null));
  const ios = nativeEmitter('ios');
  let invariant;
  try {
    const instance = new ios.NativeEventEmitter(null);
    assert(instance);
  } catch (error) {
    invariant = error;
  }
  assert(invariant);
  assert.deepEqual(plain(project({ type: 'client_log', data: [invariant] }).diagnostic_codes), [
    'NATIVE_EVENT_EMITTER_NULL',
  ]);
});
