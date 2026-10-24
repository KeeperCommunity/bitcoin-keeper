'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requestFromEnvironment, approvalBody, validateEvidence } = require('./protected-release-plan.cjs');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const now = Date.parse('2026-10-22T12:00:00Z');

function fixture() {
  const manifest = JSON.parse(read('release/version.json'));
  for (const baseline of Object.values(manifest.baselines)) baseline.verifiedAt = '2026-10-22T11:00:00Z';
  const env = {
    GITHUB_REPOSITORY: 'KeeperCommunity/bitcoin-keeper', GITHUB_REF: 'refs/heads/sprint',
    GITHUB_SHA: 'a'.repeat(40), KEEPER_SOURCE_SHA: 'b'.repeat(40),
    KEEPER_RELEASE_REF: `release/${manifest.version}`, KEEPER_OPERATION: 'testflight-upload',
    KEEPER_VERSION: manifest.version, KEEPER_BUILD: String(manifest.iosBuildNumber),
    KEEPER_ARTIFACT_SHA256: 'c'.repeat(64), KEEPER_APPROVAL_COMMENT_ID: '123',
  };
  const request = requestFromEnvironment(env);
  const evidence = {
    driver: { protected: true, commit: { sha: request.driverSha } },
    branch: { protected: true, commit: { sha: request.sourceSha } },
    comment: { user: { login: 'antuz123' }, body: approvalBody(request, '2026-10-22T13:00:00Z'), updated_at: '2026-10-22T11:30:00Z' },
    ownerPermission: { permission: 'write' },
    environment: { name: 'keeper-release-ios', can_admins_bypass: false,
      protection_rules: [{ type: 'required_reviewers', prevent_self_review: true, reviewers: [{ id: 1 }] }],
      deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } },
    statuses: { sha: request.sourceSha, state: 'success', statuses: [{ context: 'keeper/local-validation', state: 'success' }] },
    checks: { total_count: 2, check_runs: ['Tests', 'CodeQL'].map(name => ({ name, head_sha: request.sourceSha, status: 'completed', conclusion: 'success' })) },
    manifest,
    sources: { packageText: read('package.json'), android: read('android/app/build.gradle'), ios: read('ios/hexa_keeper.xcodeproj/project.pbxproj'),
      iosPlists: ['ios/hexa_keeper/Info.plist', 'ios/hexa_keeper_dev-Info.plist'].map(read) },
  };
  return { env, request, evidence };
}

test('complete synthetic names/shape cannot establish trusted CI origin or authorize a plan', () => {
  const { request, evidence } = fixture();
  assert.throws(() => validateEvidence(request, evidence, now), /TRUSTED_CI_ORIGIN_NOT_VERIFIED/);
});

test('forged successful status names, creators and apps never count as authenticated execution evidence', () => {
  const { request, evidence } = fixture();
  evidence.statuses.statuses = ['Tests', 'CodeQL', 'keeper/local-validation'].map(context => ({ context, state: 'success', creator: { login: 'github-actions[bot]' } }));
  evidence.checks = { total_count: 1, check_runs: [{ name: 'Unrelated', head_sha: request.sourceSha, status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } }] };
  evidence.trustedCIOrigin = true;
  evidence.originVerified = true;
  assert.throws(() => validateEvidence(request, evidence, now), /TRUSTED_CI_ORIGIN_NOT_VERIFIED/);
});

for (const [name, mutate, expectedCode] of [
  ['moving driver', e => { e.driver.commit.sha = 'd'.repeat(40); }, 'DRIVER_MOVED_OR_UNPROTECTED'],
  ['moving release source', e => { e.branch.commit.sha = 'd'.repeat(40); }, 'SOURCE_MOVED_OR_UNPROTECTED'],
  ['unprotected source', e => { e.branch.protected = false; }, 'SOURCE_MOVED_OR_UNPROTECTED'],
  ['author assertion', e => { e.comment.user.login = 'someone-else'; }, 'APPROVAL_AUTHOR_UNAUTHORIZED'],
  ['expired owner approval', e => { e.comment.body = e.comment.body.replace('13:00:00Z', '10:00:00Z'); }, 'APPROVAL_STALE_OR_INVALID'],
  ['wrong artifact approval', e => { e.comment.body = e.comment.body.replace('c'.repeat(64), 'd'.repeat(64)); }, 'APPROVAL_SCOPE_MISMATCH'],
  ['administrative bypass', e => { e.environment.can_admins_bypass = true; }, 'ENVIRONMENT_MISSING_OR_BYPASS_UNVERIFIED'],
  ['unverified bypass', e => { delete e.environment.can_admins_bypass; }, 'ENVIRONMENT_MISSING_OR_BYPASS_UNVERIFIED'],
  ['self approval', e => { e.environment.protection_rules[0].prevent_self_review = false; }, 'INDEPENDENT_ENVIRONMENT_REVIEW_REQUIRED'],
  ['missing environment', e => { e.environment = null; }, 'ENVIRONMENT_MISSING_OR_BYPASS_UNVERIFIED'],
  ['stale native status', e => { e.statuses.sha = 'd'.repeat(40); }, 'STATUS_NOT_EXACT_SUCCESS'],
  ['failed security check', e => { e.checks.check_runs[1].conclusion = 'failure'; }, 'CHECKS_NOT_EXACT_SUCCESS'],
  ['skipped check', e => { e.checks.check_runs[0].conclusion = 'skipped'; }, 'CHECKS_NOT_EXACT_SUCCESS'],
  ['wrong-SHA check', e => { e.checks.check_runs[0].head_sha = 'd'.repeat(40); }, 'CHECKS_NOT_EXACT_SUCCESS'],
  ['incomplete check pagination', e => { e.checks.total_count = 101; }, 'INCOMPLETE_CHECK_EVIDENCE'],
  ['missing required check', e => { e.checks.check_runs[1].name = 'Other'; }, 'REQUIRED_CHECK_MISSING'],
  ['stale store counter evidence', e => { e.manifest.baselines.ios.verifiedAt = '2026-10-20T11:00:00Z'; }, 'RELEASE_SOURCE_PREFLIGHT_FAILED'],
  ['source version mismatch', e => { e.sources.packageText = '{"version":"0.0.0"}'; }, 'RELEASE_SOURCE_PREFLIGHT_FAILED'],
]) test(`fails closed: ${name}`, () => {
  const { request, evidence } = fixture();
  mutate(evidence);
  assert.throws(() => validateEvidence(request, evidence, now), new RegExp(expectedCode));
});

test('rejects uninstalled/PR driver, injection, mutable source, invalid artifact and public operation', () => {
  for (const change of [
    { GITHUB_REF: 'refs/pull/1/merge' }, { GITHUB_REPOSITORY: 'other/repo' },
    { KEEPER_SOURCE_SHA: 'sprint' }, { KEEPER_VERSION: '2.6.5;echo secret' },
    { KEEPER_ARTIFACT_SHA256: 'pending' }, { KEEPER_OPERATION: 'public-release' },
  ]) {
    const { env } = fixture();
    assert.throws(() => requestFromEnvironment({ ...env, ...change }));
  }
});
