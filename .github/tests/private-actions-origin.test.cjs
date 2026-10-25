'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { authenticatePrivateActionsOrigins: verify, authenticateReviewedPrivateActionsOrigins: installed, isPrivateActionsOrigin } = require('../native/private_actions_origin.cjs');
const { fixture, PRIVATE, APP, POLICY, MARKER, TOOL } = require('./fixtures/private-actions.cjs');
const run = f => verify(f.github, f.expected, { clock: () => f.now });
test('empty reviewed-window policy blocks the future entrypoint before any API call', async () => {
  const f = fixture();
  for (const key of ['', 'current', 'IOS', '__proto__', f.expected]) await assert.rejects(installed(f.github, key),
    /^Error: PRIVATE_ACTIONS_REVIEWED_WINDOW_REQUIRED$/);
  assert.equal(f.calls.length, 0);
});
test('equivalent independently supplied object key orders remain valid', async () => {
  const f = fixture(), app = f.expected.ANDROID.app;
  f.expected.ANDROID.app = { tree: app.tree, sha: app.sha, repository: app.repository };
  assert.equal(isPrivateActionsOrigin(await run(f)), true);
});
test('binds two distinct platform controllers to one app without granting installed or canonical authority', async () => {
  const f = fixture(), result = await run(f);
  assert.equal(isPrivateActionsOrigin(result), true); assert.equal(isPrivateActionsOrigin(structuredClone(result)), false);
  assert.notEqual(result.platforms.IOS.expected.control.sha, result.platforms.ANDROID.expected.control.sha);
  assert.equal(result.current_controller_sha, f.expected.ANDROID.control.sha);
  assert.equal(result.platforms.IOS.expected.recoverySources.length, 18);
  assert.equal(result.platforms.IOS.expected.workerSources.length, 5);
  assert.equal(result.installed_trust, 'UNVERIFIED');
  for (const name of ['reviewed_window', 'native_acceptance', 'release_ready', 'authorization_eligible', 'release_authorized', 'execution_allowed'])
    assert.equal(result[name], false);
  assert.equal(Object.isFrozen(result.platforms.IOS.expected.app), true);
  assert.throws(() => { result.platforms.IOS.artifact.id = 1; }, TypeError);
  assert.throws(() => { result.platforms.IOS.expected.recoverySources[0].sha256 = '0'.repeat(64); }, TypeError);
  assert.equal(JSON.stringify(result).includes('https://'), false);
});
for (const [name, mutate] of [
  ['missing platform', f => { delete f.expected.IOS; }],
  ['unknown descriptor field', f => { f.expected.IOS.status = 'PASS'; }],
  ['public control repository', f => { f.expected.IOS.control.repository = APP; }],
  ['wrong backend', f => { f.expected.IOS.backend.sha = '0'.repeat(40); }],
  ['wrong workflow', f => { f.expected.IOS.execution.workflowPath = '.github/workflows/keeper-canonical-native.yml'; }],
  ['wrong execution ref', f => { f.expected.IOS.execution.ref = 'refs/heads/sprint'; }],
  ['wrong workflow commit', f => { f.expected.IOS.execution.workflowSha = '0'.repeat(40); }],
  ['one borrowed controller', f => { f.expected.ANDROID.control = structuredClone(f.expected.IOS.control); f.expected.ANDROID.execution.workflowSha = f.expected.IOS.control.sha; }],
  ['one borrowed run', f => { f.expected.ANDROID.execution.runId = f.expected.IOS.execution.runId; }],
  ['different public source', f => { f.expected.ANDROID.app.sha = '0'.repeat(40); }],
]) test(`rejects supplied identity before API: ${name}`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(run(f), /PRIVATE_ACTIONS_ORIGIN_INVALID/); assert.equal(f.calls.length, 0);
});
for (const [name, mutate] of [
  ['wrong private ID', f => { f.privateRepo.id++; }], ['private repo became public', f => { f.privateRepo.private = false; }],
  ['wrong app ID', f => { f.appRepo.id++; }], ['foreign app repo', f => { f.appRepo.full_name = 'fork/bitcoin-keeper'; }],
  ['wrong current branch', f => { f.branch.name = 'sprint'; }], ['moved current head', f => { f.branch.commit.sha = 'f'.repeat(40); }],
  ['inactive workflow', f => { f.workflow.state = 'disabled_manually'; }], ['wrong workflow path', f => { f.workflow.path = '.github/workflows/other.yml'; }],
  ['wrong app commit', f => { f.commits[`${APP}:${f.expected.IOS.app.sha}`].sha = '0'.repeat(40); }],
  ['wrong app tree', f => { f.commits[`${APP}:${f.expected.IOS.app.sha}`].tree.sha = '0'.repeat(40); }],
  ['truncated app tree', f => { f.trees[`${APP}:${f.expected.IOS.app.sha}`].truncated = true; }],
  ['duplicate app path', f => { const t = f.trees[`${APP}:${f.expected.IOS.app.sha}`].tree; t.push(t[0]); }],
  ['untrusted control mode', f => { f.trees[`${PRIVATE}:${f.expected.IOS.control.sha}`].tree[0].mode = '120000'; }],
  ['wrong control tree', f => { f.trees[`${PRIVATE}:${f.expected.IOS.control.sha}`].sha = '0'.repeat(40); }],
  ['wrong commit subject', f => { f.commits[`${PRIVATE}:${f.expected.IOS.control.sha}`].message = 'ci(r5): run combined native ANDROID'; }],
  ['nonparent controller', f => { f.commits[`${PRIVATE}:${f.expected.ANDROID.control.sha}`].parents[0].sha = '0'.repeat(40); }],
]) test(`rejects repository/source provenance: ${name}`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(run(f), /^Error: PRIVATE_ACTIONS_[A-Z_]+$/);
});
for (const [name, mutate] of [
  ['wrong run', r => { r.id++; }], ['rerun', r => { r.run_attempt++; }], ['different workflow ID', r => { r.workflow_id++; }],
  ['public route event', r => { r.event = 'pull_request'; }], ['wrong workflow path', r => { r.path = '.github/workflows/other.yml'; }],
  ['borrowed head', r => { r.head_sha = '0'.repeat(40); }], ['wrong branch', r => { r.head_branch = 'sprint'; }],
  ['forked head repo', r => { r.head_repository.id++; }], ['failed completed run', r => { r.conclusion = 'failure'; }],
  ['pending run', r => { r.status = 'in_progress'; }], ['stale update', r => { r.updated_at = '2026-10-20T23:00:00Z'; }],
  ['future update', r => { r.updated_at = '2026-10-23T00:00:00Z'; }],
  ['borrowed reusable workflow', r => { r.referenced_workflows = [{ path: 'public/native.yml' }]; }],
]) test(`rejects exact run mismatch: ${name}`, async () => {
  const f = fixture(); mutate(f.runs[1001]); await assert.rejects(run(f), /^Error: PRIVATE_ACTIONS_[A-Z_]+$/);
});
for (const status of ['in_progress', 'queued', 'completed']) test(`later ${status} run invalidates an earlier pass`, async () => {
  const f = fixture(), sha = f.expected.IOS.control.sha;
  f.lists[sha].push({ ...f.runs[1001], id: 1003, status, conclusion: status === 'completed' ? 'failure' : null });
  await assert.rejects(run(f), /PRIVATE_ACTIONS_LATEST_RUN_REQUIRED/);
});
for (const [name, mutate] of [
  ['wrong job run', f => { f.jobs[1001][0].run_id++; }], ['wrong job attempt', f => { f.jobs[1001][0].run_attempt++; }],
  ['wrong job head', f => { f.jobs[1001][0].head_sha = '0'.repeat(40); }], ['wrong job name', f => { f.jobs[1001][0].name = 'Native IOS'; }],
  ['wrong hosted platform', f => { f.jobs[1001][0].labels = ['ubuntu-24.04']; }],
  ['unexpected self-hosted runner', f => { f.jobs[1001][0].labels.push('self-hosted'); }],
  ['missing native timing', f => { delete f.jobs[1001][0].started_at; }],
  ['overlapping native windows', f => { f.jobs[1002][0].started_at = '2026-10-22T23:19:00Z'; }],
  ['forged public check URL', f => { f.jobs[1001][0].check_run_url = 'https://api.github.com/repos/KeeperCommunity/bitcoin-keeper/check-runs/1401'; }],
  ['check ID alias', f => { f.checks[1401].id++; }], ['check name alias', f => { f.checks[1401].name = 'pass'; }],
  ['check suite alias', f => { f.checks[1401].check_suite.id++; }], ['check head alias', f => { f.checks[1401].head_sha = '0'.repeat(40); }],
  ['wrong check app ID', f => { f.checks[1401].app.id++; }], ['wrong check app slug', f => { f.checks[1401].app.slug = 'github-bot'; }],
  ['wrong suite app', f => { f.suites[1201].app = { id: 9, slug: 'github-actions' }; }],
  ['missing source check', f => { f.jobs[1001][0].steps = f.jobs[1001][0].steps.filter(v => v.name !== 'Verify exact source after native attempts'); }],
  ['duplicate source check', f => { f.jobs[1001][0].steps.push({ name: 'Verify exact source after native attempts', status: 'completed', conclusion: 'success' }); }],
  ['failed cleanup', f => { f.jobs[1001][0].steps.find(v => v.name.startsWith('Remove only')).conclusion = 'failure'; }],
  ['selected UI skipped', f => { f.jobs[1001][0].steps.find(v => v.name.startsWith('Run one iOS')).conclusion = 'skipped'; }],
  ['missing actual iOS driver', f => { f.jobs[1001][0].steps = f.jobs[1001][0].steps.filter(v => v.name !== 'Check hosted iOS driver before the app build'); }],
  ['unselected platform credited', f => { f.jobs[1001][0].steps.find(v => v.name.startsWith('Run one Android')).conclusion = 'success'; }],
  ['unselected step still running', f => { f.jobs[1001][0].steps.find(v => v.name.startsWith('Run one Android')).status = 'in_progress'; }],
]) test(`rejects job/check ownership or incomplete matrix: ${name}`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(run(f), /^Error: PRIVATE_ACTIONS_[A-Z_]+$/);
});
for (const [name, mutate] of [
  ['forged owner', a => { a.workflow_run.repository_id++; }], ['forged head repo', a => { a.workflow_run.head_repository_id++; }],
  ['borrowed run', a => { a.workflow_run.id++; }], ['borrowed head', a => { a.workflow_run.head_sha = '0'.repeat(40); }],
  ['different branch', a => { a.workflow_run.head_branch = 'sprint'; }], ['expired', a => { a.expired = true; }],
  ['old expiry', a => { a.expires_at = '2000-01-01'; }], ['missing digest', a => { delete a.digest; }],
  ['oversized', a => { a.size_in_bytes = 12582913; }], ['zero size', a => { a.size_in_bytes = 0; }],
  ['renamed attempt', a => { a.name = a.name.slice(0, -1) + '2'; }],
  ['artifact from before current native attempt', a => { a.created_at = '2026-10-22T23:09:00Z'; }],
  ['artifact after completed native job', a => { a.created_at = '2026-10-22T23:21:00Z'; }],
]) test(`rejects artifact identity: ${name}`, async () => {
  const f = fixture(); mutate(f.artifacts[1101]); await assert.rejects(run(f), /PRIVATE_ACTIONS_ARTIFACT_INVALID/);
});
test('rejects duplicate contradictory committed marker JSON despite correctly rebound blob SHA', async () => {
  const f = fixture(), sha = f.expected.IOS.control.sha;
  f.rebind(PRIVATE, sha, MARKER, Buffer.from(`{"schema":1,"app_sha":"${f.expected.IOS.app.sha}","platform":"ANDROID","platform":"IOS"}`));
  await assert.rejects(run(f), /PRIVATE_ACTIONS_ORIGIN_INVALID/);
});
test('marker exception cannot hide an owner executable mode change', async () => {
  const f = fixture(); f.trees[`${PRIVATE}:${f.expected.IOS.control.sha}`].tree.find(row => row.path === MARKER).mode = '100755';
  await assert.rejects(run(f), /PRIVATE_ACTIONS_MARKER_INVALID/);
});
test('rejects runtime differences even when both platform controllers contain the same malicious bytes', async () => {
  const f = fixture();
  for (const p of ['IOS', 'ANDROID']) f.rebind(PRIVATE, f.expected[p].control.sha, 'src/runtime.cjs', Buffer.from('module.exports = 1;\n'));
  await assert.rejects(run(f), /PRIVATE_ACTIONS_BACKEND_DELTA_INVALID/);
});
test('rejects a control policy that adds production runtime to its own allowlist', async () => {
  const f = fixture(), sha = f.expected.IOS.control.sha;
  const value = JSON.parse(f.files[`${PRIVATE}:${sha}`][POLICY]); value.control_paths.push('src/runtime.cjs');
  f.rebind(PRIVATE, sha, POLICY, Buffer.from(JSON.stringify(value)));
  await assert.rejects(run(f), /PRIVATE_ACTIONS_POLICY_INVALID/);
});
test('rejects any cross-controller source difference beyond the exact platform marker', async () => {
  const f = fixture(), sha = f.expected.ANDROID.control.sha;
  f.rebind(PRIVATE, sha, TOOL, Buffer.from('// another tool\n'));
  await assert.rejects(run(f), /PRIVATE_ACTIONS_CONTROL_EQUIVALENCE_INVALID/);
});
for (const [name, mutate] of [
  ['branch movement', f => { f.branch.commit.sha = 'f'.repeat(40); }],
  ['rerun', f => { f.runs[1001].run_attempt++; }],
  ['later queued run', f => { f.lists[f.expected.IOS.control.sha].push({ ...f.runs[1001], id: 1003, status: 'queued' }); }],
  ['artifact expiry', f => { f.artifacts[1101].expired = true; }],
  ['artifact digest change', f => { f.artifacts[1101].digest = 'sha256:' + '7'.repeat(64); }],
  ['artifact ownership change', f => { f.artifacts[1101].workflow_run.repository_id++; }],
  ['workflow revoked', f => { f.workflow.state = 'disabled_manually'; }],
  ['check app changed', f => { f.checks[1401].app = { id: 1, slug: 'github-actions' }; }],
  ['source check failed', f => { f.jobs[1001][0].steps.find(v => v.name === 'Verify exact source after native attempts').conclusion = 'failure'; }],
  ['clock expiry', f => { f.now += 86400001; }],
]) test(`post-source readback revokes ${name}`, async () => {
  const f = fixture(); let changed = false;
  f.onRequest = (name, a) => { if (!changed && name === 'source' && a.repo === 'bitcoin-keeper') { changed = true; mutate(f); } };
  await assert.rejects(run(f), /^Error: PRIVATE_ACTIONS_[A-Z_]+$/);
});
test('API exceptions disclose fixed vocabulary rather than URLs or private payloads', async () => {
  const f = fixture(); f.github.rest.repos.get = async () => { throw new Error('PRIVATE_URL https://private.invalid?token=secret'); };
  await assert.rejects(run(f), /^Error: PRIVATE_ACTIONS_ORIGIN_INVALID$/);
});
test('complete lists and raw source blob ownership are required', async () => {
  for (const mutate of [f => { f.github.rest.actions.listWorkflowRuns = async () => ({ status: 200, headers: { link: '<private>; rel="next"' }, data: { total_count: 1, workflow_runs: [f.runs[1001]] } }); },
    f => { const original = f.github.rest.repos.getContent; f.github.rest.repos.getContent = async a => {
      const value = await original(a); if (a.repo === 'bitcoin-keeper') value.data.sha = '0'.repeat(40); return value;
    }; }]) {
    const f = fixture(); mutate(f); await assert.rejects(run(f), /^Error: PRIVATE_ACTIONS_[A-Z_]+$/);
  }
});
for (const [name, mutate] of [
  ['branch moves', f => { f.branch.commit.sha = 'f'.repeat(40); }],
  ['workflow disabled', f => { f.workflow.state = 'disabled_manually'; }],
  ['repository becomes public', f => { f.privateRepo.private = false; }],
  ['later queued IOS run', f => { f.lists[f.expected.IOS.control.sha].push({ ...f.runs[1001], id: 1003, status: 'queued', conclusion: null }); }],
]) test(`terminal window fence rejects late final ANDROID artifact mutation: ${name}`, async () => {
  const f = fixture(); let readbacks = 0;
  f.onRequest = (name, a) => { if (name === 'artifact' && a.artifact_id === 1102 && ++readbacks === 2) mutate(f); };
  await assert.rejects(run(f), /^Error: PRIVATE_ACTIONS_[A-Z_]+$/);
});
function attemptTwo(f, platform) {
  const runId = f.expected[platform].execution.runId, oldId = runId + 100, id = oldId + 1000;
  f.expected[platform].execution.runAttempt = 2; f.runs[runId].run_attempt = 2;
  const job = f.jobs[runId][0], oldCheck = f.checks[runId + 400];
  job.run_attempt = 2; job.id += 1000; job.check_run_url = job.check_run_url.replace(String(runId + 400), String(runId + 1400));
  f.checks[runId + 1400] = { ...structuredClone(oldCheck), id: runId + 1400 };
  f.artifacts[id] = { ...structuredClone(f.artifacts[oldId]), id, name: f.artifacts[oldId].name.slice(0, -1) + '2' };
  f.artifacts[oldId].created_at = '2026-10-22T20:00:00Z';
  f.artifactLists[runId].push(id); return id;
}
test('latest successful attempt2 selects only its own artifact while preserving both attempt1 receipts', async () => {
  const f = fixture(); const ios = attemptTwo(f, 'IOS'), android = attemptTwo(f, 'ANDROID');
  const old = JSON.stringify([f.artifacts[1101], f.artifacts[1102]]), result = await run(f);
  assert.equal(result.platforms.IOS.artifact.id, ios); assert.equal(result.platforms.ANDROID.artifact.id, android);
  assert.equal(result.platforms.IOS.expected.execution.runAttempt, 2); assert.equal(result.platforms.ANDROID.expected.execution.runAttempt, 2);
  assert.equal(JSON.stringify([f.artifacts[1101], f.artifacts[1102]]), old);
  assert.deepEqual(f.artifactLists[1001], [1101, ios]); assert.deepEqual(f.artifactLists[1002], [1102, android]);
});
test('duplicate artifacts with the exact current attempt name remain ambiguous', async () => {
  const f = fixture(), id = attemptTwo(f, 'IOS');
  f.artifacts[id + 100] = { ...structuredClone(f.artifacts[id]), id: id + 100 }; f.artifactLists[1001].push(id + 100);
  await assert.rejects(run(f), /PRIVATE_ACTIONS_ARTIFACT_INVALID/);
});
test('an older attempt artifact cannot substitute for the missing current attempt name', async () => {
  const f = fixture(); attemptTwo(f, 'IOS'); f.artifactLists[1001] = [1101];
  await assert.rejects(run(f), /PRIVATE_ACTIONS_ARTIFACT_INVALID/);
});
for (const malformed of ['array', 'object', 'number']) {
  const value = sha => malformed === 'array' ? [sha] : malformed === 'object' ? { sha } : 123;
  test(`Git tree rejects ${malformed} SHA on an unread allowed controller source`, async () => {
    const f = fixture();
    for (const p of ['IOS', 'ANDROID']) {
      const row = f.trees[`${PRIVATE}:${f.expected[p].control.sha}`].tree.find(v => v.path === TOOL); row.sha = value(row.sha);
    }
    await assert.rejects(run(f), /PRIVATE_ACTIONS_TREE_INVALID/);
  });
  test(`Git tree rejects an additional unread app blob with ${malformed} SHA`, async () => {
    const f = fixture(); f.trees[`${APP}:${f.expected.IOS.app.sha}`].tree.push({ path: 'src/unread.cjs', type: 'blob', mode: '100644', sha: value('a'.repeat(40)) });
    await assert.rejects(run(f), /PRIVATE_ACTIONS_TREE_INVALID/);
  });
}
test('JSON arrays cannot coerce source expectations or API timestamp/digest scalars', async () => {
  for (const mutate of [f => { f.expected.IOS.app.sha = [f.expected.IOS.app.sha]; },
    f => { f.runs[1001].updated_at = [f.runs[1001].updated_at]; },
    f => { f.jobs[1001][0].started_at = [f.jobs[1001][0].started_at]; },
    f => { f.artifacts[1101].digest = [f.artifacts[1101].digest]; },
    f => { f.artifacts[1101].expires_at = [f.artifacts[1101].expires_at]; }]) {
    const f = fixture(); mutate(f); await assert.rejects(run(f), /^Error: PRIVATE_ACTIONS_[A-Z_]+$/);
  }
});
