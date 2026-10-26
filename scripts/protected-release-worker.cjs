#!/usr/bin/env node
'use strict';
// Installed trusted driver only. The separate Python adapter has no API authority.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const gate = require('./protected-release-plan.cjs');
const live = require('./live-store-request.cjs');
const profiles = require('../.github/native/release_repository_profiles.cjs');
const hex = /^[a-f0-9]{64}$/;
function demand(value, code) { if (!value) throw new Error(code); }

function workerRequest(env) {
  if (env.KEEPER_RELEASE_REQUEST_JSON) {
    const input = require('../.github/native/strict_json.cjs').parseStrictJson(
      Buffer.from(env.KEEPER_RELEASE_REQUEST_JSON), 16384);
    const fields = { source_sha: 'KEEPER_SOURCE_SHA', release_ref: 'KEEPER_RELEASE_REF', operation: 'KEEPER_OPERATION', version: 'KEEPER_VERSION', build: 'KEEPER_BUILD', artifact_sha256: 'KEEPER_ARTIFACT_SHA256', approval_comment_id: 'KEEPER_APPROVAL_COMMENT_ID', certificate_sha256: 'KEEPER_CERT_SHA256', config_sha256: 'KEEPER_CONFIG_SHA256', artifact_id: 'KEEPER_ARTIFACT_ID' };
    if (live.operations.has(input?.operation)) fields.live_parameters = 'KEEPER_LIVE_PARAMETERS';
    if (input && typeof input === 'object' && !Array.isArray(input) && !Object.hasOwn(input, 'approval_comment_id')) input.approval_comment_id = 'none';
    demand(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === Object.keys(fields).length && Object.keys(input).every(key => Object.hasOwn(fields, key) && typeof input[key] === 'string'), 'INVALID_REQUEST_JSON');
    env = { ...env, ...Object.fromEntries(Object.entries(fields).map(([key, name]) => [name, input[key]])) };
  }
  const request = gate.requestFromEnvironment(env);
  request.identitySha256 = env.KEEPER_CERT_SHA256;
  request.configSha256 = env.KEEPER_CONFIG_SHA256;
  request.artifactId = env.KEEPER_ARTIFACT_ID;
  demand(hex.test(request.identitySha256 || '') && hex.test(request.configSha256 || ''), 'EXPECTED_IDENTITIES_REQUIRED');
  const upload = !request.operation.endsWith('-signed-build');
  demand(upload ? /^[1-9]\d{0,18}$/.test(request.artifactId || '') : request.artifactId === 'none', 'INVALID_ARTIFACT_REFERENCE');
  // A signed build executes native project/dependency code with signing material.
  // Limit that code to the currently installed, protected canonical source.
  demand(upload || request.sourceSha === request.driverSha, 'SIGNING_REQUIRES_INSTALLED_CANONICAL_SOURCE');
  return request;
}

function validateArtifactRun(request, artifact, run, receipt) {
  const profile = profiles.forRepository(request.repository);
  demand(!profile.private || (receipt.repository === profile.repository && receipt.repositoryId === profile.repositoryId && receipt.repositoryPrivate === true), 'SIGNED_RECEIPT_REPOSITORY');
  demand(!profile.private || (profiles.matches(run.repository, profile) && profiles.matches(run.head_repository, profile)), 'UNTRUSTED_ARTIFACT_REPOSITORY');
  demand(!artifact.expired && artifact.workflow_run?.head_sha === request.sourceSha, 'ARTIFACT_SOURCE_MISMATCH');
  demand(run.head_sha === request.sourceSha && run.head_repository?.full_name === request.repository && run.event === 'workflow_dispatch' && run.conclusion === 'success' && run.path?.split('@')[0] === '.github/workflows/keeper-protected-release-workers.yml', 'UNTRUSTED_ARTIFACT_PRODUCER');
  const operation = request.operation === 'testflight-upload' ? 'ios-signed-build' : 'android-signed-build';
  demand(receipt.schema === 1 && receipt.sourceSha === request.sourceSha && receipt.driverSha === request.sourceSha && receipt.operation === operation && receipt.version === request.version && receipt.build === request.build && receipt.artifactSha256 === request.artifactSha256 && receipt.identitySha256 === request.identitySha256 && receipt.configSha256 === request.configSha256 && String(receipt.runId) === String(run.id) && Number(receipt.runAttempt) === run.run_attempt && receipt.signatureVerified === true && receipt.storeUploaded === false, 'SIGNED_RECEIPT_MISMATCH');
}

