'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../native/startup_observer.cjs'), 'utf8');
const reporterSource = fs.readFileSync(path.join(__dirname, '../native/startup_reporter.cjs'), 'utf8');

function load(config, enabled = true) {
  const rows = [];
  const reporterEvents = [];
  const terminals = [];
  class TerminalReporter {
    constructor(terminal) { this.terminal = terminal; terminals.push(terminal); }
    update(event) { assert.equal(this.terminal, terminals[0]); reporterEvents.push(event); return 31; }
  }
  let Reporter;
  const context = { module: { exports: {} }, URL, Date,
    process: { env: { RUNNER_TEMP: '/tmp/keeper-fixture', KEEPER_STARTUP_OBSERVER_PATH: enabled ? '/tmp/keeper-fixture/keeper-native-private/startup-observer.jsonl' : '/unsafe/PRIVATE_SENTINEL' } },
    require(name) {
      if (name === '../../metro.config.js') return config;
      if (name === './startup_reporter.cjs') return Reporter;
      if (name === 'metro') return { TerminalReporter };
      if (name === 'node:module') return { createRequire(filename) {
        assert(['/app/react-native/package.json', '/app/react-native/cli-plugin/package.json'].includes(filename));
        const result = (name) => { assert.equal(name, 'metro'); return { TerminalReporter }; };
        result.resolve = (name) => { assert.equal(name, '@react-native/community-cli-plugin/package.json'); return '/app/react-native/cli-plugin/package.json'; };
        return result;
      } };
      if (name === 'node:fs') return { appendFileSync(file, text) { rows.push(JSON.parse(text)); } };
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
