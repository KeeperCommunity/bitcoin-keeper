'use strict';
// Real host TLS + pinned Electrum package only, never app/native acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const tls = require('node:tls');
const { createMatrix } = require('../native/r52_tls_fixture.cjs');
const Electrum = require(process.env.ELECTRUM_PACKAGE || 'electrum-client');

test('owned RPC fixture binds synthetic app inputs, forces real reset and discriminates peer trust', async () => {
  const matrix = await createMatrix('ANDROID'), rpc = matrix.config.rpc, clients = [];
  let errors = 0;
  function client(endpoint, ca) {
    const c = new Electrum(null, { connect: (options, cb) => tls.connect({ ...options, ca,
      rejectUnauthorized: true }, cb) }, endpoint.port, endpoint.host, 'tls');
    c.onError = () => { errors++; c.close(); };
    clients.push(c); return c;
  }
  const init = c => c.initElectrum({ client: 'host-fixture-control', version: '1.4' }, { maxRetry: 0 });
  const control = async stage => {
    const reply = await fetch('http://127.0.0.1:' + rpc.control_port + '/control', {
      method: 'POST', body: JSON.stringify({ nonce: matrix.config.nonce, stage }) });
    assert.equal(reply.status, 200, stage);
  };
  try {
    const a = client(rpc.selected, rpc.selected.ca); await init(a);
    assert.deepEqual(await a.blockchainHeaders_subscribe(), { height: 123, hex: rpc.expected.header_hex });
    assert.equal((await a.blockchainScripthash_listunspentBatch([rpc.expected.scripthash]))[0].result[0].value, 7000);
    assert.equal((await a.blockchainScripthash_getHistoryBatch([rpc.expected.scripthash]))[0].result[0].tx_hash, rpc.expected.txid);
    assert.equal(await a.blockchainEstimatefee(2), rpc.expected.fee_btc_per_kb);
    assert.equal(await a.blockchainTransaction_broadcast(rpc.expected.fake_transaction), rpc.expected.txid);
    await control('drop_after_rpc');
    for (let i = 0; errors === 0 && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(errors, 1, 'Actual reset must reach TLS client error handler');
    // This host test starts a replacement itself. Only the separate RN driver
    // can prove production automatic reconnect and connection generation.
    const replacement = client(rpc.selected, rpc.selected.ca); await init(replacement);
    await control('selected_retry');
    const denied = client(rpc.other); await assert.rejects(init(denied)); denied.close();
    await control('other_untrusted');
    const allowed = client(rpc.other, rpc.selected.ca); await init(allowed); allowed.close();
    await control('other_explicit');
    replacement.close(); await control('disconnected');
    const witness = matrix.rpcSnapshot();
    assert.equal(witness.status, 'PASS'); assert.equal(witness.witnesses.selected.connections, 2);
    assert.equal(witness.witnesses.other.versions, 1); assert.equal(witness.witnesses.selected.invalid, 0);
    const stale = await fetch('http://127.0.0.1:' + rpc.control_port + '/control', {
      method: 'POST', body: JSON.stringify({ nonce: matrix.config.nonce, stage: 'selected_retry' }) });
    assert.equal(stale.status, 409);
  } finally { clients.forEach(c => c.close()); await matrix.close(); }
});
test('fixture refuses out-of-order controls and any broadcast except the bound invalid text', async () => {
  const matrix = await createMatrix('ANDROID'), rpc = matrix.config.rpc;
  const c = new Electrum(null, { connect: (options, cb) => tls.connect({ ...options,
    ca: rpc.selected.ca, rejectUnauthorized: true }, cb) }, rpc.selected.port, rpc.selected.host, 'tls');
  c.onError = () => c.close();
  try {
    const early = await fetch('http://127.0.0.1:' + rpc.control_port + '/control', {
      method: 'POST', body: JSON.stringify({ nonce: matrix.config.nonce, stage: 'drop_after_rpc' }) });
    assert.equal(early.status, 409);
    await c.initElectrum({ client: 'host-negative-control', version: '1.4' }, { maxRetry: 0 });
    await assert.rejects(c.blockchainTransaction_broadcast('00'.repeat(100)));
    assert.equal(matrix.rpcSnapshot().status, 'INCOMPLETE');
    assert.equal(matrix.rpcSnapshot().witnesses.selected.invalid, 1);
    assert.equal(matrix.rpcSnapshot().witnesses.selected.methods['blockchain.transaction.broadcast'], undefined);
  } finally { c.close(); await matrix.close(); }
});
