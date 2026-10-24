#!/usr/bin/env node
'use strict';

// Trusted-driver preparation gate only. This file has no signing/upload path.
const fs = require('node:fs');
const path = require('node:path');
const { validateIntent, validateSources } = require('./release-version.cjs');
const repository = 'KeeperCommunity/bitcoin-keeper';
const operations = {
  'ios-signed-build': 'keeper-release-ios',
  'android-signed-build': 'keeper-release-android',
  'testflight-upload': 'keeper-release-ios',
  'play-internal-upload': 'keeper-release-android',
};
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
// Status/check names and bot/app names do not authenticate their workflow
// origin. No caller/API JSON can mint this module-private capability. The
// installed canonical/native provenance route is not implemented/verified yet,
// so collectEvidence deliberately never sets it and authorization fails closed.
const verifiedCIOrigin = Symbol('verified-installed-ci-origin');
function requireCondition(condition, code) { if (!condition) throw new Error(code); }

function requestFromEnvironment(env) {
  const request = {
    repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_REF, driverSha: env.GITHUB_SHA,
    sourceSha: env.KEEPER_SOURCE_SHA, releaseRef: env.KEEPER_RELEASE_REF,
    operation: env.KEEPER_OPERATION, version: env.KEEPER_VERSION,
    build: env.KEEPER_BUILD, artifactSha256: env.KEEPER_ARTIFACT_SHA256,
    approvalCommentId: env.KEEPER_APPROVAL_COMMENT_ID,
  };
  requireCondition(request.repository === repository && request.ref === 'refs/heads/sprint', 'UNTRUSTED_DRIVER_REF');
  requireCondition(sha.test(request.driverSha || '') && sha.test(request.sourceSha || ''), 'INVALID_IMMUTABLE_SOURCE');
  requireCondition(Object.hasOwn(operations, request.operation || ''), 'UNSUPPORTED_OPERATION');
  requireCondition(/^\d+\.\d+\.\d+$/.test(request.version || '') && request.releaseRef === `release/${request.version}`, 'INVALID_RELEASE_REF_VERSION');
  requireCondition(/^[1-9]\d{0,9}$/.test(request.build || '') && Number(request.build) <= 2100000000, 'INVALID_BUILD');
  const upload = request.operation.endsWith('-upload');
  requireCondition(upload ? digest.test(request.artifactSha256 || '') : request.artifactSha256 === 'pending', 'INVALID_ARTIFACT_BINDING');
  requireCondition(/^[1-9]\d{0,18}$/.test(request.approvalCommentId || ''), 'INVALID_APPROVAL_REFERENCE');
  return request;
}

function approvalBody(request, expiresAt) {
  const lines = [
    '## Keeper protected release approval', 'State: APPROVED',
    `Source commit: ${request.sourceSha}`, `Version: ${request.version}`, `Build: ${request.build}`,
    `Operation: ${request.operation}`, `Artifact SHA256: ${request.artifactSha256}`,
    `Workflow commit: ${request.driverSha}`,
  ];
  if (request.identitySha256) lines.push(`Signing identity SHA256: ${request.identitySha256}`, `Production config SHA256: ${request.configSha256}`, 'Artifact storage: GitHub Actions public-repository readers (14 days)');
  return [...lines, `Expires at: ${expiresAt}`].join('\n');
}

