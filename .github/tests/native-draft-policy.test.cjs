'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const directory = path.resolve(__dirname, '../workflows');
// BaseLoader keeps YAML's `on` key and scalar text intact for these policy
// checks. Parsing failure is fatal; this is not workflow semantic lint.
const parsed = spawnSync('python3', ['-B', '-c', `
import json, pathlib, sys, yaml
print(json.dumps({p.name: yaml.load(p.read_text(), Loader=yaml.BaseLoader)
                  for p in pathlib.Path(sys.argv[1]).glob('*.yml')}))
`, directory], { encoding: 'utf8', timeout: 5000 });
assert.equal(parsed.status, 0, parsed.stderr || parsed.error?.message);
const workflows = JSON.parse(parsed.stdout);
const native = workflows['keeper-hosted-native.yml'];
const ci = workflows['test.yml'];
const guard = "github.event_name == 'pull_request' && toJSON(github.event.pull_request.draft) == 'false'";

// Evaluate the actual checked-in expressions using only their two context
// paths and toJSON. Missing context is null, as in Actions. These conditions
// compare strings only, so JavaScript and Actions equality give the same result.
function allowed(condition, eventName, draft = null, legacy = true) {
  assert.equal(typeof condition, 'string', 'an explicit condition is required');
  const expression = condition
    .replaceAll("contains(github.event.pull_request.labels.*.name, 'keeper/legacy-native')", 'legacy')
    .replaceAll("contains(github.event.pull_request.labels.*.name, 'keeper/native-diagnostic')", 'false')
    .replaceAll('always()', 'true')
    .replaceAll('github.event_name', 'eventName')
    .replaceAll('github.event.pull_request.draft', 'draft');
  return Boolean(new Function('eventName', 'draft', 'legacy', 'toJSON', `return (${expression});`)(
    eventName, draft, legacy, JSON.stringify));
}

function triggered(workflow, event, action, branch) {
  const config = workflow.on[event];
  if (config === undefined) return false;
  if (config.branches && !config.branches.includes(branch)) return false;
  const types = config.types || (event === 'pull_request' ? ['opened', 'synchronize', 'reopened'] : null);
  return !types || types.includes(action);
}

test('native opened, synchronize and reopened draft jobs are skipped before runner allocation', () => {
  assert.deepEqual(Object.keys(native.jobs), ['ios', 'android']);
  for (const action of ['opened', 'synchronize', 'reopened']) {
    assert.ok(triggered(native, 'pull_request', action, 'sprint'));
    for (const job of Object.values(native.jobs)) {
      assert.ok(job.if.includes(guard));
      assert.equal(allowed(job.if, 'pull_request', false, false), false, 'legacy lane needs explicit label');
      assert.equal(allowed(job.if, 'pull_request', true), false, action);
      assert.equal(allowed(job.if, 'pull_request', false), true, action);
    }
  }
});

test('ready-for-review schedules native work and normal Tests; conversion back to draft skips native work', () => {
  assert.ok(triggered(native, 'pull_request', 'ready_for_review', 'sprint'));
  assert.ok(triggered(ci, 'pull_request', 'ready_for_review', 'sprint'));
  assert.ok(triggered(native, 'pull_request', 'converted_to_draft', 'sprint'));
  for (const job of Object.values(native.jobs)) {
    assert.equal(allowed(job.if, 'pull_request', false), true);
    assert.equal(allowed(job.if, 'pull_request', true), false);
  }
  assert.equal(native.concurrency.group, 'keeper-hosted-native-${{ github.event.pull_request.number }}');
  assert.equal(native.concurrency['cancel-in-progress'], 'true');
});

test('native non-PR and missing or malformed draft contexts fail closed', () => {
  assert.deepEqual(Object.keys(native.on), ['pull_request']);
  for (const job of Object.values(native.jobs)) {
    for (const event of ['push', 'workflow_dispatch', 'workflow_call', 'workflow_run', 'schedule', 'pull_request_target']) {
      assert.equal(allowed(job.if, event, false), false, event);
    }
    for (const draft of [null, '', 'false', 'true', 0, 1]) {
      assert.equal(allowed(job.if, 'pull_request', draft), false, JSON.stringify(draft));
    }
  }
});

