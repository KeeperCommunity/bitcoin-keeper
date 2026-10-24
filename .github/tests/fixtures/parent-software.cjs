'use strict';
// D448e09 contract controls at fake host boundaries. Never native results.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const { synthetic } = require('./private-integration.cjs');
const { attach: attachCompanions } = require('./public-companions.cjs');
const { attach: attachSoftware } = require('./public-software.cjs');
const { WORKER_SOURCES } = require('../../native/public_software_receipts.cjs');
const { SCENARIOS, LIMITS } = require('../../native/r5_features_core');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const phases = ['probe', 'features', 'product'], suites = ['protected', 'recovery', 'account'];
const ports = [8081, 8765, 8766, 8767, 8768, 8769];
const scopes = { probe: 'NATIVE_STORAGE_PRIMITIVES_ONLY', features: 'EXTRACTED_PRODUCTION_WORKERS_NATIVE_STORAGE_ONLY',
  product: 'FIVE_NORMAL_APP_RAW_PAIRS_RETRY_AND_SCOPED_COMPANIONS' };
const probeScope = 'CI-only Metro entrypoint; actual encrypted Realm/current schemas and production MMKV; ' +
  'three process launches, rollback, wrong-key rejection, targeted primitive deletion, separate database files and cleanup. ' +
  'NOT app key deletion, account isolation, setup/recovery or release performance acceptance.';

