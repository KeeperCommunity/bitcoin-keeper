'use strict';
// A dedicated Relay reader. No repository writes or caller-selected destinations.
const crypto = require('node:crypto');
const { parseStrictJson } = require('./strict_json.cjs');
const API = 'https://api.github.com';
const REPOSITORY = 'KeeperCommunity/bitcoin-keeper-relay', REPOSITORY_ID = 496119449;
const ORGANIZATION_ID = 248454494;
const PREFIX = '/repos/' + REPOSITORY;
const NAMES = Object.freeze(['KEEPER_RELAY_READER_APP_ID', 'KEEPER_RELAY_READER_INSTALLATION_ID',
  'KEEPER_RELAY_READER_PRIVATE_KEY']);
const PERMISSIONS = Object.freeze({ actions: 'read', contents: 'read', checks: 'read' });
const FAIL = 'PRIVATE_RELAY_APP_IDENTITY_UNVERIFIED';
const demand = (yes, code = FAIL) => { if (!yes) throw new Error(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const numeric = value => typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
const base64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function permissions(value) {
  demand(object(value) && Object.keys(PERMISSIONS).every(name => value[name] === 'read') &&
    Object.keys(value).every(name => Object.hasOwn(PERMISSIONS, name) || (name === 'metadata' && value[name] === 'read')));
}
function consume(env) {
  const values = NAMES.map(name => env[name]);
  for (const name of NAMES) delete env[name];
  if (values.every(value => value === undefined || value === '')) return undefined;
  demand(numeric(values[0]) && numeric(values[1]) && typeof values[2] === 'string' &&
    values[2].length >= 500 && values[2].length <= 16384);
  return { appId: Number(values[0]), installationId: Number(values[1]), privateKey: values[2] };
}
function readDestination(method, value) {
  demand(method === 'GET' && typeof value === 'string', 'PRIVATE_RELAY_READ_DESTINATION_REJECTED');
  let url;
  try { url = new URL(value); } catch { throw new Error('PRIVATE_RELAY_READ_DESTINATION_REJECTED'); }
  demand(url.origin === API && !url.username && !url.password && !url.hash &&
    (!url.port || url.port === '443'), 'PRIVATE_RELAY_READ_DESTINATION_REJECTED');
  let path = url.pathname;
  try {
    for (let count = 0; count < 3; count++) {
      const next = decodeURIComponent(path);
      if (next === path) break;
      path = next;
    }
  } catch { throw new Error('PRIVATE_RELAY_READ_DESTINATION_REJECTED'); }
  demand(!path.includes('\\') && !path.includes('%') &&
    !path.split('/').some(part => part === '.' || part === '..') &&
    (path === PREFIX || (path.startsWith(PREFIX + '/') &&
      /^(branches|commits|contents|git\/(blobs|trees|ref|refs|matching-refs)|actions\/(workflows|runs|jobs|artifacts)|check-runs|check-suites)(\/|$)/.test(path.slice(PREFIX.length + 1)))),
  'PRIVATE_RELAY_READ_DESTINATION_REJECTED');
  return url.href;
}
async function json(response, expected) {
  let reader, bytes = 0;
  const chunks = [];
  try {
    demand(response?.status === expected && response.body?.getReader);
    reader = response.body.getReader();
    for (;;) {
      const row = await reader.read();
      if (row.done) break;
      demand(row.value instanceof Uint8Array);
      bytes += row.value.length;
      demand(bytes <= 65536);
      chunks.push(Buffer.from(row.value));
    }
    return parseStrictJson(Buffer.concat(chunks), 65536);
  } finally {
    try { await (reader ? reader.cancel() : response?.body?.cancel()); } catch { /* fixed errors only */ }
    for (const chunk of chunks) chunk.fill(0);
  }
}
function provider(config, { fetchImpl = fetch, clock = Date.now } = {}) {
  demand(object(config) && Number.isSafeInteger(config.appId) && config.appId > 0 &&
    Number.isSafeInteger(config.installationId) && config.installationId > 0 &&
    typeof config.privateKey === 'string' && config.privateKey.length >= 500 && config.privateKey.length <= 16384);
  let key;
  try {
    key = crypto.createPrivateKey(config.privateKey);
    demand(key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails?.modulusLength >= 2048);
  } catch { throw new Error(FAIL); }
  finally { delete config.privateKey; }
  const appId = config.appId, installationId = config.installationId;
  let cached, pending;
  const now = () => { const value = clock(); demand(Number.isFinite(value) && value > 0); return value; };
  async function request(method, path, token, body) {
    return fetchImpl(API + path, { method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json',
        'x-github-api-version': '2026-03-10', ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function mint() {
    const instant = Math.floor(now() / 1000);
    const header = base64({ alg: 'RS256', typ: 'JWT' });
    const claims = base64({ iss: String(appId), iat: instant - 60, exp: instant + 540 });
    const signing = header + '.' + claims;
    const jwt = signing + '.' + crypto.sign('RSA-SHA256', Buffer.from(signing), key).toString('base64url');
    const install = await json(await request('GET', '/app/installations/' + installationId, jwt), 200);
    demand(install.id === installationId && install.app_id === appId &&
      install.account?.id === ORGANIZATION_ID && install.account.login === 'KeeperCommunity' &&
      install.account.type === 'Organization' && install.target_id === ORGANIZATION_ID &&
      install.target_type === 'Organization' && install.repository_selection === 'selected' &&
      install.suspended_at === null && install.suspended_by === null);
    permissions(install.permissions);
    const value = await json(await request('POST', '/app/installations/' + installationId + '/access_tokens', jwt,
      { repository_ids: [REPOSITORY_ID], permissions: PERMISSIONS }), 201);
    permissions(value.permissions);
    const expiresAt = Date.parse(value.expires_at), current = now();
    // GitHub also issues longer stateless installation tokens containing JWT
    // separators. Validate header safety/bounds, never an old fixed length.
    demand(typeof value.token === 'string' && /^[A-Za-z0-9._~+/-]{20,8192}={0,2}$/.test(value.token) &&
      value.repository_selection === 'selected' && Number.isFinite(expiresAt) &&
      expiresAt > current + 300000 && expiresAt <= current + 3600000 + 60000);
    const selected = await json(await request('GET', '/installation/repositories?per_page=100', value.token), 200);
    demand(selected.total_count === 1 && Array.isArray(selected.repositories) && selected.repositories.length === 1 &&
      selected.repositories[0].id === REPOSITORY_ID && selected.repositories[0].full_name === REPOSITORY &&
      selected.repositories[0].private === true);
    return { token: value.token, expiresAt };
  }
  async function token(rejectedToken) {
    if (pending) return pending;
    // A late401 for a replaced token must reuse the already renewed identity,
    // rather than mint another token for every older concurrent request.
    if (cached && cached.expiresAt > now() + 300000 && cached.token !== rejectedToken) return cached.token;
    cached = undefined;
    pending = (async () => {
      try { cached = await mint(); return cached.token; }
      catch { cached = undefined; throw new Error(FAIL); }
      finally { pending = undefined; }
    })();
    return pending;
  }
  return Object.freeze({ token });
}
function client(github, config, options = {}) {
  demand(typeof github?.constructor === 'function');
  const identity = provider(config, options);
  const fetchImpl = options.fetchImpl || fetch;
  const authStrategy = () => {
    // Unlike a normal token strategy, auth() never exports the credential.
    const auth = async () => Object.freeze({ type: 'installation', repository: REPOSITORY });
    auth.hook = async (request, route, parameters) => {
      try {
        const endpoint = request.endpoint.merge(route, parameters);
        const parsed = request.endpoint.parse(endpoint);
        const destination = readDestination(parsed.method, parsed.url);
        const underlying = endpoint.request?.fetch || fetchImpl;
        async function send(token) {
          return request({ ...endpoint, headers: { ...endpoint.headers, authorization: 'token ' + token },
            request: { ...endpoint.request, retries: 0, fetch: async (actual, init) => {
              demand(actual === destination && init?.method === 'GET' && init.body == null,
                'PRIVATE_RELAY_READ_DESTINATION_REJECTED');
              // Preserve consumer byte readers; prevent implicit authenticated redirects.
              return underlying(actual, { ...init, redirect: 'manual' });
            } } });
        }
        const token = await identity.token();
        try { return await send(token); }
        catch (error) {
          if (error?.status !== 401) throw error;
          return await send(await identity.token(token));
        }
      } catch (error) {
        throw new Error(error?.message === 'PRIVATE_RELAY_READ_DESTINATION_REJECTED' ?
          error.message : 'PRIVATE_RELAY_APP_READ_UNAVAILABLE');
      }
    };
    return auth;
  };
  return new github.constructor({ authStrategy });
}
module.exports = { NAMES, PERMISSIONS, REPOSITORY, REPOSITORY_ID, consume, client };
