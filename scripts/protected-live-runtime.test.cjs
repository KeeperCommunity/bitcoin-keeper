'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Module = require('node:module'), { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
const { workerRequest, childEnvironment } = require('./protected-release-worker.cjs');
const live = require('./live-store-request.cjs');
const { validateUpload, requireBudget } = require('./protected-live-runtime.cjs');
const { gateFixture } = require('./fixtures/current-release-origin.cjs');

function input(operation = 'ios-submit-review', mode = 'execute') {
  const p = { mode, store_snapshot_sha256: mode === 'execute' ? 'e'.repeat(64) : 'pending' };
  if (operation.startsWith('ios-')) Object.assign(p, { app_id: '1234', app_store_version_id: 'version-1', build_id: 'build-1' });
  if (operation === 'ios-submit-review') p.review_submission_id = 'review-1';
  return { source_sha: 'a'.repeat(40), release_ref: 'release/2.6.5', operation, version: '2.6.5', build: '628',
    artifact_sha256: 'b'.repeat(64), certificate_sha256: 'c'.repeat(64), config_sha256: 'd'.repeat(64), artifact_id: '88',
    live_parameters: JSON.stringify(p) };
}
function env(value) { return { GITHUB_REPOSITORY: 'KeeperCommunity/bitcoin-keeper', GITHUB_REF: 'refs/heads/sprint',
  GITHUB_SHA: value.source_sha, KEEPER_RELEASE_REQUEST_JSON: JSON.stringify(value) }; }

