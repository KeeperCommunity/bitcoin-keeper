#!/usr/bin/env node
'use strict';
// Installed trusted driver only. The separate Python adapter has no API authority.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const gate = require('./protected-release-plan.cjs');
const hex = /^[a-f0-9]{64}$/;
function demand(value, code) { if (!value) throw new Error(code); }

function workerRequest(env) {
  if (env.KEEPER_RELEASE_REQUEST_JSON) {
    const input = JSON.parse(env.KEEPER_RELEASE_REQUEST_JSON);
    const fields = { source_sha: 'KEEPER_SOURCE_SHA', release_ref: 'KEEPER_RELEASE_REF', operation: 'KEEPER_OPERATION', version: 'KEEPER_VERSION', build: 'KEEPER_BUILD', artifact_sha256: 'KEEPER_ARTIFACT_SHA256', approval_comment_id: 'KEEPER_APPROVAL_COMMENT_ID', certificate_sha256: 'KEEPER_CERT_SHA256', config_sha256: 'KEEPER_CONFIG_SHA256', artifact_id: 'KEEPER_ARTIFACT_ID' };
    demand(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === Object.keys(fields).length && Object.keys(input).every(key => Object.hasOwn(fields, key) && typeof input[key] === 'string'), 'INVALID_REQUEST_JSON');
    env = { ...env, ...Object.fromEntries(Object.entries(fields).map(([key, name]) => [name, input[key]])) };
  }
  const request = gate.requestFromEnvironment(env);
  request.identitySha256 = env.KEEPER_CERT_SHA256;
  request.configSha256 = env.KEEPER_CONFIG_SHA256;
  request.artifactId = env.KEEPER_ARTIFACT_ID;
  demand(hex.test(request.identitySha256 || '') && hex.test(request.configSha256 || ''), 'EXPECTED_IDENTITIES_REQUIRED');
  const upload = request.operation.endsWith('-upload');
  demand(upload ? /^[1-9]\d{0,18}$/.test(request.artifactId || '') : request.artifactId === 'none', 'INVALID_ARTIFACT_REFERENCE');
  // A signed build executes native project/dependency code with signing material.
  // Limit that code to the currently installed, protected canonical source.
  demand(upload || request.sourceSha === request.driverSha, 'SIGNING_REQUIRES_INSTALLED_CANONICAL_SOURCE');
  return request;
}

function validateArtifactRun(request, artifact, run, receipt) {
  demand(!artifact.expired && artifact.workflow_run?.head_sha === request.sourceSha, 'ARTIFACT_SOURCE_MISMATCH');
  demand(run.head_sha === request.sourceSha && run.head_repository?.full_name === request.repository && run.event === 'workflow_dispatch' && run.conclusion === 'success' && run.path?.split('@')[0] === '.github/workflows/keeper-protected-release-workers.yml', 'UNTRUSTED_ARTIFACT_PRODUCER');
  const operation = request.operation === 'testflight-upload' ? 'ios-signed-build' : 'android-signed-build';
  demand(receipt.schema === 1 && receipt.sourceSha === request.sourceSha && receipt.driverSha === request.sourceSha && receipt.operation === operation && receipt.version === request.version && receipt.build === request.build && receipt.artifactSha256 === request.artifactSha256 && receipt.identitySha256 === request.identitySha256 && receipt.configSha256 === request.configSha256 && String(receipt.runId) === String(run.id) && Number(receipt.runAttempt) === run.run_attempt && receipt.signatureVerified === true && receipt.storeUploaded === false, 'SIGNED_RECEIPT_MISMATCH');
}

function excludeOwnExecutionChecks(request, evidence, run, jobs, current) {
  demand(String(run.id) === current.runId && run.run_attempt === current.runAttempt && run.head_sha === request.driverSha && run.head_repository?.full_name === request.repository && run.event === 'workflow_dispatch' && run.path?.split('@')[0] === '.github/workflows/keeper-protected-release-workers.yml' && Number.isSafeInteger(run.check_suite_id), 'CURRENT_WORKER_PROVENANCE_UNVERIFIED');
  demand(Number.isSafeInteger(jobs.total_count) && jobs.total_count <= 100 && jobs.total_count === jobs.jobs?.length, 'INCOMPLETE_CURRENT_ATTEMPT_JOBS');
  const ownChecks = new Map();
  for (const job of jobs.jobs) {
    demand(job.run_id === run.id && job.run_attempt === current.runAttempt && job.head_sha === request.driverSha && ['plan', 'approved-operation'].includes(job.name), 'UNTRUSTED_CURRENT_ATTEMPT_JOB');
    if (job.check_run_url) {
      const match = job.check_run_url.match(/^https:\/\/api\.github\.com\/repos\/KeeperCommunity\/bitcoin-keeper\/check-runs\/(\d+)$/);
      demand(match, 'UNVERIFIED_OWN_CHECK_REFERENCE');
      ownChecks.set(match[1], job.name);
    }
  }
  const checks = evidence.checks;
  demand(Number.isSafeInteger(checks?.total_count) && checks.total_count <= 100 && checks.total_count === checks.check_runs?.length, 'INCOMPLETE_SOURCE_CHECKS');
  const remaining = checks.check_runs.filter(check => !(check.check_suite?.id === run.check_suite_id && ownChecks.get(String(check.id)) === check.name));
  return { ...evidence, checks: { ...checks, total_count: remaining.length, check_runs: remaining } };
}

