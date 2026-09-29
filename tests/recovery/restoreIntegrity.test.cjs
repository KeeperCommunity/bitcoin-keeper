const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, enums, encryption, wallet, signer } = require('./sagaHarness.cjs');

const plain = (value) => JSON.parse(JSON.stringify(value));
function recoveryFixture() {
  const f = fixture();
  const key = encryption.generateEncryptionKey(f.app.primarySeed);
  const seal = (record) => encryption.encrypt(key, JSON.stringify(record));
  const mobile = signer('LOCAL001', enums.NetworkType.MAINNET, enums.SignerType.MY_KEEPER);
  mobile.id = f.scope.getKeyUID(mobile);
  const vault = {
    ...wallet('vault', enums.NetworkType.MAINNET),
    entityKind: enums.EntityKind.VAULT,
    archived: true,
    scheme: { m: 1, n: 1 },
    signers: [
      {
        masterFingerprint: mobile.masterFingerprint,
        xpub: mobile.signerXpubs[enums.XpubTypes.P2WPKH][0].xpub,
        derivationPath: mobile.signerXpubs[enums.XpubTypes.P2WPKH][0].derivationPath,
      },
    ],
  };
  const label = { id: 'label', label: 'Disposable label', ref: 'tx', type: 'TXN' };
  const node = {
    id: 42,
    networkType: enums.NetworkType.MAINNET,
    host: 'fixture',
    isConnected: false,
  };
  const btc = wallet('btc', enums.NetworkType.MAINNET);
  const usdt = {
    ...wallet('usdt', enums.NetworkType.MAINNET),
    entityKind: enums.EntityKind.USDT_WALLET,
    specs: { address: 'fixture', privateKey: 'fixture-only' },
  };
  f.remote.wallets = { btc: seal(btc), usdt: seal(usdt) };
  f.remote.signers = { [f.scope.getKeyUID(mobile)]: seal(mobile) };
  f.remote.nodes = [seal(node)];
  f.remote.vaults = ['vault'];
  f.remote.labels = ['encrypted-label-id'];
  const response = {
    appImage: f.remote,
    allVaultImages: [{ vaultId: 'vault', vault: seal(vault) }],
    labels: [{ id: 'encrypted-label-id', content: seal(label) }],
  };
  f.scope.Relay.getAppImage = async () => response;
  const writes = [];
  const create = f.scope.dbManager.createObject;
  f.scope.dbManager.createObject = (schema, value) => {
    writes.push(schema);
    return create(schema, value);
  };
  return {
    ...f,
    response,
    writes,
    expected: { mobile, vault, label, node, btc, usdt },
    restore: () =>
      f.run('getAppImageWorker', { payload: { primaryMnemonic: 'mock fixture only' } }),
  };
}
const completed = (f) => f.actions.some((a) => a.type === 'setAppCreated' && a.payload === true);
const errors = (f) => f.actions.filter((a) => a.type === 'setAppImageError' && a.payload);

test('clean recovery recreates keys, BTC/USDT, archived vault, labels and custom nodes', async () => {
  const f = recoveryFixture();
  await f.restore();
  assert.deepEqual(errors(f), []);
  assert.equal(completed(f), true);
  assert.deepEqual(plain(f.collections.Wallet), [f.expected.btc]);
  assert.deepEqual(plain(f.collections.USDTWallet), [f.expected.usdt]);
  assert.deepEqual(
    plain(f.collections.Signer.find((s) => s.masterFingerprint === 'LOCAL001')),
    f.expected.mobile
  );
  assert.deepEqual(plain(f.collections.Vault), [f.expected.vault]);
  assert.deepEqual(plain(f.collections.Tags), [f.expected.label]);
  assert.deepEqual(plain(f.collections.NodeConnect), [{ ...f.expected.node, isConnected: true }]);
});

for (const kind of ['wallet', 'usdt', 'signer', 'vault', 'label', 'node']) {
  test(`corrupt ${kind} prevents every recovery write and success`, async () => {
    const f = recoveryFixture();
    if (kind === 'wallet') f.remote.wallets.btc = 'corrupt';
    if (kind === 'usdt') f.remote.wallets.usdt = 'corrupt';
    if (kind === 'signer') f.remote.signers[Object.keys(f.remote.signers)[0]] = 'corrupt';
    if (kind === 'vault') f.response.allVaultImages[0].vault = 'corrupt';
    if (kind === 'label') f.response.labels[0].content = 'corrupt';
    if (kind === 'node') f.remote.nodes[0] = 'corrupt';
    await f.restore();
    assert.equal(errors(f).length, 1);
    assert.equal(completed(f), false);
    assert.deepEqual(f.writes, []);
    assert.equal(f.calls.length, 0, 'failed recovery must not upload an empty replacement');
  });
}

