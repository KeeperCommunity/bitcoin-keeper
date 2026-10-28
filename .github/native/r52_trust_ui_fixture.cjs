'use strict';
// Controlled Electrum protocol fixture. No Relay, public network, wallet or key evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const http = require('node:http');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const STAGES = ['baseline', 'custom_saved', 'failed_update_preserved', 'cold_reopen',
  'disconnected', 'reconnected', 'untrusted_peer_rejected', 'selfsigned_saved', 'fixture_nodes_removed'];
const copy = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function validateObservation(config, value) {
  if (!value || Object.keys(value).sort().join() !== 'active_port,boot,connected,nonce,platform,realm_version,rows,schema' ||
      value.schema !== 1 || value.nonce !== config.nonce || value.platform !== config.platform ||
      value.realm_version !== 110 || !/^[a-z0-9]{10,60}$/.test(value.boot) ||
      typeof value.connected !== 'boolean' || ![null, config.a.port, config.b.port, config.c.port].includes(value.active_port) ||
      !Array.isArray(value.rows) || value.rows.length > 2) throw new Error('TRUST_OBSERVER_SHAPE');
  let prior = 0;
  for (const n of value.rows) {
    if (Object.keys(n).sort().join() !== 'ca_sha256,host,id,isConnected,networkType,port,useKeeperNode,useSSL' ||
        !Number.isInteger(n.id) || n.id <= 0 || ![config.a.port, config.b.port, config.c.port].includes(n.port) || n.port <= prior ||
        n.host !== '127.0.0.1' || n.useSSL !== true || n.useKeeperNode !== false ||
        typeof n.isConnected !== 'boolean' || n.networkType !== 'TESTNET' ||
        (n.ca_sha256 !== null && !/^[a-f0-9]{64}$/.test(n.ca_sha256))) throw new Error('TRUST_OBSERVER_ROW');
    prior = n.port;
  }
  return copy(value);
}
function verifyStage(config, previous, stage, observation, witness) {
  const position = previous.length;
  if (STAGES[position] !== stage) throw new Error('TRUST_STAGE_ORDER');
  const obs = validateObservation(config, observation);
  const last = previous.at(-1);
  const a = obs.rows.find(n => n.port === config.a.port), c = obs.rows.find(n => n.port === config.c.port);
  const saved = previous.find(s => s.stage === 'custom_saved');
  const connectedA = () => a && a.ca_sha256 === sha(config.a.ca.trim()) && a.isConnected &&
    obs.connected && obs.active_port === config.a.port;
  const unchangedA = () => a && saved && a.id === saved.observation.rows[0].id &&
    a.ca_sha256 === saved.observation.rows[0].ca_sha256;
  if (Object.keys(witness).sort().join() !== 'a,b,c' || Object.values(witness).some(w =>
      Object.keys(w).sort().join() !== 'connections,invalid,versions' ||
      Object.values(w).some(n => !Number.isSafeInteger(n) || n < 0) || w.invalid !== 0))
    throw new Error('TRUST_SERVER_WITNESS');
  let valid = false;
  switch (stage) {
    case 'baseline': valid = obs.rows.length === 0 && witness.a.connections === 0 && witness.b.connections === 0; break;
    case 'custom_saved': valid = obs.rows.length === 1 && connectedA() && witness.a.versions >= 2; break;
    case 'failed_update_preserved':
      valid = same(obs.rows, last.observation.rows) && connectedA() &&
        witness.a.connections > last.witness.a.connections && witness.a.versions === last.witness.a.versions; break;
    case 'cold_reopen': valid = obs.boot !== last.observation.boot && obs.rows.length === 1 && unchangedA() &&
      connectedA() && witness.a.versions > last.witness.a.versions; break;
    case 'disconnected': valid = obs.rows.length === 1 && unchangedA() && !a.isConnected && !obs.connected; break;
    case 'reconnected': valid = obs.rows.length === 1 && unchangedA() && connectedA() &&
      witness.a.versions > last.witness.a.versions; break;
    case 'untrusted_peer_rejected': valid = same(obs.rows, last.observation.rows) && connectedA() &&
      witness.b.connections > last.witness.b.connections && witness.b.versions === 0; break;
    case 'fixture_nodes_removed': valid = obs.rows.length === 0 && !obs.connected; break;
    case 'selfsigned_saved': valid = obs.rows.length === 2 && unchangedA() && c && c.id !== a.id &&
      c.ca_sha256 === sha(config.c.ca.trim()) && c.isConnected && obs.connected &&
      obs.active_port === config.c.port && witness.c.versions >= 2 && witness.b.versions === 0; break;
  }
  if (!valid) throw new Error('TRUST_STAGE_EVIDENCE');
  return { stage, status: 'PASS', observation: obs, witness: copy(witness) };
}

