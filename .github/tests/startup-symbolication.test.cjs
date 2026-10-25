'use strict';

// Execute the real pinned Metro symbolicator and real HTTP middleware with
// synthetic bodies only. No device, provider, request body or error text leaves.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const test = require('node:test');
const frames = require('../native/startup_source_frames.cjs');
const root = path.resolve(__dirname, '../..');
const observerSource = fs.readFileSync(path.join(root, '.github/native/startup_observer.cjs'), 'utf8');
function optionalDependency(name) {
  try { return require.resolve(name); }
  catch (error) { if (error.code === 'MODULE_NOT_FOUND') return null; throw error; }
}
const metroPackage = optionalDependency('metro/package.json');
const cliServerPackage = optionalDependency('@react-native-community/cli-server-api/package.json');

function fixture(options = {}) {
  const rows = [], calls = [], receiver = {}, next = () => {};
  const config = { resolver: {}, transformer: {}, serializer: {}, server: {} };
  const context = { module: { exports: {} }, URL, Date, Buffer, Uint8Array, require(name) {
    if (name === '../../metro.config.js') return config;
    if (name === './startup_reporter.cjs') return { record: row => rows.push(JSON.parse(JSON.stringify(row))) };
    if (name === './startup_source_frames.cjs') return frames;
    throw Error('Unexpected observation import');
  } };
  vm.runInNewContext(observerSource, context);
  const middleware = function (...args) { calls.push([this, ...args]); return 91; };
  const handler = context.module.exports.server.enhanceMiddleware(middleware, {});
  const res = new EventEmitter();
  res.statusCode = options.status ?? 200;
  res.getHeader = name => name === 'content-encoding' ? options.encoding : undefined;
  const chunks = [], invocations = [];
  const originalWrite = function (...args) {
    invocations.push(['write', this, args]);
    if (options.writeThrows) throw options.writeThrows;
    if (args[0] != null && typeof args[0] !== 'function') chunks.push(Buffer.from(args[0], typeof args[1] === 'string' ? args[1] : undefined));
    return false;
  };
  const originalEnd = function (...args) {
    invocations.push(['end', this, args]);
    if (options.endThrows) throw options.endThrows;
    if (args[0] != null && typeof args[0] !== 'function') chunks.push(Buffer.from(args[0], typeof args[1] === 'string' ? args[1] : undefined));
    res.emit('finish');
    return receiver;
  };
  res.write = originalWrite; res.end = originalEnd;
  const req = { url: options.url || '/symbolicate' };
  assert.equal(handler.call(receiver, req, res, next), 91);
  assert.deepEqual(calls, [[receiver, req, res, next]]);
  return { rows, res, chunks, invocations, originalWrite, originalEnd, receiver,
    observation: () => rows.filter(row => row.kind === 'SYMBOLICATE_RESPONSE') };
}

function publicFrame(line = 32, column = 4) {
  return { file: path.join(root, 'App.tsx'), lineNumber: line, column,
    methodName: 'PRIVATE_SENTINEL_METHOD', arguments: ['PRIVATE_SENTINEL'] };
}