for (const schema of [
  'KeeperApp',
  'Wallet',
  'USDTWallet',
  'Signer',
  'Vault',
  'Tags',
  'NodeConnect',
]) {
  for (const failedResult of [false, undefined]) {
    test(`${schema} persistence returning ${failedResult} cannot report recovery success`, async () => {
      const f = recoveryFixture();
      const create = f.scope.dbManager.createObject;
      f.scope.dbManager.createObject = (target, value) =>
        target === schema ? failedResult : create(target, value);
      await f.restore();
      assert.equal(errors(f).length, 1);
      assert.equal(completed(f), false);
      assert.equal(
        f.actions.some(
          (a) => a.type === 'setRecoveryKeyStatus' && a.payload?.status === 'confirmed'
        ),
        false
      );
    });
  }
}

for (const kind of [
  'offline',
  'missing image',
  'other account',
  'missing vault',
  'missing label',
  'wrong vault reference',
  'wrong label reference',
  'wrong encrypted vault identity',
]) {
  test(`${kind} is never treated as a successful empty recovery`, async () => {
    const f = recoveryFixture();
    if (kind === 'offline')
      f.scope.Relay.getAppImage = async () => {
        throw Error('Network Error');
      };
    if (kind === 'missing image') delete f.response.appImage;
    if (kind === 'other account') f.remote.appId = 'other';
    if (kind === 'missing vault') f.response.allVaultImages = [];
    if (kind === 'missing label') f.response.labels = [];
    if (kind === 'wrong vault reference') f.remote.vaults = ['another-vault'];
    if (kind === 'wrong label reference') f.remote.labels = ['another-label'];
    if (kind === 'wrong encrypted vault identity') {
      f.remote.vaults = ['another-vault'];
      f.response.allVaultImages[0].vaultId = 'another-vault';
    }
    await f.restore();
    assert.equal(errors(f).length, 1);
    assert.equal(completed(f), false);
    assert.deepEqual(f.writes, []);
  });
}

test('explicit empty backup keeps the established first-wallet recovery path', async () => {
  const f = fixture();
  let recreated = 0;
  f.scope.WalletUtilities.getDerivationPath = () => 'fixture';
  f.scope.DerivationPurpose = { BIP84: 'BIP84' };
  f.scope.addNewWalletsWorker = () => {
    recreated++;
    return true;
  };
  await f.run('getAppImageWorker', { payload: { primaryMnemonic: 'mock fixture only' } });
  assert.deepEqual(errors(f), []);
  assert.equal(completed(f), true);
  assert.equal(recreated, 1);
});

test('failed first-wallet recreation cannot complete empty-backup recovery', async () => {
  const f = fixture();
  f.scope.WalletUtilities.getDerivationPath = () => 'fixture';
  f.scope.DerivationPurpose = { BIP84: 'BIP84' };
  f.scope.addNewWalletsWorker = () => false;
  await f.run('getAppImageWorker', { payload: { primaryMnemonic: 'mock fixture only' } });
  assert.equal(completed(f), false);
  assert.equal(errors(f).length, 1);
});

for (const failure of ['missing key', 'missing private material']) {
  test(`regenerated Recovery Key signer with ${failure} prevents success`, async () => {
    const f = recoveryFixture();
    const expected = signer('RECOVERY', enums.NetworkType.MAINNET, enums.SignerType.SEED_WORDS);
    expected.signerXpubs[enums.XpubTypes.P2WPKH][0].xpriv = 'fixture-derived-private';
    f.scope.setupRecoveryKeySigningKey = () => expected;
    f.scope.addSigningDeviceWorker = () => {
      if (failure === 'missing private material') {
        const incomplete = plain(expected);
        incomplete.signerXpubs[enums.XpubTypes.P2WPKH][0].xpriv = null;
        f.collections.Signer.push(incomplete);
      }
    };
    await f.restore();
    assert.equal(completed(f), false);
    assert.equal(errors(f).length, 1);
  });
}
