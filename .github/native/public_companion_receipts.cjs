'use strict';
// Pure public receipt validation. This module grants no parent acceptance or
// authorization. SHA/run/attempt/App/artifact provenance belongs to the caller.
const SCOPES = Object.freeze({
  'controlled-credential-json-ui': 'controlled malformed native Keychain JSON blocking Retry and restored cold login; not OS denial or physical biometrics',
  'controlled-version-history-ui': 'controlled stale/empty native Realm history observation and restoration; not authentic historical installation or migration',
  'vault-reference-and-logical-archive-ui': 'normal UI real Vault visible/hidden references and logical archive/reinstate; no private-byte inspection or protected-backup acceptance',
});
const CREDENTIAL_STAGES = Object.freeze(['malformed_startup_blocked', 'retry_remains_blocked', 'malformed_cold_start_blocked',
  'restored_login_available', 'restored_wallet_preserved', 'restored_cold_wallet_preserved']);
const HISTORY_STAGES = Object.freeze(['history_seed_stale', 'stale_first_ui', 'history_verify_stale_first', 'stale_repeat_ui',
  'history_verify_stale_repeat', 'history_seed_empty', 'empty_first_ui', 'history_verify_empty_first', 'empty_repeat_ui',
  'history_verify_empty_repeat', 'history_restore', 'history_verify_restored']);
const VAULT_STAGES = Object.freeze(['predecessor_fixture_verified', 'native_mobile_and_public_seed_created',
  'real_two_of_two_vault_created', 'visible_reference_blocks_mobile_deletion', 'hidden_reference_blocks_without_name_after_relaunch',
  'vault_unhidden_with_correct_native_pin', 'zero_balance_rotation_retained_original_archive', 'archived_only_mobile_logically_archived',
  'archived_vault_reinstated_after_cold_restart', 'retained_mobile_key_is_protected_again', 'unrelated_wallet_preserved_final_count_three']);
const CREDENTIAL = Object.freeze({
  status: 'PASS', entrypoint_under_test: 'index.js', scenario: 'ACTUAL_KEYCHAIN_CONTROLLED_MALFORMED_JSON',
  native_credential_api: 'react-native-keychain', original_credential_exported: false,
  backup_service_removed_after_verified_restore: true, visible_wallet_count_after_recovery_and_cold_login: 1,
  successfully_empty_store: 'REJECTED_FIXTURE_PRECONDITION_NOT_A_READ_ERROR',
  retry_scope: 'User taps Retry while malformed value persists; blocking UI remains. Native read-call count is not instrumented.',
  os_keychain_denial_or_hardware_read_fault: 'NOT RUN', same_process_retry_after_external_repair: 'NOT RUN',
  physical_devices: 'NOT RUN', backend_compatibility: 'NOT TESTED', new_account_requests_during_credential_flow: 0,
});
const HISTORY = Object.freeze({
  status: 'PASS', scenario: 'CONTROLLED_STALE_AND_EMPTY_NATIVE_VERSION_HISTORY', product_entrypoint: 'index.js', network: 'TESTNET',
  fixture_scope: 'Actual encrypted native Realm histories only; unchanged KeeperApp and shared version. Not an authentic historical installation or migration test.',
  credentials_exported: false, physical_devices: 'NOT RUN', performance_sample: false, original_history_restored: true,
  stale_initial_and_recovery_dates_preserved: true, stale_current_observation_count: 1, empty_current_observation_count: 1,
  repeat_login_observation_date_unchanged: true, account_version_unchanged: true, visible_wallet_count: 1,
  new_account_requests_during_history_flow: 0,
});
const VAULT = Object.freeze({
  status: 'PASS', entrypoint: 'index.js', network: 'TESTNET', scenario: 'NORMAL_UI_TWO_OF_TWO_MOBILE_PUBLIC_SEED_VAULT_REFERENCES',
  seed_fixture_origin: 'PUBLIC_BIP39_REFERENCE_VECTORS_DERIVED_BY_APP', mobile_key_origin: 'NORMAL_MY_KEEPER_GENERATION_WITH_NATIVE_PIN',
  visible_reference_ui: 'PASS', hidden_reference_ui: 'PASS', archived_only_key_semantics: 'LOGICAL_ARCHIVE_AND_REINSTATE_VERIFIED',
  archived_signer_record_retention_ui: 'PASS', native_private_material_exactness: 'NOT DIRECTLY INSPECTED BY UI',
  unrelated_mobile_wallet_retained: true, final_visible_wallet_count: 3,
  final_visible_wallet_composition: 'ONE_MOBILE_WALLET_AND_TWO_REAL_VAULTS', physical_biometrics: 'NOT RUN',
  hardware_device_checks: 'NOT RUN', backend_compatibility: 'NOT TESTED BY LOOPBACK_UI_FIXTURE',
  protected_backup: 'DISABLED_FOR_DISPOSABLE_FIXTURE', release_readiness: 'NOT ESTABLISHED', new_account_requests_during_vault_flow: 0,
});
const demand = value => { if (!value) throw new Error('PUBLIC_COMPANION_RECEIPT_INCOMPLETE'); };
const exactKeys = (value, keys) => value && !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const ordered = (value, expected) => Array.isArray(value) && value.length === expected.length &&
  expected.every((item, index) => value[index] === item);

