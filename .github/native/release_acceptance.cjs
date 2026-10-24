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
function acceptance({ trusted, ios, android, publicSoftware }) {
  // Existing canonical callers retain their separate origin validation. The
  // PR summary passes an issued P2 proof, never caller-supplied PASS labels.
  const routed = publicSoftware !== undefined;
  const authenticated = routed && require('./actions_software_evidence.cjs').isPublicSoftwareEvidence(publicSoftware);
  const executed = (routed ? authenticated : trusted === true) && ios === 'success' && android === 'success';
  const cases = REQUIRED.map((id, index) => ({
    id,
    status: index < 2 ? (executed ? 'PASS' : 'NOT VERIFIED') : 'NOT IMPLEMENTED',
    scope: index === 1 ? 'CI entrypoint; actual native storage, not application account isolation' :
      index > 1 ? 'Requires reviewed app scenarios on the exact combined candidate' :
        'Unsigned simulator / development debug-key emulator; narrow passcode smoke',
  }));
  if (routed) for (const row of cases.slice(2)) {
    row.status = 'NOT VERIFIED';
    row.scope = 'Requires complete frozen C2/D raw composition from its separately authenticated private route; public scoped checks alone do not prove this parent';
  }
  return { release_ready: false, phase_a: 'BLOCKED', cases, software_complete: false,
    installed_trust: 'UNVERIFIED', authorization_eligible: false, release_authorized: false, execution_allowed: false,
    ...(routed ? { public_software: authenticated ? publicSoftware.platforms : null,
      evidence_result: authenticated ? 'PUBLIC SCOPED RECEIPTS VERIFIED; PRIVATE PARENTS INCOMPLETE' :
        (/^SOFTWARE_[A-Z0-9_]{1,80}$/.test(publicSoftware?.reason || '') ? publicSoftware.reason : 'SOFTWARE_EVIDENCE_INVALID') } : {}),
    signing: 'NOT IMPLEMENTED / NOT VERIFIED (separate Phase B)',
    physical: 'NOT RUN (authorized tester and exact distributed artifact required)' };
}
function markdown(result) {
  const publicRows = result.public_software ? Object.entries(result.public_software).flatMap(([platform, row]) =>
    Object.entries(row.executed_checks).map(([id, value]) => `| ${platform}: ${id} | ${value.status} | ${value.scope} |`)) : [];
  return '# Keeper Phase A release acceptance: BLOCKED\n\n' +
    'This check cannot approve a release. Startup and native module probes do not cover the app matrix.\n\n' +
    '| Required scenario | Result | Scope |\n| --- | --- | --- |\n' +
    result.cases.map(c => `| ${c.id} | ${c.status} | ${c.scope} |`).join('\n') +
    (result.evidence_result ? `\n\nOriginal-byte evidence: ${result.evidence_result}.\n` : '') +
    (publicRows.length ? '\n\n| Executed public scoped check | Result | Scope |\n| --- | --- | --- |\n' + publicRows.join('\n') : '') +
    `\n\nSigning/distribution: ${result.signing}.\n\nPhysical: ${result.physical}.\n`;
}
module.exports = { REQUIRED, acceptance, markdown };
