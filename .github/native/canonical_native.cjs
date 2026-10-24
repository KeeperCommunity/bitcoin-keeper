'use strict';
// Read-only canonical provenance/receipts. Never signs, posts statuses or approves release.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { REQUIRED, acceptance } = require('./release_acceptance.cjs');
const { publicCompanionChecks } = require('./public_companion_receipts.cjs');
const { validatePublicSoftware, WORKER_SOURCES, PUBLIC_SOFTWARE_SCOPE } = require('./public_software_receipts.cjs');
const { parseStrictJson } = require('./strict_json.cjs');
const REPOSITORY = 'KeeperCommunity/bitcoin-keeper';
const REPOSITORY_ID = 470904030;
const WORKFLOW = '.github/workflows/keeper-canonical-native.yml';
const WORKER = '.github/workflows/keeper-canonical-native-platform.yml';
const APP_ID = 15368;
const SHA = /^[a-f0-9]{40}$/;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const demand = (condition, code) => { if (!condition) throw new Error(code); };
const artifactName = (platform, request) => `keeper-canonical-native-${platform}-${request.sourceSha}-${request.runId}-${request.attempt}`;
const attestationName = request => `keeper-canonical-native-attestation-${request.sourceSha}-${request.runId}-${request.attempt}`;

function requestFromEnvironment(context, env) {
  const request = { sourceSha: env.KEEPER_SOURCE_SHA, workflowSha: env.GITHUB_WORKFLOW_SHA,
    workflowRef: env.GITHUB_WORKFLOW_REF, pin: env.KEEPER_CANONICAL_NATIVE_DRIVER_SHA,
    runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT) };
  demand(context.eventName === 'workflow_dispatch' && context.ref === 'refs/heads/sprint' &&
    `${context.repo.owner}/${context.repo.repo}` === REPOSITORY, 'CANONICAL_DISPATCH_REF_REQUIRED');
  demand(SHA.test(request.sourceSha || '') && request.sourceSha === context.sha &&
    request.workflowSha === request.sourceSha && request.pin === request.sourceSha &&
    request.workflowRef === `${REPOSITORY}/${WORKFLOW}@refs/heads/sprint`, 'INSTALLED_DRIVER_PIN_REQUIRED');
  demand(Number.isSafeInteger(request.runId) && request.runId === context.runId && request.runId > 0 &&
    Number.isSafeInteger(request.attempt) && request.attempt > 0, 'EXACT_RUN_ATTEMPT_REQUIRED');
  return request;
}

function githubApp(check) {
  return check?.app?.id === APP_ID && check.app.slug === 'github-actions';
}

function pinReaderFromEnvironment(github, env) {
  const token = env.KEEPER_CANONICAL_PIN_READ_TOKEN;
  // The collector spawns the bounded ZIP reader. Do not pass this credential to
  // that subprocess or to subsequent tooling through the process environment.
  delete env.KEEPER_CANONICAL_PIN_READ_TOKEN;
  demand(typeof token === 'string' && token.trim().length > 0, 'LIVE_DRIVER_PIN_IDENTITY_REQUIRED');
  // Keep the normal GITHUB_TOKEN client for Actions/checks/contents. This
  // repository-selected Variables:read identity is used only for the live pin.
  return new github.constructor({ auth: token });
}

