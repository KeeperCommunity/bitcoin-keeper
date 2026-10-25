'use strict';
// Run inside the exact pinned github-script action with a disposable SDK identity.
// All HTTP is replaced at the SDK fetch boundary; no service is contacted.
const assert = require('node:assert/strict');
const { readPrivateArtifactBytes } = require('../../native/private_actions_software.cjs');
const API = 'https://api.github.com/repos/KeeperCommunity/bitcoin-keeper-relay/actions/artifacts/42/zip';
const TOKEN = 'DISPOSABLE_PINNED_SDK_CONTROL_ONLY';
async function exercise(Octokit, kind) {
  const seen = { api: 0, storage: 0, apiCancel: 0, storageCancel: 0, unexpected: 0, timeoutSignals: 0 };
  const client = new Octokit({ auth: TOKEN, request: { fetch: async () => {
    seen.unexpected++; throw new Error('UNEXPECTED_NETWORK_DISABLED');
  } } });
  const fetchImpl = async (url, init) => {
    if (String(url) === API) {
      seen.api++;
      assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual'); assert.equal(init.body, undefined);
      assert.equal(new RegExp(`^(?:token|bearer) ${TOKEN}$`, 'i').test(init.headers.authorization), true,
        'only the disposable SDK identity may reach the controlled API');
      assert(init.signal instanceof AbortSignal); seen.timeoutSignals++;
      const response = new Response('', { status: kind === 'api-error' ? 403 : 302,
        headers: { location: kind === 'foreign-storage' ? 'https://foreign.invalid/42' : 'https://sdk-control.blob.core.windows.net/42' } });
      const cancel = response.body.cancel.bind(response.body);
      response.body.cancel = async () => { seen.apiCancel++; return cancel(); };
      return response;
    }
    assert.equal(String(url), 'https://sdk-control.blob.core.windows.net/42');
    seen.storage++; assert.equal(init.headers, undefined); assert.equal(init.redirect, 'error');
    assert(init.signal instanceof AbortSignal); seen.timeoutSignals++;
    if (kind === 'timeout') return await new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(init.signal.reason);
      else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    const chunks = kind === 'stream-cap' ? [new Uint8Array(12 * 1024 * 1024), new Uint8Array(1)] :
      [Buffer.from('DISPOSABLE_ZIP_TRANSPORT_BYTES')];
    let offset = 0;
    const body = new ReadableStream({ pull(controller) {
      if (offset < chunks.length) controller.enqueue(chunks[offset++]); else controller.close();
    } });
    const response = new Response(body, { headers: kind === 'header-cap' ?
      { 'content-length': String(12 * 1024 * 1024 + 1) } : {} });
    const cancel = response.body.cancel.bind(response.body), getReader = response.body.getReader.bind(response.body);
    response.body.cancel = async () => { seen.storageCancel++; return cancel(); };
    response.body.getReader = () => {
      const reader = getReader(), cancelReader = reader.cancel.bind(reader);
      reader.cancel = async () => { seen.storageCancel++; return cancelReader(); }; return reader;
    };
    return response;
  };
  const originalTimeout = AbortSignal.timeout, configuredTimeouts = [];
  if (kind === 'timeout') AbortSignal.timeout = milliseconds => {
    assert.equal(milliseconds, 30000); configuredTimeouts.push(milliseconds);
    const controller = new AbortController();
    // Controlled clock only: preserve the actual passed signal and its abort path.
    setTimeout(() => controller.abort(new DOMException('DISPOSABLE_TIMEOUT', 'TimeoutError')), 1);
    return controller.signal;
  };
  try {
    if (kind === 'success') {
      assert.equal((await readPrivateArtifactBytes(client, 42, { fetchImpl })).toString(), 'DISPOSABLE_ZIP_TRANSPORT_BYTES');
    } else await assert.rejects(readPrivateArtifactBytes(client, 42, { fetchImpl }), /^Error: PRIVATE_SOFTWARE_[A-Z_]+$/);
  } finally { AbortSignal.timeout = originalTimeout; }
  assert.equal(seen.api, 1); assert.equal(seen.apiCancel, 1); assert.equal(seen.unexpected, 0);
  assert.equal(seen.storage, ['api-error', 'foreign-storage'].includes(kind) ? 0 : 1);
  assert.equal(seen.storageCancel, ['success', 'header-cap', 'stream-cap'].includes(kind) ? 1 : 0);
  assert.equal(seen.timeoutSignals, seen.api + seen.storage);
  if (kind === 'timeout') assert.deepEqual(configuredTimeouts, [30000, 30000]);
  return { case: kind, ...seen };
}
module.exports = async function runPinnedPrivateArtifactSDK(Octokit) {
  const cases = [];
  for (const kind of ['success', 'api-error', 'foreign-storage', 'header-cap', 'stream-cap', 'timeout'])
    cases.push(await exercise(Octokit, kind));
  return { node: process.version, cases, actual_pinned_sdk: true, real_service_requests: 0, real_credentials: false };
};
