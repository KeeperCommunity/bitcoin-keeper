'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const actual = require('./current-release-origin.cjs');
const { fixture, sarifFixture } = require('./fixtures/current-release-origin.cjs');
const POLICY_FAILED = /RELEASE_ORIGIN_SECURITY_POLICY_FAILED/;
const policy = f => actual.securityPolicy(f.sarif, f.analysis);

test('direct SARIF policy evaluates complete processed results without claiming a GAS join', () => {
  const f = sarifFixture(), result = policy(f);
  assert.deepEqual(result, { policy: 'CODEQL_EXACT_ANALYSIS_NO_HIGH_OR_CRITICAL_V1',
    results: 1, high_or_critical: 0, medium: 1, low: 0, quality: 0 });
  assert(Object.isFrozen(result));
  f.analysis.results_count = 0; f.sarif.runs[0].results = [];
  assert.equal(policy(f).results, 0);
});
for (const score of ['7', '8.1', '9.9', '10', '10.000'])
  test(`security policy blocks every High/Critical result including score ${score}`, () => {
    assert.throws(() => policy(sarifFixture({ score })), POLICY_FAILED);
  });
for (const [score, severity] of [['0', 'low'], ['3.9', 'low'], ['4', 'medium'], ['6.9', 'medium']])
  test(`security policy resolves numeric boundary ${score}`, () => {
    assert.equal(policy(sarifFixture({ score }))[severity], 1);
  });
for (const [name, mutate] of Object.entries({
  missingResults: f => { delete f.sarif.runs[0].results; },
  subsetResults: f => { f.analysis.results_count++; },
  extraResults: f => { f.analysis.results_count = 0; },
  twoRuns: f => { f.sarif.runs.push(structuredClone(f.sarif.runs[0])); },
  wrongVersion: f => { f.sarif.version = '2.0.0'; },
  wrongTool: f => { f.sarif.runs[0].tool.driver.name = 'label-only'; },
  wrongToolVersion: f => { f.sarif.runs[0].tool.driver.version = '0'; },
  contradictoryToolVersions: f => { f.sarif.runs[0].tool.driver.semanticVersion = '0'; },
  wrongCategory: f => { f.sarif.runs[0].automationDetails.id = 'unrelated/'; },
  missingSecuritySeverity: f => { delete f.sarif.runs[0].tool.driver.rules[0].properties['security-severity']; },
  numericSecuritySeverity: f => { f.sarif.runs[0].tool.driver.rules[0].properties['security-severity'] = 8.1; },
  invalidSecuritySeverity: f => { f.sarif.runs[0].tool.driver.rules[0].properties['security-severity'] = 'NaN'; },
  negativeSecuritySeverity: f => { f.sarif.runs[0].tool.driver.rules[0].properties['security-severity'] = '-1'; },
  outOfRangeSecuritySeverity: f => { f.sarif.runs[0].tool.driver.rules[0].properties['security-severity'] = '10.1'; },
  missingTags: f => { delete f.sarif.runs[0].tool.driver.rules[0].properties.tags; },
  suppressedFinding: f => { f.sarif.runs[0].results[0].suppressions = [{ kind: 'external' }]; },
  unresolvedKind: f => { f.sarif.runs[0].results[0].kind = 'review'; },
  missingRuleReference: f => { f.sarif.runs[0].results[0] = {}; },
  indexOutOfRange: f => { f.sarif.runs[0].results[0].ruleIndex = 1; },
  contradictoryRuleId: f => { f.sarif.runs[0].results[0].ruleId = 'different'; },
  duplicateRuleId: f => { f.analysis.rules_count++; f.sarif.runs[0].tool.driver.rules.push(structuredClone(f.sarif.runs[0].tool.driver.rules[0])); },
  ambiguousComponent: f => { f.sarif.runs[0].results[0].rule.toolComponent = { index: 1 }; },
})) test(`incomplete or ambiguous official SARIF fails closed: ${name}`, () => {
  const f = sarifFixture(); mutate(f); assert.throws(() => policy(f), /RELEASE_ORIGIN_SARIF_/);
});
test('a non-security quality result has an explicit tags array and no invented security score', () => {
  const f = sarifFixture(); f.sarif.runs[0].tool.driver.rules[0].properties = { tags: ['maintainability'] };
  assert.equal(policy(f).quality, 1);
});
test('a matching extension rule resolves against its named component', () => {
  const f = sarifFixture(), run = f.sarif.runs[0], result = run.results[0];
  const rule = structuredClone(run.tool.driver.rules[0]);
  run.tool.extensions = [{ name: 'Synthetic', guid: 'synthetic-extension', rules: [rule] }];
  delete result.ruleIndex;
  result.rule.toolComponent = { index: 0, name: 'Synthetic', guid: 'synthetic-extension' };
  assert.equal(policy(f).medium, 1);
});