async function createFixture(platform, httpPort = 8768) {
  if (!['IOS', 'ANDROID'].includes(platform)) throw new Error('TRUST_PLATFORM');
  // Bootstrap imports the pure receipt validators before app/test files exist.
  // Actual fixture execution still requires the unchanged certificate producer.
  const { certificates } = require('../../tests/electrum/fixtures.cjs');
  const identity = certificates(), services = [], sockets = new Set(), stages = [];
  const nonce = crypto.randomBytes(24).toString('hex'), metricToken = crypto.randomBytes(24).toString('hex');
  const witness = Object.fromEntries(['a', 'b', 'c'].map(name => [name, { connections: 0, versions: 0, invalid: 0 }]));
  let observer = null, serial = 0, busy = false, closed = false;
  async function listen(service, port) {
    services.push(service);
    service.on('connection', socket => { sockets.add(socket); socket.on('error', () => {});
      socket.on('close', () => sockets.delete(socket)); });
    await new Promise((resolve, reject) => { service.once('error', reject); service.listen(port, '127.0.0.1', resolve); });
    return service.address().port;
  }
  async function endpoint(name, cert, ca, key) {
    const service = tls.createServer({ cert: identity.read(cert), key: identity.read(key), minVersion: 'TLSv1.2' }, socket => {
      socket.setEncoding('utf8'); let buffered = '';
      socket.on('data', data => {
        buffered += data;
        if (buffered.length > 65536) { witness[name].invalid++; socket.destroy(); return; }
        while (buffered.includes('\n')) {
          const at = buffered.indexOf('\n'), raw = buffered.slice(0, at); buffered = buffered.slice(at + 1);
          try {
            const parsed = JSON.parse(raw), batch = Array.isArray(parsed);
            const queries = batch ? parsed : [parsed];
            if (queries.length < 1 || queries.length > 200) throw new Error('RPC_BATCH_SIZE');
            const replies = queries.map(q => {
              if (!q || !Number.isInteger(q.id) || typeof q.method !== 'string') throw new Error('RPC_SHAPE');
              let result;
              if (q.method === 'server.version') { witness[name].versions++; result = ['keeper-r52-' + nonce, '1.4']; }
              else if (q.method === 'server.ping') result = null;
              else if (q.method === 'blockchain.headers.subscribe') result = { height: 0, hex: '00'.repeat(80) };
              else if (q.method === 'blockchain.scripthash.get_history' || q.method === 'blockchain.scripthash.listunspent') result = [];
              else if (q.method === 'blockchain.scripthash.get_balance') result = { confirmed: 0, unconfirmed: 0 };
              else if (q.method === 'blockchain.estimatefee') result = 0.00001;
              else return { id: q.id, error: { code: -32601, message: 'Controlled fixture method unavailable' } };
              return { id: q.id, result };
            });
            socket.write(JSON.stringify(batch ? replies : replies[0]) + '\n');
          } catch (_) { witness[name].invalid++; socket.destroy(); return; }
        }
      });
    });
    service.on('tlsClientError', () => {});
    service.on('connection', () => witness[name].connections++);
    const port = await listen(service, 0);
    return { port, ca: new crypto.X509Certificate(identity.read(ca)).toString().trim() };
  }
  async function close() {
    if (closed) return; closed = true;
    for (const s of sockets) s.destroy();
    try { await Promise.all(services.map(s => new Promise(resolve => s.close(resolve)))); }
    finally { identity.cleanup(); }
  }
  try {
    if (platform === 'IOS') {
      // iOS requires the positive self-signed identity to be a TLS server leaf.
      // Preserve the generated key, CN and SAN; a CA-only profile fails EKU policy.
      const certificate = path.join(identity.dir, 'selfsigned.pem');
      execFileSync('openssl', ['req', '-x509', '-new', '-key', path.join(identity.dir, 'selfsigned.key'),
        '-out', certificate, '-days', '2', '-subj', '/CN=selfsigned',
        '-addext', 'basicConstraints=critical,CA:FALSE',
        '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment',
        '-addext', 'extendedKeyUsage=serverAuth',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'],
        { stdio: 'pipe', timeout: 30000, maxBuffer: 65536 });
      fs.writeFileSync(certificate, new crypto.X509Certificate(fs.readFileSync(certificate)).toString());
    }
    const a = await endpoint('a', 'custom-leaf.pem', 'custom.pem', 'leaf.key');
    // B would succeed if A's CA leaked to another port. C independently exercises self-signed trust.
    const b = await endpoint('b', 'custom-leaf.pem', 'custom.pem', 'leaf.key');
    const c = await endpoint('c', 'selfsigned.pem', 'selfsigned.pem', 'selfsigned.key');
    const config = { schema: 1, nonce, platform, a, b, c };
    const control = http.createServer(async (req, res) => {
      function answer(status, value) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
      if (req.method !== 'POST' || !['/observe', '/metric'].includes(req.url)) { answer(404, {}); return; }
      try {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 16384) { req.destroy(); return; } }
        const body = JSON.parse(raw);
        if (req.url === '/observe') {
          observer = validateObservation(config, body); serial++; answer(200, {}); return;
        }
        if (busy || body.token !== metricToken || Object.keys(body).sort().join() !== 'stage,token' || STAGES[stages.length] !== body.stage)
          throw new Error('METRIC_SCOPE');
        busy = true;
        const before = serial;
        try {
          let record;
          for (let attempt = 0; attempt < 150 && !closed; attempt++) {
            if (serial > before && observer) {
              try { record = verifyStage(config, stages, body.stage, observer, witness); break; } catch (_) {}
            }
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          if (!record) throw new Error('METRIC_EVIDENCE');
          stages.push(record); answer(200, { stage: record.stage, status: 'PASS' });
        } finally { busy = false; }
      } catch (_) { answer(409, { status: 'REJECTED' }); }
    });
    const port = await listen(control, httpPort);
    return { config, metricToken, httpPort: port, close,
      snapshot: () => ({ schema: 1, nonce, platform, status: stages.length === STAGES.length ? 'PASS' : 'INCOMPLETE',
        scope: 'ACTUAL_NORMAL_PRODUCT_UI_WITH_READ_ONLY_NATIVE_REALM_OBSERVER', stages: copy(stages), witness: copy(witness) }) };
  } catch (error) { await close(); throw error; }
}
async function main() {
  const target = path.resolve(__dirname, '.generated/r52_trust_ui.json');
  if (process.argv.length !== 3) throw new Error('TRUST_ARGUMENTS');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (fs.realpathSync(path.dirname(target)) !== path.dirname(target)) throw new Error('TRUST_ALIAS');
  const fixture = await createFixture(process.argv[2]); let owns = false;
  try {
    const raw = JSON.stringify(fixture.config);
    fs.writeFileSync(target, raw, { flag: 'wx', mode: 0o600 }); owns = true;
    process.stdout.write(JSON.stringify({ ready: true, sha256: sha(raw), metric_token: fixture.metricToken,
      ports: [fixture.config.a.port, fixture.config.b.port, fixture.config.c.port], http_port: fixture.httpPort }) + '\n');
    for await (const line of readline.createInterface({ input: process.stdin })) {
      if (line === 'snapshot') process.stdout.write(JSON.stringify(fixture.snapshot()) + '\n');
      else if (line === 'close') break;
      else throw new Error('TRUST_COMMAND');
    }
  } finally { try { await fixture.close(); } finally { if (owns) fs.unlinkSync(target); } }
}
module.exports = { createFixture, validateObservation, verifyStage, STAGES };
if (require.main === module) main().catch(() => { process.stderr.write('Trust UI fixture failed.\n'); process.exitCode = 1; });
