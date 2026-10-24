'use strict';
// Pure scoped software facts. Installed provenance and authorization remain external.
const { validatePublicCompanions } = require('./public_companion_receipts.cjs');
const PUBLIC_SOFTWARE_SCOPE = 'ordered public raw product and worker proofs; private route and installed trust unverified';
const WORKER_SOURCES = Object.freeze(Object.fromEntries(Object.entries({
  'src/utils/utilities.ts': ['getAccountFromSigner', 'getKeyUID'],
  'src/store/sagas/storage.ts': ['setupKeeperAppWorker'],
  'src/store/sagas/wallets.ts': ['currentWalletAccountId', 'assertWalletAccount', 'deleteSigningDeviceWorker'],
  'src/store/sagas/bhr.ts': ['currentBackupAppId', 'deleteAppImageEntityWorker'],
  'src/services/backup/transport.ts': ['observeBackupAccount', 'currentBackupAccountSession', 'clearVerifiedRemoteRevision'],
}).map(([name, names]) => [name, Object.freeze(names)])));
const STAGES = ['startup_start', 'startup_ready', 'wallet_start', 'wallet_ready', 'home_ready', 'relaunch_start',
  'relaunch_login', 'relaunch_home', 'version_history_verified', 'key_management_entry_verified', 'navigation_verified'];
const RETRY = ['retry_fixture_start', 'retry_error_visible', 'retry_submit', 'retry_home_ready',
  'retry_relaunch_start', 'retry_relaunch_login', 'retry_relaunch_home'];
const KEY = ['existing_disposable_home_verified', 'empty_deletion_entry_verified', 'unused_mobile_key_created',
  'delete_confirmation_scoped', 'cancelled_confirmation_preserved_key', 'wrong_deletion_pin_rejected',
  'unused_mobile_key_deleted', 'unrelated_wallet_preserved', 'cold_wrong_login_pin_rejected',
  'deletion_persisted_after_relaunch', 'final_wallet_verified'];
const DURATIONS = ['startup_to_passcode_ms', 'start_new_to_ready_ms', 'start_new_to_home_ms',
  'cold_relaunch_to_login_ms', 'cold_relaunch_to_authenticated_home_ms'];
const SCENARIOS = ['production-setup-offline-retry-native-counts', 'production-deletion-retained-native-references',
  'production-deletion-native-rollback', 'production-worker-stale-session-rejection', 'native-worker-process-relaunch-counts'];
const LIMITS = ['controlled-transport-no-backend-acceptance', 'synthetic-wallet-generation-no-crypto-acceptance',
  'injected-dispatch-selection-no-login-acceptance', 'no-product-ui-navigation-pin-or-biometric-acceptance',
  'probe-and-worker-timings-not-product-startup-ux'];
