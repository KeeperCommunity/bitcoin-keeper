'use strict';
// This fixture is also executed by the exact pinned github-script distribution.
// Every SDK HTTP request terminates at the controlled fetch boundary below.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sdk } = require('../current-release-origin.cjs');
const { downloadSignedArtifact } = require('../protected-release-worker.cjs');
const TOKEN = 'DISPOSABLE_CURRENT_RELEASE_SDK_CONTROL';
const BASE = 'https://api.github.com/repos/KeeperCommunity/bitcoin-keeper/';
const STORAGE = 'https://release-sdk-control.blob.core.windows.net/archive?sig=DISPOSABLE';
const PAYLOAD = Buffer.from('DISPOSABLE_CURRENT_RELEASE_ARCHIVE');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function bodyResponse(chunks, headers, seen, key, status = 200) {
  let offset = 0;
  const response = new Response(new ReadableStream({ pull(controller) {
    if (offset < chunks.length) controller.enqueue(chunks[offset++]); else controller.close();
  } }), { status, headers });
  const cancel = response.body.cancel.bind(response.body);
  response.body.cancel = async () => { seen[key]++; return cancel(); };
  const getReader = response.body.getReader.bind(response.body);
  response.body.getReader = () => {
    const reader = getReader(), cancelReader = reader.cancel.bind(reader);
    reader.cancel = async () => { seen[key]++; return cancelReader(); };
    return reader;
  };
  return response;
}

