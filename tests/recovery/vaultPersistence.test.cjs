const assert = require('node:assert/strict');
const { test } = require('node:test');
const { image, loadModule, makeImage } = require('./helpers.cjs');
const { RealmSchema } = loadModule('src/storage/realm/enum.ts');
const schemas = loadModule('src/storage/realm/schema/vault.ts', {
  '../enum': { RealmSchema }, 'src/services/wallets/enums': { XpubTypes: {} },
});
function pair() {
  assert.equal(schemas.MiniscriptKeyInfoSchema.properties.uniqueKeyIdentifier, 'string?');
  assert.equal(schemas.MiniscriptPhaseSchema.properties.probability, undefined);
  const key = { identifier: 'K1', descriptor: 'disposable-descriptor' };
  const remote = makeImage(), local = makeImage();
  remote.vaults.vault = { id: 'vault', networkType: 'TESTNET', scriptType: 'P2WSH', signers: [],
    scheme: { m: 1, n: 1, miniscriptScheme: {
      usedMiniscriptTypes: ['TIMELOCKED'], miniscriptPolicy: 'and(after(155000),pk(K1))',
      miniscript: 'and_v(v:pk(K1),after(155000))',
      miniscriptElements: { keysInfo: [key], phases: [{ id: 1, timelock: 155000,
        probability: 99, requiredPaths: 1, paths: [{ id: 1, threshold: 1, keys: [{ ...key, uniqueKeyIdentifier: 'K1<0;1>' }] }] }] },
    } }, specs: {} };
  local.vaults.vault = structuredClone(remote.vaults.vault);
  const elements = local.vaults.vault.scheme.miniscriptScheme.miniscriptElements;
  elements.keysInfo[0].uniqueKeyIdentifier = null;
  delete elements.phases[0].probability;
  return { local, remote };
}
test('new enhanced vault remains repairable after Realm normalizes policy metadata', async () => {
  const { local, remote } = pair();
  assert.equal(await image.compareImages(local, remote), 'different');
  assert.equal(await image.compareImages(local, structuredClone(local)), 'matched');
});
for (const [name, mutate] of [
  ['primary timelock', s => { s.miniscriptElements.phases[0].timelock = 0; }],
  ['key descriptor', s => { s.miniscriptElements.keysInfo[0].descriptor = 'changed'; }],
  ['path key identifier', s => { s.miniscriptElements.phases[0].paths[0].keys[0].uniqueKeyIdentifier = 'K2<0;1>'; }],
  ['compiled policy', s => { s.miniscriptPolicy = 'pk(K1)'; }],
  ['compiled script', s => { s.miniscript = 'pk(K1)'; }],
]) {
  test(`changed ${name} still blocks automatic replacement`, async () => {
    const { local, remote } = pair();
    mutate(local.vaults.vault.scheme.miniscriptScheme);
    assert.equal(await image.compareImages(local, remote), 'conflict');
  });
}
test('phase weights remain significant when no compiled policy is available', async () => {
  const { local, remote } = pair();
  delete local.vaults.vault.scheme.miniscriptScheme.miniscriptPolicy;
  delete remote.vaults.vault.scheme.miniscriptScheme.miniscriptPolicy;
  assert.equal(await image.compareImages(local, remote), 'conflict');
});
