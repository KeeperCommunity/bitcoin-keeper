'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture, digest, archiveBytes } = require('./fixtures/actions-software.cjs');
const { collectPublicSoftwareEvidence, collectPrivateSoftwareEvidence, isPublicSoftwareEvidence, readPublicArtifactBytes, PUBLIC_CHECKS } =
  require('../native/actions_software_evidence.cjs');
const collect = state => collectPublicSoftwareEvidence(state.github, state.context, state.input, state.options);

test('actual producer-shaped public facts bind app and different merge control without parent/release credit', async () => {
  const state = fixture(), result = await collect(state);
  assert.deepEqual(Object.keys(state.run.pull_requests[0].head.repo).sort(), ['id', 'name', 'url']);
  assert.deepEqual(Object.keys(state.run.pull_requests[0].base.repo).sort(), ['id', 'name', 'url']);
  assert.notEqual(result.source_sha, result.workflow_sha);
  assert.equal(result.selected_route, 'public-reusable'); assert.equal(result.software_complete, false);
  assert.equal(result.installed_trust, 'UNVERIFIED'); assert.equal(isPublicSoftwareEvidence(result), true);
  assert.equal(isPublicSoftwareEvidence(structuredClone(result)), false);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.platforms) && Object.isFrozen(result.platforms.IOS));
  for (const name of ['release_ready', 'authorization_eligible', 'release_authorized', 'execution_allowed']) assert.equal(result[name], false);
  assert.equal(result.platforms.IOS.archive_sha256, digest(state.archives[101]));
  for (const row of Object.values(result.platforms)) {
    assert.deepEqual(Object.keys(row.executed_checks), Object.keys(PUBLIC_CHECKS));
    assert.ok(Object.values(row.executed_checks).every(check => check.status === 'PASS'));
  }
  assert.equal(state.fetchOptions.redirect, 'error'); assert.equal('headers' in state.fetchOptions, false);
  assert.ok(state.calls.filter(row => row.name === 'download').every(row => row.options.request.parseSuccessResponseBody === false &&
    typeof row.options.request.fetch === 'function'));
  assert.equal(state.apiFetchOptions.redirect, 'manual');
  assert.equal(state.apiBodyCancellations, 2);
  assert.ok(state.calls.every(row => !/create|update|dispatch|delete|status/.test(row.name)));
  assert.ok(state.calls.filter(row => row.name === 'source').every(row => row.options.ref === result.source_sha));
  assert.ok(state.calls.filter(row => row.name === 'runs').every(row => !('status' in row.options) && !('conclusion' in row.options)));
});