async function exercise(Octokit, route, kind) {
  const seen = { api: 0, storage: 0, apiCancel: 0, storageCancel: 0, unexpected: 0, signals: 0 };
  const configuredTimeouts = [];
  // github-script's normal worker client uses retries=0. Match that setting
  // when constructing its actual SDK class with the disposable identity.
  const client = new Octokit({ auth: TOKEN, retry: { enabled: false }, request: { fetch: async () => {
    seen.unexpected++; throw new Error('UNEXPECTED_NETWORK_DISABLED');
  } } });
  const raw = route === 'raw', url = BASE + (raw ? 'sdk-control' : 'actions/artifacts/42/zip');
  const fetchImpl = async (actual, init) => {
    if (String(actual) === url) {
      seen.api++;
      assert.equal(init.method, 'GET'); assert.equal(init.body, undefined);
      assert.equal(init.redirect, raw ? 'error' : 'manual');
      assert.match(new Headers(init.headers).get('authorization'), new RegExp('^(?:token|bearer) ' + TOKEN + '$', 'i'));
      assert(init.signal instanceof AbortSignal); seen.signals++;
      if (kind === 'api-timeout') return await new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
      if (kind === 'api-error') return bodyResponse([Buffer.from('PRIVATE_API_ERROR')], {}, seen, 'apiCancel', 403);
      if (!raw) return bodyResponse([Buffer.from('')], {
        location: kind === 'foreign-storage' ? 'https://foreign.invalid/archive' : STORAGE,
      }, seen, 'apiCancel', kind === 'wrong-redirect' ? 303 : 302);
      const chunks = kind === 'stream-cap' ? [new Uint8Array(65)] :
        [Buffer.from(kind === 'duplicate-json' ? '{"a":1,"a":2}' : '{"safe":true}')];
      return bodyResponse(chunks, kind === 'header-cap' ? { 'content-length': '1048577' } :
        kind === 'incomplete' ? { 'content-length': '20' } : {}, seen, 'apiCancel');
    }
    assert.equal(String(actual), STORAGE);
    seen.storage++; assert.equal(init.headers, undefined); assert.equal(init.redirect, 'error');
    assert(init.signal instanceof AbortSignal); seen.signals++;
    if (kind === 'storage-timeout') return await new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    const chunks = kind === 'stream-cap' ? [new Uint8Array(route === 'signed' ? PAYLOAD.length + 1 : 131073)] :
      [kind === 'short' ? PAYLOAD.subarray(1) : PAYLOAD];
    return bodyResponse(chunks, kind === 'header-cap' ? { 'content-length': String(route === 'signed' ?
      PAYLOAD.length + 1 : 131073) } : {}, seen, 'storageCancel');
  };
  const timeout = AbortSignal.timeout;
  if (kind.endsWith('timeout')) AbortSignal.timeout = milliseconds => {
    configuredTimeouts.push(milliseconds);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('DISPOSABLE_CONTROL_TIMEOUT', 'TimeoutError')), 1);
    return controller.signal;
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-release-sdk-control-'));
  const destination = path.join(directory, 'archive.zip');
  if (kind === 'existing') fs.writeFileSync(destination, 'DISPOSABLE_EXISTING_FILE');
  if (kind === 'symlink') {
    fs.writeFileSync(path.join(directory, 'target'), 'DISPOSABLE_EXISTING_FILE');
    fs.symlinkSync(path.join(directory, 'target'), destination);
  }
  const write = fs.writeSync;
  if (kind === 'partial-write') fs.writeSync = (fd, buffer, offset, length) =>
    write(fd, buffer, offset, Math.min(2, length));
  try {
    const operation = async () => {
      if (raw) return kind === 'duplicate-json' ? sdk(client, fetchImpl).json('sdk-control') :
        sdk(client, fetchImpl).raw('sdk-control', 'application/vnd.github+json', 64);
      if (route === 'archive') return sdk(client, fetchImpl).archive(42, PAYLOAD.length);
      return downloadSignedArtifact(client, { id: 42, size_in_bytes: PAYLOAD.length,
        digest: 'sha256:' + (kind === 'digest' ? '0'.repeat(64) : sha256(PAYLOAD)) }, destination, { fetchImpl });
    };
    if (['success', 'partial-write'].includes(kind)) {
      const value = await operation();
      if (raw) assert.equal(value.payload.toString(), '{"safe":true}');
      else assert.equal((route === 'signed' ? fs.readFileSync(destination) : value).toString(), PAYLOAD.toString());
      if (route === 'signed') assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
    } else {
      await assert.rejects(operation(), error => {
        assert(!String(error).includes(TOKEN)); assert(!String(error).includes(STORAGE));
        return true;
      });
      if (['existing', 'symlink'].includes(kind)) assert.equal(fs.readFileSync(destination, 'utf8'),
        'DISPOSABLE_EXISTING_FILE', 'exclusive destination must preserve existing files');
    }
  } finally { fs.writeSync = write; AbortSignal.timeout = timeout; fs.rmSync(directory, { recursive: true, force: true }); }
  assert.equal(seen.api, 1); assert.equal(seen.unexpected, 0);
  const apiTimedOut = kind === 'api-timeout';
  assert.equal(seen.apiCancel, apiTimedOut ? 0 : 1, 'all acquired API bodies must be cancelled');
  const noStorage = raw || ['api-error', 'api-timeout', 'foreign-storage', 'wrong-redirect'].includes(kind);
  assert.equal(seen.storage, noStorage ? 0 : 1);
  assert.equal(seen.storageCancel, noStorage || kind === 'storage-timeout' ? 0 : 1,
    'all acquired storage bodies must be cancelled');
  assert.equal(seen.signals, seen.api + seen.storage);
  if (kind.endsWith('timeout')) assert.deepEqual(configuredTimeouts,
    noStorage ? [30000] : [30000, route === 'signed' ? 120000 : 30000]);
  return { route, case: kind, ...seen };
}

module.exports = async function runCurrentReleaseSDKControls(Octokit) {
  const cases = [];
  for (const [route, kinds] of Object.entries({
    raw: ['success', 'api-error', 'header-cap', 'stream-cap', 'incomplete', 'duplicate-json', 'api-timeout'],
    archive: ['success', 'api-error', 'wrong-redirect', 'foreign-storage', 'header-cap', 'stream-cap', 'short', 'api-timeout', 'storage-timeout'],
    signed: ['success', 'partial-write', 'api-error', 'wrong-redirect', 'foreign-storage', 'header-cap', 'stream-cap', 'short', 'digest', 'existing', 'symlink', 'api-timeout', 'storage-timeout'],
  })) for (const kind of kinds) cases.push(await exercise(Octokit, route, kind));
  return { node: process.version, cases, sdk_retries: 0, real_service_requests: 0, real_credentials: false };
};
