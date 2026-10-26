'use strict';
// Original D448 bytes and authenticated read-only Actions facts; never release authority.
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual: equal } = require('node:util');
const origin = require('./private_actions_origin.cjs');
const { parentSoftwareMembers, validateParentSoftwareEvidence } = require('./parent_software_evidence.cjs');
const PRIVATE = 'KeeperCommunity/bitcoin-keeper-relay';
const MAX_ARCHIVE = 12 * 1024 * 1024;
const issued = new WeakSet(), authorities = new WeakMap();
const demand = (yes, code) => { if (!yes) throw new Error(code); };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const id = value => Number.isSafeInteger(value) && value > 0;
function frozen(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function safeError(error) {
  return new Error(/^PRIVATE_(?:ACTIONS|SOFTWARE)_[A-Z0-9_]{1,80}$/.test(error?.message || '') ?
    error.message : 'PRIVATE_SOFTWARE_COLLECTION_INVALID');
}
async function boundedBytes(response) {
  let reader;
  try {
    demand(response?.ok === true && typeof response.body?.getReader === 'function', 'PRIVATE_SOFTWARE_ARCHIVE_READ_FAILED');
    const length = response.headers.get('content-length');
    demand(length === null || (/^\d+$/.test(length) && Number(length) <= MAX_ARCHIVE), 'PRIVATE_SOFTWARE_ARCHIVE_TOO_LARGE');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      demand(value instanceof Uint8Array, 'PRIVATE_SOFTWARE_ARCHIVE_READ_FAILED');
      size += value.length;
      demand(size <= MAX_ARCHIVE, 'PRIVATE_SOFTWARE_ARCHIVE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    demand(length === null || Number(length) === size, 'PRIVATE_SOFTWARE_ARCHIVE_SIZE_MISMATCH');
    return Buffer.concat(chunks);
  } finally {
    if (reader) await reader.cancel();
    else if (response?.body?.cancel) await response.body.cancel();
  }
}
async function readPrivateArtifactBytes(github, artifactId, { fetchImpl = fetch } = {}) {
  try {
    demand(id(artifactId), 'PRIVATE_SOFTWARE_ARTIFACT_IDENTITY_INVALID');
    const apiURL = `https://api.github.com/repos/${PRIVATE}/actions/artifacts/${artifactId}/zip`;
    let intercepted = false;
    const response = await github.rest.actions.downloadArtifact({ owner: 'KeeperCommunity', repo: 'bitcoin-keeper-relay',
      artifact_id: artifactId, archive_format: 'zip', request: { timeout: 30000, parseSuccessResponseBody: false,
        fetch: async (url, init) => {
          demand(!intercepted && url === apiURL && init?.method === 'GET' && init.body == null,
            'PRIVATE_SOFTWARE_ARCHIVE_API_REQUEST_INVALID');
          intercepted = true;
          const apiResponse = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) });
          try {
            demand(apiResponse?.status === 302, 'PRIVATE_SOFTWARE_ARCHIVE_REDIRECT_REQUIRED');
            return apiResponse;
          } finally { if (apiResponse?.body) await apiResponse.body.cancel(); }
        } } });
    demand(intercepted && response.status === 302, 'PRIVATE_SOFTWARE_ARCHIVE_REDIRECT_REQUIRED');
    const location = new URL(response.headers.location);
    demand(location.protocol === 'https:' && !location.username && !location.password && !location.hash &&
      (!location.port || location.port === '443') &&
      (location.hostname.endsWith('.blob.core.windows.net') || location.hostname.endsWith('.actions.githubusercontent.com')),
    'PRIVATE_SOFTWARE_ARCHIVE_HOST_INVALID');
    // Only the authenticated GitHub API hop receives SDK headers. Storage never does.
    return await boundedBytes(await fetchImpl(location, { redirect: 'error', signal: AbortSignal.timeout(30000) }));
  } catch (error) { throw safeError(error); }
}
function unpackPrivateArtifact(archive, platform) {
  try {
    demand(Buffer.isBuffer(archive) && archive.length > 0 && archive.length <= MAX_ARCHIVE,
      'PRIVATE_SOFTWARE_ARCHIVE_TOO_LARGE');
    const result = execFileSync('python3', ['-B', path.join(__dirname, 'private_software_artifact_zip.py'), platform], {
      input: archive, timeout: 10000, maxBuffer: MAX_ARCHIVE * 2, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' },
    });
    const envelope = JSON.parse(result.toString('utf8')), names = parentSoftwareMembers(platform);
    demand(envelope && !Array.isArray(envelope) && Object.keys(envelope).length === names.length &&
      Object.keys(envelope).every(name => names.includes(name)), 'PRIVATE_SOFTWARE_ARCHIVE_MEMBERS_INVALID');
    const members = {};
    for (const name of names) {
      const value = envelope[name];
      demand(typeof value === 'string', 'PRIVATE_SOFTWARE_ARCHIVE_MEMBERS_INVALID');
      const bytes = Buffer.from(value, 'base64');
      demand(bytes.length > 0 && bytes.toString('base64') === value, 'PRIVATE_SOFTWARE_ARCHIVE_MEMBERS_INVALID');
      members[name] = bytes;
    }
    return members;
  } catch { throw new Error('PRIVATE_SOFTWARE_ARCHIVE_MEMBERS_INVALID'); }
}
async function revalidatePrivateActionsSoftware(github, proof, { clock = Date.now } = {}) {
  try {
    demand(issued.has(proof), 'PRIVATE_SOFTWARE_CAPABILITY_REQUIRED');
    const original = authorities.get(proof);
    const latest = await origin.authenticatePrivateActionsOrigins(github, original.expected, { clock, appGithub: original.appGithub });
    demand(origin.isPrivateActionsOrigin(latest) && equal(latest, original.origin), 'PRIVATE_SOFTWARE_ORIGIN_CHANGED');
    return true;
  } catch (error) { throw safeError(error); }
}
async function collectPrivateActionsSoftware(github, expectedPerPlatform, { clock = Date.now, fetchImpl = fetch, appGithub } = {}) {
  try {
    // Origin snapshots independent descriptors and validates complete lists; no success filter.
    const first = await origin.authenticatePrivateActionsOrigins(github, expectedPerPlatform, { clock, appGithub });
    demand(origin.isPrivateActionsOrigin(first), 'PRIVATE_SOFTWARE_ORIGIN_REQUIRED');
    const platforms = {};
    for (const platform of ['IOS', 'ANDROID']) {
      const selected = first.platforms[platform];
      const archive = await readPrivateArtifactBytes(github, selected.artifact.id, { fetchImpl });
      demand(archive.length === selected.artifact.size && digest(archive) === selected.artifact.sha256,
        'PRIVATE_SOFTWARE_ARTIFACT_DIGEST_MISMATCH');
      const members = unpackPrivateArtifact(archive, platform);
      const software = validateParentSoftwareEvidence(members, selected.expected);
      platforms[platform] = { artifact_id: selected.artifact.id, archive_sha256: digest(archive),
        job_id: selected.job_id, check_run_id: selected.check_run_id, software };
    }
    // Later platform download/validation can revoke the first artifact or run.
    const expected = Object.fromEntries(['IOS', 'ANDROID'].map(p => [p, first.platforms[p].descriptor]));
    const latest = await origin.authenticatePrivateActionsOrigins(github, expected, { clock, appGithub });
    demand(origin.isPrivateActionsOrigin(latest) && equal(latest, first), 'PRIVATE_SOFTWARE_ORIGIN_CHANGED');
    const result = frozen({ schema: 1, kind: 'private-actions-original-d13-software', platforms,
      worker_sources: first.platforms.IOS.expected.workerSources,
      installed_trust: 'UNVERIFIED', native_acceptance: false, release_ready: false,
      authorization_eligible: false, execution_allowed: false, release_authorized: false });
    issued.add(result); authorities.set(result, { expected, origin: first, appGithub }); return result;
  } catch (error) { throw safeError(error); }
}
module.exports = { readPrivateArtifactBytes, unpackPrivateArtifact, collectPrivateActionsSoftware,
  revalidatePrivateActionsSoftware, isPrivateActionsSoftware: value => issued.has(value) };
