'use strict';
// Token acquisition only. The protected worker supplies the existing operation's
// scoped credential; no signing identity, GitHub token or app code is loaded.
const crypto = require('node:crypto');
const { parseStrictJson } = require('../.github/native/strict_json.cjs');
const GOOGLE = 'https://www.googleapis.com/oauth2/v4/token';
const demand = ok => { if (!ok) throw new Error('STORE_AUTHENTICATION_UNAVAILABLE'); };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function jwt(header, payload, privateKey, algorithm) {
  const input = encode(header) + '.' + encode(payload);
  return input + '.' + crypto.sign(algorithm, Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
}
async function token(provider, env, { fetchImpl = fetch, clock = Date.now } = {}) {
  const now = Math.floor(clock() / 1000);
  demand(Number.isSafeInteger(now) && now > 0);
  if (provider === 'ios') {
    demand(/^[A-Z0-9]{10}$/.test(env.KEEPER_ASC_KEY_ID || '') &&
      /^[a-fA-F0-9-]{36}$/.test(env.KEEPER_ASC_ISSUER_ID || '') &&
      typeof env.KEEPER_ASC_KEY_BASE64 === 'string' && env.KEEPER_ASC_KEY_BASE64.length < 16384);
    const bytes = Buffer.from(env.KEEPER_ASC_KEY_BASE64, 'base64');
    demand(bytes.toString('base64') === env.KEEPER_ASC_KEY_BASE64);
    const key = crypto.createPrivateKey(bytes);
    demand(key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1');
    return jwt({ alg: 'ES256', kid: env.KEEPER_ASC_KEY_ID, typ: 'JWT' },
      { iss: env.KEEPER_ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }, key, 'sha256');
  }
  demand(provider === 'play' && typeof env.KEEPER_PLAY_SERVICE_ACCOUNT === 'string');
  const account = parseStrictJson(Buffer.from(env.KEEPER_PLAY_SERVICE_ACCOUNT), 32768);
  demand(account.type === 'service_account' && typeof account.client_email === 'string' &&
    /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/.test(account.client_email) &&
    typeof account.private_key === 'string' && (!account.token_uri ||
      ['https://oauth2.googleapis.com/token', GOOGLE].includes(account.token_uri)));
  const key = crypto.createPrivateKey(account.private_key);
  demand(key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails?.modulusLength >= 2048);
  const assertion = jwt({ alg: 'RS256', typ: 'JWT' }, { iss: account.client_email, iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/androidpublisher', aud: GOOGLE }, key, 'RSA-SHA256');
  const response = await fetchImpl(GOOGLE, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  let reader;
  try {
    demand(response?.ok === true && response.body?.getReader);
    reader = response.body.getReader(); const chunks = []; let size = 0;
    for (;;) {
      const row = await reader.read(); if (row.done) break;
      demand(row.value instanceof Uint8Array); size += row.value.length; demand(size <= 32768); chunks.push(Buffer.from(row.value));
    }
    const value = parseStrictJson(Buffer.concat(chunks), 32768);
    demand(value.token_type === 'Bearer' && typeof value.access_token === 'string' && value.access_token.length > 0 &&
      !/[\r\n]/.test(value.access_token) && Number.isInteger(value.expires_in) && value.expires_in >= 300 && value.expires_in <= 3600);
    return value.access_token;
  } finally { try { await (reader ? reader.cancel() : response?.body?.cancel()); } catch { /* no secret/provider output */ } }
}
module.exports = { token };
if (require.main === module) (async () => {
  demand(process.argv.length === 3 && process.version === 'v22.23.4' &&
    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted');
  process.stdout.write(JSON.stringify({ token: await token(process.argv[2], process.env) }));
})().catch(() => { console.error('Store authentication unavailable; no publication performed.'); process.exitCode = 1; });
