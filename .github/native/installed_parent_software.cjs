'use strict';
// Compose independently authenticated read-only windows. No profile installation or release authority.
const { isDeepStrictEqual: equal } = require('node:util');
const window = require('./installed_parent_window.cjs');
const privateSoftware = require('./private_actions_software.cjs');
const issued = new WeakSet(), publicBindings = new WeakMap();
const demand = (yes, code) => { if (!yes) throw new Error(code); };
const PARENTS = require('./release_acceptance.cjs').REQUIRED.slice(2);
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
async function collectInstalledParentSoftware(privateGithub, github, context, request, publicProof, options = {}) {
  const canonical = require('./canonical_native.cjs');
  demand(canonical.isInstalledPublicEvidence(publicProof), 'INSTALLED_PARENT_PUBLIC_CAPABILITY_REQUIRED');
  // Only the committed finite profile is admissible. An API response, option or artifact cannot add one.
  const admitted = await window.authenticateInstalledParentWindow(github, context, request, { pinReader: options.pinReader });
  demand(window.isInstalledParentWindow(admitted), 'INSTALLED_PARENT_WINDOW_CAPABILITY_REQUIRED');
  demand(privateGithub && privateGithub !== github && typeof privateGithub.rest?.actions?.downloadArtifact === 'function',
    'INSTALLED_PARENT_PRIVATE_READ_IDENTITY_REQUIRED');
  demand(publicProof.repository === admitted.app.repository && publicProof.source_sha === admitted.app.sha && publicProof.source_tree === admitted.app.tree &&
    publicProof.workflow_sha === admitted.public.workflowSha && publicProof.workflow_path === admitted.public.workflowPath &&
    publicProof.run_id === admitted.public.runId && publicProof.run_attempt === admitted.public.runAttempt,
  'INSTALLED_PARENT_PUBLIC_WINDOW_MISMATCH');
  const privateProof = await privateSoftware.collectPrivateActionsSoftware(privateGithub,
    admitted.expectedPerPlatform, { clock: options.clock, fetchImpl: options.fetchImpl, appGithub: github });
  demand(privateSoftware.isPrivateActionsSoftware(privateProof), 'INSTALLED_PARENT_PRIVATE_CAPABILITY_REQUIRED');
  demand(equal(publicProof.worker_sources, privateProof.worker_sources), 'INSTALLED_PARENT_WORKER_SOURCE_MISMATCH');
  const platforms = {};
  for (const platform of ['IOS', 'ANDROID']) {
    const raw = privateProof.platforms[platform], software = raw.software;
    demand(software.software_complete === true && equal(software.identity.app, admitted.app) &&
      equal(software.identity.backend, admitted.backend) &&
      equal(software.identity.control, admitted.expectedPerPlatform[platform].control) &&
      equal(software.identity.execution, admitted.expectedPerPlatform[platform].execution) &&
      Array.isArray(software.cases) && software.cases.length === PARENTS.length && PARENTS.every(id =>
        software.cases.filter(row => row.id === id && row.status === 'PASS').length === 1),
    'INSTALLED_PARENT_SOFTWARE_INCOMPLETE');
    platforms[platform] = { cases: software.cases.map(({ id, status }) => ({ id, status })),
      private_artifact_id: raw.artifact_id, private_archive_sha256: raw.archive_sha256,
      private_job_id: raw.job_id, private_check_run_id: raw.check_run_id,
      original_member_sha256: { ...software.raw_sha256 } };
  }
  // Recheck both authorities after all downloads/validation. This is repeated readback,
  // not an atomic GitHub snapshot; the final API phase rereads the public source and pins.
  await window.revalidateInstalledParentWindow(github, context, request, admitted, { pinReader: options.pinReader });
  await privateSoftware.revalidatePrivateActionsSoftware(privateGithub, privateProof, { clock: options.clock });
  await canonical.revalidateInstalledPublicEvidence(github, context, request, publicProof,
    { pinReader: options.pinReader, clock: options.clock });
  await window.revalidateInstalledParentWindow(github, context, request, admitted, { pinReader: options.pinReader });
  const result = frozen({ schema: 1, kind: 'installed-parent-original-software', app: admitted.app,
    window_id: admitted.window_id, manifest_sha256: admitted.manifest_sha256, platforms,
    installed_trust: 'UNVERIFIED', native_acceptance: false, release_ready: false,
    authorization_eligible: false, execution_allowed: false, release_authorized: false });
  issued.add(result); publicBindings.set(result, publicProof); return result;
}
function projectInstalledParentCases(publicProof, privateProof) {
  const canonical = require('./canonical_native.cjs');
  demand(canonical.isInstalledPublicEvidence(publicProof) && issued.has(privateProof) &&
    publicBindings.get(privateProof) === publicProof &&
    publicProof.source_sha === privateProof.app.sha && publicProof.source_tree === privateProof.app.tree,
  'INSTALLED_PARENT_COMPOSITION_CAPABILITIES_REQUIRED');
  return Object.fromEntries(['IOS', 'ANDROID'].map(platform => {
    const original = publicProof.platforms[platform], parents = privateProof.platforms[platform].cases;
    demand(original.cases.length === PARENTS.length + 2 && original.cases.slice(0, 2).every(row => row.status === 'PASS'),
      'INSTALLED_PARENT_PUBLIC_SOFTWARE_INCOMPLETE');
    return [platform, { ...original, cases: original.cases.map(row => PARENTS.includes(row.id) ?
      { ...parents.find(parent => parent.id === row.id) } : { ...row }) }];
  }));
}
module.exports = { collectInstalledParentSoftware, projectInstalledParentCases,
  isInstalledParentSoftware: value => issued.has(value) };
