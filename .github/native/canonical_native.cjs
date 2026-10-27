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
const repositories = require('./release_repository_profiles.cjs');
const relayReaderApp = require('./relay_reader_app.cjs');
const { SCOPES: NATIVE_PHASE_SCOPES } = require('./native_phase_receipts.cjs');
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
const publicProofs = new WeakSet();
const publicAuthorities = new WeakMap();
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

function requestFromEnvironment(context, env) {
  const profile = repositories.forContext(context);
  const request = { sourceSha: env.KEEPER_SOURCE_SHA, workflowSha: env.GITHUB_WORKFLOW_SHA,
    workflowRef: env.GITHUB_WORKFLOW_REF, pin: env.KEEPER_CANONICAL_NATIVE_DRIVER_SHA,
    runId: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT) };
  demand(context.eventName === 'workflow_dispatch' && context.ref === 'refs/heads/sprint' &&
    `${context.repo.owner}/${context.repo.repo}` === profile.repository, 'CANONICAL_DISPATCH_REF_REQUIRED');
  demand(SHA.test(request.sourceSha || '') && request.sourceSha === context.sha &&
    request.workflowSha === request.sourceSha && request.pin === request.sourceSha &&
    request.workflowRef === `${profile.repository}/${WORKFLOW}@refs/heads/sprint`, 'INSTALLED_DRIVER_PIN_REQUIRED');
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

function privateReaderFromEnvironment(github, env) {
  const token = env.KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN;
  delete env.KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN;
  const app = relayReaderApp.consume(env);
  demand(!(app && token !== undefined && token !== ''), 'PRIVATE_ACTIONS_READ_IDENTITY_AMBIGUOUS');
  if (app) return relayReaderApp.client(github, app);
  // Missing private identity preserves incomplete readiness; it never borrows
  // the public Actions client or its token to produce parent facts.
  if (token === undefined || token === '') return undefined;
  demand(typeof token === 'string' && token.trim().length > 0, 'PRIVATE_ACTIONS_READ_IDENTITY_INVALID');
  try { return new github.constructor({ auth: token }); }
  catch { throw new Error('PRIVATE_ACTIONS_READ_IDENTITY_INVALID'); }
}

async function origin(github, context, request, { admission = false, pinReader } = {}) {
  const profile = repositories.forContext(context);
  demand(request.workflowRef === `${profile.repository}/${WORKFLOW}@refs/heads/sprint`, 'INSTALLED_DRIVER_PIN_REQUIRED');
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
  demand(repositories.matches(repository, profile) && repository.default_branch === 'sprint', 'REPOSITORY_MISMATCH');
  demand(branch.protected === true && branch.commit?.sha === request.sourceSha, 'CANONICAL_HEAD_MOVED_OR_UNPROTECTED');
  demand(workflow.path === WORKFLOW && workflow.state === 'active', 'CANONICAL_WORKFLOW_NOT_INSTALLED');
  demand(run.id === request.runId && run.run_attempt === request.attempt && run.workflow_id === workflow.id &&
    run.event === 'workflow_dispatch' && run.path?.split('@')[0] === WORKFLOW &&
    run.head_sha === request.sourceSha && run.head_branch === 'sprint' &&
    repositories.matches(run.head_repository, profile) &&
    (!profile.private || repositories.matches(run.repository, profile)) &&
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
    ...(platform === 'IOS' ? ['Build development app',
      'Run disposable startup smoke', 'Run disposable native Keychain across three processes',
      'Run disposable native persistence probe', 'Run R5 production worker native scenarios',
      'Run strict native TLS and production Electrum RPC matrix', 'Run historical Realm109 migration matrix',
      'Measure full-product startup wallet and Retry flows'] : ['Verify Android hosted source admission', 'Verify exact Android compile artifact before download',
      'Restore exact Android compile artifact', 'Run Android startup persistence worker TLS Realm trust and product flows'])];
}

function producerSteps(canonical = true) {
  return [...(canonical ? ['Verify canonical installed source'] : []), 'Verify Android hosted source admission', 'Record runner and toolchain', 'Install immutable native dependencies',
    'Build development app', 'Record official Android compile producer', 'Prepare exact Android build checkpoint',
    'Upload exact Android build checkpoint'];
}

