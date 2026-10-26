'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const download = require('../native/ios_retained_runtime_download.cjs');
const source = 'ddcd0970f80e23adf86a093cf3eebf8ad363cec9';
const digest = 'fd1f27948a19811ecd9c80a6fe0a400a290766fbdaa5b55ef5eaa02b1224db37';
function fixture() {
  let downloads = 0;
  const run = { id: 40189694110, run_attempt: 1, head_sha: source,
    status: 'completed', conclusion: 'failure', workflow_id: 395792275 };
  const artifact = { id: 12598443612, expired: false, size_in_bytes: 33100856,
    name: `keeper-private-ios-simulator-app-${source}-40189694110-1`, digest: `sha256:${digest}`,
    workflow_run: { id: run.id, head_sha: source, repository_id: 839671816, head_repository_id: 839671816 } };
  const job = { id: 121157855365, run_id: run.id, head_sha: source, run_attempt: 1,
    status: 'completed', conclusion: 'failure', steps: [{ name: 'Build simulator app once',
      status: 'completed', conclusion: 'success', started_at: '2026-10-25T11:46:24Z',
      completed_at: '2026-10-25T12:11:27Z' }] };
  const context = { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper-private' },
    payload: { pull_request: { number: 73 }, action: 'labeled', label: { name: 'keeper/ios-retained-runtime' } } };
  const github = { rest: { repos: { get: async () => ({ data: { id: 839671816, private: true } }) },
    pulls: { get: async () => ({ data: { head: { repo: { id: 839671816 }, sha: 'f'.repeat(40) },
      labels: [{ name: 'keeper/ios-retained-runtime' }] } }) },
    actions: { getWorkflowRun: async () => ({ data: run }), getArtifact: async () => ({ data: artifact }),
      getJobForWorkflowRun: async () => ({ data: job }),
      downloadArtifact: async () => { downloads++; return { data: Buffer.from('INVALID_APP') }; } } } };
  return { job, context, github, env: { KEEPER_SOURCE_SHA: 'f'.repeat(40), RUNNER_TEMP: '/unused' },
    downloads: () => downloads };
}

test('failed overall run may supply only its exact successful app build step; bytes still must match', async () => {
  const value = fixture();
  await assert.rejects(download(value), /ZIP bytes changed/);
  assert.equal(value.downloads(), 1);
});

test('failed, missing, repeated, foreign and rerun build evidence cannot reach download', async () => {
  const changes = [x => x.job.steps[0].conclusion = 'failure', x => x.job.steps = [],
    x => x.job.steps.push({ ...x.job.steps[0] }), x => x.job.run_id++,
    x => x.job.head_sha = 'b'.repeat(40), x => x.job.run_attempt++];
  for (const change of changes) {
    const value = fixture(); change(value);
    await assert.rejects(download(value), /build step did not complete successfully/);
    assert.equal(value.downloads(), 0);
  }
});

test('the comparison label cannot select the runtime continuation', async () => {
  const value = fixture(); value.context.payload.label.name = 'keeper/ios-signature-comparison';
  await assert.rejects(download(value), /selection changed/);
  assert.equal(value.downloads(), 0);
});
