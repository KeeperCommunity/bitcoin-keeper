'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const crypto = require('node:crypto');
const app = require('../native/relay_reader_app.cjs');
const canonical = require('../native/canonical_native.cjs');
const API = 'https://api.github.com', ROOT = '/repos/' + app.REPOSITORY;
// Disposable test identity generated in memory; never a real GitHub App key.
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
class SDK {
  constructor(options = {}) {
    if (!options.authStrategy) { this.legacy = options.auth; return; }
    this.auth = options.authStrategy();
    const raw = async options => {
      const response = await options.request.fetch(options.url, { method: options.method,
        headers: options.headers, ...(options.body ? { body: options.body } : {}) });
      if (response.status >= 400) throw Object.assign(new Error('unsafe provider diagnostic ' + options.headers.authorization),
        { status: response.status });
      return { status: response.status, data: await response.json() };
    };
    const merge = (route, parameters) => {
      if (typeof route === 'object') return { ...route, ...parameters };
      const [method, url] = route.split(' ');
      return { method, url, headers: {}, ...parameters };
    };
    raw.endpoint = { merge, parse: value => value };
    this.request = (route, parameters) => this.auth.hook(raw, route, parameters);
  }
}
function fixture(change = () => {}) {
  let current = Date.now(), minted = 0;
  const state = { calls: [], install: { id: 20, app_id: 10, account: { id: 248454494,
    login: 'KeeperCommunity', type: 'Organization' }, target_id: 248454494,
  target_type: 'Organization', repository_selection: 'selected', suspended_at: null,
  suspended_by: null, permissions: { ...app.PERMISSIONS, metadata: 'read' } },
  selected: { total_count: 1, repositories: [{ id: app.REPOSITORY_ID, full_name: app.REPOSITORY, private: true }] },
  mintedPermissions: { ...app.PERMISSIONS }, mintStatus: 201, tokenSelection: 'selected',
  expiryOffset: 3600000, readStatuses: [] };
  change(state);
  const fetchImpl = async (url, init) => {
    state.calls.push({ url, init });
    assert.equal(init.redirect, 'error');
    const path = url.slice(API.length);
    let body, status = 200;
    if (path === '/app/installations/20') {
      assert.equal(init.method, 'GET');
      const jwt = init.headers.authorization.slice(7), [head, claims, signature] = jwt.split('.');
      assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { alg: 'RS256', typ: 'JWT' });
      const payload = JSON.parse(Buffer.from(claims, 'base64url'));
      assert.equal(payload.iss, '10');
      assert.equal(payload.iat, Math.floor(current / 1000) - 60);
      assert.equal(payload.exp, Math.floor(current / 1000) + 540);
      assert(crypto.verify('RSA-SHA256', Buffer.from(head + '.' + claims), keys.publicKey, Buffer.from(signature, 'base64url')));
      body = state.install;
    } else if (path === '/app/installations/20/access_tokens') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { repository_ids: [app.REPOSITORY_ID], permissions: app.PERMISSIONS });
      minted++;
      body = { token: state.tokenOverride || 'ghs_DISPOSABLE_TEST_ONLY_INSTALLATION_' + minted,
        expires_at: new Date(current + state.expiryOffset).toISOString(),
        repository_selection: state.tokenSelection, permissions: state.mintedPermissions };
      status = state.mintStatus;
    } else if (path === '/installation/repositories?per_page=100') {
      assert.equal(init.method, 'GET'); body = state.selected;
    } else {
      // The authenticated read wrapper must force manual redirects, even when
      // the SDK or consumer would otherwise follow them.
      assert.fail('Unexpected authentication endpoint');
    }
    return new Response(state.rawInstall && path === '/app/installations/20' ? state.rawInstall : JSON.stringify(body), { status });
  };
  const repoFetch = async (url, init) => {
    assert.equal(init.redirect, 'manual');
    assert.equal(init.method, 'GET');
    assert(url.startsWith(API + ROOT));
    state.readCalls ??= [];
    state.readCalls.push({ url, init });
    if (state.readHook) return state.readHook(state.readCalls.length, init);
    return new Response(JSON.stringify({ id: app.REPOSITORY_ID }), { status: state.readStatuses.shift() || 200 });
  };
  const config = { appId: 10, installationId: 20, privateKey: pem };
  const sdk = app.client({ constructor: SDK }, config, { fetchImpl, clock: () => current });
  assert.equal(config.privateKey, undefined);
  const read = (method = 'GET', url = API + ROOT) => sdk.request(method + ' ' + url, { request: { fetch: repoFetch } });
  return { state, sdk, read, advance: n => { current += n; }, minted: () => minted };
}
test('App identity signs real RS256 claims and narrows the token before a Relay read', async () => {
  const f = fixture(); assert.equal((await f.read()).status, 200); assert.equal(f.minted(), 1);
  assert.equal(f.state.calls.length, 3);
  assert.deepEqual(await f.sdk.auth(), { type: 'installation', repository: app.REPOSITORY });
});
test('concurrent reads share one mint and short-lived tokens renew before expiry', async () => {
  const f = fixture(); await Promise.all([f.read(), f.read(), f.read()]); assert.equal(f.minted(), 1);
  f.advance(54 * 60000); await f.read(); assert.equal(f.minted(), 1);
  f.advance(60000); await f.read(); assert.equal(f.minted(), 2);
});
test('a rejected cached token refreshes once; a second401 never loops or falls back', async () => {
  const f = fixture(s => { s.readStatuses = [401, 401]; });
  await assert.rejects(f.read(), /^Error: PRIVATE_RELAY_APP_READ_UNAVAILABLE$/);
  assert.equal(f.minted(), 2); assert.equal(f.state.readCalls.length, 2);
});
test('permission denial is not retried as token renewal', async () => {
  const f = fixture(s => { s.readStatuses = [403]; });
  await assert.rejects(f.read(), /PRIVATE_RELAY_APP_READ_UNAVAILABLE/); assert.equal(f.minted(), 1);
});
test('late401 for an older concurrent request reuses the replacement token', async () => {
  let release;
  const late = new Promise(resolve => { release = resolve; });
  const response = status => new Response('{"id":496119449}', { status });
  const f = fixture(s => { s.readHook = async index => {
    if (index === 1) return response(401);
    if (index === 2) { await late; return response(401); }
    if (index === 3) release();
    return response(200);
  }; });
  await Promise.all([f.read(), f.read()]);
  assert.equal(f.minted(), 2); assert.equal(f.state.readCalls.length, 4);
});
test('long stateless installation tokens with JWT separators remain supported', async () => {
  const f = fixture(s => { s.tokenOverride = 'ghs_10_' + ['a'.repeat(800), 'b-c_d'.repeat(180), 'z'.repeat(350)].join('.'); });
  assert.equal((await f.read()).status, 200); assert.equal(f.minted(), 1);
});
test('installation token header injection is rejected before any repository read', async () => {
  const f = fixture(s => { s.tokenOverride = 'ghs_DISPOSABLE_TEST_ONLY\r\nOther: header'; });
  await assert.rejects(f.read(), /PRIVATE_RELAY_APP_READ_UNAVAILABLE/);
  assert.equal(f.state.readCalls, undefined);
});
test('renewal failure discards cached authority rather than using the older token', async () => {
  const f = fixture(); await f.read(); f.advance(55 * 60000); f.state.install.suspended_at = '2026-01-01T00:00:00Z';
  await assert.rejects(f.read(), /PRIVATE_RELAY_APP_READ_UNAVAILABLE/);
  assert.equal(f.state.readCalls.length, 1);
});
for (const [name, change] of [
  ['wrong installation', s => { s.install.id++; }], ['wrong app', s => { s.install.app_id++; }],
  ['wrong organization', s => { s.install.account.id++; }], ['wrong target', s => { s.install.target_id++; }],
  ['suspended app', s => { s.install.suspended_at = new Date().toISOString(); }],
  ['all-repository installation', s => { s.install.repository_selection = 'all'; }],
  ['write permission', s => { s.install.permissions.checks = 'write'; }],
  ['extra grant', s => { s.install.permissions.administration = 'read'; }],
  ['missing checks', s => { delete s.install.permissions.checks; }],
  ['mint denied', s => { s.mintStatus = 403; }],
  ['mint returned write', s => { s.mintedPermissions.contents = 'write'; }],
  ['mint returned broader permission', s => { s.mintedPermissions.issues = 'read'; }],
  ['mint selected all', s => { s.tokenSelection = 'all'; }],
  ['too-short token', s => { s.expiryOffset = 300000; }],
  ['too-long token', s => { s.expiryOffset = 7200000; }],
  ['another repository', s => { s.selected.repositories[0].id++; }],
  ['public Relay', s => { s.selected.repositories[0].private = false; }],
  ['extra repository', s => { s.selected.total_count = 2; }],
  ['duplicate JSON keys', s => { s.rawInstall = '{"id":20,"id":20}'; }],
  ['oversize response', s => { s.rawInstall = '{"padding":"' + 'x'.repeat(65536) + '"}'; }],
]) test('rejects ' + name + ' without any authenticated repository read', async () => {
  const f = fixture(change); await assert.rejects(f.read(), /^Error: PRIVATE_RELAY_APP_READ_UNAVAILABLE$/);
  assert.equal(f.state.readCalls, undefined);
});
for (const [method, url] of [
  ['POST', API + ROOT + '/issues'], ['GET', API + '/repos/KeeperCommunity/bitcoin-keeper-private/actions/runs'],
  ['GET', 'https://other.invalid' + ROOT], ['GET', API + ROOT + '-other/contents/x'],
  ['GET', API + ROOT + '/actions/secrets'], ['GET', API + ROOT + '/actions/variables'],
  ['GET', API + ROOT + '/%252e%252e/other/actions/runs'],
]) test('rejects destination before mint: ' + method + ' ' + new URL(url).pathname, async () => {
  const f = fixture(); await assert.rejects(f.read(method, url), /PRIVATE_RELAY_READ_DESTINATION_REJECTED/);
  assert.equal(f.state.calls.length, 0);
});
test('consumer byte-reader fetch hooks remain active, with manual redirects', async () => {
  const f = fixture(); let called = false;
  await f.sdk.request('GET ' + API + ROOT + '/actions/artifacts/10/zip', {
    request: { fetch: async (url, init) => { called = true; assert.equal(init.redirect, 'manual');
      return new Response('{"bounded":true}', { status: 200 }); } } });
  assert(called);
});
test('incomplete App configuration is consumed and never falls back to a PAT', () => {
  const env = { KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN: 'DISPOSABLE_PAT', KEEPER_RELAY_READER_APP_ID: '10' };
  assert.throws(() => canonical.privateReaderFromEnvironment({ constructor: SDK }, env), /PRIVATE_RELAY_APP_IDENTITY_UNVERIFIED/);
  assert.deepEqual(env, {});
});
test('ambiguous PAT/App configuration is rejected after removing every environment credential', () => {
  const env = { KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN: 'DISPOSABLE_PAT', KEEPER_RELAY_READER_APP_ID: '10',
    KEEPER_RELAY_READER_INSTALLATION_ID: '20', KEEPER_RELAY_READER_PRIVATE_KEY: pem };
  assert.throws(() => canonical.privateReaderFromEnvironment({ constructor: SDK }, env), /PRIVATE_ACTIONS_READ_IDENTITY_AMBIGUOUS/);
  assert.deepEqual(env, {});
});
test('missing identity preserves incomplete readiness; existing explicit PAT route is unchanged', () => {
  assert.equal(canonical.privateReaderFromEnvironment({ constructor: SDK }, {}), undefined);
  const env = { KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN: 'DISPOSABLE_PAT' };
  assert.equal(canonical.privateReaderFromEnvironment({ constructor: SDK }, env).legacy, 'DISPOSABLE_PAT');
  assert.deepEqual(env, {});
});
