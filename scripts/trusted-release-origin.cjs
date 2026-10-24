#!/usr/bin/env node
'use strict';

// Read-only provenance consumer. It does not authorize, sign, build or upload.
// The preparation gate deliberately does not import this uninstalled package.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { UUID: SARIF_ID, CATEGORY: CODEQL_CATEGORY } = require('./codeql-analysis-receipt.cjs');
const { SCOPES: PUBLIC_COMPANIONS, validatePublicCompanions } = require('../.github/native/public_companion_receipts.cjs');
const REPOSITORY = 'KeeperCommunity/bitcoin-keeper';
const PIN = 'KEEPER_CANONICAL_NATIVE_DRIVER_SHA';
const CANONICAL_PATH = '.github/workflows/keeper-canonical-native.yml';
const CASES = Object.freeze([
  'native-build-and-startup', 'native-realm-mmkv-process-persistence',
  'key-deletion-live-reference-and-privacy', 'setup-offline-retry-relaunch-no-duplicates',
  'app-account-session-isolation', 'normal-page-runtime-and-recovery-regression',
  'cold-start-and-first-wallet-performance',
]);
const EXECUTED = Object.freeze({
  'native-build': 'development native build',
  startup: 'ordinary app passcode startup smoke',
  'native-storage': 'CI entrypoint native Realm/MMKV process persistence',
  'production-worker-controls': 'CI-extracted production workers; synthetic boundaries are not complete application UI',
  'five-product-observations': 'ordinary app debug UI observations; no release performance budget',
  'controlled-setup-disconnect-retry': 'ordinary app loopback disconnect before commit; not physical WAN offline',
  'installed-version-history': 'native installed tuple and retained initial history; not stale-history recovery',
  'key-management-discoverability': 'ordinary app Keys Manage Keys entry and return',
  'unused-key-and-pin-ui': 'unused Mobile Key delete cancel wrong PIN and cold persistence; not live-Vault references or physical biometrics',
  ...PUBLIC_COMPANIONS,
});
const FEATURE_SCENARIOS = Object.freeze(['production-setup-offline-retry-native-counts', 'production-deletion-retained-native-references',
  'production-deletion-native-rollback', 'production-worker-stale-session-rejection', 'native-worker-process-relaunch-counts']);
const FEATURE_LIMITS = Object.freeze(['controlled-transport-no-backend-acceptance', 'synthetic-wallet-generation-no-crypto-acceptance',
  'injected-dispatch-selection-no-login-acceptance', 'no-product-ui-navigation-pin-or-biometric-acceptance', 'probe-and-worker-timings-not-product-startup-ux']);
const SOURCES = Object.freeze({
  'src/utils/utilities.ts': ['getAccountFromSigner', 'getKeyUID'],
  'src/store/sagas/storage.ts': ['setupKeeperAppWorker'],
  'src/store/sagas/wallets.ts': ['currentWalletAccountId', 'assertWalletAccount', 'deleteSigningDeviceWorker'],
  'src/store/sagas/bhr.ts': ['currentBackupAppId', 'deleteAppImageEntityWorker'],
  'src/services/backup/transport.ts': ['observeBackupAccount', 'currentBackupAccountSession', 'clearVerifiedRemoteRevision'],
});
const PRODUCERS = Object.freeze([
  { file: 'test.yml', path: '.github/workflows/test.yml', event: 'push', job: 'Tests',
    steps: ['Run tests', 'Run recovery regression tests', 'Verify checked-out release version consistency', 'Run release and packaged-artifact tests'] },
  { file: 'codeql.yml', path: '.github/workflows/codeql.yml', event: 'push', job: 'Analyze JavaScript/TypeScript',
    steps: ['Initialize CodeQL', 'Analyze', 'Capture official CodeQL upload ID', 'Upload CodeQL analysis provenance'] },
  { file: 'keeper-canonical-native.yml', path: CANONICAL_PATH, event: 'workflow_dispatch',
    jobs: ['ios / Canonical IOS build and features', 'android / Canonical ANDROID build and features', 'Canonical native attestation'] },
]);
const proofs = new WeakSet();
const hex40 = /^[a-f0-9]{40}$/;
const hex64 = /^[a-f0-9]{64}$/;
const MAX_ARCHIVE = 128 * 1024;
const MAX_JSON = 64 * 1024;
const check = (value, code) => { if (!value) throw new Error(code); };
const id = value => Number.isSafeInteger(value) && value > 0;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const exactKeys = (value, keys) => value && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const complete = (value, key) => {
  check(Number.isSafeInteger(value?.total_count) && value.total_count > 0 && value.total_count <= 100 &&
    Array.isArray(value[key]) && value[key].length === value.total_count, 'INCOMPLETE_PROVENANCE_PAGINATION');
  return value[key];
};

