'use strict';
// Pure current-source phase contracts; API/job/custody authority is separate.
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual: equal } = require('node:util');
const trust = require('./r52_trust_ui_fixture.cjs');
const { parseStrictJson } = require('./strict_json.cjs');
const demand = value => { if (!value) throw new Error('REQUIRED_NATIVE_PHASE_INVALID'); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const SCOPES = Object.freeze({
  'native-keychain': 'actual disposable iOS Keychain write/update/delete across three app processes',
  'native-tls-and-rpc': 'actual RN TLS bridge and production Electrum caller with independent server witnesses',
  'native-realm109-migration': 'native encrypted historical schema109 fixture migrated by current initializer; not published app upgrade',
  'normal-product-trust-ui': 'normal product trust edit/probe/save/cold reopen with native Realm and server witnesses',
});
function clean(row) {
  demand(row && row.status === 'PASS' && row.cleanup === 'PASS' &&
    (!Object.hasOwn(row, 'cleanup_failures') || equal(row.cleanup_failures, [])) &&
    !Object.keys(row).some(key => /^(failure|cleanup_failure)(_|$)/.test(key)));
}
function binding(row, metadata, expected) {
  demand(equal(row, { scope: 'CURRENT_SOURCE_NATIVE_PHASE', source_sha: expected.sourceSha,
    workflow_sha: expected.workflowSha, workflow_ref: expected.workflowRef,
    run_id: String(expected.runId), run_attempt: String(expected.runAttempt), platform: expected.platform,
    built_artifact: metadata.built_artifact, installed_artifact: metadata.installed_artifact }));
}
function validateNativePhases(value, expected) {
  const { platform, sourceSha } = expected;
  demand(['IOS', 'ANDROID'].includes(platform) && value.build === 'PASS' && value.smoke === 'PASS' &&
    value.diagnostic_only === false && value.installed_artifact_verified === true &&
    !['original_build', 'diagnostic_controller_sha', 'reused_original_build'].some(key => Object.hasOwn(value, key)) &&
    (!value.compiled_app_source_sha || value.compiled_app_source_sha === sourceSha) &&
    !/RETAINED|REUSED/i.test(value.build_execution_scope || ''));
  demand(typeof value.built_artifact?.path === 'string' && value.built_artifact.path.length > 0 &&
    (platform === 'IOS' ? value.built_artifact.executable === 'hexa_keeper_dev' && hex(value.built_artifact.executable_sha256) &&
      hex(value.built_artifact.bundle_tree_sha256) :
      value.built_artifact.path === 'android/app/build/outputs/apk/development/debug/app-development-debug.apk' && hex(value.built_artifact.sha256)));
  const tls = value.r52_tls_native, realm = value.r52_realm109_native, ui = value.r52_trust_ui;
  for (const row of [tls, realm, ui]) {
    clean(row); binding(row.binding, value, expected);
    demand(row.source_sha === sourceSha && row.platform === platform && row.full_r52_acceptance === false &&
      !Object.hasOwn(row, 'diagnostic_controller_sha') && !Object.hasOwn(row, 'original_producer'));
  }
  demand(tls.scope === 'ACTUAL_APP_RN_PRODUCTION_TLS_BRIDGE' && tls.installed_bytes_verified === true &&
    realm.scope === 'ACTUAL_NATIVE_SYNTHETIC_REALM109_TO_110' && realm.installed_bytes_verified === true &&
    realm.published_app_upgrade === 'NOT RUN');
  const raw = JSON.parse(execFileSync('python3', ['-B', path.join(__dirname, 'native_phase_evidence.py')], {
    input: JSON.stringify({ platform, sourceSha, tls, realm }), encoding: 'utf8', timeout: 10000, maxBuffer: 4096,
    env: { PATH: process.env.PATH, PYTHONPYCACHEPREFIX: '/dev/null', PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
  }));
  demand(equal(raw, { tls: 'PASS', rpc: 'PASS', realm109: 'PASS' }));
  if (platform === 'IOS') {
    const evidence = value.native_keychain_evidence;
    binding(value.native_keychain_binding, value, expected);
    demand(value.native_keychain === 'PASS' && value.native_keychain_process_launches === 3 &&
      Number.isSafeInteger(value.native_keychain_test_cases) && value.native_keychain_test_cases > 0 &&
      equal(evidence, { schema: 1, scope: 'ACTUAL_RN_KEYCHAIN_DISPOSABLE_SERVICE_ONLY',
        option_profile: 'PRODUCTION_WHEN_UNLOCKED_SERVICE_ONLY_NO_EXPLICIT_ACCESS_GROUP_OR_STORAGE',
        stage: 'pass', operation: 'VERIFY_DELETED', failure_code: null, native_code: null, native_acceptance: false }));
    const signature = value.toolchain?.ios_simulator_signature;
    demand(value.current_source_compilation === 'PASS' && value.build_execution_scope === 'FRESH_CURRENT_SOURCE_NORMAL_XCODE_SIMULATOR' &&
      value.toolchain.ios_simulator_build_profile === 'normal-xcode' && signature?.verified === true &&
      signature.scope === 'XCODE_GENERATED_ADHOC_SIMULATOR_ONLY_NOT_RELEASE_SIGNING' &&
      signature.entitlement_policy === 'XCODE_GENERATED_SIGNED_AND_LINKER_EMBEDDED_SIMULATOR_ENTITLEMENTS' &&
      signature.bundle_id === 'io.hexawallet.hexakeeper.dev' && hex(signature.entitlements_sha256) &&
      signature.certificate_or_profile_used === false && Array.isArray(signature.process_macho) &&
      signature.process_macho.length > 0 && signature.process_macho.length <= 2 &&
      new Set(signature.process_macho.map(row => row.image)).size === signature.process_macho.length &&
      signature.process_macho.every(row => ['hexa_keeper_dev', 'hexa_keeper_dev.debug.dylib'].includes(row.image) &&
        row.slices?.length === 1 && row.slices[0].architecture === 'arm64' && row.slices[0].build_versions?.length > 0 &&
        row.slices[0].build_versions.every(version => version.platform === 7 && version.sdk === '18.5.0')) &&
      signature.process_macho.some(row => { const slice = row.slices[0]; return slice.simulator_entitlements_section_present === true &&
        slice.simulator_der_section_present === true && slice.application_identifier_present === true &&
        (slice.application_identifier === signature.bundle_id || slice.application_identifier?.endsWith('.' + signature.bundle_id)); }));
    const readiness = value.ios_actual_install_readiness;
    demand(value.installed_normal_signature_verified === true && Array.isArray(readiness) && readiness.length >= 5 && readiness.length <= 32 &&
      ['startup', 'keychain', 'probe', 'features', 'product', 'tls', 'realm109'].every(suite => readiness.some(row => row.suite === suite)) &&
      readiness.every(row => row.scope === 'FIRST_REQUIRED_INSTALL_ON_OWNED_BOOT_NOT_APP_LAUNCH_OR_UI_ACCEPTANCE' &&
        row.result === 'PASS' && row.criterion === 'ACTUAL_BOUNDED_INSTALL_AND_VERIFIED_IDENTITY' &&
        row.app_service_readiness === 'ACTUAL_INSTALL_AND_FULL_IDENTITY_VERIFIED' && row.listapps === 'NOT_RUN_ACTUAL_INSTALL_PATH' &&
        row.native_acceptance === false && hex(row.device_sha256) && row.install_timeout_seconds === 120 &&
        row.installed_bytes === 'PASS' && row.normal_signature === 'PASS' && row.install_command?.exit_code === 0 &&
        row.install_command.label === ({ product: 'Install exact product UI app', tls: 'Install exact app for native TLS bridge',
          realm109: 'Install exact app for native Realm migration', startup: 'Install Xcode-signed development app',
          keychain: 'Install Xcode-signed development app', probe: 'Install Xcode-signed development app',
          features: 'Install Xcode-signed development app' })[row.suite] &&
        row.install_command.timeout_seconds === 120 && Number.isSafeInteger(row.install_command.command_index) &&
        Array.isArray(row.boot_proof) && row.boot_proof.length === 3 && row.boot_proof.every(boot => boot.exit_code === 0 &&
          Number.isSafeInteger(boot.command_index) && boot.command_index > 0) &&
        row.boot_proof[1].command_index === row.boot_proof[0].command_index + 1 &&
        row.boot_proof[2].command_index === row.boot_proof[1].command_index + 1 &&
        row.boot_proof[2].timeout_seconds === 240 && row.install_command.command_index > row.boot_proof[2].command_index));
    const policy = tls.ios_security_framework;
    const ids = ['policy_root', 'policy_custom', 'policy_selfsigned', 'policy_expired-root', 'policy_expired-selfsigned',
      'delegate_valid_root', 'delegate_custom-leaf_custom', 'delegate_selfsigned_selfsigned', 'delegate_wronghost_wronghost',
      'delegate_expired_root', 'delegate_forged_root', 'delegate_valid_expired-root', 'delegate_expired-selfsigned_expired-selfsigned',
      ...[0, 1, 2].map(i => 'withdrawn_policy_' + i), ...Array.from({ length: 8 }, (_, i) => 'compromised_policy_' + i)];
    demand(policy?.schema === 1 && policy.status === 'PASS' && policy.scope === 'IOS_SIMULATOR_SECURITY_FRAMEWORK_EXACT_SOURCE_METHODS' &&
      equal(policy.cases, ids.map(id => ({ id, status: 'PASS' }))) && policy.actual_app_bridge === false &&
      equal(policy.production_source_sha256, require('./r52_ios_policy.cjs').SHA));
  }
  demand(ui.scope === 'NORMAL_PRODUCT_TRUST_UI_AND_NATIVE_REALM_READBACK' && ui.product_entrypoint === 'index.js' &&
    ui.installed_artifact_verified === true && equal(ui.installed_artifact, value.installed_artifact) &&
    ui.fixture_nodes_removed_by_product_ui === true && typeof ui.configuration_json === 'string' &&
    Buffer.byteLength(ui.configuration_json) <= 16384 && sha(ui.configuration_json) === ui.configuration_sha256);
  const config = parseStrictJson(Buffer.from(ui.configuration_json), 16384), evidence = ui.native_evidence;
  demand(config.schema === 1 && config.platform === platform && /^[a-f0-9]{48}$/.test(config.nonce) &&
    evidence?.schema === 1 && evidence.status === 'PASS' && evidence.nonce === config.nonce && evidence.platform === platform &&
    evidence.scope === 'ACTUAL_NORMAL_PRODUCT_UI_WITH_READ_ONLY_NATIVE_REALM_OBSERVER' &&
    equal(evidence.stages?.map(row => row.stage), trust.STAGES));
  const previous = [];
  for (const row of evidence.stages) {
    demand(equal(row, trust.verifyStage(config, previous, row.stage, row.observation, row.witness))); previous.push(row);
  }
  demand(equal(evidence.witness, previous.at(-1).witness) && equal(value.product_ui?.node_trust_ui, ui));
  return Object.fromEntries(Object.keys(SCOPES).filter(key => platform === 'IOS' || key !== 'native-keychain').map(key => [key, 'PASS']));
}
module.exports = { validateNativePhases, SCOPES };
