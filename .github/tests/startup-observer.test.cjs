'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../native/startup_observer.cjs'), 'utf8');
const reporterRoot = process.env.KEEPER_REPORTER_SOURCE_ROOT || path.resolve(__dirname, '../..');
const reporterSource = fs.readFileSync(path.join(reporterRoot, '.github/native/startup_reporter.cjs'), 'utf8');

function load(config, enabled = true) {
  const rows = [];
  const reporterEvents = [];
  const terminals = [];
  class TerminalReporter {
    constructor(terminal) { this.terminal = terminal; terminals.push(terminal); }
    update(event) { assert.equal(this.terminal, terminals[0]); reporterEvents.push(event); return 31; }
  }
  let Reporter;
  const context = { module: { exports: {} }, URL, Date, __dirname: path.resolve(__dirname, '../native'),
    process: { env: { RUNNER_TEMP: '/tmp/keeper-fixture', KEEPER_STARTUP_OBSERVER_PATH: enabled ? '/tmp/keeper-fixture/keeper-native-private/startup-observer.jsonl' : '/unsafe/PRIVATE_SENTINEL' } },
    require(name) {
      if (name === '../../metro.config.js') return config;
      if (name === './startup_reporter.cjs') return Reporter;
      if (name === './startup_source_frames.cjs') return require('../native/startup_source_frames.cjs');
      if (name === 'metro') return { TerminalReporter };
      if (name === 'node:module') return { createRequire(filename) {
        assert(['/app/react-native/package.json', '/app/react-native/cli-plugin/package.json'].includes(filename));
        const result = (name) => { assert.equal(name, 'metro'); return { TerminalReporter }; };
        result.resolve = (name) => { assert.equal(name, '@react-native/community-cli-plugin/package.json'); return '/app/react-native/cli-plugin/package.json'; };
        return result;
      } };
      if (name === 'node:fs') return { readFileSync: fs.readFileSync, appendFileSync(file, text) { rows.push(JSON.parse(text)); } };
      if (name === 'node:path') return path;
      if (name === 'node:os') return { tmpdir: () => '/tmp' };
      throw new Error('Unexpected fixture import');
    },
  };
  context.require.resolve = (name) => { assert.equal(name, 'react-native/package.json'); return '/app/react-native/package.json'; };
  const reporterContext = { ...context, module: { exports: {} } };
  vm.runInNewContext(reporterSource, reporterContext);
  Reporter = reporterContext.module.exports;
  vm.runInNewContext(source, context);
  return { config: context.module.exports, rows, Reporter, reporterEvents, terminals };
}

test('keeps normal resolver, transformer, entry settings and original reporter context', () => {
  const observed = [];
  const reporter = { update(event) { assert.equal(this, reporter); observed.push(event); return 17; } };
  const original = { resolver: {}, transformer: {}, serializer: {}, projectRoot: '/original', reporter, server: { port: 8081 } };
  const loaded = load(original);
  for (const key of ['resolver', 'transformer', 'serializer', 'projectRoot']) assert.equal(loaded.config[key], original[key]);
  assert.equal(loaded.config.server.port, 8081);
  assert.equal(loaded.config.reporter, reporter);
  const event = { type: 'bundle_build_started', bundleDetails: { platform: 'android', dev: true }, PRIVATE_SENTINEL: 'private' };
  assert.equal(loaded.config.reporter.update(event), 17);
  assert.equal(observed[0], event);
  const terminal = {};
  const cliReporter = new loaded.Reporter(terminal);
  assert.equal(cliReporter.update(event), 31);
  assert.equal(loaded.terminals[0], terminal);
  assert.equal(loaded.reporterEvents[0], event);
  assert(!JSON.stringify(loaded.rows).includes('PRIVATE_SENTINEL'));
});

test('forwards middleware enhancer, requests, streaming and backpressure unchanged', () => {
  const calls = [];
  const middleware = () => {};
  const server = {};
  const original = { reporter: { update() {} }, server: { enhanceMiddleware(inner, actualServer) {
    assert.equal(this, original.server); assert.equal(inner, middleware); assert.equal(actualServer, server);
    return function (...args) { calls.push([this, ...args]); return 23; };
  } } };
  const loaded = load(original);
  const handler = loaded.config.server.enhanceMiddleware(middleware, server);
  const req = { url: '/index.bundle?platform=android&dev=true&lazy=true&app=io.hexawallet.keeper.development&modulesOnly=false&runModule=true&excludeSource=true&sourcePaths=url-server&PRIVATE_SENTINEL=secret' };
  const res = new EventEmitter(); res.statusCode = 500; res.write = () => false;
  const write = res.write;
  const next = () => {};
  const receiver = {};
  assert.equal(handler.call(receiver, req, res, next), 23);
  assert.deepEqual(calls[0], [receiver, req, res, next]);
  assert.equal(res.write, write); assert.equal(res.write(Buffer.from('unchanged')), false);
  res.emit('finish');
  assert.equal(loaded.rows[0].options.lazy, true);
  assert.equal(loaded.rows[0].options.app, 'EXPECTED');
  assert.equal(loaded.rows[1].outer_http_status, 500);
  assert(!JSON.stringify(loaded.rows).includes('PRIVATE_SENTINEL'));
});