async function origin(github, context, request, { admission = false, pinReader } = {}) {
  demand(typeof pinReader?.rest?.actions?.getRepoVariable === 'function', 'LIVE_DRIVER_PIN_IDENTITY_REQUIRED');
  const args = context.repo;
  const [repository, branch, workflow, run, pin] = await Promise.all([
    github.rest.repos.get(args).then(r => r.data),
    github.rest.repos.getBranch({ ...args, branch: 'sprint' }).then(r => r.data),
    github.rest.actions.getWorkflow({ ...args, workflow_id: path.basename(WORKFLOW) }).then(r => r.data),
    github.rest.actions.getWorkflowRun({ ...args, run_id: request.runId }).then(r => r.data),
    pinReader.rest.actions.getRepoVariable({ ...args, name: 'KEEPER_CANONICAL_NATIVE_DRIVER_SHA',
      headers: { 'cache-control': 'no-cache' } }).then(r => r.data)
      .catch(() => { throw new Error('LIVE_DRIVER_PIN_REVOKED_OR_UNREADABLE'); }),
  ]);
  demand(pin?.name === 'KEEPER_CANONICAL_NATIVE_DRIVER_SHA' && pin.value === request.sourceSha && pin.value === request.pin,
    'LIVE_DRIVER_PIN_REVOKED_OR_UNREADABLE');
  demand(repository.id === REPOSITORY_ID && repository.full_name === REPOSITORY && repository.default_branch === 'sprint', 'REPOSITORY_MISMATCH');
  demand(branch.protected === true && branch.commit?.sha === request.sourceSha, 'CANONICAL_HEAD_MOVED_OR_UNPROTECTED');
  demand(workflow.path === WORKFLOW && workflow.state === 'active', 'CANONICAL_WORKFLOW_NOT_INSTALLED');
  demand(run.id === request.runId && run.run_attempt === request.attempt && run.workflow_id === workflow.id &&
    run.event === 'workflow_dispatch' && run.path?.split('@')[0] === WORKFLOW &&
    run.head_sha === request.sourceSha && run.head_branch === 'sprint' &&
    run.head_repository?.id === REPOSITORY_ID && run.head_repository.full_name === REPOSITORY &&
    Array.isArray(run.pull_requests) && run.pull_requests.length === 0 &&
    (run.status === 'in_progress' || (run.status === 'completed' && run.conclusion === 'success')),
  'CANONICAL_RUN_MISMATCH');
  const suite = (await github.rest.checks.getSuite({ ...args, check_suite_id: run.check_suite_id })).data;
  demand(githubApp(suite) && suite.head_sha === request.sourceSha && suite.id === run.check_suite_id, 'FORGED_ACTIONS_APP');
  const listing = (await github.rest.actions.listWorkflowRuns({ ...args, workflow_id: workflow.id,
    branch: 'sprint', event: 'workflow_dispatch', head_sha: request.sourceSha, per_page: 100 })).data;
  demand(Number.isSafeInteger(listing.total_count) && listing.total_count <= 100 &&
    listing.total_count === listing.workflow_runs?.length &&
    listing.workflow_runs.every(item => item.head_sha === request.sourceSha) &&
    Math.max(...listing.workflow_runs.map(item => item.id)) === request.runId,
  'NEWER_OR_INCOMPLETE_CANONICAL_RUNS');
  if (admission) {
    const active = await Promise.all(['in_progress', 'queued', 'waiting', 'pending', 'requested'].map(async status =>
      (await github.rest.actions.listWorkflowRunsForRepo({ ...args, status, per_page: 100 })).data));
    const nativePaths = [WORKFLOW, '.github/workflows/keeper-hosted-native.yml',
      '.github/workflows/keeper-native-diagnostic.yml', '.github/workflows/keeper-release-acceptance.yml',
      '.github/workflows/keeper-one-time-native.yml', '.github/workflows/keeper-one-time-native-diagnostic.yml',
      '.github/workflows/android-diagnostic-build.yml', '.github/workflows/keeper-protected-release-workers.yml'];
    for (const page of active) {
      demand(page.total_count <= 100 && page.total_count === page.workflow_runs?.length, 'CAPACITY_OBSERVATION_INCOMPLETE');
      demand(!page.workflow_runs.some(item => item.id !== request.runId && nativePaths.includes(item.path?.split('@')[0])),
        'ANOTHER_NATIVE_RUN_ACTIVE_OR_QUEUED');
    }
  }
  return { run, workflow };
}

function requiredSteps(platform) {
  return ['Verify canonical installed source', 'Record runner and toolchain', 'Install immutable native dependencies',
    'Build development app', ...(platform === 'IOS' ? ['Check disposable iOS driver readiness',
      'Run disposable startup smoke', 'Run disposable native persistence probe',
      'Run R5 production worker native scenarios', 'Measure full-product startup wallet and Retry flows']
      : ['Run Android startup persistence worker and product flows'])];
}