function syntheticParent(platform = 'IOS') {
  const fixture = synthetic(platform), { expected, values, aggregate, prefix } = fixture;
  const name = platform.toLowerCase(), startupName = `${prefix}/startup.json`;
  const finalName = `app/artifacts/native/${name}/metadata.json`, startup = values[startupName];
  const built = aggregate.built_artifact;
  expected.workerSources = Object.entries(WORKER_SOURCES).map(([member, names]) => ({ path: member,
    sha256: hash(fs.readFileSync(path.join(__dirname, '../../..', member))), names: [...names] }));
  // These identities and byte proofs are deliberately synthetic. Only the
  // independently read full production-source file hashes are actual bytes.
  const emulator = 'emulator-5566', androidOwner = hash(Buffer.from(emulator));
  startup.device = { id: platform === 'IOS' ? 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' : emulator,
    image: 'SYNTHETIC_HOST_FIXTURE_ONLY', fresh_disposable_state: true };
  startup.install_succeeded = true;
  startup.native_probe = 'NOT RUN'; startup.r5_features = 'NOT RUN';
  const probe = { ...structuredClone(startup), native_probe: 'PASS', native_probe_test_cases: 1, probe_scope: probeScope };
  const features = { ...structuredClone(probe), r5_features: 'PASS', r5_features_test_cases: 1,
    r5_feature_evidence: { schema: 1, scope: 'production-worker-native-storage', status: 'PASS',
      scenarios: SCENARIOS.map(id => ({ id, status: 'PASS' })), limits: [...LIMITS],
      source_functions: structuredClone(expected.workerSources), measurements: [1, 2, 3, 4, 5].map(iteration =>
        ({ iteration, probe_ready_ms: iteration, setup_first_wallet_ms: iteration + 1 })) } };
  // Both adapters use existing Python producers with explicitly fake host /
  // native boundaries. Their output supplies the real original receipt shape.
  const product = attachSoftware(attachCompanions(structuredClone(features), platform));
  Object.assign(product.product_ui, { requested_samples: 5, entrypoint: 'index.js', network: 'TESTNET', backend: 'CONTROLLED_LOOPBACK_CREATE_ONLY',
    backend_compatibility: 'NOT TESTED', physical_devices: 'NOT RUN',
    r5_release_acceptance: 'NOT ESTABLISHED; these are scoped diagnostic companions.' });
  values[finalName] = structuredClone(product);

  function cleanup(phase) {
    if (platform === 'IOS') return { kind: 'SIMULATOR', inventory_before_sha256: '9'.repeat(64),
      inventory_after_sha256: '9'.repeat(64), new_devices_remaining: 0 };
    return { kind: 'EMULATOR', device_sha256: androidOwner, app_absent: true, reverse_ports_absent: [...ports],
      removed_owned_reverse_ports: phase === 'product' ? [] : [8081] };
  }
  const events = [], start = 1000;
  function event(kind, timeout, elapsed) {
    const row = { index: events.length + 1, kind, declared_timeout_seconds: timeout,
      remaining_seconds: 14400 - elapsed, elapsed_seconds: elapsed, cleanup_reserve_seconds: 1200, admitted: true };
    events.push(row); return row;
  }
  const metadata = { probe, features, product };
  aggregate.public_phases = {};
  phases.forEach((phase, i) => {
    const elapsed = (i + 1) * 100;
    event('public_phase_entry', 600, elapsed);
    const commands = [event('normal_command', phase === 'features' ? 660 : phase === 'product' ? 600 : 300, elapsed + 1)];
    values[`${prefix}/public-${phase}.json`] = { schema: 1, phase, scope: scopes[phase], status: 'PASS',
      invocation: 'RETURNED', execution_started: true, failure_category: null,
      app_sha: expected.app.sha, app_tree: expected.app.tree, backend_base: expected.backend.sha,
      control_sha: expected.control.sha, control_tree: expected.control.tree, platform,
      run_id: String(expected.execution.runId), run_attempt: String(expected.execution.runAttempt),
      metadata: structuredClone(metadata[phase]), generated_source: { path: '.github/native/.generated/r5_workers.js',
        created: phase === 'features', absent_after: true, ...(phase === 'features' ? {
          sha256: hash(Buffer.from('synthetic generated worker bytes; not a native result')),
          source_functions: structuredClone(expected.workerSources) } : {}) },
      owned_device_cleanup: cleanup(phase), budget: { window_seconds: 14400, window_start_monotonic: start,
        remaining_start_seconds: 14400 - elapsed, remaining_seconds: 14400 - elapsed - 2,
        commands: structuredClone(commands) } };
    aggregate.public_phases[phase] = { status: 'PASS', scope: scopes[phase], execution_started: true,
      invocation: 'RETURNED', receipt_path: `${prefix}/public-${phase}.json`.slice('control/'.length),
      receipt_sha256: '', post_phase_barrier: 'PASS' };
  });
  suites.forEach((suite, i) => event('private_suite_entry', suite === 'account' ? 3600 : 3000, 400 + i * 100));
  aggregate.scope = 'PUBLIC_PHASES_AND_THREE_SERIAL_NORMAL_UI_FEATURE_SUITES_ONE_BUILD';
  aggregate.window_budget = { window_seconds: 14400, window_start_monotonic: start, remaining_seconds: 13799,
    events: structuredClone(events) };
  if (platform === 'ANDROID') aggregate.startup_resource_barrier = cleanup('startup');
  for (const source of Object.values(aggregate.source_admission)) source.rawSources.control.files = 110;

  const order = ['initial', ...phases.flatMap(phase => [`before_public_${phase}`, `after_public_${phase}`]),
    ...suites.flatMap(suite => [`before_${suite}`, `after_${suite}`])];
  aggregate.barriers = order.map(phase => ({ phase, source_proofs: structuredClone(aggregate.source_admission),
    built_artifact: structuredClone(built), resources: { overlays_absent: suites.map(suite => `.github/native/.private-${suite}`),
      listeners: ports.map(port => ({ port, result: 'ECONNREFUSED' })) }, retained_receipt_sha256: {} }));
  const encode = () => Object.fromEntries(Object.entries(values).map(([member, value]) =>
    [member, Buffer.from(JSON.stringify(value, null, 2) + '\n')]));
  // Rebind only byte links. Semantic mutations to stages, counters, statuses,
  // identities, cleanup, barriers or wrappers survive adversarial rehashing.
  function rebind(originalOverrides = {}) {
    const bytes = { ...encode(), ...originalOverrides }, retained = {};
    aggregate.startup_receipt_sha256 = hash(bytes[startupName]);
    for (const phase of phases) {
      const row = aggregate.public_phases?.[phase];
      if (row && typeof row === 'object') row.receipt_sha256 = hash(bytes[`${prefix}/public-${phase}.json`]);
    }
    for (const suite of suites) {
      const row = aggregate.suites?.[suite];
      if (row?.receipt_sha256 && typeof row.receipt_sha256 === 'object')
        for (const file of ['metadata.json', 'fixture.json']) row.receipt_sha256[file] = hash(bytes[`control/artifacts/native-${suite}/${name}/${file}`]);
    }
    (Array.isArray(aggregate.barriers) ? aggregate.barriers : []).forEach((row, i) => {
      if (i === 1) retained[startupName.slice('control/'.length)] = hash(bytes[startupName]);
      if (i >= 2 && i <= 6 && i % 2 === 0) {
        const member = `${prefix}/public-${phases[i / 2 - 1]}.json`; retained[member.slice('control/'.length)] = hash(bytes[member]);
      }
      if (i >= 8 && i % 2 === 0) for (const file of ['metadata.json', 'fixture.json']) {
        const member = `control/artifacts/native-${suites[(i - 8) / 2]}/${name}/${file}`;
        retained[member.slice('control/'.length)] = hash(bytes[member]);
      }
      if (row && typeof row === 'object') row.retained_receipt_sha256 = { ...retained };
    });
    return { ...encode(), ...originalOverrides };
  }
  return { expected, values, aggregate, raw: rebind(), encode, rebind, prefix };
}
module.exports = { syntheticParent };
