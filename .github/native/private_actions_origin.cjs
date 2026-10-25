'use strict';
// Read-only private diagnostic origin. No installed/canonical/release authority.
const crypto = require('node:crypto');
const { parseStrictJson } = require('./strict_json.cjs');
const { RECOVERY_SOURCES } = require('./private_integration_receipts.cjs');
const { WORKER_SOURCES } = require('./public_software_receipts.cjs');
const PRIVATE = 'KeeperCommunity/bitcoin-keeper-relay', PRIVATE_ID = 496119449;
const APP = 'KeeperCommunity/bitcoin-keeper', APP_ID = 470904030;
const BACKEND = '29597b27eeeb299205bf7d0555db0a90c38cc4be';
const REVIEWED_DRIVER = '448e09d7a373fc7e9d9c540880b45e2c742997f7';
const WORKFLOW = '.github/workflows/r5-native-integration.yml';
const REF = 'refs/heads/codex/r5-native-integration-execution-20261022';
const POLICY = 'release/r5-native-integration/inputs.json';
const MARKER = 'release/r5-native-integration/native-request.json';
const MAX_AGE = 86400000, MAX_ARCHIVE = 12 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/, issued = new WeakSet();
const sha = value => typeof value === 'string' && SHA.test(value);
const instant = value => typeof value === 'string' ? Date.parse(value) : NaN;
// Final app/controller windows require separate source review and installation.
// No input, artifact, environment variable or API response may populate this.
const REVIEWED_WINDOWS = Object.freeze({});
const id = n => Number.isSafeInteger(n) && n > 0;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, names) => object(v) && Object.keys(v).sort().join('|') === [...names].sort().join('|');
const demand = (yes, code = 'PRIVATE_ACTIONS_ORIGIN_INVALID') => { if (!yes) throw new Error(code); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  return object(a) && object(b) && keys(a, Object.keys(b)) && Object.keys(a).every(k => equal(a[k], b[k]));
}
function frozen(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
const safePath = p => typeof p === 'string' && p.length <= 4096 && /^[A-Za-z0-9_./@+ -]+$/.test(p) &&
  !p.startsWith('/') && p.split('/').every(s => s && s !== '.' && s !== '..');
const api = repository => ({ owner: 'KeeperCommunity', repo: repository.split('/')[1], request: { timeout: 30000 } });
function data(r) { demand(r?.status === 200 && object(r.data) && !/rel="next"/.test(r.headers?.link || ''), 'PRIVATE_ACTIONS_API_INCOMPLETE'); return r.data; }
function complete(r, field) {
  const value = data(r);
  demand(id(value.total_count) && value.total_count <= 100 && Array.isArray(value[field]) &&
    value[field].length === value.total_count && new Set(value[field].map(v => v.id)).size === value.total_count &&
    value[field].every(v => id(v.id)), 'PRIVATE_ACTIONS_API_INCOMPLETE');
  return value[field];
}
function repository(value, name, number) { return value?.id === number && value.full_name === name; }
function descriptor(value, platform) {
  demand(keys(value, ['platform', 'app', 'control', 'backend', 'execution']) && value.platform === platform);
  for (const [name, repo] of [['app', APP], ['control', PRIVATE]]) demand(keys(value[name], ['repository', 'sha', 'tree']) &&
    value[name].repository === repo && sha(value[name].sha) && sha(value[name].tree));
  demand(keys(value.backend, ['repository', 'sha']) && value.backend.repository === PRIVATE && value.backend.sha === BACKEND);
  const e = value.execution;
  demand(keys(e, ['repository', 'workflowPath', 'workflowSha', 'ref', 'runId', 'runAttempt']) &&
    e.repository === PRIVATE && e.workflowPath === WORKFLOW && e.workflowSha === value.control.sha &&
    e.ref === REF && id(e.runId) && id(e.runAttempt));
  return value;
}
function tree(value, expected) {
  demand(value.sha === expected && value.truncated === false && Array.isArray(value.tree) &&
    value.tree.length > 0 && value.tree.length <= 20000, 'PRIVATE_ACTIONS_TREE_INVALID');
  const entries = new Map();
  for (const row of value.tree) {
    demand(safePath(row.path) && sha(row.sha) && !entries.has(row.path) &&
      ((row.type === 'tree' && row.mode === '040000') ||
       (row.type === 'blob' && ['100644', '100755'].includes(row.mode))), 'PRIVATE_ACTIONS_TREE_INVALID');
    entries.set(row.path, row);
  }
  return new Map([...entries].filter(([, row]) => row.type === 'blob').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
async function contents(github, repo, ref, name, inventory) {
  const value = data(await github.rest.repos.getContent({ ...api(repo), ref, path: name }));
  demand(value.type === 'file' && value.path === name && value.encoding === 'base64' &&
    id(value.size) && value.size <= 2_000_000 && sha(value.sha || '') && typeof value.content === 'string' &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(value.content), 'PRIVATE_ACTIONS_SOURCE_INVALID');
  const bytes = Buffer.from(value.content, 'base64');
  demand(bytes.length === value.size && bytes.toString('base64') === value.content.replace(/[\r\n]/g, '') &&
    crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') === value.sha &&
    (!inventory || inventory.get(name)?.sha === value.sha), 'PRIVATE_ACTIONS_SOURCE_INVALID');
  return bytes;
}
function fresh(run, now) {
  const updated = instant(run.updated_at);
  demand(Number.isFinite(now) && Number.isFinite(updated) && updated <= now && updated >= now - MAX_AGE,
    'PRIVATE_ACTIONS_RUN_STALE');
}
function runIdentity(run, value, workflow, now) {
  const e = value.execution;
  demand(run.id === e.runId && run.run_attempt === e.runAttempt && run.workflow_id === workflow.id &&
    run.path === WORKFLOW && run.event === 'push' && run.head_sha === value.control.sha && run.head_branch === REF.slice(11) &&
    repository(run.repository, PRIVATE, PRIVATE_ID) && repository(run.head_repository, PRIVATE, PRIVATE_ID) &&
    run.status === 'completed' && run.conclusion === 'success' && id(run.check_suite_id) &&
    (run.referenced_workflows === undefined || (Array.isArray(run.referenced_workflows) && run.referenced_workflows.length === 0)),
  'PRIVATE_ACTIONS_EXACT_RUN_REQUIRED');
  fresh(run, now);
}
function artifactIdentity(info, value, artifactId, now, selected) {
  const e = value.execution, name = `r5-integration-native-${value.platform}-${value.control.sha}-${e.runId}-${e.runAttempt}`;
  demand(info.id === artifactId && info.name === name && info.expired === false && id(info.size_in_bytes) && info.size_in_bytes <= MAX_ARCHIVE &&
    typeof info.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(info.digest) && instant(info.expires_at) > now &&
    info.workflow_run?.id === e.runId && info.workflow_run.head_sha === value.control.sha && info.workflow_run.head_branch === REF.slice(11) &&
    info.workflow_run.repository_id === PRIVATE_ID && info.workflow_run.head_repository_id === PRIVATE_ID &&
    instant(info.created_at) >= instant(selected.started_at) && instant(info.created_at) <= instant(selected.completed_at),
  'PRIVATE_ACTIONS_ARTIFACT_INVALID');
}
function stepNames(platform) {
  return ['Record actual shared native window start before checkout or build',
    'Check out exact private tooling and only required runtime modules', 'Fetch fixed public app anonymously',
    'Set up reviewed Node runtime', 'Verify bounded exact source before installation',
    'Install frozen backend dependencies without scripts', 'Set up Java17',
    'Record actual hosted toolchain', 'Install immutable native app dependencies and synthetic configuration',
    'Verify exact sources after dependency preparation',
    ...(platform === 'IOS' ? ['Set up Ruby for hosted iOS', 'Select reviewed Xcode16.4',
      'Check hosted iOS driver before the app build'] : ['Set up Android tools', 'Enable owned Android emulator acceleration']),
    'Start only this run\'s pinned owned loopback Mongo replica', 'Characterize the actual fixture and source contracts',
    'Build one unsigned development native candidate', platform === 'IOS' ?
      'Run one iOS startup then public phases and three serial private suites' :
      'Run one Android startup then public phases and three serial private suites',
    'Verify exact source after native attempts', 'Remove only this run\'s owned Mongo runtime', 'Retain metadata only'];
}
async function selectedJob(github, value, run, now) {
  const { platform, control, execution: e } = value, args = api(PRIVATE);
  const suite = data(await github.rest.checks.getSuite({ ...args, check_suite_id: run.check_suite_id }));
  demand(suite.id === run.check_suite_id && suite.head_sha === control.sha && suite.status === 'completed' &&
    suite.conclusion === 'success' && suite.app?.id === 15368 && suite.app.slug === 'github-actions', 'PRIVATE_ACTIONS_SUITE_INVALID');
  const jobs = complete(await github.rest.actions.listJobsForWorkflowRunAttempt({ ...args, run_id: e.runId,
    attempt_number: e.runAttempt, per_page: 100 }), 'jobs');
  demand(jobs.length === 1, 'PRIVATE_ACTIONS_JOB_INVALID');
  const job = jobs[0], match = job.check_run_url?.match(/^https:\/\/api\.github\.com\/repos\/KeeperCommunity\/bitcoin-keeper-relay\/check-runs\/([1-9]\d*)$/);
  demand(job.name === 'native' && job.run_id === e.runId && job.run_attempt === e.runAttempt && job.head_sha === control.sha &&
    job.status === 'completed' && job.conclusion === 'success' && match && id(Number(match[1])) &&
    Array.isArray(job.labels) && job.labels.includes(platform === 'IOS' ? 'macos-15' : 'ubuntu-24.04') &&
    !job.labels.includes('self-hosted') && instant(job.started_at) > 0 &&
    instant(job.completed_at) > instant(job.started_at) && instant(job.completed_at) <= now, 'PRIVATE_ACTIONS_JOB_INVALID');
  for (const name of stepNames(platform)) {
    const found = job.steps?.filter(s => s.name === name) || [];
    demand(found.length === 1 && found[0].status === 'completed' && found[0].conclusion === 'success', 'PRIVATE_ACTIONS_STEP_INVALID');
  }
  const other = platform === 'IOS' ? 'Run one Android startup then public phases and three serial private suites' :
    'Run one iOS startup then public phases and three serial private suites';
  const skipped = job.steps?.filter(s => s.name === other) || [];
  demand(skipped.length === 1 && skipped[0].status === 'completed' && skipped[0].conclusion === 'skipped', 'PRIVATE_ACTIONS_SELECTED_PLATFORM_INVALID');
  const check = data(await github.rest.checks.get({ ...args, check_run_id: Number(match[1]) }));
  demand(check.id === Number(match[1]) && check.name === job.name && check.check_suite?.id === run.check_suite_id &&
    check.head_sha === control.sha && check.status === 'completed' && check.conclusion === 'success' &&
    check.app?.id === 15368 && check.app.slug === 'github-actions', 'PRIVATE_ACTIONS_CHECK_INVALID');
  return { check_suite_id: suite.id, job_id: job.id, check_run_id: check.id, started_at: job.started_at, completed_at: job.completed_at };
}
async function windowOrigin(github, value, workflow, backendTree, baselinePolicy, now) {
  const { platform, control, execution: e, app } = value, args = api(PRIVATE);
  const runs = complete(await github.rest.actions.listWorkflowRuns({ ...args, workflow_id: workflow.id,
    head_sha: control.sha, branch: REF.slice(11), event: 'push', per_page: 100 }), 'workflow_runs');
  demand(Math.max(...runs.map(r => r.id)) === e.runId, 'PRIVATE_ACTIONS_LATEST_RUN_REQUIRED');
  const [run, commit, rawTree] = await Promise.all([
    github.rest.actions.getWorkflowRun({ ...args, run_id: e.runId }).then(data),
    github.rest.git.getCommit({ ...args, commit_sha: control.sha }).then(data),
    github.rest.git.getTree({ ...args, tree_sha: control.sha, recursive: '1' }).then(data),
  ]);
  runIdentity(run, value, workflow, now);
  demand(runs.some(r => r.id === run.id && r.run_attempt === run.run_attempt && r.head_sha === run.head_sha), 'PRIVATE_ACTIONS_EXACT_RUN_REQUIRED');
  demand(commit.sha === control.sha && commit.tree?.sha === control.tree &&
    commit.message?.split('\n')[0] === `ci(r5): run combined native ${platform}` &&
    Array.isArray(commit.parents) && commit.parents.length === 1 && sha(commit.parents[0].sha), 'PRIVATE_ACTIONS_CONTROL_COMMIT_INVALID');
  const controlTree = tree(rawTree, control.tree);
  demand(controlTree.get(MARKER)?.mode === '100644', 'PRIVATE_ACTIONS_MARKER_INVALID');
  const [markerBytes, policyBytes, workflowBytes] = await Promise.all([MARKER, POLICY, WORKFLOW].map(name =>
    contents(github, PRIVATE, control.sha, name, controlTree)));
  const marker = parseStrictJson(markerBytes, 8192), policy = parseStrictJson(policyBytes, 131072);
  demand(keys(marker, ['schema', 'app_sha', 'platform']) && marker.schema === 1 && marker.app_sha === app.sha && marker.platform === platform,
    'PRIVATE_ACTIONS_MARKER_INVALID');
  demand(policy.schema === 1 && policy.app_sha === app.sha && policy.app_tree === app.tree && policy.backend_base === BACKEND &&
    equal(policy.control_paths, baselinePolicy.control_paths) && equal(policy.materialized_control_paths, baselinePolicy.materialized_control_paths) &&
    Array.isArray(policy.control_paths) && new Set(policy.control_paths).size === policy.control_paths.length &&
    policy.control_paths.every(safePath) && policy.materialized_control_paths.every(p => controlTree.has(p)), 'PRIVATE_ACTIONS_POLICY_INVALID');
  const allowed = new Set(policy.control_paths), paths = new Set([...backendTree.keys(), ...controlTree.keys()]);
  for (const p of paths) demand((controlTree.get(p)?.sha === backendTree.get(p)?.sha &&
    controlTree.get(p)?.mode === backendTree.get(p)?.mode) || allowed.has(p), 'PRIVATE_ACTIONS_BACKEND_DELTA_INVALID');
  // The reviewed control commit selects the app itself; the artifact cannot choose it.
  const workflowText = workflowBytes.toString('utf8');
  demand(workflowText.includes(`KEEPER_SOURCE_SHA: ${app.sha}`) &&
    workflowText.includes(`origin ${app.sha}`) && workflowText.includes(`--detach ${app.sha}`), 'PRIVATE_ACTIONS_APP_SELECTION_INVALID');
  const selected = await selectedJob(github, value, run, now);
  const artifacts = complete(await github.rest.actions.listWorkflowRunArtifacts({ ...args, run_id: e.runId, per_page: 100 }), 'artifacts');
  const name = `r5-integration-native-${platform}-${control.sha}-${e.runId}-${e.runAttempt}`;
  const found = artifacts.filter(a => a.name === name);
  demand(found.length === 1, 'PRIVATE_ACTIONS_ARTIFACT_INVALID');
  const info = data(await github.rest.actions.getArtifact({ ...args, artifact_id: found[0].id }));
  artifactIdentity(info, value, found[0].id, now, selected);
  return { descriptor: value, run_updated_at: run.updated_at, workflow_id: workflow.id, ...selected, artifact: { id: info.id, name: info.name, size: info.size_in_bytes,
      sha256: info.digest.slice(7), expires_at: info.expires_at, created_at: info.created_at }, workflow_source_sha256: digest(workflowBytes),
    policy_source_sha256: digest(policyBytes), marker_source_sha256: digest(markerBytes),
    parent: commit.parents[0].sha, controlTree };
}
async function authenticatePrivateActionsOrigins(github, supplied, { clock = Date.now } = {}) {
  try {
    demand(keys(supplied, ['IOS', 'ANDROID']));
    // Snapshot caller expectations; never populate them from a receipt or API response.
    const expected = JSON.parse(JSON.stringify(supplied));
    for (const p of ['IOS', 'ANDROID']) descriptor(expected[p], p);
    demand(equal(expected.IOS.app, expected.ANDROID.app) && equal(expected.IOS.backend, expected.ANDROID.backend) &&
      expected.IOS.control.sha !== expected.ANDROID.control.sha && expected.IOS.execution.runId !== expected.ANDROID.execution.runId);
    const args = api(PRIVATE), appArgs = api(APP), app = expected.IOS.app;
    const [privateRepo, appRepo, branch, workflow, appCommit, appRawTree, backendCommit, backendRawTree, policyBytes] = await Promise.all([
      github.rest.repos.get(args).then(data), github.rest.repos.get(appArgs).then(data),
      github.rest.repos.getBranch({ ...args, branch: REF.slice(11) }).then(data),
      github.rest.actions.getWorkflow({ ...args, workflow_id: 'r5-native-integration.yml' }).then(data),
      github.rest.git.getCommit({ ...appArgs, commit_sha: app.sha }).then(data),
      github.rest.git.getTree({ ...appArgs, tree_sha: app.sha, recursive: '1' }).then(data),
      github.rest.git.getCommit({ ...args, commit_sha: BACKEND }).then(data),
      github.rest.git.getTree({ ...args, tree_sha: BACKEND, recursive: '1' }).then(data),
      contents(github, PRIVATE, REVIEWED_DRIVER, POLICY),
    ]);
    demand(repository(privateRepo, PRIVATE, PRIVATE_ID) && privateRepo.private === true && repository(appRepo, APP, APP_ID) &&
      appRepo.private === false, 'PRIVATE_ACTIONS_REPOSITORY_INVALID');
    demand(branch.name === REF.slice(11) && [expected.IOS.control.sha, expected.ANDROID.control.sha].includes(branch.commit?.sha),
      'PRIVATE_ACTIONS_BRANCH_MOVED');
    demand(id(workflow.id) && workflow.path === WORKFLOW && workflow.state === 'active', 'PRIVATE_ACTIONS_WORKFLOW_INVALID');
    demand(appCommit.sha === app.sha && appCommit.tree?.sha === app.tree && backendCommit.sha === BACKEND && sha(backendCommit.tree?.sha || ''),
      'PRIVATE_ACTIONS_COMMIT_INVALID');
    const appTree = tree(appRawTree, app.tree), backendTree = tree(backendRawTree, backendCommit.tree.sha);
    const baselinePolicy = parseStrictJson(policyBytes, 131072);
    const rows = {};
    for (const p of ['IOS', 'ANDROID']) rows[p] = await windowOrigin(github, expected[p], workflow, backendTree, baselinePolicy, clock());
    const current = rows.IOS.descriptor.control.sha === branch.commit.sha ? rows.IOS : rows.ANDROID;
    const previous = current === rows.IOS ? rows.ANDROID : rows.IOS;
    demand(current.parent === previous.descriptor.control.sha, 'PRIVATE_ACTIONS_CONTROL_ANCESTRY_INVALID');
    demand(instant(current.started_at) >= instant(previous.completed_at), 'PRIVATE_ACTIONS_NATIVE_WINDOWS_OVERLAP');
    const left = [...rows.IOS.controlTree].filter(([p]) => p !== MARKER).map(([p, v]) => [p, v.mode, v.sha]);
    const right = [...rows.ANDROID.controlTree].filter(([p]) => p !== MARKER).map(([p, v]) => [p, v.mode, v.sha]);
    demand(equal(left, right), 'PRIVATE_ACTIONS_CONTROL_EQUIVALENCE_INVALID');
    const sourceBytes = new Map(), workerSources = [], recoverySources = [];
    for (const name of new Set([...RECOVERY_SOURCES, ...Object.keys(WORKER_SOURCES)]))
      sourceBytes.set(name, await contents(github, APP, app.sha, name, appTree));
    for (const name of RECOVERY_SOURCES) recoverySources.push(Object.freeze({ path: name, sha256: digest(sourceBytes.get(name)) }));
    for (const [name, names] of Object.entries(WORKER_SOURCES)) workerSources.push(Object.freeze({ path: name,
      sha256: digest(sourceBytes.get(name)), names: Object.freeze([...names]) }));
    // Source retrieval is network work. Revoke a moved branch, later failed run,
    // rerun or changed artifact before issuing even this diagnostic-only origin.
    for (const p of ['IOS', 'ANDROID']) {
      const row = rows[p], e = expected[p].execution;
      const latest = complete(await github.rest.actions.listWorkflowRuns({ ...args, workflow_id: workflow.id,
        head_sha: expected[p].control.sha, branch: REF.slice(11), event: 'push', per_page: 100 }), 'workflow_runs');
      const run = data(await github.rest.actions.getWorkflowRun({ ...args, run_id: e.runId }));
      demand(Math.max(...latest.map(r => r.id)) === e.runId && run.check_suite_id === row.check_suite_id &&
        latest.some(r => r.id === e.runId && r.run_attempt === e.runAttempt && r.head_sha === expected[p].control.sha), 'PRIVATE_ACTIONS_EXACT_RUN_REQUIRED');
      runIdentity(run, expected[p], workflow, clock());
      demand(equal(await selectedJob(github, expected[p], run, clock()), { check_suite_id: row.check_suite_id,
        job_id: row.job_id, check_run_id: row.check_run_id, started_at: row.started_at, completed_at: row.completed_at }), 'PRIVATE_ACTIONS_JOB_CHANGED');
      const currentArtifacts = complete(await github.rest.actions.listWorkflowRunArtifacts({ ...args, run_id: e.runId, per_page: 100 }), 'artifacts');
      const selected = currentArtifacts.filter(a => a.name === row.artifact.name);
      demand(selected.length === 1 && selected[0].id === row.artifact.id,
        'PRIVATE_ACTIONS_ARTIFACT_INVALID');
      const currentArtifact = data(await github.rest.actions.getArtifact({ ...args, artifact_id: row.artifact.id }));
      artifactIdentity(currentArtifact, expected[p], row.artifact.id, clock(), row);
      demand(currentArtifact.digest === `sha256:${row.artifact.sha256}` && currentArtifact.size_in_bytes === row.artifact.size &&
        currentArtifact.expires_at === row.artifact.expires_at && currentArtifact.created_at === row.artifact.created_at,
      'PRIVATE_ACTIONS_ARTIFACT_INVALID');
    }
    // Artifact readbacks above are network work too. Perform a terminal current
    // window fence AFTER all of them, with no subsequent API reads before issue.
    const [lastBranch, lastWorkflow, lastRepo, ...lastRuns] = await Promise.all([
      github.rest.repos.getBranch({ ...args, branch: REF.slice(11) }).then(data),
      github.rest.actions.getWorkflow({ ...args, workflow_id: 'r5-native-integration.yml' }).then(data),
      github.rest.repos.get(args).then(data),
      ...['IOS', 'ANDROID'].flatMap(p => {
        const e = expected[p].execution;
        return [github.rest.actions.listWorkflowRuns({ ...args, workflow_id: workflow.id, head_sha: expected[p].control.sha,
          branch: REF.slice(11), event: 'push', per_page: 100 }).then(r => complete(r, 'workflow_runs')),
        github.rest.actions.getWorkflowRun({ ...args, run_id: e.runId }).then(data)];
      }),
    ]);
    demand(lastBranch.name === branch.name && lastBranch.commit?.sha === branch.commit.sha, 'PRIVATE_ACTIONS_BRANCH_MOVED');
    demand(lastWorkflow.id === workflow.id && lastWorkflow.path === WORKFLOW && lastWorkflow.state === 'active', 'PRIVATE_ACTIONS_WORKFLOW_INVALID');
    demand(repository(lastRepo, PRIVATE, PRIVATE_ID) && lastRepo.private === true, 'PRIVATE_ACTIONS_REPOSITORY_INVALID');
    ['IOS', 'ANDROID'].forEach((p, index) => {
      const [latest, run] = lastRuns.slice(index * 2, index * 2 + 2), e = expected[p].execution;
      demand(Math.max(...latest.map(r => r.id)) === e.runId && run.check_suite_id === rows[p].check_suite_id &&
        latest.some(r => r.id === e.runId && r.run_attempt === e.runAttempt && r.head_sha === expected[p].control.sha),
      'PRIVATE_ACTIONS_EXACT_RUN_REQUIRED');
      runIdentity(run, expected[p], workflow, clock());
      demand(instant(rows[p].artifact.expires_at) > clock(), 'PRIVATE_ACTIONS_ARTIFACT_INVALID');
    });
    const platforms = {};
    for (const p of ['IOS', 'ANDROID']) {
      const { controlTree, parent, ...row } = rows[p];
      platforms[p] = Object.freeze({ ...row, expected: Object.freeze({ ...expected[p], recoverySources: Object.freeze(recoverySources),
        workerSources: Object.freeze(workerSources) }) });
    }
    const result = frozen({ schema: 1, kind: 'private-actions-diagnostic-origin', current_controller_sha: branch.commit.sha,
      control_equivalence: 'IDENTICAL_TRACKED_BLOBS_AND_MODES_EXCEPT_EXACT_PLATFORM_REQUEST', platforms: Object.freeze(platforms),
      reviewed_window: false, installed_trust: 'UNVERIFIED', native_acceptance: false, release_ready: false,
      authorization_eligible: false, release_authorized: false, execution_allowed: false });
    issued.add(result); return result;
  } catch (error) { throw new Error(/^PRIVATE_ACTIONS_[A-Z0-9_]{1,80}$/.test(error?.message || '') ? error.message : 'PRIVATE_ACTIONS_ORIGIN_INVALID'); }
}
function isPrivateActionsOrigin(value) { return issued.has(value); }
async function authenticateReviewedPrivateActionsOrigins(github, windowKey, options) {
  demand(typeof windowKey === 'string' && Object.hasOwn(REVIEWED_WINDOWS, windowKey), 'PRIVATE_ACTIONS_REVIEWED_WINDOW_REQUIRED');
  return authenticatePrivateActionsOrigins(github, REVIEWED_WINDOWS[windowKey], options);
}
module.exports = { authenticatePrivateActionsOrigins, authenticateReviewedPrivateActionsOrigins, isPrivateActionsOrigin };