test('actual branded public and original private evidence enables the bounded source bridge in a synthetic installation', async () => {
  const f = fixture(), proof = await f.collect();
  assert.equal(f.driver.isCurrentReleaseOrigin(proof, f.request), true);
  assert.equal(actual.isCurrentReleaseOrigin(proof, f.request), false, 'test policy copy is not installed authority');
  assert.equal(proof.canonical_cases, 7);
  assert.equal(proof.tests.legacy_v2_characterization_not_release_credit, true);
  assert.equal(proof.tests.jobs.find(j => j.name === 'Automatic backup native Realm and Relay').conclusion, 'failure');
  assert.equal(proof.security.direct_analysis_result_binding_verified, true);
  assert.equal(proof.security.gas_analysis_join_verified, false);
  assert.equal(proof.security.policy.high_or_critical, 0);
  assert(Object.isFrozen(proof.security.policy));
  assert.equal(proof.authorization_eligible, false);
  assert.equal(proof.execution_allowed, false);
  assert.equal(proof.release_authorized, false);
  assert.match(proof.physical, /NOT RUN/);
  assert.equal(JSON.stringify(proof).includes('PRIVATE_SENTINEL'), false);
  for (const forged of [{ ...proof }, structuredClone(proof), JSON.parse(JSON.stringify(proof)),
    { status: 'PASS', ...proof }]) assert.equal(f.driver.isCurrentReleaseOrigin(forged, f.request), false);
  assert.equal(f.driver.isCurrentReleaseOrigin(proof, { ...f.request, build: '124' }), false);
});
test('production finite installation rejects an unselected synthetic source profile', async () => {
  const f = fixture();
  await assert.rejects(actual.collectCurrentReleaseOrigin(f.p.github, f.context, f.request, f.options),
    /^Error: RELEASE_ORIGIN_UNVERIFIED$/);
  assert.deepEqual(f.f.calls, []);
  assert(!f.calls.some(path => path.includes('/code-scanning/')));
});
for (const operation of ['ios-signed-build', 'android-signed-build', 'testflight-upload', 'play-internal-upload'])
  test(`same current source contract supports the separately approved operation ${operation}`, async () => {
    const f = fixture(); f.request.operation = operation;
    if (operation.endsWith('-upload')) f.request.artifactId = '123';
    const proof = await f.collect();
    assert(f.driver.isCurrentReleaseOrigin(proof, f.request));
    assert.equal(proof.execution_allowed, false, 'source proof never invokes an adapter');
  });
