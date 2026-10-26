'use strict';
// Synthetic official API/ZIP contracts only. No native run or release credit.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const repositories = require('../native/release_repository_profiles.cjs');
const canonical = require('../native/canonical_native.cjs');
const parent = require('../native/installed_parent_software.cjs');
const window = require('../native/installed_parent_window.cjs');
const privateOrigin = require('../native/private_actions_origin.cjs');
const privateSoftware = require('../native/private_actions_software.cjs');
const { canonicalFixture, withWindow } = require('./fixtures/installed-parent.cjs');
const { fixture, PRIVATE: RELAY, WORKFLOW } = require('./fixtures/private-actions.cjs');
const { fixtureSoftware } = require('./fixtures/private-software.cjs');
const { WORKER_SOURCES } = require('../native/public_software_receipts.cjs');
const { PRIVATE, PUBLIC } = repositories;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// Separate SDK closures enforce actual repository scopes. These do not rewrite
// API URLs, context, metadata, IDs or repository names on their way to a gate.
function splitReaders(f) {
  const source = { rest: {} };
  for (const [group, endpoints] of Object.entries(f.github.rest)) {
    source.rest[group] = {};
    for (const [name, endpoint] of Object.entries(endpoints)) {
      source.rest[group][name] = async args => {
        assert.equal(args.repo, 'bitcoin-keeper-private', 'app reader crossed its repository');
        return endpoint(args);
      };
      f.github.rest[group][name] = async args => {
        assert.equal(args.repo, 'bitcoin-keeper-relay', 'Relay reader accessed private app contents');
        return endpoint(args);
      };
    }
  }
  return source;
}

function nativeFixture() {
  const p = withWindow(canonicalFixture({ profile: PRIVATE }));
  const f = fixtureSoftware({ appTree: 'c'.repeat(40), appProfile: PRIVATE });
  const appReader = splitReaders(f);
  p.window.profile = PRIVATE.parentProfile;
  p.window.app = structuredClone(f.expected.IOS.app);
  p.window.private = structuredClone(f.expected);
  p.github.rest.repos.getContent = appReader.rest.repos.getContent;
  p.github.rest.git.getTree = appReader.rest.git.getTree;
  for (const [group, name] of [['repos', 'get'], ['git', 'getCommit']]) {
    const endpoint = p.github.rest[group][name];
    p.github.rest[group][name] = async args => ({ status: 200, headers: {}, ...await endpoint(args) });
  }
  p.workerSources = Object.entries(WORKER_SOURCES).map(([name, names]) => ({ path: name,
    names: [...names], sha256: hash(f.files[`${PRIVATE.repository}:${p.request.sourceSha}`][name]) }));
  for (const platform of ['IOS', 'ANDROID'])
    p.metadata[platform].r5_feature_evidence.source_functions = structuredClone(p.workerSources);
  p.archives = Object.values(p.metadata).map(value => Buffer.from(JSON.stringify(value)));
  for (const [i, artifact] of p.artifacts.entries()) Object.assign(artifact,
    { digest: `sha256:${hash(p.archives[i])}`, size_in_bytes: p.archives[i].length });
  return { p, f };
}
async function collect({ p, f }) {
  const proof = await canonical.collectInstalledPublicEvidence(p.github, p.context, p.request,
    bytes => bytes, { pinReader: p.pinReader });
  const parents = await parent.collectInstalledParentSoftware(f.github, p.github, p.context, p.request,
    proof, { pinReader: p.pinReader, fetchImpl: f.fetchImpl, clock: () => f.now });
  return { proof, parents, platforms: parent.projectInstalledParentCases(proof, parents) };
}

test('finite repository profiles reject aliases, coercion and arbitrary identities', () => {
  assert.equal(repositories.forRepository(PUBLIC.repository), PUBLIC);
  assert.equal(repositories.forRepository(PRIVATE.repository), PRIVATE);
  for (const value of [undefined, null, [PRIVATE.repository], new String(PRIVATE.repository),
    'KeeperCommunity/bitcoin-keeper-relay', 'keepercommunity/bitcoin-keeper-private', '__proto__'])
    assert.throws(() => repositories.forRepository(value), /PROFILE_REQUIRED/);
  assert.equal(Object.isFrozen(PRIVATE), true);
  assert.equal(repositories.matches({ id: PRIVATE.repositoryId, full_name: PRIVATE.repository }, PRIVATE), false);
  assert.equal(repositories.checkId('https://api.github.com/repos/' + PUBLIC.repository + '/check-runs/1', PRIVATE), null);
  assert.equal(repositories.checkId('https://api.github.com/repos/' + PRIVATE.repository + '/check-runs/1?alias=public', PRIVATE), null);
});

test('actual finite private profile composes all seven exact native cases with separate app and Relay readers', async () => {
  const state = nativeFixture(), result = await collect(state);
  assert.equal(result.proof.repository, PRIVATE.repository);
  assert.equal(result.parents.app.repository, PRIVATE.repository);
  assert.equal(canonical.isInstalledPublicEvidence(result.proof), true);
  assert.equal(parent.isInstalledParentSoftware(result.parents), true);
  for (const platform of ['IOS', 'ANDROID']) {
    assert.equal(result.platforms[platform].cases.length, 7);
    assert(result.platforms[platform].cases.every(row => row.status === 'PASS'));
    assert.equal(Object.keys(result.parents.platforms[platform].original_member_sha256).length, 13);
  }
  for (const field of ['native_acceptance', 'release_ready', 'authorization_eligible', 'execution_allowed', 'release_authorized'])
    assert.equal(result.parents[field], false);
  assert.equal(parent.isInstalledParentSoftware(structuredClone(result.parents)), false);
  assert(state.f.calls.some(row => row.args.repo === 'bitcoin-keeper-private' && row.name === 'source'));
  assert(state.f.calls.some(row => row.args.repo === 'bitcoin-keeper-relay' && row.name === 'artifact'));
});