function excludeOwnExecutionChecks(request, evidence, run, jobs, current) {
  const profile = profiles.forRepository(request.repository);
  demand(!profile.private || (profiles.matches(run.repository, profile) && profiles.matches(run.head_repository, profile)), 'CURRENT_WORKER_REPOSITORY_UNVERIFIED');
  demand(String(run.id) === current.runId && run.run_attempt === current.runAttempt && run.head_sha === request.driverSha && run.head_repository?.full_name === request.repository && run.event === 'workflow_dispatch' && run.path?.split('@')[0] === '.github/workflows/keeper-protected-release-workers.yml' && Number.isSafeInteger(run.check_suite_id), 'CURRENT_WORKER_PROVENANCE_UNVERIFIED');
  demand(Number.isSafeInteger(jobs.total_count) && jobs.total_count <= 100 && jobs.total_count === jobs.jobs?.length, 'INCOMPLETE_CURRENT_ATTEMPT_JOBS');
  const ownChecks = new Map();
  for (const job of jobs.jobs) {
    demand(job.run_id === run.id && job.run_attempt === current.runAttempt && job.head_sha === request.driverSha && ['plan', 'approved-operation'].includes(job.name), 'UNTRUSTED_CURRENT_ATTEMPT_JOB');
    if (job.check_run_url) {
      const checkId = profiles.checkId(job.check_run_url, profile);
      demand(checkId, 'UNVERIFIED_OWN_CHECK_REFERENCE');
      ownChecks.set(String(checkId), job.name);
    }
  }
  const checks = evidence.checks;
  demand(Number.isSafeInteger(checks?.total_count) && checks.total_count <= 100 && checks.total_count === checks.check_runs?.length, 'INCOMPLETE_SOURCE_CHECKS');
  const remaining = checks.check_runs.filter(check => !(check.check_suite?.id === run.check_suite_id && ownChecks.get(String(check.id)) === check.name));
  return { ...evidence, checks: { ...checks, total_count: remaining.length, check_runs: remaining } };
}

// Explicit child boundary: neither Actions/runtime credentials nor unrelated
// step secrets are inherited by source readers or native/provider tools.
const BUILD_ENVIRONMENT = Object.freeze([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL',
  // Preserve configured network routing and CA trust without changing either.
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE',
  'RUNNER_TEMP', 'RUNNER_ENVIRONMENT', 'GITHUB_ACTIONS', 'GITHUB_WORKSPACE',
  'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_REPOSITORY',
  'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'ANDROID_NDK_HOME', 'ANDROID_NDK_ROOT', 'JAVA_HOME',
  'DEVELOPER_DIR', 'SDKROOT', 'BUNDLE_GEMFILE', 'BUNDLE_PATH', 'BUNDLE_DEPLOYMENT', 'BUNDLE_FROZEN',
  'GEM_HOME', 'GEM_PATH', 'RUBY_ROOT', 'RUBY_ENGINE', 'FASTLANE_SKIP_UPDATE_CHECK',
  'FASTLANE_OPT_OUT_USAGE', 'BUNDLETOOL_JAR', 'KEEPER_PACKAGE_OVERLAY_PATH',
  'KEEPER_EXPECTED_CERT_SHA256', 'KEEPER_EXPECTED_CONFIG_SHA256', 'KEEPER_IOS_TEAM_ID',
  'KEEPER_IOS_PROFILE_UUID',
]);
const OPERATION_SECRETS = Object.freeze({
  'ios-signed-build': ['KEEPER_PRODUCTION_CONFIG_BASE64', 'KEEPER_IOS_P12_BASE64',
    'KEEPER_IOS_P12_PASSWORD', 'KEEPER_IOS_PROFILE_BASE64'],
  'android-signed-build': ['KEEPER_PRODUCTION_CONFIG_BASE64', 'KEEPER_ANDROID_KEYSTORE_BASE64',
    'STORE_PASSWORD', 'KEY_PASSWORD', 'KEY_ALIAS'],
  'testflight-upload': ['KEEPER_ASC_KEY_ID', 'KEEPER_ASC_ISSUER_ID', 'KEEPER_ASC_KEY_BASE64'],
  'play-internal-upload': ['KEEPER_PLAY_SERVICE_ACCOUNT'],
  'ios-submit-review': ['KEEPER_ASC_KEY_ID', 'KEEPER_ASC_ISSUER_ID', 'KEEPER_ASC_KEY_BASE64'],
  'ios-release-approved-version': ['KEEPER_ASC_KEY_ID', 'KEEPER_ASC_ISSUER_ID', 'KEEPER_ASC_KEY_BASE64'],
  'play-production-rollout': ['KEEPER_PLAY_SERVICE_ACCOUNT'],
});
function withoutReadCredentials(env) {
  return Object.fromEntries(BUILD_ENVIRONMENT.filter(name => typeof env[name] === 'string')
    .map(name => [name, env[name]]));
}
function childEnvironment(env, operation) {
  demand(operation === undefined || Object.hasOwn(OPERATION_SECRETS, operation), 'INVALID_CHILD_OPERATION');
  const clean = withoutReadCredentials(env);
  for (const name of OPERATION_SECRETS[operation] || []) if (typeof env[name] === 'string') clean[name] = env[name];
  return clean;
}