async function platformJobs(github, context, request, run) {
  const profile = repositories.forContext(context);
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt,
    { ...context.repo, run_id: request.runId, attempt_number: request.attempt, per_page: 100 });
  const result = {};
  for (const platform of ['IOS', 'ANDROID', 'ANDROID_PRODUCER']) {
    const selectedName = platform === 'ANDROID_PRODUCER' ? 'android / Canonical ANDROID compile producer' :
      `${platform.toLowerCase()} / Canonical ${platform} build and features`;
    const matches = jobs.filter(job => job.name === selectedName);
    demand(matches.length === 1, 'CANONICAL_PLATFORM_JOB_MISSING_OR_AMBIGUOUS');
    const job = matches[0];
    demand(Number.isSafeInteger(job.id) && job.id > 0 && !Object.values(result).some(previous => previous.id === job.id) &&
      job.run_id === request.runId && job.run_attempt === request.attempt && job.head_sha === request.sourceSha &&
      job.status === 'completed' && job.conclusion === 'success' && Array.isArray(job.labels) &&
      job.labels.includes(platform === 'IOS' ? 'macos-15' : 'ubuntu-24.04') && !job.labels.includes('self-hosted'),
    'CANONICAL_PLATFORM_NOT_EXACT_SUCCESS');
    for (const name of platform === 'ANDROID_PRODUCER' ? producerSteps() : requiredSteps(platform)) {
      const steps = job.steps?.filter(step => step.name === name) ?? [];
      demand(steps.length === 1 && steps[0].status === 'completed' && steps[0].conclusion === 'success', 'CANONICAL_REQUIRED_STEP_NOT_SUCCESS');
    }
    const checkId = repositories.checkId(job.check_run_url, profile);
    demand(checkId, 'CANONICAL_JOB_CHECK_LINK_INVALID');
    const check = (await github.rest.checks.get({ ...context.repo, check_run_id: checkId })).data;
    demand(check.id === checkId && check.name === job.name && githubApp(check) &&
      check.head_sha === request.sourceSha && check.check_suite?.id === run.check_suite_id &&
      check.status === 'completed' && check.conclusion === 'success', 'CANONICAL_JOB_CHECK_UNTRUSTED');
    result[platform] = job;
  }
  return result;
}

