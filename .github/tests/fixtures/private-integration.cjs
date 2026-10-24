'use strict';
// Synthetic host corpus from the actual C2 producer/admission contracts. Never native results.
// Source reference d434fc69fecb804bf34c4929c1dd6dbab35ef94d; D has no frozen contract.
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const suites = ['protected', 'recovery', 'account'];
const recoveryStages = ['fresh_recovery_form', 'public_recovery_input_ready', 'protected_recovery_success',
  'restored_home', 'native_restored_verified', 'restored_history', 'cold_home', 'native_cold_verified', 'cold_history'];
const stages = { protected: ['normal_home_ready', 'legacy_consent_ready', 'never_enrolled_delete_feedback', 'never_enrolled_visible',
  'check_again_read_only', 'repair_verified', 'second_check_read_only', 'delete_confirmation_copy',
  'cancelled_deletion_preserved_backup', 'delete_confirmed', 'post_delete_check_read_only',
  'cold_relaunch_home', 'cold_deleted_status', 'local_recovery_preserved', 'version_history_checked'], recovery: recoveryStages,
account: [...recoveryStages, 'a_add_user_ready', 'b_new_home', 'b_first_check_read', 'native_b_first_verified', 'b_new_history',
  'a_return_home', 'a_return_check_read', 'native_a_return_verified', 'a_return_history', 'b_return_home', 'b_return_check_read',
  'native_b_return_verified', 'b_return_history', 'a_final_home', 'a_final_check_read', 'native_a_final_verified', 'a_final_history'] };
const sources = ['src/constants/defaultData.tsx', 'src/hardware/index.ts', 'src/hardware/signerSetup.ts',
  'src/models/interfaces/HeathCheckTypes.ts', 'src/services/backup/authority.ts', 'src/services/backup/encoding.ts',
  'src/services/backup/image.ts', 'src/services/wallets/enums/index.ts', 'src/services/wallets/factories/VaultFactory.ts',
  'src/services/wallets/factories/WalletFactory.ts', 'src/services/wallets/operations/BIP85.ts', 'src/services/wallets/operations/index.ts',
  'src/services/wallets/operations/taproot-utils/noble_ecc.ts', 'src/services/wallets/operations/utils.ts',
  'src/utils/service-utilities/config.ts', 'src/utils/service-utilities/encryption.ts', 'src/utils/utilities.ts',
  'tests/recovery/support/protected-authority-esm-loader.mjs'];
const scopes = { protected: 'REAL_CURRENT_PROTOCOL_AND_NORMAL_UI_WITH_CONTROLLED_LEGACY_CONSENT',
  recovery: 'FRESH_INSTALL_NORMAL_UI_CURRENT_PROTECTED_RECOVERY', account: 'NORMAL_UI_CURRENT_PROTOCOL_NATIVE_ACCOUNT_READ_ISOLATION' };