for (const [name, mutate] of Object.entries({
  wrongRepositoryId: ({ p }) => p.repository.id = PUBLIC.repositoryId,
  publicVisibility: ({ p }) => p.repository.private = false,
  missingVisibility: ({ p }) => delete p.repository.private,
  runPublicId: ({ p }) => p.run.repository.id = PUBLIC.repositoryId,
  runPublicVisibility: ({ p }) => p.run.repository.private = false,
  headPublicVisibility: ({ p }) => p.run.head_repository.private = false,
  publicCheckURL: ({ p }) => p.jobs[0].check_run_url = p.jobs[0].check_run_url.replace(PRIVATE.repository, PUBLIC.repository),
  publicWorkflowRef: ({ p }) => p.request.workflowRef = p.request.workflowRef.replace(PRIVATE.repository, PUBLIC.repository),
  wrongProfile: ({ p }) => p.window.profile = PUBLIC.parentProfile,
  wrongAppRepository: ({ p }) => p.window.app.repository = PUBLIC.repository,
  unprotected: ({ p }) => p.branch.protected = false,
  movedPin: ({ p }) => p.pin.value = 'e'.repeat(40),
  privateNativeFailure: ({ f }) => f.jobs[1001][0].steps.find(step => step.name === 'Build one unsigned development native candidate').conclusion = 'failure',
  artifactExpiry: ({ f }) => f.artifacts[1101].expired = true,
  wrongSourceTransport: ({ f }) => f.jobs[1001][0].steps.find(step => step.name === 'Fetch fixed private app with scoped read identity').name = 'Fetch fixed public app anonymously',
})) test(`private installed native profile rejects ${name}`, async () => {
  const state = nativeFixture(); mutate(state);
  await assert.rejects(collect(state));
});

test('private source origin cannot borrow the Relay reader or a copied public source descriptor', async () => {
  const f = fixture({ appProfile: PRIVATE }), source = splitReaders(f);
  for (const appGithub of [undefined, f.github, {}])
    await assert.rejects(privateOrigin.authenticatePrivateActionsOrigins(f.github, f.expected,
      { clock: () => f.now, appGithub }), /PRIVATE_ACTIONS_APP_READ_IDENTITY_REQUIRED/);
  const proof = await privateOrigin.authenticatePrivateActionsOrigins(f.github, f.expected,
    { clock: () => f.now, appGithub: source });
  assert.equal(privateOrigin.isPrivateActionsOrigin(proof), true);
  f.expected.IOS.app.repository = PUBLIC.repository;
  await assert.rejects(privateOrigin.authenticatePrivateActionsOrigins(f.github, f.expected,
    { clock: () => f.now, appGithub: source }));
});

test('private source visibility is rechecked after artifact work and after capability issue', async () => {
  const f = fixtureSoftware({ appProfile: PRIVATE }), source = splitReaders(f);
  const options = { clock: () => f.now, fetchImpl: f.fetchImpl, appGithub: source };
  const proof = await privateSoftware.collectPrivateActionsSoftware(f.github, f.expected, options);
  f.appRepo.private = false;
  await assert.rejects(privateSoftware.revalidatePrivateActionsSoftware(f.github, proof,
    { clock: () => f.now }), /PRIVATE_ACTIONS_REPOSITORY_INVALID/);
  f.appRepo.private = true;
  f.afterStorage = id => { if (id === 1102) f.appRepo.private = false; };
  await assert.rejects(privateSoftware.collectPrivateActionsSoftware(f.github, f.expected, options),
    /PRIVATE_ACTIONS_REPOSITORY_INVALID/);
});

for (const [name, mutate] of Object.entries({
  publicRepository: text => text.replace('repository: KeeperCommunity/bitcoin-keeper-private', 'repository: KeeperCommunity/bitcoin-keeper'),
  movedRef: text => text.replace('ref: ' + 'a'.repeat(40), 'ref: sprint'),
  unpinnedAction: text => text.replace('actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803', 'actions/checkout@v6'),
  persistedCredential: text => text.replace('persist-credentials: false', 'persist-credentials: true'),
  missingHistoricalSource: text => text.replace('fetch-depth: 0', 'fetch-depth: 1'),
  wrongCredential: text => text.replace('KEEPER_PRIVATE_APP_CONTENTS_READ_TOKEN', 'GITHUB_TOKEN'),
  duplicateCheckout: text => text + text.slice(text.indexOf('      - name:')),
})) test(`private native source transport rejects ${name} despite rebound raw Git hashes`, async () => {
  const f = fixture({ appProfile: PRIVATE }), source = splitReaders(f);
  for (const platform of ['IOS', 'ANDROID']) {
    const sha = f.expected[platform].control.sha;
    f.rebind(RELAY, sha, WORKFLOW, Buffer.from(mutate(f.files[`${RELAY}:${sha}`][WORKFLOW].toString())));
  }
  await assert.rejects(privateOrigin.authenticatePrivateActionsOrigins(f.github, f.expected,
    { clock: () => f.now, appGithub: source }), /PRIVATE_ACTIONS_APP_SELECTION_INVALID/);
});

test('private parent profile cannot be selected for the public controller', async () => {
  const f = withWindow(canonicalFixture()); f.window.profile = PRIVATE.parentProfile;
  await assert.rejects(window.authenticateInstalledParentWindow(f.github, f.context, f.request,
    { pinReader: f.pinReader }), /INSTALLED_PARENT_PROFILE_REQUIRED/);
});