const negative = {
  'fork repository': s => { s.pr.head.repo = { ...s.pr.head.repo, id: 2 }; },
  'wrong numeric repository': s => { s.repo.id = 2; },
  'wrong repository name': s => { s.repo.full_name = 'other/bitcoin-keeper'; },
  'wrong context event': s => { s.context.eventName = 'pull_request_target'; },
  'R4 excluded': s => { s.context.payload.pull_request.number = 7045; },
  draft: s => { s.pr.draft = true; },
  diagnostic: s => { s.pr.labels.push({ name: 'keeper/native-diagnostic' }); },
  legacy: s => { s.pr.labels.push({ name: 'keeper/legacy-native' }); },
  'moved app head': s => { s.pr.head.sha = '0'.repeat(40); },
  'moved base': s => { s.branch.commit.sha = '0'.repeat(40); },
  'unprotected base': s => { s.branch.protected = false; },
  'caller workflow ref': s => { s.input.workflowRef = 'other/workflow'; },
  'worker control sha': s => { s.run.referenced_workflows[0].sha = s.pr.head.sha; },
  'worker control path': s => { s.run.referenced_workflows[0].path = 'other/worker@' + s.input.workflowSha; },
  'worker control ref': s => { s.run.referenced_workflows[0].ref = 'refs/heads/sprint'; },
  'missing worker control': s => { s.run.referenced_workflows = []; },
  'duplicate worker control': s => { s.run.referenced_workflows.push(s.run.referenced_workflows[0]); },
  'workflow inactive': s => { s.workflow.state = 'disabled_manually'; },
  'workflow wrong path': s => { s.workflow.path = 'other.yml'; },
  'workflow wrong id': s => { s.run.workflow_id = 2; },
  'run wrong source': s => { s.run.head_sha = '0'.repeat(40); },
  'run wrong event': s => { s.run.event = 'push'; },
  'run wrong branch': s => { s.run.head_branch = 'codex/other'; },
  'run stale attempt': s => { s.run.run_attempt = 1; },
  'run index stale attempt': s => { s.runs[0].run_attempt = 1; },
  'run cancelled': s => { s.run.status = 'completed'; s.run.conclusion = 'cancelled'; },
  'run queued': s => { s.run.status = 'queued'; },
  'later failed run': s => { s.runs.push({ ...s.run, id: 91, conclusion: 'failure', status: 'completed' }); },
  'later pending run': s => { s.runs.push({ ...s.run, id: 91, status: 'queued' }); },
  'unrelated PR': s => { s.run.pull_requests[0].number = 9001; },
  'duplicate linked PR': s => { s.run.pull_requests.push(structuredClone(s.run.pull_requests[0])); },
  'linked head repo ID': s => { s.run.pull_requests[0].head.repo.id = 2; },
  'linked base repo ID': s => { s.run.pull_requests[0].base.repo.id = 2; },
  'linked head SHA': s => { s.run.pull_requests[0].head.sha = '0'.repeat(40); },
  'linked head ref': s => { s.run.pull_requests[0].head.ref = 'codex/other'; },
  'linked base ref': s => { s.run.pull_requests[0].base.ref = 'other'; },
  'wrong original base': s => { s.run.pull_requests[0].base.sha = '0'.repeat(40); },
  'stale timestamp': s => { s.run.updated_at = '2026-10-20T20:00:00Z'; },
  'future timestamp': s => { s.run.updated_at = '2026-10-23T20:00:00Z'; },
  'incomplete runs': s => { s.total.workflow_runs = 101; },
  'continuation link': s => { s.headers = { link: '<https://api.github.com/next>; rel="next"' }; },
  'uninstalled CI': s => { const tree = structuredClone(s.tree); tree.tree[0].sha = '0'.repeat(40); s.treeOverrides[s.pr.base.sha] = tree; },
  'unreviewed merge control': s => { const tree = structuredClone(s.tree); tree.tree[0].sha = '0'.repeat(40); s.treeOverrides[s.input.workflowSha] = tree; },
  'truncated tree': s => { s.tree.truncated = true; },
  'app commit tree mismatch': s => { s.treeOverrides[s.pr.head.sha] = { ...s.tree, sha: '0'.repeat(40) }; },
  'control commit tree mismatch': s => { s.treeOverrides[s.input.workflowSha] = { ...s.tree, sha: '0'.repeat(40) }; },
  'foreign suite App': s => { s.suite.app.id = 1; },
  'foreign suite source': s => { s.suite.head_sha = '0'.repeat(40); },
  'missing job': s => { s.jobs.pop(); },
  'duplicate job': s => { s.jobs.push(s.jobs[0]); },
  'job stale attempt': s => { s.jobs[0].run_attempt = 1; },
  'job wrong run': s => { s.jobs[0].run_id = 91; },
  'job skipped': s => { s.jobs[0].conclusion = 'skipped'; },
  'missing feature step': s => { s.jobs[0].steps.splice(3, 1); },
  'duplicate feature step': s => { s.jobs[0].steps.push(s.jobs[0].steps[3]); },
  'failed product step': s => { s.jobs[0].steps[4].conclusion = 'failure'; },
  'foreign check URL': s => { s.jobs[0].check_run_url = 'https://api.github.com/repos/other/repo/check-runs/30'; },
  'check wrong ID': s => { s.checks[30].id = 99; },
  'check wrong name': s => { s.checks[30].name = 'startup only'; },
  'check wrong suite': s => { s.checks[30].check_suite.id = 99; },
  'check wrong App': s => { s.checks[30].app.id = 99; },
  'check wrong App slug': s => { s.checks[30].app.slug = 'other'; },
  'check wrong head': s => { s.checks[30].head_sha = '0'.repeat(40); },
  'check failed': s => { s.checks[30].conclusion = 'failure'; },
  'source content corrupt': s => { s.files[0].file.content += '!!'; },
  'source object spoofed': s => { s.files[0].file.sha = '0'.repeat(40); },
  'source path spoofed': s => { s.files[0].file.path = 'arbitrary'; },
  'artifact missing': s => { s.artifacts.pop(); },
  'artifact duplicate': s => { s.artifacts.push(s.artifacts[0]); },
  'artifact diagnostic relabel': s => { s.artifacts[0].name = s.artifacts[0].name.replace('release', 'diagnostic'); },
  'artifact canonical relabel': s => { s.artifacts[0].name = s.artifacts[0].name.replace('release', 'canonical'); },
  'artifact wrong run': s => { s.artifacts[0].workflow_run.id = 91; },
  'artifact wrong source': s => { s.artifacts[0].workflow_run.head_sha = '0'.repeat(40); },
  'artifact wrong repository': s => { s.artifacts[0].workflow_run.repository_id = 1; },
  'artifact wrong attempt name': s => { s.artifacts[0].name = s.artifacts[0].name.slice(0, -1) + '1'; },
  'artifact expired flag': s => { s.artifacts[0].expired = true; },
  'artifact expiry timestamp': s => { s.artifacts[0].expires_at = '2026-10-22T19:00:00Z'; },
  'artifact digest': s => { s.artifacts[0].digest = 'sha256:' + '0'.repeat(64); },
  'artifact byte length': s => { s.artifacts[0].size_in_bytes++; },
  'artifact size cap': s => { s.artifacts[0].size_in_bytes = 1024 * 1024 + 1; },
  'archive API automatic redirect': s => { s.downloadStatus = 200; },
  'archive foreign host': s => { s.location = 'https://evil.invalid/file.zip'; },
  'archive credential URL': s => { s.location = 'https://private@evidence.blob.core.windows.net/file.zip'; },
  'archive HTTP': s => { s.location = 'http://evidence.blob.core.windows.net/file.zip'; },
  'archive malformed URL': s => { s.location = 'PRIVATE_PAYLOAD'; },
  'archive stream oversized': s => { s.archiveOverride = Buffer.alloc(1024 * 1024 + 1); },
  'archive undeclared stream oversized': s => { s.archiveOverride = Buffer.alloc(1024 * 1024 + 1); s.fetchHeaders = {}; },
  'archive declared length smaller': s => { s.fetchHeaders = { 'Content-Length': '1' }; },
  'archive declared length malformed': s => { s.fetchHeaders = { 'Content-Length': 'PRIVATE_PAYLOAD' }; },
  'archive storage denied': s => { s.fetchStatus = 403; },
  'API privacy': s => { s.apiError = true; },
};
for (const [name, mutate] of Object.entries(negative)) test(`rejects ${name}`, async () => {
  const state = fixture(); mutate(state);
  await assert.rejects(collect(state), error => /^SOFTWARE_[A-Z0-9_]+$/.test(error.message) && !error.message.includes('PRIVATE_PAYLOAD'));
});
for (const [name, change] of Object.entries({
  'source SHA': v => { v.source_sha = '0'.repeat(40); },
  'control SHA': v => { v.workflow_sha = '0'.repeat(40); },
  'partial raw stages': v => { v.product_ui.samples[0].completed_stages.pop(); },
  'only four measurements': v => { v.product_ui.samples.pop(); },
  'wrong installed bytes': v => { v.product_ui.samples[0].installed_artifact.inventory_sha256 = '0'.repeat(64); },
  'self-selected worker hash': v => { v.r5_feature_evidence.source_functions[0].sha256 = '0'.repeat(64); },
  'failed companion cleanup': v => { v.product_ui.vault_references_ui.cleanup = 'FAILED'; },
})) test(`P1 composition rejects authenticated artifact with ${name}`, async () => {
  const state = fixture(); state.replaceReceipt('IOS', change);
  await assert.rejects(collect(state), /^Error: SOFTWARE_EVIDENCE_INVALID$/);
});
for (const [name, mutate] of Object.entries({
  'moved source': s => { s.pr.head.sha = '0'.repeat(40); },
  'rerun attempt': s => { s.run.run_attempt++; s.runs[0].run_attempt++; },
  'new failed run': s => { s.runs.push({ ...s.run, id: 91, status: 'completed', conclusion: 'failure' }); },
  'new pending run': s => { s.runs.push({ ...s.run, id: 91, status: 'queued' }); },
  'changed check ownership': s => { s.checks[30].app.id = 1; },
  'expired artifact': s => { s.artifacts[0].expired = true; },
  'changed artifact digest': s => { s.artifacts[0].digest = 'sha256:' + '0'.repeat(64); },
  'ambiguous new artifact': s => { s.artifacts.push(s.artifacts[0]); },
  'elapsed freshness': s => { s.now += 86400001; },
})) test(`postdownload fence rejects ${name}`, async () => {
  const state = fixture(); state.afterDownload = mutate;
  await assert.rejects(collect(state), /^Error: SOFTWARE_[A-Z0-9_]+$/);
  assert.equal(state.fetches, 2);
});
test('no proposed private manifest, caller labels or canonical name activates a private adapter', () => {
  for (const value of [undefined, { status: 'PASS' }, { selected_route: 'canonical-hosted-native', feature_matrix_complete: true }])
    assert.throws(() => collectPrivateSoftwareEvidence(value), /^Error: SOFTWARE_PRIVATE_CONTRACT_NOT_FROZEN$/);
});
test('exported shared transport has no proof authority and rejects invalid artifact IDs before API work', async () => {
  const state = fixture();
  for (const value of [0, -1, 1.5, '101', Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(readPublicArtifactBytes(state.github, value, state.options), /^Error: SOFTWARE_ARTIFACT_IDENTITY_INVALID$/);
  assert.equal(state.calls.length, 0);
  const bytes = await readPublicArtifactBytes(state.github, 101, state.options);
  assert.equal(digest(bytes), digest(state.archives[101]));
  assert.equal(isPublicSoftwareEvidence(bytes), false);
});
test('authority movement during final artifact readback cannot reuse the earlier run snapshot', async () => {
  for (const change of [s => { s.pr.head.sha = '0'.repeat(40); }, s => { s.run.run_attempt++; },
    s => { s.runs.push({ ...s.run, id: 91, status: 'queued' }); }]) {
    const state = fixture(); state.afterArtifactRead = change;
    await assert.rejects(collect(state), /^Error: SOFTWARE_[A-Z0-9_]+$/);
    assert.equal(state.artifactReads, 4);
  }
});
for (const [name, transform] of Object.entries({
  'contradictory root smoke': raw => '{"smoke":"FAIL",' + raw.slice(1),
  'escaped duplicate root smoke': raw => '{"sm\\u006fke":"FAIL",' + raw.slice(1),
  'nested raw observation': raw => raw.replace('"startup_to_passcode_ms":', '"startup_to_passcode_ms":-1,"startup_to_passcode_ms":'),
  'unrelated nested object': raw => '{"ignored":{"same":0,"same":1},' + raw.slice(1),
  'unrelated array object': raw => '{"ignored":[{"same":0,"s\\u0061me":1}],' + raw.slice(1),
  'nonfinite overflow': raw => '{"ignored":1e400,' + raw.slice(1),
  'nonfinite nested overflow': raw => '{"ignored":[{"number":-1e400}],' + raw.slice(1),
  NaN: raw => '{"ignored":NaN,' + raw.slice(1),
  Infinity: raw => '{"ignored":Infinity,' + raw.slice(1),
  'trailing document': raw => raw + '\n{}',
})) test('correctly rehashed original ZIP cannot brand ' + name + ' as software evidence', async () => {
  const state = fixture(), original = JSON.stringify(state.metadata.IOS), changed = transform(original);
  assert.notEqual(changed, original);
  const bytes = archiveBytes(Buffer.from(changed), 'IOS');
  state.archives[101] = bytes;
  state.artifacts[0].size_in_bytes = bytes.length;
  state.artifacts[0].digest = 'sha256:' + digest(bytes);
  const originalDigest = digest(bytes);
  await assert.rejects(collect(state), /^Error: SOFTWARE_[A-Z0-9_]+$/);
  assert.equal(state.artifacts[0].digest, 'sha256:' + originalDigest);
  assert.equal(digest(state.archives[101]), originalDigest);
});
