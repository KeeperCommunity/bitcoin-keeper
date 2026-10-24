'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

// Scope: workflows introduced by the bootstrap. Existing gate/action policy is
// unchanged; this does not silently repin unrelated workflows.
const workflows = ['keeper-hosted-native.yml', 'keeper-validation-tests.yml',
  'keeper-native-platform.yml', 'keeper-release-acceptance.yml', 'keeper-native-diagnostic.yml'];
// Verified upstream refs/tags/v2.34.0^{} on 2026-10-18, also used by #7062.
// The annotated tag object is 324029e2f414c084d8b15ba075288885e74aef9c.
const emulatorCommit = '1dcd0090116d15e7c562f8db72807de5e036a4ed';
const emulatorAction = 'reactivecircus/android-emulator-runner';
// Other pins match the upstream tags noted in the workflows, read-only checked
// on the same date. Updates require a new verified commit, not just SHA syntax.
const verifiedPins = new Map([
  ['actions/github-script', 'ed597411d8f924073f98dfc5c65a23a2325f34cd'],
  ['actions/checkout', 'd23441a48e516b6c34aea4fa41551a30e30af803'],
  ['actions/setup-node', '249970729cb0ef3589644e2896645e5dc5ba9c38'],
  ['actions/setup-java', 'b6effb05e454b25005698d916606bdc6ffcbf961'],
  ['ruby/setup-ruby', '675dd7ba1b06c8786a1480d89c384f5620a42647'],
  ['actions/upload-artifact', 'b7c566a772e6b6bfb58ed0dc250532a479d7789f'],
  ['android-actions/setup-android', 'be39fa834029ff78f1a44aa3bb0819b8fc2bd8fd'],
  [emulatorAction, emulatorCommit],
]);

// Use the host's existing Python/PyYAML parser, never app dependencies or a
// partial YAML regex. Missing tooling, ambiguous duplicate keys and unsupported
// YAML values fail the contract; there is no permissive fallback or install.
const yamlParser = `
import json
import sys
import yaml

class UniqueSafeLoader(yaml.SafeLoader):
    pass

def unique_mapping(loader, node, deep=False):
    loader.flatten_mapping(node)
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in result:
            raise ValueError('Duplicate YAML mapping key')
        result[key] = loader.construct_object(value_node, deep=deep)
    return result

UniqueSafeLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping)
print(json.dumps(yaml.load(sys.stdin.read(), Loader=UniqueSafeLoader)))
`;

