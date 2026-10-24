const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encryption, image, harness, wallet, loadModule } = require('./helpers.cjs');
const { prepareRecoveryImage } = loadModule('src/services/backup/restore.ts', { './image': image });
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture({
  unavailable = ['shared'],
  leaveUnavailable = false,
  ackRevision = 'valid',
} = {}) {
  const state = {
    appImage: {
      appId: 'disposable',
      wallets: {},
      signers: {},
      nodes: [],
      vaults: ['shared'],
      labels: [],
    },
    allVaultImages: [],
    labels: [],
    unavailableVaultIds: unavailable,
    revision: 'a'.repeat(64),
    revisionedMutations: true,
  };
  let uploads = 0;
  const f = harness({
    adapter: async (endpoint, payload) => {
      if (endpoint === 'getBackupSnapshot') return { data: clone(state) };
      assert.equal(endpoint, 'revisionedBackupMutation');
      assert.equal(payload.operation, 'repairAppBackup');
      assert.equal(payload.expectedRevision, state.revision);
      assert.equal(payload.replaceCurrentState, true);
      uploads++;
      Object.assign(state.appImage, {
        publicId: payload.publicId,
        version: payload.version,
        subscription: payload.subscription,
        wallets: payload.walletObject,
        signers: payload.signersObject,
        nodes: payload.nodes,
        vaults: Object.keys(payload.vaultObject),
        labels: payload.labels.map((v) => v.id),
      });
      state.allVaultImages = Object.values(payload.vaultObject);
      state.labels = payload.labels;
      if (!leaveUnavailable) state.unavailableVaultIds = [];
      state.revision = 'b'.repeat(64);
      const replyRevision =
        ackRevision === 'valid'
          ? state.revision
          : ackRevision === 'missing'
          ? undefined
          : ackRevision === 'old'
          ? 'a'.repeat(64)
          : ackRevision === 'other'
          ? 'c'.repeat(64)
          : 'invalid';
      return { data: { updated: true, preconditionApplied: true, newRevision: replyRevision } };
    },
  });
  Object.assign(state.appImage, {
    publicId: f.app.publicId,
    version: f.app.version,
    subscription: JSON.stringify(f.app.subscription),
  });
  f.local.Vault.push({ ...wallet('shared'), signers: [], scheme: { m: 1, n: 1 }, archived: false });
  const key = encryption.generateEncryptionKey(f.app.primarySeed);
  return { f, state, key, uploads: () => uploads };
}
test('unavailable collaborative ciphertext requires user action and cannot be clean-restored', async () => {
  const { f, state, key, uploads } = fixture();
  assert.equal(await f.run(), 'different');
  assert.equal(uploads(), 0);
  assert.deepEqual(f.calls, ['getBackupSnapshot']);
  await assert.rejects(
    prepareRecoveryImage(key, f.app.id, state.appImage, state.allVaultImages, state.labels)
  );
});
test('explicit local resubmission replaces missing account copy and verifies clean recovery', async () => {
  const { f, state, key, uploads } = fixture();
  assert.equal(await f.run(true), 'verified');
  assert.equal(uploads(), 1);
  assert.deepEqual(state.unavailableVaultIds, []);
  const recovered = await prepareRecoveryImage(
    key,
    f.app.id,
    state.appImage,
    state.allVaultImages,
    state.labels
  );
  assert.deepEqual(clone(recovered.vaults.shared), f.local.Vault[0]);
  assert.deepEqual(f.calls, ['getBackupSnapshot', 'revisionedBackupMutation', 'getBackupSnapshot']);
});
test('missing server-only vault blocks current-state replacement', async () => {
  const { f, state, uploads } = fixture();
  f.local.Vault.length = 0;
  assert.equal(await f.run(), 'different');
  assert.equal(uploads(), 0);
  assert.equal(await f.run(true), 'conflict');
  assert.deepEqual(state.appImage.vaults, ['shared']);
  assert.equal(uploads(), 0);
});
for (const problem of ['identity', 'ahead address counter'])
  test(`available ${problem} conflict still blocks missing-copy repair`, async () => {
    const { f, state, key, uploads } = fixture();
    f.local.Wallet.push(wallet('other'));
    const remote = wallet('other');
    if (problem === 'identity') remote.specs.xpub = 'another-key';
    else remote.specs.nextFreeAddressIndex = 2;
    state.appImage.wallets.other = encryption.encrypt(key, JSON.stringify(remote));
    assert.equal(await f.run(true), 'conflict');
    assert.equal(uploads(), 0);
  });
