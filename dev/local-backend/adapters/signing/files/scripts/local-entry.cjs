// Local test keys are created once per Docker volume. Never print their values.
const fs = require('node:fs');
const crypto = require('node:crypto');
const bip39 = require('bip39');
if (process.env.LOCAL_DEV !== 'true' || process.env.ENVIRONMENT !== 'TEST') throw new Error('Local entry requires LOCAL_DEV and TEST');
const file = '/local-data/secrets.json';
if (!fs.existsSync(file)) {
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const secrets = { 'local-rsa-private': rsa.privateKey, 'local-rsa-public': rsa.publicKey };
  for (const id of ['local-signer-v2', 'local-signer-v3', 'local-inheritance-v2', 'local-inheritance-v3']) secrets[id] = bip39.generateMnemonic(256);
  fs.writeFileSync(file, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' });
}
require('../dist/index.js');
