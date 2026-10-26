#!/usr/bin/env node
'use strict';

// Trusted-driver preparation gate only. This file has no signing/upload path.
const fs = require('node:fs');
const path = require('node:path');
const { validateIntent, validateSources } = require('./release-version.cjs');
const profiles = require('../.github/native/release_repository_profiles.cjs');
const live = require('./live-store-request.cjs');
const operations = {
  'ios-signed-build': 'keeper-release-ios',
  'android-signed-build': 'keeper-release-android',
  'testflight-upload': 'keeper-release-ios',
  'play-internal-upload': 'keeper-release-android',
  'ios-submit-review': 'keeper-release-ios',
  'ios-release-approved-version': 'keeper-release-ios',
  'play-production-rollout': 'keeper-release-android',
};
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
// Status/check names and bot/app names do not authenticate their workflow
// origin. No caller/API JSON can mint this module-private capability. The
// legacy JSON collector deliberately never sets it. Only the separately reviewed
// current-installed SDK route may issue an in-process proof after all obligations.
// Empty installed profiles still block every real operation.
const verifiedCIOrigin = Symbol('verified-installed-ci-origin');
const verifiedEvidence = new WeakSet();
function requireCondition(condition, code) { if (!condition) throw new Error(code); }

function requestFromEnvironment(env) {
  const request = {
    repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF, driverSha: env.GITHUB_SHA,
    sourceSha: env.KEEPER_SOURCE_SHA, releaseRef: env.KEEPER_RELEASE_REF,
    operation: env.KEEPER_OPERATION, version: env.KEEPER_VERSION,
    build: env.KEEPER_BUILD, artifactSha256: env.KEEPER_ARTIFACT_SHA256,
    approvalCommentId: env.KEEPER_APPROVAL_COMMENT_ID || 'none',
  };
  requireCondition([profiles.PUBLIC.repository, profiles.PRIVATE.repository].includes(request.repository) && request.ref === 'refs/heads/sprint', 'UNTRUSTED_DRIVER_REF');
  requireCondition(sha.test(request.driverSha || '') && sha.test(request.sourceSha || ''), 'INVALID_IMMUTABLE_SOURCE');
  requireCondition(Object.hasOwn(operations, request.operation || ''), 'UNSUPPORTED_OPERATION');
  requireCondition(/^\d+\.\d+\.\d+$/.test(request.version || '') && request.releaseRef === `release/${request.version}`, 'INVALID_RELEASE_REF_VERSION');
  requireCondition(/^[1-9]\d{0,9}$/.test(request.build || '') && Number(request.build) <= 2100000000, 'INVALID_BUILD');
  if (live.operations.has(request.operation)) request.liveParameters = JSON.stringify(live.parameters(request.operation, env.KEEPER_LIVE_PARAMETERS));
  const upload = !request.operation.endsWith('-signed-build');
  requireCondition(upload ? digest.test(request.artifactSha256 || '') : request.artifactSha256 === 'pending', 'INVALID_ARTIFACT_BINDING');
  requireCondition(request.approvalCommentId === 'none' || /^[1-9]\d{0,18}$/.test(request.approvalCommentId), 'INVALID_APPROVAL_REFERENCE');
  return request;
}

function approvalBody(request, expiresAt) {
  const lines = [
    '## Keeper protected release approval', 'State: APPROVED',
    `Source commit: ${request.sourceSha}`, `Version: ${request.version}`, `Build: ${request.build}`,
    `Operation: ${request.operation}`, `Artifact SHA256: ${request.artifactSha256}`,
    `Workflow commit: ${request.driverSha}`,
  ];
  if (request.identitySha256) lines.push(`Signing identity SHA256: ${request.identitySha256}`, `Production config SHA256: ${request.configSha256}`, 'Artifact storage: ' + profiles.forRepository(request.repository).artifactAudience);
  if (request.liveParameters) lines.push('Live parameters SHA256: ' + require('node:crypto').createHash('sha256').update(request.liveParameters).digest('hex'));
  return [...lines, `Expires at: ${expiresAt}`].join('\n');
}

