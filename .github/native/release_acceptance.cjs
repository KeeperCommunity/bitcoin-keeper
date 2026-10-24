// Common release obligations. Extend with real executable scenarios, never status-only waivers.
// Native module checks are deliberately distinct from app-account or feature acceptance.
const REQUIRED = Object.freeze([
  'native-build-and-startup',
  'native-realm-mmkv-process-persistence',
  'key-deletion-live-reference-and-privacy',
  'setup-offline-retry-relaunch-no-duplicates',
  'app-account-session-isolation',
  'normal-page-runtime-and-recovery-regression',
  'cold-start-and-first-wallet-performance',
]);
function acceptance({ trusted, ios, android }) {
  const executed = trusted === true && ios === 'success' && android === 'success';
  const cases = REQUIRED.map((id, index) => ({
    id,
    status: index < 2 ? (executed ? 'PASS' : 'NOT VERIFIED') : 'NOT IMPLEMENTED',
    scope: index === 1 ? 'CI entrypoint; actual native storage, not application account isolation' :
      index > 1 ? 'Requires reviewed app scenarios on the exact combined candidate' :
        'Unsigned simulator / development debug-key emulator; narrow passcode smoke',
  }));
  return { release_ready: false, phase_a: 'BLOCKED', cases,
    signing: 'NOT IMPLEMENTED / NOT VERIFIED (separate Phase B)',
    physical: 'NOT RUN (authorized tester and exact distributed artifact required)' };
}
function markdown(result) {
  return '# Keeper Phase A release acceptance: BLOCKED\n\n' +
    'This check cannot approve a release. Startup and native module probes do not cover the app matrix.\n\n' +
    '| Required scenario | Result | Scope |\n| --- | --- | --- |\n' +
    result.cases.map(c => `| ${c.id} | ${c.status} | ${c.scope} |`).join('\n') +
    `\n\nSigning/distribution: ${result.signing}.\n\nPhysical: ${result.physical}.\n`;
}
module.exports = { REQUIRED, acceptance, markdown };
