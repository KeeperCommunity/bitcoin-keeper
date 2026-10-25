'use strict';
// Synthetic Actions/Git corpus only. No native result, token, backend or network.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { RECOVERY_SOURCES } = require('../../native/private_integration_receipts.cjs');
const { WORKER_SOURCES } = require('../../native/public_software_receipts.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const PRIVATE = 'KeeperCommunity/bitcoin-keeper-relay', APP = 'KeeperCommunity/bitcoin-keeper';
const BACKEND = '29597b27eeeb299205bf7d0555db0a90c38cc4be', BASELINE = '448e09d7a373fc7e9d9c540880b45e2c742997f7';
const REF = 'refs/heads/codex/r5-native-integration-execution-20261022';
const WORKFLOW = '.github/workflows/r5-native-integration.yml', POLICY = 'release/r5-native-integration/inputs.json';
const MARKER = 'release/r5-native-integration/native-request.json', TOOL = 'scripts/native-source-identity.cjs';
const blob = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const bytes = value => Buffer.from(JSON.stringify(value));
function fixture() {
  const state = { calls: [], now: Date.parse('2026-10-22T23:30:00Z'), privateRepo: { id: 496119449, full_name: PRIVATE, private: true },
    appRepo: { id: 470904030, full_name: APP, private: false }, workflow: { id: 7001, path: WORKFLOW, state: 'active' },
    branch: { name: REF.slice(11), commit: { sha: '2'.repeat(40) } }, commits: {}, trees: {}, files: {}, runs: {},
    lists: {}, jobs: {}, checks: {}, suites: {}, artifacts: {}, artifactLists: {}, onRequest: () => {} };
  const app = { repository: APP, sha: 'a'.repeat(40), tree: '9'.repeat(40) };
  const backendFiles = { 'src/runtime.cjs': Buffer.from('module.exports = 0;\n') };
  const appFiles = Object.fromEntries([...new Set([...RECOVERY_SOURCES, ...Object.keys(WORKER_SOURCES)])]
    .map(name => [name, fs.readFileSync(path.join(ROOT, name))]));
  const inventory = (files, sha) => ({ sha, truncated: false, tree: Object.entries(files).map(([name, data]) =>
    ({ path: name, type: 'blob', mode: '100644', sha: blob(data), size: data.length })) });
  const policy = { schema: 1, app_sha: app.sha, app_tree: app.tree, backend_base: BACKEND,
    control_paths: [WORKFLOW, POLICY, MARKER, TOOL], materialized_control_paths: [WORKFLOW, POLICY, TOOL] };
  state.files[`${PRIVATE}:${BASELINE}`] = { [POLICY]: bytes(policy) };
  state.files[`${APP}:${app.sha}`] = appFiles;
  state.commits[`${APP}:${app.sha}`] = { sha: app.sha, tree: { sha: app.tree } };
  state.trees[`${APP}:${app.sha}`] = inventory(appFiles, app.tree);
  state.commits[`${PRIVATE}:${BACKEND}`] = { sha: BACKEND, tree: { sha: '5'.repeat(40) } };
  state.trees[`${PRIVATE}:${BACKEND}`] = inventory(backendFiles, '5'.repeat(40));
  state.expected = {};
  for (const [platform, digit, runId] of [['IOS', '1', 1001], ['ANDROID', '2', 1002]]) {
    const sha = digit.repeat(40), tree = (platform === 'IOS' ? '3' : '4').repeat(40), artifactId = runId + 100;
    const expected = { platform, app: structuredClone(app), control: { repository: PRIVATE, sha, tree },
      backend: { repository: PRIVATE, sha: BACKEND }, execution: { repository: PRIVATE, workflowPath: WORKFLOW,
        workflowSha: sha, ref: REF, runId, runAttempt: 1 } };
    state.expected[platform] = expected;
    state.files[`${PRIVATE}:${sha}`] = { ...backendFiles, [WORKFLOW]: Buffer.from(`KEEPER_SOURCE_SHA: ${app.sha}\norigin ${app.sha}\n--detach ${app.sha}\n`),
      [POLICY]: bytes(policy), [MARKER]: bytes({ schema: 1, app_sha: app.sha, platform }), [TOOL]: Buffer.from('// immutable reviewed tool\n') };
    state.commits[`${PRIVATE}:${sha}`] = { sha, tree: { sha: tree }, message: `ci(r5): run combined native ${platform}`,
      parents: [{ sha: platform === 'ANDROID' ? state.expected.IOS.control.sha : '8'.repeat(40) }] };
    state.trees[`${PRIVATE}:${sha}`] = inventory(state.files[`${PRIVATE}:${sha}`], tree);
    state.runs[runId] = { id: runId, run_attempt: 1, workflow_id: 7001, path: WORKFLOW, event: 'push', head_sha: sha,
      head_branch: REF.slice(11), repository: structuredClone(state.privateRepo), head_repository: structuredClone(state.privateRepo),
      status: 'completed', conclusion: 'success', check_suite_id: runId + 200, updated_at: '2026-10-22T23:29:59Z', referenced_workflows: [] };
    state.lists[sha] = [state.runs[runId]];
    const appIdentity = { id: 15368, slug: 'github-actions' };
    state.suites[runId + 200] = { id: runId + 200, head_sha: sha, status: 'completed', conclusion: 'success', app: appIdentity };
    const steps = ['Record actual shared native window start before checkout or build',
      'Check out exact private tooling and only required runtime modules', 'Fetch fixed public app anonymously',
      'Set up reviewed Node runtime', 'Verify bounded exact source before installation', 'Install frozen backend dependencies without scripts',
      'Set up Java17', 'Record actual hosted toolchain', 'Install immutable native app dependencies and synthetic configuration',
      'Verify exact sources after dependency preparation', ...(platform === 'IOS' ? ['Set up Ruby for hosted iOS', 'Select reviewed Xcode16.4',
        'Check hosted iOS driver before the app build'] : ['Set up Android tools', 'Enable owned Android emulator acceleration']),
      "Start only this run's pinned owned loopback Mongo replica", 'Characterize the actual fixture and source contracts',
      'Build one unsigned development native candidate', 'Run one iOS startup then public phases and three serial private suites',
      'Run one Android startup then public phases and three serial private suites', 'Verify exact source after native attempts',
      "Remove only this run's owned Mongo runtime", 'Retain metadata only'].map(name => ({ name, status: 'completed',
        conclusion: name.startsWith('Run one ') && !name.includes(platform === 'IOS' ? 'iOS' : 'Android') ? 'skipped' : 'success' }));
    state.jobs[runId] = [{ id: runId + 300, name: 'native', run_id: runId, run_attempt: 1, head_sha: sha,
      labels: [platform === 'IOS' ? 'macos-15' : 'ubuntu-24.04'],
      started_at: platform === 'IOS' ? '2026-10-22T23:10:00Z' : '2026-10-22T23:21:00Z',
      completed_at: platform === 'IOS' ? '2026-10-22T23:20:00Z' : '2026-10-22T23:29:00Z',
      status: 'completed', conclusion: 'success', check_run_url: `https://api.github.com/repos/${PRIVATE}/check-runs/${runId + 400}`, steps }];
    state.checks[runId + 400] = { id: runId + 400, name: 'native', head_sha: sha, check_suite: { id: runId + 200 },
      status: 'completed', conclusion: 'success', app: appIdentity };
    state.artifacts[artifactId] = { id: artifactId, name: `r5-integration-native-${platform}-${sha}-${runId}-1`, expired: false,
      size_in_bytes: 1000, digest: 'sha256:' + '6'.repeat(64), expires_at: '2026-10-29T23:00:00Z',
      created_at: platform === 'IOS' ? '2026-10-22T23:19:00Z' : '2026-10-22T23:28:00Z',
      workflow_run: { id: runId, head_sha: sha, head_branch: REF.slice(11), repository_id: 496119449, head_repository_id: 496119449 } };
    state.artifactLists[runId] = [artifactId];
  }
  const response = value => ({ status: 200, headers: {}, data: structuredClone(value) });
  const list = (field, values) => response({ total_count: values.length, [field]: values });
  const wrap = (name, action) => async args => { state.calls.push({ name, args }); state.onRequest(name, args); return action(args); };
  state.github = { rest: {
    repos: {
      get: wrap('repository', a => response(a.repo === 'bitcoin-keeper' ? state.appRepo : state.privateRepo)),
      getBranch: wrap('branch', () => response(state.branch)),
      getContent: wrap('source', a => {
        const value = state.files[`KeeperCommunity/${a.repo}:${a.ref}`]?.[a.path];
        if (!value) throw new Error('SYNTHETIC_SOURCE_MISSING');
        return response({ type: 'file', path: a.path, encoding: 'base64', size: value.length, sha: blob(value), content: value.toString('base64') });
      }),
    },
    git: {
      getCommit: wrap('commit', a => response(state.commits[`KeeperCommunity/${a.repo}:${a.commit_sha}`])),
      getTree: wrap('tree', a => response(state.trees[`KeeperCommunity/${a.repo}:${a.tree_sha}`])),
    },
    actions: {
      getWorkflow: wrap('workflow', () => response(state.workflow)),
      listWorkflowRuns: wrap('runs', a => list('workflow_runs', state.lists[a.head_sha])),
      getWorkflowRun: wrap('run', a => response(state.runs[a.run_id])),
      listJobsForWorkflowRunAttempt: wrap('jobs', a => list('jobs', state.jobs[a.run_id])),
      listWorkflowRunArtifacts: wrap('artifacts', a => list('artifacts', state.artifactLists[a.run_id].map(id => state.artifacts[id]))),
      getArtifact: wrap('artifact', a => response(state.artifacts[a.artifact_id])),
    },
    checks: {
      getSuite: wrap('suite', a => response(state.suites[a.check_suite_id])),
      get: wrap('check', a => response(state.checks[a.check_run_id])),
    },
  } };
  state.rebind = (repo, ref, name, content) => {
    state.files[`${repo}:${ref}`][name] = content;
    const row = state.trees[`${repo}:${ref}`].tree.find(v => v.path === name);
    row.sha = blob(content); row.size = content.length;
  };
  return state;
}
module.exports = { fixture, PRIVATE, APP, BACKEND, BASELINE, WORKFLOW, POLICY, MARKER, TOOL };