async function boundedBytes(response, limit) {
  check(response.ok && response.body, 'PROVENANCE_READ_UNAVAILABLE');
  const declared = response.headers.get('content-length');
  check(declared === null || (/^\d+$/.test(declared) && Number(declared) <= limit), 'PROVENANCE_RESPONSE_TOO_LARGE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      check(size <= limit, 'PROVENANCE_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

function client(token, missing = 'PROVENANCE_TOKEN_MISSING', noCache = false) {
  check(typeof token === 'string' && token.length > 0, missing);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (noCache) headers['Cache-Control'] = 'no-cache';
  const base = `https://api.github.com/repos/${REPOSITORY}`;
  return {
    async api(endpoint) {
      const response = await fetch(base + (endpoint ? `/${endpoint}` : ''), { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
      // Code Scanning lists are bare arrays, so no total_count can prove a
      // bounded page complete. Never silently ignore a continuation link.
      check(!response.headers.get('link')?.match(/rel="next"/), 'INCOMPLETE_PROVENANCE_PAGINATION');
      if (endpoint.startsWith('code-scanning/')) check(response.ok, 'CODEQL_ANALYSIS_READ_UNAVAILABLE');
      return JSON.parse((await boundedBytes(response, 1024 * 1024)).toString('utf8'));
    },
    async archive(artifactId) {
      const response = await fetch(`${base}/actions/artifacts/${artifactId}/zip`, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
      check(response.status === 302, 'ARTIFACT_REDIRECT_REQUIRED');
      const location = new URL(response.headers.get('location'));
      check(location.protocol === 'https:' && !location.username && !location.password && !location.hash &&
        (location.hostname.endsWith('.blob.core.windows.net') || location.hostname.endsWith('.actions.githubusercontent.com')), 'UNTRUSTED_ARTIFACT_HOST');
      // The GitHub token is never forwarded to the signed storage URL.
      return boundedBytes(await fetch(location, { redirect: 'error', signal: AbortSignal.timeout(30000) }), MAX_ARCHIVE);
    },
  };
}

// A deliberately small, single regular-file ZIP reader. Reject extra files,
// links, traversal, encryption, ZIP64 and ambiguous headers.
function unpack(archive, filename) {
  check(archive.length >= 22 && archive.length <= MAX_ARCHIVE, 'ARTIFACT_ZIP_INVALID');
  const end = archive.length - 22;
  check(archive.readUInt32LE(end) === 0x06054b50 && archive.readUInt16LE(end + 4) === 0 &&
    archive.readUInt16LE(end + 6) === 0 && archive.readUInt16LE(end + 8) === 1 &&
    archive.readUInt16LE(end + 10) === 1 && archive.readUInt16LE(end + 20) === 0, 'ARTIFACT_ZIP_INVALID');
  const centralSize = archive.readUInt32LE(end + 12);
  const central = archive.readUInt32LE(end + 16);
  check(central >= 30 && central + centralSize === end && centralSize >= 46 && archive.readUInt32LE(central) === 0x02014b50, 'ARTIFACT_ZIP_INVALID');
  const flags = archive.readUInt16LE(central + 8);
  const method = archive.readUInt16LE(central + 10);
  const packed = archive.readUInt32LE(central + 20);
  const size = archive.readUInt32LE(central + 24);
  const nameSize = archive.readUInt16LE(central + 28);
  const extraSize = archive.readUInt16LE(central + 30);
  const commentSize = archive.readUInt16LE(central + 32);
  const mode = archive.readUInt32LE(central + 38) >>> 16;
  check([0, 8, 0x800, 0x808].includes(flags) && [0, 8].includes(method) && size > 0 && size <= MAX_JSON &&
    centralSize === 46 + nameSize + extraSize + commentSize && commentSize === 0 &&
    archive.readUInt16LE(central + 34) === 0 && archive.readUInt32LE(central + 42) === 0 &&
    (mode === 0 || (mode & 0o170000) === 0o100000), 'ARTIFACT_ZIP_INVALID');
  check(archive.subarray(central + 46, central + 46 + nameSize).toString('utf8') === filename &&
    archive.readUInt32LE(0) === 0x04034b50 && archive.readUInt16LE(6) === flags && archive.readUInt16LE(8) === method &&
    archive.readUInt16LE(26) === nameSize, 'ARTIFACT_ZIP_INVALID');
  const start = 30 + nameSize + archive.readUInt16LE(28);
  check(archive.subarray(30, 30 + nameSize).toString('utf8') === filename && start + packed <= central, 'ARTIFACT_ZIP_INVALID');
  const crc = archive.readUInt32LE(central + 16);
  if (flags & 8) {
    check([0, crc].includes(archive.readUInt32LE(14)) && [0, packed].includes(archive.readUInt32LE(18)) &&
      [0, size].includes(archive.readUInt32LE(22)), 'ARTIFACT_ZIP_INVALID');
    let descriptor = start + packed;
    if (central - descriptor === 16 && archive.readUInt32LE(descriptor) === 0x08074b50) descriptor += 4;
    check(central - descriptor === 12 && archive.readUInt32LE(descriptor) === crc &&
      archive.readUInt32LE(descriptor + 4) === packed && archive.readUInt32LE(descriptor + 8) === size, 'ARTIFACT_ZIP_INVALID');
  } else {
    check(start + packed === central && archive.readUInt32LE(14) === crc && archive.readUInt32LE(18) === packed &&
      archive.readUInt32LE(22) === size, 'ARTIFACT_ZIP_INVALID');
  }
  const content = archive.subarray(start, start + packed);
  const bytes = method === 0 ? content : zlib.inflateRawSync(content, { maxOutputLength: MAX_JSON });
  check(bytes.length === size, 'ARTIFACT_ZIP_INVALID');
  return bytes;
}

function sameRepository(repository, expectedId) {
  return repository?.id === expectedId && repository.full_name === REPOSITORY;
}

async function selectRun(api, producer, sourceSha, repositoryId, now) {
  const workflow = await api(`actions/workflows/${producer.file}`);
  check(id(workflow.id) && workflow.path === producer.path && workflow.state === 'active', 'PRODUCER_NOT_INSTALLED');
  const runs = complete(await api(`actions/workflows/${workflow.id}/runs?branch=sprint&event=${producer.event}&head_sha=${sourceSha}&per_page=100`), 'workflow_runs');
  // No success filter: a later failure, skip, cancellation or pending attempt
  // revokes earlier credit for this immutable source and selected producer.
  check(runs.every(run => id(run.id)), 'RUN_ID_INVALID');
  const selectedId = Math.max(...runs.map(value => value.id));
  const run = await api(`actions/runs/${selectedId}`);
  const updated = Date.parse(run.updated_at);
  check(run.id === selectedId && run.workflow_id === workflow.id && run.path === producer.path && run.event === producer.event &&
    run.head_branch === 'sprint' && run.head_sha === sourceSha && id(run.run_attempt) && id(run.check_suite_id) &&
    run.status === 'completed' && run.conclusion === 'success' && sameRepository(run.repository, repositoryId) &&
    sameRepository(run.head_repository, repositoryId) && Number.isFinite(updated) && updated <= now && updated >= now - 86400000,
  'PRODUCER_NOT_EXACT_CURRENT_SUCCESS');
  check(runs.some(value => value.id === run.id && value.run_attempt === run.run_attempt && value.head_sha === sourceSha), 'RUN_ATTEMPT_CHANGED');
  const jobs = complete(await api(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`), 'jobs');
  const names = producer.jobs || [producer.job];
  const selected = [];
  for (const name of names) {
    const matching = jobs.filter(job => job.name === name);
    check(matching.length === 1, 'REQUIRED_PRODUCER_JOB_MISSING');
    const job = matching[0];
    check(id(job.id) && job.run_id === run.id && job.run_attempt === run.run_attempt && job.head_sha === sourceSha &&
      job.status === 'completed' && job.conclusion === 'success', 'PRODUCER_JOB_NOT_EXACT_SUCCESS');
    const match = job.check_run_url?.match(/^https:\/\/api\.github\.com\/repos\/KeeperCommunity\/bitcoin-keeper\/check-runs\/([1-9]\d*)$/);
    check(match && id(Number(match[1])), 'JOB_CHECK_BINDING_INVALID');
    const execution = await api(`check-runs/${match[1]}`);
    check(execution.id === Number(match[1]) && execution.name === job.name && execution.check_suite?.id === run.check_suite_id &&
      execution.head_sha === sourceSha && execution.status === 'completed' && execution.conclusion === 'success' &&
      execution.app?.id === 15368 && execution.app.slug === 'github-actions', 'JOB_CHECK_ORIGIN_INVALID');
    const requiredSteps = producer.steps || (name === 'Canonical native attestation' ? ['Verify canonical receipts and required matrix'] : []);
    for (const step of requiredSteps) {
      const matchingSteps = job.steps?.filter(value => value.name === step) || [];
      check(matchingSteps.length === 1 && matchingSteps[0].status === 'completed' && matchingSteps[0].conclusion === 'success', 'REQUIRED_PRODUCER_STEP_MISSING');
    }
    selected.push({ name: job.name, job_id: job.id, check_run_id: execution.id });
  }
  return { workflow, run, jobs: selected };
}

function verifyArtifact(info, name, run, sourceSha, now) {
  check(id(info?.id) && info.name === name && info.expired === false && /^sha256:[a-f0-9]{64}$/.test(info.digest || '') &&
    id(info.size_in_bytes) && info.size_in_bytes <= MAX_ARCHIVE && info.workflow_run?.id === run.id &&
    info.workflow_run?.head_sha === sourceSha && Date.parse(info.expires_at) > now, 'ARTIFACT_PROVENANCE_INVALID');
}

function validateAttestation(payload, sourceSha, tree, run) {
  check(exactKeys(payload, ['schema', 'kind', 'repository', 'source_sha', 'source_tree', 'workflow_sha', 'workflow_path', 'run_id', 'run_attempt', 'selected_route', 'platforms', 'feature_matrix_complete']) &&
    payload.schema === 1 && payload.kind === 'keeper-canonical-native' && payload.repository === REPOSITORY &&
    payload.source_sha === sourceSha && payload.source_tree === tree && payload.workflow_sha === sourceSha &&
    payload.workflow_path === CANONICAL_PATH && payload.run_id === run.id && payload.run_attempt === run.run_attempt &&
    payload.selected_route === 'canonical-hosted-native' && payload.feature_matrix_complete === true &&
    exactKeys(payload.platforms, ['IOS', 'ANDROID']), 'CANONICAL_ATTESTATION_INCOMPLETE');
  for (const platform of ['IOS', 'ANDROID']) {
    const receipt = payload.platforms[platform];
    check(exactKeys(receipt, ['conclusion', 'receipt_sha256', 'artifact_id', 'cases', 'executed_checks']) && receipt.conclusion === 'success' &&
      hex64.test(receipt.receipt_sha256 || '') && id(receipt.artifact_id) && Array.isArray(receipt.cases) && receipt.cases.length === CASES.length &&
      CASES.every(name => receipt.cases.filter(value => exactKeys(value, ['id', 'status']) && value.id === name && value.status === 'PASS').length === 1),
    'CANONICAL_FEATURE_MATRIX_INCOMPLETE');
    check(exactKeys(receipt.executed_checks, Object.keys(EXECUTED)) && Object.entries(EXECUTED).every(([name, scope]) =>
      exactKeys(receipt.executed_checks[name], ['status', 'scope']) && receipt.executed_checks[name].status === 'PASS' &&
      receipt.executed_checks[name].scope === scope), 'CANONICAL_EXECUTED_CHECKS_INCOMPLETE');
  }
}

function installedBytes(value, platform, expected) {
  const [method, hashes] = platform === 'IOS' ?
    ['FULL_SIMULATOR_BUNDLE_TREE_AND_EXECUTABLE_SHA256', ['inventory_sha256', 'executable_sha256']] :
    ['SINGLE_INSTALLED_BASE_APK_SHA256', ['sha256']];
  const proof = value?.installed_artifact;
  check(value?.installed_artifact_verified === true && exactKeys(proof, ['method', ...hashes]) &&
    proof.method === method && hashes.every(name => typeof proof[name] === 'string' && hex64.test(proof[name])) &&
    (!expected || (proof.method === expected.method && hashes.every(name => proof[name] === expected[name]))),
  'INSTALLED_BYTE_PROOF_INCOMPLETE');
  return proof;
}

function validateReceipt(value, sourceSha, run, platform, sources) {
  const appIds = { IOS: 'io.hexawallet.hexakeeper.dev', ANDROID: 'io.hexawallet.keeper.development' };
  check(value.schema === 1 && value.platform === platform && value.source_sha === sourceSha && value.workflow_sha === sourceSha &&
    value.workflow_ref === `${REPOSITORY}/${CANONICAL_PATH}@refs/heads/sprint` && value.diagnostic_only === false && value.app_id === appIds[platform] &&
    value.run_id === String(run.id) && value.run_attempt === String(run.run_attempt) &&
    ['build', 'smoke', 'native_probe', 'r5_features'].every(key => value[key] === 'PASS') && value.product_ui?.status === 'PASS',
  'PLATFORM_RECEIPT_NOT_EXACT_SUCCESS');
  const installed = installedBytes(value, platform);
  const binaryHash = platform === 'IOS' ? 'executable_sha256' : 'sha256';
  check(typeof value.built_artifact?.[binaryHash] === 'string' &&
    hex64.test(value.built_artifact[binaryHash]) && value.built_artifact[binaryHash] === installed[binaryHash],
  'INSTALLED_BYTES_NOT_BOUND_TO_BUILD');
  const samples = value.product_ui.samples;
  const durations = ['startup_to_passcode_ms', 'start_new_to_ready_ms', 'start_new_to_home_ms', 'cold_relaunch_to_login_ms', 'cold_relaunch_to_authenticated_home_ms'];
  check(value.product_ui.requested_samples === 5 && Array.isArray(samples) && samples.length === 5 && samples.every((sample, index) =>
    sample.sample === index + 1 && sample.status === 'PASS' && sample.create_new_app_calls === 1 &&
    sample.visible_wallet_count_before_relaunch === 1 && sample.visible_wallet_count_after_relaunch === 1 &&
    sample.installed_version_header_and_initial_history === 'PASS' && sample.key_management_entry_and_exit === 'PASS' &&
    durations.every(name => Number.isFinite(sample.raw_durations?.[name]) && sample.raw_durations[name] >= 0 && sample.raw_durations[name] <= 3600000)),
  'PRODUCT_OBSERVATIONS_INCOMPLETE');
  for (const sample of samples) installedBytes(sample, platform, installed);
  const retry = value.product_ui.controlled_disconnect_retry;
  check(retry?.status === 'PASS' && retry.scenario === 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE' && retry.performance_sample === false &&
    retry.create_new_app_calls === 2 && retry.transport_requests_dropped_without_commit === 1 && retry.acknowledged_create_responses === 1 &&
    retry.unexpected_create_attempts === 0 && retry.visible_wallet_count_after_relaunch === 1, 'PRODUCT_RETRY_INCOMPLETE');
  installedBytes(retry, platform, installed);
  const key = value.product_ui.key_management_ui;
  check(key?.status === 'PASS' && key.entrypoint === 'index.js' && key.network === 'TESTNET' &&
    key.scenario === 'UNUSED_MOBILE_KEY_UI_DELETE_AND_NATIVE_PIN' && key.new_account_requests_during_key_flow === 0 &&
    key.visible_eligible_keys_after_deletion === 0 && key.unrelated_visible_wallet_count_after_relaunch === 1, 'PRODUCT_KEY_UI_INCOMPLETE');
  installedBytes(key, platform, installed);
  validatePublicCompanions(value, platform);
  const feature = value.r5_feature_evidence;
  check(feature?.schema === 1 && feature.scope === 'production-worker-native-storage' && feature.status === 'PASS' &&
    JSON.stringify(feature.scenarios) === JSON.stringify(FEATURE_SCENARIOS.map(id => ({ id, status: 'PASS' }))) &&
    JSON.stringify(feature.limits) === JSON.stringify(FEATURE_LIMITS) && JSON.stringify(feature.source_functions) === JSON.stringify(sources),
  'WORKER_FEATURE_EVIDENCE_INCOMPLETE');
  check(Array.isArray(feature.measurements) && feature.measurements.length === 5 && feature.measurements.every((row, index) =>
    exactKeys(row, ['iteration', 'probe_ready_ms', 'setup_first_wallet_ms']) && row.iteration === index + 1 &&
    ['probe_ready_ms', 'setup_first_wallet_ms'].every(name => Number.isFinite(row[name]) && row[name] >= 0 && row[name] <= 600000)),
  'WORKER_MEASUREMENTS_INCOMPLETE');
}

async function securityResult(api, sourceSha) {
  const checks = complete(await api(`commits/${sourceSha}/check-runs?per_page=100`), 'check_runs');
  const results = checks.filter(value => value.name === 'CodeQL');
  check(results.length > 0 && results.every(value => id(value.id) && value.head_sha === sourceSha && value.status === 'completed' &&
    value.conclusion === 'success' && value.app?.id === 57789 && value.app.slug === 'github-advanced-security'), 'CODEQL_SECURITY_NOT_EXACT_SUCCESS');
  return results.map(value => value.id).sort((a, b) => a - b);
}

async function analysisResult(api, receipt, sourceSha) {
  const processing = await api(`code-scanning/sarifs/${receipt.sarif_id}`);
  check(processing.processing_status === 'complete' && (processing.errors == null ||
    (Array.isArray(processing.errors) && processing.errors.length === 0)), 'CODEQL_UPLOAD_NOT_COMPLETE');
  const analyses = await api(`code-scanning/analyses?sarif_id=${receipt.sarif_id}&ref=refs%2Fheads%2Fsprint&tool_name=CodeQL&per_page=100`);
  check(Array.isArray(analyses) && analyses.length === 1, 'CODEQL_ANALYSIS_MISSING_OR_AMBIGUOUS');
  const selected = analyses[0];
  check(id(selected.id), 'CODEQL_ANALYSIS_ID_INVALID');
  const analysis = await api(`code-scanning/analyses/${selected.id}`);
  check(analysis.id === selected.id && analysis.url === `https://api.github.com/repos/${REPOSITORY}/code-scanning/analyses/${selected.id}` &&
    analysis.commit_sha === sourceSha && analysis.ref === 'refs/heads/sprint' && analysis.sarif_id === receipt.sarif_id &&
    analysis.analysis_key === receipt.analysis_key && analysis.category === CODEQL_CATEGORY &&
    ['{}', 'null'].includes(analysis.environment) && analysis.tool?.name === 'CodeQL' &&
    analysis.error === '' && analysis.warning === '' && id(analysis.rules_count) &&
    Number.isSafeInteger(analysis.results_count) && analysis.results_count >= 0, 'CODEQL_ANALYSIS_IDENTITY_INVALID');
  check(['id', 'url', 'commit_sha', 'ref', 'sarif_id', 'analysis_key', 'category', 'environment', 'error', 'warning', 'rules_count', 'results_count']
    .every(key => selected[key] === analysis[key]) && JSON.stringify(selected.tool) === JSON.stringify(analysis.tool), 'CODEQL_ANALYSIS_CHANGED_DURING_READ');
  // Identity comes from the official action output + original installed job
  // artifact + API upload ID, never from timestamps or an analysis-key guess.
  return analysis;
}

function validateAnalysisReceipt(value, sourceSha, run) {
  check(exactKeys(value, ['schema', 'kind', 'repository', 'source_sha', 'source_ref', 'workflow_sha', 'workflow_path',
    'run_id', 'run_attempt', 'analysis_key', 'category', 'sarif_id']) &&
    value.schema === 1 && value.kind === 'keeper-codeql-upload' && value.repository === REPOSITORY &&
    value.source_sha === sourceSha && value.source_ref === 'refs/heads/sprint' && value.workflow_sha === sourceSha &&
    value.workflow_path === PRODUCERS[1].path && value.run_id === run.id && value.run_attempt === run.run_attempt &&
    value.analysis_key === `${PRODUCERS[1].path}:analyze` && value.category === CODEQL_CATEGORY &&
    SARIF_ID.test(value.sarif_id || ''), 'CODEQL_UPLOAD_RECEIPT_INVALID');
}

async function collectTrustedOriginUnchecked(request, token, now, pinReadToken) {
  check(hex40.test(request?.sourceSha || '') && request.sourceSha === request.driverSha &&
    request.repository === REPOSITORY, 'CANONICAL_SOURCE_REQUIRED');
  const { api, archive } = client(token);
  // Only this endpoint receives the dedicated Variables:read identity. Never
  // fall back to the Actions/provenance token when it is missing or revoked.
  const pinApi = client(pinReadToken, 'PIN_READ_TOKEN_MISSING', true).api;
  const sourceSha = request.sourceSha;
  const repository = await api('');
  check(repository.id === 470904030 && repository.full_name === REPOSITORY && repository.default_branch === 'sprint', 'REPOSITORY_IDENTITY_INVALID');
  async function currentSource() {
    const [branch, pin] = await Promise.all([api('branches/sprint'), pinApi(`actions/variables/${PIN}`)]);
    check(branch.protected === true && branch.commit?.sha === sourceSha && pin.name === PIN && pin.value === sourceSha,
      'INSTALLED_CANONICAL_DRIVER_NOT_CURRENT');
  }
  await currentSource();
  const commit = await api(`git/commits/${sourceSha}`);
  check(commit.sha === sourceSha && hex40.test(commit.tree?.sha || ''), 'SOURCE_TREE_INVALID');
  const results = [];
  for (const producer of PRODUCERS) results.push(await selectRun(api, producer, sourceSha, repository.id, now));
  const security = await securityResult(api, sourceSha);
  const requestedArtifacts = [];
  async function readArtifact(run, artifacts, name, filename, artifactId) {
    const matches = artifacts.filter(value => value.name === name && (artifactId === undefined || value.id === artifactId));
    check(matches.length === 1, 'CANONICAL_ARTIFACT_MISSING_OR_AMBIGUOUS');
    const info = await api(`actions/artifacts/${matches[0].id}`);
    check(info.id === matches[0].id, 'ARTIFACT_ID_CHANGED');
    verifyArtifact(info, name, run, sourceSha, now);
    const zipped = await archive(info.id);
    check(zipped.length === info.size_in_bytes && `sha256:${digest(zipped)}` === info.digest, 'ARTIFACT_DIGEST_MISMATCH');
    const bytes = unpack(zipped, filename);
    requestedArtifacts.push({ info, run });
    return { bytes, payload: JSON.parse(bytes.toString('utf8')) };
  }
  const codeql = results[1].run;
  const codeqlArtifacts = complete(await api(`actions/runs/${codeql.id}/artifacts?per_page=100`), 'artifacts');
  const analysisReceipt = await readArtifact(codeql, codeqlArtifacts,
    `keeper-codeql-analysis-${sourceSha}-${codeql.id}-${codeql.run_attempt}`, 'analysis.json');
  validateAnalysisReceipt(analysisReceipt.payload, sourceSha, codeql);
  const analysis = await analysisResult(api, analysisReceipt.payload, sourceSha);
  const sources = await Promise.all(Object.entries(SOURCES).map(async ([path, names]) => {
    const file = await api(`contents/${path}?ref=${sourceSha}`);
    check(file.path === path && file.encoding === 'base64' && typeof file.content === 'string' && file.size > 0 && file.size <= 512 * 1024 &&
      /^[A-Za-z0-9+/=\r\n]+$/.test(file.content), 'COMMITTED_WORKER_SOURCE_UNAVAILABLE');
    const bytes = Buffer.from(file.content, 'base64');
    check(bytes.length === file.size, 'COMMITTED_WORKER_SOURCE_UNAVAILABLE');
    return { path, sha256: digest(bytes), names };
  }));
  const canonical = results[2].run;
  const artifacts = complete(await api(`actions/runs/${canonical.id}/artifacts?per_page=100`), 'artifacts');
  const readCanonicalArtifact = (name, filename, artifactId) => readArtifact(canonical, artifacts, name, filename, artifactId);
  const suffix = `${sourceSha}-${canonical.id}-${canonical.run_attempt}`;
  const attestation = await readCanonicalArtifact(`keeper-canonical-native-attestation-${suffix}`, 'keeper-canonical-native-attestation.json');
  validateAttestation(attestation.payload, sourceSha, commit.tree.sha, canonical);
  for (const platform of ['IOS', 'ANDROID']) {
    const expected = attestation.payload.platforms[platform];
    const receipt = await readCanonicalArtifact(`keeper-canonical-native-${platform}-${suffix}`, 'metadata.json', expected.artifact_id);
    check(digest(receipt.bytes) === expected.receipt_sha256, 'PLATFORM_RECEIPT_DIGEST_MISMATCH');
    validateReceipt(receipt.payload, sourceSha, canonical, platform, sources);
  }
  // Re-read mutable authority after artifact collection. A rerun, new failed
  // run, changed pin or changed protected source invalidates the old proof.
  await currentSource();
  for (let index = 0; index < PRODUCERS.length; index++) {
    const current = await selectRun(api, PRODUCERS[index], sourceSha, repository.id, now);
    check(current.run.id === results[index].run.id && current.run.run_attempt === results[index].run.run_attempt,
      'PRODUCER_MOVED_DURING_COLLECTION');
  }
  for (const { info: original, run } of requestedArtifacts) {
    const current = await api(`actions/artifacts/${original.id}`);
    verifyArtifact(current, original.name, run, sourceSha, now);
    check(current.id === original.id && current.digest === original.digest && current.size_in_bytes === original.size_in_bytes, 'ARTIFACT_CHANGED_DURING_COLLECTION');
  }
  check(JSON.stringify(await securityResult(api, sourceSha)) === JSON.stringify(security), 'SECURITY_RESULT_CHANGED_DURING_COLLECTION');
  check(JSON.stringify(await analysisResult(api, analysisReceipt.payload, sourceSha)) === JSON.stringify(analysis),
    'CODEQL_ANALYSIS_CHANGED_DURING_COLLECTION');
  await currentSource();
  const proof = Object.freeze({ schema: 1, repository: REPOSITORY, source_sha: sourceSha, source_tree: commit.tree.sha,
    workflow_sha: sourceSha, verified_at: new Date(now).toISOString(),
    producer_runs: Object.freeze(results.map(result => Object.freeze({ path: result.workflow.path, run_id: result.run.id, run_attempt: result.run.run_attempt }))),
    attestation_sha256: digest(attestation.bytes), codeql_analysis_run_linkage_verified: true,
    security_analysis_run_linkage_verified: false, security_check_analysis_linkage_verified: false,
    codeql_analysis: Object.freeze({ analysis_id: analysis.id, sarif_id: analysis.sarif_id,
      run_id: codeql.id, run_attempt: codeql.run_attempt, receipt_sha256: digest(analysisReceipt.bytes) }),
    authorization_eligible: false, release_authorized: false, execution_allowed: false });
  proofs.add(proof);
  return proof;
}

async function collectTrustedOrigin(request, token, now = Date.now(), pinReadToken) {
  try { return await collectTrustedOriginUnchecked(request, token, now, pinReadToken); }
  catch (error) {
    // Parser/network/redirect exceptions can embed an API payload or signed
    // storage URL. Expose only fixed code vocabulary to any future caller.
    throw new Error(/^[A-Z][A-Z0-9_]{1,80}$/.test(error?.message || '') ? error.message : 'PROVENANCE_READ_INVALID');
  }
}

module.exports = { collectTrustedOrigin, isTrustedOrigin: proof => proofs.has(proof), CASES, EXECUTED, PIN, CANONICAL_PATH };
