// Key lifecycle coverage uses production backup, key identity, sanitization and
// restore functions with real AES. Native Realm, physical signing and BIP32 key
// derivation remain separate acceptance checks; these are disposable records.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, enums, encryption, signer, wallet } = require('./sagaHarness.cjs');
const { NetworkType, SignerType, XpubTypes } = enums;
const plain = (value) => JSON.parse(JSON.stringify(value));
const keyFor = (f) => encryption.generateEncryptionKey(f.app.primarySeed);

async function restoreKeys(f) {
  f.collections.Signer = [];
  await f.run('recoverApp', 'mock mnemonic', Buffer.from('ab'.repeat(32), 'hex'),
    keyFor(f), f.app.id, f.app.subscription, f.remote, [], [], '2.5.16');
  return plain(f.collections.Signer);
}

for (const network of [NetworkType.MAINNET, NetworkType.TESTNET]) {
  for (const pendingAllBackup of [false, true]) {
    test(`later-added key survives encrypted restore: ${network}, pending=${pendingAllBackup}`, async () => {
      const f = fixture({ bhr: { pendingAllBackup } });
      f.state.settings.bitcoinNetworkType = network;
      const first = signer('AABBCCDD', network);
      const later = signer('11223344', network, SignerType.LEDGER, 2);
      later.signerName = 'Travel device';
      later.hidden = true;
      await f.run('addSigningDeviceWorker', { payload: { signers: [first] } });
      await f.run('addSigningDeviceWorker', { payload: { signers: [later] } });
      assert.equal(f.calls.length, 2);
      assert.equal(f.collections.Signer.length, 2);
      const expected = plain(f.collections.Signer);
      const id = f.scope.getKeyUID(later);
      assert.ok(f.remote.signers[id]);
      assert.ok(!f.remote.signers[id].includes('Travel device'));
      assert.deepEqual(await restoreKeys(f), expected);
      assert.equal(f.state.bhr.pendingAllBackup, pendingAllBackup);
    });
  }
}

test('same fingerprint on different networks and accounts retains three distinct keys', async () => {
  const f = fixture();
  for (const [network, account] of [[NetworkType.MAINNET, 0], [NetworkType.TESTNET, 0], [NetworkType.MAINNET, 1]]) {
    f.state.settings.bitcoinNetworkType = network;
    await f.run('addSigningDeviceWorker', {
      payload: { signers: [signer('AABBCCDD', network, SignerType.COLDCARD, account)] },
    });
  }
  assert.deepEqual(Object.keys(f.remote.signers).sort(), ['AABBCCDD0M', 'AABBCCDD0T', 'AABBCCDD1M']);
  const expected = plain(f.collections.Signer);
  assert.deepEqual(await restoreKeys(f), expected);
});

test('mixed wallet, signer and node update backs up every requested record', async () => {
  const f = fixture();
  const key = signer('AABBCCDD', NetworkType.MAINNET);
  key.id = f.scope.getKeyUID(key);
  f.collections.NodeConnect.push({ id: 'node-fixture', host: 'fixture.invalid', isConnected: true });
  await f.run('updateAppImageWorker', {
    payload: { wallets: [wallet('wallet', NetworkType.MAINNET)], signers: [key], updateNodes: true },
  });
  assert.equal(f.calls.length, 1);
  assert.ok(f.remote.wallets.wallet);
  assert.ok(f.remote.signers[key.id]);
  assert.equal(f.remote.nodes.length, 1);
  assert.equal(JSON.parse(encryption.decrypt(keyFor(f), f.remote.nodes[0])).isConnected, false);
  assert.deepEqual(await restoreKeys(f), [plain(key)]);
});

test('empty wallet array does not suppress signer migration', async () => {
  const f = fixture();
  const key = signer('AABBCCDD', NetworkType.MAINNET);
  key.id = f.scope.getKeyUID(key);
  await f.run('updateAppImageWorker', { payload: { wallets: [], signers: [key] } });
  assert.ok(f.remote.signers[key.id]);
});