for (const unavailable of [['not-referenced'], ['shared', 'shared'], [null], 'shared'])
  test(`malformed missing-copy metadata cannot authorize an upload: ${JSON.stringify(
    unavailable
  )}`, async () => {
    const { f, uploads } = fixture({ unavailable });
    assert.equal(await f.run(true), 'unverified');
    assert.equal(uploads(), 0);
  });
test('an acknowledged upload that still has unavailable vaults is never verified', async () => {
  const { f, uploads } = fixture({ leaveUnavailable: true });
  assert.equal(await f.run(true), 'unverified');
  assert.equal(uploads(), 1);
});
for (const ackRevision of ['missing', 'old', 'malformed', 'other'])
  test(`clean repaired ciphertext without a matching new-revision acknowledgement remains unverified: ${ackRevision}`, async () => {
    const { f, state, key, uploads } = fixture({ ackRevision });
    assert.equal(await f.run(true), 'unverified');
    assert.equal(uploads(), 1);
    assert.deepEqual(state.unavailableVaultIds, []);
    const restored = await prepareRecoveryImage(
      key,
      f.app.id,
      state.appImage,
      state.allVaultImages,
      state.labels
    );
    assert.deepEqual(clone(restored.vaults.shared), f.local.Vault[0]);
    assert.equal(
      f.transport.captureBackupWriteIntent(f.app.id),
      undefined,
      'a readable copy alone must not mint write authority'
    );
  });
test('protected archive metadata mismatch stays unverified and explicit backup cannot overwrite it', async () => {
  const { f, state, key, uploads } = fixture({ unavailable: [] });
  f.local.Vault[0].archived = true;
  state.allVaultImages = [
    {
      vaultId: 'shared',
      vault: encryption.encrypt(key, JSON.stringify(f.local.Vault[0])),
      isArchived: false,
    },
  ];
  const ciphertext = state.allVaultImages[0].vault;
  // The protected reference is bound to decrypted archive/policy metadata.
  // The former legacy repair behavior must not authorize a v3 replacement.
  assert.equal(await f.run(), 'unverified');
  assert.equal(uploads(), 0);
  assert.equal(await f.run(true), 'unverified');
  assert.equal(uploads(), 0);
  assert.equal(state.allVaultImages[0].isArchived, false);
  assert.equal(state.allVaultImages[0].vault, ciphertext);
});

function orphanLabelFixture(hasLocalLabel = true, malformedMarker = false) {
  const label = { id: 'fixture-label', name: 'Recovery label' };
  const app = { id: 'disposable', primarySeed: 'ab'.repeat(32) };
  const key = encryption.generateEncryptionKey(app.primarySeed);
  const opaqueId = encryption.hash256(encryption.hash256(key + label.id));
  const state = {
    appImage: {
      appId: app.id,
      wallets: {},
      signers: {},
      nodes: [],
      vaults: [],
      labels: [opaqueId],
    },
    allVaultImages: [],
    labels: [],
    revision: 'a'.repeat(64),
    revisionedMutations: true,
    unavailableLabelIds: [malformedMarker ? 'not-referenced' : opaqueId],
  };
  let uploads = 0;
  const f = harness({
    adapter: async (endpoint, payload) => {
      if (endpoint === 'getBackupSnapshot') return { data: clone(state) };
      assert.equal(endpoint, 'revisionedBackupMutation');
      assert.equal(payload.operation, 'repairAppBackup');
      uploads++;
      state.labels = payload.labels;
      state.appImage.labels = payload.labels.map((record) => record.id);
      Object.assign(state.appImage, {
        publicId: payload.publicId,
        version: payload.version,
        subscription: payload.subscription,
      });
      state.unavailableLabelIds = [];
      state.revision = 'b'.repeat(64);
      return { data: { updated: true, preconditionApplied: true, newRevision: state.revision } };
    },
  });
  Object.assign(state.appImage, {
    publicId: f.app.publicId,
    version: f.app.version,
    subscription: JSON.stringify(f.app.subscription),
  });
  if (hasLocalLabel) f.local.Tags.push(label);
  return { f, state, uploads: () => uploads, key, opaqueId };
}

