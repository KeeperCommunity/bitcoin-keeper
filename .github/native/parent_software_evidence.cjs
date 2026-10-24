'use strict';
// Explicit D profile. Pure software facts; never Actions origin or release authority.
const crypto = require('node:crypto');
const { parseStrictJson } = require('./strict_json.cjs');
const { validatePublicSoftware } = require('./public_software_receipts.cjs');
const { privateIntegrationMembers, PRIVATE_INTEGRATION_CORE: core } = require('./private_integration_receipts.cjs');
const PHASES = ['probe', 'features', 'product'], SUITES = ['protected', 'recovery', 'account'];
const PORTS = [8081, 8765, 8766, 8767, 8768, 8769];
const SCOPES = { probe: 'NATIVE_STORAGE_PRIMITIVES_ONLY', features: 'EXTRACTED_PRODUCTION_WORKERS_NATIVE_STORAGE_ONLY',
  product: 'FIVE_NORMAL_APP_RAW_PAIRS_RETRY_AND_SCOPED_COMPANIONS' };
const PROBE_SCOPE = 'CI-only Metro entrypoint; actual encrypted Realm/current schemas and production MMKV; ' +
  'three process launches, rollback, wrong-key rejection, targeted primitive deletion, separate database files and cleanup. ' +
  'NOT app key deletion, account isolation, setup/recovery or release performance acceptance.';