async function downloadSignedArtifact(github, artifact, destination, { fetchImpl = fetch, repository = profiles.PUBLIC.repository } = {}) {
  const crypto = require('node:crypto');
  const limit = 2 * 1024 ** 3;
  demand(Number.isSafeInteger(artifact?.id) && artifact.id > 0 &&
    Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 &&
    artifact.size_in_bytes <= limit && /^sha256:[a-f0-9]{64}$/.test(artifact.digest || ''),
  'SIGNED_ARCHIVE_IDENTITY_INVALID');
  const profile = profiles.forRepository(repository);
  const url = 'https://api.github.com/repos/' + profile.repository + '/actions/artifacts/' + artifact.id + '/zip';
  let intercepted = false, location;
  const result = await github.request('GET ' + url, { request: {
    retries: 0, parseSuccessResponseBody: false, fetch: async (actual, init) => {
      demand(!intercepted && actual === url && init?.method === 'GET' && init.body == null, 'SIGNED_ARCHIVE_REQUEST_INVALID');
      intercepted = true;
      const response = await fetchImpl(actual, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) });
      try {
        demand(response.status === 302, 'SIGNED_ARCHIVE_REDIRECT_REQUIRED');
        location = new URL(response.headers.get('location'));
        return response;
      } finally { if (response.body) await response.body.cancel(); }
    },
  } });
  demand(intercepted && result.status === 302 && location.protocol === 'https:' &&
    !location.username && !location.password && !location.hash && (!location.port || location.port === '443') &&
    (location.hostname.endsWith('.blob.core.windows.net') || location.hostname.endsWith('.actions.githubusercontent.com')),
  'SIGNED_ARCHIVE_HOST_INVALID');
  let response, reader, handle;
  const hash = crypto.createHash('sha256');
  let total = 0;
  try {
    response = await fetchImpl(location, { redirect: 'error', signal: AbortSignal.timeout(120000) });
    demand(response?.ok === true && response.body?.getReader, 'SIGNED_ARCHIVE_READ_FAILED');
    const length = response.headers.get('content-length');
    demand(length === null || (/^\d+$/.test(length) && Number(length) === artifact.size_in_bytes),
      'SIGNED_ARCHIVE_SIZE_MISMATCH');
    handle = fs.openSync(destination, fs.constants.O_CREAT | fs.constants.O_EXCL |
      fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    reader = response.body.getReader();
    for (;;) {
      const row = await reader.read();
      if (row.done) break;
      demand(row.value instanceof Uint8Array, 'SIGNED_ARCHIVE_READ_FAILED');
      total += row.value.length;
      demand(total <= artifact.size_in_bytes && total <= limit, 'SIGNED_ARCHIVE_TOO_LARGE');
      const chunk = Buffer.from(row.value); hash.update(chunk);
      for (let offset = 0; offset < chunk.length;) {
        const written = fs.writeSync(handle, chunk, offset, chunk.length - offset);
        demand(written > 0, 'SIGNED_ARCHIVE_WRITE_FAILED'); offset += written;
      }
    }
    demand(total === artifact.size_in_bytes && 'sha256:' + hash.digest('hex') === artifact.digest,
      'SIGNED_ARCHIVE_DIGEST_MISMATCH');
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    try { await (reader ? reader.cancel() : response?.body?.cancel()); } catch { /* no payload or signed URL output */ }
  }
}

