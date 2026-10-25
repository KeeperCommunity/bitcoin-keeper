'use strict';
// Read-only Actions + original receipt ingestion. Status names alone supply no credit.
const { collectPublicSoftwareEvidence, isPublicSoftwareEvidence } = require('./actions_software_evidence.cjs');
async function softwareEvidence(github, context, input, options) {
  try { return await collectPublicSoftwareEvidence(github, context, input, options); }
  catch (error) {
    return Object.freeze({ schema: 1, status: 'BLOCKED',
      reason: /^SOFTWARE_[A-Z0-9_]{1,80}$/.test(error?.message || '') ? error.message : 'SOFTWARE_EVIDENCE_INVALID',
      installed_trust: 'UNVERIFIED', software_complete: false, release_ready: false,
      authorization_eligible: false, release_authorized: false, execution_allowed: false });
  }
}
// Compatibility boolean now requires the same authenticated original-byte proof.
async function evidence(github, context, input, options) {
  return isPublicSoftwareEvidence(await softwareEvidence(github, context, input, options));
}
module.exports = { evidence, softwareEvidence };