test('emits only fixed error/query categories and caps rows', () => {
  const loaded = load({ reporter: { update() {} } });
  const cliReporter = new loaded.Reporter({});
  cliReporter.update({ type: 'bundling_error', error: { name: 'PRIVATE_SENTINEL', message: 'TypeError PRIVATE_SENTINEL secret URL/path' } });
  const handler = loaded.config.server.enhanceMiddleware(() => true, {});
  handler({ url: '/PRIVATE_SENTINEL.bundle?platform=PRIVATE_SENTINEL&app=PRIVATE_SENTINEL&dev=PRIVATE_SENTINEL' }, new EventEmitter(), () => {});
  assert.equal(loaded.rows[0].error_type, 'OTHER');
  assert.equal(loaded.rows[0].kind, 'ERROR');
  assert.equal(loaded.rows[0].event, 'bundling_error');
  assert.equal(loaded.rows[1].options.platform, 'OTHER');
  assert(!JSON.stringify(loaded.rows).includes('PRIVATE_SENTINEL'));
  for (let i = 0; i < 600; i++) cliReporter.update({ type: 'bundle_build_done' });
  assert.equal(loaded.rows.length, 512);
  const disabled = load({ reporter: { update() { return 9; } } }, false);
  assert.equal(disabled.config.reporter.update({ type: 'bundle_build_done' }), 9);
  assert.equal(disabled.rows.length, 0);
  assert.equal(new disabled.Reporter({}).update({ type: 'bundle_build_done' }), 31);
  assert.equal(disabled.rows.length, 0);
});

test('matches the actual app ID for each request platform without rewriting requests', () => {
  const nativeSource = fs.readFileSync(path.join(__dirname, '../native/hosted_native.py'), 'utf8');
  const ids = /APP_IDS = \{'IOS': '([^']+)', 'ANDROID': '([^']+)'\}/.exec(nativeSource);
  assert(ids, 'bind observations to the app IDs actually passed to installation and Maestro');
  const calls = [];
  const loaded = load({ server: {}, reporter: { update() {} } });
  const handler = loaded.config.server.enhanceMiddleware((req, res) => {
    calls.push([req, res]); return 'normal-body';
  }, {});
  for (const [platform, app, expected] of [
    ['ios', ids[1], 'EXPECTED'],
    ['ios', ids[2], 'OTHER'],
    ['android', ids[2], 'EXPECTED'],
    ['android', ids[1], 'OTHER'],
    ['PRIVATE_SENTINEL', ids[1], 'OTHER'],
  ]) {
    const req = { url: `/index.bundle?platform=${platform}&app=${app}&dev=true&lazy=true` };
    const res = new EventEmitter();
    assert.equal(handler(req, res, () => {}), 'normal-body');
    assert.equal(calls.at(-1)[0], req);
    assert.equal(calls.at(-1)[1], res);
    assert.equal(loaded.rows.at(-1).options.app, expected);
  }
  assert(!JSON.stringify(loaded.rows).includes('PRIVATE_SENTINEL'));
});

test('malformed optional request observation never replaces middleware behavior', () => {
  const req = { get url() { throw new Error('PRIVATE_SENTINEL request accessor'); } };
  const res = new EventEmitter();
  const next = () => {};
  const loaded = load({ server: {}, reporter: { update() {} } });
  const handler = loaded.config.server.enhanceMiddleware((actualReq, actualRes, actualNext) => {
    assert.equal(actualReq, req); assert.equal(actualRes, res); assert.equal(actualNext, next);
    return false;
  }, {});
  assert.equal(handler(req, res, next), false);
  assert.equal(loaded.rows.length, 0);
});