test('actual pinned Metro symbolicator produces normalized public source location without code frame', {
  skip: metroPackage ? false : 'Pinned mobile dependencies unavailable; no actual Metro execution claimed.',
}, async () => {
  const metroRoot = path.dirname(metroPackage);
  assert.equal(require('metro/package.json').version, '0.83.6');
  const moduleFile = path.join(metroRoot, 'src/Server/symbolicate.js');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(moduleFile)).digest('hex'),
    'e3dbf27d462a3d8cf4326012108ddb824cfa3efc8d218845f7a6a4765c4fa737');
  const serverFile = fs.readFileSync(path.join(metroRoot, 'src/Server.js'));
  assert.equal(crypto.createHash('sha256').update(serverFile).digest('hex'),
    '636b9bbf8004d0223017500d8c5cbdc5a3b12e25b43b5c7a2a4d25dbc14b3edf');
  const symbolicate = require(moduleFile).default;
  const url = 'http://localhost:8081/index.bundle?PRIVATE_SENTINEL';
  const stack = await symbolicate([{ file: url, lineNumber: 1, column: 0, methodName: 'PRIVATE_SENTINEL' }],
    [[url, [{ firstLine1Based: 1, path: path.join(root, 'App.tsx'), map: [[1, 0, 32, 4]] }]]],
    { symbolicator: { customizeFrame: () => ({}), customizeStack: value => value } }, {});
  assert.equal(stack[0].file, path.join(root, 'App.tsx'));
  assert.equal(stack[0].column, 4, 'pinned producer uses zero-based columns');
  const payload = JSON.stringify({ codeFrame: { content: 'PRIVATE_SENTINEL_CODEFRAME' }, stack });
  const f = fixture();
  const callback = () => {};
  assert.equal(f.res.write(payload.slice(0, 17), 'utf8', callback), false);
  assert.equal(f.res.end(Buffer.from(payload.slice(17)), callback), f.receiver);
  assert.equal(Buffer.concat(f.chunks).toString(), payload);
  assert.equal(f.invocations[0][1], f.res);
  assert.deepEqual(f.invocations[0][2], [payload.slice(0, 17), 'utf8', callback]);
  assert.equal(f.invocations[1][2][1], callback);
  assert.deepEqual(f.observation(), [{ kind: 'SYMBOLICATE_RESPONSE', capture_status: 'OBSERVED',
    source_frames: [{ path: 'App.tsx', line: 32, column: 5 }], observed_frames: 1,
    rejected_frames: 0, truncated: false }]);
  assert.equal(f.res.write, f.originalWrite); assert.equal(f.res.end, f.originalEnd);
  f.res.emit('close'); assert.equal(f.observation().length, 1);
  assert(!JSON.stringify(f.rows).includes('PRIVATE_SENTINEL'));
  assert(!JSON.stringify(f.rows).includes(root));
  assert(!JSON.stringify(f.rows).includes('methodName'));
  assert(!JSON.stringify(f.rows).includes('codeFrame'));
  const { spawnSync } = require('node:child_process');
  const python = spawnSync('python3', ['-B', '-c',
    "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('d','.github/native/startup_diagnosis.py'); d=importlib.util.module_from_spec(s);s.loader.exec_module(d);print(json.dumps(d.symbolication_row(json.load(sys.stdin))))"],
  { cwd: root, input: JSON.stringify(f.observation()[0]), encoding: 'utf8' });
  assert.equal(python.status, 0, python.stderr);
  assert.deepEqual(JSON.parse(python.stdout), f.observation()[0]);
});