async function androidCustody(github, context, request, run, jobs, metadata, { callerPath = WORKFLOW, workerPath = WORKER } = {}) {
  demand((callerPath === WORKFLOW && workerPath === WORKER) ||
    (callerPath === '.github/workflows/keeper-release-acceptance.yml' && workerPath === '.github/workflows/keeper-native-platform.yml'),
  'CANONICAL_ANDROID_PRODUCER_ROUTE_INVALID');
  const c = metadata.android_compile_custody, profile = repositories.forContext(context), producer = jobs.ANDROID_PRODUCER;
  demand(c?.schema === 1 && c.status === 'PASS' && c.native_acceptance === false &&
    c.repository === profile.repository && c.repository_id === profile.repositoryId && c.repository_private === profile.private &&
    c.source_sha === request.sourceSha && SHA.test(c.source_tree || '') && c.run_id === request.runId && c.run_attempt === request.attempt &&
    c.workflow_id === run.workflow_id && c.workflow_sha === request.workflowSha && c.workflow_ref === request.workflowRef &&
    c.caller_path === callerPath && c.worker_path === workerPath && c.diagnostic_only === false &&
    c.producer_job_id === producer.id && c.producer_job_name === producer.name &&
    c.producer_check_run_id === repositories.checkId(producer.check_run_url, profile) &&
    c.raw_zip_purged === true && /^[a-f0-9]{64}$/.test(c.manifest_sha256 || '') &&
    /^[a-f0-9]{64}$/.test(c.producer_metadata_sha256 || '') && /^[a-f0-9]{64}$/.test(c.apk_sha256 || '') &&
    Number.isSafeInteger(c.apk_size_bytes) && c.apk_size_bytes > 0 && c.apk_size_bytes <= 536870912 &&
    metadata.built_artifact?.sha256 === c.apk_sha256 && metadata.build === 'PASS' &&
    metadata.build_execution_scope === 'SAME_CURRENT_SOURCE_SAME_RUN_OFFICIAL_ANDROID_COMPILE_PRODUCER' &&
    metadata.current_source_compilation === 'PASS_OFFICIAL_SAME_RUN_PRODUCER_JOB' && metadata.runtime_host_compilation === 'NOT RUN',
  'CANONICAL_ANDROID_PRODUCER_CUSTODY_INVALID');
  const build = c.producer_build, argv = build?.command;
  demand(build?.label === 'Build debug-key-only development APK' && build.exit_code === 0 &&
    Number.isFinite(build.duration_seconds) && build.duration_seconds >= 0 &&
    build.timeout_seconds === 3000 &&
    Array.isArray(argv) && argv.length === 11 &&
    JSON.stringify(argv.slice(0, 8)) === JSON.stringify(['./gradlew', ':app:assembleDevelopmentDebug', '--no-daemon', '--max-workers=2',
      '-PreactNativeArchitectures=x86_64', '-Pandroid.buildOnlyTargetAbi=true', '-Pandroid.injected.build.abi=x86_64', '-Pandroid.injected.testOnly=false']) &&
    /^-Pandroid\.injected\.apk\.location=\/[^\x00-\x1f]+\/android\/app\/build\/outputs\/apk$/.test(argv[8]) &&
    !argv[8].split('/').includes('..') && JSON.stringify(argv.slice(9)) === JSON.stringify(['--info', '--console=plain']),
  'CANONICAL_ANDROID_PRODUCER_BUILD_INVALID');
  const a = c.artifact;
  demand(Number.isSafeInteger(a?.id) && a.id > 0 &&
    a.name === `keeper-android-build-checkpoint-${request.sourceSha}-${request.runId}-${request.attempt}` &&
    /^[a-f0-9]{64}$/.test(a.sha256 || '') && Number.isSafeInteger(a.size_bytes) && a.size_bytes > 0 && a.size_bytes <= 539000000,
  'CANONICAL_ANDROID_PRODUCER_ARTIFACT_INVALID');
  const current = (await github.rest.actions.getArtifact({ ...context.repo, artifact_id: a.id })).data;
  demand(current.id === a.id && current.name === a.name && current.digest === 'sha256:' + a.sha256 &&
    current.size_in_bytes === a.size_bytes && current.expired === false && current.workflow_run?.id === request.runId &&
    current.workflow_run.head_sha === request.sourceSha && current.workflow_run.repository_id === profile.repositoryId &&
    current.workflow_run.head_repository_id === profile.repositoryId, 'CANONICAL_ANDROID_PRODUCER_ARTIFACT_INVALID');
  return { id: current.id, name: current.name, digest: current.digest, size: current.size_in_bytes,
    runId: request.runId, sourceSha: request.sourceSha, expiresAt: current.expires_at ?? null, sourceTree: c.source_tree,
    repositoryId: profile.repositoryId };
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
  for (const [name, scope] of Object.entries(NATIVE_PHASE_SCOPES))
    if (platform === 'IOS' || name !== 'native-keychain') checks[name] = { status: 'NOT VERIFIED', scope };
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
    for (const name of Object.keys(NATIVE_PHASE_SCOPES)) if (checks[name]) checks[name].status = 'PASS';
  } catch { /* A label or payload-owned source hash cannot satisfy this subcheck. */ }
  // Parent obligations remain explicit. Scoped companion UI does not establish
  // private bytes, protocol/account isolation, WAN offline, recovery or a budget.
  return { cases, executed_checks: checks };
}

