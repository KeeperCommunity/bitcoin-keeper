'use strict';
// Every positive here is an explicitly synthetic host contract fixture, never native evidence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validatePrivateIntegration, privateIntegrationMembers, RECOVERY_SOURCES } = require('../native/private_integration_receipts.cjs');
const { synthetic } = require('./fixtures/private-integration.cjs');
const reject = (raw, expected) => assert.throws(() => validatePrivateIntegration(raw, expected), /^Error: PRIVATE_INTEGRATION_RECEIPT_INVALID$/);
for (const platform of ['IOS', 'ANDROID']) {
  const lower = platform.toLowerCase();
  test(`${platform} full synthetic C2 contracts retain distinct identities, original hashes and false authority`, () => {
    const f = synthetic(platform), result = validatePrivateIntegration(f.raw, f.expected);
    assert.deepEqual(Object.keys(f.raw).sort(), [...privateIntegrationMembers(platform)].sort());
    assert.equal(result.installed_trust, 'UNVERIFIED');
    assert.equal(result.public_parent_composition, 'NOT_FROZEN');
    assert.equal(Object.hasOwn(result, 'cases'), false);
    for (const name of ['release_ready', 'authorization_eligible', 'execution_allowed', 'release_authorized']) assert.equal(result[name], false);
    assert.deepEqual(result.identity, { app: f.expected.app, control: f.expected.control,
      backend: f.expected.backend, execution: f.expected.execution });
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.identity) && Object.isFrozen(result.identity.control) &&
      Object.isFrozen(result.raw_sha256) && Object.isFrozen(result.installed_artifact) && Object.isFrozen(result.source_observations.app));
    assert.notEqual(result.identity.control, f.expected.control);
    assert.deepEqual(RECOVERY_SOURCES, f.expected.recoverySources.map(row => row.path));
    for (const [name, bytes] of Object.entries(f.raw)) assert.equal(result.raw_sha256[name], crypto.createHash('sha256').update(bytes).digest('hex'));
    if (platform === 'IOS') assert.notEqual(result.installed_artifact.inventory_sha256, f.aggregate.built_artifact.bundle_tree_sha256);
  });
  for (const variant of ['missing', 'extra', 'traversal', 'opposite', 'parsed', 'empty', 'oversized', 'invalidJSON', 'nonobject', 'invalidUTF8'])
    test(`${platform} rejects ${variant} raw members without payload echo`, () => {
      const f = synthetic(platform), raw = { ...f.raw }, name = `${f.prefix}/startup.json`;
      if (variant === 'missing') delete raw[name];
      else if (variant === 'extra') raw['control/raw.log'] = Buffer.from('PRIVATE_SENTINEL');
      else if (variant === 'traversal') { raw[`control/../${name}`] = raw[name]; delete raw[name]; }
      else if (variant === 'opposite') { raw[name.replace(`/${lower}/`, platform === 'IOS' ? '/android/' : '/ios/')] = raw[name]; delete raw[name]; }
      else if (variant === 'parsed') raw[name] = f.values[name];
      else if (variant === 'empty') raw[name] = Buffer.alloc(0);
      else if (variant === 'oversized') raw[name] = Buffer.alloc(2_000_001);
      else if (variant === 'invalidJSON') raw[name] = Buffer.from('PRIVATE_SENTINEL');
      else if (variant === 'nonobject') raw[name] = Buffer.from('[]');
      else raw[name] = Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]);
      reject(raw, f.expected);
    });
  for (const [name, mutate] of Object.entries({
    appRepository: e => e.app.repository = 'other/app', appSha: e => e.app.sha = 'f'.repeat(40), appTree: e => e.app.tree = 'f'.repeat(40),
    controllerSha: e => e.control.sha = 'f'.repeat(40), controllerTree: e => e.control.tree = 'f'.repeat(40),
    controllerRepository: e => e.control.repository = 'other/control', backendSha: e => e.backend.sha = 'f'.repeat(40),
    backendRepository: e => e.backend.repository = '', workflow: e => e.execution.workflowPath = '.github/workflows/other.yml',
    workflowSha: e => e.execution.workflowSha = e.app.sha, workflowRef: e => e.execution.ref = 'refs/heads/other',
    run: e => e.execution.runId++, attempt: e => e.execution.runAttempt++, platform: e => e.platform = 'OTHER',
    sourcesMissing: e => delete e.recoverySources, sourceHash: e => e.recoverySources[0].sha256 = 'f'.repeat(64),
    sourcePath: e => e.recoverySources[0].path = 'payload/selected/path', sourceOrder: e => e.recoverySources.reverse(),
    sourceExtra: e => e.recoverySources.push(e.recoverySources[0]),
  })) test(`${platform} independent expected ${name} cannot fall back to receipt identity`, () => {
    const f = synthetic(platform); mutate(f.expected); reject(f.raw, f.expected);
  });
  for (const [name, mutate] of Object.entries({
    labelsOnly: f => f.values[`${f.prefix}/metadata.json`] = { schema: 1, status: 'PASS' },
    status: f => f.aggregate.status = 'FAIL', extra: f => f.aggregate.unreviewed = true,
    appTree: f => f.aggregate.app_tree = 'f'.repeat(40), controlTree: f => f.aggregate.control_tree = 'f'.repeat(40),
    backend: f => f.aggregate.backend_base = 'f'.repeat(40), attempt: f => f.aggregate.run_attempt = '1',
    startupHash: f => f.aggregate.startup_receipt_sha256 = 'f'.repeat(64),
    cleanupClaim: f => f.aggregate.cleanup = 'PASS', futureBudget: f => f.aggregate.five_startup_measurements = 'PASS',
    physical: f => f.aggregate.physical_devices = 'PASS', biometrics: f => f.aggregate.biometrics = 'PASS',
    historic: f => f.aggregate.historical_upgrade = 'PASS', bMutation: f => f.aggregate.b_backend_mutation_isolation = 'PASS',
    installedTrust: f => f.aggregate.trusted_acceptance = 'PASS',
    barrierMissing: f => f.aggregate.barriers.pop(), barrierOrder: f => f.aggregate.barriers.reverse(),
    barrierDuplicate: f => f.aggregate.barriers[2] = structuredClone(f.aggregate.barriers[1]),
    sourceLabels: f => f.aggregate.source_admission.protected = { sourceVerification: 'PASS' },
    sourceFingerprint: f => f.aggregate.source_admission.account.rawSources.app.sha256 = 'f'.repeat(64),
    sourceCountBool: f => f.aggregate.source_admission.protected.rawSources.app.files = true,
    sourceExtra: f => f.aggregate.source_admission.protected.unreviewed = true,
    barrierSource: f => f.aggregate.barriers[4].source_proofs.recovery.control = 'f'.repeat(40),
    barrierBuild: f => f.aggregate.barriers[4].built_artifact.path += '.different',
    overlay: f => f.aggregate.barriers[4].resources.overlays_absent.pop(),
    unknownListener: f => f.aggregate.barriers[4].resources.listeners[0].result = 'UNKNOWN',
    listenerBool: f => f.aggregate.barriers[4].resources.listeners[0].port = true,
    missingListener: f => f.aggregate.barriers[4].resources.listeners.pop(),
    retainedFuture: f => f.aggregate.barriers[0].retained_receipt_sha256['artifacts/future.json'] = 'f'.repeat(64),
    retainedMissing: f => f.aggregate.barriers[6].retained_receipt_sha256 = {},
    retainedChanged: f => f.aggregate.barriers[6].retained_receipt_sha256[`artifacts/native-integration/${lower}/startup.json`] = 'f'.repeat(64),
    suiteSkip: f => f.aggregate.suites.recovery.execution_started = false,
    suiteExit: f => f.aggregate.suites.recovery.process_exit_code = 1,
    suiteExitBool: f => f.aggregate.suites.recovery.process_exit_code = false,
    suiteCleanup: f => delete f.aggregate.suites.recovery.cleanup,
    suiteBarrier: f => f.aggregate.suites.recovery.post_suite_barrier = 'NOT_RUN',
    suiteHash: f => f.aggregate.suites.recovery.receipt_sha256['fixture.json'] = 'f'.repeat(64),
  })) test(`${platform} rejects aggregate ${name}`, () => {
    const f = synthetic(platform); mutate(f); reject(f.encode(), f.expected);
  });
  for (const suite of ['protected', 'recovery', 'account']) {
    const base = `control/artifacts/native-${suite}/${lower}`;
    const changeBoth = (f, change) => { change(f.values[`${base}/fixture.json`]); change(f.values[`${base}/metadata.json`].fixture); };
    for (const [name, mutate] of Object.entries({
      status: f => changeBoth(f, row => row.status = 'FAIL'),
      stageMissing: f => changeBoth(f, row => row.completedStages.pop()),
      stageOrder: f => changeBoth(f, row => row.completedStages.reverse()),
      stageDuplicate: f => changeBoth(f, row => row.completedStages[1] = row.completedStages[0]),
      failures: f => changeBoth(f, row => row.failures = ['RECOVERY_FAILED']),
      ready: f => f.values[`${base}/fixture.json`].ready = true,
      cleanup: f => f.values[`${base}/fixture.json`].cleanup = 'FAIL',
      fixtureUnknown: f => changeBoth(f, row => row.unreviewed = 'PRIVATE_SENTINEL'),
      metadataScope: f => f.values[`${base}/metadata.json`].scope = 'UNBOUNDED',
      metadataCleanup: f => f.values[`${base}/metadata.json`].cleanup_failure_categories = ['OWNED_DATABASE'],
      metadataUI: f => f.values[`${base}/metadata.json`].ui_test_cases = 0,
      metadataUIBool: f => f.values[`${base}/metadata.json`].ui_test_cases = true,
      metadataProof: f => f.values[`${base}/metadata.json`].installed_artifact[platform === 'IOS' ? 'inventory_sha256' : 'sha256'] = 'f'.repeat(64),
      metadataOnlyDisagreement: f => f.values[`${base}/metadata.json`].fixture.completedStages.pop(),
      provider: f => changeBoth(f, row => row.providerOperations = 1),
      physical: f => changeBoth(f, row => row.physicalDevice = 'PASS'),
      booleanCounter: f => changeBoth(f, row => row[suite === 'protected' ? 'createNewAppCalls' : 'nativeSnapshotRequests'] = true),
    })) test(`${platform} rejects genuinely rehashed ${suite} ${name}`, () => {
      const f = synthetic(platform); mutate(f); reject(f.rebind(), f.expected);
    });
    if (suite !== 'protected') for (const [name, field, value] of [
      ['source', 'sourceMembers', []], ['sourceBaseline', 'cryptoSourceBaseline', 'f'.repeat(40)], ['write', 'nativeWriteAttempts', 1],
      ['owner', 'ownerSha256', 'f'.repeat(64)], ['app', 'appSha', 'f'.repeat(40)],
      ['legacy', suite === 'account' ? 'rejectedLegacyReads' : 'rejectedLegacyReadAttempts', 1],
    ]) test(`${platform} rejects rehashed ${suite} ${name} protocol mismatch`, () => {
      const f = synthetic(platform); changeBoth(f, row => row[field] = value); reject(f.rebind(), f.expected);
    });
    if (suite === 'account') for (const [field, value] of Object.entries({ authenticatedAReplies: 2, authenticatedBReplies: 0,
      nativeRegistrations: 0, durableBRegistered: false, distinctProtectedNamespaces: false, bNeverEnrolled: false,
      recoveryWitnesses: 1, accountWitnesses: 3, gatesReleased: 3, bMutationIsolation: 'PASS' }))
      test(`${platform} rejects rehashed account ${field}`, () => {
        const f = synthetic(platform); changeBoth(f, row => row[field] = value); reject(f.rebind(), f.expected);
      });
    if (suite === 'recovery') test(`${platform} rejects recovery missing authenticated reply`, () => {
      const f = synthetic(platform); changeBoth(f, row => row.authenticatedPublicSnapshotReplies = 0); reject(f.rebind(), f.expected);
    });
    if (suite === 'protected') for (const field of ['createNewAppCalls', 'protectedSnapshotCalls', 'protectedEnrollmentCalls',
      'protectedRepairCalls', 'protectedDeletionCalls', 'releasedSnapshotResponseGates'])
      test(`${platform} rejects rehashed protected missing ${field}`, () => {
        const f = synthetic(platform); changeBoth(f, row => row[field] = 0); reject(f.rebind(), f.expected);
      });
    if (suite === 'protected') for (const [field, number] of [
      ['releasedSnapshotResponseGates', 1], ['releasedSnapshotResponseGates', 4], ['releasedSnapshotResponseGates', 6],
      ['protectedSnapshotCalls', 5], ['protectedSnapshotCalls', 6],
    ]) test(`${platform} rejects rehashed impossible full-stage protected ${field}=${number}`, () => {
      const f = synthetic(platform); changeBoth(f, row => row[field] = number); reject(f.rebind(), f.expected);
    });
  }
  for (const [name, mutate] of Object.entries({
    reusedOwner: f => {
      const recovery = f.values[`control/artifacts/native-recovery/${lower}/fixture.json`].ownerSha256;
      f.values[`control/artifacts/native-account/${lower}/fixture.json`].ownerSha256 = recovery;
      f.values[`control/artifacts/native-account/${lower}/metadata.json`].fixture.ownerSha256 = recovery;
      f.values[`control/artifacts/native-account/${lower}/metadata.json`].fixture_owner_sha256 = recovery;
    },
    startupSource: f => f.values[`${f.prefix}/startup.json`].source_sha = 'f'.repeat(40),
    startupWorkflow: f => f.values[`${f.prefix}/startup.json`].workflow_sha = f.expected.app.sha,
    startupAttempt: f => f.values[`${f.prefix}/startup.json`].run_attempt = '1',
    startupNotBuild: f => f.values[`${f.prefix}/startup.json`].build = 'FAIL',
    finalCleanup: f => f.values[`app/artifacts/native/${lower}/metadata.json`].cleanup = 'FAIL',
    finalCategories: f => f.values[`app/artifacts/native/${lower}/metadata.json`].cleanup_failure_categories = ['OWNED_DEVICE'],
    finalBuild: f => f.values[`app/artifacts/native/${lower}/metadata.json`].built_artifact = {},
    finalProof: f => f.values[`app/artifacts/native/${lower}/metadata.json`].installed_artifact_verified = false,
    mongoOwner: f => f.values['control/artifacts/native-protected/mongo.json'].owner = 'keeper-r5-native-protected-123-1',
    mongoCleanup: f => f.values['control/artifacts/native-protected/mongo.json'].cleanup = 'NOT_RUN',
    mongoReadiness: f => f.values['control/artifacts/native-protected/mongo.json'].ready = false,
    mongoMissing: f => delete f.values['control/artifacts/native-protected/mongo.json'].cleanup,
    mongoUnknown: f => f.values['control/artifacts/native-protected/mongo.json'].disposition = 'UNKNOWN',
    mongoVersion: f => f.values['control/artifacts/native-protected/mongo.json'].version = 'latest',
  })) test(`${platform} rejects rehashed independent identity/lifecycle ${name}`, () => {
    const f = synthetic(platform); mutate(f); reject(f.rebind(), f.expected);
  });
  test(`${platform} hashes original whitespace bytes and rejects a later changed startup`, () => {
    const f = synthetic(platform), member = `${f.prefix}/startup.json`, changed = { ...f.raw, [member]: Buffer.concat([f.raw[member], Buffer.from(' ')]) };
    reject(changed, f.expected);
    const result = validatePrivateIntegration(f.raw, f.expected);
    assert.notEqual(result.raw_sha256[member], crypto.createHash('sha256').update(JSON.stringify(f.values[member])).digest('hex'));
  });
  test(`${platform} preserves declared rejected-route observations and already absent owned cleanup`, () => {
    const f = synthetic(platform);
    for (const suite of ['protected', 'recovery', 'account']) {
      const base = `control/artifacts/native-${suite}/${lower}`, key = suite === 'protected' ? 'rejectedOtherBackendCalls' : 'rejectedOtherCalls';
      f.values[`${base}/fixture.json`][key] = 3;
      f.values[`${base}/metadata.json`].fixture[key] = 3;
    }
    f.values['control/artifacts/native-protected/mongo.json'].disposition = 'absent';
    assert.equal(validatePrivateIntegration(f.rebind(), f.expected).installed_trust, 'UNVERIFIED');
  });
  for (const member of [`control/artifacts/native-integration/${lower}/startup.json`, `app/artifacts/native/${lower}/metadata.json`])
    for (const field of ['startup_cleanup_errors', 'startup_observation_cleanup'])
      test(`${platform} rejects original startup cleanup contradiction in ${member} ${field}`, () => {
        const f = synthetic(platform);
        f.values[member][field] = field === 'startup_cleanup_errors' ? ['device_uninstall'] : 'FAIL';
        reject(f.rebind(), f.expected);
      });
  for (let i = 0; i < 10; i++) test(`${platform} rejects correctly rehashed contradictory duplicate JSON member ${i}`, () => {
    const f = synthetic(platform), member = privateIntegrationMembers(platform)[i], original = f.raw[member];
    const key = Object.keys(f.values[member])[0];
    const duplicate = Buffer.concat([Buffer.from('{' + JSON.stringify(key) + ':"CONTRADICTORY",'), original.subarray(1)]);
    const raw = member === `${f.prefix}/metadata.json` ? { ...f.raw, [member]: duplicate } : f.rebind({ [member]: duplicate });
    reject(raw, f.expected);
  });
}
test('empty and status-only payloads supply no private or parent facts', () => {
  for (const value of [undefined, null, {}, { status: 'PASS' }]) reject(value, {});
});
test('iOS aggregate accepts bounded actual runner paths beyond the individual worker reader size', () => {
  const f = synthetic('IOS'), longer = '/' + 'r'.repeat(1000) + '/DerivedData/Build/Products/Debug-iphonesimulator/hexa_keeper_dev.app';
  f.aggregate.built_artifact.path = longer;
  f.values[`${f.prefix}/startup.json`].built_artifact.path = longer;
  f.values['app/artifacts/native/ios/metadata.json'].built_artifact.path = longer;
  const raw = f.rebind();
  assert.ok(raw[`${f.prefix}/metadata.json`].length > 32768);
  assert.equal(validatePrivateIntegration(raw, f.expected).installed_trust, 'UNVERIFIED');
});
