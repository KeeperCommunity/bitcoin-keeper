'use strict';
// Read-only installed PR-route provenance. No dispatch, status, release or pin access.
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { preflight, fingerprint } = require('./release_preflight.cjs');
const { parseStrictJson } = require('./strict_json.cjs');
const { SCOPES: COMPANION_SCOPES } = require('./public_companion_receipts.cjs');
const REPOSITORY = 'KeeperCommunity/bitcoin-keeper', REPOSITORY_ID = 470904030;
const OWNER = 'KeeperCommunity', REPO = 'bitcoin-keeper';
const WORKFLOW = '.github/workflows/keeper-release-acceptance.yml';
const WORKER = '.github/workflows/keeper-native-platform.yml';
const MAX_ARCHIVE = 1024 * 1024, MAX_MEMBER = 512 * 1024, MAX_AGE = 86400000;
const SHA = /^[a-f0-9]{40}$/, proofs = new WeakSet();
const id = value => Number.isSafeInteger(value) && value > 0;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const demand = (value, code) => { if (!value) throw new Error(code); };
const repository = value => value?.id === REPOSITORY_ID && value.full_name === REPOSITORY;
const args = { owner: OWNER, repo: REPO, request: { timeout: 30000 } };
const PUBLIC_CHECKS = Object.freeze({
  'native-build': 'development native build',
  startup: 'ordinary app passcode startup smoke',
  'native-storage': 'CI entrypoint native Realm/MMKV process persistence',
  'production-worker-controls': 'CI-extracted production workers; synthetic boundaries are not complete application UI',
  'five-product-observations': 'five raw development full-product startup/first-wallet observations; no release-build budget',
  'controlled-setup-disconnect-retry': 'ordinary app loopback disconnect before commit; not physical WAN offline',
  'installed-version-history': 'native installed tuple and retained initial history; not authentic historical migration',
  'key-management-discoverability': 'ordinary app Keys Manage Keys entry and return',
  'unused-key-and-pin-ui': 'unused Mobile Key delete cancel wrong PIN and cold persistence; not protected backup or physical biometrics',
  ...COMPANION_SCOPES,
});

function complete(response, key) {
  const value = response?.data;
  demand(response?.status === 200 && !/rel="next"/.test(response.headers?.link || '') &&
    Number.isSafeInteger(value?.total_count) && value.total_count > 0 && value.total_count <= 100 &&
    Array.isArray(value[key]) && value[key].length === value.total_count, 'SOFTWARE_API_INCOMPLETE');
  return value[key];
}
function data(response) {
  demand(response?.status === 200 && response.data && !/rel="next"/.test(response.headers?.link || ''), 'SOFTWARE_API_INVALID');
  return response.data;
}
function checkApp(value) { return value?.app?.id === 15368 && value.app.slug === 'github-actions'; }
function selectedSteps(platform) {
  return ['Build development app', ...(platform === 'IOS' ? ['Run disposable startup smoke',
    'Run disposable native persistence probe', 'Run R5 production worker native scenarios',
    'Measure five full-product startup and first-wallet runs'] : ['Run Android startup and native persistence probes']),
  'Retain safe Phase A evidence'];
}
function exactPR(value, original) {
  return value?.number === original.number && value.base?.ref === 'sprint' &&
    SHA.test(value.base.sha || '') && repository(value.base.repo) && repository(value.head?.repo) &&
    value.head.sha === original.head.sha && value.head.ref === original.head.ref;
}
function linkedPR(value, original) {
  // Actions run associations use a reduced repository shape (id/url/name),
  // unlike pulls.get. Global repository IDs bind to the separately verified
  // complete repository and current PR; full_name is not present here.
  return value?.number === original.number && value.head?.sha === original.head.sha &&
    value.head.ref === original.head.ref && value.head.repo?.id === REPOSITORY_ID &&
    value.base?.ref === 'sprint' && value.base.sha === original.base.sha && value.base.repo?.id === REPOSITORY_ID;
}
function publicRequest(context, input) {
  const pr = context.payload?.pull_request;
  demand(context.eventName === 'pull_request' && context.repo?.owner === OWNER && context.repo.repo === REPO &&
    id(pr?.number) && pr.number !== 7045 && pr.draft === false && exactPR(pr, pr) && SHA.test(pr.head.sha || '') &&
    !pr.labels?.some(label => ['keeper/native-diagnostic', 'keeper/legacy-native'].includes(label.name)), 'SOFTWARE_PUBLIC_ROUTE_REQUIRED');
  demand(input?.ios === 'success' && input.android === 'success' && id(context.runId) && id(input.attempt), 'SOFTWARE_EXACT_ATTEMPT_REQUIRED');
  const mergeRef = `refs/pull/${pr.number}/merge`;
  demand(SHA.test(input.workflowSha || '') && input.workflowRef === `${REPOSITORY}/${WORKFLOW}@${mergeRef}`,
    'SOFTWARE_WORKFLOW_CONTROL_REQUIRED');
  return { sourceSha: pr.head.sha, workflowSha: input.workflowSha, workflowRef: input.workflowRef,
    runId: context.runId, attempt: input.attempt, mergeRef, pr };
}
function fresh(run, now) {
  const updated = Date.parse(run.updated_at);
  demand(Number.isFinite(now) && Number.isFinite(updated) && updated <= now && updated >= now - MAX_AGE,
    'SOFTWARE_RUN_STALE');
}