test('reusable paths keep explicit draft and diagnostic boundaries with no dispatch', () => {
  const worker = workflows['keeper-native-platform.yml'];
  const acceptance = workflows['keeper-release-acceptance.yml'];
  const diagnostic = workflows['keeper-native-diagnostic.yml'];
  assert.deepEqual(Object.keys(worker.on), ['workflow_call']);
  assert.equal(worker.on.workflow_call.inputs.diagnostic.default, 'false');
  assert.match(worker.jobs.native.if, /toJSON\(github.event.pull_request.draft\) == 'false'/);
  assert.match(worker.jobs.native.if, /inputs.diagnostic && contains/);
  for (const platform of ['ios', 'android']) {
    assert.match(acceptance.jobs[platform].if, /toJSON\(github.event.pull_request.draft\) == 'false'/);
    assert.equal(diagnostic.jobs[platform].with.diagnostic, 'true');
    assert.match(diagnostic.jobs[platform].if, /keeper\/native-diagnostic/);
  }
  assert.deepEqual(acceptance.jobs.android.needs, ['provenance', 'ios']);
  assert.equal(diagnostic.jobs.android.needs, 'ios');
  assert.equal(diagnostic.concurrency['cancel-in-progress'], 'false');
  for (const filename of ['keeper-hosted-native.yml', 'keeper-native-platform.yml',
    'keeper-release-acceptance.yml', 'keeper-native-diagnostic.yml']) {
    assert.ok(!Object.hasOwn(workflows[filename].on, 'workflow_dispatch'), filename);
  }
  assert.equal(workflows['android-diagnostic-build.yml'].jobs.build.if, "github.event_name == 'workflow_dispatch'");
  assert.equal(workflows['android-diagnostic-build.yml'].concurrency['cancel-in-progress'], 'false');
});

test('pushing an isolated branch permits only the read-only origin contract workflow', () => {
  const triggeredFiles = Object.entries(workflows).filter(([, workflow]) =>
    triggered(workflow, 'push', null, 'codex/cloud-bootstrap-privacy')).map(([filename]) => filename);
  assert.deepEqual(triggeredFiles, ['keeper-release-origin-contracts.yml']);
  const workflow = workflows['keeper-release-origin-contracts.yml'];
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.equal(workflow.concurrency['cancel-in-progress'], 'false');
  const job = workflow.jobs.contracts;
  assert.equal(job.environment, undefined);
  assert.equal(job.secrets, undefined);
  assert.equal(job.steps.some(step => /secrets\.|workflow_dispatch/.test(JSON.stringify(step))), false);
  assert.deepEqual(job.steps.filter(step => step.run).map(step => step.run), [
    'node --test scripts/trusted-release-origin.test.cjs scripts/codeql-analysis-receipt.test.cjs scripts/protected-release-plan.test.cjs',
  ]);
});

test('draft opening and updates retain the expected host checks without a release trigger', () => {
  for (const action of ['opened', 'synchronize', 'reopened']) {
    const triggeredFiles = Object.entries(workflows).filter(([, workflow]) =>
      triggered(workflow, 'pull_request', action, 'sprint')).map(([filename]) => filename).sort();
    const expected = [
      'android-diagnostic-build.yml', 'codeql.yml', 'keeper-canonical-native-contracts.yml', 'keeper-hosted-native.yml',
      'keeper-release-acceptance.yml', 'keeper-release-origin-contracts.yml',
      'keeper-release-preparation-contracts.yml', 'keeper-ruby-lock-contracts.yml',
      'keeper-validation-tests.yml', 'public-backend.yml', 'test.yml',
    ];
    if (action === 'synchronize' || action === 'reopened') expected.push('keeper-native-diagnostic.yml');
    assert.deepEqual(triggeredFiles, expected.sort());
    assert.ok(triggered(workflows['keeper-local-validation.yml'], 'pull_request_target', action, 'sprint'));
  }
});

test('canonical provenance contracts stay read-only and separate from manual native execution', () => {
  const contracts = workflows['keeper-canonical-native-contracts.yml'];
  assert.deepEqual(Object.keys(contracts.on), ['pull_request']);
  assert.deepEqual(contracts.permissions, { contents: 'read' });
  assert.equal(contracts.concurrency, undefined);
  const job = contracts.jobs.contracts;
  assert.equal(job.environment, undefined);
  assert.equal(job.secrets, undefined);
  assert.equal(job['timeout-minutes'], '5');
  assert.equal(job.steps.find(step => step.with?.['node-version']).with['node-version'], '22.23.3');
  assert.deepEqual(job.steps.filter(step => step.run).map(step => step.name),
    ['Test read-only canonical trust and archive controls']);
  const native = workflows['keeper-canonical-native.yml'];
  assert.deepEqual(Object.keys(native.on), ['workflow_dispatch']);
  assert.equal(triggered(native, 'pull_request', 'opened', 'sprint'), false);
  assert.equal(triggered(native, 'push', null, 'sprint'), false);
});

