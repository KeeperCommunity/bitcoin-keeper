'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const evidence = require('../native/private_actions_software.cjs');
const { fixtureSoftware } = require('./fixtures/private-software.cjs');
const collect = f => evidence.collectPrivateActionsSoftware(f.github, f.expected,
  { clock: () => f.now, fetchImpl: f.fetchImpl });
test('actual original D13 ZIPs require authenticated two-platform Actions plus every raw software proof', async () => {
  const f = fixtureSoftware(), proof = await collect(f);
  assert.equal(evidence.isPrivateActionsSoftware(proof), true);
  assert.deepEqual(f.downloads, [1101, 1102]); assert.deepEqual(f.storageRequests, [1101, 1102]);
  assert.equal(Object.keys(proof.platforms.IOS.software.raw_sha256).length, 13);
  assert.equal(proof.platforms.ANDROID.software.cases.length, 5);
  assert.equal(Object.isFrozen(proof.platforms.IOS.software.raw_sha256), true);
  for (const field of ['native_acceptance', 'release_ready', 'authorization_eligible', 'execution_allowed', 'release_authorized'])
    assert.equal(proof[field], false);
  assert.equal(proof.installed_trust, 'UNVERIFIED');
  assert.equal(JSON.stringify(proof).includes('SYNTHETIC_ONLY'), false);
  for (const fake of [{ ...proof }, JSON.parse(JSON.stringify(proof)), { status: 'PASS' }]) {
    assert.equal(evidence.isPrivateActionsSoftware(fake), false);
    await assert.rejects(evidence.revalidatePrivateActionsSoftware(f.github, fake), /CAPABILITY_REQUIRED/);
  }
  assert.equal(await evidence.revalidatePrivateActionsSoftware(f.github, proof, { clock: () => f.now }), true);
});
test('correct digest and rebound receipt hashes do not excuse failed raw product or cleanup evidence', async () => {
  for (const mutate of [raw => raw.values[`app/artifacts/native/ios/metadata.json`].smoke = 'FAIL',
    raw => raw.values['control/artifacts/native-protected/mongo.json'].cleanup = 'FAIL',
    raw => raw.aggregate.barriers[2].resources.listeners[0].result = 'BOUND']) {
    const f = fixtureSoftware(); mutate(f.rawFixtures.IOS); f.rebuild('IOS');
    await assert.rejects(collect(f), /^Error: PRIVATE_SOFTWARE_COLLECTION_INVALID$/);
  }
});
test('valid ZIP and digest preserve contradictory original duplicate keys for strict raw rejection', async () => {
  const f = fixtureSoftware(), members = f.rawFixtures.IOS.rebind(), name = 'control/artifacts/native-integration/ios/startup.json';
  members[name] = Buffer.from('{"smoke":"FAIL",' + members[name].toString().slice(1));
  f.rebuild('IOS', f.rawFixtures.IOS.rebind({ [name]: members[name] }));
  await assert.rejects(collect(f), /^Error: PRIVATE_SOFTWARE_COLLECTION_INVALID$/);
});
test('wrong platform, extra member and mutated ZIP bytes never reach a software proof', async () => {
  for (const change of [f => f.rebuild('IOS', f.rawFixtures.ANDROID.rebind()),
    f => f.rebuild('IOS', { ...f.rawFixtures.IOS.rebind(), '../private.txt': Buffer.from('SYNTHETIC_ONLY') }),
    f => f.archives[1101][0] ^= 1]) {
    const f = fixtureSoftware(); change(f);
    await assert.rejects(collect(f), /^Error: PRIVATE_SOFTWARE_(?:ARCHIVE_MEMBERS_INVALID|ARTIFACT_DIGEST_MISMATCH)$/);
  }
});
for (const [name, change] of Object.entries({
  firstArtifactExpires: f => f.artifacts[1101].expired = true,
  firstArtifactDigestMoves: f => f.artifacts[1101].digest = `sha256:${'f'.repeat(64)}`,
  firstAttemptMoves: f => f.runs[1001].run_attempt++,
  firstCleanupFails: f => f.jobs[1001][0].steps.find(s => s.name.startsWith('Remove only')).conclusion = 'failure',
  repositoryBecomesPublic: f => f.privateRepo.private = false,
  latestRunFails: f => f.runs[1001].conclusion = 'failure',
})) test(`second download invalidates earlier origin: ${name}`, async () => {
  const f = fixtureSoftware(); f.afterStorage = id => { if (id === 1102) change(f); };
  await assert.rejects(collect(f), /^Error: PRIVATE_(?:SOFTWARE|ACTIONS)_[A-Z_]+$/);
});
test('caller mutation during collection cannot select different independent expected identities', async () => {
  const f = fixtureSoftware(); f.afterStorage = () => { f.expected.IOS.execution.runId = 9999; };
  const proof = await collect(f);
  assert.equal(proof.platforms.IOS.software.identity.execution.runId, 1001);
});