async function run(stage, { github, context, env = process.env, pinReader, privateGithub, fetchImpl } = {}) {
  demand(['plan', 'revalidate', 'execute'].includes(stage), 'INVALID_SDK_STAGE');
  const request = workerRequest(env);
  // This initial bridge deliberately supports only the current installed S for
  // both signing and upload. Historical-source trust is not inferred.
  demand(request.sourceSha === request.driverSha && request.driverSha === context?.sha,
    'SDK_OPERATION_REQUIRES_CURRENT_INSTALLED_SOURCE');
  const clean = withoutReadCredentials(env), root = path.resolve(env.KEEPER_CANDIDATE_PATH || '');
  demand(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    env: { PATH: clean.PATH, HOME: clean.HOME }, encoding: 'utf8' }).trim() === request.sourceSha,
  'CHECKOUT_SOURCE_MISMATCH');
  demand(/^[1-9]\d{0,8}$/.test(env.GITHUB_RUN_ATTEMPT || ''), 'CURRENT_ATTEMPT_REQUIRED');
  const options = { pinReader, privateGithub, fetchImpl, stage, workerAttempt: Number(env.GITHUB_RUN_ATTEMPT) };
  const fresh = () => gate.collectEvidenceWithSDK(request, root, github, context, options);
  let evidence = await fresh();
  let plan = gate.validateEvidence(request, evidence);
  if (live.operations.has(request.operation)) require('./protected-live-runtime.cjs').requireBudget(plan);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, 'environment=' + plan.environment + '\n');
  if (stage !== 'execute') return { state: 'SOURCE_AND_APPROVAL_REVALIDATED', execution_allowed: false };
  demand(env.GITHUB_ACTIONS === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    context.job === 'approved-operation', 'HOSTED_PROTECTED_WORKER_REQUIRED');
  const directory = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'keeper-release-private-'));
  fs.chmodSync(directory, 0o700);
  try {
    const operationContext = { ...request, runId: String(context.runId), runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
      // Legacy adapter/receipt field name; the bounded deadline now comes from
      // authenticated run authority, optionally shortened by a human receipt.
      approvalExpiresAt: plan.authorizationExpiresAt };
    const contextFile = path.join(directory, 'context.json'), adapter = path.join(__dirname, 'cloud_release_worker.py');
    fs.writeFileSync(contextFile, JSON.stringify(operationContext), { mode: 0o600 });
    if (live.operations.has(request.operation)) {
      const result = await require('./protected-live-runtime.cjs').execute({ request, root, directory, github, context, env,
        fresh: async () => gate.validateEvidence(request, await fresh()), fetchImpl,
        childEnv: childEnvironment(env, request.operation), downloadSignedArtifact, validateArtifactRun });
      if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, 'artifact_dir=' + path.join(env.RUNNER_TEMP, 'keeper-release-output') + '\n');
      return result;
    }
    if (request.operation.endsWith('-upload')) {
      const api = require('./current-release-origin.cjs').sdk(github, fetchImpl, request.repository);
      const { value: artifact } = await api.json('actions/artifacts/' + request.artifactId);
      demand(artifact.id === Number(request.artifactId) && artifact.expired === false &&
        artifact.workflow_run?.head_sha === request.sourceSha && Number.isSafeInteger(artifact.workflow_run?.id),
      'ARTIFACT_UNAVAILABLE');
      const { value: sourceRun } = await api.json('actions/runs/' + artifact.workflow_run.id);
      const { value: sourceWorkflow } = await api.json('actions/workflows/keeper-protected-release-workers.yml');
      const profile = profiles.forRepository(request.repository);
      demand(sourceRun.status === 'completed' && sourceRun.repository?.id === profile.repositoryId &&
        sourceRun.head_repository?.id === profile.repositoryId &&
        (!profile.private || (profiles.matches(sourceRun.repository, profile) && profiles.matches(sourceRun.head_repository, profile))) && sourceRun.head_branch === 'sprint' &&
        Number.isSafeInteger(sourceWorkflow.id) && sourceWorkflow.state === 'active' &&
        sourceWorkflow.path === '.github/workflows/keeper-protected-release-workers.yml' &&
        sourceRun.workflow_id === sourceWorkflow.id,
        'SIGNED_PRODUCER_NOT_COMPLETED');
      const archive = path.join(directory, 'artifact.zip');
      await downloadSignedArtifact(github, artifact, archive, { fetchImpl, repository: request.repository });
      const receipt = execFileSync('python3', [adapter, 'unpack', contextFile, directory], {
        env: { PATH: clean.PATH }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      validateArtifactRun(request, artifact, sourceRun, JSON.parse(receipt));
      operationContext.sourceRunId = sourceRun.id; operationContext.sourceRunAttempt = sourceRun.run_attempt;
      fs.writeFileSync(contextFile, JSON.stringify(operationContext), { mode: 0o600 });
      const { value: after } = await api.json('actions/artifacts/' + request.artifactId);
      demand(after.id === artifact.id && after.digest === artifact.digest &&
        after.size_in_bytes === artifact.size_in_bytes && after.expired === false &&
        after.workflow_run?.id === sourceRun.id && after.workflow_run.head_sha === request.sourceSha,
      'SIGNED_ARTIFACT_CHANGED');
      // Artifact transport may be lengthy. Never reuse the earlier owner,
      // security, source, profile, or native evidence for the operation.
      evidence = await fresh(); plan = gate.validateEvidence(request, evidence);
      const { value: currentRun } = await api.json('actions/runs/' + sourceRun.id);
      const { value: currentWorkflow } = await api.json('actions/workflows/keeper-protected-release-workers.yml');
      demand(require('node:util').isDeepStrictEqual(currentRun, sourceRun) &&
        require('node:util').isDeepStrictEqual(currentWorkflow, sourceWorkflow), 'SIGNED_PRODUCER_CHANGED');
      operationContext.approvalExpiresAt = plan.authorizationExpiresAt;
      fs.writeFileSync(contextFile, JSON.stringify(operationContext), { mode: 0o600 });
    }
    const executionEnv = { ...childEnvironment(env, request.operation), KEEPER_PRIVATE_DIRECTORY: directory };
    execFileSync('python3', [adapter, 'execute', contextFile, root], {
      env: executionEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT,
      'artifact_dir=' + path.join(env.RUNNER_TEMP, 'keeper-release-output') + '\n');
    return { state: 'APPROVED_OPERATION_COMPLETED', further_operation_authorized: false };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function main(env = process.env) {
  const stage = process.argv[2];
  demand(['request', 'plan', 'revalidate', 'execute'].includes(stage), 'INVALID_STAGE');
  const request = workerRequest(env);
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `source_sha=${request.sourceSha}\noperation=${request.operation}\nplatform=${request.operation.startsWith('ios-') || request.operation === 'testflight-upload' ? 'ios' : 'android'}\n`);
  if (stage === 'request') return;
  // JSON/CLI preparation never carries the private same-process proof.
  // All three authoritative stages must use the pinned SDK entry point.
  throw new Error('SAME_PROCESS_SDK_REQUIRED');
}

module.exports = { workerRequest, validateArtifactRun, excludeOwnExecutionChecks,
  withoutReadCredentials, childEnvironment, downloadSignedArtifact, run };
if (require.main === module) main().catch(error => {
  try {
    const failure = JSON.parse(error.stderr?.toString() || '{}');
    if (failure.state === 'FAILED' && ['input-validation', 'identity-validation', 'source-preflight', 'config-validation', 'native-build', 'signing-cleanup', 'artifact-verification', 'upload-command', 'receipt'].includes(failure.stage)) console.error(`Platform stage failed: ${failure.stage}; signing cleanup failed: ${failure.cleanupFailed === true}`);
  } catch { /* Never print raw native/provider errors. */ }
  console.error('Protected release worker blocked/failed; inspect the stage and setup privately. No subsequent operation was executed.');
  process.exitCode = 1;
});
