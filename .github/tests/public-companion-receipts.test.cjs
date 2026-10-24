'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SCOPES, publicCompanionChecks, validatePublicCompanions } = require('../native/public_companion_receipts.cjs');
const { attach } = require('./fixtures/public-companions.cjs');
const slots = [
  ['controlled-credential-json-ui', 'product_credential_ui', 'credential_errors_ui'],
  ['controlled-version-history-ui', 'product_version_history_ui', 'version_history_ui'],
  ['vault-reference-and-logical-archive-ui', 'product_vault_ui', 'vault_references_ui'],
];
for (const platform of ['IOS', 'ANDROID']) {
  test(`${platform} actual producer schemas remain narrowly scoped`, () => {
    const value = attach({}, platform);
    assert.deepEqual(Object.keys(validatePublicCompanions(value, platform)), Object.keys(SCOPES));
    assert.equal(value.product_credential_ui.os_keychain_denial_or_hardware_read_fault, 'NOT RUN');
    assert.equal(value.product_version_history_ui.performance_sample, false);
    assert.equal(value.product_vault_ui.native_private_material_exactness, 'NOT DIRECTLY INSPECTED BY UI');
    assert.equal(value.product_vault_ui.protected_backup, 'DISABLED_FOR_DISPOSABLE_FIXTURE');
  });
  for (const [id, root, nested] of slots) {
    for (const location of ['root', 'nested']) {
      for (const [name, mutate] of [
        ['missing result', (row, value) => location === 'root' ? delete value[root] : delete value.product_ui[nested]],
        ['partial stage list', row => row.completed_stages.pop()],
        ['duplicate stage', row => row.completed_stages[1] = row.completed_stages[0]],
        ['out-of-order stage', row => row.completed_stages.reverse()],
        ['running result', row => row.status = 'RUNNING'],
        ['failed cleanup with stale PASS', row => row.cleanup = 'FAILED'],
        ['unscoped arbitrary fields', row => row.raw = 'PRIVATE_SENTINEL'],
        ['foreign nested SHA', row => row.source_sha = 'b'.repeat(40)],
        ['foreign nested attempt', row => row.run_attempt = '99'],
        ['missing installed proof', row => delete row.installed_artifact],
        ['truthy proof', row => row.installed_artifact_verified = 'true'],
        ['different byte inventory', row => row.installed_artifact[platform === 'IOS' ? 'inventory_sha256' : 'sha256'] = '1'.repeat(64)],
        ['different executable', row => row.installed_artifact[platform === 'IOS' ? 'executable_sha256' : 'sha256'] = '2'.repeat(64)],
      ]) test(`${platform} ${root} ${location} rejects ${name}`, () => {
        const value = attach({}, platform), row = location === 'root' ? value[root] : value.product_ui[nested];
        mutate(row, value);
        const checks = publicCompanionChecks(value, platform);
        assert.equal(checks[id].status, 'NOT VERIFIED');
        for (const [other] of slots.filter(([other]) => other !== id)) assert.equal(checks[other].status, 'PASS');
        assert.throws(() => validatePublicCompanions(value, platform), /PUBLIC_COMPANION_RECEIPT_INCOMPLETE/);
        assert.equal(JSON.stringify(checks).includes('PRIVATE_SENTINEL'), false);
      });
    }
  }
  for (let index = 0; index < 12; index++) {
    test(`${platform} every history phase ${index + 1} requires its own matching installed proof`, () => {
      const value = attach({}, platform);
      value.product_version_history_ui.stage_evidence[index].installed_artifact_verified = false;
      assert.equal(publicCompanionChecks(value, platform)['controlled-version-history-ui'].status, 'NOT VERIFIED');
      value.product_version_history_ui.stage_evidence[index].installed_artifact_verified = true;
      value.product_ui.version_history_ui.stage_evidence[index].installed_artifact[platform === 'IOS' ? 'inventory_sha256' : 'sha256'] = '3'.repeat(64);
      assert.throws(() => validatePublicCompanions(value, platform));
    });
  }
  for (const [name, mutate] of [
    ['missing byte root', value => delete value.installed_artifact],
    ['different built binary', value => value.built_artifact[platform === 'IOS' ? 'executable_sha256' : 'sha256'] = '0'.repeat(64)],
    ['missing final normal product restoration', value => value.product_ui.companion_metro_switches.pop()],
    ['failed bundle transition', value => value.product_ui.companion_metro_switches[1].status = 'FAIL'],
    ['unreviewed transition scope', value => value.product_ui.companion_metro_switches[0].scope = 'APP_ACCEPTANCE'],
    ['failed overall product', value => value.product_ui.status = 'FAIL'],
  ]) test(`${platform} root context rejects ${name}`, () => {
    const value = attach({}, platform); mutate(value);
    assert.ok(Object.values(publicCompanionChecks(value, platform)).every(row => row.status === 'NOT VERIFIED'));
    assert.throws(() => validatePublicCompanions(value, platform));
  });
  for (const phase of ['build', 'smoke', 'native_probe', 'r5_features']) {
    for (const state of ['FAIL', 'NOT RUN', 'RUNNING', undefined]) {
      test(`${platform} ${phase} ${state ?? 'missing'} cannot support companion PASS`, () => {
        const value = attach({}, platform);
        if (state === undefined) delete value[phase]; else value[phase] = state;
        assert.ok(Object.values(publicCompanionChecks(value, platform)).every(row => row.status === 'NOT VERIFIED'));
        assert.throws(() => validatePublicCompanions(value, platform));
      });
    }
  }
  for (const [name, mutate] of [
    ['OS denial promoted from JSON', value => value.product_credential_ui.os_keychain_denial_or_hardware_read_fault = 'PASS'],
    ['credential service not removed', value => value.product_credential_ui.backup_service_removed_after_verified_restore = false],
    ['empty credential treated as read failure', value => value.product_credential_ui.successfully_empty_store = 'PASS'],
    ['history not restored', value => value.product_version_history_ui.original_history_restored = false],
    ['history duplicate observation', value => value.product_version_history_ui.stale_current_observation_count = 2],
    ['history parent account changed', value => value.product_version_history_ui.account_version_unchanged = false],
    ['secret bytes falsely inspected', value => value.product_vault_ui.native_private_material_exactness = 'PASS'],
    ['backup falsely enabled', value => value.product_vault_ui.protected_backup = 'PASS'],
    ['physical acceptance fabricated', value => value.product_vault_ui.physical_biometrics = 'PASS'],
    ['unrelated wallet lost', value => value.product_vault_ui.final_visible_wallet_count = 2],
  ]) test(`${platform} does not enlarge scoped evidence: ${name}`, () => {
    const value = attach({}, platform); mutate(value);
    assert.throws(() => validatePublicCompanions(value, platform));
  });
}