function actualMissingNativeModule() {
  // Execute the actual pinned RN registry with controlled missing native input.
  // No React Native process or provider operation is performed.
  const crypto = require('node:crypto');
  const { createRequire } = require('node:module');
  const rnRoot = path.dirname(require.resolve('react-native/package.json'));
  assert.equal(require('react-native/package.json').version, '0.83.9');
  const actual = fs.readFileSync(path.join(rnRoot, 'Libraries/TurboModule/TurboModuleRegistry.js'), 'utf8');
  assert.equal(crypto.createHash('sha256').update(actual).digest('hex'),
    '183df81462ad81e6cfc839986401f6e57d303bd5361459b5fead86fcfdc8ff41');
  const presetRequire = createRequire(require.resolve('@react-native/babel-preset/package.json'));
  const code = require('@babel/core').transformSync(actual, { babelrc: false, configFile: false,
    plugins: [presetRequire('@babel/plugin-transform-flow-strip-types'),
      presetRequire('@babel/plugin-transform-modules-commonjs')] }).code;
  const context = { exports: {}, global: {}, require(name) {
    if (name === 'invariant') return require('invariant');
    if (name === '../BatchedBridge/NativeModules') return { default: {} };
    throw new Error('Unexpected pinned registry import');
  } };
  vm.runInNewContext(code, context);
  let missing;
  try { context.exports.getEnforcing('RNGetRandomValues'); } catch (error) { missing = error; }
  assert.ok(missing && missing.message.includes("'RNGetRandomValues' could not be found"));
  return missing;
}

const mobileSourceAvailable = (() => {
  try { require.resolve('react-native/package.json'); require.resolve('@babel/core'); return true; }
  catch (_) { return false; }
})();
test('actual pinned RN registry and CLI event yield actionable identity without private payload',
  { skip: mobileSourceAvailable ? false : 'Pinned mobile dependency sources unavailable; source-replay check not run.' }, () => {
  const crypto = require('node:crypto');
  const cliRoot = path.dirname(require.resolve('@react-native/community-cli-plugin/package.json'));
  const loggerPath = path.join(cliRoot, 'dist/utils/createDevMiddlewareLogger.js');
  assert.equal(require('@react-native/community-cli-plugin/package.json').version, '0.83.9');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(loggerPath)).digest('hex'),
    '4499065a1261fb99aa743568834a9fa3806862fe112603ce753106100e3444fc');
  const loaded = load({ server: {}, reporter: { update() {} } });
  const reporter = new loaded.Reporter({});
  const nativeError = actualMissingNativeModule();
  const logger = require(loggerPath).default(reporter);
  logger.error(nativeError, 'at App (App.tsx:32:5)\n at PRIVATE_SENTINEL (/private/secret.js:1:1)');
  assert.equal(loaded.reporterEvents.length, 1);
  assert.equal(loaded.reporterEvents[0].data[0], nativeError);
  assert.equal(loaded.rows.length, 1);
  const row = loaded.rows[0];
  assert.equal(row.kind, 'CONSOLE');
  assert.equal(row.event, 'unstable_server_log');
  assert.equal(row.level, 'error');
  assert.equal(row.error_type, 'Invariant Violation');
  assert.deepEqual(Array.from(row.diagnostic_codes), ['NATIVE_REGISTRY_MODULE_MISSING']);
  assert.deepEqual(Array.from(row.native_modules), ['RNGetRandomValues']);
  assert.deepEqual(row.source_frames, [{ path: 'App.tsx', line: 32, column: 5 }]);
  assert.equal(row.items_scanned, 2);
  assert.equal(row.unclassified_items, 1);
  assert.equal(row.data_truncated, false);
  assert(!JSON.stringify(row).includes('PRIVATE_SENTINEL'));
  assert(!JSON.stringify(row).includes('stack'));
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('python3', ['-B', '-c',
    "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('d','.github/native/startup_diagnosis.py'); d=importlib.util.module_from_spec(s);s.loader.exec_module(d);print(json.dumps(d.runtime_row(json.load(sys.stdin))))"],
  { cwd: path.resolve(__dirname, '../..'), input: JSON.stringify(row), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const regenerated = JSON.parse(result.stdout);
  assert.deepEqual(regenerated.native_modules, ['RNGetRandomValues']);
  assert.deepEqual(regenerated.source_frames, [{ path: 'App.tsx', line: 32, column: 5 }]);
});