for (const operation of live.operations) test(`strict request and scoped credentials for ${operation}`, () => {
  const value = input(operation), request = workerRequest(env(value));
  assert.equal(request.operation, operation); assert.equal(request.approvalCommentId, 'none');
  const inherited = childEnvironment({ GH_TOKEN: 'never', ACTIONS_RUNTIME_TOKEN: 'never',
    KEEPER_IOS_P12_BASE64: 'never', STORE_PASSWORD: 'never', KEEPER_PLAY_SERVICE_ACCOUNT: 'play',
    KEEPER_ASC_KEY_ID: 'asc', KEEPER_ASC_KEY_BASE64: 'asc', KEEPER_ASC_ISSUER_ID: 'asc' }, operation);
  for (const name of ['GH_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'KEEPER_IOS_P12_BASE64', 'STORE_PASSWORD']) assert.equal(inherited[name], undefined);
  assert.equal(inherited.KEEPER_PLAY_SERVICE_ACCOUNT, operation.startsWith('play-') ? 'play' : undefined);
  assert.equal(inherited.KEEPER_ASC_KEY_ID, operation.startsWith('ios-') ? 'asc' : undefined);
  for (const change of [ { artifact_sha256: 'pending' }, { artifact_id: 'none' },
    { live_parameters: value.live_parameters.replace('"execute"', '"automatic"') },
    { live_parameters: '{"mode":"execute",' + value.live_parameters.slice(1) },
    { live_parameters: JSON.stringify({ ...JSON.parse(value.live_parameters), authorization: 'caller-assertion' }) } ]) {
    assert.throws(() => workerRequest(env({ ...value, ...change })));
  }
});

for (const operation of live.operations) test(`real source capability binds ${operation}, late store review and exact store parameters`, async () => {
  const f = gateFixture();
  try {
    f.request.operation = operation; f.request.approvalCommentId = 'none'; f.request.artifactId = '88';
    f.request.artifactSha256 = 'b'.repeat(64);
    if (operation.startsWith('ios-')) { f.environment.name = 'keeper-release-ios'; f.request.build = String(f.manifest.iosBuildNumber); }
    f.request.liveParameters = JSON.stringify(live.parameters(operation, input(operation).live_parameters));
    f.manifest.baselines.android.verifiedAt = '2026-10-15T00:00:00Z';
    f.manifest.baselines.ios.verifiedAt = '2026-10-15T00:00:00Z';
    fs.writeFileSync(path.join(f.candidate, 'release/version.json'), JSON.stringify(f.manifest));
    const evidence = await f.collectGate();
    assert.equal(f.validate(evidence).operation_scope, 'EXISTING_BUILD_LIVE_STORE_OPERATION');
    const proof = await f.collect();
    assert.equal(f.driver.isCurrentReleaseOrigin(proof, f.request), true);
    const saved = f.request.liveParameters;
    f.request.liveParameters = saved.replace('e'.repeat(64), 'f'.repeat(64));
    assert.equal(f.driver.isCurrentReleaseOrigin(proof, f.request), false);
    assert.throws(() => f.validate(evidence));
    f.request.liveParameters = saved;
    f.actorPermissions['release-operator'].permission = 'read';
    await assert.rejects(f.collectGate(), /DISPATCH_UNAUTHORIZED/);
  } finally { f.cleanup(); }
});
test('ordinary signed build keeps the fresh pre-upload store baseline gate', async () => {
  const f = gateFixture();
  try {
    f.request.approvalCommentId = 'none';
    f.manifest.baselines.android.verifiedAt = '2026-10-15T00:00:00Z';
    fs.writeFileSync(path.join(f.candidate, 'release/version.json'), JSON.stringify(f.manifest));
    const evidence = await f.collectGate();
    assert.throws(() => f.validate(evidence), /RELEASE_SOURCE_PREFLIGHT_FAILED/);
  } finally { f.cleanup(); }
});

function provenance() {
  const request = workerRequest(env(input()));
  const artifact = { expired: false, workflow_run: { id: 500, head_sha: request.sourceSha } };
  const run = { id: 500, run_attempt: 2, head_sha: request.sourceSha, head_branch: 'sprint', event: 'workflow_dispatch',
    status: 'completed', conclusion: 'success', path: '.github/workflows/keeper-protected-release-workers.yml',
    repository: { id: 470904030 }, head_repository: { id: 470904030, full_name: request.repository } };
  const receipt = { schema: 1, ...Object.fromEntries(['sourceSha', 'driverSha', 'version', 'build', 'artifactSha256',
    'identitySha256', 'configSha256'].map(name => [name, request[name]])), operation: 'testflight-upload',
    runId: '500', runAttempt: 2, artifactId: '77', sourceRunId: 400, sourceRunAttempt: 1,
    signatureVerified: true, storeUploaded: true };
  return { request, artifact, run, receipt };
}
test('live provenance rejects wrong uploaded bytes, source, attempt, workflow and signing chain', () => {
  const f = provenance(); assert.doesNotThrow(() => validateUpload(f.request, f.artifact, f.run, f.receipt));
  for (const mutate of [f => f.receipt.artifactSha256 = 'f'.repeat(64), f => f.receipt.sourceSha = 'f'.repeat(40),
    f => f.receipt.runAttempt++, f => f.receipt.storeUploaded = false, f => f.run.conclusion = 'failure',
    f => f.run.path = '.github/workflows/other.yml', f => f.artifact.expired = true,
    f => f.receipt.artifactId = 'none', f => f.receipt.sourceRunId = 'caller-json-id']) {
    const bad = provenance(); mutate(bad); assert.throws(() => validateUpload(bad.request, bad.artifact, bad.run, bad.receipt));
  }
});
test('private live operation binds private upload provenance and explicit receipt custody', () => {
  const f = provenance();
  f.request.repository = 'KeeperCommunity/bitcoin-keeper-private';
  const identity = { id: 839671816, full_name: f.request.repository, private: true };
  f.run.repository = { ...identity }; f.run.head_repository = { ...identity };
  Object.assign(f.receipt, { repository: f.request.repository, repositoryId: identity.id, repositoryPrivate: true });
  assert.doesNotThrow(() => validateUpload(f.request, f.artifact, f.run, f.receipt));
  for (const mutate of [v => { v.run.repository.id = 470904030; },
    v => { v.run.repository.private = false; }, v => { delete v.run.head_repository.private; },
    v => { v.receipt.repositoryPrivate = false; }, v => { delete v.receipt.repositoryId; }]) {
    const bad = structuredClone(f); mutate(bad);
    assert.throws(() => validateUpload(bad.request, bad.artifact, bad.run, bad.receipt));
  }
});

// Execute the real bridge's protocol. Only the process boundary is replaced;
// real test/source/native authority is exercised above with the branded fixture.
function protocol({ wrongScope = false, revoke = false } = {}) {
  const file = path.join(__dirname, 'protected-live-runtime.cjs'), original = Module.createRequire(file);
  const state = { refreshes: 0, writes: 0, secrets: null, kills: 0 };
  const deadline = new Date(Date.now() + 3 * 3600000).toISOString();
  const request = workerRequest(env(input())), provider = live.providerRequest(request, provenance().receipt);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-live-protocol-'));
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new EventEmitter();
  child.kill = () => { state.kills++; queueMicrotask(() => child.emit('close', 1)); };
  child.stdin.write = line => {
    state.writes++; assert.deepEqual(JSON.parse(line), { sequence: 1, authorized: true, authorizationExpiresAt: deadline });
    child.stdout.write(JSON.stringify({ kind: 'result', value: { operation: request.operation, publicAvailabilityVerified: false } }) + '\n');
    queueMicrotask(() => child.emit('close', 0));
  };
  const module = { exports: {} };
  new Function('require', 'module', '__dirname', fs.readFileSync(file, 'utf8'))(name => name === 'node:child_process' ? {
    execFileSync() { throw new Error('No native command in protocol control'); },
    spawn(command, args, options) {
      assert.equal(command, 'python3'); state.secrets = options.env;
      queueMicrotask(() => child.stdout.write(JSON.stringify({ kind: 'authorize', sequence: 1,
        request: wrongScope ? { ...provider, build: '629' } : provider }) + '\n'));
      return child;
    },
  } : original(name), module, __dirname);
  const promise = module.exports.runChild({ root: directory, directory, childEnv: { PATH: process.env.PATH },
    expected: { request, provider }, upload: provenance().receipt, signed: {},
    refresh: async () => { state.refreshes++; if (revoke) throw new Error('Current real authority would reject'); return { authorizationExpiresAt: deadline }; } });
  return { state, promise: promise.finally(() => fs.rmSync(directory, { recursive: true, force: true })) };
}
test('private child receives authorization only after parent refreshes exact scope', async () => {
  const f = protocol(); assert.equal((await f.promise).operation, 'ios-submit-review');
  assert.equal(f.state.refreshes, 1); assert.equal(f.state.writes, 1); assert.equal(f.state.kills, 0);
  assert.deepEqual(Object.keys(f.state.secrets), ['PATH']);
});
for (const options of [{ wrongScope: true }, { revoke: true }]) test(`child cannot assert authority: ${JSON.stringify(options)}`, async () => {
  const f = protocol(options); await assert.rejects(f.promise, /LIVE_OPERATION_OUTCOME_REQUIRES_INSPECTION/);
  assert.equal(f.state.writes, 0); assert(f.state.kills > 0);
});

// Complete real bridge -> real private Python protocol/child/adapter -> fake
// store. Only API/archive transport, current authorization and native signature
// prerequisites are disposable boundaries. No credentials or service calls.
for (const operation of live.operations) test(`complete offline driver bridge and Python adapter: ${operation}`, async () => {
  const cp = require('node:child_process'), { zip } = require('../.github/tests/fixtures/private-software.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-complete-live-'));
  const request = workerRequest(env(input(operation)));
  const uploadOperation = operation.startsWith('ios-') ? 'testflight-upload' : 'play-internal-upload';
  const upload = { schema: 1, ...Object.fromEntries(['sourceSha', 'driverSha', 'version', 'build', 'artifactSha256',
    'identitySha256', 'configSha256'].map(name => [name, request[name]])), operation: uploadOperation,
    runId: '500', runAttempt: 1, artifactId: '77', sourceRunId: 400, sourceRunAttempt: 1,
    signatureVerified: true, storeUploaded: true };
  const signed = { ...upload, operation: operation.startsWith('ios-') ? 'ios-signed-build' : 'android-signed-build',
    runId: '400', storeUploaded: false };
  const archives = { 88: zip({ 'receipt.json': Buffer.from(JSON.stringify(upload)) }),
    77: zip({ 'receipt.json': Buffer.from(JSON.stringify(signed)),
      [operation.startsWith('ios-') ? 'release.ipa' : 'release.aab']: Buffer.from('DISPOSABLE_SIGNED_BOUNDARY') }) };
  // Use the actual disposable bytes' digest; the real unpacker checks them.
  const crypto = require('node:crypto');
  request.artifactSha256 = crypto.createHash('sha256').update('DISPOSABLE_SIGNED_BOUNDARY').digest('hex');
  upload.artifactSha256 = signed.artifactSha256 = request.artifactSha256;
  archives[88] = zip({ 'receipt.json': Buffer.from(JSON.stringify(upload)) });
  archives[77] = zip({ 'receipt.json': Buffer.from(JSON.stringify(signed)),
    [operation.startsWith('ios-') ? 'release.ipa' : 'release.aab']: Buffer.from('DISPOSABLE_SIGNED_BOUNDARY') });
  const workflow = { id: 99, state: 'active', path: '.github/workflows/keeper-protected-release-workers.yml' };
  const runs = Object.fromEntries([400, 500].map(id => [id, { id, workflow_id: 99, run_attempt: 1,
    head_sha: request.sourceSha, head_branch: 'sprint', event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
    path: workflow.path, repository: { id: 470904030 }, head_repository: { id: 470904030, full_name: request.repository } }]));
  const artifacts = Object.fromEntries([77, 88].map(id => [id, { id, expired: false, size_in_bytes: archives[id].length,
    digest: 'sha256:' + crypto.createHash('sha256').update(archives[id]).digest('hex'),
    workflow_run: { id: id === 77 ? 400 : 500, head_sha: request.sourceSha } }]));
  const api = { json: async endpoint => ({ value: structuredClone(endpoint.startsWith('actions/artifacts/') ?
    artifacts[endpoint.split('/').at(-1)] : endpoint.startsWith('actions/runs/') ? runs[endpoint.split('/').at(-1)] : workflow) }) };
  const wrapper = `import sys,json,os
from pathlib import Path
from unittest.mock import Mock
sys.path.insert(0, sys.argv[1]); sys.argv=sys.argv[2:]
import live_store_worker as w
from test_live_store_adapters import Apple,Play
c=json.loads(Path(sys.argv[1]).read_text()); p=c['provider']; ios=p['operation'].startswith('ios-')
api=Apple(p['operation']=='ios-release-approved-version') if ios else Play()
if ios:
 api.version['attributes']['versionString']=p['version'];api.build['attributes']['version']=p['build'];api.prerelease['attributes']['version']=p['version']
else:
 api.bundle['sha256']=p['artifactSha256']
snapshot=w.live.plan_ios(api,p,c['uploadReceipt']) if ios else api.preview(p,c['uploadReceipt'])
# Inspect the same fake provider before binding the exact hash on both ends.
if sys.argv[0]=='--snapshot':
 print(json.dumps(snapshot));raise SystemExit(0)
guard=w.worker_module();guard.verify_artifact=lambda *args:None;guard.run=lambda *args,**kwargs:None
w.worker_module=lambda:guard;w.provider_token=lambda *args:'synthetic';w.live.StoreAPI=lambda *args:api
w.execute(c,Path(sys.argv[2]),Path(sys.argv[3]))`;
  const previewFile = path.join(directory, 'preview.json');
  fs.writeFileSync(previewFile, JSON.stringify({ request, provider: live.providerRequest(request, upload), uploadReceipt: upload }));
  const preview = JSON.parse(cp.execFileSync('python3', ['-B', '-c', wrapper, __dirname, '--snapshot', previewFile], { encoding: 'utf8' }));
  const params = JSON.parse(request.liveParameters); params.store_snapshot_sha256 = preview.storeSnapshotSha256;
  request.liveParameters = JSON.stringify(live.parameters(request.operation, JSON.stringify(params)));
  const file = path.join(__dirname, 'protected-live-runtime.cjs'), original = Module.createRequire(file), compiled = { exports: {} };
  new Function('require', 'module', '__dirname', fs.readFileSync(file, 'utf8'))(name => name === 'node:child_process' ? {
    execFileSync: cp.execFileSync,
    spawn(command, args, options) {
      assert.equal(command, 'python3');
      for (const forbidden of ['GH_TOKEN', 'GITHUB_TOKEN', 'KEEPER_CANONICAL_PIN_READ_TOKEN', 'KEEPER_IOS_P12_BASE64']) assert.equal(options.env[forbidden], undefined);
      const child = cp.spawn(command, ['-B', '-c', wrapper, __dirname, ...args.slice(1)], options);
      return child;
    },
  } : name === './current-release-origin.cjs' ? { sdk: () => api } : original(name), compiled, __dirname);
  let revalidations = 0;
  try {
    const result = await compiled.exports.execute({ request, root: path.resolve(__dirname, '..'), directory, github: {},
      context: {}, env: {}, childEnv: { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
        RUNNER_TEMP: directory, KEEPER_EXPECTED_CERT_SHA256: request.identitySha256, KEEPER_EXPECTED_CONFIG_SHA256: request.configSha256 },
      fresh: async () => { revalidations++; return { authorizationExpiresAt: new Date(Date.now() + 3 * 3600000).toISOString() }; },
      downloadSignedArtifact: async (_github, artifact, destination) => fs.writeFileSync(destination, archives[artifact.id]),
      validateArtifactRun: require('./protected-release-worker.cjs').validateArtifactRun });
    assert.equal(result.operation, operation); assert.equal(result.mutationPerformed, true);
    assert.equal(result.publicAvailabilityVerified, false); assert(revalidations >= 3);
    const retained = JSON.parse(fs.readFileSync(path.join(directory, 'keeper-release-output/receipt.json')));
    assert.equal(retained.artifactSha256, request.artifactSha256); assert.equal(retained.uploadedReceiptArtifactId, '88');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('live runtime preserves two-hour operation budget under a controlled clock', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  assert.equal(requireBudget({ authorizationExpiresAt: '2026-10-25T15:00:00Z' }, now), '2026-10-25T15:00:00Z');
  for (const expires of [undefined, 'invalid', '2026-10-25T11:00:00Z', '2026-10-25T14:00:00Z', '2026-10-25T13:59:59Z']) {
    assert.throws(() => requireBudget({ authorizationExpiresAt: expires }, now), /LIVE_AUTHORIZATION_BUDGET/);
  }
});