async function platformJobs(github, context, request, run) {
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt,
    { ...context.repo, run_id: request.runId, attempt_number: request.attempt, per_page: 100 });
  const result = {};
  for (const platform of ['IOS', 'ANDROID']) {
    const matches = jobs.filter(job => job.name === `${platform.toLowerCase()} / Canonical ${platform} build and features`);
    demand(matches.length === 1, 'CANONICAL_PLATFORM_JOB_MISSING_OR_AMBIGUOUS');
    const job = matches[0];
    demand(job.run_id === request.runId && job.run_attempt === request.attempt && job.head_sha === request.sourceSha &&
      job.status === 'completed' && job.conclusion === 'success', 'CANONICAL_PLATFORM_NOT_EXACT_SUCCESS');
    for (const name of requiredSteps(platform)) {
      const steps = job.steps?.filter(step => step.name === name) ?? [];
      demand(steps.length === 1 && steps[0].status === 'completed' && steps[0].conclusion === 'success', 'CANONICAL_REQUIRED_STEP_NOT_SUCCESS');
    }
    const match = job.check_run_url?.match(/^https:\/\/api\.github\.com\/repos\/KeeperCommunity\/bitcoin-keeper\/check-runs\/([0-9]+)$/);
    demand(match, 'CANONICAL_JOB_CHECK_LINK_INVALID');
    const check = (await github.rest.checks.get({ ...context.repo, check_run_id: Number(match[1]) })).data;
    demand(check.id === Number(match[1]) && check.name === job.name && githubApp(check) &&
      check.head_sha === request.sourceSha && check.check_suite?.id === run.check_suite_id &&
      check.status === 'completed' && check.conclusion === 'success', 'CANONICAL_JOB_CHECK_UNTRUSTED');
    result[platform] = job;
  }
  return result;
}