function synthetic(platform = 'IOS') {
  const expected = { platform, app: { repository: 'KeeperCommunity/bitcoin-keeper', sha: 'a'.repeat(40), tree: 'b'.repeat(40) },
    control: { repository: 'fixture/private-controller', sha: 'c'.repeat(40), tree: 'd'.repeat(40) },
    backend: { repository: 'fixture/private-backend', sha: 'e'.repeat(40) }, execution: {
      repository: 'fixture/private-controller', workflowPath: '.github/workflows/r5-native-integration.yml', workflowSha: 'c'.repeat(40),
      ref: 'refs/heads/synthetic-contract', runId: 123, runAttempt: 2 },
    recoverySources: sources.map(name => ({ path: name, sha256: hash(fs.readFileSync(path.join(__dirname, '../../..', name))) })) };
  const name = platform.toLowerCase(), prefix = `control/artifacts/native-integration/${name}`, values = {};
  const built = platform === 'IOS' ? { path: '/synthetic/DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app',
    executable: 'hexa_keeper_dev', executable_sha256: '1'.repeat(64), bundle_tree_sha256: '2'.repeat(64) } :
    { path: 'android/app/build/outputs/apk/development/debug/app-development-debug.apk', sha256: '1'.repeat(64) };
  const proof = platform === 'IOS' ? { method: 'FULL_SIMULATOR_BUNDLE_TREE_AND_EXECUTABLE_SHA256',
    inventory_sha256: '3'.repeat(64), executable_sha256: built.executable_sha256 } : { method: 'SINGLE_INSTALLED_BASE_APK_SHA256', sha256: built.sha256 };
  const foundation = { schema: 1, platform, source_sha: expected.app.sha, workflow_sha: expected.control.sha,
    workflow_ref: `${expected.execution.repository}/${expected.execution.workflowPath}@${expected.execution.ref}`,
    run_id: '123', run_attempt: '2', diagnostic_only: false,
    app_id: platform === 'IOS' ? 'io.hexawallet.hexakeeper.dev' : 'io.hexawallet.keeper.development',
    build: 'PASS', smoke: 'PASS', built_artifact: built, installed_artifact_verified: true, installed_artifact: proof };
  values[`${prefix}/startup.json`] = structuredClone(foundation);
  values[`app/artifacts/native/${name}/metadata.json`] = structuredClone(foundation);
  for (const suite of suites) {
    const fixture = { schema: 1, status: 'PASS', scope: scopes[suite], completedStages: [...stages[suite]], failures: [],
      physicalDevice: 'NOT_TESTED', releaseReadiness: 'NOT_ESTABLISHED', providerOperations: 0 };
    if (suite === 'protected') Object.assign(fixture, { historicalUpgradeInstallation: 'NOT_TESTED',
      normalAppEntry: 'INDEX_JS_IMPORTED_BY_CONTROLLED_FIXTURE', witnessKind: 'FIXTURE_AND_PROTOCOL_RECEIPT_NOT_UI_ATTESTATION',
      createNewAppCalls: 1, protectedSnapshotCalls: 8, protectedEnrollmentCalls: 2, protectedRepairCalls: 1, protectedDeletionCalls: 1,
      releasedSnapshotResponseGates: 5, rejectedOtherBackendCalls: 0,
      retentionCanary: 'SYNTHETIC_OPAQUE_LEGACY_RECORD_SCOPE_ONLY', accountIsolationCanary: 'INDEPENDENT_THROWAWAY_ES256K_NAMESPACE',
      nativeAcceptance: 'REQUIRES_SEPARATE_EXACT_INSTALLED_ARTIFACT_AND_UI_RECEIPT' });
    else {
      Object.assign(fixture, { appSha: expected.app.sha, cryptoSourceBaseline: expected.app.sha,
        historicalUpgrade: 'NOT_TESTED', witnessKind: 'PROTOCOL_AND_FIXED_STAGE_RECEIPT_REQUIRES_EXACT_NATIVE_UI_AND_BYTES',
        ownerSha256: (suite === 'recovery' ? '4' : '5').repeat(64), sourceMembers: structuredClone(expected.recoverySources), nativeWriteAttempts: 0 });
      if (suite === 'recovery') Object.assign(fixture, { fixture: 'CONTROLLED_PUBLIC_BIP39_PACKET_WITH_PRODUCTION_CRYPTO',
        nativeAccountSwitching: 'NOT_TESTED', nativeSnapshotRequests: 1, authenticatedPublicSnapshotReplies: 1,
        rejectedLegacyReadAttempts: 0, rejectedOtherCalls: 0 });
      else Object.assign(fixture, { fixture: 'CONTROLLED_PUBLIC_A_AND_NATIVE_CREATED_B', bMutationIsolation: 'NOT_TESTED',
        nativeSnapshotRequests: 5, authenticatedAReplies: 3, authenticatedBReplies: 2, nativeRegistrations: 1,
        rejectedLegacyReads: 0, rejectedOtherCalls: 0, recoveryWitnesses: 2, accountWitnesses: 4, gatesReleased: 4,
        durableBRegistered: true, distinctProtectedNamespaces: true, bNeverEnrolled: true });
    }
    const history = { protected: 'Fresh fixture installed tuple and Initially installed row after cold login; no historical account-switch claim.',
      recovery: 'Restored public account current installed tuple and Recovered Wallet row, after recovery and cold PIN login; no historical account-switch claim.',
      account: 'Selected native A Recovered Wallet and B Initially installed rows, one exact current tuple each after cold PIN selection.' };
    values[`control/artifacts/native-${suite}/${name}/metadata.json`] = { schema: 1, status: 'PASS', app_sha: expected.app.sha,
      backend_base: expected.backend.sha, control_sha: expected.control.sha, platform,
      scope: suite === 'protected' ? 'NORMAL_UI_AND_CURRENT_PROTOCOL_WITH_CONTROLLED_LEGACY_CONSENT' : scopes[suite],
      entrypoint: suite === 'protected' ? 'PRIVATE_WRAPPER_IMPORTS_UNCHANGED_INDEX_JS' : 'UNCHANGED_INDEX_JS_AND_DECLARED_READ_ONLY_NATIVE_OBSERVER',
      fresh_install_recovery: suite === 'protected' ? 'NOT_TESTED' : 'CONTROLLED_PUBLIC_BIP39_PACKET_REQUIRES_NATIVE_UI_AND_REALM',
      native_account_switch_A_B_A: suite === 'account' ? 'NORMAL_UI_ADD_USER_AND_COLD_PIN_SELECTION_REQUIRES_NATIVE_CHECKS' : 'NOT_TESTED',
      physical_devices: 'NOT_TESTED', historical_upgrade_installation: 'NOT_TESTED', version_history_scope: history[suite],
      performance_sample: false, release_readiness: 'NOT_ESTABLISHED', fixture: structuredClone(fixture), cleanup: 'PASS',
      cleanup_failure_categories: [], device_kind: platform === 'IOS' ? 'SIMULATOR' : 'EMULATOR', ui_test_cases: 1,
      installed_artifact_verified: true, installed_artifact: structuredClone(proof),
      ...(suite === 'protected' ? {} : { fixture_owner_sha256: fixture.ownerSha256 }),
      ...(suite === 'account' ? { b_backend_mutation_isolation: 'NOT_TESTED', biometrics: 'NOT_TESTED' } : {}) };
    values[`control/artifacts/native-${suite}/${name}/fixture.json`] = { ...fixture, ready: false, cleanup: 'PASS' };
  }
  const source = { sourceVerification: 'PASS', app: expected.app.sha, backendBase: expected.backend.sha,
    control: expected.control.sha, scope: 'BOUNDED_PRIVATE_NATIVE_ACCEPTANCE_TOOLING', nativeAcceptance: 'NOT_ESTABLISHED_BY_SOURCE_CHECK',
    rawSources: { app: { files: 2409, sha256: '6'.repeat(64) }, control: { files: 110, sha256: '7'.repeat(64) } } };
  const aggregate = { schema: 1, status: 'PASS', app_sha: expected.app.sha, app_tree: expected.app.tree,
    control_sha: expected.control.sha, control_tree: expected.control.tree, backend_base: expected.backend.sha, platform,
    run_id: '123', run_attempt: '2', built_artifact: built, scope: 'THREE_SERIAL_NORMAL_UI_FEATURE_SUITES_ONE_BUILD',
    source_admission: Object.fromEntries(suites.map(suite => [suite, structuredClone(source)])), barriers: [], suites: {},
    physical_devices: 'NOT_TESTED', historical_upgrade: 'NOT_TESTED', b_backend_mutation_isolation: 'NOT_TESTED', biometrics: 'NOT_TESTED',
    five_startup_measurements: 'REQUIRES_SEPARATE_RAW_MEASUREMENT_EVIDENCE', trusted_acceptance: 'NOT_ESTABLISHED', release_readiness: 'NOT_ESTABLISHED' };
  values['control/artifacts/native-protected/mongo.json'] = { owner: 'keeper-r5-native-protected-123-2', version: '7.0.16',
    kind: platform === 'IOS' ? 'OWNED_MAC_PROCESS' : 'DOCKER', cleanup: 'PASS', ready: true, disposition: 'removed',
    ...(platform === 'IOS' ? { archive_sha256: '8'.repeat(64), checksum_scope: 'OFFICIAL_TLS_VENDOR_CHECKSUM_NOT_INDEPENDENT_CONTENT_PIN' } :
      { image: 'mongo:7.0.16@sha256:c630c59342c1493d50345136df2af14a76b9e827dd5316bfabee07a0880a5f3a' }) };
  values[`${prefix}/metadata.json`] = aggregate;
  const encode = () => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, Buffer.from(JSON.stringify(value, null, 2) + '\n')]));
  function rebind(originalOverrides = {}) {
    const bytes = { ...encode(), ...originalOverrides }, retained = {};
    aggregate.startup_receipt_sha256 = hash(bytes[`${prefix}/startup.json`]);
    for (const suite of suites) aggregate.suites[suite] = { status: 'PASS', scope: scopes[suite], execution_started: true,
      cleanup: 'PASS', process_exit_code: 0, post_suite_barrier: 'PASS', receipt_sha256: Object.fromEntries(
        ['metadata.json', 'fixture.json'].map(file => [file, hash(bytes[`control/artifacts/native-${suite}/${name}/${file}`])])) };
    aggregate.barriers = ['initial', 'before_protected', 'after_protected', 'before_recovery', 'after_recovery', 'before_account', 'after_account'].map((phase, i) => {
      if (i === 1) retained[`artifacts/native-integration/${name}/startup.json`] = aggregate.startup_receipt_sha256;
      if (i >= 2 && i % 2 === 0) for (const file of ['metadata.json', 'fixture.json']) {
        const member = `artifacts/native-${suites[i / 2 - 1]}/${name}/${file}`; retained[member] = hash(bytes[`control/${member}`]);
      }
      return { phase, source_proofs: structuredClone(aggregate.source_admission), built_artifact: structuredClone(built),
        resources: { overlays_absent: suites.map(suite => `.github/native/.private-${suite}`),
          listeners: [8081, 8765, 8768, 8769].map(port => ({ port, result: 'ECONNREFUSED' })) }, retained_receipt_sha256: { ...retained } };
    });
    return { ...encode(), ...originalOverrides };
  }
  return { expected, values, aggregate, encode, rebind, raw: rebind(), prefix };
}
module.exports = { synthetic };