test('canonical pin credential stays in explicit provenance steps with read-only workflow permissions', () => {
  const caller = workflows['keeper-canonical-native.yml'];
  const worker = workflows['keeper-canonical-native-platform.yml'];
  for (const workflow of [caller, worker]) {
    assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read', checks: 'read' });
    assert.equal(workflow.env?.KEEPER_CANONICAL_PIN_READ_TOKEN, undefined);
    for (const job of Object.values(workflow.jobs)) {
      assert.equal(job.environment, undefined);
      assert.equal(job.env?.KEEPER_CANONICAL_PIN_READ_TOKEN, undefined);
      for (const step of job.steps || []) {
        if (step.env?.KEEPER_CANONICAL_PIN_READ_TOKEN) {
          assert.match(step.uses, /^actions\/github-script@[a-f0-9]{40}$/);
          assert.equal(step.with['github-token'], undefined, 'Actions/check APIs keep the normal workflow identity');
          assert.match(step.with.script, /pinReaderFromEnvironment\(github, process.env\)/);
          assert.match(step.with.script, /(?:admission: true, pinReader|\{ pinReader \})/);
        } else {
          assert.doesNotMatch(JSON.stringify(step), /secrets\./, 'build/tooling steps receive no pin credential');
        }
      }
    }
  }
  assert.deepEqual(Object.keys(worker.on.workflow_call.secrets), ['canonical_pin_read_token']);
  assert.equal(worker.on.workflow_call.secrets.canonical_pin_read_token.required, 'true');
  for (const platform of ['ios', 'android']) {
    assert.deepEqual(caller.jobs[platform].secrets, {
      canonical_pin_read_token: '${{ secrets.KEEPER_CANONICAL_PIN_READ_TOKEN }}',
    });
  }
  assert.deepEqual(caller.jobs.provenance.steps.find(step => step.id === 'check').env, {
    KEEPER_CANONICAL_PIN_READ_TOKEN: '${{ secrets.KEEPER_CANONICAL_PIN_READ_TOKEN }}',
  });
  assert.equal(caller.jobs.attestation.steps.find(step => step.name === 'Verify canonical receipts and required matrix')
    .env.KEEPER_CANONICAL_PIN_READ_TOKEN, '${{ secrets.KEEPER_CANONICAL_PIN_READ_TOKEN }}');
  const checks = worker.jobs.native.steps.filter(step => step.env?.KEEPER_CANONICAL_PIN_READ_TOKEN);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].env.KEEPER_CANONICAL_PIN_READ_TOKEN, '${{ secrets.canonical_pin_read_token }}');
  assert.equal(checks[0].name, 'Verify canonical installed source');
});

test('release preparation PR checks stay offline and separate from the protected manual plan', () => {
  const contracts = workflows['keeper-release-preparation-contracts.yml'];
  assert.deepEqual(contracts.permissions, { contents: 'read' });
  assert.equal(contracts.on.pull_request_target, undefined);
  assert.equal(contracts.concurrency['cancel-in-progress'], 'false');
  const job = contracts.jobs.contracts;
  assert.equal(job.environment, undefined);
  assert.equal(job.secrets, undefined);
  assert.equal(job.steps.filter(step => step.run).length, 1);
  assert.match(job.steps.find(step => step.run).run, /node --test scripts\/protected-release-plan\.test\.cjs/);
  const plan = workflows['keeper-protected-release-plan.yml'];
  assert.deepEqual(Object.keys(plan.on), ['workflow_dispatch']);
  assert.equal(triggered(plan, 'pull_request', 'opened', 'sprint'), false);
  assert.equal(triggered(plan, 'push', null, 'sprint'), false);
});

test('all Tests installs preserve current immutable script-disabled R4 setup and patches', () => {
  const steps = ci.jobs.test.steps;
  const install = steps.find(step => step.name === 'Install dependencies');
  assert.match(install.run, /yarn install --frozen-lockfile --ignore-scripts --non-interactive/);
  assert.equal(install.if, undefined);
  assert.equal(steps.find(step => step.name === 'Apply repository dependency patches').run,
    'node_modules/.bin/patch-package --error-on-fail');
  assert.match(steps.find(step => step.name === 'Verify dependency inputs remain unchanged').run,
    /git diff --exit-code HEAD/);
  assert.ok(!ci.jobs.test.if && !ci.jobs.test['continue-on-error']);
  for (const step of steps) assert.ok(!step['continue-on-error']);
  assert.equal(steps.find(step => step.name === 'Run tests').run, 'npm run test');
});

test('standalone native contracts install a locked isolated compiler without app lifecycle hooks', () => {
  const job = workflows['keeper-validation-tests.yml'].jobs.contracts;
  const install = job.steps.find(step => step.name === 'Install isolated locked contract tools without lifecycle scripts');
  assert.match(install.run, /npm ci --prefix \.github\/native\/contract-tools --ignore-scripts --no-audit --no-fund/);
  assert.match(install.run, /NODE_PATH=/);
  assert.equal(job.environment, undefined);
  assert.equal(job.secrets, undefined);
  const compiler = require('../native/contract-tools/package.json');
  const app = require('../../package.json');
  assert.equal(compiler.dependencies.typescript, app.devDependencies.typescript);
  const lock = require('../native/contract-tools/package-lock.json');
  assert.equal(lock.packages['node_modules/typescript'].version, app.devDependencies.typescript);
  assert.match(lock.packages['node_modules/typescript'].integrity, /^sha512-/);
});