function validateEvidence(request, evidence, now = Date.now()) {
  const repository = profiles.forRepository(request.repository).repository;
  requireCondition(Object.hasOwn(operations, request.operation || ''), 'UNSUPPORTED_OPERATION');
  requireCondition(evidence.driver?.protected === true && evidence.driver?.commit?.sha === request.driverSha, 'DRIVER_MOVED_OR_UNPROTECTED');
  requireCondition(evidence.branch?.protected === true && evidence.branch?.commit?.sha === request.sourceSha, 'SOURCE_MOVED_OR_UNPROTECTED');
  // Human review is optional. A supplied receipt must still be genuine and exact;
  // absence never substitutes for the SDK's authenticated dispatcher authority.
  let expiration;
  if (request.approvalCommentId !== 'none') {
    const comment = evidence.comment;
    requireCondition(comment?.user?.login === 'antuz123' && ['admin', 'maintain', 'write'].includes(evidence.ownerPermission?.permission), 'APPROVAL_AUTHOR_UNAUTHORIZED');
    expiration = comment?.body?.match(/\nExpires at: (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)$/)?.[1];
    const expires = Date.parse(expiration), updated = Date.parse(comment?.updated_at);
    requireCondition(Number.isFinite(expires) && expires > now && expires <= now + 86400000 && Number.isFinite(updated) && updated <= now && updated >= now - 86400000, 'APPROVAL_STALE_OR_INVALID');
    requireCondition(comment.body === approvalBody(request, expiration), 'APPROVAL_SCOPE_MISMATCH');
  }
  const environment = evidence.environment;
  requireCondition(environment?.name === operations[request.operation] && environment?.can_admins_bypass === false, 'ENVIRONMENT_MISSING_OR_BYPASS_UNVERIFIED');
  requireCondition(Array.isArray(environment.protection_rules), 'ENVIRONMENT_RULES_UNVERIFIED');
  const reviews = environment.protection_rules.filter(rule => rule?.type === 'required_reviewers');
  requireCondition(reviews.length === 0 || (reviews.length === 1 && reviews[0].prevent_self_review === true && Array.isArray(reviews[0].reviewers) && reviews[0].reviewers.length > 0), 'OPTIONAL_ENVIRONMENT_REVIEW_INVALID');
  requireCondition(environment.deployment_branch_policy?.protected_branches === true && environment.deployment_branch_policy?.custom_branch_policies === false, 'ENVIRONMENT_SOURCE_POLICY_UNVERIFIED');
  const currentOrigin = require('./current-release-origin.cjs');
  const authenticated = verifiedEvidence.has(evidence) &&
    currentOrigin.isCurrentReleaseOrigin(evidence[verifiedCIOrigin], request);
  if (!authenticated) {
    // Retain the old unprivileged preparation behavior. Names/JSON never gain
    // credit. The new route independently proves required producer executions;
    // PR-only local status and unrelated legacy characterization are not native proof.
    const statuses = evidence.statuses;
    const checks = evidence.checks;
    requireCondition(statuses?.sha === request.sourceSha && statuses.state === 'success' && Array.isArray(statuses.statuses), 'STATUS_NOT_EXACT_SUCCESS');
    requireCondition(Number.isSafeInteger(checks?.total_count) && checks.total_count > 0 && checks.total_count <= 100 && checks.total_count === checks.check_runs?.length, 'INCOMPLETE_CHECK_EVIDENCE');
    requireCondition(checks.check_runs.every(check => check.head_sha === request.sourceSha && check.status === 'completed' && check.conclusion === 'success'), 'CHECKS_NOT_EXACT_SUCCESS');
    const passedNames = new Set([...statuses.statuses.filter(status => status.state === 'success').map(status => status.context), ...checks.check_runs.map(check => check.name)]);
    requireCondition(['Tests', 'CodeQL', 'keeper/local-validation'].every(name => passedNames.has(name)), 'REQUIRED_CHECK_MISSING');
  }
  requireCondition(evidence.manifest?.version === request.version && String(evidence.manifest[request.operation.startsWith('ios-') || request.operation === 'testflight-upload' ? 'iosBuildNumber' : 'androidVersionCode']) === request.build, 'SOURCE_VERSION_BUILD_MISMATCH');
  requireCondition(validateIntent(evidence.manifest, { now, requireEvidence: !live.operations.has(request.operation) }).length === 0 && validateSources(evidence.manifest, evidence.sources).length === 0, 'RELEASE_SOURCE_PREFLIGHT_FAILED');
  requireCondition(authenticated, 'TRUSTED_CI_ORIGIN_NOT_VERIFIED');
  const authorityExpiry = evidence[verifiedCIOrigin].worker.authorization.expires_at;
  requireCondition(Number.isFinite(Date.parse(authorityExpiry)) && Date.parse(authorityExpiry) > now, 'DISPATCH_AUTHORITY_EXPIRED');
  // A supplied optional receipt can shorten, but never extend, the run authority.
  const deadline = Math.min(Date.parse(authorityExpiry), expiration ? Date.parse(expiration) : Infinity);
  return {
    schema: 1, repository, sourceSha: request.sourceSha, driverSha: request.driverSha,
    operation: request.operation, version: request.version, build: request.build,
    artifactSha256: request.artifactSha256, environment: operations[request.operation],
    state: 'PROTECTED_OPERATION_INPUTS_VERIFIED',
    artifact_bytes_and_signature_verified: false,
    release_worker_implemented: true, execution_allowed: false,
    operation_scope: live.operations.has(request.operation) ? 'EXISTING_BUILD_LIVE_STORE_OPERATION' : 'SIGNED_BUILD_OR_INTERNAL_UPLOAD_ONLY',
    physical_acceptance: 'NOT_RUN_NOT_WAIVED', public_release_ready: false,
    human_review: request.approvalCommentId === 'none' ? 'OPTIONAL_NOT_REQUESTED' : 'EXACT_RECEIPT_VERIFIED',
    authorizationExpiresAt: new Date(deadline).toISOString(),
  };
}

