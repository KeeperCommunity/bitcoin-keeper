'use strict';
// Synthetic host proof composition only. No run/device/backend acceptance.
const { test } = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { REQUIRED } = require('../native/release_acceptance.cjs');
const { validateParentSoftwareEvidence, parentSoftwareMembers } = require('../native/parent_software_evidence.cjs');
const { validatePrivateIntegration } = require('../native/private_integration_receipts.cjs');
const { synthetic } = require('./fixtures/private-integration.cjs');
const { syntheticParent } = require('./fixtures/parent-software.cjs');
const reject = (raw, expected) => assert.throws(() => validateParentSoftwareEvidence(raw, expected), /^Error: PARENT_SOFTWARE_RECEIPT_INVALID$/);
for (const platform of ['IOS', 'ANDROID']) {
  const lower = platform.toLowerCase(), finalName = `app/artifacts/native/${lower}/metadata.json`;
  const wrapper = (f, phase) => f.values[`${f.prefix}/public-${phase}.json`];
  const bothProduct = (f, mutate) => { mutate(wrapper(f, 'product').metadata); mutate(f.values[finalName]); };
  test(`${platform} complete source-shaped D corpus yields five scoped facts and fixed false authority`, () => {
    const f = syntheticParent(platform), result = validateParentSoftwareEvidence(f.raw, f.expected);
    assert.deepEqual(result.cases.map(row => row.id), REQUIRED.slice(2));
    assert.ok(result.cases.every(row => row.status === 'PASS' && row.scope.length > 20));
    assert.equal(result.software_complete, true); assert.equal(result.installed_trust, 'UNVERIFIED');
    for (const key of ['release_ready', 'authorization_eligible', 'execution_allowed', 'release_authorized']) assert.equal(result[key], false);
    assert.equal(Object.keys(result.raw_sha256).length, 13);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.cases) && result.cases.every(Object.isFrozen) &&
      Object.isFrozen(result.identity.control) && Object.isFrozen(result.source_observations.app));
    assert.notEqual(result.installed_artifact, wrapper(f, 'product').metadata.installed_artifact);
    for (const [path, raw] of Object.entries(f.raw)) assert.equal(result.raw_sha256[path], crypto.createHash('sha256').update(raw).digest('hex'));
    assert.equal(result.generated_worker_sha256, wrapper(f, 'features').generated_source.sha256);
    assert.equal(Object.hasOwn(result, 'metadata'), false);
  });
  test(`${platform} original C2 defaults remain exact10/7, and neither profile accepts the other`, () => {
    const old = synthetic(platform), f = syntheticParent(platform);
    assert.equal(validatePrivateIntegration(old.raw, old.expected).public_parent_composition, 'NOT_FROZEN');
    reject(old.raw, old.expected);
    assert.throws(() => validatePrivateIntegration(f.raw, f.expected), /PRIVATE_INTEGRATION_RECEIPT_INVALID/);
  });
  for (let i = 0; i < 13; i++) test(`${platform} raw member ${i} is mandatory and duplicate decoded keys fail after true rebinding`, () => {
    const f = syntheticParent(platform), member = parentSoftwareMembers(platform)[i], missing = { ...f.raw };
    delete missing[member]; reject(missing, f.expected);
    const key = Object.keys(f.values[member])[0], encoded = JSON.stringify(key).replace(key[0], '\\u' + key.charCodeAt(0).toString(16).padStart(4, '0'));
    const duplicate = Buffer.concat([Buffer.from('{' + encoded + ':"CONTRADICTORY",'), f.raw[member].subarray(1)]);
    reject(member === `${f.prefix}/metadata.json` ? { ...f.raw, [member]: duplicate } : f.rebind({ [member]: duplicate }), f.expected);
  });
  for (const [name, mutate] of Object.entries({
    controllerTree: f => f.expected.control.tree = 'f'.repeat(40), appTree: f => f.expected.app.tree = 'f'.repeat(40),
    backend: f => f.expected.backend.sha = 'f'.repeat(40), attempt: f => f.expected.execution.runAttempt++,
    sourceOverlap: f => f.expected.workerSources.find(row => row.path === 'src/utils/utilities.ts').sha256 = 'f'.repeat(64),
    workerMissing: f => delete f.expected.workerSources,
    wrapperMissing: f => delete f.aggregate.public_phases.features,
    statusOnly: f => f.values[`${f.prefix}/metadata.json`] = { status: 'PASS' },
    scope: f => f.aggregate.scope = 'THREE_SERIAL_NORMAL_UI_FEATURE_SUITES_ONE_BUILD',
    sourceInventory: f => Object.values(f.aggregate.source_admission).forEach(row => row.rawSources.control.files = 98),
    startupCleanup: f => f.values[`${f.prefix}/startup.json`].startup_cleanup_errors = ['device_uninstall'],
    startupObservationCleanup: f => f.values[`${f.prefix}/startup.json`].startup_observation_cleanup = 'FAIL',
    installContradiction: f => f.values[`${f.prefix}/startup.json`].install_succeeded = false,
    deviceContradiction: f => f.values[`${f.prefix}/startup.json`].device.fresh_disposable_state = false,
    counter: f => bothProduct(f, row => row.product_ui.samples[0].other_backend_calls_rejected = '3'),
    retryCounter: f => bothProduct(f, row => row.product_ui.controlled_disconnect_retry.other_backend_calls_rejected = -1),
    sixthRetry: f => bothProduct(f, row => row.product_ui.controlled_disconnect_retry.sample = 5),
    homeBeforeReady: f => bothProduct(f, row => Object.assign(row.product_ui.samples[0].raw_durations, { start_new_to_ready_ms: 20, start_new_to_home_ms: 1 })),
    coldHomeBeforeLogin: f => bothProduct(f, row => Object.assign(row.product_ui.samples[0].raw_durations, { cold_relaunch_to_login_ms: 20, cold_relaunch_to_authenticated_home_ms: 1 })),
    sampleFailure: f => bothProduct(f, row => row.product_ui.samples[0].failure_observation = {}),
    productFailure: f => bothProduct(f, row => row.product_ui.failure_category = 'RuntimeError'),
    workerFailure: f => {
      wrapper(f, 'features').metadata.r5_feature_evidence.failure_category = 'RuntimeError';
      bothProduct(f, row => row.r5_feature_evidence.failure_category = 'RuntimeError');
    },
    inconsistentFinal: f => f.values[finalName].product_ui.samples[0].raw_durations.start_new_to_home_ms++,
    privateGate: f => {
      f.values[`control/artifacts/native-protected/${lower}/fixture.json`].releasedSnapshotResponseGates = 1;
      f.values[`control/artifacts/native-protected/${lower}/metadata.json`].fixture.releasedSnapshotResponseGates = 1;
    },
    privateNamespace: f => {
      f.values[`control/artifacts/native-account/${lower}/fixture.json`].distinctProtectedNamespaces = false;
      f.values[`control/artifacts/native-account/${lower}/metadata.json`].fixture.distinctProtectedNamespaces = false;
    },
    privateExit: f => f.aggregate.suites.account.process_exit_code = 1,
    mongoCleanup: f => delete f.values['control/artifacts/native-protected/mongo.json'].cleanup,
  })) test(`${platform} correctly rehashed ${name} cannot supply parent facts`, () => {
    const f = syntheticParent(platform); mutate(f); reject(f.rebind(), f.expected);
  });
  for (const phase of ['probe', 'features', 'product']) for (const [name, mutate] of Object.entries({
    didNotStart: row => row.execution_started = false, raised: row => row.invocation = 'RAISED',
    budget: row => row.invocation = 'NOT_STARTED_BUDGET', failure: row => row.failure_category = 'TimeoutExpired',
    legacyLabel: row => row.status = 'NOT_RUN', unexpectedExit: row => row.process_exit_code = 0,
    workflow: row => row.metadata.workflow_sha = 'f'.repeat(40), staleRun: row => row.metadata.run_id = '122',
    cleanup: row => row.metadata.startup_cleanup_errors = ['metro_process'],
    observationCleanup: row => row.metadata.startup_observation_cleanup = 'FAIL',
    bytes: row => row.metadata.installed_artifact[platform === 'IOS' ? 'inventory_sha256' : 'sha256'] = 'f'.repeat(64),
    generated: row => row.generated_source.absent_after = false,
    source: row => row.generated_source.created = !row.generated_source.created,
    device: row => row.owned_device_cleanup[platform === 'IOS' ? 'inventory_after_sha256' : 'app_absent'] = platform === 'IOS' ? 'f'.repeat(64) : false,
  })) test(`${platform} rehashed public ${phase}/${name} rejects status-only promotion`, () => {
    const f = syntheticParent(platform); mutate(wrapper(f, phase)); reject(f.rebind(), f.expected);
  });
  for (const [name, mutate] of Object.entries({
    probeCases: f => wrapper(f, 'probe').metadata.native_probe_test_cases = 0,
    probeBoolean: f => wrapper(f, 'probe').metadata.native_probe_test_cases = true,
    probeScope: f => wrapper(f, 'probe').metadata.probe_scope = 'COMPLETE_APPLICATION_ACCEPTANCE',
    featuresCases: f => wrapper(f, 'features').metadata.r5_features_test_cases = 0,
    generatedProvenance: f => wrapper(f, 'features').generated_source.source_functions = [],
    generatedHash: f => wrapper(f, 'features').generated_source.sha256 = 'INVALID',
    entryHash: f => f.aggregate.public_phases.probe.receipt_sha256 = 'f'.repeat(64),
    wrongPath: f => f.aggregate.public_phases.product.receipt_path = 'artifacts/elsewhere.json',
    missingBarrier: f => f.aggregate.barriers.pop(), order: f => f.aggregate.barriers.reverse(),
    missingListener: f => f.aggregate.barriers[4].resources.listeners.pop(),
    unknownListener: f => f.aggregate.barriers[4].resources.listeners[3].result = 'UNKNOWN',
    priorReceipt: f => f.aggregate.barriers[12].retained_receipt_sha256 = {},
    extraReceipt: f => f.aggregate.barriers[0].retained_receipt_sha256['artifacts/future.json'] = 'f'.repeat(64),
    budgetMissing: f => delete f.aggregate.window_budget,
    budgetIndex: f => f.aggregate.window_budget.events[1].index = 1,
    budgetFalse: f => f.aggregate.window_budget.events[1].admitted = false,
    budgetTimeout: f => f.aggregate.window_budget.events[1].declared_timeout_seconds = 0,
    budgetReserve: f => f.aggregate.window_budget.events[1].cleanup_reserve_seconds = 0,
    budgetClock: f => f.aggregate.window_budget.events[1].elapsed_seconds = 1,
    budgetCommandMissing: f => wrapper(f, 'features').budget.commands = [],
    budgetWrapperClock: f => wrapper(f, 'product').budget.window_start_monotonic++,
    budgetWindow: f => f.aggregate.window_budget.window_seconds = 20000,
    budgetExpiredFinal: f => f.aggregate.window_budget.remaining_seconds = -1,
    budgetExpiredWrapper: f => wrapper(f, 'product').budget.remaining_seconds = -1,
    budgetAfterEntry: f => wrapper(f, 'probe').budget.remaining_start_seconds = 14400,
    budgetPrivate: f => f.aggregate.window_budget.events.at(-1).declared_timeout_seconds = 3000,
  })) test(`${platform} rejects D barrier/invocation ledger ${name}`, () => {
    const f = syntheticParent(platform); mutate(f); reject(f.encode(), f.expected);
  });
  test(`${platform} successful original producer absence of cleanupPASS and nonzero rejected calls stay admissible`, () => {
    const f = syntheticParent(platform);
    for (const phase of ['probe', 'features', 'product']) assert.equal(Object.hasOwn(wrapper(f, phase).metadata, 'cleanup'), false);
    bothProduct(f, row => row.product_ui.samples.forEach(sample => sample.other_backend_calls_rejected = 3));
    assert.equal(validateParentSoftwareEvidence(f.rebind(), f.expected).release_ready, false);
  });
  test(`${platform} original wrapper whitespace is retained in every rebound hash`, () => {
    const f = syntheticParent(platform), member = `${f.prefix}/public-product.json`, raw = Buffer.concat([f.raw[member], Buffer.from(' ')]);
    const result = validateParentSoftwareEvidence(f.rebind({ [member]: raw }), f.expected);
    assert.equal(result.raw_sha256[member], crypto.createHash('sha256').update(raw).digest('hex'));
  });
}
test('unknown, empty and caller-selected raw manifests cannot assert parent completion', () => {
  for (const value of [undefined, null, {}, { status: 'PASS' }]) reject(value, {});
});