test('relative and exact owned paths normalize, foreign paths URLs traversal getters and invalid coordinates reject', () => {
  let getters = 0;
  const hostile = {};
  for (const key of ['file', 'lineNumber', 'column']) Object.defineProperty(hostile, key, {
    get() { getters++; throw Error('PRIVATE_SENTINEL'); } });
  const cases = [publicFrame(), { file: 'App.tsx', lineNumber: 32, column: 4 },
    ...['/private/App.tsx', '../App.tsx', root + '/../App.tsx',
      'http://localhost:8081/App.tsx', 'https://foreign.test/App.tsx', 'node_modules/private.js'].map(file =>
      ({ file, lineNumber: 32, column: 4 })),
    publicFrame(0), publicFrame(999999), publicFrame(32, -1), publicFrame(32, 999999),
    { ...publicFrame(), lineNumber: true }, { ...publicFrame(), column: null }, hostile, null];
  const result = frames.fromSymbolicatedStack(cases);
  assert.equal(getters, 0);
  assert.deepEqual(result.source_frames, [{ path: 'App.tsx', line: 32, column: 5 }]);
  assert.equal(result.observed_frames, cases.length);
  assert.equal(result.rejected_frames, cases.length - 2);
  const text = frames.fromText(['at own (App.tsx:32:5)\nat foreign (/private/App.tsx:32:5)\n../App.tsx:32:5\n' + root + '/src/storage/index.ts:18:2']);
  assert.deepEqual(text.source_frames, [{ path: 'App.tsx', line: 32, column: 5 },
    { path: 'src/storage/index.ts', line: 18, column: 2 }]);
  assert(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
});

test('body HTTP encoding JSON layout size and depth failures emit fixed unknown outcomes with unchanged bytes', () => {
  for (const [options, payload, status] of [
    [{ status: 500 }, JSON.stringify({ error: 'PRIVATE_SENTINEL' }), 'HTTP_ERROR'],
    [{ encoding: 'gzip' }, 'PRIVATE_SENTINEL', 'UNSUPPORTED_ENCODING'],
    [{}, '{"stack": PRIVATE_SENTINEL}', 'INVALID_JSON'],
    [{}, JSON.stringify({ error: 'PRIVATE_SENTINEL' }), 'INVALID_RESPONSE'],
    [{}, JSON.stringify({ stack: 'PRIVATE_SENTINEL' }), 'INVALID_STACK'],
    [{}, 'x'.repeat(256 * 1024 + 1), 'OVERSIZED'],
    [{}, JSON.stringify({ stack: [], codeFrame: Array.from({ length: 18 }).reduce(value => [value], null) }), 'DEPTH_LIMIT'],
  ]) {
    const f = fixture(options);
    f.res.end(payload);
    assert.equal(Buffer.concat(f.chunks).toString(), payload);
    assert.equal(f.observation().length, 1);
    assert.equal(f.observation()[0].capture_status, status);
    assert.deepEqual(f.observation()[0].source_frames, []);
    assert(!JSON.stringify(f.rows).includes('PRIVATE_SENTINEL'));
    assert.equal(f.res.write, f.originalWrite); assert.equal(f.res.end, f.originalEnd);
  }
});

test('incomplete responses and original write/end throws retain identities and release hooks', () => {
  const f = fixture(); f.res.write('{"stack":'); f.res.emit('close');
  assert.equal(f.observation()[0].capture_status, 'INCOMPLETE_RESPONSE');
  assert.equal(f.res.write, f.originalWrite); assert.equal(f.res.end, f.originalEnd);
  for (const method of ['write', 'end']) {
    const error = Error('PRIVATE_SENTINEL');
    const sample = fixture({ [method + 'Throws']: error });
    assert.throws(() => sample.res[method]('PRIVATE_SENTINEL'), value => value === error);
    assert.equal(sample.observation()[0].capture_status, 'INCOMPLETE_RESPONSE');
    assert.equal(sample.res.write, sample.originalWrite); assert.equal(sample.res.end, sample.originalEnd);
    assert(!JSON.stringify(sample.rows).includes('PRIVATE_SENTINEL'));
  }
});

test('invalid UTF-8 and missing response methods report fixed capture gaps without exporting data', () => {
  const f = fixture();
  const payload = Buffer.concat([Buffer.from('{"stack":[],"codeFrame":"'), Buffer.from([255]), Buffer.from('"}')]);
  f.res.end(payload);
  assert.equal(f.observation()[0].capture_status, 'INVALID_JSON');
  assert.deepEqual(Buffer.concat(f.chunks), payload);
  const rows = [];
  const context = { module: { exports: {} }, URL, Date, Buffer, Uint8Array, require(name) {
    if (name === '../../metro.config.js') return { server: {} };
    if (name === './startup_reporter.cjs') return { record: row => rows.push(row) };
    if (name === './startup_source_frames.cjs') return frames;
    throw Error('Unexpected observation import');
  } };
  vm.runInNewContext(observerSource, context);
  const response = new EventEmitter(); response.statusCode = 200;
  const handler = context.module.exports.server.enhanceMiddleware(() => 41, {});
  assert.equal(handler({ url: '/symbolicate' }, response, () => {}), 41);
  assert.equal(rows.find(row => row.kind === 'SYMBOLICATE_RESPONSE').capture_status, 'UNAVAILABLE');
});

test('stack and frame caps retain only bounded coordinates and state partial coverage', () => {
  const stack = Array.from({ length: 80 }, (_, index) => publicFrame(index + 1, 0));
  const f = fixture(); f.res.end(JSON.stringify({ stack, codeFrame: { content: 'PRIVATE_SENTINEL' } }));
  const result = f.observation()[0];
  assert.equal(result.capture_status, 'STACK_LIMIT_EXCEEDED');
  assert.equal(result.observed_frames, 64); assert.equal(result.truncated, true);
  assert.equal(result.source_frames.length, 8);
  const unknown = frames.fromSymbolicatedStack([{ file: '/foreign/private.js', lineNumber: 1, column: 0 }]);
  assert.equal(unknown.capture_status, 'NO_PUBLIC_SOURCE_FRAMES');
  assert.equal(unknown.observed_frames, 1); assert.equal(unknown.rejected_frames, 1);
  assert.deepEqual(unknown.source_frames, []);
});

test('other routes retain original response functions, stream behavior and HTTP outcomes', () => {
  for (const url of ['/index.bundle?platform=android', '/private.bundle', '/private/path']) {
    const f = fixture({ url });
    assert.equal(f.res.write, f.originalWrite); assert.equal(f.res.end, f.originalEnd);
    f.res.end('PRIVATE_SENTINEL');
    assert.deepEqual(f.observation(), []);
    assert.equal(Buffer.concat(f.chunks).toString(), 'PRIVATE_SENTINEL');
  }
});

test('actual Node HTTP streamed symbolication preserves bytes headers callbacks and original route', async () => {
  const http = require('node:http');
  const rows = [], completions = [];
  const payload = JSON.stringify({ codeFrame: { content: 'PRIVATE_SENTINEL' }, stack: [publicFrame()] });
  const context = { module: { exports: {} }, URL, Date, Buffer, Uint8Array, require(name) {
    if (name === '../../metro.config.js') return { server: {} };
    if (name === './startup_reporter.cjs') return { record: row => rows.push(row) };
    if (name === './startup_source_frames.cjs') return frames;
    throw Error('Unexpected observation import');
  } };
  vm.runInNewContext(observerSource, context);
  const handler = context.module.exports.server.enhanceMiddleware((req, res) => {
    assert.equal(req.url, '/symbolicate');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Keeper-Test', 'unchanged');
    res.write(Buffer.from(payload.slice(0, 11)), () => completions.push('write'));
    res.end(payload.slice(11), () => completions.push('end'));
  }, {});
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: server.address().port, path: '/symbolicate' }, response => {
        const parts = [];
        response.on('data', value => parts.push(value));
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers,
          body: Buffer.concat(parts).toString() }));
      });
      req.on('error', reject);
    });
    assert.equal(result.status, 200); assert.equal(result.body, payload);
    assert.equal(result.headers['content-type'], 'application/json');
    assert.equal(result.headers['x-keeper-test'], 'unchanged');
    assert.deepEqual(completions, ['write', 'end']);
    assert.deepEqual(JSON.parse(JSON.stringify(rows.find(row => row.kind === 'SYMBOLICATE_RESPONSE'))).source_frames,
      [{ path: 'App.tsx', line: 32, column: 5 }]);
    assert.equal(rows.filter(row => row.kind === 'SYMBOLICATE_RESPONSE').length, 1);
    assert(!JSON.stringify(rows).includes('PRIVATE_SENTINEL'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('actual pinned compression layer keeps gzip wire bytes while observer reads application JSON', {
  skip: cliServerPackage && metroPackage ? false : 'Pinned mobile dependencies unavailable; no actual compression pipeline execution claimed.',
}, async () => {
  const { createRequire } = require('node:module');
  const fromCLI = createRequire(cliServerPackage);
  const compressionPath = fromCLI.resolve('compression');
  const compression = fromCLI('compression');
  assert.equal(fromCLI('compression/package.json').version, '1.8.1');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(compressionPath)).digest('hex'),
    'b303ae0ce09150c5c459936741cc56aac602ffa113f84ca5a67bb464b5b6c9eb');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(path.dirname(cliServerPackage), 'build/index.js'))).digest('hex'),
    'b8ea39f049200d7a99e3abe02e1e60a55ddd5eb333d65856ac9d16a52c5f183e');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(path.dirname(metroPackage), 'src/index.flow.js'))).digest('hex'),
    '90117f0ea0083cc6f07d95809fe0c64a78bc9d0dba7f3e9f76d83508cd4bac8c');
  const http = require('node:http'), zlib = require('node:zlib');
  const rows = [];
  const payload = JSON.stringify({ stack: [publicFrame()], codeFrame: { content: 'PRIVATE_SENTINEL'.repeat(200) } });
  assert(payload.length > 1024);
  const context = { module: { exports: {} }, URL, Date, Buffer, Uint8Array, require(name) {
    if (name === '../../metro.config.js') return { server: {} };
    if (name === './startup_reporter.cjs') return { record: row => rows.push(row) };
    if (name === './startup_source_frames.cjs') return frames;
    throw Error('Unexpected observation import');
  } };
  vm.runInNewContext(observerSource, context);
  const observed = context.module.exports.server.enhanceMiddleware((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Keeper-Test', 'unchanged');
    res.write(payload.slice(0, 20));
    res.end(payload.slice(20));
  }, {});
  const compress = compression({ threshold: 0 });
  const server = http.createServer((req, res) => compress(req, res, () => observed(req, res, () => {})));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise((resolve, reject) => {
      const request = http.get({ host: '127.0.0.1', port: server.address().port,
        path: '/symbolicate', headers: { 'Accept-Encoding': 'gzip' } }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({ headers: response.headers, status: response.statusCode,
          bytes: Buffer.concat(chunks) }));
      });
      request.on('error', reject);
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers['content-encoding'], 'gzip');
    assert.equal(result.headers['x-keeper-test'], 'unchanged');
    assert.equal(zlib.gunzipSync(result.bytes).toString('utf8'), payload);
    const row = JSON.parse(JSON.stringify(rows.find(value => value.kind === 'SYMBOLICATE_RESPONSE')));
    assert.equal(row.capture_status, 'OBSERVED');
    assert.deepEqual(row.source_frames, [{ path: 'App.tsx', line: 32, column: 5 }]);
    assert(!JSON.stringify(rows).includes('PRIVATE_SENTINEL'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
