'use strict';
// Pure C2 receipt checks. Authenticated Actions origin and installed trust are external.
const crypto = require('node:crypto');
const { parseStrictJson } = require('./strict_json.cjs');
const SUITES = Object.freeze(['protected', 'recovery', 'account']);
const RECOVERY_SOURCES = Object.freeze([
  'src/constants/defaultData.tsx', 'src/hardware/index.ts', 'src/hardware/signerSetup.ts',
  'src/models/interfaces/HeathCheckTypes.ts', 'src/services/backup/authority.ts',
  'src/services/backup/encoding.ts', 'src/services/backup/image.ts',
  'src/services/wallets/enums/index.ts', 'src/services/wallets/factories/VaultFactory.ts',
  'src/services/wallets/factories/WalletFactory.ts', 'src/services/wallets/operations/BIP85.ts',
  'src/services/wallets/operations/index.ts', 'src/services/wallets/operations/taproot-utils/noble_ecc.ts',
  'src/services/wallets/operations/utils.ts', 'src/utils/service-utilities/config.ts',
  'src/utils/service-utilities/encryption.ts', 'src/utils/utilities.ts',
  'tests/recovery/support/protected-authority-esm-loader.mjs',
]);
const STAGES = Object.freeze({
  protected: Object.freeze(['normal_home_ready', 'legacy_consent_ready', 'never_enrolled_delete_feedback', 'never_enrolled_visible',
    'check_again_read_only', 'repair_verified', 'second_check_read_only', 'delete_confirmation_copy',
    'cancelled_deletion_preserved_backup', 'delete_confirmed', 'post_delete_check_read_only',
    'cold_relaunch_home', 'cold_deleted_status', 'local_recovery_preserved', 'version_history_checked']),
  recovery: Object.freeze(['fresh_recovery_form', 'public_recovery_input_ready', 'protected_recovery_success',
    'restored_home', 'native_restored_verified', 'restored_history', 'cold_home', 'native_cold_verified', 'cold_history']),
  account: Object.freeze(['fresh_recovery_form', 'public_recovery_input_ready', 'protected_recovery_success',
    'restored_home', 'native_restored_verified', 'restored_history', 'cold_home', 'native_cold_verified', 'cold_history',
    'a_add_user_ready', 'b_new_home', 'b_first_check_read', 'native_b_first_verified', 'b_new_history',
    'a_return_home', 'a_return_check_read', 'native_a_return_verified', 'a_return_history',
    'b_return_home', 'b_return_check_read', 'native_b_return_verified', 'b_return_history',
    'a_final_home', 'a_final_check_read', 'native_a_final_verified', 'a_final_history']),
});
const SCOPES = Object.freeze({ protected: 'REAL_CURRENT_PROTOCOL_AND_NORMAL_UI_WITH_CONTROLLED_LEGACY_CONSENT',
  recovery: 'FRESH_INSTALL_NORMAL_UI_CURRENT_PROTECTED_RECOVERY', account: 'NORMAL_UI_CURRENT_PROTOCOL_NATIVE_ACCOUNT_READ_ISOLATION' });