function validateEvidence(request, evidence, now = Date.now()) {
  requireCondition(evidence.driver?.protected === true && evidence.driver?.commit?.sha === request.driverSha, 'DRIVER_MOVED_OR_UNPROTECTED');
  requireCondition(evidence.branch?.protected === true && evidence.branch?.commit?.sha === request.sourceSha, 'SOURCE_MOVED_OR_UNPROTECTED');
  const comment = evidence.comment;
  requireCondition(comment?.user?.login === 'antuz123' && ['admin', 'maintain', 'write'].includes(evidence.ownerPermission?.permission), 'APPROVAL_AUTHOR_UNAUTHORIZED');
  const expiration = comment?.body?.match(/\nExpires at: (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)$/)?.[1];
  const expires = Date.parse(expiration);
  const updated = Date.parse(comment?.updated_at);
  requireCondition(Number.isFinite(expires) && expires > now && expires <= now + 86400000 && Number.isFinite(updated) && updated <= now && updated >= now - 86400000, 'APPROVAL_STALE_OR_INVALID');
  requireCondition(comment.body === approvalBody(request, expiration), 'APPROVAL_SCOPE_MISMATCH');
  const environment = evidence.environment;
  requireCondition(environment?.name === operations[request.operation] && environment?.can_admins_bypass === false, 'ENVIRONMENT_MISSING_OR_BYPASS_UNVERIFIED');
  const reviews = environment.protection_rules?.filter(rule => rule.type === 'required_reviewers') || [];
  requireCondition(reviews.length === 1 && reviews[0].prevent_self_review === true && Array.isArray(reviews[0].reviewers) && reviews[0].reviewers.length > 0, 'INDEPENDENT_ENVIRONMENT_REVIEW_REQUIRED');
  requireCondition(environment.deployment_branch_policy?.protected_branches === true && environment.deployment_branch_policy?.custom_branch_policies === false, 'ENVIRONMENT_SOURCE_POLICY_UNVERIFIED');
  const statuses = evidence.statuses;
  const checks = evidence.checks;
  requireCondition(statuses?.sha === request.sourceSha && statuses.state === 'success' && Array.isArray(statuses.statuses), 'STATUS_NOT_EXACT_SUCCESS');
  requireCondition(Number.isSafeInteger(checks?.total_count) && checks.total_count > 0 && checks.total_count <= 100 && checks.total_count === checks.check_runs?.length, 'INCOMPLETE_CHECK_EVIDENCE');
  requireCondition(checks.check_runs.every(check => check.head_sha === request.sourceSha && check.status === 'completed' && check.conclusion === 'success'), 'CHECKS_NOT_EXACT_SUCCESS');
  const passedNames = new Set([...statuses.statuses.filter(status => status.state === 'success').map(status => status.context), ...checks.check_runs.map(check => check.name)]);
  requireCondition(['Tests', 'CodeQL', 'keeper/local-validation'].every(name => passedNames.has(name)), 'REQUIRED_CHECK_MISSING');
  requireCondition(evidence.manifest?.version === request.version && String(evidence.manifest[request.operation.startsWith('ios-') || request.operation === 'testflight-upload' ? 'iosBuildNumber' : 'androidVersionCode']) === request.build, 'SOURCE_VERSION_BUILD_MISMATCH');
  requireCondition(validateIntent(evidence.manifest, { now }).length === 0 && validateSources(evidence.manifest, evidence.sources).length === 0, 'RELEASE_SOURCE_PREFLIGHT_FAILED');
  requireCondition(evidence[verifiedCIOrigin] === true, 'TRUSTED_CI_ORIGIN_NOT_VERIFIED');
  return {
    schema: 1, repository, sourceSha: request.sourceSha, driverSha: request.driverSha,
    operation: request.operation, version: request.version, build: request.build,
    artifactSha256: request.artifactSha256, environment: operations[request.operation],
    state: 'AUTHORIZATION_CHECKED_PREPARATION_ONLY',
    artifact_bytes_and_signature_verified: false,
    release_worker_implemented: false, execution_allowed: false,
  };
}

async function api(endpoint, token) {
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
  [evidence.driver, evidence.branch, evidence.comment, evidence.ownerPermission, evidence.environment, evidence.statuses, evidence.checks] = await Promise.all([
    api('branches/sprint', token),
    api(`branches/${encodeURIComponent(request.releaseRef)}`, token),
    api(`issues/comments/${request.approvalCommentId}`, token),
    api('collaborators/antuz123/permission', token),
    api(`environments/${operations[request.operation]}`, token),
    api(`commits/${request.sourceSha}/status?per_page=100`, token),
    api(`commits/${request.sourceSha}/check-runs?per_page=100`, token),
  ]);
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

module.exports = { requestFromEnvironment, approvalBody, validateEvidence, collectEvidence, api };
if (require.main === module) main().catch(() => {
  // Never echo tokens, API payloads, user inputs, paths or exception details.
  console.error('Protected release preparation blocked: source, approval, protection or acceptance evidence is unavailable/invalid. No release action performed.');
  process.exitCode = 1;
});
