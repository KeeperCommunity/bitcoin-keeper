'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const captured = require('./fixtures/producer-source-proofs.json');
const { PRIVATE_INTEGRATION_CORE: core, validatePrivateIntegration } = require('../native/private_integration_receipts.cjs');
const { validateParentSoftwareEvidence } = require('../native/parent_software_evidence.cjs');
const { synthetic } = require('./fixtures/private-integration.cjs');
const { syntheticParent } = require('./fixtures/parent-software.cjs');
const suites = ['protected', 'recovery', 'account'];
test('original JSON from all three real Node source verifiers retains its exact per-suite scope', () => {
  assert.equal(captured.native_execution, false); assert.equal(captured.github_actions_execution, false);
  assert.equal(captured.scope, 'ACTUAL_NODE_SOURCE_VERIFIERS_ON_DISPOSABLE_LOCAL_GIT_CLONES_NOT_NATIVE_OR_ACTIONS');
  for (const suite of suites) {
    assert.equal(captured.scripts[suite].path, `scripts/verify-r5-native-${suite}.cjs`);
    assert.match(captured.scripts[suite].sha256, /^[a-f0-9]{64}$/);
    assert.equal(captured.outputs[suite].nativeAcceptance, 'NOT_ESTABLISHED_BY_SOURCE_CHECK');
  }
  assert.doesNotThrow(() => core.sourceProofs(structuredClone(captured.outputs), captured.expected));
});
for (const names of [['protected', 'protected', 'protected'], ['protected', 'account', 'recovery'],
  ['recovery', 'recovery', 'account'], ['protected', 'recovery', 'protected']])
  test(`valid scope from a different source verifier cannot supply the ${names.join('/')} slots`, () => {
    const values = structuredClone(captured.outputs);
    suites.forEach((suite, i) => values[suite].scope = captured.outputs[names[i]].scope);
    assert.throws(() => core.sourceProofs(values, captured.expected), /^Error: PRIVATE_INTEGRATION_RECEIPT_INVALID$/);
  });
for (const platform of ['IOS', 'ANDROID']) for (const [label, build, validate] of [
  ['C2', synthetic, validatePrivateIntegration], ['D13', syntheticParent, validateParentSoftwareEvidence],
]) test(`${platform} ${label} rejects a fully rebound all-protected counterfeit source scope`, () => {
  const f = build(platform);
  for (const suite of suites) f.aggregate.source_admission[suite].scope = captured.outputs.protected.scope;
  for (const barrier of f.aggregate.barriers) barrier.source_proofs = structuredClone(f.aggregate.source_admission);
  assert.throws(() => validate(f.rebind(), f.expected), /^Error: (?:PRIVATE_INTEGRATION|PARENT_SOFTWARE)_RECEIPT_INVALID$/);
});
