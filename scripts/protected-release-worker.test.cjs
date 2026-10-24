'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { workerRequest, validateArtifactRun, excludeOwnExecutionChecks } = require('./protected-release-worker.cjs');
const { approvalBody } = require('./protected-release-plan.cjs');
function fixture(operation = 'ios-signed-build') {
  const source = 'a'.repeat(40);
  const input = { source_sha: source, release_ref: 'release/2.6.5', operation, version: '2.6.5', build: '621',
    artifact_sha256: operation.endsWith('-upload') ? 'b'.repeat(64) : 'pending', approval_comment_id: '123',
    certificate_sha256: 'c'.repeat(64), config_sha256: 'd'.repeat(64), artifact_id: operation.endsWith('-upload') ? '234' : 'none' };
  const env = { GITHUB_REPOSITORY: 'KeeperCommunity/bitcoin-keeper', GITHUB_REF: 'refs/heads/sprint', GITHUB_SHA: source,
    KEEPER_RELEASE_REQUEST_JSON: JSON.stringify(input) };
  const request = workerRequest(env);
  return { input, env, request };
}
test('signed build requires current canonical installed source and exact metadata-only request', () => {
  const { input, env } = fixture();
  input.source_sha = 'f'.repeat(40);
  assert.throws(() => workerRequest({ ...env, KEEPER_RELEASE_REQUEST_JSON: JSON.stringify(input) }));
  input.source_sha = env.GITHUB_SHA;
  input.arbitrary_secret = 'never-pass-through';
  assert.throws(() => workerRequest({ ...env, KEEPER_RELEASE_REQUEST_JSON: JSON.stringify(input) }));
});
test('upload cannot reuse pending artifact or unapproved signing identity/config', () => {
  const { input, env } = fixture('testflight-upload');
  for (const change of [{ artifact_sha256: 'pending' }, { certificate_sha256: '' }, { config_sha256: 'secret-value' }, { artifact_id: 'moving-name' }]) {
    assert.throws(() => workerRequest({ ...env, KEEPER_RELEASE_REQUEST_JSON: JSON.stringify({ ...input, ...change }) }));
  }
});
test('receipt binds identity, config and explicit signed artifact storage approval', () => {
  const { request } = fixture();
  const body = approvalBody(request, '2026-10-22T13:00:00Z');
  assert.ok(body.includes(`Signing identity SHA256: ${request.identitySha256}`));
  assert.ok(body.includes(`Production config SHA256: ${request.configSha256}`));
  assert.ok(body.includes('Artifact storage: GitHub Actions public-repository readers (14 days)'));
});
function artifactFixture() {
  const { request } = fixture('testflight-upload');
  const artifact = { expired: false, workflow_run: { head_sha: request.sourceSha } };
  const run = { id: 456, run_attempt: 2, head_sha: request.sourceSha, head_repository: { full_name: request.repository },
    event: 'workflow_dispatch', conclusion: 'success', path: '.github/workflows/keeper-protected-release-workers.yml' };
  const receipt = { schema: 1, sourceSha: request.sourceSha, driverSha: request.sourceSha, operation: 'ios-signed-build',
    version: request.version, build: request.build, artifactSha256: request.artifactSha256, identitySha256: request.identitySha256,
    configSha256: request.configSha256, runId: '456', runAttempt: 2, signatureVerified: true, storeUploaded: false };
  return { request, artifact, run, receipt };
}
test('accepts only exact completed canonical signing producer receipt', () => {
  const { request, artifact, run, receipt } = artifactFixture();
  assert.doesNotThrow(() => validateArtifactRun(request, artifact, run, receipt));
});
for (const [name, mutate] of [
  ['expired artifact', f => { f.artifact.expired = true; }],
  ['wrong source', f => { f.artifact.workflow_run.head_sha = 'f'.repeat(40); }],
  ['PR producer', f => { f.run.event = 'pull_request'; }],
  ['wrong workflow', f => { f.run.path = '.github/workflows/other.yml'; }],
  ['failed producer', f => { f.run.conclusion = 'failure'; }],
  ['wrong run attempt', f => { f.receipt.runAttempt = 1; }],
  ['wrong artifact digest', f => { f.receipt.artifactSha256 = 'e'.repeat(64); }],
  ['unsigned metadata', f => { f.receipt.signatureVerified = false; }],
  ['reused upload receipt', f => { f.receipt.storeUploaded = true; }],
  ['wrong config', f => { f.receipt.configSha256 = 'e'.repeat(64); }],
]) test(`artifact gate rejects ${name}`, () => {
  const f = artifactFixture(); mutate(f);
  assert.throws(() => validateArtifactRun(f.request, f.artifact, f.run, f.receipt));
});

function selfCheckFixture() {
  const { request } = fixture();
  const current = { runId: '1234', runAttempt: 2 };
  const run = { id: 1234, run_attempt: 2, head_sha: request.driverSha, head_repository: { full_name: request.repository },
    event: 'workflow_dispatch', path: '.github/workflows/keeper-protected-release-workers.yml', check_suite_id: 5678 };
  const job = { run_id: 1234, run_attempt: 2, head_sha: request.driverSha, name: 'plan', check_run_url: 'https://api.github.com/repos/KeeperCommunity/bitcoin-keeper/check-runs/789' };
  const checks = [
    { id: 789, name: 'plan', check_suite: { id: 5678 }, head_sha: request.sourceSha, status: 'in_progress', conclusion: null },
    { id: 888, name: 'Tests', check_suite: { id: 9999 }, head_sha: request.sourceSha, status: 'completed', conclusion: 'success' },
  ];
  return { request, current, run, jobs: { total_count: 1, jobs: [job] }, evidence: { checks: { total_count: checks.length, check_runs: checks } } };
}
test('excludes only this trusted run/attempt pending check; keeps required independent success', () => {
  const f = selfCheckFixture();
  const result = excludeOwnExecutionChecks(f.request, f.evidence, f.run, f.jobs, f.current);
  assert.deepEqual(result.checks.check_runs.map(check => check.name), ['Tests']);
  assert.equal(result.checks.total_count, 1);
});
for (const conclusion of [null, 'failure']) test(`retains unrelated ${conclusion || 'pending'} checks`, () => {
  const f = selfCheckFixture();
  f.evidence.checks.check_runs.push({ id: 999, name: 'Other', check_suite: { id: 9999 }, head_sha: f.request.sourceSha, status: conclusion ? 'completed' : 'in_progress', conclusion });
  f.evidence.checks.total_count++;
  const result = excludeOwnExecutionChecks(f.request, f.evidence, f.run, f.jobs, f.current);
  assert.ok(result.checks.check_runs.some(check => check.name === 'Other' && check.conclusion === conclusion));
});
test('old attempt, mismatched producer, untrusted check URL and incomplete pagination fail closed', () => {
  for (const mutate of [f => { f.run.run_attempt = 1; }, f => { f.jobs.jobs[0].run_attempt = 1; },
    f => { f.run.event = 'pull_request'; }, f => { f.jobs.jobs[0].check_run_url = 'https://other.invalid/check-runs/789'; },
    f => { f.evidence.checks.total_count = 101; }]) {
    const f = selfCheckFixture(); mutate(f);
    assert.throws(() => excludeOwnExecutionChecks(f.request, f.evidence, f.run, f.jobs, f.current));
  }
});