function validateMetadata(metadata, request, platform, workerSources) {
  const apps = { IOS: 'io.hexawallet.hexakeeper.dev', ANDROID: 'io.hexawallet.keeper.development' };
  demand(metadata.schema === 1 && metadata.platform === platform && metadata.source_sha === request.sourceSha &&
    metadata.workflow_sha === request.workflowSha && metadata.workflow_ref === request.workflowRef &&
    metadata.run_id === String(request.runId) && metadata.run_attempt === String(request.attempt) &&
    metadata.app_id === apps[platform] && metadata.diagnostic_only === false, 'CANONICAL_RECEIPT_IDENTITY_MISMATCH');
  const status = value => value === 'PASS' ? 'PASS' : 'NOT VERIFIED';
  const checks = {
    'native-build': { status: status(metadata.build), scope: 'development native build' },
    'startup': { status: status(metadata.smoke), scope: 'ordinary app passcode startup smoke' },
    'native-storage': { status: status(metadata.native_probe), scope: 'CI entrypoint native Realm/MMKV process persistence' },
    'production-worker-controls': { status: status(metadata.r5_features), scope: 'CI-extracted production workers; synthetic boundaries are not complete application UI' },
    'five-product-observations': { status: 'NOT VERIFIED', scope: 'ordinary app debug UI observations; no release performance budget' },
    'controlled-setup-disconnect-retry': { status: 'NOT VERIFIED', scope: 'ordinary app loopback disconnect before commit; not physical WAN offline' },
    'installed-version-history': { status: 'NOT VERIFIED', scope: 'native installed tuple and retained initial history; not stale-history recovery' },
    'key-management-discoverability': { status: 'NOT VERIFIED', scope: 'ordinary app Keys Manage Keys entry and return' },
    'unused-key-and-pin-ui': { status: 'NOT VERIFIED', scope: 'unused Mobile Key delete cancel wrong PIN and cold persistence; not live-Vault references or physical biometrics' },
  };
  const samples = metadata.product_ui?.samples;
  if (metadata.product_ui?.status === 'PASS' && metadata.product_ui.requested_samples === 5 &&
    Array.isArray(samples) && samples.length === 5 && samples.every((sample, index) =>
      sample.sample === index + 1 && sample.status === 'PASS' && sample.create_new_app_calls === 1 &&
      sample.visible_wallet_count_before_relaunch === 1 && sample.visible_wallet_count_after_relaunch === 1 &&
      ['startup_to_passcode_ms', 'start_new_to_ready_ms'].every(key =>
        Number.isFinite(sample.raw_durations?.[key]) && sample.raw_durations[key] >= 0))) {
    checks['five-product-observations'].status = 'PASS';
    if (samples.every(sample => sample.installed_version_header_and_initial_history === 'PASS'))
      checks['installed-version-history'].status = 'PASS';
    if (samples.every(sample => sample.key_management_entry_and_exit === 'PASS'))
      checks['key-management-discoverability'].status = 'PASS';
  }
  const retry = metadata.product_ui?.controlled_disconnect_retry;
  if (retry?.status === 'PASS' && retry.scenario === 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE' &&
    retry.performance_sample === false && retry.create_new_app_calls === 2 &&
    retry.transport_requests_dropped_without_commit === 1 && retry.acknowledged_create_responses === 1 &&
    retry.unexpected_create_attempts === 0 && retry.visible_wallet_count_after_relaunch === 1)
    checks['controlled-setup-disconnect-retry'].status = 'PASS';
  const key = metadata.product_ui?.key_management_ui;
  if (key?.status === 'PASS' && key.entrypoint === 'index.js' && key.network === 'TESTNET' &&
    key.scenario === 'UNUSED_MOBILE_KEY_UI_DELETE_AND_NATIVE_PIN' && key.new_account_requests_during_key_flow === 0 &&
    key.visible_eligible_keys_after_deletion === 0 && key.unrelated_visible_wallet_count_after_relaunch === 1)
    checks['unused-key-and-pin-ui'].status = 'PASS';
  const parent = acceptance({ trusted: checks['native-build'].status === 'PASS' && checks.startup.status === 'PASS' &&
    checks['native-storage'].status === 'PASS', ios: 'success', android: 'success' });
  const cases = REQUIRED.map(id => ({ id, status: parent.cases.find(item => item.id === id)?.status ?? 'NOT IMPLEMENTED' }));
  Object.assign(checks, publicCompanionChecks(metadata, platform));
  checks['public-raw-software-evidence'] = { status: 'NOT VERIFIED', scope: PUBLIC_SOFTWARE_SCOPE };
  try {
    validatePublicSoftware(metadata, { platform, sourceSha: request.sourceSha,
      workflowSha: request.workflowSha, workflowRef: request.workflowRef,
      runId: request.runId, runAttempt: request.attempt, workerSources });
    checks['public-raw-software-evidence'].status = 'PASS';
  } catch { /* A label or payload-owned source hash cannot satisfy this subcheck. */ }
  // Parent obligations remain explicit. Scoped companion UI does not establish
  // private bytes, protocol/account isolation, WAN offline, recovery or a budget.
  return { cases, executed_checks: checks };
}

