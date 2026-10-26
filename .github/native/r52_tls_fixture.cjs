'use strict';
// Owned loopback endpoints only. Private fixture keys never enter Metro or receipts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const readline = require('node:readline');
const { certificates, publicKeyCertificates } = require('../../tests/electrum/fixtures.cjs');
const { createRpcFixture } = require('./r52_rpc_fixture.cjs');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function server(fixture, identity, handler) {
  const sockets = new Set();
  const service = tls.createServer({
    key: fixture.read(identity.includes('selfsigned') ? 'selfsigned.key' : 'leaf.key'),
    cert: fixture.read(identity + '.pem'), minVersion: 'TLSv1.2',
  }, handler);
  service.on('tlsClientError', () => {});
  service.on('connection', socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => { service.once('error', reject); service.listen(0, '127.0.0.1', resolve); });
  return { service, port: service.address().port, resetConnections: () => {
    const active = [...sockets];
    for (const socket of active) socket.resetAndDestroy();
    return active.length;
  }, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => service.close(resolve));
  } };
}

async function createMatrix(platform) {
  if (!['IOS', 'ANDROID'].includes(platform)) throw new Error('TLS_PLATFORM');
  const fixture = certificates(), services = [], witnesses = {};
  const nonce = crypto.randomBytes(24).toString('hex');
  const cases = [];
  async function add(id, identity, anchor, expected) {
    const witness = { connections: 0, secure_connections: 0, requests: 0, invalid_payloads: 0 };
    witnesses[id] = witness;
    const service = await server(fixture, identity, socket => {
      witness.secure_connections++;
      let data = ''; socket.setEncoding('utf8');
      socket.on('data', chunk => {
        data += chunk;
        if (data.length > 4096) { witness.invalid_payloads++; socket.destroy(); return; }
        if (!data.includes('\n')) return;
        if (data === nonce + ':' + id + '\n') {
          witness.requests++;
          socket.end(nonce + ':' + id + ':verified\n');
        } else { witness.invalid_payloads++; socket.destroy(); }
      });
    });
    // A separate plain TCP connection witness distinguishes certificate rejection
    // from an unreachable fixture or absent Android reverse mapping.
    service.service.on('connection', () => witness.connections++);
    services.push(service);
    // openssl ca includes a textual certificate dump before PEM. The real app
    // deliberately accepts one PEM certificate only; preserve DER/validity but
    // canonicalize the fixture container so expired anchors reach native code.
    cases.push({ id, host: '127.0.0.1', port: service.port,
      ca: anchor === null ? null : new crypto.X509Certificate(anchor).toString(), expected });
  }
  try {
    // Both the actual RN adapter and exact Objective-C PEM parser consume one
    // certificate, never OpenSSL's human-readable ca dump. Normalize only owned
    // generated certificate files; DER, key material and validity stay identical.
    for (const name of fs.readdirSync(fixture.dir).filter(file => file.endsWith('.pem'))) {
      const filename = path.join(fixture.dir, name);
      fs.writeFileSync(filename, new crypto.X509Certificate(fs.readFileSync(filename)).toString());
    }
    const root = fixture.read('root.pem'), custom = fixture.read('custom.pem');
    await add('explicit_root_valid_before', 'valid', root, 'ACCEPT');
    await add('selfsigned_untrusted', 'selfsigned', null, 'REJECT');
    await add('expired_leaf', 'expired', root, 'REJECT');
    await add('wrong_host', 'wronghost', root, 'REJECT');
    await add('forged_signature', 'forged', root, 'REJECT');
    await add('explicit_custom_ca', 'custom-leaf', custom, 'ACCEPT');
    await add('explicit_selfsigned_leaf', 'selfsigned', fixture.read('selfsigned.pem'), 'ACCEPT');
    await add('explicit_wrong_host', 'wronghost', fixture.read('wronghost.pem'), 'REJECT');
    await add('expired_custom_ca', 'valid', fixture.read('expired-root.pem'), 'REJECT');
    await add('expired_selfsigned_leaf', 'expired-selfsigned', fixture.read('expired-selfsigned.pem'), 'REJECT');
    await add('custom_trust_not_inherited', 'custom-leaf', null, 'REJECT');
    await add('wrong_custom_anchor', 'valid', custom, 'REJECT');
    const publicRoots = path.resolve(__dirname, '../../tests/electrum/public-trust/roots');
    const rootManifest = JSON.parse(fs.readFileSync(path.join(publicRoots, 'manifest.json')));
    // The committed fixtures are public certificates, never private keys.
    const roots = fs.readdirSync(publicRoots).filter(n => n.endsWith('.pem')).sort();
    if (roots.length !== 3 || rootManifest.roots?.length !== 3) throw new Error('TLS_ROOT_FIXTURES');
    for (let i = 0; i < roots.length; i++) {
      const pem = fs.readFileSync(path.join(publicRoots, roots[i]), 'utf8');
      const entry = rootManifest.roots.find(row => row.file === roots[i]);
      if (!entry || sha(new crypto.X509Certificate(pem).raw) !== entry.certificate_der_sha256)
        throw new Error('TLS_ROOT_FIXTURE_DIGEST');
      await add('withdrawn_anchor_' + i, 'valid', pem, 'REJECT');
    }
    for (const [i, entry] of publicKeyCertificates(fixture).entries())
      await add('compromised_spki_anchor_' + i, 'valid', fs.readFileSync(entry.cert, 'utf8'), 'REJECT');
    await add('explicit_root_valid_after', 'valid', root, 'ACCEPT');
    if (platform === 'IOS') await add('disposable_simulator_system_root', 'valid', null, 'ACCEPT');
    const rpc = await createRpcFixture({ fixture, nonce, createServer: server });
    services.push(rpc);
    const config = { schema: 1, platform, nonce, cases, rpc: rpc.config };
    return { config, config_sha256: sha(JSON.stringify(config)), rootPath: path.join(fixture.dir, 'root.pem'),
      snapshot: () => JSON.parse(JSON.stringify(witnesses)), rpcSnapshot: rpc.snapshot,
      ports: [...cases.map(row => row.port), ...rpc.ports],
      close: async () => { await Promise.all(services.map(s => s.close())); fixture.cleanup(); } };
  } catch (error) { await Promise.all(services.map(s => s.close())); fixture.cleanup(); throw error; }
}