async function collectPublic(github, context, request, readZip, { pinReader } = {}) {
  requestFromEnvironment(context, { KEEPER_SOURCE_SHA: request.sourceSha, GITHUB_WORKFLOW_SHA: request.workflowSha,
    GITHUB_WORKFLOW_REF: request.workflowRef, KEEPER_CANONICAL_NATIVE_DRIVER_SHA: request.pin,
    GITHUB_RUN_ID: String(request.runId), GITHUB_RUN_ATTEMPT: String(request.attempt) });
  const { run } = await origin(github, context, request, { pinReader });
  const jobs = await platformJobs(github, context, request, run);
  const jobAuthorities = Object.fromEntries(['IOS', 'ANDROID', 'ANDROID_PRODUCER'].map(platform => [platform,
    { id: jobs[platform].id, name: jobs[platform].name, check_run_url: jobs[platform].check_run_url }]));
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
  const platforms = {}, artifactAuthorities = [];
  for (const platform of ['IOS', 'ANDROID']) {
    const matches = page.artifacts.filter(item => item.name === artifactName(platform, request));
    demand(matches.length === 1, 'CANONICAL_ARTIFACT_MISSING_OR_AMBIGUOUS');
    const artifact = matches[0];
    demand(!artifact.expired && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 1048576 &&
      artifact.workflow_run?.id === request.runId && artifact.workflow_run.head_sha === request.sourceSha &&
      /^sha256:[a-f0-9]{64}$/.test(artifact.digest || ''), 'CANONICAL_ARTIFACT_IDENTITY_INVALID');
    // Capture primitive authority fields independently of response object identity.
    // Every selected artifact is rechecked after all later platform/tree reads.
    artifactAuthorities.push({ id: artifact.id, name: artifact.name, digest: artifact.digest,
      size: artifact.size_in_bytes, runId: artifact.workflow_run.id, sourceSha: artifact.workflow_run.head_sha,
      expiresAt: artifact.expires_at ?? null });
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
    if (platform === 'ANDROID') artifactAuthorities.push(await androidCustody(github, context, request, run, jobs, metadata));
    platforms[platform] = { conclusion: 'success', artifact_id: artifact.id,
      receipt_sha256: digest(raw), ...validateMetadata(metadata, request, platform, workerSources) };
  }
  const commit = (await github.rest.git.getCommit({ ...context.repo, commit_sha: request.sourceSha })).data;
  demand(commit.sha === request.sourceSha && SHA.test(commit.tree?.sha || ''), 'CANONICAL_SOURCE_TREE_UNVERIFIED');
  demand(artifactAuthorities.every(row => !row.sourceTree || row.sourceTree === commit.tree.sha), 'CANONICAL_ANDROID_PRODUCER_SOURCE_TREE_INVALID');
  for (const original of artifactAuthorities) {
    const current = (await github.rest.actions.getArtifact({ ...context.repo, artifact_id: original.id })).data;
    demand(current.id === original.id && current.name === original.name && current.expired === false &&
      current.digest === original.digest && current.size_in_bytes === original.size &&
      current.workflow_run?.id === original.runId && current.workflow_run.head_sha === original.sourceSha,
    'CANONICAL_ARTIFACT_EXPIRED_OR_CHANGED');
    demand(!original.repositoryId || (current.workflow_run.repository_id === original.repositoryId &&
      current.workflow_run.head_repository_id === original.repositoryId), 'CANONICAL_ANDROID_PRODUCER_ARTIFACT_INVALID');
  }
  // The source/pin/run fence must be terminal: commit-tree and final artifact
  // reads above can observe a revocation that occurred after initial admission.
  await origin(github, context, request, { pinReader });
  const result = freeze({ schema: 1, kind: 'keeper-installed-public-software', repository: repositories.forContext(context).repository,
    source_sha: request.sourceSha, source_tree: commit.tree.sha, workflow_sha: request.workflowSha,
    workflow_path: WORKFLOW, run_id: request.runId, run_attempt: request.attempt,
    selected_route: 'canonical-hosted-native', platforms, worker_sources: workerSources });
  if (Object.values(platforms).every(item => item.cases.slice(0, 2).every(test => test.status === 'PASS') &&
    Object.values(item.executed_checks).every(test => test.status === 'PASS'))) {
    publicProofs.add(result);
    publicAuthorities.set(result, freeze({ request: { ...request }, jobs: jobAuthorities,
      artifacts: artifactAuthorities, tree: commit.tree.sha, suiteId: run.check_suite_id, workflowId: run.workflow_id }));
  }
  return result;
}

async function collectInstalledPublicEvidence(github, context, request, readZip, options = {}) {
  const result = await collectPublic(github, context, request, readZip, options);
  demand(publicProofs.has(result), 'CANONICAL_PUBLIC_SOFTWARE_INCOMPLETE');
  return result;
}