async function collect(github, context, request, output, readZip, { pinReader } = {}) {
  fs.rmSync(path.join(output, 'keeper-canonical-native-attestation.json'), { force: true });
  const { run } = await origin(github, context, request, { pinReader });
  await platformJobs(github, context, request, run);
  // Compare full-file worker hashes with fixed committed inputs, independently
  // of the downloaded receipt. No artifact ingestion or private-route admission.
  const workerSources = await Promise.all(Object.entries(WORKER_SOURCES).map(async ([member, names]) => {
    const file = (await github.rest.repos.getContent({ ...context.repo, path: member, ref: request.sourceSha })).data;
    demand(file?.type === 'file' && file.path === member && file.encoding === 'base64' &&
      Number.isSafeInteger(file.size) && file.size > 0 && file.size <= 524288 &&
      typeof file.content === 'string' && /^[A-Za-z0-9+/=\r\n]+$/.test(file.content), 'CANONICAL_WORKER_SOURCE_UNAVAILABLE');
    const bytes = Buffer.from(file.content, 'base64');
    demand(bytes.length === file.size, 'CANONICAL_WORKER_SOURCE_UNAVAILABLE');
    return { path: member, names: [...names], sha256: digest(bytes) };
  }));
  const page = (await github.rest.actions.listWorkflowRunArtifacts({ ...context.repo, run_id: request.runId, per_page: 100 })).data;
  demand(page.total_count <= 100 && page.total_count === page.artifacts?.length, 'CANONICAL_ARTIFACT_LIST_INCOMPLETE');
  const platforms = {};
  for (const platform of ['IOS', 'ANDROID']) {
    const matches = page.artifacts.filter(item => item.name === artifactName(platform, request));
    demand(matches.length === 1, 'CANONICAL_ARTIFACT_MISSING_OR_AMBIGUOUS');
    const artifact = matches[0];
    demand(!artifact.expired && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 1048576 &&
      artifact.workflow_run?.id === request.runId && artifact.workflow_run.head_sha === request.sourceSha &&
      /^sha256:[a-f0-9]{64}$/.test(artifact.digest || ''), 'CANONICAL_ARTIFACT_IDENTITY_INVALID');
    const archive = Buffer.from((await github.rest.actions.downloadArtifact({ ...context.repo,
      artifact_id: artifact.id, archive_format: 'zip' })).data);
    demand(archive.length <= 1048576 && archive.length === artifact.size_in_bytes &&
      `sha256:${digest(archive)}` === artifact.digest, 'CANONICAL_ARTIFACT_DIGEST_INVALID');
    const current = (await github.rest.actions.getArtifact({ ...context.repo, artifact_id: artifact.id })).data;
    demand(current.id === artifact.id && current.name === artifact.name && !current.expired &&
      current.digest === artifact.digest && current.size_in_bytes === artifact.size_in_bytes &&
      current.workflow_run?.id === request.runId && current.workflow_run.head_sha === request.sourceSha,
    'CANONICAL_ARTIFACT_EXPIRED_OR_CHANGED');
    const raw = readZip(archive);
    const metadata = parseStrictJson(raw);
    platforms[platform] = { conclusion: 'success', artifact_id: artifact.id,
      receipt_sha256: digest(raw), ...validateMetadata(metadata, request, platform, workerSources) };
  }
  // Recheck after every download; moved heads, new runs or rerun attempts invalidate this collector.
  await origin(github, context, request, { pinReader });
  const commit = (await github.rest.git.getCommit({ ...context.repo, commit_sha: request.sourceSha })).data;
  demand(commit.sha === request.sourceSha && SHA.test(commit.tree?.sha || ''), 'CANONICAL_SOURCE_TREE_UNVERIFIED');
  const complete = Object.values(platforms).every(item => item.cases.length === REQUIRED.length &&
    item.cases.every(test => test.status === 'PASS') && Object.values(item.executed_checks).every(test => test.status === 'PASS'));
  const result = { schema: 1, kind: 'keeper-canonical-native', repository: REPOSITORY,
    source_sha: request.sourceSha, source_tree: commit.tree.sha, workflow_sha: request.workflowSha,
    workflow_path: WORKFLOW, run_id: request.runId, run_attempt: request.attempt,
    selected_route: 'canonical-hosted-native', platforms, feature_matrix_complete: complete };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, complete ? 'keeper-canonical-native-attestation.json' :
    'keeper-canonical-native-readiness.json'), JSON.stringify(result, null, 2) + '\n');
  demand(complete, 'CANONICAL_REQUIRED_APP_MATRIX_INCOMPLETE');
  return result;
}

function readMetadataZip(archive) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-canonical-receipt-'));
  try {
    const file = path.join(directory, 'receipt.zip'); fs.writeFileSync(file, archive, { mode: 0o600 });
    return execFileSync('python3', [path.join(__dirname, 'canonical_metadata.py'), file], { maxBuffer: 524288 });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { REPOSITORY, REPOSITORY_ID, WORKFLOW, WORKER, APP_ID, requestFromEnvironment,
  pinReaderFromEnvironment, origin, requiredSteps, platformJobs, validateMetadata, collect,
  artifactName, attestationName, readMetadataZip };
