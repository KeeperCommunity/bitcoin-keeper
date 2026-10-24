'use strict';
// Producer-shaped host fixtures only; this never supplies native acceptance.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const original = JSON.parse(execFileSync('python3', ['-B', path.join(__dirname, 'public_software.py')],
  { encoding: 'utf8', maxBuffer: 65536 }));
function attach(metadata) {
  const ui = metadata.product_ui;
  const bind = (fresh, existing = {}) => {
    const durations = fresh.raw_durations ? { ...fresh.raw_durations, ...existing.raw_durations } : undefined;
    // Older positives supplied only two custom durations. Fill their missing
    // later-stage times consistently; never repair an explicitly supplied bad time.
    if (durations && !Object.hasOwn(existing.raw_durations || {}, 'start_new_to_home_ms'))
      durations.start_new_to_home_ms = Math.max(durations.start_new_to_home_ms, durations.start_new_to_ready_ms);
    if (durations && !Object.hasOwn(existing.raw_durations || {}, 'cold_relaunch_to_authenticated_home_ms'))
      durations.cold_relaunch_to_authenticated_home_ms = Math.max(durations.cold_relaunch_to_authenticated_home_ms, durations.cold_relaunch_to_login_ms);
    return { ...structuredClone(fresh), ...existing, ...(durations ? { raw_durations: durations } : {}),
      completed_stages: [...fresh.completed_stages], installed_artifact_verified: true,
      installed_artifact: structuredClone(metadata.installed_artifact) };
  };
  ui.samples = original.samples.map((fresh, index) => bind(fresh, ui.samples?.[index]));
  ui.controlled_disconnect_retry = bind(original.retry, ui.controlled_disconnect_retry);
  ui.key_management_ui = bind(original.key, ui.key_management_ui);
  return metadata;
}
module.exports = { attach };
