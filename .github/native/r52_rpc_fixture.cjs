'use strict';
// Extends the owned TLS matrix with disposable RPC responses and a forced TCP reset.
// Never forwards requests, logs caller parameters, or accepts a real transaction.
const crypto = require('node:crypto');
const http = require('node:http');
const sha = input => crypto.createHash('sha256').update(input).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const STAGES = ['drop_after_rpc', 'selected_retry', 'other_untrusted', 'other_explicit', 'disconnected'];

async function createRpcFixture({ fixture, nonce, createServer }) {
  const services = [], controls = new Set(), stages = [];
  const witness = Object.fromEntries(['selected', 'other'].map(id => [id, {
    connections: 0, secure_connections: 0, invalid: 0, versions: 0, methods: {}, drops: 0,
  }]));
  const expected = { scripthash: Buffer.from(crypto.createHash('sha256').update(Buffer.concat([
    Buffer.from([0, 20]), Buffer.alloc(20, 7)])).digest()).reverse().toString('hex'),
    txid: sha(nonce + ':synthetic-txid'), height: 123, value: 7000,
    header_hex: '00'.repeat(80), fee_btc_per_kb: 0.0001024, fee_sat_per_byte: 10,
    fake_transaction: 'keeper-r52-invalid-nontransaction:' + nonce };
  let closed = false;
  function response(name, q) {
    const w = witness[name];
    if (!q || !Number.isInteger(q.id) || !Array.isArray(q.params)) throw new Error('RPC_SHAPE');
    let result;
    const params = JSON.stringify(q.params);
    if (q.method === 'server.version' && q.params.length === 2) {
      w.versions++; result = ['keeper-native-r52-' + nonce, '1.4'];
    } else if (q.method === 'server.ping' && params === '[]') result = null;
    else if (name === 'selected' && q.method === 'blockchain.headers.subscribe' && params === '[]')
      result = { height: expected.height, hex: expected.header_hex };
    else if (name === 'selected' && q.method === 'blockchain.scripthash.listunspent' && params === JSON.stringify([expected.scripthash]))
      result = [{ tx_hash: expected.txid, tx_pos: 0, value: expected.value, height: expected.height }];
    else if (name === 'selected' && q.method === 'blockchain.scripthash.get_history' && params === JSON.stringify([expected.scripthash]))
      result = [{ tx_hash: expected.txid, height: expected.height }];
    else if (name === 'selected' && q.method === 'blockchain.estimatefee' && params === '[2]') result = expected.fee_btc_per_kb;
    else if (name === 'selected' && q.method === 'blockchain.transaction.broadcast' && params === JSON.stringify([expected.fake_transaction]))
      result = expected.txid;
    else throw new Error('RPC_METHOD_OR_SYNTHETIC_PARAMETERS');
    w.methods[q.method] = (w.methods[q.method] || 0) + 1;
    return { jsonrpc: '2.0', id: q.id, result };
  }
  async function endpoint(name) {
    const w = witness[name];
    const service = await createServer(fixture, 'custom-leaf', socket => {
      w.secure_connections++; let buffer = ''; socket.setEncoding('utf8');
      socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 16384) { w.invalid++; socket.destroy(); return; }
        while (buffer.includes('\n')) {
          const at = buffer.indexOf('\n'), raw = buffer.slice(0, at); buffer = buffer.slice(at + 1);
          try {
            const parsed = JSON.parse(raw), batch = Array.isArray(parsed);
            const queries = batch ? parsed : [parsed];
            if (queries.length !== 1) throw new Error('ONE_SYNTHETIC_ADDRESS_ONLY');
            const replies = queries.map(q => response(name, q));
            socket.write(JSON.stringify(batch ? replies : replies[0]) + '\n');
          } catch (_) { w.invalid++; socket.destroy(); return; }
        }
      });
    });
    service.service.on('connection', () => w.connections++);
    services.push(service);
    return service;
  }
  async function close() {
    if (closed) return; closed = true;
    for (const socket of controls) socket.destroy();
    await Promise.all(services.map(s => s.close()));
  }
  try {
    const a = await endpoint('selected'), b = await endpoint('other');
    const control = http.createServer(async (request, reply) => {
      const answer = (code, body) => { reply.writeHead(code, { 'Content-Type': 'application/json' }); reply.end(JSON.stringify(body)); };
      try {
        if (request.method !== 'POST' || request.url !== '/control') throw new Error('CONTROL_ROUTE');
        let raw = '';
        for await (const chunk of request) { raw += chunk; if (raw.length > 1024) throw new Error('CONTROL_SIZE'); }
        const body = JSON.parse(raw), stage = STAGES[stages.length];
        if (body.nonce !== nonce || body.stage !== stage || Object.keys(body).sort().join() !== 'nonce,stage')
          throw new Error('CONTROL_SCOPE');
        const x = witness.selected, y = witness.other;
        if (x.invalid || y.invalid) throw new Error('CONTROL_INVALID_RPC');
        const rpcMethods = ['blockchain.headers.subscribe', 'blockchain.scripthash.listunspent',
          'blockchain.scripthash.get_history', 'blockchain.estimatefee', 'blockchain.transaction.broadcast'];
        if (rpcMethods.some(method => x.methods[method] !== 1)) throw new Error('CONTROL_RPC_INCOMPLETE');
        if (stage === 'drop_after_rpc') {
          if (x.connections !== 1 || x.versions !== 1 || y.connections !== 0 || x.drops !== 0)
            throw new Error('CONTROL_INITIAL_CLIENT');
          const reset = a.resetConnections();
          if (reset !== 1) throw new Error('CONTROL_ONE_SELECTED_SOCKET_REQUIRED');
          x.drops++;
        } else {
          if (x.connections !== 2 || x.versions !== 2 || x.drops !== 1) throw new Error('CONTROL_SELECTED_RETRY');
          if (stage === 'selected_retry' && y.connections !== 0) throw new Error('CONTROL_OTHER_TOUCHED_EARLY');
          if (stage === 'other_untrusted' && (y.connections !== 1 || y.versions !== 0 || y.secure_connections !== 0)) throw new Error('CONTROL_OTHER_NOT_REJECTED');
          if (['other_explicit', 'disconnected'].includes(stage) && (y.connections !== 2 || y.versions !== 1 || y.secure_connections !== 1))
            throw new Error('CONTROL_OTHER_EXPLICIT');
        }
        stages.push({ id: stage, status: 'PASS', witnesses: copy(witness) });
        answer(200, { stage, status: 'PASS' });
      } catch (_) { answer(409, { status: 'REJECTED' }); }
    });
    control.on('connection', socket => { controls.add(socket); socket.on('error', () => {});
      socket.on('close', () => controls.delete(socket)); });
    services.push({ close: () => new Promise(resolve => control.close(resolve)) });
    await new Promise((resolve, reject) => { control.once('error', reject); control.listen(0, '127.0.0.1', resolve); });
    const controlPort = control.address().port;
    const ca = fixture.read('custom.pem').trim();
    const config = { schema: 1, selected: { host: '127.0.0.1', port: a.port, ca },
      other: { host: '127.0.0.1', port: b.port, ca }, control_port: controlPort, expected };
    return { config, ports: [a.port, b.port, controlPort], close,
      snapshot: () => ({ schema: 1, nonce, scope: 'OWNED_SYNTHETIC_RPC_SERVER_WITNESSES',
        status: stages.length === STAGES.length ? 'PASS' : 'INCOMPLETE', stages: copy(stages), witnesses: copy(witness) }) };
  } catch (error) { await close(); throw error; }
}
module.exports = { createRpcFixture, STAGES };