async function origin(github, context, request, now) {
  const [repo, pr, branch, workflow] = await Promise.all([
    github.rest.repos.get(args).then(data),
    github.rest.pulls.get({ ...args, pull_number: request.pr.number }).then(data),
    github.rest.repos.getBranch({ ...args, branch: 'sprint' }).then(data),
    github.rest.actions.getWorkflow({ ...args, workflow_id: 'keeper-release-acceptance.yml' }).then(data),
  ]);
  demand(repository(repo) && repo.default_branch === 'sprint' && exactPR(pr, request.pr) && pr.draft === false &&
    !pr.labels?.some(label => ['keeper/native-diagnostic', 'keeper/legacy-native'].includes(label.name)) &&
    branch.protected === true && branch.name === 'sprint' && branch.commit?.sha === pr.base.sha,
  'SOFTWARE_PR_SOURCE_NOT_CURRENT');
  // Keep the existing app/current-base/original-run-base installation boundary.
  demand((await preflight(github, context)).trusted === true, 'SOFTWARE_REVIEWED_INSTALLATION_REQUIRED');
  demand(id(workflow.id) && workflow.path === WORKFLOW && workflow.state === 'active', 'SOFTWARE_WORKFLOW_NOT_INSTALLED');
  const runs = complete(await github.rest.actions.listWorkflowRuns({ ...args, workflow_id: workflow.id,
    head_sha: request.sourceSha, branch: request.pr.head.ref, event: 'pull_request', per_page: 100 }), 'workflow_runs');
  demand(runs.every(run => id(run.id)) && Math.max(...runs.map(run => run.id)) === request.runId, 'SOFTWARE_LATEST_RUN_REQUIRED');
  const run = data(await github.rest.actions.getWorkflowRun({ ...args, run_id: request.runId }));
  demand(run.id === request.runId && run.run_attempt === request.attempt && run.workflow_id === workflow.id &&
    run.path === WORKFLOW && run.event === 'pull_request' && run.head_sha === request.sourceSha &&
    run.head_branch === request.pr.head.ref && repository(run.repository) && repository(run.head_repository) && id(run.check_suite_id) &&
    (run.status === 'in_progress' || (run.status === 'completed' && run.conclusion === 'success')) &&
    runs.some(value => value.id === run.id && value.run_attempt === run.run_attempt && value.head_sha === run.head_sha),
  'SOFTWARE_RUN_NOT_EXACT_CURRENT');
  const linked = run.pull_requests?.filter(value => value.number === request.pr.number) || [];
  demand(linked.length === 1 && linkedPR(linked[0], request.pr),
    'SOFTWARE_RUN_PR_BINDING_INVALID');
  // A local reusable workflow is loaded from the caller's merge control commit,
  // not from the separately checked-out app head. Neither receipt selects this SHA.
  demand(Array.isArray(run.referenced_workflows) && run.referenced_workflows.length === 1 &&
    run.referenced_workflows[0].path === `${REPOSITORY}/${WORKER}@${request.workflowSha}` &&
    run.referenced_workflows[0].ref === request.mergeRef && run.referenced_workflows[0].sha === request.workflowSha,
  'SOFTWARE_REUSABLE_CONTROL_BINDING_INVALID');
  fresh(run, now);
  const [app, control, sourceTree, controlTree, suite] = await Promise.all([
    github.rest.git.getCommit({ ...args, commit_sha: request.sourceSha }).then(data),
    github.rest.git.getCommit({ ...args, commit_sha: request.workflowSha }).then(data),
    github.rest.git.getTree({ ...args, tree_sha: request.sourceSha, recursive: '1' }).then(data),
    github.rest.git.getTree({ ...args, tree_sha: request.workflowSha, recursive: '1' }).then(data),
    github.rest.checks.getSuite({ ...args, check_suite_id: run.check_suite_id }).then(data),
  ]);
  demand(app.sha === request.sourceSha && SHA.test(app.tree?.sha || '') && control.sha === request.workflowSha &&
    SHA.test(control.tree?.sha || '') && sourceTree.sha === app.tree.sha && controlTree.sha === control.tree.sha &&
    fingerprint(sourceTree) === fingerprint(controlTree), 'SOFTWARE_CONTROL_TREE_INVALID');
  demand(suite.id === run.check_suite_id && suite.head_sha === request.sourceSha && checkApp(suite) &&
    ['in_progress', 'completed'].includes(suite.status), 'SOFTWARE_CHECK_SUITE_INVALID');
  return { pr, workflow, run, appTree: app.tree.sha, controlTree: control.tree.sha };
}