function installedBytes(value, platform, expected) {
  const [method, hashes] = platform === 'IOS' ?
    ['FULL_SIMULATOR_BUNDLE_TREE_AND_EXECUTABLE_SHA256', ['inventory_sha256', 'executable_sha256']] :
    ['SINGLE_INSTALLED_BASE_APK_SHA256', ['sha256']];
  const proof = value?.installed_artifact;
  demand(['IOS', 'ANDROID'].includes(platform) && value?.installed_artifact_verified === true &&
    exactKeys(proof, ['method', ...hashes]) && proof.method === method &&
    hashes.every(name => typeof proof[name] === 'string' && /^[a-f0-9]{64}$/.test(proof[name])) &&
    (!expected || (proof.method === expected.method && hashes.every(name => proof[name] === expected[name]))));
  return proof;
}

function validateRow(value, fields, stages, platform, proof, history = false) {
  demand(exactKeys(value, [...Object.keys(fields), 'completed_stages', 'installed_artifact_verified', 'installed_artifact',
    ...(history ? ['stage_evidence'] : fields === CREDENTIAL ? ['fixture_phases'] : [])]) &&
    Object.entries(fields).every(([name, expected]) => value[name] === expected) && ordered(value.completed_stages, stages));
  installedBytes(value, platform, proof);
  if (fields === CREDENTIAL) demand(ordered(value.fixture_phases, ['armed', 'restored']));
  if (history) {
    demand(Array.isArray(value.stage_evidence) && value.stage_evidence.length === stages.length);
    value.stage_evidence.forEach((row, index) => {
      demand(exactKeys(row, ['stage', 'status', 'installed_artifact_verified', 'installed_artifact']) &&
        row.stage === stages[index] && row.status === 'PASS');
      installedBytes(row, platform, proof);
    });
  }
}

function contextProof(metadata, platform) {
  const proof = installedBytes(metadata, platform);
  const binary = platform === 'IOS' ? 'executable_sha256' : 'sha256';
  demand(metadata.built_artifact?.[binary] === proof[binary] && metadata.product_ui?.status === 'PASS' &&
    ['build', 'smoke', 'native_probe', 'r5_features'].every(name => metadata[name] === 'PASS'));
  // Validate the exact source-owned switching receipt, including final normal
  // product restoration. These are bundle-setup observations, not extra UI.
  const phases = ['product', 'arm', 'product', 'restore', 'product',
    ...HISTORY_STAGES.map(stage => stage.startsWith('history_') ? stage : 'product'), 'product'];
  const switches = metadata.product_ui.companion_metro_switches;
  demand(Array.isArray(switches) && switches.length === phases.length && switches.every((row, index) =>
    exactKeys(row, ['phase', 'status', 'scope']) && row.phase === phases[index] && row.status === 'PASS' && row.scope === 'BUNDLE_SETUP_ONLY'));
  return proof;
}

function publicCompanionChecks(metadata, platform) {
  const checks = Object.fromEntries(Object.entries(SCOPES).map(([id, scope]) => [id, { status: 'NOT VERIFIED', scope }]));
  let proof;
  try { proof = contextProof(metadata, platform); } catch { return checks; }
  const rows = [
    ['controlled-credential-json-ui', 'product_credential_ui', 'credential_errors_ui', CREDENTIAL, CREDENTIAL_STAGES],
    ['controlled-version-history-ui', 'product_version_history_ui', 'version_history_ui', HISTORY, HISTORY_STAGES],
    ['vault-reference-and-logical-archive-ui', 'product_vault_ui', 'vault_references_ui', VAULT, VAULT_STAGES],
  ];
  for (const [id, root, nested, fields, stages] of rows) {
    try {
      // Both receipts independently satisfy the same exact public schema;
      // there are no free-form fields to hide stale or contradictory results.
      validateRow(metadata[root], fields, stages, platform, proof, fields === HISTORY);
      validateRow(metadata.product_ui[nested], fields, stages, platform, proof, fields === HISTORY);
      checks[id].status = 'PASS';
    } catch { /* Preserve independently verified subsets without parent credit. */ }
  }
  return checks;
}

function validatePublicCompanions(metadata, platform) {
  const checks = publicCompanionChecks(metadata, platform);
  demand(Object.values(checks).every(row => row.status === 'PASS'));
  return checks;
}
module.exports = { SCOPES, validatePublicCompanions, publicCompanionChecks };