async function revalidateInstalledPublicEvidence(github, context, request, proof, { pinReader, clock = Date.now } = {}) {
  demand(publicProofs.has(proof), 'CANONICAL_PUBLIC_CAPABILITY_REQUIRED');
  const original = publicAuthorities.get(proof);
  demand(['sourceSha', 'workflowSha', 'workflowRef', 'pin', 'runId', 'attempt'].every(key =>
    request[key] === original.request[key]), 'CANONICAL_PUBLIC_WINDOW_MISMATCH');
  const { run } = await origin(github, context, request, { pinReader });
  demand(run.check_suite_id === original.suiteId && run.workflow_id === original.workflowId,
    'CANONICAL_PUBLIC_AUTHORITY_CHANGED');
  const jobs = await platformJobs(github, context, request, run);
  for (const platform of ['IOS', 'ANDROID', 'ANDROID_PRODUCER']) {
    const current = jobs[platform], previous = original.jobs[platform];
    demand(current.id === previous.id && current.name === previous.name && current.check_run_url === previous.check_run_url,
      'CANONICAL_PUBLIC_AUTHORITY_CHANGED');
  }
  const commit = (await github.rest.git.getCommit({ ...context.repo, commit_sha: request.sourceSha })).data;
  demand(commit.sha === request.sourceSha && commit.tree?.sha === original.tree, 'CANONICAL_SOURCE_TREE_UNVERIFIED');
  for (const previous of original.artifacts) {
    const current = (await github.rest.actions.getArtifact({ ...context.repo, artifact_id: previous.id })).data;
    const expiry = current.expires_at ?? null;
    demand(current.id === previous.id && current.name === previous.name && current.expired === false &&
      current.digest === previous.digest && current.size_in_bytes === previous.size &&
      current.workflow_run?.id === previous.runId && current.workflow_run.head_sha === previous.sourceSha &&
      expiry === previous.expiresAt && (expiry === null || (typeof expiry === 'string' && Date.parse(expiry) > clock())),
    'CANONICAL_ARTIFACT_EXPIRED_OR_CHANGED');
    demand(!previous.repositoryId || (current.workflow_run.repository_id === previous.repositoryId &&
      current.workflow_run.head_repository_id === previous.repositoryId), 'CANONICAL_ANDROID_PRODUCER_ARTIFACT_INVALID');
  }
  // Long private network/ZIP work cannot preserve stale public proof authority.
  // This final public phase also rechecks source/workflow/current run and live pin.
  await origin(github, context, request, { pinReader });
  return true;
}

async function collect(github, context, request, output, readZip, { pinReader, privateGithub, clock, fetchImpl } = {}) {
  fs.rmSync(path.join(output, 'keeper-canonical-native-attestation.json'), { force: true });
  const publicProof = await collectPublic(github, context, request, readZip, { pinReader });
  const { kind, worker_sources, ...publicFields } = publicProof;
  // No default-token fallback: parent collection requires an explicitly supplied
  // separate read identity and a genuinely installed, finite source profile.
  let platforms = publicProof.platforms;
  if (privateGithub !== undefined) {
    const parents = require('./installed_parent_software.cjs');
    const privateProof = await parents.collectInstalledParentSoftware(privateGithub, github, context, request,
      publicProof, { pinReader, clock, fetchImpl });
    platforms = parents.projectInstalledParentCases(publicProof, privateProof);
  }
  const complete = Object.values(platforms).every(item => item.cases.length === REQUIRED.length &&
    item.cases.every(test => test.status === 'PASS') && Object.values(item.executed_checks).every(test => test.status === 'PASS'));
  const result = { ...publicFields, platforms, kind: 'keeper-canonical-native', feature_matrix_complete: complete };
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
  pinReaderFromEnvironment, privateReaderFromEnvironment, origin, requiredSteps, producerSteps, platformJobs, androidCustody, validateMetadata, collect,
  artifactName, attestationName, readMetadataZip, collectInstalledPublicEvidence,
  revalidateInstalledPublicEvidence,
  isInstalledPublicEvidence: value => publicProofs.has(value) };