for (const [name, mutate, error] of [
  ['old upload source', f => { f.request.operation = 'testflight-upload'; f.request.sourceSha = 'b'.repeat(40); }, /CURRENT_INSTALLED_SOURCE/],
  ['different driver source', f => { f.request.driverSha = 'b'.repeat(40); }, /CURRENT_INSTALLED_SOURCE/],
  ['unprotected dispatch ref', f => { f.context.ref = 'refs/heads/other'; }, /CURRENT_INSTALLED_SOURCE/],
  ['different repository', f => { f.context.repo = { owner: 'different', repo: 'bitcoin-keeper' }; }, /CURRENT_INSTALLED_SOURCE/],
  ['untrusted dispatch event', f => { f.context.eventName = 'pull_request'; }, /CURRENT_INSTALLED_SOURCE/],
  ['wrong current worker job', f => { f.context.job = 'unrelated'; }, /WORKER_JOBS_INVALID/],
  ['wrong current worker attempt', f => { f.options.workerAttempt++; }, /WORKER_RUN_INVALID/],
  ['wrong current worker source', f => { f.runs[900].head_sha = 'b'.repeat(40); }, /WORKER_RUN_INVALID/],
  ['completed current worker', f => { f.runs[900].status = 'completed'; }, /WORKER_RUN_INVALID/],
  ['forged current worker check', f => { f.checks[19010].app.id = 7; }, /WORKER_CHECK_INVALID/],
  ['required Tests failure', f => { f.jobs[100][1].conclusion = f.checks[11011].conclusion = 'failure'; }, /JOB_INVALID/],
  ['required Lint failure', f => { f.jobs[100][0].conclusion = f.checks[11010].conclusion = 'failure'; }, /JOB_INVALID/],
  ['required Tests step skipped', f => { f.jobs[100][1].steps[0].conclusion = 'skipped'; }, /TEST_STEP_FAILED/],
  ['unknown Tests job', f => { f.jobs[100][2].name = 'unreviewed-new-security-check'; }, /TEST_JOBS_UNREVIEWED/],
  ['contradictory Tests run conclusion', f => { f.runs[100].conclusion = 'success'; }, /TEST_RUN_CONTRADICTION/],
  ['CodeQL producer failure', f => { f.runs[200].conclusion = 'failure'; }, /RUN_INVALID/],
  ['forged CodeQL Actions app', f => { f.checks[12010].app.id = 7; }, /CHECK_INVALID/],
  ['CodeQL upload provenance step skipped', f => { f.jobs[200][0].steps[3].conclusion = 'skipped'; }, /CODEQL_STEP_FAILED/],
  ['failed official GAS check', f => { f.gas.conclusion = 'failure'; }, /SECURITY_CHECK_NOT_SUCCESS/],
  ['pending official GAS check', f => { f.gas.status = 'in_progress'; f.gas.conclusion = null; }, /SECURITY_CHECK_NOT_SUCCESS/],
  ['forged GAS application', f => { f.gas.app.id = 15368; }, /SECURITY_CHECK_NOT_SUCCESS/],
  ['original provenance artifact expired', f => { f.codeqlArtifact.expired = true; }, /CODEQL_ARTIFACT_INVALID/],
  ['official SARIF processing pending', f => { f.codeqlProcessing.processing_status = 'pending'; }, /CODEQL_PROCESSING/],
  ['official analysis wrong source', f => { f.analysis.commit_sha = 'b'.repeat(40); }, /CODEQL_ANALYSIS_INVALID/],
  ['official analysis count identifies a subset', f => { f.analysis.results_count++; }, /SARIF_IDENTITY_INVALID/],
  ['official analysis has warnings', f => { f.analysis.warning = 'incomplete extraction'; }, /CODEQL_ANALYSIS_INVALID/],
  ['known severity 8.1 finding', f => { f.sarif.runs[0].tool.driver.rules[0].properties['security-severity'] = '8.1'; }, POLICY_FAILED],
  ['security API authorization denied', f => { f.onApi = url => { if (url.pathname.includes('/code-scanning/')) f.transportStatus = 403; }; }, /API_UNAVAILABLE/],
]) test(`real collection rejects ${name}`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(f.collect(), error);
});
test('official source policy rejects edited workflow bytes even with correct Git blob metadata', async () => {
  const crypto = require('node:crypto'), f = fixture(), item = f.content['test.yml'];
  const bytes = Buffer.from(Buffer.from(item.content, 'base64').toString() + '\n# unreviewed');
  item.content = bytes.toString('base64'); item.size = bytes.length;
  item.sha = crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  await assert.rejects(f.collect(), /WORKFLOW_POLICY_UNREVIEWED/);
});
test('an untrusted workflow content Git blob cannot inherit a known workflow policy digest', async () => {
  const f = fixture(); f.content['test.yml'].sha = 'b'.repeat(40);
  await assert.rejects(f.collect(), /WORKFLOW_SOURCE_INVALID/);
});
test('a newly failed exact-source producer revokes the prior successful phase', async () => {
  const f = fixture(); let reads = 0;
  f.onApi = url => {
    if (url.pathname.endsWith('/actions/runs/200') && ++reads === 2) f.runs[200].conclusion = 'failure';
  };
  await assert.rejects(f.collect(), /RUN_INVALID/);
});
test('live public pin revocation during official security reads cannot mint a source capability', async () => {
  const f = fixture();
  f.onApi = url => { if (url.pathname.includes('/code-scanning/')) f.p.pin.value = ''; };
  await assert.rejects(f.collect(), /^Error: RELEASE_ORIGIN_UNVERIFIED$/);
});
test('private original evidence is rechecked after all official security reads', async () => {
  const f = fixture();
  f.onApi = url => { if (url.pathname.includes('/code-scanning/')) f.f.artifacts[1101].expired = true; };
  await assert.rejects(f.collect(), /^Error: RELEASE_ORIGIN_UNVERIFIED$/);
});
test('later official SARIF result changes cannot retain an earlier security policy result', async () => {
  const f = fixture(); let sarifReads = 0;
  f.onApi = (url, init) => {
    if (url.pathname.endsWith('/code-scanning/analyses/990') && init.headers.accept === 'application/sarif+json' && ++sarifReads === 2)
      f.sarif.runs[0].tool.driver.rules[0].properties['security-severity'] = '8.1';
  };
  await assert.rejects(f.collect(), POLICY_FAILED);
});
test('current worker provenance is rechecked after private and security evidence', async () => {
  const f = fixture(); let workerReads = 0;
  f.onApi = url => { if (url.pathname.endsWith('/actions/runs/900') && ++workerReads === 2) f.runs[900].run_attempt++; };
  await assert.rejects(f.collect(), /WORKER_RUN_INVALID/);
});

