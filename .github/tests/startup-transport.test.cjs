'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
function fixture(middleware) {
  const rows = [];
  const context = { module: { exports: {} }, URL, Date, Buffer, Uint8Array,
    require(name) {
      if (name === '../../metro.config.js') return { server: {} };
      if (name === './startup_reporter.cjs') return { record: row => rows.push(JSON.parse(JSON.stringify(row))) };
      if (name === './startup_source_frames.cjs') return require('../native/startup_source_frames.cjs');
      if (name === 'node:events') return require('node:events');
      throw Error('Unexpected import');
    } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../native/startup_observer.cjs'), 'utf8'), context);
  return { rows, handler: context.module.exports.server.enhanceMiddleware(middleware, {}) };
}

test('real streamed HTTP bytes finish and close preserve complete response and fixed timing', async () => {
  const body = 'PRIVATE_SENTINEL_BODY';
  const f = fixture((req, res) => { res.writeHead(200, { 'content-type': 'text/javascript' }); res.write(body); res.end('END'); });
  const server = http.createServer(f.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise((resolve, reject) => http.get({ hostname: '127.0.0.1', port: server.address().port,
      path: '/index.bundle?platform=ios&dev=true&lazy=true&excludeSource=true&sourcePaths=url-server&private=PRIVATE_SENTINEL'
    }, res => { let data = ''; res.on('data', b => data += b); res.on('end', () => resolve(data)); }).on('error', reject));
    assert.equal(result, body + 'END');
    const response = f.rows.find(row => row.kind === 'RESPONSE');
    const close = f.rows.find(row => row.event === 'RESPONSE_CLOSE');
    assert.equal(close.request_id, response.request_id); assert.equal(close.writable_finished, true);
    assert.equal(close.writable_ended, true); assert.equal(close.headers_sent, true);
    assert.equal(response.outer_http_status, 200); assert(Number.isInteger(response.duration_ms));
    assert(!JSON.stringify(f.rows).includes('PRIVATE_SENTINEL'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('real client disconnect is visible without response finish or fabricated success', async () => {
  let close;
  const closed = new Promise(resolve => close = resolve);
  const f = fixture((req, res) => { res.writeHead(200); res.write('PRIVATE_SENTINEL'); res.once('close', close); });
  const server = http.createServer(f.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await new Promise((resolve, reject) => {
      const request = http.get({ hostname: '127.0.0.1', port: server.address().port, path: '/index.bundle?platform=ios' }, res => {
        res.once('data', () => { request.destroy(); resolve(); });
      }); request.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
    });
    await closed;
    const row = f.rows.find(row => row.event === 'RESPONSE_CLOSE');
    assert.equal(row.writable_finished, false); assert.equal(row.writable_ended, false);
    assert(!f.rows.some(row => row.kind === 'RESPONSE')); assert(!JSON.stringify(f.rows).includes('PRIVATE_SENTINEL'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('error monitor retains only finite error code and preserves original unhandled exception', () => {
  const f = fixture(() => 1); const req = new EventEmitter(); req.url = '/index.bundle';
  const res = new EventEmitter(); res.statusCode = 200;
  assert.equal(f.handler(req, res, () => {}), 1);
  const error = Object.assign(Error('PRIVATE_SENTINEL'), { code: 'ECONNRESET' });
  assert.throws(() => res.emit('error', error), value => value === error);
  assert.equal(f.rows.find(row => row.event === 'RESPONSE_ERROR').error_code, 'ECONNRESET');
  assert(!JSON.stringify(f.rows).includes('PRIVATE_SENTINEL'));
});
