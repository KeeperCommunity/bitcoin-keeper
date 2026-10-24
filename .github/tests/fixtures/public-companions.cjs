'use strict';
// Compatibility fixtures come from the actual Python producer runners with
// their existing fake native/process boundaries, not validator constants.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const original = JSON.parse(execFileSync('python3', ['-B', path.join(__dirname, 'public_companions.py')],
  { encoding: 'utf8', maxBuffer: 65536 }));
function attach(metadata, platform) {
  // These predecessor phases are explicitly synthetic fixture inputs. Actual
  // producer compatibility below exercises companions only, never native work.
  for (const name of ['build', 'smoke', 'native_probe', 'r5_features'])
    if (!Object.hasOwn(metadata, name)) metadata[name] = 'PASS';
  const proof = metadata.installed_artifact || (platform === 'IOS' ?
    { method: 'FULL_SIMULATOR_BUNDLE_TREE_AND_EXECUTABLE_SHA256', inventory_sha256: 'd'.repeat(64), executable_sha256: 'e'.repeat(64) } :
    { method: 'SINGLE_INSTALLED_BASE_APK_SHA256', sha256: 'f'.repeat(64) });
  metadata.installed_artifact_verified = true;
  metadata.installed_artifact = structuredClone(proof);
  metadata.built_artifact ||= platform === 'IOS' ? { executable_sha256: proof.executable_sha256 } : { sha256: proof.sha256 };
  metadata.product_ui ||= { status: 'PASS' };
  metadata.product_ui.companion_metro_switches = original.switches.map(phase => ({ phase, status: 'PASS', scope: 'BUNDLE_SETUP_ONLY' }));
  for (const [name, root, nested] of [
    ['credential', 'product_credential_ui', 'credential_errors_ui'],
    ['history', 'product_version_history_ui', 'version_history_ui'],
    ['vault', 'product_vault_ui', 'vault_references_ui'],
  ]) {
    const row = structuredClone(original.receipts[name]);
    row.installed_artifact = structuredClone(proof);
    for (const stage of row.stage_evidence || []) stage.installed_artifact = structuredClone(proof);
    metadata[root] = row;
    metadata.product_ui[nested] = structuredClone(row);
  }
  return metadata;
}
module.exports = { attach };
