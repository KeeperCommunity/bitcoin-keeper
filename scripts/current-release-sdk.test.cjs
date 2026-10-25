'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const run = require('./fixtures/current-release-real-sdk.cjs');
const { childEnvironment } = require('./protected-release-worker.cjs');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
// A minimal SDK interface exercises controls in ordinary unit runs. The same
// helper is separately run against the pinned github-script SDK distribution.
class ControlledSDK {
  constructor(options) { this.auth = options.auth; this.options = options; }
  async request(route, options) {
    const response = await options.request.fetch(route.slice(4), { method: 'GET',
      headers: { authorization: 'token ' + this.auth, ...options.headers } });
    if (response.status >= 400) throw new Error('CONTROLLED_API_REJECTED');
    return { status: response.status };
  }
}
test('new release metadata, provenance archive and signed-archive transports preserve bounded custody', async () => {
  const result = await run(ControlledSDK);
  assert.equal(result.cases.length, 29);
  assert.equal(result.real_service_requests, 0);
  assert.equal(result.real_credentials, false);
});
test('native children observe only selected operation credentials and explicitly allowed build inputs', () => {
  const operations = {
    'ios-signed-build': ['KEEPER_PRODUCTION_CONFIG_BASE64', 'KEEPER_IOS_P12_BASE64', 'KEEPER_IOS_P12_PASSWORD', 'KEEPER_IOS_PROFILE_BASE64'],
    'android-signed-build': ['KEEPER_PRODUCTION_CONFIG_BASE64', 'KEEPER_ANDROID_KEYSTORE_BASE64', 'STORE_PASSWORD', 'KEY_PASSWORD', 'KEY_ALIAS'],
    'testflight-upload': ['KEEPER_ASC_KEY_ID', 'KEEPER_ASC_ISSUER_ID', 'KEEPER_ASC_KEY_BASE64'],
    'play-internal-upload': ['KEEPER_PLAY_SERVICE_ACCOUNT'],
  };
  const forbidden = ['GH_TOKEN', 'GITHUB_TOKEN', 'INPUT_GITHUB-TOKEN', 'INPUT_GITHUB_TOKEN',
    'ACTIONS_RUNTIME_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'KEEPER_CANONICAL_PIN_READ_TOKEN',
    'KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN', 'KEEPER_RELEASE_PROVENANCE_READ_TOKEN',
    'UNRELATED_STEP_SECRET', 'NODE_OPTIONS', 'BASH_ENV', 'LD_PRELOAD'];
  const env = { PATH: process.env.PATH, HOME: '/tmp', LANG: 'C.UTF-8',
    KEEPER_EXPECTED_CERT_SHA256: 'approved-identity', ANDROID_HOME: '/disposable/android',
    ...Object.fromEntries([...forbidden, ...new Set(Object.values(operations).flat())]
      .map(name => [name, 'DISPOSABLE_' + name])) };
  for (const [operation, allowed] of Object.entries(operations)) {
    const output = execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
      { env: childEnvironment(env, operation), encoding: 'utf8' });
    const observed = JSON.parse(output);
    for (const name of forbidden) assert.equal(observed[name], undefined, `${operation} leaked ${name}`);
    for (const name of new Set(Object.values(operations).flat())) assert.equal(observed[name],
      allowed.includes(name) ? env[name] : undefined, `${operation} inherited wrong operation credential ${name}`);
    assert.equal(observed.PATH, env.PATH); assert.equal(observed.HOME, '/tmp');
    assert.equal(observed.KEEPER_EXPECTED_CERT_SHA256, 'approved-identity');
    assert.equal(observed.ANDROID_HOME, '/disposable/android');
  }
  assert.equal(env.GH_TOKEN, 'DISPOSABLE_GH_TOKEN', 'boundary does not mutate the caller snapshot');
  assert.throws(() => childEnvironment(env, 'public-release'), /INVALID_CHILD_OPERATION/);
});

