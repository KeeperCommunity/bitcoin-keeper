'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const download = require('../native/ios_normal_retained_download.cjs');
const source = 'ff3cc6b2721de986d9f6211ef333df57ebc3b1fa';
const sha = '89806c9d8d71dc032d2ce3ca8b444768705d1ca3ab565aa9ec0652f0277b76f5';
function fixture() {
  const repository = { id: 839671816, private: true };
  const pr = { number: 74, state: 'open', merged: false, head: { repo: { id: repository.id }, sha: 'a'.repeat(40) },
    labels: [{ name: 'keeper/ios-normal-retained-runtime' }] };
  const run = { id: 40351735911, run_attempt: 1, head_sha: source,
    head_commit: { tree_id: 'ee0c587945901788b4ad62ad28ed660ab656cb6a' }, status: 'completed', conclusion: 'failure',
    workflow_id: 397077786, check_suite_id: 109366289849, path: '.github/workflows/keeper-private-ios-fresh-runtime.yml',
    event: 'pull_request', repository, head_repository: repository };
  const job = { id: 121673312232, run_id: run.id, head_sha: source, run_attempt: 1, name: 'fresh',
    status: 'completed', conclusion: 'failure', steps: [
      'Compile simulator app once with existing build budget',
      'Verify Xcode-generated simulator entitlements and checkpoint exact app',
      'Save fresh exact app BEFORE every runtime diagnostic', 'Bind successful checkpoint upload before runtime'
    ].map(name => ({ name, status: 'completed', conclusion: 'success',
      started_at: '2026-10-26T16:24:00Z', completed_at: '2026-10-26T16:24:01Z' })) };
  const artifact = { id: 12667427189, expired: false, size_in_bytes: 33120781, digest: `sha256:${sha}`,
    name: `keeper-private-ios-simulator-app-${source}-40351735911-1`,
    workflow_run: { id: run.id, head_sha: source, repository_id: repository.id, head_repository_id: repository.id } };
  const context = { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper-private' },
    payload: { pull_request: { number: 74 }, action: 'labeled', label: { name: 'keeper/ios-normal-retained-runtime' } } };
  const env = { KEEPER_SOURCE_SHA: pr.head.sha, GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: '/unused' };
  return { repository, pr, run, job, artifact, context, env };
}
const admit = f => download.admit(f.repository, f.pr, f.run, f.job, f.artifact, f.context, f.env);

test('failed original run admits only exact successful compile checkpoint and upload proof', () => {
  const proof = admit(fixture());
  assert.equal(proof.original_smoke, 'FAIL_PRESERVED'); assert.equal(proof.native_acceptance, false);
  assert.equal(proof.source_sha, source); assert.equal(proof.steps.length, 4);
});

test('every successful phase receipt is required, unique, completed and timed', () => {
  for (let index = 0; index < 4; index++) {
    for (const change of [f => f.job.steps[index].conclusion = 'failure',
      f => f.job.steps[index].status = 'in_progress', f => delete f.job.steps[index].started_at,
      f => f.job.steps.push({ ...f.job.steps[index] }), f => f.job.steps.splice(index, 1)]) {
      const f = fixture(); change(f); assert.throws(() => admit(f), /origin rejected/);
    }
  }
});

test('private selector, actual source/run/job/archive bindings and attempt are fail closed', () => {
  for (const change of [f => f.repository.private = false, f => f.pr.number = 73,
    f => f.pr.state = 'closed', f => f.pr.head.sha = 'b'.repeat(40),
    f => f.pr.labels.push({ name: 'keeper/ios-fresh-runtime' }),
    f => f.context.payload.label.name = 'keeper/ios-retained-runtime',
    f => f.env.GITHUB_RUN_ATTEMPT = '2', f => f.run.run_attempt++, f => f.run.head_sha = 'b'.repeat(40),
    f => f.run.head_commit.tree_id = 'b'.repeat(40), f => f.run.check_suite_id++,
    f => f.job.id++, f => f.job.run_id++, f => f.job.head_sha = 'b'.repeat(40),
    f => f.artifact.id++, f => f.artifact.expired = true, f => f.artifact.size_in_bytes++,
    f => f.artifact.digest = 'sha256:' + 'b'.repeat(64), f => f.artifact.workflow_run.head_repository_id++]) {
    const f = fixture(); change(f); assert.throws(() => admit(f), /origin rejected/);
  }
});

test('admitted API metadata cannot substitute for exact downloaded ZIP bytes', async () => {
  const f = fixture(); let downloads = 0;
  f.github = { rest: { repos: { get: async () => ({ data: f.repository }) },
    pulls: { get: async () => ({ data: f.pr }) }, actions: {
      getWorkflowRun: async () => ({ data: f.run }), getJobForWorkflowRun: async () => ({ data: f.job }),
      getArtifact: async () => ({ data: f.artifact }), downloadArtifact: async () => { downloads++; return { data: Buffer.from('PRIVATE_SENTINEL') }; }
    } } };
  await assert.rejects(download(f), /origin rejected/); assert.equal(downloads, 1);
});