const COUNTS = Object.freeze({
  protected: ['createNewAppCalls', 'protectedSnapshotCalls', 'protectedEnrollmentCalls', 'protectedRepairCalls',
    'protectedDeletionCalls', 'releasedSnapshotResponseGates', 'rejectedOtherBackendCalls', 'providerOperations'],
  recovery: ['nativeSnapshotRequests', 'authenticatedPublicSnapshotReplies', 'nativeWriteAttempts',
    'rejectedLegacyReadAttempts', 'rejectedOtherCalls', 'providerOperations'],
  account: ['nativeSnapshotRequests', 'authenticatedAReplies', 'authenticatedBReplies', 'nativeRegistrations',
    'nativeWriteAttempts', 'rejectedLegacyReads', 'rejectedOtherCalls', 'providerOperations',
    'recoveryWitnesses', 'accountWitnesses', 'gatesReleased'],
});
const ACCOUNT_BOOLEANS = ['durableBRegistered', 'distinctProtectedNamespaces', 'bNeverEnrolled'];
const PHASES = ['initial', 'before_protected', 'after_protected', 'before_recovery', 'after_recovery', 'before_account', 'after_account'];
const METADATA_SCOPE = { ...SCOPES, protected: 'NORMAL_UI_AND_CURRENT_PROTOCOL_WITH_CONTROLLED_LEGACY_CONSENT' };
const HISTORY = {
  protected: 'Fresh fixture installed tuple and Initially installed row after cold login; no historical account-switch claim.',
  recovery: 'Restored public account current installed tuple and Recovered Wallet row, after recovery and cold PIN login; no historical account-switch claim.',
  account: 'Selected native A Recovered Wallet and B Initially installed rows, one exact current tuple each after cold PIN selection.',
};
const IMAGE = 'mongo:7.0.16@sha256:c630c59342c1493d50345136df2af14a76b9e827dd5316bfabee07a0880a5f3a';
const demand = condition => { if (!condition) throw new Error('PRIVATE_INTEGRATION_RECEIPT_INVALID'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, fields) => object(value) && Object.keys(value).sort().join('|') === [...fields].sort().join('|');
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// Compare JSON values independently of producer dictionary insertion order.
function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, i) => same(value, b[i]));
  return object(a) && object(b) && keys(a, Object.keys(b)) && Object.keys(a).every(key => same(a[key], b[key]));
}
function fixed(value, fields) { demand(object(value) && Object.entries(fields).every(([key, expected]) => same(value[key], expected))); }
function noFailure(value) { demand(object(value) && !Object.keys(value).some(key => /(?:^failure(?:_|$)|^cleanup_failure(?!_categories$))/.test(key)) &&
  (!Object.hasOwn(value, 'cleanup') || value.cleanup === 'PASS') &&
  (!Object.hasOwn(value, 'cleanup_failure_categories') || same(value.cleanup_failure_categories, [])) &&
  (!Object.hasOwn(value, 'startup_cleanup_errors') || same(value.startup_cleanup_errors, [])) &&
  !Object.hasOwn(value, 'startup_observation_cleanup') &&
  (!Object.hasOwn(value, 'install_succeeded') || value.install_succeeded === true) &&
  (!Object.hasOwn(value, 'device') || (object(value.device) &&
    (!Object.hasOwn(value.device, 'fresh_disposable_state') || value.device.fresh_disposable_state === true)))); }
