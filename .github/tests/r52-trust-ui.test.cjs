'use strict';
// Host controls only: zero app/native acceptance credit.
const test = require('node:test');
const assert = require('node:assert/strict');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { createFixture, verifyStage, validateObservation, STAGES } = require('../native/r52_trust_ui_fixture.cjs');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const copy = v => JSON.parse(JSON.stringify(v));
const config = { schema: 1, nonce: 'a'.repeat(48), platform: 'IOS', a: { port: 4001, ca: 'A' }, b: { port: 4002, ca: 'A' }, c: { port: 4003, ca: 'C' } };
const row = (port, ca, id) => ({ id, host: '127.0.0.1', port, useSSL: true, useKeeperNode: false,
  isConnected: true, networkType: 'TESTNET', ca_sha256: sha(ca) });
const observation = rows => ({ schema: 1, nonce: config.nonce, platform: 'IOS', boot: 'bootone12345',
  realm_version: 110, rows, connected: false, active_port: null });
function chain() {
  const stages = [], obs = observation([]), witness = Object.fromEntries(['a', 'b', 'c'].map(name => [name, { connections: 0, versions: 0, invalid: 0 }]));
  function mark(stage) { const record = verifyStage(config, stages, stage, obs, witness); stages.push(record); }
  mark('baseline');
  obs.rows = [row(4001, 'A', 1001)]; obs.connected = true; obs.active_port = 4001;
  witness.a.connections = 2; witness.a.versions = 2; mark('custom_saved');
  witness.a.connections++; mark('failed_update_preserved');
  obs.boot = 'boottwo12345'; witness.a.connections++; witness.a.versions++; mark('cold_reopen');
  obs.connected = false; obs.rows[0].isConnected = false; mark('disconnected');
  obs.connected = true; obs.rows[0].isConnected = true; witness.a.connections++; witness.a.versions++; mark('reconnected');
  witness.b.connections++; mark('untrusted_peer_rejected');
  obs.rows.push(row(4003, 'C', 1002)); obs.active_port = 4003; witness.c.connections += 2; witness.c.versions += 2; mark('selfsigned_saved');
  obs.rows = []; obs.connected = false; mark('fixture_nodes_removed');
  return stages;
}
test('all UI evidence stages bind persisted trust, fresh process, probe and connection witnesses', () => {
  const stages = chain(); assert.deepEqual(stages.map(s => s.stage), STAGES);
  for (const [index, stage] of stages.entries()) {
    if (index > 0) assert.throws(() => verifyStage(config, stages.slice(0, index - 1), stage.stage, stage.observation, stage.witness), /ORDER/);
  }
  for (const [index, mutate] of [
    [2, s => { s.observation.rows[0].ca_sha256 = sha('B'); }],
    [2, s => { s.witness.a.connections--; }],
    [2, s => { s.witness.a.versions++; }],
    [3, s => { s.observation.boot = stages[2].observation.boot; }],
    [3, s => { s.observation.rows[0].id++; }],
    [5, s => { s.witness.a.versions--; }],
    [6, s => { s.witness.b.connections = 0; }],
    [6, s => { s.witness.b.versions = 1; }],
    [7, s => { s.observation.rows[1].ca_sha256 = sha('A'); }],
    [8, s => { s.observation.rows = stages[7].observation.rows; }],
  ]) {
    const invalid = copy(stages[index]); mutate(invalid);
    assert.throws(() => verifyStage(config, stages.slice(0, index), invalid.stage, invalid.observation, invalid.witness));
  }
  assert.throws(() => validateObservation(config, { ...observation([]), app_id: 'must-not-export' }), /SHAPE/);
  assert.throws(() => validateObservation(config, { ...observation([]), realm_version: 109 }), /SHAPE/);
});
function rpc(endpoint, ca) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port: endpoint.port, ca, rejectUnauthorized: true }, () => {
      socket.write(JSON.stringify({ id: 1, method: 'server.version', params: ['fixture-client', '1.4'] }) + '\n');
    });
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('TIMEOUT')); });
    socket.on('error', reject); socket.once('data', data => { socket.destroy(); resolve(JSON.parse(data.toString())); });
  });
}
test('real loopback TLS RPC and absent/wrong anchors produce independent connection witnesses', async () => {
  const fixture = await createFixture('ANDROID', 0);
  try {
    assert.equal(Object.hasOwn(fixture.config, 'metricToken'), false);
    const reply = await rpc(fixture.config.a, fixture.config.a.ca);
    assert.equal(reply.result[1], '1.4'); assert.ok(reply.result[0].includes(fixture.config.nonce));
    await assert.rejects(rpc(fixture.config.a, fixture.config.c.ca));
    await assert.rejects(rpc(fixture.config.b));
    await rpc(fixture.config.b, fixture.config.a.ca); // Positive discriminator: inherited A trust WOULD accept B.
    await assert.rejects(rpc(fixture.config.c));
    await rpc(fixture.config.c, fixture.config.c.ca);
    const before = fixture.snapshot();
    assert.equal(before.status, 'INCOMPLETE'); assert.equal(before.witness.a.versions, 1);
    assert.equal(before.witness.a.connections, 2); assert.equal(before.witness.b.versions, 1);
    assert.equal(before.witness.b.connections, 2); assert.equal(before.witness.c.versions, 1);
    const rejected = await fetch(`http://127.0.0.1:${fixture.httpPort}/metric`, {
      method: 'POST', body: JSON.stringify({ stage: 'baseline', token: 'wrong' }) });
    assert.equal(rejected.status, 409); assert.deepEqual(fixture.snapshot().stages, []);
  } finally { await fixture.close(); }
});
test('pinned Electrum client batch reads are served without destabilizing normal product UI', async () => {
  const fixture = await createFixture('IOS', 0);
  const Electrum = require(process.env.ELECTRUM_PACKAGE || 'electrum-client');
  const client = new Electrum(null, { connect: (options, callback) => tls.connect({ ...options,
    rejectUnauthorized: true, ca: fixture.config.a.ca }, callback) }, fixture.config.a.port, '127.0.0.1', 'tls');
  try {
    await client.initElectrum({ client: 'disposable-host-control', version: '1.4' }, { maxRetry: 0 });
    const hash = 'ab'.repeat(32);
    assert.deepEqual((await client.blockchainScripthash_listunspentBatch([hash])).map(r => r.result), [[]]);
    assert.deepEqual((await client.blockchainScripthash_getHistoryBatch([hash])).map(r => r.result), [[]]);
    await assert.rejects(client.blockchainTransaction_broadcast('disposable-not-a-transaction'));
    assert.equal(fixture.snapshot().witness.a.invalid, 0);
  } finally { client.close(); await fixture.close(); }
});