async function main() {
  const platform = process.argv[2], target = path.resolve(process.argv[3] || '');
  const expected = path.resolve(__dirname, '.generated/r52_tls_fixture.json');
  if (target !== expected || process.argv.length !== 4) throw new Error('TLS_FIXTURE_OUTPUT');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (fs.realpathSync(path.dirname(target)) !== path.dirname(target)) throw new Error('TLS_FIXTURE_ALIAS');
  const matrix = await createMatrix(platform);
  let finished = false, ownsTarget = false;
  async function close() {
    if (finished) return;
    finished = true;
    try { await matrix.close(); } finally { if (ownsTarget) fs.unlinkSync(target); }
  }
  try {
    fs.writeFileSync(target, JSON.stringify(matrix.config), { mode: 0o600, flag: 'wx' });
    ownsTarget = true;
    process.stdout.write(JSON.stringify({ ready: true, config_sha256: matrix.config_sha256,
      ports: matrix.ports, rootPath: matrix.rootPath,
      cases: matrix.config.cases.map(({ id, expected }) => ({ id, expected })) }) + '\n');
    const input = readline.createInterface({ input: process.stdin });
    for await (const line of input) {
      if (line === 'snapshot') process.stdout.write(JSON.stringify({ tls: matrix.snapshot(), rpc: matrix.rpcSnapshot() }) + '\n');
      else if (line === 'close') break;
      else throw new Error('TLS_FIXTURE_COMMAND');
    }
  } finally { await close(); }
}
module.exports = { createMatrix };
if (require.main === module) main().catch(() => { process.stderr.write('TLS fixture failed.\n'); process.exitCode = 1; });
