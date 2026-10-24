'use strict';
// Metadata-only policy checks; this file cannot supply native evidence.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const path = require('node:path');
const parsed = spawnSync('python3', ['-B', '-c', `
import json,pathlib,sys,yaml
print(json.dumps({p.name:yaml.load(p.read_text(),Loader=yaml.BaseLoader) for p in pathlib.Path(sys.argv[1]).glob('*.yml')}))
`, path.resolve(__dirname, '../workflows')], { encoding: 'utf8', timeout: 5000 });
assert.equal(parsed.status, 0, parsed.stderr);
const workflows = JSON.parse(parsed.stdout);
const diagnostic = workflows['keeper-native-diagnostic.yml'];
const worker = workflows['keeper-native-platform.yml'];
function enabled(condition, { draft = null, labeled = false, preflightLabeled = false, iosOnly = false, sameRepo = true, number = 8000, eventName = 'pull_request', diagnostic = false, sameSha = true } = {}) {
  const expression = condition
    .replaceAll('github.event_name', 'eventName')
    .replaceAll('github.event.pull_request.number', 'number')
    .replaceAll('github.event.pull_request.head.repo.full_name == github.repository', 'sameRepo')
    .replaceAll('github.event.pull_request.draft', 'draft')
    .replaceAll("contains(github.event.pull_request.labels.*.name, 'keeper/native-diagnostic')", 'labeled')
    .replaceAll("contains(github.event.pull_request.labels.*.name, 'keeper/ios-driver-preflight')", 'preflightLabeled')
    .replaceAll("contains(github.event.pull_request.labels.*.name, 'keeper/ios-diagnostic-only')", 'iosOnly')
    .replaceAll('inputs.source_sha == github.event.pull_request.head.sha', 'sameSha')
    .replaceAll('inputs.diagnostic', 'diagnostic')
    .replaceAll('always()', 'true');
  return new Function('draft', 'labeled', 'preflightLabeled', 'iosOnly', 'sameRepo', 'number', 'eventName', 'diagnostic', 'sameSha', 'toJSON', `return (${expression});`)(draft, labeled, preflightLabeled, iosOnly, sameRepo, number, eventName, diagnostic, sameSha, JSON.stringify);
}
test('candidate diagnostics require explicit same-repository opt-in and serialize platforms', () => {
  for (const name of ['ios', 'android']) {
    const condition = diagnostic.jobs[name].if;
    assert.equal(enabled(condition, { draft: true, labeled: true }), true);
    for (const override of [{ labeled: false }, { sameRepo: false }, { number: 7045 }]) {
      assert.equal(enabled(condition, { draft: true, labeled: true, ...override }), false);
    }
  }
  assert.equal(diagnostic.jobs.android.needs, 'ios');
  assert.equal(diagnostic.concurrency['cancel-in-progress'], 'false');
  assert.equal(diagnostic.permissions.contents, 'read');
  assert.equal(diagnostic.permissions['pull-requests'], 'read');
});
test('explicit iOS-only modifier schedules nothing alone and only removes diagnostic Android', () => {
  for (const labeled of [false, true]) {
    for (const preflightLabeled of [false, true]) {
      for (const iosOnly of [false, true]) {
        const selected = ['driver-preflight', 'ios', 'android'].map(name =>
          enabled(diagnostic.jobs[name].if, { draft: true, labeled, preflightLabeled, iosOnly }));
        assert.deepEqual(selected, [preflightLabeled && !labeled, labeled, labeled && !iosOnly],
          JSON.stringify({ labeled, preflightLabeled, iosOnly }));
        for (const override of [{ sameRepo: false }, { number: 7045 }]) {
          const rejected = ['driver-preflight', 'ios', 'android'].map(name =>
            enabled(diagnostic.jobs[name].if, { draft: true, labeled, preflightLabeled, iosOnly, ...override }));
          assert.deepEqual(rejected, [false, false, false]);
        }
      }
    }
  }
  assert.deepEqual(Object.keys(diagnostic.on), ['pull_request']);
  assert.deepEqual(diagnostic.on.pull_request.branches, ['sprint']);
  assert.deepEqual(diagnostic.on.pull_request.types, ['labeled', 'synchronize', 'reopened']);
  assert.equal(diagnostic.jobs.android.needs, 'ios');
  assert.match(diagnostic.jobs.android.if, /^always\(\)/);
  for (const platform of ['ios', 'android']) {
    assert.equal(diagnostic.jobs[platform].uses, './.github/workflows/keeper-native-platform.yml');
    assert.equal(diagnostic.jobs[platform].with.diagnostic, 'true');
    assert.equal(diagnostic.jobs[platform].with.source_sha, '${{ github.event.pull_request.head.sha }}');
  }
  assert.equal(enabled(worker.jobs.native.if, { draft: true, iosOnly: true, diagnostic: true }), false);
});
test('isolated driver label cannot schedule an app platform or overlap full diagnostics', () => {
  const preflight = diagnostic.jobs['driver-preflight'];
  for (const [labeled, preflightLabeled, expected] of [
    [false, false, [false, false, false]],
    [false, true, [true, false, false]],
    [true, false, [false, true, true]],
    [true, true, [false, true, true]],
  ]) {
    const actual = ['driver-preflight', 'ios', 'android'].map(name =>
      enabled(diagnostic.jobs[name].if, { draft: true, labeled, preflightLabeled }));
    assert.deepEqual(actual, expected, JSON.stringify({ labeled, preflightLabeled }));
  }
  for (const override of [{ sameRepo: false }, { number: 7045 }]) {
    assert.equal(enabled(preflight.if, { preflightLabeled: true, ...override }), false);
  }
  assert.equal(preflight['runs-on'], 'macos-15');
  assert.equal(preflight['timeout-minutes'], '15');
  assert.equal(preflight.env.KEEPER_NATIVE_PLATFORM, 'IOS');
  assert.equal(preflight.env.KEEPER_DIAGNOSTIC, 'true');
  assert.equal(preflight.env.KEEPER_SOURCE_SHA, '${{ github.event.pull_request.head.sha }}');
  assert.ok(!preflight.uses && !preflight.environment && !preflight.secrets);
  const checkout = preflight.steps.find(step => step.name === 'Check out exact diagnostic source');
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.head.sha }}');
  assert.equal(checkout.with['persist-credentials'], 'false');
  const commands = preflight.steps.filter(step => step.run).map(step => step.run).join('\n');
  assert.match(commands, /git rev-parse HEAD/);
  assert.match(commands, /git diff --exit-code HEAD -- \.github\/native \.github\/workflows/);
  assert.match(commands, /python3 \.github\/native\/driver_diagnosis\.py/);
  assert.doesNotMatch(commands, /hosted_native\.py (?:prepare|build|smoke|probe|features)|product_measurements|gradlew|adb|xcodebuild/);
  const evidence = preflight.steps.find(step => step.name === 'Retain bounded driver diagnosis');
  assert.equal(evidence.with.path, 'artifacts/native/ios/metadata.json');
});
test('preflight live source guard rejects moved source, foreign repository and nonisolated labels', async () => {
  const step = diagnostic.jobs['driver-preflight'].steps.find(step =>
    step.name === 'Verify current preflight source and isolated opt-in');
  const script = new vm.Script(`(async()=>{${step.with.script}})()`);
  for (const mutation of [null, 'sha', 'labels', 'full-only', 'both-labels', 'repo', 'missing-source']) {
    const pr = { head: { sha: 'a'.repeat(40), repo: { full_name: 'KeeperCommunity/bitcoin-keeper' } },
      labels: [{ name: 'keeper/ios-driver-preflight' }] };
    const env = { KEEPER_SOURCE_SHA: 'a'.repeat(40) };
    if (mutation === 'sha') pr.head.sha = 'b'.repeat(40);
    if (mutation === 'labels') pr.labels = [];
    if (mutation === 'full-only') pr.labels = [{ name: 'keeper/native-diagnostic' }];
    if (mutation === 'both-labels') pr.labels.push({ name: 'keeper/native-diagnostic' });
    if (mutation === 'repo') pr.head.repo.full_name = 'fork/bitcoin-keeper';
    if (mutation === 'missing-source') delete env.KEEPER_SOURCE_SHA;
    const failures = [];
    const requests = [];
    await script.runInNewContext({
      context: { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' }, payload: { pull_request: { number: 8000 } } },
      process: { env },
      core: { setFailed: message => failures.push(message) },
      github: { rest: { pulls: { get: async input => { requests.push(input); return { data: pr }; } } } },
    });
    assert.equal(failures.length, mutation === null ? 0 : 1, String(mutation));
    assert.equal(JSON.stringify(requests), JSON.stringify([
      { owner: 'KeeperCommunity', repo: 'bitcoin-keeper', pull_number: 8000 },
    ]));
  }
});
test('reusable worker cannot silently run a draft, non-PR or wrong SHA', () => {
  const condition = worker.jobs.native.if;
  assert.equal(enabled(condition, { draft: false }), true);
  assert.equal(enabled(condition, { draft: true, labeled: true, diagnostic: true }), true);
  for (const override of [{ labeled: false }, { diagnostic: false }, { sameSha: false },
    { eventName: 'workflow_dispatch' }, { eventName: 'pull_request_target' }]) {
    assert.equal(enabled(condition, { draft: true, labeled: true, diagnostic: true, ...override }), false);
  }
  for (const draft of [null, undefined, '', 'false', 'true', 0, 1, true]) {
    assert.equal(enabled(condition, { draft }), false);
  }
});
test('current-source recheck denies moved head, removed opt-in and foreign repository', async () => {
  const step = worker.jobs.native.steps.find(step => step.name === 'Verify current diagnostic source');
  const script = new vm.Script(`(async()=>{${step.with.script}})()`);
  for (const mutation of [null, 'sha', 'labels', 'repo']) {
    const pr = { head: { sha: 'a'.repeat(40), repo: { full_name: 'KeeperCommunity/bitcoin-keeper' } }, labels: [{ name: 'keeper/native-diagnostic' }] };
    if (mutation === 'sha') pr.head.sha = 'b'.repeat(40);
    if (mutation === 'labels') pr.labels = [];
    if (mutation === 'repo') pr.head.repo.full_name = 'fork/bitcoin-keeper';
    const failures = [];
    await script.runInNewContext({
      context: { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' }, payload: { pull_request: { number: 8000 } } },
      process: { env: { EXPECTED_SOURCE: 'a'.repeat(40) } },
      core: { setFailed: message => failures.push(message) },
      github: { rest: { pulls: { get: async () => ({ data: pr }) } } },
    });
    assert.equal(failures.length, mutation === null ? 0 : 1, String(mutation));
  }
});
test('diagnostic workflow identity is rejected by the trusted release evidence verifier', async () => {
  const { evidence } = require('../native/release_evidence.cjs');
  const sha = 'a'.repeat(40);
  const repository = 'KeeperCommunity/bitcoin-keeper';
  const result = await evidence({
    rest: { actions: { listWorkflowRuns: 'runs' } },
    paginate: async () => [{ id: 12, run_attempt: 1, path: '.github/workflows/keeper-native-diagnostic.yml' }],
  }, { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' }, eventName: 'pull_request', runId: 12,
    payload: { pull_request: { number: 8000, head: { sha, repo: { id: 1, full_name: repository } },
      base: { ref: 'sprint', repo: { id: 1, full_name: repository } } } } },
  { ios: 'success', android: 'success', attempt: 1 });
  assert.equal(result, false);
  assert.ok(!diagnostic.jobs.acceptance);
  for (const source of [diagnostic, worker]) {
    assert.ok(!source.environment && !source.secrets);
    assert.ok(Object.values(source.permissions).every(value => value === 'read'));
  }
});
