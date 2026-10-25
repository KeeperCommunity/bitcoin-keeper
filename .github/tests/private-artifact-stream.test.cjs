'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { readPrivateArtifactBytes } = require('../native/private_actions_software.cjs');
const apiURL = 'https://api.github.com/repos/KeeperCommunity/bitcoin-keeper-relay/actions/artifacts/42/zip';
function fixture() {
  const f = { apiCancel: 0, storageCancel: 0, apiCalls: 0, storageCalls: 0, chunks: [Buffer.from('synthetic ZIP bytes')],
    location: 'https://fixture.blob.core.windows.net/42', status: 302, storageStatus: 200, sizeHeader: null };
  f.github = { rest: { actions: { downloadArtifact: async args => {
    assert.equal(args.repo, 'bitcoin-keeper-relay'); assert.equal(args.request.parseSuccessResponseBody, false);
    const response = await args.request.fetch(f.apiURL || apiURL, { method: f.method || 'GET',
      body: f.body, headers: { authorization: 'SYNTHETIC_IDENTITY' } });
    return { status: response.status, headers: { location: response.headers.get('location') } };
  } } } };
  f.fetchImpl = async (url, init) => {
    if (String(url).startsWith('https://api.github.com/')) {
      f.apiCalls++; assert.equal(init.redirect, 'manual'); assert.equal(init.headers.authorization, 'SYNTHETIC_IDENTITY');
      return { status: f.status, headers: new Headers({ location: f.location }), body: { cancel: async () => f.apiCancel++ } };
    }
    f.storageCalls++; assert.equal(init.redirect, 'error'); assert.equal(init.headers, undefined);
    let cursor = 0;
    return { ok: f.storageStatus === 200, headers: new Headers(f.sizeHeader === null ? {} : { 'content-length': f.sizeHeader }),
      body: { cancel: async () => f.storageCancel++, getReader: () => ({
        read: async () => cursor === f.chunks.length ? { done: true } : { done: false, value: f.chunks[cursor++] },
        cancel: async () => { f.storageCancel++; if (f.cancelFails) throw Error('PRIVATE_URL_AND_TOKEN'); },
      }) } };
  };
  return f;
}
const read = f => readPrivateArtifactBytes(f.github, 42, { fetchImpl: f.fetchImpl });
test('private SDK hook cancels API body, bounds storage bytes and keeps credentials on the API hop', async () => {
  const f = fixture(), bytes = await read(f);
  assert.equal(bytes.toString(), 'synthetic ZIP bytes');
  assert.equal(f.apiCancel, 1); assert.equal(f.storageCancel, 1);
});
for (const [name, change] of Object.entries({
  foreignAPI: f => f.apiURL = apiURL.replace('api.github.com', 'api.github.com.evil.invalid'),
  publicRepository: f => f.apiURL = apiURL.replace('bitcoin-keeper-relay', 'bitcoin-keeper'),
  wrongArtifact: f => f.apiURL = apiURL.replace('/42/', '/43/'),
  query: f => f.apiURL = apiURL + '?other=1', POST: f => f.method = 'POST', body: f => f.body = 'PRIVATE',
})) test(`SDK hop rejects ${name} before sending an authenticated request`, async () => {
  const f = fixture(); change(f);
  await assert.rejects(read(f), /^Error: PRIVATE_SOFTWARE_ARCHIVE_API_REQUEST_INVALID$/);
  assert.equal(f.apiCalls, 0); assert.equal(f.storageCalls, 0);
});
for (const status of [200, 301, 403, 500]) test(`API status ${status} is cancelled without a storage read`, async () => {
  const f = fixture(); f.status = status;
  await assert.rejects(read(f), /PRIVATE_SOFTWARE_ARCHIVE_REDIRECT_REQUIRED/);
  assert.equal(f.apiCancel, 1); assert.equal(f.storageCalls, 0);
});
for (const location of ['http://fixture.blob.core.windows.net/42', 'https://evil.invalid/42',
  'https://fixture.blob.core.windows.net.evil.invalid/42', 'https://user:token@fixture.blob.core.windows.net/42',
  'https://fixture.blob.core.windows.net:444/42', 'https://fixture.blob.core.windows.net/42#secret'])
  test('storage host constraints reject an untrusted redirect', async () => {
    const f = fixture(); f.location = location;
    await assert.rejects(read(f), /^Error: PRIVATE_SOFTWARE_ARCHIVE_HOST_INVALID$/);
    assert.equal(f.storageCalls, 0);
  });
for (const [name, change] of Object.entries({
  header: f => f.sizeHeader = String(12 * 1024 * 1024 + 1),
  streaming: f => f.chunks = [Buffer.alloc(12 * 1024 * 1024), Buffer.from('x')],
  mismatch: f => f.sizeHeader = '1', status: f => f.storageStatus = 403,
  cancellation: f => f.cancelFails = true,
})) test(`storage ${name} failure is bounded and closes the body`, async () => {
  const f = fixture(); change(f);
  await assert.rejects(read(f), /^Error: PRIVATE_SOFTWARE_[A-Z_]+$/);
  assert.equal(f.storageCancel, 1);
});
