'use strict';
// New current-installed source contract. This does not consume or promote A1 proofs.
const crypto = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const canonical = require('../.github/native/canonical_native.cjs');
const parents = require('../.github/native/installed_parent_software.cjs');
const { parseStrictJson } = require('../.github/native/strict_json.cjs');
const { unpackReadOnlyArtifact } = require('./trusted-release-origin.cjs');
const REPOSITORY = 'KeeperCommunity/bitcoin-keeper', REPOSITORY_ID = 470904030;
const BASE = 'https://api.github.com/repos/' + REPOSITORY + '/';
const CODEQL_CATEGORY = 'keeper-javascript-typescript/';
const MAX_JSON = 1024 * 1024, MAX_SARIF = 2000000, MAX_ARCHIVE = 128 * 1024;
const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const issued = new WeakMap();
const demand = (yes, code) => { if (!yes) throw new Error(code); };
const id = value => Number.isSafeInteger(value) && value > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const OPERATIONS = new Set(['ios-signed-build', 'android-signed-build', 'testflight-upload', 'play-internal-upload']);
const requestFields = ['repository', 'ref', 'driverSha', 'sourceSha', 'releaseRef', 'operation',
  'version', 'build', 'artifactSha256', 'approvalCommentId', 'identitySha256', 'configSha256', 'artifactId'];
// Both entries are exact, independently reviewed workflow bytes. The only
// optional failing job is the obsolete v2 characterization against its fixed
// legacy backend; none of its results supply v3/native/release credit.
const TEST_POLICIES = new Set([
  '8e58443ce81d1821845191ef89983af6c5d2bf9b058d62bc322a0eda093f7e4b',
  '6521e99c0ad5890a2d534c6b4efa9c190315c6ae4ccf273e8a89b0e1ec302278',
]);
const CODEQL_POLICY = '213c6a2f87e769853797992879cfb5230df6d97531501795c0d783b524c50641';
const TEST_JOBS = ['Lint', 'Tests', 'Automatic backup native Realm and Relay'];
const TEST_STEPS = ['Run tests', 'Run recovery regression tests',
  'Verify checked-out release version consistency', 'Run release and packaged-artifact tests'];
