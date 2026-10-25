'use strict';
// Read-only authority admission. This does not install a profile or write a pin.
const crypto = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const { parseStrictJson } = require('./strict_json.cjs');
const WINDOW_PIN = 'KEEPER_CANONICAL_PRIVATE_WINDOW_JSON';
// Installation requires a separately reviewed finite profile. No environment,
// artifact, caller option or live variable can populate this committed policy.
const INSTALLED_PROFILES = Object.freeze({});
const issued = new WeakSet(), originals = new WeakMap();
const SHA = /^[a-f0-9]{40}$/, HEX = /^[a-f0-9]{64}$/;
const sha = value => typeof value === 'string' && SHA.test(value);
const hex = value => typeof value === 'string' && HEX.test(value);
const APP = 'KeeperCommunity/bitcoin-keeper', PRIVATE = 'KeeperCommunity/bitcoin-keeper-relay';
const BACKEND = '29597b27eeeb299205bf7d0555db0a90c38cc4be';
const WORKFLOW = '.github/workflows/r5-native-integration.yml';
const REF = 'refs/heads/codex/r5-native-integration-execution-20261022';
const DRIVER = '448e09d7a373fc7e9d9c540880b45e2c742997f7';
const demand = (yes, code = 'INSTALLED_PARENT_WINDOW_INVALID') => { if (!yes) throw new Error(code); };
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, names) => object(v) && Object.keys(v).sort().join('|') === [...names].sort().join('|');
const id = v => Number.isSafeInteger(v) && v > 0;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function frozen(value) {
  if (object(value) || Array.isArray(value)) { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function validateManifest(value, request, tree) {
  demand(keys(value, ['schema', 'profile', 'window_id', 'app', 'backend', 'public', 'private']) && value.schema === 1 &&
    hex(value.window_id) && typeof value.profile === 'string' && Object.hasOwn(INSTALLED_PROFILES, value.profile),
  'INSTALLED_PARENT_PROFILE_REQUIRED');
  const profile = INSTALLED_PROFILES[value.profile];
  demand(keys(profile, ['repository', 'repositoryId', 'workflowPath', 'ref', 'driverBase', 'backendSha', 'rawProfile']) &&
    profile.repository === PRIVATE && profile.repositoryId === 496119449 && profile.workflowPath === WORKFLOW &&
    profile.ref === REF && profile.driverBase === DRIVER && profile.backendSha === BACKEND && profile.rawProfile === 'D448_RAW13');
  demand(keys(value.app, ['repository', 'sha', 'tree']) && value.app.repository === APP &&
    sha(value.app.sha) && value.app.sha === request.sourceSha && sha(value.app.tree) && value.app.tree === tree);
  demand(keys(value.backend, ['repository', 'sha']) && value.backend.repository === PRIVATE && value.backend.sha === BACKEND);
  demand(keys(value.public, ['workflowPath', 'workflowSha', 'ref', 'runId', 'runAttempt']) &&
    value.public.workflowPath === '.github/workflows/keeper-canonical-native.yml' &&
    sha(value.public.workflowSha) && value.public.workflowSha === request.workflowSha && value.public.ref === 'refs/heads/sprint' &&
    value.public.runId === request.runId && value.public.runAttempt === request.attempt);
  demand(keys(value.private, ['IOS', 'ANDROID']));
  for (const platform of ['IOS', 'ANDROID']) {
    const d = value.private[platform];
    demand(keys(d, ['platform', 'app', 'control', 'backend', 'execution']) && d.platform === platform &&
      equal(d.app, value.app) && equal(d.backend, value.backend));
    demand(keys(d.control, ['repository', 'sha', 'tree']) && d.control.repository === PRIVATE &&
      sha(d.control.sha) && sha(d.control.tree));
    const e = d.execution;
    demand(keys(e, ['repository', 'workflowPath', 'workflowSha', 'ref', 'runId', 'runAttempt']) &&
      e.repository === PRIVATE && e.workflowPath === WORKFLOW && sha(e.workflowSha) && e.workflowSha === d.control.sha &&
      e.ref === REF && id(e.runId) && id(e.runAttempt));
  }
  demand(value.private.IOS.control.sha !== value.private.ANDROID.control.sha &&
    value.private.IOS.execution.runId !== value.private.ANDROID.execution.runId);
  return value;
}
async function readWindow(github, context, request, pinReader) {
  demand(Object.keys(INSTALLED_PROFILES).length > 0, 'INSTALLED_PARENT_PROFILE_REQUIRED');
  // Reuse the existing installed public driver checks and dedicated read-only
  // Variables identity; the ordinary Actions client cannot supply a fallback.
  const driver = require('./canonical_native.cjs');
  driver.requestFromEnvironment(context, { KEEPER_SOURCE_SHA: request.sourceSha,
    GITHUB_WORKFLOW_SHA: request.workflowSha, GITHUB_WORKFLOW_REF: request.workflowRef,
    KEEPER_CANONICAL_NATIVE_DRIVER_SHA: request.pin, GITHUB_RUN_ID: String(request.runId),
    GITHUB_RUN_ATTEMPT: String(request.attempt) });
  await driver.origin(github, context, request, { pinReader });
  const [pin, commit] = await Promise.all([
    pinReader.rest.actions.getRepoVariable({ ...context.repo, name: WINDOW_PIN,
      headers: { 'cache-control': 'no-cache' } }).then(r => r.data)
      .catch(() => { throw new Error('INSTALLED_PARENT_WINDOW_UNREADABLE'); }),
    github.rest.git.getCommit({ ...context.repo, commit_sha: request.sourceSha }).then(r => r.data),
  ]);
  demand(pin?.name === WINDOW_PIN && typeof pin.value === 'string' && Buffer.byteLength(pin.value) > 0 &&
    Buffer.byteLength(pin.value) <= 16384, 'INSTALLED_PARENT_WINDOW_UNREADABLE');
  demand(sha(commit?.sha) && commit.sha === request.sourceSha && sha(commit.tree?.sha));
  const bytes = Buffer.from(pin.value, 'utf8');
  let value; try { value = parseStrictJson(bytes, 16384); } catch { throw new Error('INSTALLED_PARENT_WINDOW_INVALID'); }
  validateManifest(value, request, commit.tree.sha);
  await driver.origin(github, context, request, { pinReader });
  return { value, sha256: digest(bytes) };
}
async function authenticateInstalledParentWindow(github, context, request, { pinReader } = {}) {
  try {
    const { value, sha256 } = await readWindow(github, context, request, pinReader);
    const capability = frozen({ schema: 1, kind: 'installed-reviewed-private-window', profile: value.profile,
      window_id: value.window_id, manifest_sha256: sha256, app: value.app, backend: value.backend,
      public: value.public, expectedPerPlatform: value.private,
      release_ready: false, authorization_eligible: false, release_authorized: false, execution_allowed: false });
    originals.set(capability, sha256); issued.add(capability); return capability;
  } catch (error) { throw new Error(/^INSTALLED_PARENT_[A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'INSTALLED_PARENT_WINDOW_INVALID'); }
}
async function revalidateInstalledParentWindow(github, context, request, capability, { pinReader } = {}) {
  demand(issued.has(capability), 'INSTALLED_PARENT_WINDOW_CAPABILITY_REQUIRED');
  const latest = await authenticateInstalledParentWindow(github, context, request, { pinReader });
  demand(latest.manifest_sha256 === originals.get(capability), 'INSTALLED_PARENT_WINDOW_CHANGED');
  return true;
}
module.exports = { WINDOW_PIN, authenticateInstalledParentWindow, revalidateInstalledParentWindow,
  isInstalledParentWindow: value => issued.has(value) };
