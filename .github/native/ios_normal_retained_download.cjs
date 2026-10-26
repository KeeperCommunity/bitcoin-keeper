'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = 'ff3cc6b2721de986d9f6211ef333df57ebc3b1fa';
const tree = 'ee0c587945901788b4ad62ad28ed660ab656cb6a';
const digest = '89806c9d8d71dc032d2ce3ca8b444768705d1ca3ab565aa9ec0652f0277b76f5';
const label = 'keeper/ios-normal-retained-runtime';
const conflicts = ['keeper/native-diagnostic', 'keeper/ios-fresh-runtime', 'keeper/ios-retained-runtime',
  'keeper/ios-launch-debug', 'keeper/ios-signature-comparison', 'keeper/ios-runtime-evidence-readout'];
const steps = ['Compile simulator app once with existing build budget',
  'Verify Xcode-generated simulator entitlements and checkpoint exact app',
  'Save fresh exact app BEFORE every runtime diagnostic', 'Bind successful checkpoint upload before runtime'];
const assert = value => { if (!value) throw Error('Exact normal-Xcode retained origin rejected.'); };

function admit(repository, pr, run, job, artifact, context, env) {
  const labels = pr.labels.map(row => row.name);
  assert(repository.id === 839671816 && repository.private === true && pr.number === 74 &&
    pr.state === 'open' && pr.merged === false && pr.head.repo.id === repository.id &&
    pr.head.sha === env.KEEPER_SOURCE_SHA && env.GITHUB_RUN_ATTEMPT === '1' &&
    context.payload.action === 'labeled' && context.payload.label.name === label &&
    context.payload.pull_request.number === 74 && labels.includes(label) &&
    !conflicts.some(x => labels.includes(x)));
  assert(run.id === 40351735911 && run.run_attempt === 1 && run.head_sha === source &&
    run.head_commit.tree_id === tree && run.status === 'completed' && run.conclusion === 'failure' &&
    run.workflow_id === 397077786 && run.check_suite_id === 109366289849 &&
    run.path === '.github/workflows/keeper-private-ios-fresh-runtime.yml' && run.event === 'pull_request' &&
    run.repository.id === repository.id && run.repository.private === true &&
    run.head_repository.id === repository.id && run.head_repository.private === true);
  assert(job.id === 121673312232 && job.run_id === run.id && job.head_sha === source &&
    job.run_attempt === 1 && job.name === 'fresh' && job.status === 'completed' && job.conclusion === 'failure');
  const receipts = steps.map(name => {
    const matches = job.steps.filter(row => row.name === name);
    assert(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success' &&
      typeof matches[0].started_at === 'string' && !!matches[0].started_at &&
      typeof matches[0].completed_at === 'string' && !!matches[0].completed_at);
    const row = matches[0];
    return { name, status: row.status, conclusion: row.conclusion,
      started_at: row.started_at, completed_at: row.completed_at };
  });
  assert(artifact.id === 12667427189 && artifact.expired === false && artifact.size_in_bytes === 33120781 &&
    artifact.digest === `sha256:${digest}` &&
    artifact.name === `keeper-private-ios-simulator-app-${source}-40351735911-1` &&
    artifact.workflow_run.id === run.id && artifact.workflow_run.head_sha === source &&
    artifact.workflow_run.repository_id === repository.id && artifact.workflow_run.head_repository_id === repository.id);
  return { schema: 1, repository_id: repository.id, source_sha: source, source_tree: tree,
    run_id: run.id, run_attempt: 1, job_id: job.id, artifact_id: artifact.id,
    artifact_zip_sha256: digest, steps: receipts, original_smoke: 'FAIL_PRESERVED', native_acceptance: false };
}

module.exports = async function download({ github, context, env = process.env }) {
  const { data: repository } = await github.rest.repos.get(context.repo);
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: 74 });
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...context.repo, run_id: 40351735911 });
  const { data: job } = await github.rest.actions.getJobForWorkflowRun({ ...context.repo, job_id: 121673312232 });
  const { data: artifact } = await github.rest.actions.getArtifact({ ...context.repo, artifact_id: 12667427189 });
  const proof = admit(repository, pr, run, job, artifact, context, env);
  const { data } = await github.rest.actions.downloadArtifact({ ...context.repo, artifact_id: artifact.id, archive_format: 'zip' });
  assert(Buffer.isBuffer(data) || data instanceof ArrayBuffer || ArrayBuffer.isView(data));
  const raw = Buffer.from(data);
  assert(raw.length === artifact.size_in_bytes && crypto.createHash('sha256').update(raw).digest('hex') === digest);
  fs.writeFileSync(path.join(env.RUNNER_TEMP, 'keeper-normal-ios-app.zip'), raw, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(env.RUNNER_TEMP, 'keeper-normal-ios-origin.json'), JSON.stringify(proof), { flag: 'wx', mode: 0o600 });
};
module.exports.admit = admit;