function actionReferences(workflow, runParser = spawnSync) {
  const result = runParser('python3', ['-B', '-c', yamlParser], {
    input: workflow, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `YAML parsing is required (Python 3 + PyYAML): ${result.error?.message || result.stderr || ''}`);
  const document = JSON.parse(result.stdout);
  const mapping = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  assert.ok(mapping(document) && mapping(document.jobs), 'workflow must have a jobs mapping');
  const references = [];
  for (const job of Object.values(document.jobs)) {
    assert.ok(mapping(job), 'each job must be a mapping');
    if (Object.hasOwn(job, 'uses')) references.push(job.uses);
    if (Object.hasOwn(job, 'steps')) {
      assert.ok(Array.isArray(job.steps), 'job steps must be a sequence');
      for (const step of job.steps) {
        assert.ok(mapping(step), 'each step must be a mapping');
        if (Object.hasOwn(step, 'uses')) references.push(step.uses);
      }
    }
  }
  assert.ok(references.every(reference => typeof reference === 'string'), 'uses values must be strings');
  return references;
}

function validateActionPins(workflow) {
  const references = actionReferences(workflow);
  assert.ok(references.length > 0, 'expected external actions in bootstrap workflow');
  for (const reference of references) {
    if (reference === './.github/workflows/keeper-native-platform.yml') continue;
    assert.match(reference, /^[\w-]+\/[\w./-]+@[0-9a-f]{40}$/,
      `external actions require a full immutable commit: ${reference}`);
    const [action, revision] = reference.split('@');
    assert.ok(verifiedPins.has(action), `action needs a verified upstream commit: ${action}`);
    assert.equal(revision, verifiedPins.get(action),
      'action must use its verified upstream commit, not an arbitrary SHA or tag object');
  }
}

// Keep a valid companion action so a skipped mutable entry cannot pass merely
// because the parser found some other pinned reference in the same workflow.
function workflowWithStep(step) {
  return `jobs:
  contracts:
    steps:
      - uses: actions/setup-node@${verifiedPins.get('actions/setup-node')}
      - ${step}
`;
}

test('bootstrap external actions have full immutable pins and the verified emulator commit', () => {
  for (const workflow of workflows) {
    validateActionPins(fs.readFileSync(path.join(__dirname, '../workflows', workflow), 'utf8'));
  }
  const hosted = fs.readFileSync(path.join(__dirname, '../workflows', workflows[0]), 'utf8');
  assert.equal(actionReferences(hosted).filter(ref => ref.startsWith(`${emulatorAction}@`)).length, 1);
});

test('action pin validation rejects mutable, short, malformed and tag-object revisions', () => {
  for (const revision of ['v2', 'v2.34.0', 'main', emulatorCommit.slice(0, 12),
    '324029e2f414c084d8b15ba075288885e74aef9c38',
    '324029e2f414c084d8b15ba075288885e74aef9c', 'a'.repeat(40), 'g'.repeat(40),
    '${{ inputs.revision }}']) {
    assert.throws(() => validateActionPins(workflowWithStep(`uses: ${emulatorAction}@${revision}`)),
      /full immutable commit|verified upstream commit/, revision);
  }
  assert.throws(() => validateActionPins(workflowWithStep('uses: actions/checkout@v6')), /full immutable commit/);
  assert.throws(() => validateActionPins(workflowWithStep(`uses: actions/checkout@${'a'.repeat(40)}`)), /verified upstream commit/);
  assert.throws(() => validateActionPins(workflowWithStep(`uses: unknown/action@${emulatorCommit}`)), /verified upstream commit/);
  assert.throws(() => validateActionPins('jobs: {}\n'), assert.AssertionError);
});

test('quoted keys, flow mappings and folded values cannot hide a mutable action beside pinned actions', () => {
  const forms = [
    reference => `"uses": ${reference}`,
    reference => `'uses': '${reference}'`,
    reference => `"\\u0075ses": "${reference}"`,
    reference => `!!str uses: ${reference}`,
    reference => `{uses: ${reference}}`,
    reference => `{"name": "checkout", "uses": "${reference}"}`,
    reference => `uses: >-\n          ${reference}`,
    reference => `uses: |-\n          ${reference}`,
  ];
  for (const form of forms) {
    const pinned = `actions/checkout@${verifiedPins.get('actions/checkout')}`;
    const valid = workflowWithStep(form(pinned));
    assert.deepEqual(actionReferences(valid), [
      `actions/setup-node@${verifiedPins.get('actions/setup-node')}`, pinned,
    ]);
    validateActionPins(valid);
    for (const mutable of ['actions/checkout@v6', 'actions/checkout@main']) {
      const invalid = workflowWithStep(form(mutable));
      assert.ok(actionReferences(invalid).includes(mutable), 'mutable action must be inspected, not skipped');
      assert.throws(() => validateActionPins(invalid), /full immutable commit/, form(mutable));
    }
  }
});

test('whole flow documents, aliases and job-level uses are inspected', () => {
  const pinned = `actions/checkout@${verifiedPins.get('actions/checkout')}`;
  const forms = [
    reference => JSON.stringify({ jobs: { contracts: { steps: [
      { uses: pinned }, { uses: reference },
    ] } } }),
    reference => `jobs:\n  contracts:\n    steps:\n      - uses: ${pinned}\n      - &checkout {uses: ${reference}}\n      - *checkout\n`,
    reference => `jobs: {build: {steps: [{uses: ${pinned}}]}, reuse: {"uses": "${reference}"}}\n`,
  ];
  for (const form of forms) {
    validateActionPins(form(pinned));
    assert.ok(actionReferences(form('actions/checkout@v6')).includes('actions/checkout@v6'));
    assert.throws(() => validateActionPins(form('actions/checkout@v6')), /full immutable commit/);
  }
});

test('YAML inspection fails closed for unavailable parsers, invalid input and duplicate keys', () => {
  for (const result of [
    { status: null, error: new Error('spawn python3 ENOENT') },
    { status: 1, stderr: "ModuleNotFoundError: No module named 'yaml'" },
    { status: null, error: new Error('parser timeout') },
  ]) {
    assert.throws(() => actionReferences('jobs: {}', () => result), /YAML parsing is required/);
  }
  assert.throws(() => validateActionPins('jobs: ['), /YAML parsing is required/);
  const pinned = `actions/checkout@${verifiedPins.get('actions/checkout')}`;
  for (const references of [[pinned, 'actions/checkout@v6'], ['actions/checkout@v6', pinned]]) {
    assert.throws(() => validateActionPins(workflowWithStep(
      `uses: ${references[0]}\n        "uses": ${references[1]}`)), /Duplicate YAML mapping key/);
  }
  assert.throws(() => validateActionPins(workflowWithStep('uses: {action: actions/checkout@v6}')),
    /uses values must be strings/);
});