function privateIntegrationMembers(platform) {
  demand(['IOS', 'ANDROID'].includes(platform));
  const name = platform.toLowerCase(), base = `control/artifacts/native-integration/${name}`;
  return Object.freeze([`${base}/metadata.json`, `${base}/startup.json`, ...SUITES.flatMap(suite =>
    ['metadata.json', 'fixture.json'].map(file => `control/artifacts/native-${suite}/${name}/${file}`)),
  'control/artifacts/native-protected/mongo.json', `app/artifacts/native/${name}/metadata.json`]);
}
function context(expected) {
  const { app, control, backend, execution, platform, recoverySources } = expected;
  const repository = value => typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
  demand(['IOS', 'ANDROID'].includes(platform) && app.repository === 'KeeperCommunity/bitcoin-keeper' &&
    [app, control].every(row => keys(row, ['repository', 'sha', 'tree']) && repository(row.repository) && hex(row.sha, 40) && hex(row.tree, 40)) &&
    keys(backend, ['repository', 'sha']) && repository(backend.repository) && hex(backend.sha, 40) &&
    keys(execution, ['repository', 'workflowPath', 'workflowSha', 'ref', 'runId', 'runAttempt']) &&
    execution.repository === control.repository && execution.workflowSha === control.sha &&
    execution.workflowPath === '.github/workflows/r5-native-integration.yml' &&
    typeof execution.ref === 'string' && /^refs\/heads\/[A-Za-z0-9_./-]+$/.test(execution.ref) &&
    !execution.ref.includes('..') && integer(execution.runId, 1, Number.MAX_SAFE_INTEGER) && integer(execution.runAttempt, 1, Number.MAX_SAFE_INTEGER));
  demand(Array.isArray(recoverySources) && recoverySources.length === RECOVERY_SOURCES.length &&
    recoverySources.every((row, i) => keys(row, ['path', 'sha256']) && row.path === RECOVERY_SOURCES[i] && hex(row.sha256, 64)));
  return expected;
}
function installed(value, platform, built, previous) {
  const fields = platform === 'IOS' ? ['inventory_sha256', 'executable_sha256'] : ['sha256'];
  const method = platform === 'IOS' ? 'FULL_SIMULATOR_BUNDLE_TREE_AND_EXECUTABLE_SHA256' : 'SINGLE_INSTALLED_BASE_APK_SHA256';
  const proof = value.installed_artifact, binary = platform === 'IOS' ? 'executable_sha256' : 'sha256';
  demand(value.installed_artifact_verified === true && keys(proof, ['method', ...fields]) && proof.method === method &&
    fields.every(key => hex(proof[key], 64)) && proof[binary] === built[binary] && (!previous || same(proof, previous)));
  return proof;
}
function builtIdentity(value, platform) {
  demand(typeof value.path === 'string' && value.path.length > 0 && value.path.length <= 4096 && !/[\x00-\x1f]/.test(value.path));
  if (platform === 'IOS') demand(keys(value, ['path', 'executable', 'executable_sha256', 'bundle_tree_sha256']) &&
    typeof value.executable === 'string' && /^[A-Za-z0-9_.-]{1,256}$/.test(value.executable) &&
    hex(value.executable_sha256, 64) && hex(value.bundle_tree_sha256, 64));
  else demand(keys(value, ['path', 'sha256']) && value.path === 'android/app/build/outputs/apk/development/debug/app-development-debug.apk' && hex(value.sha256, 64));
}
function foundation(value, expected, built, proof) {
  const { platform, app, execution } = expected;
  noFailure(value);
  fixed(value, { schema: 1, platform, source_sha: app.sha, workflow_sha: execution.workflowSha,
    workflow_ref: `${execution.repository}/${execution.workflowPath}@${execution.ref}`,
    run_id: String(execution.runId), run_attempt: String(execution.runAttempt), diagnostic_only: false,
    app_id: platform === 'IOS' ? 'io.hexawallet.hexakeeper.dev' : 'io.hexawallet.keeper.development', build: 'PASS', smoke: 'PASS' });
  demand(same(value.built_artifact, built));
  return installed(value, platform, built, proof);
}
function sourceProofs(value, expected) {
  demand(keys(value, SUITES));
  SUITES.forEach(suite => {
    const row = value[suite];
    demand(keys(row, ['sourceVerification', 'rawSources', 'app', 'backendBase', 'control', 'scope', 'nativeAcceptance']));
    fixed(row, { sourceVerification: 'PASS', app: expected.app.sha, backendBase: expected.backend.sha, control: expected.control.sha,
      scope: 'BOUNDED_PRIVATE_NATIVE_ACCEPTANCE_TOOLING', nativeAcceptance: 'NOT_ESTABLISHED_BY_SOURCE_CHECK' });
    demand(keys(row.rawSources, ['app', 'control']));
    for (const kind of ['app', 'control']) demand(keys(row.rawSources[kind], ['files', 'sha256']) &&
      integer(row.rawSources[kind].files, kind === 'app' ? 2404 : 98, 100000) && hex(row.rawSources[kind].sha256, 64));
    demand(same(row.rawSources, value.protected.rawSources));
  });
}
function fixture(value, suite, expected) {
  const common = { schema: 1, status: 'PASS', scope: SCOPES[suite], completedStages: STAGES[suite], failures: [],
    physicalDevice: 'NOT_TESTED', releaseReadiness: 'NOT_ESTABLISHED' };
  const fields = suite === 'protected' ? { ...common,
    historicalUpgradeInstallation: 'NOT_TESTED', normalAppEntry: 'INDEX_JS_IMPORTED_BY_CONTROLLED_FIXTURE',
    witnessKind: 'FIXTURE_AND_PROTOCOL_RECEIPT_NOT_UI_ATTESTATION', retentionCanary: 'SYNTHETIC_OPAQUE_LEGACY_RECORD_SCOPE_ONLY',
    accountIsolationCanary: 'INDEPENDENT_THROWAWAY_ES256K_NAMESPACE',
    nativeAcceptance: 'REQUIRES_SEPARATE_EXACT_INSTALLED_ARTIFACT_AND_UI_RECEIPT' } : { ...common,
    appSha: expected.app.sha, cryptoSourceBaseline: expected.app.sha, historicalUpgrade: 'NOT_TESTED',
    fixture: suite === 'recovery' ? 'CONTROLLED_PUBLIC_BIP39_PACKET_WITH_PRODUCTION_CRYPTO' : 'CONTROLLED_PUBLIC_A_AND_NATIVE_CREATED_B',
    witnessKind: 'PROTOCOL_AND_FIXED_STAGE_RECEIPT_REQUIRES_EXACT_NATIVE_UI_AND_BYTES',
    ...(suite === 'recovery' ? { nativeAccountSwitching: 'NOT_TESTED' } : { bMutationIsolation: 'NOT_TESTED' }) };
  demand(keys(value, [...Object.keys(fields), ...COUNTS[suite], ...(suite === 'protected' ? [] :
    ['ownerSha256', 'sourceMembers', ...(suite === 'account' ? ACCOUNT_BOOLEANS : [])])]));
  fixed(value, fields);
  demand(COUNTS[suite].every(key => integer(value[key], 0, 10000)) && value.providerOperations === 0);
  if (suite === 'protected') {
    // Five explicit fresh status gates, plus separate repair and Delete ACK/readbacks.
    demand(value.createNewAppCalls === 1 && value.releasedSnapshotResponseGates === 5 &&
      value.protectedSnapshotCalls >= value.releasedSnapshotResponseGates + 2 && value.protectedEnrollmentCalls >= 1 &&
      value.protectedRepairCalls >= 1 && value.protectedDeletionCalls >= 1);
  } else {
    demand(hex(value.ownerSha256, 64) && same(value.sourceMembers, expected.recoverySources) && value.nativeWriteAttempts === 0);
    if (suite === 'recovery') demand(value.authenticatedPublicSnapshotReplies >= 1 &&
      value.authenticatedPublicSnapshotReplies <= value.nativeSnapshotRequests && value.rejectedLegacyReadAttempts === 0);
    else demand(value.authenticatedAReplies >= 3 && value.authenticatedBReplies >= 2 &&
      value.authenticatedAReplies + value.authenticatedBReplies <= value.nativeSnapshotRequests && value.nativeRegistrations === 1 &&
      ACCOUNT_BOOLEANS.every(key => value[key] === true) && value.recoveryWitnesses === 2 && value.accountWitnesses === 4 &&
      value.gatesReleased === 4 && value.rejectedLegacyReads === 0);
  }
}
function suiteMetadata(value, suite, expected, built, proof, finalFixture) {
  const snapshot = Object.fromEntries(Object.entries(finalFixture).filter(([key]) => !['ready', 'cleanup'].includes(key)));
  fixture(snapshot, suite, expected);
  noFailure(value);
  const fields = { schema: 1, status: 'PASS', app_sha: expected.app.sha, backend_base: expected.backend.sha,
    control_sha: expected.control.sha, platform: expected.platform, scope: METADATA_SCOPE[suite],
    entrypoint: suite === 'protected' ? 'PRIVATE_WRAPPER_IMPORTS_UNCHANGED_INDEX_JS' : 'UNCHANGED_INDEX_JS_AND_DECLARED_READ_ONLY_NATIVE_OBSERVER',
    fresh_install_recovery: suite === 'protected' ? 'NOT_TESTED' : 'CONTROLLED_PUBLIC_BIP39_PACKET_REQUIRES_NATIVE_UI_AND_REALM',
    native_account_switch_A_B_A: suite === 'account' ? 'NORMAL_UI_ADD_USER_AND_COLD_PIN_SELECTION_REQUIRES_NATIVE_CHECKS' : 'NOT_TESTED',
    physical_devices: 'NOT_TESTED', historical_upgrade_installation: 'NOT_TESTED', version_history_scope: HISTORY[suite],
    performance_sample: false, release_readiness: 'NOT_ESTABLISHED', cleanup: 'PASS', cleanup_failure_categories: [],
    fixture: snapshot, device_kind: expected.platform === 'IOS' ? 'SIMULATOR' : 'EMULATOR',
    ...(suite === 'account' ? { b_backend_mutation_isolation: 'NOT_TESTED', biometrics: 'NOT_TESTED' } : {}) };
  demand(keys(value, [...Object.keys(fields), 'ui_test_cases', 'installed_artifact_verified', 'installed_artifact',
    ...(suite === 'protected' ? [] : ['fixture_owner_sha256'])]));
  fixed(value, fields);
  demand(finalFixture.ready === false && finalFixture.cleanup === 'PASS' && integer(value.ui_test_cases, 1, Number.MAX_SAFE_INTEGER));
  if (suite !== 'protected') demand(value.fixture_owner_sha256 === snapshot.ownerSha256);
  installed(value, expected.platform, built, proof);
}
function mongo(value, expected) {
  const fields = { owner: `keeper-r5-native-protected-${expected.execution.runId}-${expected.execution.runAttempt}`,
    version: '7.0.16', kind: expected.platform === 'ANDROID' ? 'DOCKER' : 'OWNED_MAC_PROCESS', cleanup: 'PASS', ready: true };
  if (expected.platform === 'ANDROID') fields.image = IMAGE;
  else fields.checksum_scope = 'OFFICIAL_TLS_VENDOR_CHECKSUM_NOT_INDEPENDENT_CONTENT_PIN';
  demand(keys(value, [...Object.keys(fields), 'disposition', ...(expected.platform === 'IOS' ? ['archive_sha256'] : [])]));
  fixed(value, fields);
  demand(['removed', 'absent'].includes(value.disposition) && (expected.platform !== 'IOS' || hex(value.archive_sha256, 64)));
}
// Fixed object-level components for a separately reviewed raw D profile. These
// never parse, project or reserialize a C2 aggregate, or grant origin/authority.
function privateSuites(values, hashes, expected, built, proof, suites) {
  demand(keys(suites, SUITES));
  const owners = new Set();
  for (const suite of SUITES) {
    const prefix = `control/artifacts/native-${suite}/${expected.platform.toLowerCase()}`, row = suites[suite];
    demand(keys(row, ['status', 'scope', 'execution_started', 'cleanup', 'process_exit_code', 'receipt_sha256', 'post_suite_barrier']));
    fixed(row, { status: 'PASS', scope: SCOPES[suite], execution_started: true, cleanup: 'PASS', process_exit_code: 0,
      post_suite_barrier: 'PASS', receipt_sha256: { 'metadata.json': hashes[`${prefix}/metadata.json`], 'fixture.json': hashes[`${prefix}/fixture.json`] } });
    suiteMetadata(values[`${prefix}/metadata.json`], suite, expected, built, proof, values[`${prefix}/fixture.json`]);
    if (suite !== 'protected') {
      const owner = values[`${prefix}/fixture.json`].ownerSha256;
      demand(!owners.has(owner)); owners.add(owner);
    }
  }
}
function validatePrivateIntegration(rawFiles, suppliedExpected) {
  try {
    const expected = context(suppliedExpected), members = privateIntegrationMembers(expected.platform);
    demand(keys(rawFiles, members));
    const values = {}, hashes = {};
    for (const name of members) {
      const bytes = rawFiles[name], limit = name.startsWith('app/') || name.endsWith('/startup.json') ? 2_000_000 :
        name.endsWith('/fixture.json') || name.endsWith('/mongo.json') ? 8192 : name === members[0] ? 131072 : 32768;
      demand(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= limit);
      values[name] = parseStrictJson(bytes, limit);
      demand(object(values[name])); hashes[name] = digest(bytes);
    }
    const [aggregateName, startupName] = members, aggregate = values[aggregateName], startup = values[startupName];
    noFailure(aggregate);
    fixed(aggregate, { schema: 1, status: 'PASS', app_sha: expected.app.sha, app_tree: expected.app.tree,
      control_sha: expected.control.sha, control_tree: expected.control.tree, backend_base: expected.backend.sha,
      platform: expected.platform, run_id: String(expected.execution.runId), run_attempt: String(expected.execution.runAttempt),
      scope: 'THREE_SERIAL_NORMAL_UI_FEATURE_SUITES_ONE_BUILD', physical_devices: 'NOT_TESTED', historical_upgrade: 'NOT_TESTED',
      b_backend_mutation_isolation: 'NOT_TESTED', biometrics: 'NOT_TESTED',
      five_startup_measurements: 'REQUIRES_SEPARATE_RAW_MEASUREMENT_EVIDENCE', trusted_acceptance: 'NOT_ESTABLISHED', release_readiness: 'NOT_ESTABLISHED' });
    demand(keys(aggregate, ['schema', 'status', 'app_sha', 'app_tree', 'control_sha', 'control_tree', 'backend_base', 'platform',
      'run_id', 'run_attempt', 'built_artifact', 'scope', 'source_admission', 'barriers', 'suites', 'physical_devices',
      'historical_upgrade', 'b_backend_mutation_isolation', 'biometrics', 'five_startup_measurements', 'trusted_acceptance',
      'release_readiness', 'startup_receipt_sha256']));
    const built = aggregate.built_artifact;
    builtIdentity(built, expected.platform);
    const proof = foundation(startup, expected, built);
    foundation(values[members.at(-1)], expected, built, proof);
    demand(aggregate.startup_receipt_sha256 === hashes[startupName]);
    sourceProofs(aggregate.source_admission, expected);
    demand(keys(aggregate.suites, SUITES) && Array.isArray(aggregate.barriers) && aggregate.barriers.length === PHASES.length);
    const retained = {};
    aggregate.barriers.forEach((row, index) => {
      if (index === 1) retained[startupName.slice('control/'.length)] = hashes[startupName];
      if (index >= 2 && index % 2 === 0) {
        const suite = SUITES[index / 2 - 1], prefix = `control/artifacts/native-${suite}/${expected.platform.toLowerCase()}`;
        for (const file of ['metadata.json', 'fixture.json']) retained[`${prefix}/${file}`.slice('control/'.length)] = hashes[`${prefix}/${file}`];
      }
      demand(keys(row, ['phase', 'source_proofs', 'built_artifact', 'resources', 'retained_receipt_sha256']));
      fixed(row, { phase: PHASES[index], source_proofs: aggregate.source_admission, built_artifact: built,
        retained_receipt_sha256: retained, resources: {
          overlays_absent: SUITES.map(suite => `.github/native/.private-${suite}`),
          listeners: [8081, 8765, 8768, 8769].map(port => ({ port, result: 'ECONNREFUSED' })) } });
    });
    privateSuites(values, hashes, expected, built, proof, aggregate.suites);
    mongo(values['control/artifacts/native-protected/mongo.json'], expected);
    const identity = Object.freeze({ app: Object.freeze({ ...expected.app }), control: Object.freeze({ ...expected.control }),
      backend: Object.freeze({ ...expected.backend }), execution: Object.freeze({ ...expected.execution }) });
    return Object.freeze({ schema: 1, platform: expected.platform, identity, raw_sha256: Object.freeze(hashes),
      installed_artifact: Object.freeze({ ...proof }), source_observations: Object.freeze({
        app: Object.freeze({ ...aggregate.source_admission.protected.rawSources.app }),
        control: Object.freeze({ ...aggregate.source_admission.protected.rawSources.control }) }),
      scope: 'three serial private UI/protocol suites; public phases and authenticated workflow cleanup remain separate',
      public_parent_composition: 'NOT_FROZEN', installed_trust: 'UNVERIFIED', release_ready: false,
      authorization_eligible: false, execution_allowed: false, release_authorized: false });
  } catch { throw new Error('PRIVATE_INTEGRATION_RECEIPT_INVALID'); }
}
const PRIVATE_INTEGRATION_CORE = Object.freeze({ context, builtIdentity, foundation, sourceProofs, privateSuites, mongo });
module.exports = { validatePrivateIntegration, privateIntegrationMembers, RECOVERY_SOURCES, PRIVATE_INTEGRATION_CORE };
