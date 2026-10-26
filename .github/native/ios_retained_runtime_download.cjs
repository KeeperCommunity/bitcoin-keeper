'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The exact original private Actions ZIP is retained without rebuilding or
// extracting it. Python separately admits every inner manifest and app byte.
module.exports = async function download({ github, context, env = process.env }) {
  const repo = context.repo;
  const { data: repository } = await github.rest.repos.get(repo);
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: context.payload.pull_request.number });
  if (repository.id !== 839671816 || repository.private !== true ||
      pr.head.repo.id !== repository.id || pr.head.sha !== env.KEEPER_SOURCE_SHA ||
      context.payload.action !== 'labeled' || context.payload.label.name !== 'keeper/ios-retained-runtime' ||
      !pr.labels.some(x => x.name === 'keeper/ios-retained-runtime') ||
      pr.labels.some(x => x.name === 'keeper/native-diagnostic')) {
    throw new Error('Private retained-runtime selection changed.');
  }
  const source = 'ddcd0970f80e23adf86a093cf3eebf8ad363cec9';
  const digest = 'fd1f27948a19811ecd9c80a6fe0a400a290766fbdaa5b55ef5eaa02b1224db37';
  const { data: run } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: 40189694110 });
  const { data: artifact } = await github.rest.actions.getArtifact({ ...repo, artifact_id: 12598443612 });
  if (run.id !== 40189694110 || run.run_attempt !== 1 || run.head_sha !== source ||
      run.status !== 'completed' || run.conclusion !== 'failure' || run.workflow_id !== 395792275 ||
      artifact.id !== 12598443612 || artifact.expired !== false || artifact.size_in_bytes !== 33100856 ||
      artifact.name !== `keeper-private-ios-simulator-app-${source}-40189694110-1` ||
      artifact.digest !== `sha256:${digest}` || artifact.workflow_run.id !== run.id ||
      artifact.workflow_run.head_sha !== source || artifact.workflow_run.repository_id !== repository.id ||
      artifact.workflow_run.head_repository_id !== repository.id) {
    throw new Error('Original private build artifact identity changed.');
  }
  const { data: job } = await github.rest.actions.getJobForWorkflowRun({ ...repo, job_id: 121157855365 });
  const build = job.steps?.filter(step => step.name === 'Build simulator app once');
  if (job.id !== 121157855365 || job.run_id !== run.id || job.head_sha !== source ||
      job.run_attempt !== 1 || job.status !== 'completed' || job.conclusion !== 'failure' ||
      build?.length !== 1 || build[0].status !== 'completed' || build[0].conclusion !== 'success' ||
      !build[0].started_at || !build[0].completed_at) {
    throw new Error('Original simulator build step did not complete successfully.');
  }
  const { data } = await github.rest.actions.downloadArtifact({ ...repo, artifact_id: artifact.id, archive_format: 'zip' });
  if (!(data instanceof ArrayBuffer) && !Buffer.isBuffer(data) && !ArrayBuffer.isView(data)) {
    throw new Error('Expected binary artifact response.');
  }
  const payload = Buffer.from(data);
  if (payload.length !== artifact.size_in_bytes || crypto.createHash('sha256').update(payload).digest('hex') !== digest) {
    throw new Error('Original private artifact ZIP bytes changed.');
  }
  fs.writeFileSync(path.join(env.RUNNER_TEMP, 'keeper-original-ios-app.zip'), payload, { flag: 'wx', mode: 0o600 });
  const proof = { schema: 1, repository_id: repository.id, source_sha: source,
    run_id: run.id, run_attempt: run.run_attempt, job_id: job.id,
    build_step: { name: build[0].name, status: build[0].status, conclusion: build[0].conclusion,
      started_at: build[0].started_at, completed_at: build[0].completed_at },
    artifact_id: artifact.id, artifact_zip_sha256: digest, native_acceptance: false };
  fs.writeFileSync(path.join(env.RUNNER_TEMP, 'keeper-original-ios-build-proof.json'),
    JSON.stringify(proof), { flag: 'wx', mode: 0o600 });
};