// This control exercises the actual SDK worker upload function. Only authority
// and Python execution boundaries are replaced; it never grants a real proof or
// invokes a native/provider adapter. The archive transport remains production code.
function uploadControl(mutate) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-upload-refresh-control-'));
  const source = 'a'.repeat(40), file = path.join(__dirname, 'protected-release-worker.cjs');
  const initialExpiry = '2030-01-02T12:00:00Z', finalExpiry = '2030-01-02T03:00:00Z';
  const request = { repository: 'KeeperCommunity/bitcoin-keeper', ref: 'refs/heads/sprint',
    driverSha: source, sourceSha: source, releaseRef: 'release/2.6.4', operation: 'play-internal-upload',
    version: '2.6.4', build: '400', artifactSha256: 'b'.repeat(64), approvalCommentId: '7' };
  const payload = Buffer.from('DISPOSABLE_SIGNED_ARCHIVE_BYTES');
  const artifact = { id: 88, expired: false, size_in_bytes: payload.length,
    digest: 'sha256:' + crypto.createHash('sha256').update(payload).digest('hex'),
    workflow_run: { id: 500, head_sha: source } };
  const workflow = { id: 99, state: 'active', path: '.github/workflows/keeper-protected-release-workers.yml' };
  const sourceRun = { id: 500, workflow_id: workflow.id, run_attempt: 1, status: 'completed', conclusion: 'success',
    head_sha: source, head_branch: 'sprint', event: 'workflow_dispatch', path: workflow.path,
    repository: { id: 470904030 }, head_repository: { id: 470904030, full_name: request.repository } };
  const state = { gateReads: 0, producerReads: 0, executes: [], unpacked: 0, workflowReads: 0 };
  const gate = {
    requestFromEnvironment: () => ({ ...request }),
    collectEvidenceWithSDK: async () => ({ comment: { body: 'Scoped approval\nExpires at: ' +
      (++state.gateReads === 1 ? initialExpiry : finalExpiry) } }),
    validateEvidence: () => ({ environment: 'keeper-release-android' }),
  };
  const api = { json: async endpoint => {
    if (endpoint === 'actions/artifacts/88') return { value: structuredClone(artifact) };
    if (endpoint === 'actions/runs/500') {
      state.producerReads++;
      const value = structuredClone(sourceRun);
      if (state.producerReads > 1 && mutate) mutate(value);
      return { value };
    }
    assert.equal(endpoint, 'actions/workflows/keeper-protected-release-workers.yml');
    state.workflowReads++; return { value: structuredClone(workflow) };
  } };
  const child = { execFileSync(command, args, options) {
    if (command === 'git') return source + '\n';
    assert.equal(command, 'python3');
    const context = JSON.parse(fs.readFileSync(args[2], 'utf8'));
    if (args[1] === 'unpack') {
      state.unpacked++;
      return JSON.stringify({ schema: 1, ...context, operation: 'android-signed-build',
        sourceRunId: undefined, sourceRunAttempt: undefined, runId: '500', runAttempt: 1,
        signatureVerified: true, storeUploaded: false });
    }
    assert.equal(args[1], 'execute');
    state.executes.push({ context, env: options.env }); return '';
  } };
  const isolated = new Module(file, module), requireActual = Module.createRequire(file);
  isolated.filename = file; isolated.paths = module.paths;
  isolated.require = name => name === './protected-release-plan.cjs' ? gate :
    name === './current-release-origin.cjs' ? { sdk: () => api } :
      name === 'node:child_process' ? child : requireActual(name);
  isolated._compile(fs.readFileSync(file, 'utf8'), file);
  const github = { request: async (route, options) => {
    assert.equal(route, 'GET https://api.github.com/repos/KeeperCommunity/bitcoin-keeper/actions/artifacts/88/zip');
    const response = await options.request.fetch(route.slice(4), { method: 'GET', headers: {} });
    return { status: response.status };
  } };
  const fetchImpl = async url => String(url).startsWith('https://api.github.com/') ?
    new Response('', { status: 302, headers: { location: 'https://control.blob.core.windows.net/88' } }) :
    new Response(payload);
  const env = { PATH: process.env.PATH, HOME: '/tmp', RUNNER_TEMP: directory,
    KEEPER_CANDIDATE_PATH: directory, KEEPER_CERT_SHA256: 'c'.repeat(64), KEEPER_CONFIG_SHA256: 'd'.repeat(64),
    KEEPER_ARTIFACT_ID: '88', GITHUB_RUN_ATTEMPT: '1', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
    KEEPER_PLAY_SERVICE_ACCOUNT: 'DISPOSABLE_SELECTED_UPLOAD_ACCOUNT', INPUT_GITHUB_TOKEN: 'DISPOSABLE_READER' };
  return { directory, state, finalExpiry, run: () => isolated.exports.run('execute', {
    github, context: { sha: source, job: 'approved-operation', runId: 42 }, env, fetchImpl }) };
}
test('actual upload path uses the refreshed approval deadline after artifact transport', async () => {
  const f = uploadControl();
  try {
    await f.run();
    assert.equal(f.state.gateReads, 2); assert.equal(f.state.producerReads, 2); assert.equal(f.state.workflowReads, 2);
    assert.equal(f.state.unpacked, 1); assert.equal(f.state.executes.length, 1);
    assert.equal(f.state.executes[0].context.approvalExpiresAt, f.finalExpiry);
    assert.equal(f.state.executes[0].env.INPUT_GITHUB_TOKEN, undefined);
    assert.deepEqual(fs.readdirSync(f.directory), [], 'private staging must be removed');
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});
for (const [name, mutate] of Object.entries({ attempt: run => run.run_attempt++,
  status: run => { run.status = 'in_progress'; run.conclusion = null; } }))
  test(`actual upload path blocks a revoked producer ${name} before invoking the adapter`, async () => {
    const f = uploadControl(mutate);
    try {
      await assert.rejects(f.run(), /SIGNED_PRODUCER_CHANGED/);
      assert.equal(f.state.gateReads, 2); assert.equal(f.state.unpacked, 1); assert.equal(f.state.executes.length, 0);
      assert.deepEqual(fs.readdirSync(f.directory), [], 'failed staging must be removed');
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
  });
