'use strict';
// Official nonsecret provenance only. No token, logs, arbitrary response or APK is printed.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function ({ github, context }) {
  const env = process.env;
  const assert = (value) => { if (!value) throw new Error('Private Android provenance rejected.'); };
  assert(context.repo.owner === 'KeeperCommunity' && context.repo.repo === 'bitcoin-keeper-private');
  assert(env.GITHUB_REPOSITORY_ID === '839671816' && context.eventName === 'pull_request');
  assert(context.payload.pull_request.number === 73 && env.GITHUB_RUN_ATTEMPT === '1');
  const { data: repo } = await github.rest.repos.get(context.repo);
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: 73 });
  assert(repo.id === 839671816 && repo.private === true && pr.head.repo.id === repo.id);
  const mode = env.KEEPER_ANDROID_ORIGIN_MODE;
  const labels = pr.labels.map(x => x.name);
  let runId, jobId, selection;
  if (mode === 'checkpoint') {
    // Preserve the already-selected frozen build even if a later reviewed CI
    // successor moves the PR or its scheduling label is removed meanwhile.
    const initial = context.payload.pull_request;
    assert(initial.head.sha === env.KEEPER_SOURCE_SHA && initial.head.repo.id === repo.id);
    assert(initial.labels.some(x => x.name === 'keeper/native-diagnostic'));
    assert(initial.labels.some(x => x.name === 'keeper/android-diagnostic-only'));
    assert(env.KEEPER_DIAGNOSTIC === 'true' && env.KEEPER_NATIVE_PLATFORM === 'ANDROID');
    runId = Number(env.GITHUB_RUN_ID);
  } else {
    assert(mode === 'before' || mode === 'after');
    assert(pr.head.sha === env.KEEPER_CONTROLLER_SHA && pr.merge_commit_sha === env.GITHUB_SHA);
    assert(labels.includes('keeper/android-runtime-reuse') && !labels.includes('keeper/native-diagnostic'));
    selection = JSON.parse(fs.readFileSync(path.join(env.RUNNER_TEMP, 'keeper-android-reuse-controller', 'android_reuse_selection.json'), 'utf8'));
    assert(selection.armed === true && selection.repository_id === repo.id);
    assert(Number.isSafeInteger(selection.run_id) && Number.isSafeInteger(selection.job_id));
    runId = selection.run_id;
    jobId = selection.job_id;
  }
  assert(Number.isSafeInteger(runId) && runId > 0);
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...context.repo, run_id: runId });
  assert(run.id === runId && run.run_attempt === 1 && run.repository.id === repo.id && run.repository.private === true);
  assert(run.event === 'pull_request');
  assert(run.head_repository.id === repo.id && run.workflow_id === 395790359);
  assert(run.path === '.github/workflows/keeper-native-diagnostic.yml');
  const { data: jobs } = await github.rest.actions.listJobsForWorkflowRunAttempt({ ...context.repo, run_id: runId, attempt_number: 1, per_page: 100 });
  assert(jobs.total_count <= 100);
  const candidates = jobs.jobs.filter(x => x.name === 'android / Native ANDROID build and probes' &&
    (mode === 'checkpoint' ? x.runner_name === env.RUNNER_NAME : x.id === jobId));
  assert(candidates.length === 1);
  const job = candidates[0];
  assert(job.head_sha === run.head_sha && job.run_id === run.id && job.run_attempt === 1);
  for (const name of ['Build development app', 'Verify current diagnostic source']) {
    const matches = job.steps.filter(x => x.name === name);
    assert(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success');
  }
  if (mode === 'checkpoint') {
    assert(run.head_sha === env.KEEPER_SOURCE_SHA && job.status === 'in_progress');
    assert(run.referenced_workflows.some(x => x.sha === env.GITHUB_WORKFLOW_SHA &&
      x.ref === 'refs/pull/73/merge' && x.path === 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-native-platform.yml@' + env.GITHUB_WORKFLOW_SHA));
    const result = { schema: 1, repository_id: repo.id, repository_private: true,
      source_sha: run.head_sha, source_tree: run.head_commit.tree_id, run_id: run.id,
      run_attempt: 1, job_id: job.id, job_name: job.name, workflow_id: run.workflow_id,
      workflow_sha: env.GITHUB_WORKFLOW_SHA, workflow_ref: env.GITHUB_WORKFLOW_REF };
    fs.writeFileSync(path.join(env.RUNNER_TEMP, 'keeper-android-checkpoint-origin.json'), JSON.stringify(result) + '\n', { mode: 0o600, flag: 'wx' });
  } else {
    assert(job.status === 'completed' && ['success', 'failure'].includes(job.conclusion));
    for (const name of ['Record official private Android checkpoint origin',
      'Prepare exact private Android build checkpoint', 'Upload private Android build checkpoint']) {
      const matches = job.steps.filter(x => x.name === name);
      assert(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success');
    }
    const { data: artifact } = await github.rest.actions.getArtifact({ ...context.repo, artifact_id: selection.artifact_id });
    const result = { schema: 1, observed_unix_seconds: Math.floor(Date.now() / 1000),
      current_pr: { head: { sha: pr.head.sha, repo: { id: pr.head.repo.id } }, merge_commit_sha: pr.merge_commit_sha,
        runtime_opt_in: true, native_opt_in: false },
      run: { id: run.id, head_sha: run.head_sha, head_commit: { tree_id: run.head_commit.tree_id },
        run_attempt: run.run_attempt, repository: { id: run.repository.id, private: run.repository.private },
        head_repository: { id: run.head_repository.id }, workflow_id: run.workflow_id,
        check_suite_id: run.check_suite_id, path: run.path, referenced_workflows: run.referenced_workflows },
      job: { id: job.id, run_id: job.run_id, head_sha: job.head_sha, run_attempt: job.run_attempt,
        name: job.name, status: job.status, conclusion: job.conclusion,
        steps: job.steps.map(({ name, status, conclusion }) => ({ name, status, conclusion })) },
      artifact: { id: artifact.id, name: artifact.name, size_in_bytes: artifact.size_in_bytes,
        digest: artifact.digest, expired: artifact.expired, workflow_run: artifact.workflow_run } };
    fs.writeFileSync(path.join(env.RUNNER_TEMP, 'keeper-android-reuse-' + mode + '.json'), JSON.stringify(result) + '\n', { mode: 0o600, flag: 'wx' });
  }
};
