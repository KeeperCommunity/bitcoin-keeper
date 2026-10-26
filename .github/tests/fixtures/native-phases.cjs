'use strict';
// Host-only phase compatibility fixtures. No native/installed authority.
const { execFileSync } = require('node:child_process');
const path = require('node:path'), crypto = require('node:crypto');
const { verifyStage } = require('../../native/r52_trust_ui_fixture.cjs');
const prototype = JSON.parse(execFileSync('python3', ['-B', path.join(__dirname, 'native_phases.py')], { encoding: 'utf8' }));
const hash = raw => crypto.createHash('sha256').update(raw).digest('hex');
const clone = value => structuredClone(value);
function attach(value, platform) {
  const binding = { scope: 'CURRENT_SOURCE_NATIVE_PHASE', source_sha: value.source_sha, workflow_sha: value.workflow_sha,
    workflow_ref: value.workflow_ref, run_id: value.run_id, run_attempt: value.run_attempt, platform,
    built_artifact: clone(value.built_artifact), installed_artifact: clone(value.installed_artifact) };
  const p = clone(prototype); p.config.platform = p.app.platform = p.app.rpc.platform = platform;
  if (platform === 'IOS') {
    const id = 'disposable_simulator_system_root';
    p.config.cases.push({ id, expected: 'ACCEPT', host: '127.0.0.1', port: 32999, ca: null });
    p.app.cases.push({ id, outcome: 'ACCEPT', connected: true });
    p.server.tls[id] = { connections: 1, secure_connections: 1, requests: 1, invalid_payloads: 0 };
    p.cases.push({ id, status: 'PASS', expected: 'ACCEPT', server_connection_observed: true, application_data_verified: true });
  }
  const configuration_json = JSON.stringify(p.config);
  value.r52_tls_native = { status: 'PASS', scope: 'ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE', source_sha: value.source_sha,
    platform, cases: p.cases, rpc: p.rpc, installed_bytes_verified: true, fixture_sha256: hash(configuration_json),
    full_r52_acceptance: false, cleanup: 'PASS', cleanup_failures: [], binding: clone(binding),
    raw_evidence: { configuration_json, app_payload: p.app, server_witnesses: p.server } };
  p.realm_config.platform = p.realm_app.platform = platform;
  p.realm_config.source_sha = p.realm_app.source_sha = value.source_sha;
  const realmJson = JSON.stringify(p.realm_config);
  value.r52_realm109_native = { status: 'PASS', scope: p.realm_app.scope, source_sha: value.source_sha, platform,
    cases: p.realm_cases.map(id => ({ id, status: 'PASS' })), installed_bytes_verified: true, config_sha256: hash(realmJson),
    historical_commit: p.realm_app.historical_commit, manifest_sha256: p.realm_app.manifest_sha256,
    published_app_upgrade: 'NOT RUN', full_r52_acceptance: false, cleanup: 'PASS', cleanup_failures: [],
    binding: clone(binding), raw_evidence: { configuration_json: realmJson, app_payload: p.realm_app } };
  const config = { schema: 1, nonce: 'c'.repeat(48), platform, a: { port: 4001, ca: 'A' },
    b: { port: 4002, ca: 'A' }, c: { port: 4003, ca: 'C' } };
  const stages = [], witness = Object.fromEntries(['a', 'b', 'c'].map(name => [name, { connections: 0, versions: 0, invalid: 0 }]));
  const obs = { schema: 1, nonce: config.nonce, platform, boot: 'bootone12345', realm_version: 110, rows: [], connected: false, active_port: null };
  const row = (port, ca, id) => ({ id, host: '127.0.0.1', port, useSSL: true, useKeeperNode: false,
    isConnected: true, networkType: 'TESTNET', ca_sha256: hash(ca) });
  const mark = stage => stages.push(verifyStage(config, stages, stage, obs, witness));
  mark('baseline'); obs.rows = [row(4001, 'A', 1001)]; obs.connected = true; obs.active_port = 4001;
  witness.a.connections = 2; witness.a.versions = 2; mark('custom_saved');
  witness.a.connections++; mark('failed_update_preserved'); obs.boot = 'boottwo12345'; witness.a.connections++; witness.a.versions++; mark('cold_reopen');
  obs.connected = false; obs.rows[0].isConnected = false; mark('disconnected');
  obs.connected = true; obs.rows[0].isConnected = true; witness.a.connections++; witness.a.versions++; mark('reconnected');
  witness.b.connections++; mark('untrusted_peer_rejected'); obs.rows.push(row(4003, 'C', 1002)); obs.active_port = 4003;
  witness.c.connections = 2; witness.c.versions = 2; mark('selfsigned_saved'); obs.rows = []; obs.connected = false; mark('fixture_nodes_removed');
  const trustJson = JSON.stringify(config);
  value.r52_trust_ui = { status: 'PASS', scope: 'NORMAL_PRODUCT_TRUST_UI_AND_NATIVE_REALM_READBACK', source_sha: value.source_sha,
    platform, product_entrypoint: 'index.js', full_r52_acceptance: false, cleanup: 'PASS', installed_artifact_verified: true,
    installed_artifact: clone(value.installed_artifact), fixture_nodes_removed_by_product_ui: true,
    configuration_json: trustJson, configuration_sha256: hash(trustJson), binding: clone(binding),
    native_evidence: { schema: 1, nonce: config.nonce, platform, status: 'PASS', scope: 'ACTUAL_NORMAL_PRODUCT_UI_WITH_READ_ONLY_NATIVE_REALM_OBSERVER', stages, witness: clone(witness) } };
  value.product_ui.node_trust_ui = clone(value.r52_trust_ui);
  if (platform === 'IOS') {
    value.native_keychain = 'PASS'; value.native_keychain_process_launches = 3; value.native_keychain_test_cases = 1; value.native_keychain_binding = clone(binding);
    value.native_keychain_evidence = { schema: 1, scope: 'ACTUAL_RN_KEYCHAIN_DISPOSABLE_SERVICE_ONLY',
      option_profile: 'PRODUCTION_WHEN_UNLOCKED_SERVICE_ONLY_NO_EXPLICIT_ACCESS_GROUP_OR_STORAGE', stage: 'pass', operation: 'VERIFY_DELETED',
      failure_code: null, native_code: null, native_acceptance: false };
    value.current_source_compilation = 'PASS'; value.build_execution_scope = 'FRESH_CURRENT_SOURCE_NORMAL_XCODE_SIMULATOR';
    value.installed_normal_signature_verified = true;
    value.ios_actual_install_readiness = ['startup', 'keychain', 'probe', 'features', 'product', 'tls', 'realm109'].map((suite, i) => ({
      suite, scope: 'FIRST_REQUIRED_INSTALL_ON_OWNED_BOOT_NOT_APP_LAUNCH_OR_UI_ACCEPTANCE', result: 'PASS',
      criterion: 'ACTUAL_BOUNDED_INSTALL_AND_VERIFIED_IDENTITY', app_service_readiness: 'ACTUAL_INSTALL_AND_FULL_IDENTITY_VERIFIED',
      listapps: 'NOT_RUN_ACTUAL_INSTALL_PATH', native_acceptance: false, device_sha256: String(i + 1).repeat(64),
      install_timeout_seconds: 120, installed_bytes: 'PASS', normal_signature: 'PASS',
      install_command: { command_index: 4 + i * 4, exit_code: 0, timeout_seconds: 120,
        label: suite === 'product' ? 'Install exact product UI app' : suite === 'tls' ? 'Install exact app for native TLS bridge' :
          suite === 'realm109' ? 'Install exact app for native Realm migration' : 'Install Xcode-signed development app' },
      boot_proof: [1, 2, 3].map(n => ({ command_index: n + i * 4, exit_code: 0, ...(n === 3 ? { timeout_seconds: 240 } : {}) })) }));
    value.toolchain = { ios_simulator_build_profile: 'normal-xcode', ios_simulator_signature: { verified: true,
      scope: 'XCODE_GENERATED_ADHOC_SIMULATOR_ONLY_NOT_RELEASE_SIGNING', entitlement_policy: 'XCODE_GENERATED_SIGNED_AND_LINKER_EMBEDDED_SIMULATOR_ENTITLEMENTS',
      bundle_id: 'io.hexawallet.hexakeeper.dev', entitlements_sha256: '9'.repeat(64), certificate_or_profile_used: false,
      process_macho: [{ image: 'hexa_keeper_dev', slices: [{ architecture: 'arm64', build_versions: [{ platform: 7, sdk: '18.5.0' }],
        simulator_entitlements_section_present: true, simulator_der_section_present: true, application_identifier_present: true,
        application_identifier: 'io.hexawallet.hexakeeper.dev' }] }] } };
    const ids = ['policy_root', 'policy_custom', 'policy_selfsigned', 'policy_expired-root', 'policy_expired-selfsigned',
      'delegate_valid_root', 'delegate_custom-leaf_custom', 'delegate_selfsigned_selfsigned', 'delegate_wronghost_wronghost',
      'delegate_expired_root', 'delegate_forged_root', 'delegate_valid_expired-root', 'delegate_expired-selfsigned_expired-selfsigned',
      ...[0, 1, 2].map(i => 'withdrawn_policy_' + i), ...Array.from({ length: 8 }, (_, i) => 'compromised_policy_' + i)];
    value.r52_tls_native.ios_security_framework = { schema: 1, scope: 'IOS_SIMULATOR_SECURITY_FRAMEWORK_EXACT_SOURCE_METHODS', status: 'PASS',
      cases: ids.map(id => ({ id, status: 'PASS' })), production_source_sha256: clone(require('../../native/r52_ios_policy.cjs').SHA), actual_app_bridge: false };
  }
  return value;
}
module.exports = { attach };
