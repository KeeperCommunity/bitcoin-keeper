import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { HDKey, HARDENED_OFFSET } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { loadProtectedAuthority } from './support/protected-authority-esm-loader.mjs';

const production = await loadProtectedAuthority();
const [nodeMajor, nodeMinor, nodePatch] = process.versions.node.split('.').map(Number);
assert.ok(nodeMajor === 22 && (nodeMinor > 23 || (nodeMinor === 23 && nodePatch >= 3)),
  'Run the proof with Node22.23.3 or a later22.x patch');
const { deriveBackupAuthority } = production;
// Public, unfunded BIP39 standard fixture. Never use this phrase for real funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const NAMESPACE = 'bk3_7SolLs5PrxK2ybpJGsah8spJqewmCskdDW_L9gnI2FY';
const AUDIENCE = 'https://keeper-fixture.invalid';
const NOW = 2000000000;
const ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const bytes = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const body = (authority, mutation = false) => ({ namespaceId: authority.namespaceId,
  publicJwk: authority.publicJwk, ...(mutation ? { operation: 'deleteBackup',
    expectedRevision: '12'.repeat(32), expectedGeneration: 7, authEpoch: 2, data: {} } : {}) });
const decode = (token) => {
  const [header, claims, signature] = token.split('.');
  return { header: JSON.parse(Buffer.from(header, 'base64url')), claims: JSON.parse(Buffer.from(claims, 'base64url')),
    signature: Buffer.from(signature, 'base64url'), input: `${header}.${claims}` };
};

test('the proof imports real supported2.4.0 modules and production ESM source', (t) => {
  for (const name of ['@scure/bip32', '@scure/bip39', '@noble/curves', '@noble/hashes']) {
    const pkg = JSON.parse(fs.readFileSync(new URL(`../../node_modules/${name}/package.json`, import.meta.url)));
    assert.equal(pkg.version, '2.4.0');
    assert.equal(pkg.type, 'module');
  }
  assert.doesNotMatch(production.source, /from ['"](?:@noble\/secp256k1|.*(?:sharedWallet|BIP85|bip85|noble_ecc))['"]/);
  t.diagnostic(JSON.stringify({ node: process.versions.node, openssl: process.versions.openssl,
    sourceSha256: production.sourceSha256, moduleMode: 'real-esm', nativeMetroAcceptance: false }));
});

test('RFC5869 SHA256 test case1 matches the fixed OKM and native HKDF', () => {
  const ikm = Buffer.alloc(22, 0x0b), salt = Buffer.from('000102030405060708090a0b0c', 'hex');
  const info = Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex');
  const expected = '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865';
  assert.equal(Buffer.from(hkdf(sha256, ikm, salt, info, 42)).toString('hex'), expected);
  assert.equal(Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, 42)).toString('hex'), expected);
});