const demand = value => { if (!value) throw new Error('PUBLIC_SOFTWARE_RECEIPT_INVALID'); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (value, expected) => value && !Array.isArray(value) && same(Object.keys(value).sort(), [...expected].sort());
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const bounded = (value, limit) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= limit;
function consistentCleanup(row) {
  // Absence asserts nothing about disposal; only reject explicit contradictions.
  demand(row && !Object.keys(row).some(name => /^cleanup_failure(?:_|$)/.test(name)) &&
    !Object.keys(row).some(name => /^failure(?:_|$)/.test(name)) &&
    (!Object.hasOwn(row, 'cleanup') || row.cleanup === 'PASS') &&
    (!Object.hasOwn(row, 'startup_cleanup_errors') || same(row.startup_cleanup_errors, [])) &&
    !Object.hasOwn(row, 'startup_observation_cleanup') &&
    (!Object.hasOwn(row, 'install_succeeded') || row.install_succeeded === true) &&
    (!Object.hasOwn(row, 'device') || (row.device && typeof row.device === 'object' && !Array.isArray(row.device) &&
      (!Object.hasOwn(row.device, 'fresh_disposable_state') || row.device.fresh_disposable_state === true))));
}
function proof(value, platform, expected) {
  const fields = platform === 'IOS' ? ['inventory_sha256', 'executable_sha256'] : ['sha256'];
  const method = platform === 'IOS' ? 'FULL_SIMULATOR_BUNDLE_TREE_AND_EXECUTABLE_SHA256' : 'SINGLE_INSTALLED_BASE_APK_SHA256';
  const row = value.installed_artifact;
  demand(value.installed_artifact_verified === true && keys(row, ['method', ...fields]) && row.method === method &&
    fields.every(name => hex(row[name], 64)) && (!expected || fields.every(name => row[name] === expected[name])));
  return row;
}
function validatePublicSoftware(value, expected) {
  try {
    consistentCleanup(value);
    const { platform, sourceSha, workflowSha, workflowRef, runId, runAttempt, workerSources } = expected;
    demand(['IOS', 'ANDROID'].includes(platform) && hex(sourceSha, 40) && hex(workflowSha, 40) &&
      typeof workflowRef === 'string' && workflowRef.length > 0 && Number.isSafeInteger(runId) && runId > 0 &&
      Number.isSafeInteger(runAttempt) && runAttempt > 0);
    demand(Array.isArray(workerSources) && workerSources.length === Object.keys(WORKER_SOURCES).length &&
      Object.entries(WORKER_SOURCES).every(([path, names], i) => keys(workerSources[i], ['path', 'sha256', 'names']) &&
        workerSources[i].path === path && same(workerSources[i].names, names) && hex(workerSources[i].sha256, 64)));
    demand(value.schema === 1 && value.platform === platform && value.source_sha === sourceSha && value.workflow_sha === workflowSha &&
      value.workflow_ref === workflowRef && value.run_id === String(runId) && value.run_attempt === String(runAttempt) &&
      value.diagnostic_only === false && value.app_id === (platform === 'IOS' ? 'io.hexawallet.hexakeeper.dev' : 'io.hexawallet.keeper.development') &&
      ['build', 'smoke', 'native_probe', 'r5_features'].every(name => value[name] === 'PASS') && value.product_ui.status === 'PASS');
    const installed = proof(value, platform), binary = platform === 'IOS' ? 'executable_sha256' : 'sha256';
    demand(value.built_artifact[binary] === installed[binary]);
    const ui = value.product_ui;
    consistentCleanup(ui);
    demand(ui.requested_samples === 5 && Array.isArray(ui.samples) && ui.samples.length === 5);
    ui.samples.forEach((row, i) => {
      consistentCleanup(row);
      demand(row.sample === i + 1 && row.status === 'PASS' && same(row.completed_stages, STAGES) && row.create_new_app_calls === 1 &&
        row.visible_wallet_count_before_relaunch === 1 && row.visible_wallet_count_after_relaunch === 1 &&
        ['installed_version_header_and_initial_history', 'key_management_entry_and_exit', 'more_wallets_navigation'].every(name => row[name] === 'PASS') &&
        keys(row.raw_durations, DURATIONS) && DURATIONS.every(name => bounded(row.raw_durations[name], 3600000)) &&
        row.raw_durations.start_new_to_home_ms >= row.raw_durations.start_new_to_ready_ms &&
        row.raw_durations.cold_relaunch_to_authenticated_home_ms >= row.raw_durations.cold_relaunch_to_login_ms &&
        Number.isSafeInteger(row.other_backend_calls_rejected) && row.other_backend_calls_rejected >= 0);
      proof(row, platform, installed);
    });
    const retry = ui.controlled_disconnect_retry;
    consistentCleanup(retry);
    demand(retry.sample === 6 && retry.status === 'PASS' && same(retry.completed_stages, RETRY) && retry.scenario === 'CONTROLLED_DISCONNECT_BEFORE_COMMIT_NOT_WAN_OFFLINE' &&
      retry.performance_sample === false && retry.create_new_app_calls === 2 && retry.transport_requests_dropped_without_commit === 1 &&
      retry.acknowledged_create_responses === 1 && retry.unexpected_create_attempts === 0 &&
      retry.visible_wallet_count_before_relaunch === 1 && retry.visible_wallet_count_after_relaunch === 1 &&
      Number.isSafeInteger(retry.other_backend_calls_rejected) && retry.other_backend_calls_rejected >= 0);
    proof(retry, platform, installed);
    const key = ui.key_management_ui;
    consistentCleanup(key);
    demand(key.status === 'PASS' && same(key.completed_stages, KEY) && key.entrypoint === 'index.js' && key.network === 'TESTNET' &&
      key.scenario === 'UNUSED_MOBILE_KEY_UI_DELETE_AND_NATIVE_PIN' && key.new_account_requests_during_key_flow === 0 &&
      key.visible_eligible_keys_after_deletion === 0 && key.unrelated_visible_wallet_count_after_relaunch === 1 &&
      key.referenced_vault_ui === 'NOT IMPLEMENTED' && key.credential_store_read_fault === 'NOT RUN' &&
      key.physical_biometrics === 'NOT RUN' && key.protected_backup_deletion === 'NOT TESTED' &&
      key.recovery_key_preservation === 'Not selected or exported; excluded by production deletion filters.');
    proof(key, platform, installed);
    validatePublicCompanions(value, platform);
    const feature = value.r5_feature_evidence;
    consistentCleanup(feature);
    demand(feature.schema === 1 && feature.scope === 'production-worker-native-storage' && feature.status === 'PASS' &&
      same(feature.scenarios, SCENARIOS.map(id => ({ id, status: 'PASS' }))) && same(feature.limits, LIMITS) &&
      Array.isArray(feature.source_functions) && feature.source_functions.length === workerSources.length &&
      feature.source_functions.every((row, i) => keys(row, ['path', 'sha256', 'names']) && row.path === workerSources[i].path &&
        row.sha256 === workerSources[i].sha256 && same(row.names, workerSources[i].names)) &&
      Array.isArray(feature.measurements) && feature.measurements.length === 5 &&
      feature.measurements.every((row, i) => keys(row, ['iteration', 'probe_ready_ms', 'setup_first_wallet_ms']) && row.iteration === i + 1 &&
        bounded(row.probe_ready_ms, 600000) && bounded(row.setup_first_wallet_ms, 600000)));
    return Object.freeze({ schema: 1, platform, source_sha: sourceSha, workflow_sha: workflowSha,
      run_id: String(runId), run_attempt: String(runAttempt), installed_artifact: Object.freeze({ ...installed }),
      installed_trust: 'UNVERIFIED', release_ready: false, authorization_eligible: false, execution_allowed: false, release_authorized: false });
  } catch { throw new Error('PUBLIC_SOFTWARE_RECEIPT_INVALID'); }
}
module.exports = { validatePublicSoftware, WORKER_SOURCES, PUBLIC_SOFTWARE_SCOPE };