async function freshEvidence(request, root, env) {
  demand(/^[1-9]\d{0,18}$/.test(env.GITHUB_RUN_ID || '') && /^[1-9]\d{0,8}$/.test(env.GITHUB_RUN_ATTEMPT || ''), 'CURRENT_RUN_REQUIRED');
  const [evidence, run, jobs] = await Promise.all([
    gate.collectEvidence(request, root, env.GH_TOKEN),
    gate.api(`actions/runs/${env.GITHUB_RUN_ID}`, env.GH_TOKEN),
    gate.api(`actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}/jobs?per_page=100`, env.GH_TOKEN),
  ]);
  return excludeOwnExecutionChecks(request, evidence, run, jobs, { runId: env.GITHUB_RUN_ID, runAttempt: Number(env.GITHUB_RUN_ATTEMPT) });
}

async function main(env = process.env) {
  const stage = process.argv[2];
  demand(['request', 'plan', 'revalidate', 'execute'].includes(stage), 'INVALID_STAGE');
  const request = workerRequest(env);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `source_sha=${request.sourceSha}\noperation=${request.operation}\nplatform=${request.operation.startsWith('ios-') || request.operation === 'testflight-upload' ? 'ios' : 'android'}\n`);
  if (stage === 'request') return;
  const root = path.resolve(env.KEEPER_CANDIDATE_PATH || '');
  demand(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() === request.sourceSha, 'CHECKOUT_SOURCE_MISMATCH');
  demand(env.GH_TOKEN, 'READ_ONLY_API_REQUIRED');
  const evidence = await freshEvidence(request, root, env);
  const plan = gate.validateEvidence(request, evidence);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `environment=${plan.environment}\n`);
  if (stage !== 'execute') { console.log('Exact source, approval and protection revalidated; no release operation performed.'); return; }
  demand(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted', 'HOSTED_PROTECTED_WORKER_REQUIRED');
  const directory = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'keeper-release-private-'));
  fs.chmodSync(directory, 0o700);
  try {
    const context = { ...request, runId: env.GITHUB_RUN_ID, runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
      approvalExpiresAt: evidence.comment.body.match(/\nExpires at: ([^\n]+)$/)[1] };
    const contextFile = path.join(directory, 'context.json');
    fs.writeFileSync(contextFile, JSON.stringify(context), { mode: 0o600 });
    const adapter = path.join(__dirname, 'cloud_release_worker.py');
    if (request.operation.endsWith('-upload')) {
      const artifact = await gate.api(`actions/artifacts/${request.artifactId}`, env.GH_TOKEN);
      const run = await gate.api(`actions/runs/${artifact.workflow_run?.id}`, env.GH_TOKEN);
      demand(!artifact.expired && artifact.workflow_run?.head_sha === request.sourceSha, 'ARTIFACT_UNAVAILABLE');
      const response = await fetch(`https://api.github.com/repos/${request.repository}/actions/artifacts/${request.artifactId}/zip`, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' } });
      demand(response.ok, 'ARTIFACT_DOWNLOAD_UNAVAILABLE');
      const archive = path.join(directory, 'artifact.zip');
      const handle = fs.openSync(archive, 'wx', 0o600);
      let total = 0;
      try { for await (const chunk of response.body) { total += chunk.length; demand(total <= 2 * 1024 ** 3, 'ARTIFACT_TOO_LARGE'); fs.writeSync(handle, chunk); } }
      finally { fs.closeSync(handle); }
      const receiptText = execFileSync('python3', [adapter, 'unpack', contextFile, directory], { env: { PATH: env.PATH }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      validateArtifactRun(request, artifact, run, JSON.parse(receiptText));
      context.sourceRunId = run.id;
      context.sourceRunAttempt = run.run_attempt;
      fs.writeFileSync(contextFile, JSON.stringify(context), { mode: 0o600 });
      // Download/preparation may take time. Recheck immediately before loading
      // the upload adapter; do not reuse a pre-environment/pre-download plan.
      gate.validateEvidence(request, await freshEvidence(request, root, env));
    }
    const executionEnv = { ...env, KEEPER_PRIVATE_DIRECTORY: directory };
    delete executionEnv.GH_TOKEN;
    delete executionEnv.GITHUB_TOKEN;
    execFileSync('python3', [adapter, 'execute', contextFile, root], { env: executionEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `artifact_dir=${path.join(env.RUNNER_TEMP, 'keeper-release-output')}\n`);
    console.log('Approved operation completed; inspect the bounded signed-build or upload-command receipt. No further operation follows automatically.');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

module.exports = { workerRequest, validateArtifactRun, excludeOwnExecutionChecks };
if (require.main === module) main().catch(error => {
  try {
    const failure = JSON.parse(error.stderr?.toString() || '{}');
    if (failure.state === 'FAILED' && ['input-validation', 'identity-validation', 'source-preflight', 'config-validation', 'native-build', 'signing-cleanup', 'artifact-verification', 'upload-command', 'receipt'].includes(failure.stage)) console.error(`Platform stage failed: ${failure.stage}; signing cleanup failed: ${failure.cleanupFailed === true}`);
  } catch { /* Never print raw native/provider errors. */ }
  console.error('Protected release worker blocked/failed; inspect the stage and setup privately. No subsequent operation was executed.');
  process.exitCode = 1;
});