test('key name, description, archive and health metadata updates survive clean restore', async () => {
  const f = fixture();
  await f.run('addSigningDeviceWorker', { payload: { signers: [signer('AABBCCDD', NetworkType.MAINNET)] } });
  const key = f.collections.Signer[0];
  for (const [field, value] of Object.entries({
    signerName: 'Renamed device', signerDescription: 'Recorded on physical device',
    archived: true, hidden: true,
    healthCheckDetails: [{ type: 'address-verification', actionDate: '2026-09-29T00:00:00.000Z' }],
  })) await f.run('updateSignerDetailsWorker', { payload: { signer: key, key: field, value } });
  const expected = plain(f.collections.Signer);
  assert.deepEqual(await restoreKeys(f), expected);
});

test('seed-key private material is omitted while software and Recovery Key material retain existing policy', async () => {
  const f = fixture();
  const ordinary = signer('11111111', NetworkType.MAINNET, SignerType.SEED_WORDS);
  const recovery = signer('22222222', NetworkType.MAINNET, SignerType.SEED_WORDS);
  recovery.signerName = f.scope.RECOVERY_KEY_SIGNER_NAME;
  recovery.hidden = true;
  const software = signer('33333333', NetworkType.MAINNET, SignerType.MY_KEEPER);
  software.extraData = { instanceNumber: 1 };
  for (const record of [ordinary, recovery, software]) {
    record.signerXpubs[XpubTypes.P2WPKH][0].xpriv = `${record.masterFingerprint}-disposable-private`;
    await f.run('addSigningDeviceWorker', { payload: { signers: [record] } });
  }
  const localBefore = plain(f.collections.Signer);
  const expected = plain(f.collections.Signer.map(f.scope.sanitizeSeedKeyForBackup));
  assert.deepEqual(plain(f.collections.Signer), localBefore, 'sanitizing must not erase local signing material');
  const restored = await restoreKeys(f);
  assert.deepEqual(restored, expected);
  assert.equal(restored[0].signerXpubs[XpubTypes.P2WPKH][0].xpriv, null);
  assert.equal(restored[1].signerXpubs[XpubTypes.P2WPKH][0].xpriv, '22222222-disposable-private');
  assert.equal(restored[2].signerXpubs[XpubTypes.P2WPKH][0].xpriv, '33333333-disposable-private');
});

test('server-key policy and software key metadata survive encrypted recovery', async () => {
  const f = fixture();
  const key = signer('AABBCCDD', NetworkType.TESTNET, SignerType.POLICY_SERVER);
  key.signerXpubs = {};
  key.signerPolicy = { signingDelay: 3600, backupDisabled: false,
    verification: { method: 'email', verifier: 'fixture.invalid' }, secondaryVerification: [] };
  key.isBIP85 = true;
  key.linkedViaSecondary = true;
  f.state.settings.bitcoinNetworkType = NetworkType.TESTNET;
  await f.run('addSigningDeviceWorker', { payload: { signers: [key] } });
  assert.ok(f.remote.signers.AABBCCDDT);
  const expected = plain(f.collections.Signer);
  assert.deepEqual(await restoreKeys(f), expected);
  const restored = f.collections.Signer[0];
  assert.deepEqual(plain(restored.signerPolicy), key.signerPolicy);
  assert.equal(restored.isBIP85, true);
});

test('vault sanitizer excludes ordinary imported seed xpriv without changing source data', () => {
  const f = fixture();
  const key = signer('AABBCCDD', NetworkType.MAINNET, SignerType.SEED_WORDS);
  const recovery = signer('11223344', NetworkType.MAINNET, SignerType.SEED_WORDS);
  recovery.signerName = f.scope.RECOVERY_KEY_SIGNER_NAME;
  f.collections.Signer.push(key, recovery);
  const vault = { id: 'vault-fixture', signers: [key, recovery].map((record) => ({
    masterFingerprint: record.masterFingerprint, ...record.signerXpubs[XpubTypes.P2WPKH][0],
    xpriv: `${record.masterFingerprint}-disposable-private`,
  })) };
  const before = plain(vault);
  const sanitized = f.scope.sanitizeVaultSignersForSeedKeyBackup(vault);
  assert.equal(sanitized.signers[0].xpriv, null);
  assert.equal(sanitized.signers[1].xpriv, '11223344-disposable-private');
  assert.deepEqual(plain(vault), before);
});