test('client console schemas retain fixed missing-global and provider codes while forwarding originals', () => {
  const loaded = load({ reporter: { update() {} } });
  const reporter = new loaded.Reporter({});
  for (const [message, code] of [
    ["ReferenceError: Property 'Buffer' doesn't exist PRIVATE_SENTINEL", 'GLOBAL_BUFFER_MISSING'],
    ['new NativeEventEmitter() requires a non-null argument. PRIVATE_SENTINEL', 'NATIVE_EVENT_EMITTER_NULL'],
    ['could not find react-redux context value PRIVATE_SENTINEL', 'REDUX_PROVIDER_MISSING'],
    ['No Firebase App [DEFAULT] has been created PRIVATE_SENTINEL', 'FIREBASE_DEFAULT_APP_MISSING'],
    ['Failed to initialize IAP connection: PRIVATE_SENTINEL', 'IAP_INITIALIZATION_FAILED'],
  ]) {
    const event = { type: 'client_log', level: 'warn', data: [message] };
    assert.equal(reporter.update(event), 31);
    assert.equal(loaded.reporterEvents.at(-1), event);
    assert.deepEqual(Array.from(loaded.rows.at(-1).diagnostic_codes), [code]);
  }
  assert(!JSON.stringify(loaded.rows).includes('PRIVATE_SENTINEL'));
  assert.equal(loaded.rows[0].error_type, 'ReferenceError');
});

test('console observation never invokes payload getters or coercion and exposes unknown coverage', () => {
  const loaded = load({ reporter: { update() {} } });
  const reporter = new loaded.Reporter({});
  let accesses = 0;
  const hostile = { toString() { accesses++; throw Error('PRIVATE_SENTINEL'); } };
  for (const key of ['name', 'message', 'stack']) Object.defineProperty(hostile, key, {
    get() { accesses++; throw Error('PRIVATE_SENTINEL'); } });
  const event = { type: 'client_log', level: 'PRIVATE_SENTINEL', data: [hostile, null, 123, 'PRIVATE_SENTINEL'] };
  assert.equal(reporter.update(event), 31);
  assert.equal(accesses, 0);
  assert.equal(loaded.rows[0].level, 'OTHER');
  assert.equal(loaded.rows[0].items_scanned, 4);
  assert.equal(loaded.rows[0].unclassified_items, 4);
  assert.deepEqual(Array.from(loaded.rows[0].diagnostic_codes), []);
  assert.deepEqual(loaded.rows[0].source_frames, []);
  reporter.update({ type: 'unstable_server_log', level: 'error', data: { raw: 'PRIVATE_SENTINEL' } });
  assert.equal(loaded.rows[1].invalid_data, true);
  assert.equal(loaded.rows[1].items_scanned, 0);
  assert(!JSON.stringify(loaded.rows).includes('PRIVATE_SENTINEL'));
});

test('console item, text, source-frame and emitter bounds stay finite and cannot forward unknown paths', () => {
  const loaded = load({ reporter: { update() {} } });
  const reporter = new loaded.Reporter({});
  const text = 'TypeError PRIVATE_SENTINEL\nApp.tsx:0:1\nApp.tsx:9999999:1\nApp.tsx:1:0\nApp.tsx:1:1000001\n' +
    'App.tsx:1:2\n/private/App.tsx:32:5\n../App.tsx:32:5\n/secret/src/storage/index.ts:18:2\nApp.tsx:32:5PRIVATE_SENTINEL\nsrc/private-key.ts:1:1\n../.env:1:1\n' +
    Array.from({ length: 12 }, (_, i) => 'App.tsx:' + (i + 2) + ':1').join('\n') + '\n' + 'x'.repeat(9000);
  reporter.update({ type: 'client_log', level: 'error', data: [text, ...Array(20).fill('PRIVATE_SENTINEL')] });
  const row = loaded.rows[0];
  assert.equal(row.items_scanned, 16);
  assert.equal(row.data_truncated, true);
  assert.equal(row.source_frames.length, 8);
  assert(row.source_frames.every(frame => frame.path === 'App.tsx' && frame.line > 0 && frame.column > 0 && frame.column <= 1000000));
  assert(!JSON.stringify(row).includes('PRIVATE_SENTINEL'));
  assert(!JSON.stringify(row).includes('.env'));
  for (let index = 0; index < 600; index++) reporter.update({ type: 'client_log', level: 'log', data: [] });
  assert.equal(loaded.rows.length, 512);
  assert.equal(loaded.reporterEvents.length, 601);
});


test('console source coordinates require exact relative or owned-root namespace and actual line widths', () => {
  for (const text of ['/private/App.tsx:32:5', '../App.tsx:32:5',
    '/secret/src/storage/index.ts:18:2', 'file:///private/App.tsx:32:5',
    'App.tsx:32:5PRIVATE_SENTINEL', 'App.tsx:32:999999']) {
    const loaded = load({ reporter: { update() {} } });
    new loaded.Reporter({}).update({ type: 'client_log', level: 'error', data: [text] });
    assert.deepEqual(loaded.rows[0].source_frames, [], text);
  }
  for (const text of ['App.tsx:32:5',
    path.resolve(__dirname, '../../App.tsx') + ':32:5']) {
    const loaded = load({ reporter: { update() {} } });
    new loaded.Reporter({}).update({ type: 'client_log', level: 'error', data: [text] });
    assert.deepEqual(loaded.rows[0].source_frames, [{ path: 'App.tsx', line: 32, column: 5 }]);
  }
});

