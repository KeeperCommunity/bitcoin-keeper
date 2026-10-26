'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { token } = require('./store-token.cjs');
const clock = () => Date.parse('2026-10-25T12:00:00Z');
function parts(value) { return value.split('.').slice(0, 2).map(part => JSON.parse(Buffer.from(part, 'base64url'))); }
test('real disposable P256 signature has the exact Apple audience/key ID and20minute lifetime', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const value = await token('ios', { KEEPER_ASC_KEY_ID: 'ABCDEFGHIJ', KEEPER_ASC_ISSUER_ID: '12345678-1234-1234-1234-123456789abc',
    KEEPER_ASC_KEY_BASE64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') }, { clock });
  const [header, payload] = parts(value); const [a, b, signature] = value.split('.');
  assert.equal(header.alg, 'ES256'); assert.equal(header.kid, 'ABCDEFGHIJ');
  assert.equal(payload.aud, 'appstoreconnect-v1'); assert.equal(payload.exp - payload.iat, 1200);
  assert(crypto.verify('sha256', Buffer.from(a + '.' + b), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
});
test('real disposable RSA assertion is exchanged only at fixed Google endpoint with AndroidPublisher scope', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { type: 'service_account', client_email: 'disposable@fixture.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
  let requests = 0;
  const value = await token('play', { KEEPER_PLAY_SERVICE_ACCOUNT: JSON.stringify(account) }, { clock,
    fetchImpl: async (url, init) => {
      requests++; assert.equal(url, 'https://www.googleapis.com/oauth2/v4/token');
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
      assert.equal(init.body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const assertion = init.body.get('assertion'), [header, payload] = parts(assertion);
      const [a, b, signature] = assertion.split('.');
      assert.equal(header.alg, 'RS256'); assert.equal(payload.scope, 'https://www.googleapis.com/auth/androidpublisher');
      assert.equal(payload.aud, url); assert.equal(payload.exp - payload.iat, 3600);
      assert(crypto.verify('RSA-SHA256', Buffer.from(a + '.' + b), publicKey, Buffer.from(signature, 'base64url')));
      return Response.json({ token_type: 'Bearer', access_token: 'disposable-token', expires_in: 3600 });
    } });
  assert.equal(value, 'disposable-token'); assert.equal(requests, 1);
  account.token_uri = 'https://other.invalid/token';
  await assert.rejects(token('play', { KEEPER_PLAY_SERVICE_ACCOUNT: JSON.stringify(account) }, { clock,
    fetchImpl: () => { throw new Error('Must never transport to unapproved origin'); } }));
});
test('unsupported provider, malformed key and wrong key curve fail before any provider transport', async () => {
  await assert.rejects(token('unknown', {}, { clock }));
  await assert.rejects(token('ios', { KEEPER_ASC_KEY_ID: 'ABCDEFGHIJ', KEEPER_ASC_ISSUER_ID: '12345678-1234-1234-1234-123456789abc', KEEPER_ASC_KEY_BASE64: 'invalid' }, { clock }));
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
  await assert.rejects(token('ios', { KEEPER_ASC_KEY_ID: 'ABCDEFGHIJ', KEEPER_ASC_ISSUER_ID: '12345678-1234-1234-1234-123456789abc',
    KEEPER_ASC_KEY_BASE64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') }, { clock }));
});
