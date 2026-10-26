'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function validateEvents(suite, text, status, app) {
  assert.equal(status, 0, 'Real Node test process failed or timed out');
  const events = text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const results = events.filter(e => ['test:pass', 'test:fail'].includes(e.type));
  assert.equal(results.length, suite.cases.length, 'Missing or additional actual test result');
  const expected = suite.cases.map(c => c.name).sort();
  assert.equal(new Set(expected).size, expected.length, 'Duplicate expected case name');
  assert.deepEqual(results.map(e => e.name).sort(), expected, 'Actual names differ from source inventory');
  for (const e of results) {
    assert.equal(e.type, 'test:pass', 'Actual test failure');
    assert.equal(e.nesting, 0, 'Unexpected nested test changes the selected inventory');
    assert.equal(e.file, path.join(app, suite.file), 'Result belongs to a different file');
    assert.ok(!e.skip && !e.todo, 'Skip and todo cannot satisfy a proof obligation');
  }
  return suite.cases.map(c => ({ ...c, file: suite.file, status: 'PASS',
    durationMs: results.find(e => e.name === c.name).details?.duration_ms }));
}
function validatePlan(plan, app) {
  assert.equal(plan.schema, 1);
  assert.equal(plan.protectedCases, 347);
  assert.equal(plan.realmMigrationCases, 4);
  assert.equal(plan.totalCases, 351);
  assert.equal(plan.suites.length, 33);
  const files = plan.suites.map(s => s.file);
  assert.equal(new Set(files).size, 33);
  const actual = fs.readdirSync(path.join(app, 'tests/recovery')).filter(n => /^protected.*\.proof\.cjs$/.test(n)).map(n => 'tests/recovery/' + n).sort();
  assert.deepEqual(files.filter(f => /\/protected/.test(f)).sort(), actual, 'Omitted protected proof file');
  assert.equal(plan.suites.reduce((n, s) => n + s.cases.length, 0), 351);
  const cases = plan.suites.flatMap(s => s.cases.map(c => ({ ...c, file: s.file })));
  assert.equal(new Set(cases.map(c => c.id)).size, 351);
  for (const s of plan.suites) {
    assert.equal(digest(fs.readFileSync(path.join(app, s.file))), s.sha256, 'Proof bytes changed');
    for (let i = 0; i < s.cases.length; i++) assert.equal(s.cases[i].id, path.basename(s.file) + ':' + (i + 1));
  }
  assert.equal(plan.legacyObligations.length, 295);
  assert.equal(new Set(plan.legacyObligations.map(r => r.legacy.id)).size, 295);
  for (const r of plan.legacyObligations) {
    assert.ok(r.protected.length, 'Unmapped historical obligation');
    for (const p of r.protected) {
      const c = cases.find(c => c.id === p.id);
      assert.ok(c, 'Mapping references a missing actual test');
      assert.equal(c.name, p.actualRegisteredName);
      assert.equal(c.file, p.file);
      assert.equal(plan.suites.find(s => s.file === p.file).sha256, p.currentFileSha256);
    }
  }
  assert.equal(Object.keys(plan.originalLegacyFileHashes).length, 9);
  for (const [file, hash] of Object.entries(plan.originalLegacyFileHashes))
    assert.equal(digest(fs.readFileSync(path.join(app, file))), hash, 'Historical public-v2 suite changed');
}
function main() {
  assert.deepEqual(process.argv.slice(2), []);
  const workspace = process.env.GITHUB_WORKSPACE;
  assert.ok(workspace && path.isAbsolute(workspace));
  assert.equal(process.env.GITHUB_REPOSITORY, 'KeeperCommunity/bitcoin-keeper-private');
  assert.equal(process.env.GITHUB_REPOSITORY_ID, '839671816');
  assert.equal(process.env.GITHUB_JOB, 'protected-backup-v3');
  assert.equal(process.versions.node, '22.23.4');
  const app = path.join(workspace, 'app'), control = app;
  const { verifySource } = require('../scripts/verify-ci-source.cjs');
  const output = path.join(workspace, 'proof-results');
  function fence() {
    const source = verifySource({ root: app });
    const p = spawnSync('python3', [path.join(app, '.github/ci/protected_relay_source.py'), 'verify'],
      { encoding: 'utf8', timeout: 120000 });
    assert.equal(p.status, 0, 'Selected original backend verification failed: ' + p.stderr);
    const backend = JSON.parse(p.stdout.trim());
    return { sourceVerification: 'PASS', app: source.source_sha, appTree: source.source_tree,
      backend: backend.backend, backendTree: backend.tree, backendFiles: backend.files,
      backendArchiveSha256: backend.archiveSha256, runId: source.run_id, runAttempt: source.run_attempt,
      workflowSha: source.workflow_sha };
  }
  const admission = fence();
  const plan = JSON.parse(fs.readFileSync(path.join(control, '.github/ci/r5-comprehensive351-plan.json'), 'utf8'));
  assert.equal(plan.backend, admission.backend);
  validatePlan(plan, app);
  fs.mkdirSync(output, { recursive: false });
  const ledger = { schema: 1, status: 'RUNNING', app: admission.app, appTree: admission.appTree,
    backend: plan.backend, control: process.env.GITHUB_SHA, run: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT, node: process.versions.node,
    planSha256: digest(fs.readFileSync(path.join(control, '.github/ci/r5-comprehensive351-plan.json'))),
    admission, historicalPublicV2: plan.historicalPublicV2, suites: [], cases: [],
    limits: plan.limits, startedAt: new Date().toISOString() };
  const save = () => fs.writeFileSync(path.join(output, 'ledger.json'), JSON.stringify(ledger, null, 2) + '\n');
  save();
  // One process and one suite at a time. No cross-process Mongo or Realm overlap.
  for (const suite of plan.suites) {
    fence();
    const stem = path.basename(suite.file, '.cjs');
    const args = ['--require', './scripts/run-protected-upgrade-regression.cjs', '--test',
      '--test-concurrency=1', '--test-reporter=' + path.join(control, '.github/ci/comprehensive351-reporter.cjs'), suite.file];
    console.log(JSON.stringify({ execution: 'START', file: suite.file, expected: suite.cases.length }));
    const p = spawnSync(process.execPath, args, { cwd: app, encoding: 'utf8',
      timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
    const stdout = p.stdout || '', stderr = p.stderr || '';
    fs.writeFileSync(path.join(output, stem + '.events.jsonl'), stdout);
    fs.writeFileSync(path.join(output, stem + '.stderr.log'), stderr);
    const receipt = { file: suite.file, exitStatus: p.status, signal: p.signal,
      expected: suite.cases.length, eventsSha256: digest(stdout), stderrSha256: digest(stderr) };
    try { ledger.cases.push(...validateEvents(suite, stdout, p.status, app)); receipt.status = 'PASS'; }
    catch (e) { receipt.status = 'FAIL'; receipt.reason = e.message; }
    ledger.suites.push(receipt); save(); console.log(JSON.stringify(receipt));
  }
  ledger.finalAdmission = fence();
  const passed = new Set(ledger.cases.map(c => c.id));
  ledger.legacyObligations = plan.legacyObligations.map(row => ({ id: row.legacy.id,
    name: row.legacy.case, family: row.mappingFamily, proofIds: row.protected.map(p => p.id),
    status: row.protected.every(p => passed.has(p.id)) ? 'PASS' : 'FAIL' }));
  ledger.passed = ledger.cases.length;
  ledger.failedSuites = ledger.suites.filter(s => s.status !== 'PASS').length;
  ledger.mappedLegacyPassed = ledger.legacyObligations.filter(r => r.status === 'PASS').length;
  ledger.status = ledger.passed === 351 && ledger.failedSuites === 0 && ledger.mappedLegacyPassed === 295 ? 'PASS' : 'FAIL';
  ledger.completedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ comprehensive351: ledger.status, app: ledger.app, run: ledger.run,
    passed: ledger.passed, failedSuites: ledger.failedSuites, mappedLegacyPassed: ledger.mappedLegacyPassed,
    ledgerSha256: digest(fs.readFileSync(path.join(output, 'ledger.json'))) }));
  process.exitCode = ledger.status === 'PASS' ? 0 : 1;
}
module.exports = { validateEvents, validatePlan };
if (require.main === module) main();