test('scalar server-log strings and unknown Error-like payloads retain honest coverage', () => {
  const loaded = load({ reporter: { update() {} } });
  const reporter = new loaded.Reporter({});
  reporter.update({ type: 'unstable_server_log', level: 'error',
    data: 'Failed to initialize IAP connection: PRIVATE_SENTINEL' });
  assert.deepEqual(Array.from(loaded.rows[0].diagnostic_codes), ['IAP_INITIALIZATION_FAILED']);
  assert.equal(loaded.rows[0].invalid_data, false);
  assert.equal(loaded.rows[0].items_scanned, 1);
  reporter.update({ type: 'client_log', level: 'error',
    data: [{ name: 'PRIVATE_SENTINEL', message: 'PRIVATE_SENTINEL' }] });
  assert.equal(loaded.rows[1].error_type, 'OTHER');
  assert.equal(loaded.rows[1].unclassified_items, 1);
  assert(!JSON.stringify(loaded.rows).includes('PRIVATE_SENTINEL'));
});

test('standard client-logs switch only enables actual pinned HMR reporter forwarding',
  { skip: mobileSourceAvailable ? false : 'Pinned mobile dependency sources unavailable; CLI/HMR source check not run.' }, async () => {
  const crypto = require('node:crypto');
  const cliRoot = path.dirname(require.resolve('@react-native/community-cli-plugin/package.json'));
  const metroRoot = path.dirname(require.resolve('metro/package.json'));
  const cli = fs.readFileSync(path.join(cliRoot, 'dist/commands/start/runServer.js'), 'utf8');
  const hmrFile = path.join(metroRoot, 'src/HmrServer.js');
  assert.equal(crypto.createHash('sha256').update(cli).digest('hex'),
    '8fe0854e35331d9a42a690b263b08f5f48e7660fa532e84b001120992225013b');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(hmrFile)).digest('hex'),
    '7f31d70a87fbb69a8e06e57a2e53083b999f1aefec31145d21740f660cc21c67');
  const ast = require('@babel/core').parseSync(cli, { babelrc: false, configFile: false });
  const pending = [ast]; let gate;
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (value.type === 'IfStatement' && cli.slice(value.start, value.end).startsWith('if (!args.clientLogs)')) {
      assert.equal(gate, undefined); gate = cli.slice(value.start, value.end);
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) pending.push(...child);
      else if (child && typeof child === 'object') pending.push(child);
    }
  }
  assert.equal(gate, 'if (!args.clientLogs) {\n    metroConfig.server.forwardClientLogs = false;\n  }');
  const optionSource = fs.readFileSync(path.join(cliRoot, 'dist/commands/start/index.js'), 'utf8');
  assert(optionSource.includes('name: "--client-logs"'));
  const HmrServer = require(hmrFile).default;
  for (const enabled of [false, true]) {
    const loaded = load({ reporter: { update() {} } });
    const reporter = new loaded.Reporter({});
    const resolver = {}, transformer = {}, serializer = {};
    const config = { server: { forwardClientLogs: true }, reporter, resolver, transformer, serializer };
    vm.runInNewContext(gate, { args: { clientLogs: enabled }, metroConfig: config });
    assert.equal(config.server.forwardClientLogs, enabled);
    assert.equal(config.resolver, resolver); assert.equal(config.transformer, transformer);
    assert.equal(config.serializer, serializer);
    let responses = 0;
    const server = new HmrServer({}, () => 0, config);
    await server.onClientMessage({}, JSON.stringify({ type: 'log', level: 'error',
      data: ["TurboModuleRegistry.getEnforcing(...): 'RNGetRandomValues' could not be found. PRIVATE_SENTINEL"] }),
    () => { responses++; });
    assert.equal(responses, 0);
    assert.equal(loaded.rows.length, enabled ? 1 : 0);
    if (enabled) {
      assert.equal(loaded.rows[0].event, 'client_log');
      assert.deepEqual(Array.from(loaded.rows[0].native_modules), ['RNGetRandomValues']);
      assert.deepEqual(Array.from(loaded.rows[0].diagnostic_codes), ['NATIVE_REGISTRY_MODULE_MISSING']);
      assert(!JSON.stringify(loaded.rows).includes('PRIVATE_SENTINEL'));
    }
  }
});
