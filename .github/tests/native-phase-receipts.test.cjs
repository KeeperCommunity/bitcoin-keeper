'use strict';
// Synthetic receipt/source controls; these never provide native acceptance.
const { test } = require('node:test'), assert = require('node:assert/strict');
const { validateNativePhases } = require('../native/native_phase_receipts.cjs');
const { attach } = require('./fixtures/native-phases.cjs');
const hash = raw => require('node:crypto').createHash('sha256').update(raw).digest('hex');
function changeConfig(value, name, mutate) {
  const row = value[name], config = JSON.parse(row.raw_evidence.configuration_json);
  mutate(config); row.raw_evidence.configuration_json = JSON.stringify(config);
  row[name === 'r52_tls_native' ? 'fixture_sha256' : 'config_sha256'] = hash(row.raw_evidence.configuration_json);
}
function fixture(platform) {
  const expected = { platform, sourceSha: 'a'.repeat(40), workflowSha: 'a'.repeat(40), runId: 12, runAttempt: 2,
    workflowRef: 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/keeper-canonical-native.yml@refs/heads/sprint' };
  const value = { schema: 1, platform, source_sha: expected.sourceSha, workflow_sha: expected.workflowSha,
    workflow_ref: expected.workflowRef, run_id: '12', run_attempt: '2', build: 'PASS', smoke: 'PASS', diagnostic_only: false,
    installed_artifact_verified: true, product_ui: {}, built_artifact: platform === 'IOS' ?
      { path: '/runner/hexa_keeper_dev.app', executable: 'hexa_keeper_dev', executable_sha256: 'e'.repeat(64), bundle_tree_sha256: 'f'.repeat(64) } :
      { path: 'android/app/build/outputs/apk/development/debug/app-development-debug.apk', sha256: 'e'.repeat(64) },
    installed_artifact: platform === 'IOS' ? { method: 'FULL_SIMULATOR_BUNDLE_TREE_AND_EXECUTABLE_SHA256',
      inventory_sha256: 'd'.repeat(64), executable_sha256: 'e'.repeat(64) } : { method: 'SINGLE_INSTALLED_BASE_APK_SHA256', sha256: 'e'.repeat(64) } };
  return { value: attach(value, platform), expected };
}
for (const platform of ['IOS', 'ANDROID']) {
  test(`${platform} replays complete original TLS/RPC/Realm/trust contracts`, () => {
    const { value, expected } = fixture(platform);
    assert(Object.values(validateNativePhases(value, expected)).every(status => status === 'PASS'));
  });
  const changes = {
    missing_tls: v => delete v.r52_tls_native, missing_realm: v => delete v.r52_realm109_native,
    missing_trust: v => delete v.r52_trust_ui, diagnostic: v => v.diagnostic_only = true,
    retained_ff: v => v.original_build = { source_sha: 'f'.repeat(40), build: 'PASS' },
    wrong_compiled_source: v => v.compiled_app_source_sha = 'f'.repeat(40),
    retained_binding: v => v.r52_tls_native.binding.scope = 'RETAINED_PRIVATE_DIAGNOSTIC',
    wrong_phase_source: v => v.r52_realm109_native.binding.source_sha = 'f'.repeat(40),
    wrong_phase_artifact: v => v.r52_trust_ui.binding.installed_artifact.sha256 = 'f'.repeat(64),
    not_run: v => v.r52_tls_native.status = 'NOT RUN', failed_cleanup: v => v.r52_realm109_native.cleanup = 'FAIL',
    tls_timeout: v => v.r52_tls_native.raw_evidence.app_payload.cases[0].outcome = 'TIMEOUT',
    unreachable_rejection: v => v.r52_tls_native.raw_evidence.server_witnesses.tls.selfsigned_untrusted.connections = 0,
    missing_real_reset: v => v.r52_tls_native.raw_evidence.server_witnesses.rpc.stages[0].witnesses.selected.drops = 0,
    borrowed_retry: v => v.r52_tls_native.raw_evidence.app_payload.rpc.cases[5].client_replaced = false,
    rehashed_duplicate_tls_ports: v => changeConfig(v, 'r52_tls_native', c => c.cases[1].port = c.cases[0].port),
    rehashed_rpc_public_host: v => changeConfig(v, 'r52_tls_native', c => c.rpc.selected.host = 'public.invalid'),
    rehashed_rpc_missing_host: v => changeConfig(v, 'r52_tls_native', c => delete c.rpc.selected.host),
    rehashed_rpc_other_public_host: v => changeConfig(v, 'r52_tls_native', c => c.rpc.other.host = 'public.invalid'),
    rehashed_rpc_missing_other: v => changeConfig(v, 'r52_tls_native', c => delete c.rpc.other),
    rehashed_rpc_missing_control: v => changeConfig(v, 'r52_tls_native', c => delete c.rpc.control_port),
    rehashed_rpc_noninteger_control: v => changeConfig(v, 'r52_tls_native', c => c.rpc.control_port = true),
    rehashed_rpc_duplicate_peer_port: v => changeConfig(v, 'r52_tls_native', c => c.rpc.other.port = c.rpc.selected.port),
    rehashed_rpc_duplicate_control_port: v => changeConfig(v, 'r52_tls_native', c => c.rpc.control_port = c.cases[0].port),
    rehashed_rpc_wrong_schema: v => changeConfig(v, 'r52_tls_native', c => c.rpc.schema = 0),
    rehashed_tls_boolean_schema: v => changeConfig(v, 'r52_tls_native', c => c.schema = true),
    rehashed_rpc_boolean_schema: v => changeConfig(v, 'r52_tls_native', c => c.rpc.schema = true),
    rehashed_realm_boolean_schema: v => changeConfig(v, 'r52_realm109_native', c => c.schema = true),
    tls_app_boolean_schema: v => v.r52_tls_native.raw_evidence.app_payload.schema = true,
    rpc_app_boolean_schema: v => v.r52_tls_native.raw_evidence.app_payload.rpc.schema = true,
    rpc_server_boolean_schema: v => v.r52_tls_native.raw_evidence.server_witnesses.rpc.schema = true,
    rehashed_rpc_wrong_transaction: v => changeConfig(v, 'r52_tls_native', c => c.rpc.expected.fake_transaction = 'not-disposable'),
    wrong_migration_key_case: v => v.r52_realm109_native.raw_evidence.app_payload.cases[8].status = 'NOT RUN',
    host_schema_scope: v => v.r52_realm109_native.raw_evidence.app_payload.scope = 'HOST_REALM_ONLY',
    rehashed_wrong_old_schema: v => changeConfig(v, 'r52_realm109_native', c => c.schema_count = 49),
    rehashed_wrong_history: v => changeConfig(v, 'r52_realm109_native', c => c.historical_commit = '0'.repeat(40)),
    rehashed_missing_module: v => changeConfig(v, 'r52_realm109_native', c => c.generated.pop()),
    rehashed_shadow_module: v => changeConfig(v, 'r52_realm109_native', c => c.generated[0].name = 'index.ios.js'),
    duplicate_trust_config: v => { const row = v.r52_trust_ui; row.configuration_json = row.configuration_json.replace('"schema":1', '"schema":0,"schema":1');
      row.configuration_sha256 = hash(row.configuration_json); },
    changed_trust_native_row: v => v.r52_trust_ui.native_evidence.stages[2].observation.rows[0].id++,
    unchanged_boot: v => v.r52_trust_ui.native_evidence.stages[3].observation.boot = 'bootone12345',
    inherited_ca: v => v.r52_trust_ui.native_evidence.stages[6].witness.b.versions = 1,
  };
  if (platform === 'IOS') Object.assign(changes, {
    skipped_keychain: v => v.native_keychain = 'SKIP', two_launches: v => v.native_keychain_process_launches = 2,
    incomplete_keychain: v => v.native_keychain_evidence.operation = 'VERIFY_UPDATED',
    unsigned_simulator: v => v.toolchain.ios_simulator_signature.verified = false,
    no_embedded_der: v => v.toolchain.ios_simulator_signature.process_macho[0].slices[0].simulator_der_section_present = false,
    wrong_architecture: v => v.toolchain.ios_simulator_signature.process_macho[0].slices[0].architecture = 'x86_64',
    missing_install_proof: v => v.ios_actual_install_readiness.pop(),
    listapps_substitution: v => v.ios_actual_install_readiness[0].listapps = 'PASS',
    failed_install: v => v.ios_actual_install_readiness[0].install_command.exit_code = 1,
    before_boot_install: v => v.ios_actual_install_readiness[0].install_command.command_index = 1,
  });
  for (const [name, change] of Object.entries(changes)) test(`${platform} rejects ${name} beneath top-level PASS`, () => {
    const { value, expected } = fixture(platform); change(value);
    assert.throws(() => validateNativePhases(value, expected));
  });
}
