const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tls = require('node:tls');
const { test } = require('node:test');
const { certificates, server } = require('./fixtures.cjs');

// A Node TLS bridge exercises the real adapter and pinned Electrum client over
// loopback. Native verification is tested separately; this is not an RN run.
function adapter(roots, calls) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../../src/services/electrum/tls.js'), 'utf8');
  const bridge = { connectTLS(options, callback) {
    calls.push(options);
    assert.equal(options.rejectUnauthorized, true); assert.equal(options.tlsCheckValidity, true);
    return tls.connect({ ...options, ca: options.ca || roots, lookup: (_host, _opts, done) => {
      done(null, [{address:'127.0.0.1',family:4}]);
    } }, callback);
  } };
  vm.runInNewContext(source, { module, require(name) {
    assert.equal(name, 'react-native-tcp-socket');
    return bridge;
  } });
  return module.exports;
}

test('verified Electrum loopback RPC, reconnect and failover keep trust per selected peer', async (t) => {
  const fixture = certificates(); t.after(fixture.cleanup);
  const Electrum = require(process.env.ELECTRUM_PACKAGE || 'electrum-client');
  const calls = [], methods = [];
  const transport = adapter(fixture.read('root.pem'), calls);
  const response = {
    'server.version': ['fixture', '1.4'], 'server.ping': null,
    'blockchain.headers.subscribe': { height: 100, hex: '00'.repeat(80) },
    'blockchain.scripthash.listunspent': [], 'blockchain.scripthash.get_history': [],
    'blockchain.estimatefee': 0.00001, 'blockchain.transaction.broadcast': 'ab'.repeat(32),
  };
  const rpc = (socket) => {
    let buffer = ''; socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const i = buffer.indexOf('\n'); const request = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
        methods.push(request.method);
        socket.write(`${JSON.stringify({jsonrpc:'2.0', id:request.id, result:response[request.method]})}\n`);
      }
    });
  };
  const good = await server(fixture, 'valid', rpc), custom = await server(fixture, 'custom-leaf', rpc);
  const bad = await server(fixture, 'wronghost', rpc);
  t.after(async () => { await Promise.all([good.close(), custom.close(), bad.close()]); });
  const clients = [];
  t.after(() => clients.forEach((client) => client.close()));
  const clientFor = (service, ca) => {
    const node = { host:'localhost', port:service.port, useSSL:true, useKeeperNode:false, ...(ca ? {tlsCa:ca} : {}) };
    const selected = transport.forNode(node);
    const client = new Electrum(null, { connect(config, callback) {
      assert.equal(config.rejectUnauthorized,true,'The pinned caller must request verified TLS');
      return selected.connect(config,callback);
    } }, node.port, node.host, 'tls');
    // Disable the library's own background persistence: app-level rotation owns it.
    client.onClose = () => {}; clients.push(client); return client;
  };
  const init = (client) => client.initElectrum({client:'disposable-fixture', version:'1.4'}, {maxRetry:0});
  const first = clientFor(custom, fixture.read('custom.pem'));
  assert.deepEqual(await init(first), ['fixture', '1.4']);
  first.conn.destroy(); assert.deepEqual(await first.reconnect(), ['fixture', '1.4']);
  assert.equal(calls[0].ca, fixture.read('custom.pem').trim());
  assert.equal(calls[1].ca, calls[0].ca);
  // The next peer has no authority to inherit another node's configured CA.
  await assert.rejects(init(clientFor(custom)), /certificate|issuer|verify/i);
  await assert.rejects(init(clientFor(bad)), /hostname|altname|certificate/i);
  const next = clientFor(good); assert.deepEqual(await init(next), ['fixture', '1.4']);
  assert.equal(calls.at(-1).ca, undefined);
  assert.deepEqual(await next.blockchainHeaders_subscribe(), response['blockchain.headers.subscribe']);
  assert.deepEqual(await next.blockchainScripthash_listunspent('00'.repeat(32)), []);
  assert.deepEqual(await next.blockchainScripthash_getHistory('00'.repeat(32)), []);
  assert.equal(await next.blockchainEstimatefee(2), 0.00001);
  // Arbitrary non-transaction text reaches only the disposable RPC fixture.
  assert.equal(await next.blockchainTransaction_broadcast('disposable-not-a-transaction'), 'ab'.repeat(32));
  assert.deepEqual(methods.slice(-5), ['blockchain.headers.subscribe', 'blockchain.scripthash.listunspent',
    'blockchain.scripthash.get_history', 'blockchain.estimatefee', 'blockchain.transaction.broadcast']);
});