async function platformJobs(github, request, run) {
  const jobs = complete(await github.rest.actions.listJobsForWorkflowRunAttempt({ ...args, run_id: request.runId,
    attempt_number: request.attempt, per_page: 100 }), 'jobs');
  const selected = {};
  for (const platform of ['IOS', 'ANDROID']) {
    const name = `${platform.toLowerCase()} / Native ${platform} build and probes`;
    const matches = jobs.filter(job => job.name === name);
    demand(matches.length === 1, 'SOFTWARE_PLATFORM_JOB_MISSING');
    const job = matches[0];
    demand(id(job.id) && job.run_id === request.runId && job.run_attempt === request.attempt && job.head_sha === request.sourceSha &&
      job.status === 'completed' && job.conclusion === 'success', 'SOFTWARE_PLATFORM_JOB_INVALID');
    for (const name of selectedSteps(platform)) {
      const steps = job.steps?.filter(step => step.name === name) || [];
      demand(steps.length === 1 && steps[0].status === 'completed' && steps[0].conclusion === 'success', 'SOFTWARE_PLATFORM_STEP_INVALID');
    }
    const match = job.check_run_url?.match(/^https:\/\/api\.github\.com\/repos\/KeeperCommunity\/bitcoin-keeper\/check-runs\/([1-9]\d*)$/);
    demand(match && id(Number(match[1])), 'SOFTWARE_CHECK_BINDING_INVALID');
    const check = data(await github.rest.checks.get({ ...args, check_run_id: Number(match[1]) }));
    demand(check.id === Number(match[1]) && check.name === job.name && check.check_suite?.id === run.check_suite_id &&
      check.head_sha === request.sourceSha && check.status === 'completed' && check.conclusion === 'success' && checkApp(check),
    'SOFTWARE_CHECK_ORIGIN_INVALID');
    selected[platform] = { job_id: job.id, check_run_id: check.id };
  }
  return selected;
}

