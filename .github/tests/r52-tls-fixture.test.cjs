'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const tls = require('node:tls');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');
const { test } = require('node:test');
const { createMatrix } = require('../native/r52_tls_fixture.cjs');
const { program } = require('../native/r52_ios_policy.cjs');
const productionTransport = require('../../src/services/electrum/tls');

test('owned fixture serves all declared chain/name/date cases with independent connection witnesses (Node only)', async t => {
  const matrix = await createMatrix('ANDROID');
  t.after(matrix.close);
  assert.equal(matrix.config.cases.length, 24);
  assert.equal(new Set(matrix.config.cases.map(row => row.port)).size, 24);
  for (const name of ['expired.pem', 'expired-root.pem', 'expired-selfsigned.pem']) {
    const pem = fs.readFileSync(path.join(path.dirname(matrix.rootPath), name), 'utf8');
    assert.match(pem, /^-----BEGIN CERTIFICATE-----\n/);
    assert.equal(new X509Certificate(pem).validTo, 'Jan  1 00:00:00 2001 GMT');
    // Exact ObjC parser strips delimiters/whitespace, then strict-base64 decodes.
    const base64 = pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '');
    assert.equal(Buffer.from(base64, 'base64').toString('base64'), base64);
  }
  for (const row of matrix.config.cases) {
    // Use the actual production PEM validation without loading or replacing its
    // native bridge. A rejected test input cannot claim a native trust result.
    assert.doesNotThrow(() => productionTransport.forNode({ host: row.host, port: row.port,
      useSSL: true, useKeeperNode: false, tlsCa: row.ca }), row.id);
    const actual = await new Promise(resolve => {
      let done = false, data = '';
      const socket = tls.connect({ host: row.host, port: row.port, ca: row.ca || undefined,
        rejectUnauthorized: true }, () => socket.write(matrix.config.nonce + ':' + row.id + '\n'));
      const timer = setTimeout(() => finish('TIMEOUT'), 4000);
      function finish(value) { if (done) return; done = true; clearTimeout(timer); socket.destroy(); resolve(value); }
      socket.on('error', () => finish('REJECT'));
      socket.on('data', chunk => {
        data += chunk;
        if (data.includes('\n')) finish(data === matrix.config.nonce + ':' + row.id + ':verified\n' ? 'ACCEPT' : 'BAD_REPLY');
      });
    });
    assert.equal(actual, row.expected, row.id);
  }
  await new Promise(resolve => setImmediate(resolve));
  for (const row of matrix.config.cases) {
    const witness = matrix.snapshot()[row.id];
    assert.equal(witness.connections, 1, row.id);
    assert.equal(witness.requests, row.expected === 'ACCEPT' ? 1 : 0, row.id);
    assert.equal(witness.invalid_payloads, 0, row.id);
  }
  assert.equal(fs.existsSync(matrix.rootPath), true);
});

test('unreviewed native policy bytes cannot become a simulator executable', () => {
  assert.throws(() => program(Buffer.from('replacement'), Buffer.from('replacement')), /IOS_POLICY_SOURCE_CHANGED/);
});