async function api(endpoint, token, selectedRepository = profiles.PUBLIC.repository) {
  const repository = profiles.forRepository(selectedRepository).repository;
  const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  requireCondition(response.ok, 'READ_ONLY_API_UNAVAILABLE');
  return response.json();
}

async function collectEvidence(request, root, token) {
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  const evidence = {
    // Only trusted driver code is executed. Candidate files are data.
    manifest: JSON.parse(read('release/version.json')),
    sources: {
      packageText: read('package.json'), android: read('android/app/build.gradle'),
      ios: read('ios/hexa_keeper.xcodeproj/project.pbxproj'),
      iosPlists: ['ios/hexa_keeper/Info.plist', 'ios/hexa_keeper_dev-Info.plist'].map(read),
    },
  };
  const readApi = endpoint => api(endpoint, token, request.repository);
  [evidence.driver, evidence.branch, evidence.comment, evidence.ownerPermission, evidence.environment, evidence.statuses, evidence.checks] = await Promise.all([
    readApi('branches/sprint'),
    readApi(`branches/${encodeURIComponent(request.releaseRef)}`),
    request.approvalCommentId === 'none' ? undefined : readApi(`issues/comments/${request.approvalCommentId}`),
    request.approvalCommentId === 'none' ? undefined : readApi('collaborators/antuz123/permission'),
    readApi(`environments/${operations[request.operation]}`),
    readApi(`commits/${request.sourceSha}/status?per_page=100`),
    readApi(`commits/${request.sourceSha}/check-runs?per_page=100`),
  ]);
  return evidence;
}

async function collectEvidenceWithSDK(request, root, github, context, options) {
  const origin = require('./current-release-origin.cjs');
  const api = origin.sdk(github, options?.fetchImpl, request.repository);
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  const evidence = { manifest: JSON.parse(read('release/version.json')),
    sources: { packageText: read('package.json'), android: read('android/app/build.gradle'),
      ios: read('ios/hexa_keeper.xcodeproj/project.pbxproj'),
      iosPlists: ['ios/hexa_keeper/Info.plist', 'ios/hexa_keeper_dev-Info.plist'].map(read) } };
  const entries = [['driver', 'branches/sprint'], ['branch', 'branches/' + encodeURIComponent(request.releaseRef)],
    ['environment', 'environments/' + operations[request.operation]]];
  if (request.approvalCommentId !== 'none') entries.push(
    ['comment', 'issues/comments/' + request.approvalCommentId], ['ownerPermission', 'collaborators/antuz123/permission']);
  const endpoints = entries.map(([, endpoint]) => endpoint);
  const values = await Promise.all(endpoints.map(endpoint => api.json(endpoint).then(row => row.value)));
  entries.forEach(([key], index) => { evidence[key] = values[index]; });
  const proof = await origin.collectCurrentReleaseOrigin(github, context, request, options);
  const current = await Promise.all(endpoints.map(endpoint => api.json(endpoint).then(row => row.value)));
  const previous = entries.map(([key]) => evidence[key]);
  requireCondition(require('node:util').isDeepStrictEqual(current, previous), 'APPROVAL_OR_PROTECTION_CHANGED');
  // The issued source proof and this exact evidence object stay in this process.
  // Serialization, copied Symbols, and the separate A1 object cannot enter this set.
  Object.defineProperty(evidence, verifiedCIOrigin, { value: proof });
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  };
  freeze(evidence); verifiedEvidence.add(evidence);
  return evidence;
}

async function main(env = process.env) {
  const request = requestFromEnvironment(env);
  requireCondition(env.GH_TOKEN && env.KEEPER_CANDIDATE_PATH, 'DRIVER_CONFIGURATION_MISSING');
  const evidence = await collectEvidence(request, path.resolve(env.KEEPER_CANDIDATE_PATH), env.GH_TOKEN);
  const result = validateEvidence(request, evidence);
  console.log(JSON.stringify(result, null, 2));
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `environment=${result.environment}\n`);
}

module.exports = { requestFromEnvironment, approvalBody, validateEvidence, collectEvidence,
  collectEvidenceWithSDK, api };
if (require.main === module) main().catch(() => {
  // Never echo tokens, API payloads, user inputs, paths or exception details.
  console.error('Protected release preparation blocked: source, approval, protection or acceptance evidence is unavailable/invalid. No release action performed.');
  process.exitCode = 1;
});