test('BIP39 official TREZOR vector and no-passphrase native seed agree', () => {
  // https://github.com/trezor/python-mnemonic/blob/master/vectors.json
  assert.equal(Buffer.from(mnemonicToSeedSync(MNEMONIC, 'TREZOR')).toString('hex'),
    'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04');
  const native = crypto.pbkdf2Sync(MNEMONIC.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512');
  assert.deepEqual(Buffer.from(mnemonicToSeedSync(MNEMONIC, '')), native);
});

test('BIP32 official vector1 verifies master and hardened-zero public keys', () => {
  // https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki#test-vector-1
  const master = HDKey.fromMasterSeed(Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'));
  const child = master.deriveChild(HARDENED_OFFSET);
  try {
    assert.equal(master.publicExtendedKey,
      'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8');
    assert.equal(child.publicExtendedKey,
      'xpub68Gmy5EdvgibQVfPdqkBBCHxA5htiqg55crXYuXoQRKfDBFA1WEjWgP6LHhwBZeNK1VTsfTFUHCdrfp1bgwQ9xv5ski8PX9rL2dZXvgGDnw');
  } finally { master.wipePrivateData(); child.wipePrivateData(); }
});

test('the actual full no-passphrase authority reproduces the backend fixed namespace after clean derivation', () => {
  const first = deriveBackupAuthority(MNEMONIC), restored = deriveBackupAuthority(MNEMONIC);
  try {
    assert.equal(first.namespaceId, NAMESPACE);
    assert.equal(restored.namespaceId, NAMESPACE);
    assert.deepEqual(first.publicJwk, restored.publicJwk);
    const canonical = JSON.stringify({ crv: first.publicJwk.crv, kty: first.publicJwk.kty,
      x: first.publicJwk.x, y: first.publicJwk.y });
    assert.equal(first.kid, crypto.createHash('sha256').update(canonical).digest('base64url'));
    assert.equal(first.namespaceId, `bk3_${first.kid}`);
    assert.equal(crypto.createPublicKey({ key: first.publicJwk, format: 'jwk' }).asymmetricKeyDetails.namedCurve, 'secp256k1');
    first.dispose();
    assert.doesNotThrow(() => restored.signRawBody(bytes(body(restored)), '/backup/v3/snapshot', AUDIENCE, NOW));
  } finally { first.dispose(); restored.dispose(); }
});

test('an expected original account must match both mnemonic seed bytes and Keeper identity', () => {
  const seed = crypto.pbkdf2Sync(MNEMONIC.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512');
  const expected = { id: sha(seed), primarySeed: seed.toString('hex') };
  const authority = deriveBackupAuthority(MNEMONIC, expected);
  try { assert.equal(authority.namespaceId, NAMESPACE); } finally { authority.dispose(); }
  for (const account of [{ ...expected, id: 'ab'.repeat(32) },
    { ...expected, primarySeed: 'ab'.repeat(64) }, { ...expected, primarySeed: 'not-hex' },
    { ...expected, primarySeed: expected.primarySeed.toUpperCase() },
    { ...expected, id: expected.id.toUpperCase() }, null]) {
    assert.throws(() => deriveBackupAuthority(MNEMONIC, account), { message: 'PROTECTED_BACKUP_AUTHORITY_UNAVAILABLE' });
  }
});

test('actual production bootstrap and mobile-default encoding derive/sign with both text globals absent', () => {
  const helper = new URL('./support/protected-authority-esm-loader.mjs', import.meta.url).href;
  const loader = new URL('./support/react-native-encoding-loader.mjs', import.meta.url).href;
  const program = `
    import assert from 'node:assert/strict';
    import crypto from 'node:crypto';
    delete globalThis.TextEncoder; delete globalThis.TextDecoder;
    assert.equal(typeof globalThis.TextEncoder, 'undefined');
    assert.equal(typeof globalThis.TextDecoder, 'undefined');
    const {loadProtectedAuthority} = await import(${JSON.stringify(helper)});
    const {deriveBackupAuthority} = await loadProtectedAuthority();
    assert.equal(typeof globalThis.TextEncoder, 'function');
    assert.equal(typeof globalThis.TextDecoder, 'undefined');
    const authority = deriveBackupAuthority(${JSON.stringify(MNEMONIC)});
    try {
      assert.equal(authority.namespaceId, ${JSON.stringify(NAMESPACE)});
      const raw = Buffer.from(JSON.stringify({namespaceId:authority.namespaceId,publicJwk:authority.publicJwk}));
      const token = authority.signRawBody(raw,'/backup/v3/snapshot',${JSON.stringify(AUDIENCE)},${NOW});
      const parts=token.split('.');
      const key=crypto.createPublicKey({key:authority.publicJwk,format:'jwk'});
      assert.ok(crypto.verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')));
      console.log(JSON.stringify({namespaceId:authority.namespaceId,textDecoderInstalled:false,actualEsmSource:true}));
    } finally { authority.dispose(); }
  `;
  const result = spawnSync(process.execPath, ['--loader', loader, '--input-type=module', '-e', program], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { namespaceId: NAMESPACE, textDecoderInstalled: false, actualEsmSource: true });
});

for (const route of ['/backup/v3/enroll', '/backup/v3/snapshot', '/backup/v3/mutate']) {
  test(`actual production signer yields native OpenSSL ES256K for ${route}`, () => {
    const authority = deriveBackupAuthority(MNEMONIC);
    try {
      const raw = bytes(JSON.stringify(body(authority, route.endsWith('mutate')), null, 2));
      const token = authority.signRawBody(raw, route, AUDIENCE, NOW);
      assert.doesNotMatch(token, /^Bearer /);
      const signed = decode(token);
      assert.deepEqual(signed.header, { alg: 'ES256K', kid: authority.kid, typ: 'keeper-backup+jws' });
      assert.deepEqual(signed.claims, { v: 3, aud: AUDIENCE, method: 'POST', path: route,
        namespaceId: authority.namespaceId, bodySha256: sha(raw), iat: NOW, exp: NOW + 120 });
      assert.notEqual(signed.claims.bodySha256, sha(bytes(body(authority, route.endsWith('mutate')))));
      const key = crypto.createPublicKey({ key: authority.publicJwk, format: 'jwk' });
      assert.equal(signed.signature.length, 64);
      const s = BigInt(`0x${signed.signature.subarray(32).toString('hex')}`);
      assert.ok(s > 0n && s <= ORDER / 2n);
      assert.equal(crypto.verify('sha256', bytes(signed.input), { key, dsaEncoding: 'ieee-p1363' }, signed.signature), true);
      assert.equal(crypto.verify('sha256', bytes(`${signed.input}x`), { key, dsaEncoding: 'ieee-p1363' }, signed.signature), false);
      assert.equal(crypto.verify('sha256', crypto.createHash('sha256').update(signed.input).digest(),
        { key, dsaEncoding: 'ieee-p1363' }, signed.signature), false, 'Production signs SHA256 exactly once');
      assert.equal(authority.signRawBody(raw, route, AUDIENCE, NOW), token, 'RFC6979 signing is deterministic');
    } finally { authority.dispose(); }
  });
}

test('authority exposes only frozen public descriptors and dispose is idempotent', () => {
  const authority = deriveBackupAuthority(MNEMONIC);
  const raw = bytes(body(authority));
  assert.ok(Object.isFrozen(authority));
  assert.ok(Object.isFrozen(authority.publicJwk));
  assert.deepEqual(Object.keys(authority).sort(), ['dispose', 'kid', 'namespaceId', 'publicJwk', 'signRawBody']);
  assert.deepEqual(JSON.parse(JSON.stringify(authority)), {
    namespaceId: NAMESPACE, publicJwk: authority.publicJwk, kid: authority.kid,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(authority, 'toJSON'), false);
  authority.dispose(); authority.dispose();
  assert.throws(() => authority.signRawBody(raw, '/backup/v3/snapshot', AUDIENCE, NOW), /PROTECTED_BACKUP_AUTHORITY_UNAVAILABLE/);
});

test('invalid mnemonics fail closed without echoing caller input', () => {
  for (const mnemonic of ['', 'synthetic invalid recovery words', MNEMONIC.replace('about', 'abandon'), 'x'.repeat(1025), null, {}]) {
    assert.throws(() => deriveBackupAuthority(mnemonic), { message: 'PROTECTED_BACKUP_AUTHORITY_UNAVAILABLE' });
  }
});

test('scope, body, clock and malformed UTF8 checks fail closed before returning a proof', () => {
  const authority = deriveBackupAuthority(MNEMONIC);
  const raw = bytes(body(authority)), mutate = body(authority, true);
  try {
    const fail = (value, route = '/backup/v3/snapshot', audience = AUDIENCE, now = NOW) =>
      assert.throws(() => authority.signRawBody(value, route, audience, now), { message: 'PROTECTED_BACKUP_AUTHORITY_UNAVAILABLE' });
    fail(raw, '/revisionedBackupMutation');
    for (const audience of ['', 'x'.repeat(257), 'https://fixture.invalid\n']) fail(raw, undefined, audience);
    for (const now of [-1, -0, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) fail(raw, undefined, undefined, now);
    fail(bytes({ ...body(authority), namespaceId: 'bk3_unowned' }));
    fail(bytes({ ...body(authority), publicJwk: { ...authority.publicJwk, d: 'forbidden' } }));
    fail(bytes({ ...body(authority), extra: true }));
    fail(Uint8Array.of(0xff));
    fail(Buffer.alloc(32 * 1024 * 1024 + 1));
    for (const patch of [{ authEpoch: undefined }, { authEpoch: -1 }, { expectedGeneration: 2 ** 53 },
      { expectedRevision: 'AF'.repeat(32) }, { operation: 'unknown' }, { data: [] }]) {
      fail(bytes({ ...mutate, ...patch }), '/backup/v3/mutate');
    }
  } finally { authority.dispose(); }
});
