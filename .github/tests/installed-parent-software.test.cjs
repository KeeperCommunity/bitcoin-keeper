'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { createRequire } = require('node:module');
const canonical = require('../native/canonical_native.cjs');
const actual = require('../native/installed_parent_software.cjs');
const { canonicalFixture, withWindow, loadWindow } = require('./fixtures/installed-parent.cjs');
const { fixtureSoftware } = require('./fixtures/private-software.cjs');
const { WORKER_SOURCES } = require('../native/public_software_receipts.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function loadSimulatedInstalledCollector() {
  const file = path.resolve(__dirname, '../native/installed_parent_software.cjs'), originalRequire = createRequire(file);
  const admitted = loadWindow(), module = { exports: {} };
  // Explicit synthetic source copy, matching the existing installed-policy controls.
  // No production option can populate the empty committed profile.
  new Function('require', 'module', fs.readFileSync(file, 'utf8'))(name =>
    name === './installed_parent_window.cjs' ? admitted : originalRequire(name), module);
  return module.exports;
}
async function fixture() {
  const p = withWindow(canonicalFixture()), f = fixtureSoftware({ appTree: 'c'.repeat(40) });
  p.window.app = structuredClone(f.expected.IOS.app); p.window.private = structuredClone(f.expected);
  p.sourceBytes = Object.fromEntries(Object.keys(WORKER_SOURCES).map(name => [name,
    fs.readFileSync(path.resolve(__dirname, '../..', name))]));
  p.workerSources = Object.entries(WORKER_SOURCES).map(([name, names]) => ({ path: name,
    names: [...names], sha256: hash(p.sourceBytes[name]) }));
  for (const platform of ['IOS', 'ANDROID'])
    p.metadata[platform].r5_feature_evidence.source_functions = structuredClone(p.workerSources);
  p.archives = Object.values(p.metadata).map(value => Buffer.from(JSON.stringify(value)));
  for (const [i, artifact] of p.artifacts.entries()) Object.assign(artifact,
    { digest: `sha256:${hash(p.archives[i])}`, size_in_bytes: p.archives[i].length });
  const proof = await canonical.collectInstalledPublicEvidence(p.github, p.context, p.request, raw => raw,
    { pinReader: p.pinReader });
  return { p, f, proof };
}
const collect = (driver, { p, f, proof }) => driver.collectInstalledParentSoftware(f.github, p.github,
  p.context, p.request, proof, { pinReader: p.pinReader, fetchImpl: f.fetchImpl, clock: () => f.now });
