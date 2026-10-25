'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, digest } = require('./fixtures/actions-software.cjs');
const { sdkDownloadArtifact } = require('./fixtures/github-script-sdk-shape.cjs');
const { readPublicArtifactBytes, isPublicSoftwareEvidence } = require('../native/actions_software_evidence.cjs');

test('pinned SDK-shaped baseline ignores request.redirect and eagerly parses without its supported hooks', async () => {
  const observed = {};
  const result = await sdkDownloadArtifact({ owner: 'KeeperCommunity', repo: 'bitcoin-keeper', artifact_id: 101,
    archive_format: 'zip', request: { redirect: 'manual' } }, async (url, init) => {
    assert.equal(init.redirect, undefined);
    return new Response('FOLLOWED_SYNTHETIC_ZIP_BODY', { status: 200 });
  }, observed);
  assert.equal(result.status, 200);
  assert.equal(observed.parsedBodies, 1);
  assert.equal(Buffer.from(result.data).toString(), 'FOLLOWED_SYNTHETIC_ZIP_BODY');
});
test('supported fetch hook forces manual API redirect, cancels API body and keeps identity off storage', async () => {
  const state = fixture(); state.sdkShape = {};
  const bytes = await readPublicArtifactBytes(state.github, 101, state.options);
  assert.equal(digest(bytes), digest(state.archives[101]));
  assert.equal(state.apiFetchOptions.method, 'GET');
  assert.equal(state.apiFetchOptions.redirect, 'manual');
  assert.equal(state.apiFetchOptions.headers.authorization, 'Bearer DISPOSABLE_TEST_API_IDENTITY');
  assert.ok(state.apiFetchOptions.signal instanceof AbortSignal);
  assert.equal(state.apiBodyCancellations, 1);
  assert.equal(state.sdkShape.parsedBodies, undefined);
  assert.equal(state.fetchOptions.redirect, 'error');
  assert.equal('headers' in state.fetchOptions, false);
  assert.equal(isPublicSoftwareEvidence(bytes), false);
});
for (const [name, changes] of Object.entries({
  'foreign API origin': { url: 'https://api.github.com.evil.invalid/repos/KeeperCommunity/bitcoin-keeper/actions/artifacts/101/zip' },
  'HTTP API': { url: 'http://api.github.com/repos/KeeperCommunity/bitcoin-keeper/actions/artifacts/101/zip' },
  'foreign repository': { url: 'https://api.github.com/repos/other/repo/actions/artifacts/101/zip' },
  'different artifact': { url: 'https://api.github.com/repos/KeeperCommunity/bitcoin-keeper/actions/artifacts/102/zip' },
  'query suffix': { url: 'https://api.github.com/repos/KeeperCommunity/bitcoin-keeper/actions/artifacts/101/zip?other=1' },
  POST: { method: 'POST' },
  'GET body': { body: 'PRIVATE_BODY_NEVER_SENT' },
})) test('rejects SDK request with ' + name + ' before authenticated fetch', async () => {
  const state = fixture(); state.sdkShape = changes;
  await assert.rejects(readPublicArtifactBytes(state.github, 101, state.options), /^Error: SOFTWARE_ARCHIVE_API_REQUEST_INVALID$/);
  assert.equal(state.apiFetchOptions, undefined);
  assert.equal(state.fetches, 0);
});
for (const status of [200, 301, 403, 500]) test('cancels API status ' + status + ' before SDK body parsing or storage fetch', async () => {
  const state = fixture(); state.sdkShape = {}; state.downloadStatus = status;
  await assert.rejects(readPublicArtifactBytes(state.github, 101, state.options), /^Error: SOFTWARE_ARCHIVE_REDIRECT_REQUIRED$/);
  assert.equal(state.apiBodyCancellations, 1);
  assert.equal(state.sdkShape.parsedBodies, undefined);
  assert.equal(state.fetches, 0);
});
test('an unsupported client that drops the fetch hook cannot fall back to a buffered archive', async () => {
  const state = fixture();
  state.github.rest.actions.downloadArtifact = async () => ({ status: 302,
    headers: { location: 'https://evidence.blob.core.windows.net/r5/101.zip' } });
  await assert.rejects(readPublicArtifactBytes(state.github, 101, state.options), /^Error: SOFTWARE_ARCHIVE_REDIRECT_REQUIRED$/);
  assert.equal(state.apiFetchOptions, undefined); assert.equal(state.fetches, 0);
});
test('a client retry cannot reuse the authenticated callback to request a second hop', async () => {
  const state = fixture();
  state.github.rest.actions.downloadArtifact = async options => {
    const url = 'https://api.github.com/repos/KeeperCommunity/bitcoin-keeper/actions/artifacts/101/zip';
    await options.request.fetch(url, { method: 'GET' });
    await options.request.fetch(url, { method: 'GET' });
  };
  await assert.rejects(readPublicArtifactBytes(state.github, 101, state.options), /^Error: SOFTWARE_ARCHIVE_API_REQUEST_INVALID$/);
  assert.equal(state.apiBodyCancellations, 1); assert.equal(state.fetches, 0);
});
for (const phase of ['API fetch', 'API cancellation', 'storage fetch']) test(phase + ' exceptions expose no headers, payloads or signed URLs', async () => {
  const state = fixture(), original = state.options.fetchImpl;
  state.options.fetchImpl = async (url, init) => {
    const api = new URL(url).hostname === 'api.github.com';
    if ((api && phase === 'API fetch') || (!api && phase === 'storage fetch'))
      throw new Error('PRIVATE_PAYLOAD https://private.invalid/?signature=SECRET');
    const response = await original(url, init);
    if (api && phase === 'API cancellation') response.body.cancel = async () => {
      throw new Error('PRIVATE_PAYLOAD https://private.invalid/?signature=SECRET');
    };
    return response;
  };
  await assert.rejects(readPublicArtifactBytes(state.github, 101, state.options), /^Error: SOFTWARE_ARCHIVE_READ_FAILED$/);
});
