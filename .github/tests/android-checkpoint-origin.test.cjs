'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const observe = require('../native/android_checkpoint_origin.cjs');

function fixture(t, mode = 'checkpoint') {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'android-origin-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const source = 'a'.repeat(40), workflow = 'b'.repeat(40), tree = 'c'.repeat(40);
  const values = { GITHUB_REPOSITORY_ID: '839671816', GITHUB_RUN_ATTEMPT: '1',
    KEEPER_ANDROID_ORIGIN_MODE: mode, KEEPER_SOURCE_SHA: source, KEEPER_CONTROLLER_SHA: source,
    KEEPER_DIAGNOSTIC: 'true', KEEPER_NATIVE_PLATFORM: 'ANDROID', GITHUB_RUN_ID: '12345',
    RUNNER_NAME: 'owned-test-runner', RUNNER_TEMP: temporary, GITHUB_SHA: workflow,
    GITHUB_WORKFLOW_SHA: workflow,
    GITHUB_WORKFLOW_REF: 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-native-diagnostic.yml@refs/pull/73/merge' };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    process.env[key] = value;
  }
  const repo = { id: 839671816, private: true };
  const initial = { number: 73, head: { sha: source, repo },
    labels: [{ name: 'keeper/native-diagnostic' }, { name: 'keeper/android-diagnostic-only' }] };
  const pr = { ...initial, merge_commit_sha: workflow,
    labels: mode === 'checkpoint' ? [] : [{ name: 'keeper/android-runtime-reuse' }] };
  const context = { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper-private' },
    eventName: 'pull_request', payload: { pull_request: initial } };
  const run = { id: 12345, run_attempt: 1, repository: repo, head_repository: repo,
    workflow_id: 395790359, event: 'pull_request', path: '.github/workflows/keeper-native-diagnostic.yml',
    head_sha: source, head_commit: { tree_id: tree }, check_suite_id: 54321,
    referenced_workflows: [{ sha: workflow, ref: 'refs/pull/73/merge',
      path: `KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-native-platform.yml@${workflow}` }] };
  const job = { id: 67890, run_id: run.id, run_attempt: 1, head_sha: source,
    name: 'android / Native ANDROID build and probes', runner_name: values.RUNNER_NAME,
    status: mode === 'checkpoint' ? 'in_progress' : 'completed', conclusion: mode === 'checkpoint' ? null : 'failure',
    steps: ['Build development app', 'Verify current diagnostic source'].map(name => ({ name, status: 'completed', conclusion: 'success' })) };
  const jobs = { total_count: 1, jobs: [job] };
  const artifact = { id: 999, name: 'synthetic-checkpoint', size_in_bytes: 123, digest: 'sha256:' + 'd'.repeat(64),
    expired: false, workflow_run: { id: run.id, head_sha: source } };
  const calls = [];
  const response = (name, data) => async args => { calls.push({ name, args }); return { data }; };
  const github = { rest: { repos: { get: response('repo', repo) }, pulls: { get: response('pr', pr) },
    actions: { getWorkflowRun: response('run', run), listJobsForWorkflowRunAttempt: response('jobs', jobs),
      getArtifact: response('artifact', artifact) } } };
  if (mode !== 'checkpoint') {
    const controller = path.join(temporary, 'keeper-android-reuse-controller');
    fs.mkdirSync(controller);
    fs.writeFileSync(path.join(controller, 'android_reuse_selection.json'), JSON.stringify({
      armed: true, repository_id: repo.id, run_id: run.id, job_id: job.id, artifact_id: artifact.id }));
  }
  return { temporary, repo, pr, context, run, job, jobs, calls, github,
    call: () => observe({ github, context }),
    output: () => path.join(temporary, mode === 'checkpoint' ? 'keeper-android-checkpoint-origin.json' : `keeper-android-reuse-${mode}.json`) };
}

test('checkpoint records exact official origin after completed build even when the PR later moves', async t => {
  const f = fixture(t);
  f.pr.head = { sha: 'e'.repeat(40), repo: f.repo };
  await f.call();
  const result = JSON.parse(fs.readFileSync(f.output(), 'utf8'));
  assert.equal(result.source_sha, f.run.head_sha);
  assert.equal(result.source_tree, f.run.head_commit.tree_id);
  assert.equal(result.job_id, f.job.id);
  assert.equal(result.workflow_id, f.run.workflow_id);
  assert.equal(result.repository_private, true);
  assert.equal(f.calls.some(x => x.name === 'artifact'), false);
  assert.deepEqual(f.calls.find(x => x.name === 'jobs').args,
    { owner: 'KeeperCommunity', repo: 'bitcoin-keeper-private', run_id: f.run.id, attempt_number: 1, per_page: 100 });
  await assert.rejects(f.call(), /EEXIST/);
});

const rejected = {
  'public repository': f => { f.repo.private = false; },
  'different source': f => { f.run.head_sha = 'e'.repeat(40); },
  'wrong runner': f => { f.job.runner_name = 'another-runner'; },
  'non-PR run': f => { f.run.event = 'push'; },
  'rerun attempt': f => { f.run.run_attempt = 2; },
  'wrong workflow': f => { f.run.workflow_id += 1; },
  'changed workflow revision': f => { f.run.referenced_workflows[0].sha = 'e'.repeat(40); },
  'missing frozen opt-in': f => { f.context.payload.pull_request.labels = []; },
  'failed build': f => { f.job.steps[0].conclusion = 'failure'; },
  'duplicate build step': f => { f.job.steps.push({ ...f.job.steps[0] }); },
  'ambiguous matching job': f => { f.jobs.jobs.push({ ...f.job }); f.jobs.total_count += 1; },
  'truncated job list': f => { f.jobs.total_count = 101; },
};
for (const [name, mutate] of Object.entries(rejected)) {
  test(`checkpoint rejects ${name} without writing provenance`, async t => {
    const f = fixture(t); mutate(f);
    await assert.rejects(f.call(), /provenance rejected/);
    assert.equal(fs.existsSync(f.output()), false);
  });
}
for (const mode of ['before', 'after']) {
  test(`${mode} reuse observation keeps original completed build and artifact IDs`, async t => {
    const f = fixture(t, mode);
    await f.call();
    const result = JSON.parse(fs.readFileSync(f.output(), 'utf8'));
    assert.equal(result.job.conclusion, 'failure');
    assert.equal(result.artifact.id, 999);
    assert.equal(result.current_pr.runtime_opt_in, true);
    assert.equal(result.current_pr.native_opt_in, false);
    assert.equal(result.run.head_sha, f.run.head_sha);
  });
}
test('reuse observation rejects current PR movement before artifact access', async t => {
  const f = fixture(t, 'before'); f.pr.head = { sha: 'e'.repeat(40), repo: f.repo };
  await assert.rejects(f.call(), /provenance rejected/);
  assert.equal(f.calls.some(x => x.name === 'artifact'), false);
});
