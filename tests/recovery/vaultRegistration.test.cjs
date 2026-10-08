const assert = require('node:assert/strict');
const { test } = require('node:test');
const { encryption, harness, image, makeImage } = require('./helpers.cjs');

const clone = (value) => JSON.parse(JSON.stringify(value));
const key = {
  masterFingerprint: 'AABBCCDD',
  xfp: 'AABBCCDD',
  xpub: 'disposable-xpub',
  derivationPath: "m/48'/1'/0'/2'",
  registeredVaults: [{ vaultId: 'first', registered: false }],
};
const vault = (id) => ({
  id,
  networkType: 'TESTNET',
  scriptType: 'P2WSH',
  scheme: { m: 1, n: 1 },
  signers: [clone(key)],
  specs: {},
});

function registrationFixture({ incompleteReadback = false, afterSnapshot, afterUpload } = {}) {
  const state = {
    appImage: {
      appId: 'disposable', wallets: {}, signers: {}, nodes: [],
      vaults: ['first', 'second'], labels: [],
    },
    allVaultImages: [], labels: [], revision: 'a'.repeat(64),
  };
  let uploads = 0;
  let snapshotReads = 0;
  const f = harness({ adapter: async (endpoint, payload) => {
    if (endpoint === 'getBackupSnapshot') {
      snapshotReads++;
      if (afterSnapshot) await afterSnapshot(snapshotReads);
      return { data: clone(state) };
    }
    assert.equal(endpoint, 'repairAppBackup');
    assert.equal(payload.expectedRevision, state.revision);
    assert.equal(payload.replaceCurrentState, true);
    uploads++;
    Object.assign(state.appImage, {
      wallets: payload.walletObject,
      signers: payload.signersObject,
      nodes: payload.nodes,
      vaults: Object.keys(payload.vaultObject),
      labels: payload.labels.map((label) => label.id),
    });
    state.allVaultImages = Object.values(payload.vaultObject);
    if (incompleteReadback) state.allVaultImages.pop();
    state.labels = payload.labels;
    state.revision = 'b'.repeat(64);
    if (afterUpload) await afterUpload();
    return { data: { updated: true } };
  } });
  const cipherKey = encryption.generateEncryptionKey(f.app.primarySeed);
  for (const id of state.appImage.vaults) {
    const record = vault(id);
    f.local.Vault.push(clone(record));
    state.allVaultImages.push({
      vaultId: id, vault: encryption.encrypt(cipherKey, JSON.stringify(record)),
      isArchived: false,
    });
  }
  const registeredVaults = [
    { vaultId: 'first', registered: true, hmac: 'disposable-hmac' },
    { vaultId: 'second', registered: true, registrationInfo: 'disposable-info' },
  ];
  f.local.VaultSigner.push({ ...clone(key), registeredVaults });
  return { f, state, cipherKey, registeredVaults, uploads: () => uploads };
}

test('persisted registration repairs every affected vault only after explicit action and readback', async () => {
  const { f, state, cipherKey, registeredVaults, uploads } = registrationFixture();
  assert.equal(await f.run(), 'different');
  assert.equal(uploads(), 0);
  assert.deepEqual(f.calls, ['getBackupSnapshot']);

  assert.equal(await f.run(true), 'verified');
  assert.equal(uploads(), 1);
  assert.deepEqual(f.calls, [
    'getBackupSnapshot', 'getBackupSnapshot', 'repairAppBackup', 'getBackupSnapshot',
  ]);
  for (const encrypted of state.allVaultImages) {
    const record = JSON.parse(encryption.decrypt(cipherKey, encrypted.vault));
    assert.deepEqual(record.signers[0].registeredVaults, registeredVaults);
    assert.equal(record.signers[0].xpub, key.xpub);
  }
  // Repair uses persisted metadata in its image without mutating vault records.
  for (const record of f.local.Vault)
    assert.deepEqual(record.signers[0].registeredVaults, key.registeredVaults);
});

test('an incomplete registration repair readback cannot be marked verified', async () => {
  const { f, uploads } = registrationFixture({ incompleteReadback: true });
  assert.equal(await f.run(true), 'unverified');
  assert.equal(uploads(), 1);
  assert.deepEqual(f.calls, ['getBackupSnapshot', 'repairAppBackup', 'getBackupSnapshot']);
});

test('account switch after registration snapshot prevents an upload for the old account', async () => {
  let fixture;
  fixture = registrationFixture({ afterSnapshot: (read) => {
    if (read === 1) fixture.f.app.id = 'other-disposable-account';
  } });
  assert.equal(await fixture.f.run(true), 'unverified');
  assert.equal(fixture.uploads(), 0);
  assert.deepEqual(fixture.f.calls, ['getBackupSnapshot']);
  assert.ok(!fixture.f.phases.includes('verified'));
});

test('account switch after registration upload cannot claim a verified repair', async () => {
  let fixture;
  fixture = registrationFixture({ afterUpload: () => {
    fixture.f.app.id = 'other-disposable-account';
  } });
  assert.equal(await fixture.f.run(true), 'unverified');
  assert.equal(fixture.uploads(), 1, 'the upload was for the original account');
  assert.deepEqual(fixture.f.calls, ['getBackupSnapshot', 'repairAppBackup', 'getBackupSnapshot']);
  assert.ok(!fixture.f.phases.includes('verified'));
});

test('registration-only drift is a difference while vault key and policy drift remain conflicts', async () => {
  const local = makeImage(), remote = makeImage();
  local.vaults.first = vault('first');
  remote.vaults.first = clone(local.vaults.first);
  local.vaults.first.signers[0].registeredVaults[0].registered = true;
  assert.equal(await image.compareImages(local, remote), 'different');
  for (const mutate of [
    (record) => { record.signers[0].xpub = 'changed-xpub'; },
    (record) => { record.signers[0].derivationPath = "m/48'/1'/1'/2'"; },
    (record) => { record.networkType = 'MAINNET'; },
    (record) => { record.scriptType = 'P2SH'; },
    (record) => { record.scheme.m = 2; },
  ]) {
    const changed = clone(local);
    mutate(changed.vaults.first);
    assert.equal(await image.compareImages(changed, remote), 'conflict');
  }
});