for (const [network, account] of [[NetworkType.MAINNET, 1], [NetworkType.TESTNET, 0]]) {
  test(`vault sanitization selects exact key across duplicated fingerprint: ${network}, account=${account}`, () => {
    const f = fixture();
    const unrelated = signer('AABBCCDD', NetworkType.MAINNET, SignerType.MY_KEEPER);
    const ordinarySeed = signer('AABBCCDD', network, SignerType.SEED_WORDS, account);
    f.collections.Signer.push(unrelated, ordinarySeed);
    const vault = { id: 'fixture', networkType: network, signers: [{
      masterFingerprint: ordinarySeed.masterFingerprint,
      ...ordinarySeed.signerXpubs[XpubTypes.P2WPKH][0], xpriv: 'fixture-private',
    }] };
    assert.equal(f.scope.sanitizeVaultSignersForSeedKeyBackup(vault).signers[0].xpriv, null);
    assert.equal(vault.signers[0].xpriv, 'fixture-private');
  });
}

for (const type of Object.values(SignerType)) {
  test(`vault sanitizer preserves existing backup policy for ${type}`, () => {
    const f = fixture();
    const record = signer('AABBCCDD', NetworkType.MAINNET, type);
    f.collections.Signer.push(record);
    const vault = { id: 'fixture', networkType: NetworkType.MAINNET, signers: [{
      masterFingerprint: record.masterFingerprint, ...record.signerXpubs[XpubTypes.P2WPKH][0],
      xpriv: type === SignerType.SEED_WORDS || type === SignerType.MY_KEEPER ? 'fixture-private' : null,
    }] };
    const before = plain(vault);
    const sanitized = f.scope.sanitizeVaultSignersForSeedKeyBackup(vault);
    assert.equal(sanitized.signers[0].xpriv, type === SignerType.SEED_WORDS ? null : vault.signers[0].xpriv);
    assert.deepEqual(plain(vault), before);
  });
}

for (const problem of ['missing', 'ambiguous', 'different-public-key', 'different-path', 'server-wrong-network']) {
  test(`vault key cannot be silently classified for backup: ${problem}`, () => {
    const f = fixture();
    const record = signer('AABBCCDD', NetworkType.MAINNET,
      problem === 'server-wrong-network' ? SignerType.POLICY_SERVER : SignerType.SEED_WORDS);
    const vault = { id: 'fixture', networkType: NetworkType.MAINNET, signers: [{
      masterFingerprint: record.masterFingerprint, ...record.signerXpubs[XpubTypes.P2WPKH][0],
      xpriv: 'fixture-private',
    }] };
    if (problem === 'different-public-key') vault.signers[0].xpub = 'different-public-fixture';
    if (problem === 'different-path') vault.signers[0].derivationPath = "m/86'/0'/0'";
    if (problem === 'server-wrong-network') record.networkType = NetworkType.TESTNET;
    if (problem !== 'missing') f.collections.Signer.push(record);
    if (problem === 'ambiguous') f.collections.Signer.push(plain(record));
    assert.throws(() => f.scope.sanitizeVaultSignersForSeedKeyBackup(vault), /Cannot identify a vault key/);
  });
}

test('fingerprint migration applies the same seed-secret exclusion as normal backups', async () => {
  const f = fixture();
  const old = signer('AAAAAAAA', NetworkType.MAINNET, SignerType.SEED_WORDS);
  const updated = plain(old);
  updated.masterFingerprint = 'BBBBBBBB';
  updated.signerXpubs[XpubTypes.P2WPKH][0].xpriv = 'disposable-private';
  f.collections.Signer.push(old);
  f.scope.dbManager.getObjectByQuery = () => [];
  let migrated;
  f.scope.Relay.migrateXfp = async (_appId, records) => { migrated = records[0]; return true; };
  assert.equal(await f.run('mergeSimilarKeysWorker', { payload: { signer: updated } }), true);
  const restored = JSON.parse(encryption.decrypt(keyFor(f), migrated.newSignerDetails));
  assert.equal(restored.signerXpubs[XpubTypes.P2WPKH][0].xpriv, null);
  assert.equal(updated.signerXpubs[XpubTypes.P2WPKH][0].xpriv, 'disposable-private');
  assert.equal(restored.masterFingerprint, 'BBBBBBBB');
});