const PARENTS = Object.freeze({
  'key-deletion-live-reference-and-privacy': 'unused key/PIN, visible/hidden Vault references and logical archive; scoped protected Delete/readback and local recovery preservation',
  'setup-offline-retry-relaunch-no-duplicates': 'controlled disconnect before commit, Retry and cold persistent counts; no WAN-offline claim',
  'app-account-session-isolation': 'native A/B/A account/Realm/history selection and current-protocol read namespaces plus stale-session workers; B backend mutation remains untested',
  'normal-page-runtime-and-recovery-regression': 'normal UI, controlled credential/history companions and fresh public-vector recovery; no authentic historical installation claim',
  'cold-start-and-first-wallet-performance': 'five original full-product startup/first-wallet pairs and five raw timing fields; development observations without a release performance threshold',
});
const demand = condition => { if (!condition) throw new Error('PARENT_SOFTWARE_RECEIPT_INVALID'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, fields) => object(value) && Object.keys(value).sort().join('|') === [...fields].sort().join('|');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const number = value => typeof value === 'number' && Number.isFinite(value);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((row, i) => same(row, b[i]));
  return object(a) && object(b) && keys(a, Object.keys(b)) && Object.keys(a).every(key => same(a[key], b[key]));
}
function fixed(value, fields) { demand(object(value) && Object.entries(fields).every(([key, expected]) => same(value[key], expected))); }
function noFailure(value) {
  demand(object(value) && !Object.keys(value).some(key => /^failure(?:_|$)/.test(key)) &&
    (!Object.hasOwn(value, 'cleanup') || value.cleanup === 'PASS') &&
    (!Object.hasOwn(value, 'cleanup_failure_categories') || same(value.cleanup_failure_categories, [])));
}
function parentSoftwareMembers(platform) {
  return Object.freeze([...privateIntegrationMembers(platform), ...PHASES.map(phase =>
    `control/artifacts/native-integration/${platform.toLowerCase()}/public-${phase}.json`)]);
}
function publicContext(expected) {
  return { platform: expected.platform, sourceSha: expected.app.sha, workflowSha: expected.execution.workflowSha,
    workflowRef: `${expected.execution.repository}/${expected.execution.workflowPath}@${expected.execution.ref}`,
    runId: expected.execution.runId, runAttempt: expected.execution.runAttempt, workerSources: expected.workerSources };
}
function publicMetadata(value, expected, built, proof) {
  core.foundation(value, expected, built, proof);
  demand(!Object.hasOwn(value, 'startup_cleanup_errors') || same(value.startup_cleanup_errors, []));
  demand(!Object.hasOwn(value, 'startup_observation_cleanup'));
  if (value.r5_feature_evidence) noFailure(value.r5_feature_evidence);
  if (value.product_ui) {
    const ui = value.product_ui;
    [ui, ...(Array.isArray(ui.samples) ? ui.samples : []), ui.controlled_disconnect_retry, ui.key_management_ui]
      .filter(row => row !== undefined).forEach(noFailure);
  }
}
function device(value, expected, phase, androidOwner) {
  if (expected.platform === 'IOS') {
    demand(keys(value, ['kind', 'inventory_before_sha256', 'inventory_after_sha256', 'new_devices_remaining']));
    fixed(value, { kind: 'SIMULATOR', new_devices_remaining: 0 });
    demand(hex(value.inventory_before_sha256) && value.inventory_after_sha256 === value.inventory_before_sha256);
  } else {
    demand(keys(value, ['kind', 'device_sha256', 'app_absent', 'reverse_ports_absent', 'removed_owned_reverse_ports']));
    fixed(value, { kind: 'EMULATOR', app_absent: true, reverse_ports_absent: PORTS, device_sha256: androidOwner });
    const removed = value.removed_owned_reverse_ports, allowed = phase === 'product' ? [8081, 8765, 8766, 8767, 8769] : [8081];
    demand(hex(value.device_sha256) && Array.isArray(removed) && same(removed, [...new Set(removed)].sort((a, b) => a - b)) &&
      removed.every(port => allowed.includes(port)));
  }
}
function budget(value, wrappers) {
  demand(keys(value, ['window_seconds', 'window_start_monotonic', 'remaining_seconds', 'events']));
  demand(value.window_seconds === 14400 && number(value.window_start_monotonic) && value.window_start_monotonic >= 0 &&
    number(value.remaining_seconds) && value.remaining_seconds >= 0 && value.remaining_seconds <= 14400 && Array.isArray(value.events) && value.events.length <= 2048);
  let previous = 14400;
  value.events.forEach((row, i) => {
    demand(keys(row, ['index', 'kind', 'declared_timeout_seconds', 'remaining_seconds', 'elapsed_seconds', 'cleanup_reserve_seconds', 'admitted']));
    demand(row.index === i + 1 && number(row.declared_timeout_seconds) && row.declared_timeout_seconds > 0 && row.declared_timeout_seconds <= 7200 &&
      number(row.remaining_seconds) && row.remaining_seconds <= previous && number(row.elapsed_seconds) && row.elapsed_seconds >= 0 &&
      Math.abs(row.remaining_seconds + row.elapsed_seconds - 14400) <= 0.000001 && row.cleanup_reserve_seconds === 1200 &&
      row.admitted === true && row.remaining_seconds >= row.declared_timeout_seconds + 1200);
    previous = row.remaining_seconds;
  });
  let cursor = 0, previousEnd = 14400;
  for (const phase of PHASES) {
    const entry = value.events[cursor++], row = wrappers[phase].budget;
    demand(entry?.kind === 'public_phase_entry' && entry.declared_timeout_seconds === 600 && entry.remaining_seconds <= previousEnd &&
      keys(row, ['window_seconds', 'window_start_monotonic', 'remaining_start_seconds', 'remaining_seconds', 'commands']));
    fixed(row, { window_seconds: 14400, window_start_monotonic: value.window_start_monotonic });
    demand(number(row.remaining_start_seconds) && row.remaining_start_seconds >= 0 && row.remaining_start_seconds <= entry.remaining_seconds &&
      number(row.remaining_seconds) && row.remaining_seconds >= 0 && row.remaining_seconds <= row.remaining_start_seconds &&
      Array.isArray(row.commands) && row.commands.length > 0 && row.commands.every(command => command.kind === 'normal_command') &&
      same(row.commands, value.events.slice(cursor, cursor + row.commands.length)) &&
      row.commands[0].remaining_seconds <= row.remaining_start_seconds && row.remaining_seconds <= row.commands.at(-1).remaining_seconds);
    cursor += row.commands.length; previousEnd = row.remaining_seconds;
  }
  for (const suite of SUITES) {
    const entry = value.events[cursor++];
    demand(entry?.kind === 'private_suite_entry' && entry.declared_timeout_seconds === (suite === 'account' ? 3600 : 3000) &&
      entry.remaining_seconds <= previousEnd);
    previousEnd = entry.remaining_seconds;
  }
  demand(cursor === value.events.length && value.remaining_seconds <= previousEnd);
}
function validateParentSoftwareEvidence(rawFiles, suppliedExpected) {
  try {
    const expected = core.context(suppliedExpected), members = parentSoftwareMembers(expected.platform), values = {}, hashes = {};
    demand(Array.isArray(expected.workerSources) && expected.recoverySources.every(row => {
      const overlap = expected.workerSources.find(worker => worker.path === row.path);
      return !overlap || overlap.sha256 === row.sha256;
    }));
    demand(keys(rawFiles, members));
    for (const name of members) {
      const bytes = rawFiles[name], cap = name.endsWith('/fixture.json') || name.endsWith('/mongo.json') ? 8192 :
        /control\/artifacts\/native-(?:protected|recovery|account)\//.test(name) ? 32768 : 2_000_000;
      demand(Buffer.isBuffer(bytes)); values[name] = parseStrictJson(bytes, cap); demand(object(values[name])); hashes[name] = digest(bytes);
    }
    const [aggregateName, startupName] = members, aggregate = values[aggregateName], startup = values[startupName];
    const prefix = `control/artifacts/native-integration/${expected.platform.toLowerCase()}`;
    noFailure(aggregate);
    demand(keys(aggregate, ['schema', 'status', 'app_sha', 'app_tree', 'control_sha', 'control_tree', 'backend_base', 'platform',
      'run_id', 'run_attempt', 'built_artifact', 'scope', 'source_admission', 'barriers', 'suites', 'physical_devices',
      'historical_upgrade', 'b_backend_mutation_isolation', 'biometrics', 'five_startup_measurements', 'trusted_acceptance',
      'release_readiness', 'startup_receipt_sha256', 'public_phases', 'window_budget',
      ...(expected.platform === 'ANDROID' ? ['startup_resource_barrier'] : [])]));
    fixed(aggregate, { schema: 1, status: 'PASS', app_sha: expected.app.sha, app_tree: expected.app.tree,
      control_sha: expected.control.sha, control_tree: expected.control.tree, backend_base: expected.backend.sha,
      platform: expected.platform, run_id: String(expected.execution.runId), run_attempt: String(expected.execution.runAttempt),
      scope: 'PUBLIC_PHASES_AND_THREE_SERIAL_NORMAL_UI_FEATURE_SUITES_ONE_BUILD', physical_devices: 'NOT_TESTED', historical_upgrade: 'NOT_TESTED',
      b_backend_mutation_isolation: 'NOT_TESTED', biometrics: 'NOT_TESTED', five_startup_measurements: 'REQUIRES_SEPARATE_RAW_MEASUREMENT_EVIDENCE',
      trusted_acceptance: 'NOT_ESTABLISHED', release_readiness: 'NOT_ESTABLISHED', startup_receipt_sha256: hashes[startupName] });
    const built = aggregate.built_artifact; core.builtIdentity(built, expected.platform);
    const proof = core.foundation(startup, expected, built);
    core.sourceProofs(aggregate.source_admission, expected);
    demand(aggregate.source_admission.protected.rawSources.control.files >= 101);
    const final = values[members[9]], wrappers = {};
    let androidOwner;
    if (expected.platform === 'ANDROID') {
      demand(typeof startup.device?.id === 'string' && /^emulator-[0-9]+$/.test(startup.device.id));
      androidOwner = digest(Buffer.from(startup.device.id));
      device(aggregate.startup_resource_barrier, expected, 'startup', androidOwner);
    }
    demand(keys(aggregate.public_phases, PHASES));
    for (const phase of PHASES) {
      const path = `${prefix}/public-${phase}.json`, wrapper = values[path], entry = aggregate.public_phases[phase];
      demand(keys(wrapper, ['schema', 'phase', 'scope', 'status', 'invocation', 'execution_started', 'failure_category',
        'app_sha', 'app_tree', 'backend_base', 'control_sha', 'control_tree', 'platform', 'run_id', 'run_attempt',
        'metadata', 'generated_source', 'owned_device_cleanup', 'budget']));
      fixed(wrapper, { schema: 1, phase, scope: SCOPES[phase], status: 'PASS', invocation: 'RETURNED', execution_started: true,
        failure_category: null, app_sha: expected.app.sha, app_tree: expected.app.tree, backend_base: expected.backend.sha,
        control_sha: expected.control.sha, control_tree: expected.control.tree, platform: expected.platform,
        run_id: String(expected.execution.runId), run_attempt: String(expected.execution.runAttempt) });
      demand(keys(entry, ['status', 'scope', 'execution_started', 'invocation', 'receipt_path', 'receipt_sha256', 'post_phase_barrier']));
      fixed(entry, { status: 'PASS', scope: SCOPES[phase], execution_started: true, invocation: 'RETURNED',
        receipt_path: path.slice('control/'.length), receipt_sha256: hashes[path], post_phase_barrier: 'PASS' });
      publicMetadata(wrapper.metadata, expected, built, proof);
      device(wrapper.owned_device_cleanup, expected, phase, androidOwner);
      const generated = wrapper.generated_source;
      demand(keys(generated, ['path', 'created', 'absent_after', ...(phase === 'features' ? ['sha256', 'source_functions'] : [])]));
      fixed(generated, { path: '.github/native/.generated/r5_workers.js', created: phase === 'features', absent_after: true });
      if (phase === 'features') demand(hex(generated.sha256) && same(generated.source_functions, expected.workerSources));
      wrappers[phase] = wrapper;
    }
    const probe = wrappers.probe.metadata, features = wrappers.features.metadata, product = wrappers.product.metadata;
    fixed(probe, { native_probe: 'PASS', probe_scope: PROBE_SCOPE });
    demand(Number.isSafeInteger(probe.native_probe_test_cases) && probe.native_probe_test_cases > 0);
    fixed(features, { native_probe: 'PASS', probe_scope: PROBE_SCOPE, native_probe_test_cases: probe.native_probe_test_cases, r5_features: 'PASS' });
    demand(Number.isSafeInteger(features.r5_features_test_cases) && features.r5_features_test_cases > 0);
    validatePublicSoftware(product, publicContext(expected)); publicMetadata(final, expected, built, proof);
    validatePublicSoftware(final, publicContext(expected));
    for (const row of [product, final]) {
      fixed(row, { probe_scope: PROBE_SCOPE, native_probe_test_cases: probe.native_probe_test_cases,
        r5_features_test_cases: features.r5_features_test_cases, r5_feature_evidence: features.r5_feature_evidence });
    }
    for (const key of ['product_ui', 'product_credential_ui', 'product_version_history_ui', 'product_vault_ui']) demand(same(final[key], product[key]));
    budget(aggregate.window_budget, wrappers);
    const order = ['initial', ...PHASES.flatMap(phase => ['before_public_' + phase, 'after_public_' + phase]),
      ...SUITES.flatMap(suite => ['before_' + suite, 'after_' + suite])], retained = {};
    demand(Array.isArray(aggregate.barriers) && aggregate.barriers.length === order.length);
    aggregate.barriers.forEach((row, i) => {
      if (i === 1) retained[startupName.slice('control/'.length)] = hashes[startupName];
      if (i >= 2 && i <= 6 && i % 2 === 0) {
        const path = `${prefix}/public-${PHASES[i / 2 - 1]}.json`; retained[path.slice('control/'.length)] = hashes[path];
      }
      if (i >= 8 && i % 2 === 0) for (const file of ['metadata.json', 'fixture.json']) {
        const path = `control/artifacts/native-${SUITES[(i - 8) / 2]}/${expected.platform.toLowerCase()}/${file}`;
        retained[path.slice('control/'.length)] = hashes[path];
      }
      demand(keys(row, ['phase', 'source_proofs', 'built_artifact', 'resources', 'retained_receipt_sha256']));
      fixed(row, { phase: order[i], source_proofs: aggregate.source_admission, built_artifact: built, retained_receipt_sha256: retained,
        resources: { overlays_absent: SUITES.map(suite => `.github/native/.private-${suite}`),
          listeners: PORTS.map(port => ({ port, result: 'ECONNREFUSED' })) } });
    });
    core.privateSuites(values, hashes, expected, built, proof, aggregate.suites);
    core.mongo(values['control/artifacts/native-protected/mongo.json'], expected);
    return Object.freeze({ schema: 1, platform: expected.platform, software_complete: true,
      cases: Object.freeze(Object.entries(PARENTS).map(([id, scope]) => Object.freeze({ id, status: 'PASS', scope }))),
      identity: Object.freeze({ app: Object.freeze({ ...expected.app }), control: Object.freeze({ ...expected.control }),
        backend: Object.freeze({ ...expected.backend }), execution: Object.freeze({ ...expected.execution }) }),
      raw_sha256: Object.freeze(hashes), installed_artifact: Object.freeze({ ...proof }),
      source_observations: Object.freeze({ app: Object.freeze({ ...aggregate.source_admission.protected.rawSources.app }),
        control: Object.freeze({ ...aggregate.source_admission.protected.rawSources.control }) }),
      generated_worker_sha256: wrappers.features.generated_source.sha256,
      installed_trust: 'UNVERIFIED', release_ready: false, authorization_eligible: false,
      execution_allowed: false, release_authorized: false });
  } catch { throw new Error('PARENT_SOFTWARE_RECEIPT_INVALID'); }
}
module.exports = { validateParentSoftwareEvidence, parentSoftwareMembers };
