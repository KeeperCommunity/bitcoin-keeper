'use strict';
// Finite source/controller/execution identities. Selection is not authority:
// live protected refs, pins, Actions origin, native/security and custody gates
// still run for the selected actual repository. Never rewrite a GitHub context.
const PUBLIC = Object.freeze({ repository: 'KeeperCommunity/bitcoin-keeper',
  repositoryId: 470904030, private: false, parentProfile: 'r5-f0-normal-arm64-20261026',
  artifactAudience: 'GitHub Actions public-repository readers (14 days)' });
const PRIVATE = Object.freeze({ repository: 'KeeperCommunity/bitcoin-keeper-private',
  repositoryId: 839671816, private: true, parentProfile: 'r5-private-mobile-f0-normal-arm64-20261026',
  artifactAudience: 'GitHub Actions private-repository readers (14 days)' });
const profiles = Object.freeze({ [PUBLIC.repository]: PUBLIC, [PRIVATE.repository]: PRIVATE });
function forRepository(repository) {
  if (typeof repository !== 'string' || !Object.hasOwn(profiles, repository)) throw new Error('RELEASE_REPOSITORY_PROFILE_REQUIRED');
  return profiles[repository];
}
function forContext(context) {
  return forRepository(context?.repo?.owner + '/' + context?.repo?.repo);
}
function matches(value, profile) {
  // Preserve the existing public-run API contract. The alternate private route
  // additionally requires positive private visibility; missing is not private.
  return value?.id === profile.repositoryId && value.full_name === profile.repository &&
    (!profile.private || value.private === true);
}
function checkId(url, profile) {
  const prefix = 'https://api.github.com/repos/' + profile.repository + '/check-runs/';
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null;
  const value = url.slice(prefix.length);
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}
module.exports = { PUBLIC, PRIVATE, forRepository, forContext, matches, checkId };