const { gateFixture } = require('./fixtures/current-release-origin.cjs');
test('actual gate SDK collection preserves the genuine source capability in the same process', async () => {
  const f = gateFixture();
  try {
    const evidence = await f.collectGate(), plan = f.validate(evidence);
    assert.equal(plan.state, 'PROTECTED_OPERATION_INPUTS_VERIFIED');
    assert(Object.isFrozen(evidence)); assert(Object.isFrozen(evidence.manifest.baselines));
    assert(Object.isFrozen(evidence.sources)); assert(Object.isFrozen(evidence.environment.protection_rules));
    assert.throws(() => { evidence.comment.body += '\nchanged'; }, TypeError);
    assert.equal(plan.environment, 'keeper-release-android');
    assert.equal(plan.execution_allowed, false);
    assert.equal(plan.release_worker_implemented, true);
    assert.equal(evidence.statuses, undefined, 'no PR-only local status is substituted for native proofs');
    for (const copy of [{ ...evidence }, structuredClone(evidence),
      Object.defineProperties({}, Object.getOwnPropertyDescriptors(evidence))]) {
      copy.statuses = { sha: f.request.sourceSha, state: 'success', statuses: [
        { context: 'keeper/local-validation', state: 'success' }] };
      copy.checks = { total_count: 2, check_runs: ['Tests', 'CodeQL'].map(name =>
        ({ name, head_sha: f.request.sourceSha, status: 'completed', conclusion: 'success' })) };
      assert.throws(() => f.validate(copy), /TRUSTED_CI_ORIGIN_NOT_VERIFIED/,
        'copied Symbols and successful JSON names cannot enter the private evidence WeakSet');
    }
    assert.throws(() => require('./protected-release-plan.cjs').validateEvidence(f.request, evidence, f.f.now),
      /STATUS_NOT_EXACT_SUCCESS/, 'synthetic module installation cannot authenticate production gate');
  } finally { f.cleanup(); }
});
for (const [name, mutate] of Object.entries({
  ownerPermission: f => { f.permission.permission = 'read'; },
  ownerApproval: f => { f.approval.body += '\nchanged'; },
  protectedDriver: f => { f.driverBranch.protected = false; },
  protectedRelease: f => { f.releaseBranch.commit.sha = 'b'.repeat(40); },
  independentReview: f => { f.environment.protection_rules[0].prevent_self_review = false; },
  adminBypass: f => { f.environment.can_admins_bypass = true; },
})) test(`gate terminal metadata reread rejects revoked ${name}`, async () => {
  const f = gateFixture();
  try {
    let reads = 0;
    f.onApi = url => { if (url.pathname.includes('/code-scanning/analyses/990') && ++reads === 1) mutate(f); };
    await assert.rejects(f.collectGate(), /APPROVAL_OR_PROTECTION_CHANGED/);
  } finally { f.cleanup(); }
});
for (const [name, mutate, error] of [
  ['expired approval', f => { f.approval.body = f.approval.body.replace('2026-10-23T00:30:00Z', '2026-10-22T22:30:00Z'); }, /APPROVAL_STALE_OR_INVALID/],
  ['wrong approved identity', f => { f.approval.body = f.approval.body.replace('2'.repeat(64), '4'.repeat(64)); }, /APPROVAL_SCOPE_MISMATCH/],
  ['removed independent reviewer', f => { f.environment.protection_rules[0].reviewers = []; }, /INDEPENDENT_ENVIRONMENT_REVIEW_REQUIRED/],
  ['stale store counter proof', f => {
    f.manifest.baselines.ios.verifiedAt = '2026-10-20T00:00:00Z';
    require('node:fs').writeFileSync(require('node:path').join(f.candidate, 'release/version.json'), JSON.stringify(f.manifest));
  }, /RELEASE_SOURCE_PREFLIGHT_FAILED/],
  ['inconsistent native source version', f => {
    require('node:fs').writeFileSync(require('node:path').join(f.candidate, 'package.json'), '{"version":"0.0.0"}');
  }, /RELEASE_SOURCE_PREFLIGHT_FAILED/],
]) test(`a branded origin still cannot waive ${name}`, async () => {
  const f = gateFixture();
  try { mutate(f); const evidence = await f.collectGate(); assert.throws(() => f.validate(evidence), error); }
  finally { f.cleanup(); }
});
for (const [runId, error] of [[100, /TEST_STEP_FAILED/], [200, /CODEQL_STEP_FAILED/]])
  test(`duplicate required step names cannot hide a failure in producer ${runId}`, async () => {
    const f = fixture(), job = f.jobs[runId].find(row => row.steps);
    job.steps.push({ ...job.steps[0], conclusion: 'failure' });
    await assert.rejects(f.collect(), error);
  });

test('source capability never expands to public submission or distribution operations', async () => {
  const f = fixture(); f.request.operation = 'public-release';
  await assert.rejects(f.collect(), /CURRENT_INSTALLED_SOURCE_REQUIRED/);
  assert.deepEqual(f.calls, []);
});
