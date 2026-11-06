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
function allowed(condition, eventName, draft = null) {
  assert.equal(typeof condition, 'string', 'an explicit condition is required');
  const expression = condition
    .replaceAll('github.event_name', 'eventName')
    .replaceAll('github.event.pull_request.draft', 'draft');
  return Boolean(new Function('eventName', 'draft', 'toJSON', `return (${expression});`)(
    eventName, draft, JSON.stringify));
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
      assert.equal(job.if, guard);
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

test('bootstrap has no reusable native caller, worker or dispatch entry point', () => {
  assert.deepEqual(Object.keys(workflows).sort(), [
    'codeql.yml', 'keeper-hosted-native.yml', 'keeper-local-validation.yml',
    'keeper-validation-tests.yml', 'rag-ingest-release.yml', 'test.yml',
  ]);
  for (const [filename, workflow] of Object.entries(workflows)) {
    assert.ok(!Object.hasOwn(workflow.on, 'workflow_call'), filename);
    assert.ok(!Object.hasOwn(workflow.on, 'workflow_dispatch'), filename);
    for (const job of Object.values(workflow.jobs)) assert.ok(!job.uses, filename);
  }
  // #7062's reusable workflows are intentionally absent, not silently adopted.
  // Any later addition requires an explicit extension of this entry-path review.
});

test('pushing the unpublished branch triggers no checked-in push workflow', () => {
  for (const [filename, workflow] of Object.entries(workflows)) {
    assert.equal(triggered(workflow, 'push', null, 'codex/cloud-bootstrap-privacy'), false, filename);
  }
});

test('draft opening and updates retain the expected host checks without a release trigger', () => {
  for (const action of ['opened', 'synchronize', 'reopened']) {
    const triggeredFiles = Object.entries(workflows).filter(([, workflow]) =>
      triggered(workflow, 'pull_request', action, 'sprint')).map(([filename]) => filename).sort();
    assert.deepEqual(triggeredFiles, [
      'codeql.yml', 'keeper-hosted-native.yml', 'keeper-validation-tests.yml', 'test.yml',
    ]);
    assert.ok(triggered(workflows['keeper-local-validation.yml'], 'pull_request_target', action, 'sprint'));
  }
});

test('draft Tests install cannot invoke native prepare and does not waive install or test failure', () => {
  const steps = ci.jobs.test.steps;
  const installs = steps.filter(step => step.run?.startsWith('yarn install'));
  assert.equal(installs.length, 2);
  for (const [event, draft, expected] of [
    ['pull_request', true, 'yarn install --frozen-lockfile --ignore-scripts'],
    ['pull_request', null, 'yarn install --frozen-lockfile --ignore-scripts'],
    ['pull_request', 'false', 'yarn install --frozen-lockfile --ignore-scripts'],
    ['pull_request', false, 'yarn install'], ['push', null, 'yarn install'],
  ]) {
    const active = installs.filter(step => allowed(step.if, event, draft));
    assert.equal(active.length, 1);
    assert.equal(active[0].run, expected);
  }
  assert.ok(!ci.jobs.test.if && !ci.jobs.test['continue-on-error']);
  for (const step of steps) assert.ok(!step['continue-on-error']);
  const tests = steps.find(step => step.name === 'Run tests');
  assert.equal(tests.run, 'npm run test');
  assert.ok(!tests.if);
  assert.equal(ci.jobs.lint.steps.find(step => step.name === 'Install dependencies').run,
    'yarn install --ignore-scripts');
});