test('orphan label cannot be removed when local recovery copy is absent', async () => {
  const { f, state, uploads, opaqueId } = orphanLabelFixture(false);
  assert.equal(await f.run(), 'different');
  assert.equal(await f.run(true), 'conflict');
  assert.equal(uploads(), 0);
  assert.deepEqual(state.appImage.labels, [opaqueId]);
});

test('matching local label can safely fill orphan ciphertext during explicit repair', async () => {
  const { f, state, uploads, key } = orphanLabelFixture();
  await assert.rejects(prepareRecoveryImage(key, f.app.id, state.appImage, [], state.labels));
  assert.equal(await f.run(), 'different');
  assert.equal(await f.run(true), 'verified');
  assert.equal(uploads(), 1);
  assert.deepEqual(state.unavailableLabelIds, []);
  assert.deepEqual(
    clone(
      (await prepareRecoveryImage(key, f.app.id, state.appImage, [], state.labels)).labels[
        'fixture-label'
      ]
    ),
    f.local.Tags[0]
  );
});

test('malformed orphan label marker never authorizes replacement', async () => {
  const { f, uploads } = orphanLabelFixture(true, true);
  assert.equal(await f.run(true), 'unverified');
  assert.equal(uploads(), 0);
});

for (const archived of [true, false])
  test(`existing-wallet update carries signer maps and archive state: archived=${archived}`, async () => {
    const { fixture: sagaFixture, enums, signer } = require('./sagaHarness.cjs');
    const f = sagaFixture();
    const device = signer('AABBCCDD', enums.NetworkType.MAINNET, enums.SignerType.LEDGER, 0);
    device.id = f.scope.getKeyUID(device);
    f.collections.Signer.push(device);
    const key = {
      masterFingerprint: device.masterFingerprint,
      ...device.signerXpubs[enums.XpubTypes.P2WPKH][0],
    };
    const vault = {
      id: 'reinstated',
      networkType: enums.NetworkType.MAINNET,
      signers: [key],
      scheme: { m: 1, n: 1 },
      archived,
    };
    f.collections.Vault.push({ ...vault, archived: !archived });
    const session = f.scope.currentBackupAccountSession();
    const operation = f.scope.beginBackupLocalOperation(
      f.app.id,
      { appId: f.app.id, accountSession: session },
      session
    );
    const committedOperation = f.scope.commitBackupLocalOperation(operation, (raw) => {
      raw.objectForPrimaryKey('Vault', vault.id).archived = archived;
    });
    assert.equal(committedOperation.committed, true);
    let uploaded;
    f.scope.Relay.updateVaultImage = async (payload) => {
      uploaded = payload;
      return { updated: true };
    };
    const result = await f.run('updateVaultImageWorker', {
      originAppId: f.app.id,
      originBackupAccountSession: session,
      committedOperation,
      payload: { vault: { ...vault, archived: !archived }, isUpdate: true },
    });
    assert.equal(result.updated, true);
    assert.equal(result.backupConfirmed, false, 'unit Relay acknowledgement is not readback proof');
    assert.equal(f.collections.Vault[0].archived, archived);
    assert.equal(uploaded.appId, f.app.id);
    assert.equal(uploaded.isArchived, archived);
    assert.equal(uploaded.signersData.length, 1);
    assert.equal(uploaded.signersData[0].signerId, f.scope.getKeyUID(key));
    assert.equal(uploaded.signersData[0].xfpHash, encryption.hash256(key.masterFingerprint));
    const restored = JSON.parse(
      encryption.decrypt(encryption.generateEncryptionKey(f.app.primarySeed), uploaded.vault)
    );
    assert.equal(restored.archived, uploaded.isArchived);
    assert.equal(restored.signers[0].masterFingerprint, key.masterFingerprint);
  });
