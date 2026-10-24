'use strict';
// Synthetic Actions/API transport around actual producer-shaped receipts. No native/API work.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { attach } = require('./public-companions.cjs');
const { WORKER_SOURCES } = require('../../native/public_software_receipts.cjs');
const { SCENARIOS, LIMITS } = require('../../native/r5_features_core');
const { WORKFLOWS, NATIVE_FILES } = require('../../native/release_preflight.cjs');
const { sdkDownloadArtifact } = require('./github-script-sdk-shape.cjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const raw = JSON.parse(execFileSync('python3', ['-B', path.join(__dirname, 'public_software.py')], { encoding: 'utf8' }));
const sources = Object.entries(WORKER_SOURCES).map(([name, names]) => {
  const bytes = fs.readFileSync(path.join(__dirname, '../../..', name));
  return { path: name, names: [...names], sha256: digest(bytes), file: { path: name, type: 'file', encoding: 'base64',
    size: bytes.length, content: bytes.toString('base64'), sha: crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') } };
});
function archiveBytes(raw, platform) {
  return execFileSync('python3', ['-B', '-c',
    'import io,sys,zipfile; raw=sys.stdin.buffer.read(); b=io.BytesIO(); z=zipfile.ZipFile(b,"w",zipfile.ZIP_DEFLATED); z.writestr(sys.argv[1].lower()+"/metadata.json",raw); z.close(); sys.stdout.buffer.write(b.getvalue())', platform],
  { input: raw, maxBuffer: 1024 * 1024 });
}
function archive(value) { return archiveBytes(Buffer.from(JSON.stringify(value)), value.platform); }
function metadata(platform, input) {
  const value = attach({ schema: 1, platform, source_sha: 'a'.repeat(40), workflow_sha: input.workflowSha,
    workflow_ref: input.workflowRef, run_id: '90', run_attempt: '2', diagnostic_only: false,
    app_id: platform === 'IOS' ? 'io.hexawallet.hexakeeper.dev' : 'io.hexawallet.keeper.development' }, platform);
  const bind = row => ({ ...structuredClone(row), installed_artifact_verified: true, installed_artifact: { ...value.installed_artifact } });
  Object.assign(value.product_ui, { requested_samples: 5, samples: raw.samples.map(bind),
    controlled_disconnect_retry: bind(raw.retry), key_management_ui: bind(raw.key) });
  value.r5_feature_evidence = { schema: 1, scope: 'production-worker-native-storage', status: 'PASS',
    scenarios: SCENARIOS.map(id => ({ id, status: 'PASS' })), limits: [...LIMITS],
    source_functions: sources.map(({ path, names, sha256 }) => ({ path, names, sha256 })),
    measurements: [1, 2, 3, 4, 5].map(iteration => ({ iteration, probe_ready_ms: 1, setup_first_wallet_ms: 2 })) };
  return value;
}
function fixture() {
  const repo = { id: 470904030, full_name: 'KeeperCommunity/bitcoin-keeper', default_branch: 'sprint' };
  const pr = { number: 9000, draft: false, labels: [], head: { sha: 'a'.repeat(40), ref: 'codex/example', repo },
    base: { sha: 'c'.repeat(40), ref: 'sprint', repo } };
  const input = { ios: 'success', android: 'success', attempt: 2, workflowSha: 'b'.repeat(40),
    workflowRef: `${repo.full_name}/.github/workflows/keeper-release-acceptance.yml@refs/pull/9000/merge` };
  const context = { eventName: 'pull_request', repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' },
    runId: 90, payload: { pull_request: structuredClone(pr) } };
  const app = { id: 15368, slug: 'github-actions' };
  const run = { id: 90, run_attempt: 2, workflow_id: 8, check_suite_id: 9, path: '.github/workflows/keeper-release-acceptance.yml',
    head_sha: pr.head.sha, head_branch: pr.head.ref, event: 'pull_request', status: 'in_progress', conclusion: null,
    updated_at: '2026-10-22T20:00:00Z', repository: repo, head_repository: repo, pull_requests: [structuredClone(pr)],
    referenced_workflows: [{ path: `${repo.full_name}/.github/workflows/keeper-native-platform.yml@${input.workflowSha}`,
      sha: input.workflowSha, ref: 'refs/pull/9000/merge' }] };
  for (const row of [run.pull_requests[0].head, run.pull_requests[0].base])
    row.repo = { id: repo.id, url: `https://api.github.com/repos/${repo.full_name}`, name: 'bitcoin-keeper' };
  const jobs = ['IOS', 'ANDROID'].map((platform, index) => ({ id: 20 + index, run_id: 90, run_attempt: 2,
    head_sha: pr.head.sha, name: `${platform.toLowerCase()} / Native ${platform} build and probes`,
    status: 'completed', conclusion: 'success', check_run_url: `https://api.github.com/repos/${repo.full_name}/check-runs/${30 + index}`,
    steps: ['Build development app', ...(platform === 'IOS' ? ['Run disposable startup smoke', 'Run disposable native persistence probe',
      'Run R5 production worker native scenarios', 'Measure five full-product startup and first-wallet runs'] :
      ['Run Android startup and native persistence probes']), 'Retain safe Phase A evidence'].map(name =>
      ({ name, status: 'completed', conclusion: 'success' })) }));
  const state = { input, context, pr, repo, run, runs: [structuredClone(run)], jobs, calls: [], fetches: 0,
    now: Date.parse('2026-10-22T20:30:00Z'), branch: { name: 'sprint', protected: true, commit: { sha: pr.base.sha } },
    workflow: { id: 8, path: run.path, state: 'active' }, checks: {},
    suite: { id: 9, head_sha: pr.head.sha, status: 'in_progress', app }, treeOverrides: {}, files: structuredClone(sources),
    tree: { truncated: false, tree: [...WORKFLOWS, ...NATIVE_FILES, '.github/native/actions_software_evidence.cjs',
      '.github/native/software_artifact_zip.py'].map(name => ({ path: name, type: 'blob', mode: '100644', sha: 'd'.repeat(40) })) },
    archives: {}, artifacts: [], metadata: {}, total: {} };
  jobs.forEach((job, index) => { state.checks[30 + index] = { id: 30 + index, name: job.name, check_suite: { id: 9 },
    head_sha: pr.head.sha, status: 'completed', conclusion: 'success', app: structuredClone(app) }; });
  state.replaceReceipt = (platform, change = () => {}) => {
    const value = metadata(platform, input); change(value); state.metadata[platform] = value;
    const bytes = archive(value), artifactId = platform === 'IOS' ? 101 : 102;
    state.archives[artifactId] = bytes;
    const artifact = { id: artifactId, name: `keeper-release-native-${platform}-${pr.head.sha}-90-2`, expired: false,
      size_in_bytes: bytes.length, digest: `sha256:${digest(bytes)}`, expires_at: '2026-10-29T20:00:00Z',
      workflow_run: { id: 90, head_sha: pr.head.sha, repository_id: repo.id, head_repository_id: repo.id } };
    const found = state.artifacts.findIndex(row => row.id === artifactId);
    if (found < 0) state.artifacts.push(artifact); else state.artifacts[found] = artifact;
  };
  for (const platform of ['IOS', 'ANDROID']) state.replaceReceipt(platform);
  const response = (value, headers = {}) => ({ status: 200, headers, data: structuredClone(value) });
  const endpoint = (name, fn) => async options => {
    state.calls.push({ name, options }); if (state.apiError) throw new Error('PRIVATE_PAYLOAD https://private.invalid/?secret=value');
    if (name === 'artifact') { state.artifactReads = (state.artifactReads || 0) + 1; if (state.artifactReads === 4) state.afterArtifactRead?.(state); }
    return fn(options);
  };
  const list = (name, rows, key) => endpoint(name, () => response({ total_count: state.total[key] ?? rows().length, [key]: rows() }, state.headers));
  state.github = { rest: {
    repos: { get: endpoint('repository', () => response(state.repo)), getBranch: endpoint('branch', () => response(state.branch)),
      getContent: endpoint('source', options => response(state.files.find(row => row.path === options.path)?.file)) },
    pulls: { get: endpoint('pr', () => response(state.pr)) },
    git: { getTree: endpoint('tree', options => response({ sha: options.tree_sha === 'a'.repeat(40) ? 'e'.repeat(40) :
      options.tree_sha === input.workflowSha ? 'f'.repeat(40) : 'd'.repeat(40), ...(state.treeOverrides[options.tree_sha] || state.tree) })),
      getCommit: endpoint('commit', options => response({ sha: options.commit_sha, tree: { sha: options.commit_sha === pr.head.sha ? 'e'.repeat(40) : 'f'.repeat(40) } })) },
    checks: { getSuite: endpoint('suite', () => response(state.suite)), get: endpoint('check', options => response(state.checks[options.check_run_id])) },
    actions: { getWorkflow: endpoint('workflow', () => response(state.workflow)),
      listWorkflowRuns: list('runs', () => state.runs, 'workflow_runs'), getWorkflowRun: endpoint('run', () => response(state.run)),
      listJobsForWorkflowRunAttempt: list('jobs', () => state.jobs, 'jobs'),
      listWorkflowRunArtifacts: list('artifacts', () => state.artifacts, 'artifacts'),
      getArtifact: endpoint('artifact', options => response(state.artifacts.find(row => row.id === options.artifact_id))),
      downloadArtifact: endpoint('download', options => sdkDownloadArtifact(options, state.options.fetchImpl, state.sdkShape || {})) },
  } };
  state.options = { clock: () => state.now, fetchImpl: async (url, options) => {
    url = new URL(url);
    if (url.hostname === 'api.github.com') {
      state.apiFetchOptions = options;
      const artifactId = Number(url.pathname.match(/artifacts\/(\d+)\/zip$/)?.[1]);
      const response = new Response('PRIVATE_API_RESPONSE_NOT_FOR_LOGS', { status: state.downloadStatus ?? 302,
        headers: { location: state.location || `https://evidence.blob.core.windows.net/r5/${artifactId}.zip?safe=fixture` } });
      const cancel = response.body.cancel.bind(response.body);
      response.body.cancel = async () => { state.apiBodyCancellations = (state.apiBodyCancellations || 0) + 1; await cancel(); };
      return response;
    }
    state.fetchOptions = options;
    const bytes = state.archiveOverride || state.archives[Number(url.pathname.match(/(\d+)\.zip$/)?.[1])];
    state.fetches++;
    if (state.fetches === 2) state.afterDownload?.(state);
    return new Response(bytes, { status: state.fetchStatus || 200,
      headers: state.fetchHeaders || { 'Content-Length': String(bytes.length) } });
  } };
  return state;
}
module.exports = { fixture, digest, archiveBytes };