const CODEQL_STEPS = ['Initialize CodeQL', 'Analyze', 'Capture official CodeQL upload ID',
  'Upload CodeQL analysis provenance'];
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function snapshot(request) {
  demand(object(request) && Object.keys(request).length === requestFields.length &&
    requestFields.every(name => typeof request[name] === 'string') &&
    Object.keys(request).every(name => requestFields.includes(name)), 'RELEASE_ORIGIN_REQUEST_INVALID');
  return JSON.stringify(Object.fromEntries(requestFields.map(name => [name, request[name]])));
}
function fixed(error) {
  return new Error(/^RELEASE_ORIGIN_[A-Z0-9_]{1,90}$/.test(error?.message || '') ?
    error.message : 'RELEASE_ORIGIN_UNVERIFIED');
}
async function bytes(response, limit) {
  let reader;
  try {
    demand(response?.ok === true && response.body?.getReader, 'RELEASE_ORIGIN_API_UNAVAILABLE');
    const length = response.headers.get('content-length');
    demand(length === null || (/^\d+$/.test(length) && Number(length) <= limit),
      'RELEASE_ORIGIN_RESPONSE_TOO_LARGE');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const row = await reader.read();
      if (row.done) break;
      demand(row.value instanceof Uint8Array, 'RELEASE_ORIGIN_RESPONSE_INVALID');
      size += row.value.length;
      demand(size <= limit, 'RELEASE_ORIGIN_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(row.value));
    }
    demand(length === null || Number(length) === size, 'RELEASE_ORIGIN_RESPONSE_INCOMPLETE');
    return Buffer.concat(chunks);
  } finally { try { await (reader ? reader.cancel() : response?.body?.cancel()); } catch { /* no raw response errors */ } }
}
function sdk(github, fetchImpl = fetch) {
  demand(typeof github?.request === 'function', 'RELEASE_ORIGIN_SDK_REQUIRED');
  return {
    async raw(endpoint, accept = 'application/vnd.github+json', limit = MAX_JSON) {
      const url = BASE + endpoint;
      let payload, headers, called = false;
      const result = await github.request('GET ' + url, { headers: { accept },
        request: { retries: 0, parseSuccessResponseBody: false, fetch: async (actual, init) => {
          demand(!called && actual === url && init?.method === 'GET' && init.body == null,
            'RELEASE_ORIGIN_SDK_REQUEST_INVALID');
          called = true;
          const response = await fetchImpl(actual, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
          if (response.status !== 200) {
            try { await response.body?.cancel(); } catch { /* no response diagnostics */ }
            throw new Error('RELEASE_ORIGIN_API_UNAVAILABLE');
          }
          headers = response.headers;
          payload = await bytes(response, limit);
          // SDK is configured not to parse this body. Only original bounded
          // bytes enter the strict parser below.
          return new Response(null, { status: 200, headers: { 'content-type': accept } });
        } } });
      demand(called && result.status === 200 && Buffer.isBuffer(payload), 'RELEASE_ORIGIN_API_UNAVAILABLE');
      return { payload, headers };
    },
    async json(endpoint) {
      const result = await this.raw(endpoint);
      return { value: parseStrictJson(result.payload, MAX_JSON), headers: result.headers };
    },
    async archive(artifactId, expectedSize) {
      demand(id(artifactId) && id(expectedSize) && expectedSize <= MAX_ARCHIVE,
        'RELEASE_ORIGIN_ARTIFACT_INVALID');
      const url = BASE + 'actions/artifacts/' + artifactId + '/zip';
      let called = false, location;
      const result = await github.request('GET ' + url, {
        request: { retries: 0, parseSuccessResponseBody: false, fetch: async (actual, init) => {
          demand(!called && actual === url && init?.method === 'GET' && init.body == null,
            'RELEASE_ORIGIN_SDK_REQUEST_INVALID');
          called = true;
          const response = await fetchImpl(actual, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) });
          try {
            demand(response.status === 302, 'RELEASE_ORIGIN_ARTIFACT_REDIRECT_REQUIRED');
            location = new URL(response.headers.get('location'));
            return response;
          } finally { if (response.body) await response.body.cancel(); }
        } } });
      demand(called && result.status === 302 && location.protocol === 'https:' &&
        !location.username && !location.password && !location.hash &&
        (!location.port || location.port === '443') &&
        (location.hostname.endsWith('.blob.core.windows.net') ||
         location.hostname.endsWith('.actions.githubusercontent.com')), 'RELEASE_ORIGIN_ARTIFACT_HOST_INVALID');
      const payload = await bytes(await fetchImpl(location, { redirect: 'error',
        signal: AbortSignal.timeout(30000) }), MAX_ARCHIVE);
      demand(payload.length === expectedSize, 'RELEASE_ORIGIN_ARTIFACT_SIZE_INVALID');
      return payload;
    },
  };
}
async function list(api, endpoint, field) {
  const rows = [], seen = new Set();
  let total;
  for (let page = 1; page <= 10; page++) {
    const { value, headers } = await api.json(endpoint + (endpoint.includes('?') ? '&' : '?') +
      'per_page=100&page=' + page);
    demand(object(value) && Number.isSafeInteger(value.total_count) && value.total_count >= 0 &&
      value.total_count <= 1000 && (total === undefined || total === value.total_count) &&
      Array.isArray(value[field]) && value[field].length <= 100, 'RELEASE_ORIGIN_LIST_INCOMPLETE');
    total = value.total_count;
    for (const row of value[field]) {
      demand(id(row?.id) && !seen.has(row.id), 'RELEASE_ORIGIN_LIST_INCOMPLETE');
      seen.add(row.id); rows.push(row);
    }
    const more = /rel="next"/.test(headers.get('link') || '');
    demand(rows.length <= total && more === (rows.length < total), 'RELEASE_ORIGIN_LIST_INCOMPLETE');
    if (!more) return rows;
    demand(value[field].length === 100, 'RELEASE_ORIGIN_LIST_INCOMPLETE');
  }
  throw new Error('RELEASE_ORIGIN_LIST_INCOMPLETE');
}
async function workflowSource(api, file, source) {
  const { value } = await api.json('contents/.github/workflows/' + file + '?ref=' + source);
  demand(value?.type === 'file' && value.path === '.github/workflows/' + file &&
    value.encoding === 'base64' && id(value.size) && value.size <= MAX_JSON &&
    SHA.test(value.sha || '') && typeof value.content === 'string' &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(value.content), 'RELEASE_ORIGIN_WORKFLOW_SOURCE_INVALID');
  const raw = Buffer.from(value.content, 'base64');
  demand(raw.length === value.size && raw.toString('base64') === value.content.replace(/[\r\n]/g, '') &&
    crypto.createHash('sha1').update('blob ' + raw.length + '\0').update(raw).digest('hex') === value.sha,
  'RELEASE_ORIGIN_WORKFLOW_SOURCE_INVALID');
  const hash = digest(raw);
  demand(file === 'test.yml' ? TEST_POLICIES.has(hash) : hash === CODEQL_POLICY,
    'RELEASE_ORIGIN_WORKFLOW_POLICY_UNREVIEWED');
}
function actionsApp(value) { return value?.app?.id === 15368 && value.app.slug === 'github-actions'; }
async function jobIdentity(api, job, run, source, successful) {
  demand(id(job?.id) && job.run_id === run.id && job.run_attempt === run.run_attempt &&
    job.head_sha === source && job.status === 'completed' &&
    (successful ? job.conclusion === 'success' : ['success', 'failure'].includes(job.conclusion)),
  'RELEASE_ORIGIN_JOB_INVALID');
  const match = job.check_run_url?.match(/^https:\/\/api\.github\.com\/repos\/KeeperCommunity\/bitcoin-keeper\/check-runs\/([1-9]\d*)$/);
  demand(match && id(Number(match[1])), 'RELEASE_ORIGIN_CHECK_LINK_INVALID');
  const { value: check } = await api.json('check-runs/' + match[1]);
  demand(check.id === Number(match[1]) && check.name === job.name && check.check_suite?.id === run.check_suite_id &&
    check.head_sha === source && check.status === job.status && check.conclusion === job.conclusion && actionsApp(check),
  'RELEASE_ORIGIN_CHECK_INVALID');
  return { name: job.name, job_id: job.id, check_run_id: check.id, conclusion: check.conclusion };
}
async function producer(api, file, event, source, now) {
  const { value: workflow } = await api.json('actions/workflows/' + file);
  demand(id(workflow?.id) && workflow.path === '.github/workflows/' + file && workflow.state === 'active',
    'RELEASE_ORIGIN_WORKFLOW_NOT_INSTALLED');
  if (file !== 'keeper-canonical-native.yml') await workflowSource(api, file, source);
  const runs = await list(api, 'actions/workflows/' + workflow.id +
    '/runs?branch=sprint&event=' + event + '&head_sha=' + source, 'workflow_runs');
  demand(runs.length > 0, 'RELEASE_ORIGIN_RUN_MISSING');
  const selected = Math.max(...runs.map(row => row.id)), { value: run } = await api.json('actions/runs/' + selected);
  demand(run.id === selected && run.workflow_id === workflow.id && run.path === workflow.path &&
    run.head_sha === source && run.head_branch === 'sprint' && run.event === event &&
    id(run.run_attempt) && id(run.check_suite_id) && run.status === 'completed' &&
    (file === 'test.yml' ? ['success', 'failure'].includes(run.conclusion) : run.conclusion === 'success') &&
    run.repository?.id === REPOSITORY_ID && run.repository.full_name === REPOSITORY &&
    run.head_repository?.id === REPOSITORY_ID && run.head_repository.full_name === REPOSITORY &&
    runs.some(row => row.id === run.id && row.head_sha === source && row.run_attempt === run.run_attempt) &&
    Number.isFinite(Date.parse(run.updated_at)) && Date.parse(run.updated_at) <= now &&
    Date.parse(run.updated_at) >= now - 86400000, 'RELEASE_ORIGIN_RUN_INVALID');
  const { value: suite } = await api.json('check-suites/' + run.check_suite_id);
  demand(suite.id === run.check_suite_id && suite.head_sha === source && actionsApp(suite),
    'RELEASE_ORIGIN_SUITE_INVALID');
  const jobs = await list(api, 'actions/runs/' + run.id + '/attempts/' + run.run_attempt + '/jobs', 'jobs');
  const evidence = [];
  if (file === 'test.yml') {
    demand(jobs.length === TEST_JOBS.length && TEST_JOBS.every(name => jobs.filter(j => j.name === name).length === 1),
      'RELEASE_ORIGIN_TEST_JOBS_UNREVIEWED');
    for (const job of jobs) evidence.push(await jobIdentity(api, job, run, source,
      job.name !== 'Automatic backup native Realm and Relay'));
    const tests = jobs.find(job => job.name === 'Tests');
    for (const name of TEST_STEPS) {
      const selected = tests.steps?.filter(step => step.name === name);
      demand(selected?.length === 1 && selected[0].status === 'completed' &&
        selected[0].conclusion === 'success', 'RELEASE_ORIGIN_TEST_STEP_FAILED');
    }
    demand(run.conclusion === (jobs.some(j => j.conclusion === 'failure') ? 'failure' : 'success'),
      'RELEASE_ORIGIN_TEST_RUN_CONTRADICTION');
  } else if (file === 'codeql.yml') {
    demand(jobs.length === 1 && jobs[0].name === 'Analyze JavaScript/TypeScript', 'RELEASE_ORIGIN_CODEQL_JOB_INVALID');
    evidence.push(await jobIdentity(api, jobs[0], run, source, true));
    for (const name of CODEQL_STEPS) {
      const selected = jobs[0].steps?.filter(step => step.name === name);
      demand(selected?.length === 1 && selected[0].status === 'completed' &&
        selected[0].conclusion === 'success', 'RELEASE_ORIGIN_CODEQL_STEP_FAILED');
    }
  }
  return { workflow_id: workflow.id, run, jobs: evidence };
}
async function workerIdentity(api, context, request, options) {
  const now = (options.clock || Date.now)();
  demand(['plan', 'revalidate', 'execute'].includes(options.stage) && id(options.workerAttempt),
    'RELEASE_ORIGIN_WORKER_CONTEXT_INVALID');
  const { value: workflow } = await api.json('actions/workflows/keeper-protected-release-workers.yml');
  const { value: run } = await api.json('actions/runs/' + context.runId);
  demand(id(workflow?.id) && workflow.path === '.github/workflows/keeper-protected-release-workers.yml' &&
    workflow.state === 'active' && run.id === context.runId && run.workflow_id === workflow.id &&
    run.run_attempt === options.workerAttempt && run.head_sha === request.driverSha &&
    run.head_branch === 'sprint' && run.event === 'workflow_dispatch' &&
    run.path === workflow.path && run.status === 'in_progress' && run.conclusion === null &&
    Number.isFinite(Date.parse(run.updated_at)) && Date.parse(run.updated_at) <= now &&
    Date.parse(run.updated_at) >= now - 86400000 &&
    run.repository?.id === REPOSITORY_ID && run.repository.full_name === REPOSITORY &&
    run.head_repository?.id === REPOSITORY_ID && run.head_repository.full_name === REPOSITORY,
  'RELEASE_ORIGIN_WORKER_RUN_INVALID');
  const { value: suite } = await api.json('check-suites/' + run.check_suite_id);
  demand(suite.id === run.check_suite_id && suite.head_sha === request.driverSha && actionsApp(suite),
    'RELEASE_ORIGIN_WORKER_SUITE_INVALID');
  const jobs = await list(api, 'actions/runs/' + run.id + '/attempts/' + run.run_attempt + '/jobs', 'jobs');
  const name = options.stage === 'plan' ? 'plan' : 'approved-operation';
  demand(context.job === name && jobs.every(row => ['plan', 'approved-operation'].includes(row.name)) &&
    new Set(jobs.map(row => row.name)).size === jobs.length, 'RELEASE_ORIGIN_WORKER_JOBS_INVALID');
  const selected = jobs.filter(row => row.name === name);
  demand(selected.length === 1 && id(selected[0].id) && selected[0].run_id === run.id &&
    selected[0].run_attempt === run.run_attempt && selected[0].head_sha === request.driverSha &&
    selected[0].status === 'in_progress' && selected[0].conclusion === null,
  'RELEASE_ORIGIN_WORKER_JOB_INVALID');
  const match = selected[0].check_run_url?.match(/^https:\/\/api\.github\.com\/repos\/KeeperCommunity\/bitcoin-keeper\/check-runs\/([1-9]\d*)$/);
  demand(match && id(Number(match[1])), 'RELEASE_ORIGIN_WORKER_CHECK_INVALID');
  const { value: check } = await api.json('check-runs/' + match[1]);
  demand(check.id === Number(match[1]) && check.name === name && check.check_suite?.id === suite.id &&
    check.head_sha === request.driverSha && check.status === 'in_progress' && check.conclusion === null &&
    actionsApp(check), 'RELEASE_ORIGIN_WORKER_CHECK_INVALID');
  return { run_id: run.id, run_attempt: run.run_attempt, workflow_id: workflow.id,
    job_id: selected[0].id, check_run_id: check.id, job: name };
}
function securityPolicy(sarif, analysis) {
  demand(object(sarif) && sarif.version === '2.1.0' && Array.isArray(sarif.runs) && sarif.runs.length === 1,
    'RELEASE_ORIGIN_SARIF_INCOMPLETE');
  const run = sarif.runs[0], driver = run?.tool?.driver;
  demand(driver?.name === 'CodeQL' && analysis.tool?.name === 'CodeQL' &&
    typeof analysis.tool.version === 'string' && analysis.tool.version.length > 0 &&
    [driver.version, driver.semanticVersion].some(v => v === analysis.tool.version) &&
    [driver.version, driver.semanticVersion].every(v => v === undefined || v === analysis.tool.version) &&
    (run.automationDetails === undefined || run.automationDetails?.id === CODEQL_CATEGORY) &&
    Array.isArray(driver.rules) && driver.rules.length <= analysis.rules_count &&
    Array.isArray(run.results) && run.results.length === analysis.results_count && run.results.length <= 10000,
  'RELEASE_ORIGIN_SARIF_IDENTITY_INVALID');
  const extensions = run.tool.extensions ?? [];
  demand(Array.isArray(extensions) && extensions.length <= 100, 'RELEASE_ORIGIN_SARIF_RULE_INVALID');
  const components = [driver, ...extensions];
  for (const component of components) demand(Array.isArray(component.rules) && component.rules.length <= analysis.rules_count &&
    component.rules.every(rule => object(rule) && typeof rule.id === 'string' && rule.id.length > 0 && rule.id.length <= 4096) &&
    new Set(component.rules.map(rule => rule.id)).size === component.rules.length, 'RELEASE_ORIGIN_SARIF_RULE_INVALID');
  let high = 0, medium = 0, low = 0, quality = 0;
  for (const result of run.results) {
    demand(object(result) && (result.kind === undefined || result.kind === 'fail') &&
      (result.suppressions === undefined || (Array.isArray(result.suppressions) && result.suppressions.length === 0)),
    'RELEASE_ORIGIN_SARIF_RESULT_UNRESOLVED');
    let component = driver;
    if (result.rule?.toolComponent !== undefined) {
      const ref = result.rule.toolComponent;
      demand(object(ref) && Number.isSafeInteger(ref.index) && ref.index >= 0 && ref.index < extensions.length,
        'RELEASE_ORIGIN_SARIF_RULE_INVALID');
      component = extensions[ref.index];
      demand((ref.name === undefined || ref.name === component.name) &&
        (ref.guid === undefined || ref.guid === component.guid), 'RELEASE_ORIGIN_SARIF_RULE_INVALID');
    }
    const candidates = [];
    if (result.ruleIndex !== undefined) {
      demand(Number.isSafeInteger(result.ruleIndex) && result.ruleIndex >= 0 && result.ruleIndex < driver.rules.length,
        'RELEASE_ORIGIN_SARIF_RULE_INVALID');
      candidates.push(driver.rules[result.ruleIndex]);
    }
    if (result.rule?.index !== undefined) {
      demand(Number.isSafeInteger(result.rule.index) && result.rule.index >= 0 && result.rule.index < component.rules.length,
        'RELEASE_ORIGIN_SARIF_RULE_INVALID');
      candidates.push(component.rules[result.rule.index]);
    }
    const wanted = result.rule?.id ?? result.ruleId;
    if (wanted !== undefined) {
      demand(typeof wanted === 'string' && (result.ruleId === undefined || result.ruleId === wanted),
        'RELEASE_ORIGIN_SARIF_RULE_INVALID');
      const matches = component.rules.filter(rule => rule.id === wanted);
      demand(matches.length === 1, 'RELEASE_ORIGIN_SARIF_RULE_INVALID'); candidates.push(matches[0]);
    }
    demand(candidates.length > 0 && candidates.every(rule => rule.id === candidates[0].id &&
      equal(rule.properties, candidates[0].properties)), 'RELEASE_ORIGIN_SARIF_RULE_INVALID');
    const rule = candidates[0], properties = rule.properties;
    demand(object(properties) && Array.isArray(properties.tags) &&
      properties.tags.every(tag => typeof tag === 'string'), 'RELEASE_ORIGIN_SARIF_SECURITY_METADATA_MISSING');
    const raw = properties['security-severity'], tagged = properties.tags.includes('security');
    if (raw !== undefined || tagged) {
      demand(typeof raw === 'string' && /^(?:10(?:\.0+)?|[0-9](?:\.\d+)?)$/.test(raw),
        'RELEASE_ORIGIN_SARIF_SECURITY_METADATA_MISSING');
      const score = Number(raw);
      if (score >= 7) high++; else if (score >= 4) medium++; else low++;
    } else quality++;
  }
  demand(high === 0, 'RELEASE_ORIGIN_SECURITY_POLICY_FAILED');
  return frozen({ policy: 'CODEQL_EXACT_ANALYSIS_NO_HIGH_OR_CRITICAL_V1', results: run.results.length,
    high_or_critical: high, medium, low, quality });
}
async function security(api, codeql, source, now) {
  const checks = await list(api, 'commits/' + source + '/check-runs?filter=all', 'check_runs');
  const gas = checks.filter(row => row.name === 'CodeQL');
  demand(gas.length > 0 && gas.every(row => id(row.id) && row.head_sha === source && row.status === 'completed' &&
    row.conclusion === 'success' && row.app?.id === 57789 && row.app.slug === 'github-advanced-security'),
  'RELEASE_ORIGIN_SECURITY_CHECK_NOT_SUCCESS');
  const artifacts = await list(api, 'actions/runs/' + codeql.run.id + '/artifacts', 'artifacts');
  const name = 'keeper-codeql-analysis-' + source + '-' + codeql.run.id + '-' + codeql.run.run_attempt;
  const found = artifacts.filter(row => row.name === name);
  demand(found.length === 1, 'RELEASE_ORIGIN_CODEQL_ARTIFACT_INVALID');
  const { value: info } = await api.json('actions/artifacts/' + found[0].id);
  demand(info.id === found[0].id && info.name === name && info.expired === false &&
    id(info.size_in_bytes) && info.size_in_bytes <= MAX_ARCHIVE && /^sha256:[a-f0-9]{64}$/.test(info.digest || '') &&
    info.workflow_run?.id === codeql.run.id && info.workflow_run.head_sha === source &&
    Date.parse(info.expires_at) > now, 'RELEASE_ORIGIN_CODEQL_ARTIFACT_INVALID');
  const archive = await api.archive(info.id, info.size_in_bytes);
  demand('sha256:' + digest(archive) === info.digest, 'RELEASE_ORIGIN_CODEQL_ARTIFACT_DIGEST');
  const raw = unpackReadOnlyArtifact(archive, 'analysis.json'), receipt = parseStrictJson(raw, 65536);
  const fields = ['schema', 'kind', 'repository', 'source_sha', 'source_ref', 'workflow_sha', 'workflow_path',
    'run_id', 'run_attempt', 'analysis_key', 'category', 'sarif_id'];
  demand(object(receipt) && Object.keys(receipt).length === fields.length && fields.every(k => Object.hasOwn(receipt, k)) &&
    receipt.schema === 1 && receipt.kind === 'keeper-codeql-upload' && receipt.repository === REPOSITORY &&
    receipt.source_sha === source && receipt.source_ref === 'refs/heads/sprint' && receipt.workflow_sha === source &&
    receipt.workflow_path === '.github/workflows/codeql.yml' && receipt.run_id === codeql.run.id &&
    receipt.run_attempt === codeql.run.run_attempt && receipt.analysis_key === '.github/workflows/codeql.yml:analyze' &&
    receipt.category === CODEQL_CATEGORY && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(receipt.sarif_id || ''),
  'RELEASE_ORIGIN_CODEQL_UPLOAD_RECEIPT_INVALID');
  const { value: processing } = await api.json('code-scanning/sarifs/' + receipt.sarif_id);
  demand(processing.processing_status === 'complete' && (processing.errors == null ||
    (Array.isArray(processing.errors) && processing.errors.length === 0)), 'RELEASE_ORIGIN_CODEQL_PROCESSING');
  const endpoint = 'code-scanning/analyses?sarif_id=' + receipt.sarif_id +
    '&ref=refs%2Fheads%2Fsprint&tool_name=CodeQL&per_page=100';
  const { value: analyses, headers } = await api.json(endpoint);
  demand(Array.isArray(analyses) && analyses.length === 1 && !/rel="next"/.test(headers.get('link') || '') &&
    id(analyses[0].id), 'RELEASE_ORIGIN_CODEQL_ANALYSIS_AMBIGUOUS');
  const { value: analysis } = await api.json('code-scanning/analyses/' + analyses[0].id);
  demand(equal(analyses[0], analysis) && analysis.commit_sha === source && analysis.ref === 'refs/heads/sprint' &&
    analysis.sarif_id === receipt.sarif_id && analysis.analysis_key === receipt.analysis_key &&
    analysis.category === CODEQL_CATEGORY && ['{}', 'null'].includes(analysis.environment) &&
    analysis.tool?.name === 'CodeQL' && analysis.error === '' && analysis.warning === '' &&
    id(analysis.rules_count) && analysis.rules_count <= 20000 && Number.isSafeInteger(analysis.results_count) &&
    analysis.results_count >= 0 && analysis.results_count <= 10000, 'RELEASE_ORIGIN_CODEQL_ANALYSIS_INVALID');
  const sarifBytes = await api.raw('code-scanning/analyses/' + analysis.id, 'application/sarif+json', MAX_SARIF);
  const policy = securityPolicy(parseStrictJson(sarifBytes.payload, MAX_SARIF), analysis);
  const { value: after } = await api.json('code-scanning/analyses/' + analysis.id);
  const { value: artifactAfter } = await api.json('actions/artifacts/' + info.id);
  demand(equal(after, analysis) && equal(artifactAfter, info), 'RELEASE_ORIGIN_SECURITY_CHANGED');
  return frozen({ gas_check_ids: gas.map(row => row.id).sort((a, b) => a - b), analysis_id: analysis.id,
    sarif_id: receipt.sarif_id, analysis_receipt_sha256: digest(raw), sarif_sha256: digest(sarifBytes.payload), policy,
    direct_analysis_result_binding_verified: true, gas_analysis_join_verified: false });
}
async function collectCurrentReleaseOrigin(github, context, request, options = {}) {
  try {
    const bound = snapshot(request), now = (options.clock || Date.now)();
    demand(OPERATIONS.has(request.operation) && request.repository === REPOSITORY && request.ref === 'refs/heads/sprint' &&
      SHA.test(request.sourceSha) && request.sourceSha === request.driverSha && request.sourceSha === context.sha &&
      context.eventName === 'workflow_dispatch' && context.ref === 'refs/heads/sprint' &&
      context.repo?.owner + '/' + context.repo?.repo === REPOSITORY && id(context.runId),
    'RELEASE_ORIGIN_CURRENT_INSTALLED_SOURCE_REQUIRED');
    const api = sdk(github, options.fetchImpl), source = request.sourceSha;
    const worker = await workerIdentity(api, context, request, options);
    const canonicalRun = await producer(api, 'keeper-canonical-native.yml', 'workflow_dispatch', source, now);
    const ctx = { ...context, sha: source, runId: canonicalRun.run.id };
    const nativeRequest = canonical.requestFromEnvironment(ctx, { KEEPER_SOURCE_SHA: source,
      GITHUB_WORKFLOW_SHA: source, GITHUB_WORKFLOW_REF: REPOSITORY + '/.github/workflows/keeper-canonical-native.yml@refs/heads/sprint',
      KEEPER_CANONICAL_NATIVE_DRIVER_SHA: source, GITHUB_RUN_ID: String(canonicalRun.run.id),
      GITHUB_RUN_ATTEMPT: String(canonicalRun.run.run_attempt) });
    const publicProof = await canonical.collectInstalledPublicEvidence(github, ctx, nativeRequest,
      canonical.readMetadataZip, { pinReader: options.pinReader });
    const parentProof = await parents.collectInstalledParentSoftware(options.privateGithub, github, ctx,
      nativeRequest, publicProof, { pinReader: options.pinReader, clock: options.clock, fetchImpl: options.fetchImpl });
    demand(canonical.isInstalledPublicEvidence(publicProof) && parents.isInstalledParentSoftware(parentProof),
      'RELEASE_ORIGIN_NATIVE_CAPABILITIES_REQUIRED');
    const platforms = parents.projectInstalledParentCases(publicProof, parentProof);
    demand(['IOS', 'ANDROID'].every(p => platforms[p]?.cases?.length === 7 &&
      platforms[p].cases.every(row => row.status === 'PASS') &&
      Object.values(platforms[p].executed_checks).every(row => row.status === 'PASS')),
    'RELEASE_ORIGIN_NATIVE_MATRIX_INCOMPLETE');
    const tests = await producer(api, 'test.yml', 'push', source, now);
    const codeql = await producer(api, 'codeql.yml', 'push', source, now);
    const securityProof = await security(api, codeql, source, now);
    // Security/native download work cannot preserve an expired earlier authority.
    demand(equal(await producer(api, 'test.yml', 'push', source, (options.clock || Date.now)()), tests) &&
      equal(await producer(api, 'codeql.yml', 'push', source, (options.clock || Date.now)()), codeql) &&
      equal(await producer(api, 'keeper-canonical-native.yml', 'workflow_dispatch', source, (options.clock || Date.now)()), canonicalRun),
    'RELEASE_ORIGIN_PRODUCER_CHANGED');
    demand(equal(await security(api, codeql, source, (options.clock || Date.now)()), securityProof),
      'RELEASE_ORIGIN_SECURITY_CHANGED');
    await canonical.revalidateInstalledPublicEvidence(github, ctx, nativeRequest, publicProof,
      { pinReader: options.pinReader, clock: options.clock });
    // Refresh private/window capabilities too; do not reuse a serialized old parent.
    const currentParents = await parents.collectInstalledParentSoftware(options.privateGithub, github, ctx,
      nativeRequest, publicProof, { pinReader: options.pinReader, clock: options.clock, fetchImpl: options.fetchImpl });
    demand(parents.isInstalledParentSoftware(currentParents) && equal(currentParents, parentProof),
      'RELEASE_ORIGIN_PRIVATE_WINDOW_CHANGED');
    demand(equal(await workerIdentity(api, context, request, options), worker), 'RELEASE_ORIGIN_WORKER_CHANGED');
    await canonical.revalidateInstalledPublicEvidence(github, ctx, nativeRequest, publicProof,
      { pinReader: options.pinReader, clock: options.clock });
    const result = frozen({ schema: 1, kind: 'current-installed-release-source', repository: REPOSITORY,
      source_sha: source, source_tree: publicProof.source_tree, workflow_sha: request.driverSha, worker,
      canonical_run_id: canonicalRun.run.id, canonical_run_attempt: canonicalRun.run.run_attempt,
      tests: { run_id: tests.run.id, run_attempt: tests.run.run_attempt, jobs: tests.jobs,
        legacy_v2_characterization_not_release_credit: true },
      codeql: { run_id: codeql.run.id, run_attempt: codeql.run.run_attempt, jobs: codeql.jobs },
      security: securityProof, canonical_cases: 7, physical: 'NOT RUN / separate owner and device scope',
      operation_scope: 'SIGNED_BUILD_OR_INTERNAL_UPLOAD_ONLY',
      physical_acceptance: 'NOT_RUN_NOT_WAIVED', public_release_ready: false,
      authorization_eligible: false, release_authorized: false, execution_allowed: false });
    issued.set(result, bound); return result;
  } catch (error) { throw fixed(error); }
}
function isCurrentReleaseOrigin(proof, request) {
  try { return issued.get(proof) === snapshot(request); } catch { return false; }
}
module.exports = { collectCurrentReleaseOrigin, isCurrentReleaseOrigin, securityPolicy, sdk };
