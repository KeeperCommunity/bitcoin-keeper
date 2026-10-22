// Disposable loopback TLS identities. No committed private keys or live services.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function certificates() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-electrum-tls-'));
  const run = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');
  const write = (name, data) => fs.writeFileSync(path.join(dir, name), data);
  for (const name of ['root', 'custom', 'selfsigned']) {
    run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`,
      '-out', `${name}.pem`, '-days', '2', '-subj', `/CN=${name}`,
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1');
  }
  run('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key',
    '-out', 'leaf.csr', '-subj', '/CN=localhost');
  for (const [name, root, san] of [
    ['valid', 'root', 'DNS:localhost,IP:127.0.0.1'],
    ['wronghost', 'root', 'DNS:other.invalid'],
    ['custom-leaf', 'custom', 'DNS:localhost,IP:127.0.0.1'],
  ]) {
    write('ext.cnf', `basicConstraints=critical,CA:FALSE\nsubjectAltName=${san}\nextendedKeyUsage=serverAuth\n`);
    run('x509', '-req', '-in', 'leaf.csr', '-CA', `${root}.pem`, '-CAkey', `${root}.key`,
      '-set_serial', String(100 + name.length), '-out', `${name}.pem`, '-days', '1', '-extfile', 'ext.cnf');
  }
  write('index', ''); write('serial', '20\n');
  write('ca.cnf', `[ca]\ndefault_ca=fixture\n[fixture]\ndatabase=index\nserial=serial\nnew_certs_dir=.\ncertificate=root.pem\nprivate_key=root.key\ndefault_md=sha256\npolicy=policy\n[policy]\ncommonName=supplied\n[server]\nbasicConstraints=critical,CA:FALSE\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n`);
  run('ca', '-batch', '-config', 'ca.cnf', '-in', 'leaf.csr', '-out', 'expired.pem',
    '-startdate', '20000101000000Z', '-enddate', '20010101000000Z', '-extensions', 'server');
  for (const name of ['root', 'selfsigned']) {
    run('req', '-new', '-key', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name}`);
    write('expired.cnf', read('ca.cnf').replace('certificate=root.pem', `certificate=${name}.pem`)
      .replace('private_key=root.key', `private_key=${name}.key`) +
      '[anchor]\nbasicConstraints=critical,CA:TRUE\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
    run('ca', '-batch', '-selfsign', '-config', 'expired.cnf', '-in', `${name}.csr`,
      '-out', `expired-${name}.pem`, '-startdate', '20000101000000Z',
      '-enddate', '20010101000000Z', '-extensions', 'anchor');
  }
  // Retain the valid leaf and key, corrupt only its issuer signature. This models
  // a counterfeit certificate; theft of a still-trusted private key needs revocation.
  const der = run('x509', '-in', 'valid.pem', '-outform', 'DER');
  der[der.length - 1] ^= 1;
  write('forged.der', der);
  run('x509', '-inform', 'DER', '-in', 'forged.der', '-out', 'forged.pem');
  return { dir, read, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function server(fixture, identity, handler = () => {}) {
  const key = identity.includes('selfsigned') ? 'selfsigned.key' : 'leaf.key';
  const sockets = new Set();
  const service = tls.createServer({ key: fixture.read(key), cert: fixture.read(`${identity}.pem`),
    minVersion: 'TLSv1.2' }, (socket) => handler(socket));
  service.on('tlsClientError', () => {});
  service.on('connection', (socket) => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
  return { port: service.address().port, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => service.close(resolve));
  } };
}
function publicKeyCertificates(fixture, directory = path.join(__dirname,'public-trust/spki')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
  if (manifest.keys.length !== 8) throw new Error('All eight incident public keys are required');
  return manifest.keys.map((entry) => {
    const spki = fs.readFileSync(path.join(directory,entry.name));
    if (crypto.createHash('sha256').update(spki).digest('hex') !== entry.complete_spki_sha256) throw new Error('Public fixture hash mismatch');
    const key = execFileSync('openssl',['pkey','-pubin','-inform','DER','-pubout'],{input:spki});
    const publicPath = path.join(fixture.dir,'public.pem'), cert = path.join(fixture.dir,`${entry.name}.pem`);
    fs.writeFileSync(publicPath,key);
    execFileSync('openssl',['x509','-new','-force_pubkey',publicPath,'-CA',path.join(fixture.dir,'root.pem'),
      '-CAkey',path.join(fixture.dir,'root.key'),'-set_serial','99','-subj','/CN=public-key-policy-fixture','-days','1','-out',cert],{stdio:'pipe'});
    return {name:entry.name,cert,spki};
  });
}
module.exports = { certificates, server, publicKeyCertificates };