function registrationFixture(options = {}) {
  const f = fixture(options);
  const device = signer('AABBCCDD', NetworkType.MAINNET);
  device.id = f.scope.getKeyUID(device);
  const key = { masterFingerprint: device.masterFingerprint,
    ...device.signerXpubs[XpubTypes.P2WPKH][0], registeredVaults: [] };
  f.collections.Signer.push(device);
  f.collections.Vault.push(...['vault-a', 'vault-b'].map((id) => ({ id, networkType: NetworkType.MAINNET,
    signers: [key], scheme: { m: 1, n: 1 } })));
  f.scope.dbManager.getObjectByPrimaryId = () => ({ toJSON: () => plain(key) });
  f.scope.dbManager.updateObjectByPrimaryId = (_schema, _field, _id, patch) => {
    if (options.writeFails) return false;
    Object.assign(key, patch);
    return true;
  };
  const uploaded = [];
  f.scope.Relay.updateVaultImage = async (payload) => {
    if (options.uploadFails) throw Error('fixture offline');
    uploaded.push(payload);
    return { updated: true };
  };
  return { f, key, uploaded };
}

test('key registration is backed up after persistence in every containing vault', async () => {
  const { f, key, uploaded } = registrationFixture();
  const registration = { vaultId: 'vault-a', registered: true, registrationInfo: 'fixture-info', hmac: 'fixture-hmac' };
  await f.run('updateKeyDetailsWorker', { payload: { signer: key, key: 'registered', value: registration } });
  assert.deepEqual(uploaded.map((payload) => payload.vaultId), ['vault-a', 'vault-b']);
  for (const payload of uploaded) {
    const restored = JSON.parse(encryption.decrypt(keyFor(f), payload.vault));
    assert.deepEqual(restored.signers[0].registeredVaults, [registration]);
  }
});

for (const options of [{ online: false }, { uploadFails: true }]) {
  test(`key registration survives backup failure with retry pending: ${JSON.stringify(options)}`, async () => {
    const { f, key, uploaded } = registrationFixture(options);
    await f.run('updateKeyDetailsWorker', { payload: { signer: key, key: 'registered', value: { vaultId: 'vault-a', registered: true } } });
    assert.equal(key.registeredVaults[0].registered, true);
    assert.equal(uploaded.length, 0);
    assert.equal(f.state.bhr.pendingAllBackup, true);
  });
}

test('disabled server backup preserves local key registration without uploading', async () => {
  const { f, key, uploaded } = registrationFixture({ bhr: { automaticCloudBackup: false } });
  await f.run('updateKeyDetailsWorker', { payload: { signer: key, key: 'registered', value: { vaultId: 'vault-a', registered: true } } });
  assert.equal(key.registeredVaults[0].registered, true);
  assert.equal(uploaded.length, 0);
  assert.equal(f.state.bhr.pendingAllBackup, false);
});

test('failed local key registration write never publishes an unpersisted success', async () => {
  const { f, key, uploaded } = registrationFixture({ writeFails: true });
  assert.equal(await f.run('updateKeyDetailsWorker', { payload: { signer: key, key: 'registered', value: { vaultId: 'vault-a', registered: true } } }), false);
  assert.equal(uploaded.length, 0);
  assert.equal(key.registeredVaults.length, 0);
  assert.ok(f.actions.some((action) => action.type === 'relaySignersUpdateFail' && action.payload === 'Key registration could not be saved'));
});

test('remembering an imported seed for signing remains local and does not trigger a vault upload', async () => {
  const { f, key, uploaded } = registrationFixture();
  await f.run('updateKeyDetailsWorker', { payload: { signer: key, key: 'xpriv', value: 'disposable-local-private' } });
  assert.equal(key.xpriv, 'disposable-local-private');
  assert.equal(uploaded.length, 0);
});
