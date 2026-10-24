const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule, image, makeImage } = require('./helpers.cjs');
const { RealmSchema } = loadModule('src/storage/realm/enum.ts');
const XpubTypes = Object.fromEntries(['AMF', 'P2PKH', 'P2SH-P2WPKH', 'P2SH-P2WSH', 'P2TR', 'P2WPKH', 'P2WSH'].map(type => [type, type]));
const schemas = loadModule('src/storage/realm/schema/vault.ts', {
  '../enum': { RealmSchema }, 'src/services/wallets/enums': { XpubTypes },
});
// Use the real storage schema defaults without requiring a native Realm binary
// in CI. The native validation additionally checks an actual Realm round trip.
const emptyScriptLists = Object.fromEntries(Object.keys(schemas.SignerXpubsSchema.properties).map(type => [type, []]));
const signer = { masterFingerprint: '12345678', type: 'MOBILE_KEY', networkType: 'TESTNET', signerXpubs: {
  P2WSH: [{ xpub: 'disposable-xpub', derivationPath: "m/48'/1'/0'/2'" }],
}};
function pair() {
  const local = makeImage(), remote = makeImage();
  remote.signers.key = structuredClone(signer);
  local.signers.key = { ...structuredClone(signer), signerXpubs: { ...emptyScriptLists, P2WSH: [{ ...signer.signerXpubs.P2WSH[0], xpriv: null }] } };
  return { local, remote };
}
test('Realm empty script lists and absent optional private key do not block backup repair', async () => {
  const { local, remote } = pair();
  assert.equal(await image.compareImages(local, remote), 'different');
  assert.equal(await image.compareImages(local, structuredClone(local)), 'matched');
});
for (const field of ['xpub', 'derivationPath', 'xpriv']) {
  test(`a changed signer ${field} remains a conflict`, async () => {
    const { local, remote } = pair();
    local.signers.key.signerXpubs.P2WSH[0][field] = 'different-key-material';
    assert.equal(await image.compareImages(local, remote), 'conflict');
  });
}
test('a populated script group must not be discarded as a Realm default', async () => {
  const { local, remote } = pair();
  local.signers.key.signerXpubs.P2TR = [{ xpub: 'another-xpub', derivationPath: "m/86'/1'/0'" }];
  assert.equal(await image.compareImages(local, remote), 'conflict');
});
