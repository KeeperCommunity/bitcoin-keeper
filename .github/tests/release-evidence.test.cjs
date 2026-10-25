'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture } = require('./fixtures/actions-software.cjs');
const { evidence, softwareEvidence } = require('../native/release_evidence.cjs');
const { acceptance, markdown, REQUIRED } = require('../native/release_acceptance.cjs');
const check = state => softwareEvidence(state.github, state.context, state.input, state.options);
test('summary consumes original-byte proof and displays actual scoped checks while parents stay blocked', async () => {
  const state = fixture(), proof = await check(state);
  const result = acceptance({ publicSoftware: proof, ios: 'success', android: 'success' });
  assert.deepEqual(result.cases.map(row => row.id), REQUIRED);
  assert.deepEqual(result.cases.slice(0, 2).map(row => row.status), ['PASS', 'PASS']);
  assert.ok(result.cases.slice(2).every(row => row.status === 'NOT VERIFIED'));
  assert.equal(result.software_complete, false); assert.equal(result.release_ready, false);
  assert.match(markdown(result), /IOS: five-product-observations/);
  assert.match(markdown(result), /ANDROID: controlled-setup-disconnect-retry/);
  assert.match(markdown(result), /PRIVATE PARENTS INCOMPLETE/);
  assert.match(markdown(result), /no release-build budget/);
  for (const key of ['authorization_eligible', 'release_authorized', 'execution_allowed']) assert.equal(result[key], false);
});
test('caller PASS flags, copied proofs, and private envelopes cannot supply native parent credit', async () => {
  const state = fixture(), proof = await check(state);
  for (const value of [null, { status: 'PASS' }, structuredClone(proof), { selected_route: 'canonical-hosted-native', software_complete: true }]) {
    const result = acceptance({ trusted: true, publicSoftware: value, ios: 'success', android: 'success' });
    assert.ok(result.cases.every(row => row.status === 'NOT VERIFIED'));
    assert.equal(result.public_software, null); assert.equal(result.software_complete, false);
  }
});
test('compatibility boolean requires the complete same original-byte proof', async () => {
  const state = fixture();
  assert.equal(await evidence(state.github, state.context, state.input, state.options), true);
  state.jobs[0].steps.pop();
  assert.equal(await evidence(state.github, state.context, state.input, state.options), false);
});
test('blocking reason is fixed vocabulary, without API payloads, URLs or apparent release authority', async () => {
  const state = fixture(); state.apiError = true;
  const result = await check(state);
  assert.equal(result.status, 'BLOCKED'); assert.equal(result.reason, 'SOFTWARE_EVIDENCE_INVALID');
  assert.equal(JSON.stringify(result).includes('PRIVATE_PAYLOAD'), false);
  assert.equal(result.installed_trust, 'UNVERIFIED');
  assert.ok(Object.isFrozen(result));
  const summary = markdown(acceptance({ publicSoftware: result, ios: 'success', android: 'success' }));
  assert.match(summary, /SOFTWARE_EVIDENCE_INVALID/); assert.doesNotMatch(summary, /https:/);
});
test('old build-only API model supplies no new evidence or raw software pass', async () => {
  const state = fixture(); delete state.input.workflowSha;
  assert.equal(await evidence(state.github, state.context, state.input, state.options), false);
  assert.equal(state.calls.length, 0);
});