async function boundedBytes(response) {
  let reader;
  try {
    demand(response?.ok === true && response.body?.getReader, 'SOFTWARE_ARCHIVE_READ_FAILED');
    const length = response.headers.get('content-length');
    demand(length === null || (/^\d+$/.test(length) && Number(length) <= MAX_ARCHIVE), 'SOFTWARE_ARCHIVE_TOO_LARGE');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      demand(size <= MAX_ARCHIVE, 'SOFTWARE_ARCHIVE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    demand(length === null || Number(length) === size, 'SOFTWARE_ARCHIVE_SIZE_MISMATCH');
    return Buffer.concat(chunks);
  } finally {
    // Header/status rejection happens before a reader exists. Close that body
    // too; a cancellation failure must prevent an apparently successful read.
    if (reader) await reader.cancel();
    else if (response?.body?.cancel) await response.body.cancel();
  }
}
async function readArchive(github, artifactId, fetchImpl) {
  demand(id(artifactId), 'SOFTWARE_ARTIFACT_IDENTITY_INVALID');
  const apiURL = `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${artifactId}/zip`;
  let intercepted = false;
  const response = await github.rest.actions.downloadArtifact({ ...args, artifact_id: artifactId, archive_format: 'zip',
    request: { timeout: 30000, parseSuccessResponseBody: false,
      // The pinned github-script client does not forward request.redirect.
      // Its supported fetch hook controls the authenticated API hop instead.
      fetch: async (url, init) => {
        demand(!intercepted && url === apiURL && init?.method === 'GET' && init.body == null,
          'SOFTWARE_ARCHIVE_API_REQUEST_INVALID');
        intercepted = true;
        const apiResponse = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) });
        try {
          demand(apiResponse?.status === 302, 'SOFTWARE_ARCHIVE_REDIRECT_REQUIRED');
          return apiResponse;
        } finally {
          // No SDK JSON/text/arrayBuffer parser may consume an API error or
          // accidentally followed ZIP body before our streaming size checks.
          if (apiResponse?.body) await apiResponse.body.cancel();
        }
      } } });
  demand(intercepted && response.status === 302, 'SOFTWARE_ARCHIVE_REDIRECT_REQUIRED');
  const location = new URL(response.headers.location);
  demand(location.protocol === 'https:' && !location.username && !location.password && !location.hash &&
    (!location.port || location.port === '443') &&
    (location.hostname.endsWith('.blob.core.windows.net') || location.hostname.endsWith('.actions.githubusercontent.com')),
  'SOFTWARE_ARCHIVE_HOST_INVALID');
  // No GitHub token or API headers reach the signed storage endpoint.
  return boundedBytes(await fetchImpl(location, { redirect: 'error', signal: AbortSignal.timeout(30000) }));
}
// Transport only: returns original untrusted ZIP bytes, never an issued proof.
// A separately reviewed fixed-artifact host probe can exercise this exact adapter.
async function readPublicArtifactBytes(github, artifactId, { fetchImpl = fetch } = {}) {
  try { return await readArchive(github, artifactId, fetchImpl); }
  catch (error) {
    throw new Error(/^SOFTWARE_[A-Z0-9_]{1,80}$/.test(error?.message || '') ? error.message : 'SOFTWARE_ARCHIVE_READ_FAILED');
  }
}
function unpack(archive, platform) {
  const result = execFileSync('python3', ['-B', path.join(__dirname, 'software_artifact_zip.py'), platform], {
    input: archive, timeout: 10000, maxBuffer: MAX_MEMBER * 2, stdio: ['pipe', 'pipe', 'pipe'],
    // Only the parser's executable search path is needed; no runner credentials.
    env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' },
  });
  const members = JSON.parse(result.toString('utf8')), name = `${platform.toLowerCase()}/metadata.json`;
  demand(members && Object.keys(members).length === 1 && typeof members[name] === 'string', 'SOFTWARE_ARCHIVE_MEMBERS_INVALID');
  const bytes = Buffer.from(members[name], 'base64');
  demand(bytes.length > 0 && bytes.length <= MAX_MEMBER && bytes.toString('base64') === members[name], 'SOFTWARE_ARCHIVE_MEMBERS_INVALID');
  return bytes;
}
function artifactIdentity(info, name, request, now) {
  demand(id(info?.id) && info.name === name && info.expired === false && id(info.size_in_bytes) && info.size_in_bytes <= MAX_ARCHIVE &&
    /^sha256:[a-f0-9]{64}$/.test(info.digest || '') && Date.parse(info.expires_at) > now &&
    info.workflow_run?.id === request.runId && info.workflow_run.head_sha === request.sourceSha &&
    info.workflow_run.repository_id === REPOSITORY_ID && info.workflow_run.head_repository_id === REPOSITORY_ID,
  'SOFTWARE_ARTIFACT_IDENTITY_INVALID');
}
async function workerSources(github, sourceSha, expected) {
  return Promise.all(Object.entries(expected).map(async ([name, names]) => {
    const file = data(await github.rest.repos.getContent({ ...args, path: name, ref: sourceSha }));
    demand(file.path === name && file.type === 'file' && file.encoding === 'base64' && SHA.test(file.sha || '') &&
      id(file.size) && file.size <= MAX_MEMBER && typeof file.content === 'string' && /^[A-Za-z0-9+/=\r\n]+$/.test(file.content),
    'SOFTWARE_COMMITTED_WORKER_UNAVAILABLE');
    const bytes = Buffer.from(file.content, 'base64');
    const blob = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    demand(bytes.length === file.size && bytes.toString('base64') === file.content.replace(/[\r\n]/g, '') && blob === file.sha,
      'SOFTWARE_COMMITTED_WORKER_UNAVAILABLE');
    return { path: name, sha256: digest(bytes), names: [...names] };
  }));
}