test('committed empty profile blocks all real parent collection before private API or download', async () => {
  const f = await fixture();
  await assert.rejects(collect(actual, f), /^Error: INSTALLED_PARENT_PROFILE_REQUIRED$/);
  assert.deepEqual(f.f.calls, []); assert.deepEqual(f.f.downloads, []);
});
test('forged public or parent labels cannot enter composition', async () => {
  const f = await fixture(), driver = loadSimulatedInstalledCollector();
  for (const proof of [{ status: 'PASS' }, { ...f.proof }, JSON.parse(JSON.stringify(f.proof))]) {
    await assert.rejects(collect(driver, { ...f, proof }), /PUBLIC_CAPABILITY_REQUIRED/);
    assert.throws(() => driver.projectInstalledParentCases(f.proof, { status: 'PASS' }), /CAPABILITIES_REQUIRED/);
  }
  assert.deepEqual(f.f.calls, []);
});
test('synthetic installed source composes actual public proof and original private D13 facts for one app', async () => {
  const f = await fixture(), driver = loadSimulatedInstalledCollector(), parents = await collect(driver, f);
  assert.equal(driver.isInstalledParentSoftware(parents), true);
  assert.equal(actual.isInstalledParentSoftware(parents), false, 'synthetic installation is not production policy');
  const platforms = driver.projectInstalledParentCases(f.proof, parents);
  for (const platform of ['IOS', 'ANDROID']) {
    assert.equal(platforms[platform].cases.length, 7);
    assert(platforms[platform].cases.every(row => row.status === 'PASS'));
    assert.deepEqual(Object.keys(platforms[platform]).sort(),
      ['artifact_id', 'cases', 'conclusion', 'executed_checks', 'receipt_sha256']);
    assert.equal(platforms[platform].receipt_sha256, f.proof.platforms[platform].receipt_sha256);
    assert.equal(Object.keys(parents.platforms[platform].original_member_sha256).length, 13);
  }
  for (const field of ['native_acceptance', 'release_ready', 'authorization_eligible', 'execution_allowed', 'release_authorized'])
    assert.equal(parents[field], false);
  assert.equal(JSON.stringify(platforms).includes('PRIVATE_SENTINEL'), false);
  for (const fake of [{ ...parents }, structuredClone(parents)])
    assert.throws(() => driver.projectInstalledParentCases(f.proof, fake), /CAPABILITIES_REQUIRED/);
  assert.equal(f.p.windowReads, 3, 'initial manifest and repeated public fences after private work');
});
test('private client has no implicit ordinary-token fallback', async () => {
  const f = await fixture(), driver = loadSimulatedInstalledCollector();
  for (const github of [undefined, f.p.github, {}]) await assert.rejects(driver.collectInstalledParentSoftware(github,
    f.p.github, f.p.context, f.p.request, f.proof, { pinReader: f.p.pinReader }), /PRIVATE_READ_IDENTITY_REQUIRED/);
  assert.deepEqual(f.f.calls, []);
});
test('workflow private reader consumes its scoped credential before a client or subprocess can inherit it', () => {
  const env = { KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN: 'DISPOSABLE_PRIVATE_READ_IDENTITY' };
  const expected = env.KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN;
  class Client {
    constructor(options) {
      assert.equal(env.KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN, undefined);
      assert.deepEqual(options, { auth: expected }); this.disposable = true;
    }
  }
  assert.equal(canonical.privateReaderFromEnvironment({ constructor: Client }, env).disposable, true);
  assert.deepEqual(env, {});
  for (const token of [undefined, '']) {
    const empty = { KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN: token };
    assert.equal(canonical.privateReaderFromEnvironment({}, empty), undefined); assert.deepEqual(empty, {});
  }
  const malformed = { KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN: ['coercible'] };
  assert.throws(() => canonical.privateReaderFromEnvironment({}, malformed), /PRIVATE_ACTIONS_READ_IDENTITY_INVALID/);
  assert.deepEqual(malformed, {});
});
test('revoked public driver pin or changed atomic manifest during private download rejects all parents', async () => {
  for (const mutate of [x => x.p.pin.value = '', x => x.p.rawWindow = JSON.stringify(x.p.window) + ' ']) {
    const f = await fixture(), driver = loadSimulatedInstalledCollector();
    f.f.afterStorage = id => { if (id === 1102) mutate(f); };
    await assert.rejects(collect(driver, f), /^Error: INSTALLED_PARENT_[A-Z_]+$/);
  }
});
test('private artifact expiry during later public manifest read rejects the whole composition', async () => {
  const f = await fixture(), driver = loadSimulatedInstalledCollector(), original = f.p.pinReader.rest.actions.getRepoVariable;
  f.p.pinReader.rest.actions.getRepoVariable = async args => {
    const result = await original(args);
    if (args.name === 'KEEPER_CANONICAL_PRIVATE_WINDOW_JSON' && f.p.windowReads === 2) f.f.artifacts[1101].expired = true;
    return result;
  };
  await assert.rejects(collect(driver, f), /PRIVATE_ACTIONS_ARTIFACT_INVALID/);
});
test('canonical collection cannot issue parent credit with an explicit client and empty installed policy', async () => {
  const f = await fixture(), output = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-no-installed-parent-'));
  try {
    fs.writeFileSync(path.join(output, 'keeper-canonical-native-attestation.json'), 'stale');
    await assert.rejects(canonical.collect(f.p.github, f.p.context, f.p.request, output, raw => raw,
      { pinReader: f.p.pinReader, privateGithub: f.f.github, clock: () => f.f.now, fetchImpl: f.f.fetchImpl }),
    /INSTALLED_PARENT_PROFILE_REQUIRED/);
    assert.equal(fs.existsSync(path.join(output, 'keeper-canonical-native-attestation.json')), false);
    assert.deepEqual(f.f.calls, []);
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});
