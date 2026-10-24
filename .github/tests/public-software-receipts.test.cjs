'use strict';
// Actual producer snapshots/fake companion runners; never native acceptance.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { validatePublicSoftware, WORKER_SOURCES } = require('../native/public_software_receipts.cjs');
const { SCENARIOS, LIMITS } = require('../native/r5_features_core');
const { attach } = require('./fixtures/public-companions.cjs');
const raw = JSON.parse(execFileSync('python3', ['-B', path.join(__dirname, 'fixtures/public_software.py')], { encoding: 'utf8' }));
test('fixed source selection matches the actual production worker extractor', () => {
  const source = fs.readFileSync(path.join(__dirname, '../native/r5_prepare.cjs'), 'utf8');
  const literal = source.match(/const SELECTION = Object.freeze\((\{[\s\S]*?\})\);/)[1];
  assert.deepEqual(WORKER_SOURCES, JSON.parse(JSON.stringify(require('node:vm').runInNewContext('(' + literal + ')'))));
});
function fixture(platform) {
  const workerSources = Object.entries(WORKER_SOURCES).map(([name, names]) => ({ path: name, names: [...names],
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../..', name))).digest('hex') }));
  const expected = { platform, sourceSha: 'a'.repeat(40), workflowSha: 'b'.repeat(40),
    workflowRef: 'reviewed/workflow@refs/heads/test', runId: 12, runAttempt: 2, workerSources };
  const value = attach({ schema: 1, platform, source_sha: expected.sourceSha, workflow_sha: expected.workflowSha,
    workflow_ref: expected.workflowRef, run_id: '12', run_attempt: '2', diagnostic_only: false,
    app_id: platform === 'IOS' ? 'io.hexawallet.hexakeeper.dev' : 'io.hexawallet.keeper.development' }, platform);
  const bind = row => ({ ...structuredClone(row), installed_artifact_verified: true, installed_artifact: { ...value.installed_artifact } });
  Object.assign(value.product_ui, { requested_samples: 5, samples: raw.samples.map(bind),
    controlled_disconnect_retry: bind(raw.retry), key_management_ui: bind(raw.key) });
  value.r5_feature_evidence = { schema: 1, scope: 'production-worker-native-storage', status: 'PASS',
    scenarios: SCENARIOS.map(id => ({ id, status: 'PASS' })), limits: [...LIMITS], source_functions: structuredClone(workerSources),
    measurements: [1, 2, 3, 4, 5].map(iteration => ({ iteration, probe_ready_ms: 1, setup_first_wallet_ms: 2 })) };
  return { value, expected };
}
for (const platform of ['IOS', 'ANDROID']) {
  test(`${platform} real producer shapes yield only frozen false-trust facts`, () => {
    const { value, expected } = fixture(platform);
    assert.equal(value.product_ui.samples[0].pin_onboarding_progress.complete, false);
    value.product_ui.samples[0].other_backend_calls_rejected = 3;
    value.r5_feature_evidence.source_functions = value.r5_feature_evidence.source_functions.map(({ path, sha256, names }) => ({ sha256, names, path }));
    value.private = 'PRIVATE_SENTINEL';
    const result = validatePublicSoftware(value, expected);
    assert.deepEqual(Object.keys(result).sort(), ['schema', 'platform', 'source_sha', 'workflow_sha', 'run_id', 'run_attempt',
      'installed_artifact', 'installed_trust', 'release_ready', 'authorization_eligible', 'execution_allowed', 'release_authorized'].sort());
    assert.equal(result.installed_trust, 'UNVERIFIED');
    for (const key of ['release_ready', 'authorization_eligible', 'execution_allowed', 'release_authorized']) assert.equal(result[key], false);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.installed_artifact));
    assert.notEqual(result.installed_artifact, value.installed_artifact);
    assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
    value.product_ui.cleanup = 'PASS';
    assert.deepEqual(validatePublicSoftware(value, expected), result);
  });
  for (const [name, select] of [['root', v => v], ['product', v => v.product_ui],
    ['sample', v => v.product_ui.samples[0]], ['Retry', v => v.product_ui.controlled_disconnect_retry],
    ['key', v => v.product_ui.key_management_ui]]) for (const marker of ['cleanup', 'cleanup_failure_category'])
    test(`${platform} rejects ${name} explicit cleanup failure beneath successful status`, () => {
      const { value, expected } = fixture(platform); select(value)[marker] = 'FAILED';
      assert.throws(() => validatePublicSoftware(value, expected), /^Error: PUBLIC_SOFTWARE_RECEIPT_INVALID$/);
    });
  const selections = [v => v.product_ui.samples[0], v => v.product_ui.controlled_disconnect_retry, v => v.product_ui.key_management_ui];
  for (const [i, select] of selections.entries()) for (const mode of ['missing', 'reordered', 'duplicate', 'FAIL', 'bytes'])
    test(`${platform} raw group ${i} rejects ${mode}`, () => {
      const { value, expected } = fixture(platform), row = select(value);
      if (mode === 'missing') row.completed_stages.pop();
      else if (mode === 'reordered') row.completed_stages.reverse();
      else if (mode === 'duplicate') row.completed_stages[1] = row.completed_stages[0];
      else if (mode === 'FAIL') row.status = 'FAIL';
      else row.installed_artifact[platform === 'IOS' ? 'inventory_sha256' : 'sha256'] = '0'.repeat(64);
      assert.throws(() => validatePublicSoftware(value, expected), /^Error: PUBLIC_SOFTWARE_RECEIPT_INVALID$/);
    });
  for (const [name, change] of Object.entries({
    source: v => v.source_sha = 'c'.repeat(40), attempt: v => v.run_attempt = '1', diagnostic: v => v.diagnostic_only = true,
    workflow: v => v.workflow_sha = 'c'.repeat(40), ref: v => v.workflow_ref = 'other', run: v => v.run_id = '99',
    platform: v => v.platform = 'OTHER', app: v => v.app_id = 'other.app',
    predecessor: v => v.native_probe = 'FAIL', build: v => v.built_artifact = {}, truthy: v => v.installed_artifact_verified = 'true',
    navigation: v => v.product_ui.samples[0].more_wallets_navigation = 'NOT RUN',
    sample: v => v.product_ui.samples[1].sample = 1, counts: v => v.product_ui.samples[0].create_new_app_calls = 2,
    duration: v => v.product_ui.samples[0].raw_durations.start_new_to_home_ms = Infinity,
    impossibleHomeOrder: v => Object.assign(v.product_ui.samples[0].raw_durations, { start_new_to_ready_ms: 20, start_new_to_home_ms: 1 }),
    impossibleColdOrder: v => Object.assign(v.product_ui.samples[0].raw_durations, { cold_relaunch_to_login_ms: 20, cold_relaunch_to_authenticated_home_ms: 1 }),
    rejectedCounterType: v => v.product_ui.samples[0].other_backend_calls_rejected = '3',
    rejectedCounterNegative: v => v.product_ui.samples[0].other_backend_calls_rejected = -1,
    sixthRetry: v => v.product_ui.controlled_disconnect_retry.sample = 5,
    retryCounter: v => v.product_ui.controlled_disconnect_retry.other_backend_calls_rejected = false,
    startupCleanup: v => v.startup_cleanup_errors = ['device_uninstall'],
    startupObservationCleanup: v => v.startup_observation_cleanup = 'FAIL',
    installContradiction: v => v.install_succeeded = false,
    deviceContradiction: v => v.device = { fresh_disposable_state: 'true' },
    sampleFailureObservation: v => v.product_ui.samples[0].failure_observation = {},
    productFailure: v => v.product_ui.failure_category = 'RuntimeError',
    workerFailure: v => v.r5_feature_evidence.failure_category = 'RuntimeError',
    retry: v => v.product_ui.controlled_disconnect_retry.unexpected_create_attempts = 1,
    retryBefore: v => v.product_ui.controlled_disconnect_retry.visible_wallet_count_before_relaunch = 0,
    companion: v => v.product_ui.vault_references_ui.cleanup = 'FAILED',
    worker: v => v.r5_feature_evidence.scenarios.pop(), limits: v => v.r5_feature_evidence.limits.pop(),
    worker_cleanup: v => v.r5_feature_evidence.cleanup = 'FAILED',
    hash: v => v.r5_feature_evidence.source_functions[0].sha256 = '0'.repeat(64),
    measurement: v => v.r5_feature_evidence.measurements[0].probe_ready_ms = -1,
  })) test(`${platform} rejects ${name} without echoing payloads`, () => {
    const { value, expected } = fixture(platform); change(value); value.private = 'PRIVATE_SENTINEL';
    assert.throws(() => validatePublicSoftware(value, expected), /^Error: PUBLIC_SOFTWARE_RECEIPT_INVALID$/);
  });
  for (const name of ['referenced_vault_ui', 'credential_store_read_fault', 'physical_biometrics', 'protected_backup_deletion', 'recovery_key_preservation'])
    test(`${platform} cannot promote unused-key scope ${name}`, () => {
      const { value, expected } = fixture(platform); value.product_ui.key_management_ui[name] = 'PASS';
      assert.throws(() => validatePublicSoftware(value, expected), /PUBLIC_SOFTWARE_RECEIPT_INVALID/);
    });
  test(`${platform} expected worker identities cannot be absent, empty or self-selected`, () => {
    for (const sources of [undefined, [], [{ path: 'arbitrary', sha256: 'a'.repeat(64), names: [] }]]) {
      const { value, expected } = fixture(platform); expected.workerSources = value.r5_feature_evidence.source_functions = sources;
      assert.throws(() => validatePublicSoftware(value, expected), /PUBLIC_SOFTWARE_RECEIPT_INVALID/);
    }
    assert.throws(() => validatePublicSoftware({ status: 'PASS' }, {}), /PUBLIC_SOFTWARE_RECEIPT_INVALID/);
  });
}