async function collectPublicSoftwareEvidence(github, context, input, { clock = Date.now, fetchImpl = fetch } = {}) {
  try {
    const request = publicRequest(context, input);
    const first = await origin(github, context, request, clock());
    const jobs = await platformJobs(github, request, first.run);
    // Import the reviewed P1 validator only after source and installed route checks.
    const { validatePublicSoftware, WORKER_SOURCES } = require('./public_software_receipts.cjs');
    const sources = await workerSources(github, request.sourceSha, WORKER_SOURCES);
    const artifacts = complete(await github.rest.actions.listWorkflowRunArtifacts({ ...args, run_id: request.runId, per_page: 100 }), 'artifacts');
    const platforms = {}, identities = [];
    for (const platform of ['IOS', 'ANDROID']) {
      const name = `keeper-release-native-${platform}-${request.sourceSha}-${request.runId}-${request.attempt}`;
      const matches = artifacts.filter(artifact => artifact.name === name);
      demand(matches.length === 1 && id(matches[0].id), 'SOFTWARE_ARTIFACT_MISSING_OR_AMBIGUOUS');
      const info = data(await github.rest.actions.getArtifact({ ...args, artifact_id: matches[0].id }));
      demand(info.id === matches[0].id, 'SOFTWARE_ARTIFACT_CHANGED');
      artifactIdentity(info, name, request, clock());
      const archive = await readPublicArtifactBytes(github, info.id, { fetchImpl });
      demand(archive.length === info.size_in_bytes && `sha256:${digest(archive)}` === info.digest, 'SOFTWARE_ARTIFACT_DIGEST_MISMATCH');
      const bytes = unpack(archive, platform);
      const metadata = parseStrictJson(bytes, MAX_MEMBER);
      const validated = validatePublicSoftware(metadata, { platform, sourceSha: request.sourceSha, workflowSha: request.workflowSha,
        workflowRef: request.workflowRef, runId: request.runId, runAttempt: request.attempt, workerSources: sources });
      platforms[platform] = Object.freeze({ ...jobs[platform], artifact_id: info.id, archive_sha256: digest(archive),
        receipt_sha256: digest(bytes), installed_artifact: validated.installed_artifact,
        executed_checks: Object.freeze(Object.fromEntries(Object.entries(PUBLIC_CHECKS).map(([id, scope]) =>
          [id, Object.freeze({ status: 'PASS', scope })]))) });
      identities.push(info);
    }
    // A partial rerun, later pending/failing run, source/base movement, expired
    // artifact or changed check ownership invalidates collection after download.
    const final = await origin(github, context, request, clock());
    demand(first.pr.base.sha === final.pr.base.sha && first.appTree === final.appTree && first.controlTree === final.controlTree &&
      first.workflow.id === final.workflow.id && first.run.check_suite_id === final.run.check_suite_id,
    'SOFTWARE_ORIGIN_CHANGED_DURING_COLLECTION');
    demand(JSON.stringify(await platformJobs(github, request, final.run)) === JSON.stringify(jobs), 'SOFTWARE_JOBS_CHANGED_DURING_COLLECTION');
    const finalArtifacts = complete(await github.rest.actions.listWorkflowRunArtifacts({ ...args, run_id: request.runId, per_page: 100 }), 'artifacts');
    for (const info of identities) {
      demand(finalArtifacts.filter(value => value.name === info.name).length === 1 &&
        finalArtifacts.some(value => value.name === info.name && value.id === info.id), 'SOFTWARE_ARTIFACT_CHANGED');
      const current = data(await github.rest.actions.getArtifact({ ...args, artifact_id: info.id }));
      artifactIdentity(current, info.name, request, clock());
      demand(current.id === info.id && current.digest === info.digest && current.size_in_bytes === info.size_in_bytes,
        'SOFTWARE_ARTIFACT_CHANGED');
    }
    // Artifact readbacks are network work too. Recheck latest source/attempt
    // after them, rather than treating the earlier run snapshot as current.
    const last = await origin(github, context, request, clock());
    demand(last.pr.base.sha === first.pr.base.sha && last.appTree === first.appTree && last.controlTree === first.controlTree &&
      last.workflow.id === first.workflow.id && last.run.check_suite_id === first.run.check_suite_id,
    'SOFTWARE_ORIGIN_CHANGED_DURING_COLLECTION');
    for (const info of identities) artifactIdentity(info, info.name, request, clock());
    fresh(last.run, clock());
    const proof = Object.freeze({ schema: 1, kind: 'keeper-public-software-evidence', selected_route: 'public-reusable',
      repository: REPOSITORY, source_sha: request.sourceSha, source_tree: first.appTree,
      workflow_sha: request.workflowSha, workflow_ref: request.workflowRef, control_tree: first.controlTree,
      run_id: request.runId, run_attempt: request.attempt, platforms: Object.freeze(platforms), software_complete: false,
      private_integration: 'NOT VERIFIED: frozen C2/D contract and separately authenticated private route required',
      installed_trust: 'UNVERIFIED', release_ready: false, authorization_eligible: false, release_authorized: false, execution_allowed: false });
    proofs.add(proof);
    return proof;
  } catch (error) {
    throw new Error(/^SOFTWARE_[A-Z0-9_]{1,80}$/.test(error?.message || '') ? error.message : 'SOFTWARE_EVIDENCE_INVALID');
  }
}
function collectPrivateSoftwareEvidence() {
  // No WIP schema, caller manifest or private workflow name supplies trust.
  throw new Error('SOFTWARE_PRIVATE_CONTRACT_NOT_FROZEN');
}
module.exports = { collectPublicSoftwareEvidence, collectPrivateSoftwareEvidence,
  isPublicSoftwareEvidence: value => proofs.has(value), readPublicArtifactBytes, PUBLIC_CHECKS };
