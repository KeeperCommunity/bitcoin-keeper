// Run the production recovery saga against disposable records. A paused restore
// must not replace a newer account session's signing key after A -> B -> A.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, enums, encryption, signer, wallet } = require('./sagaHarness.cjs');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('recovery cannot overwrite a signer after A -> B -> A between recovered records', async () => {
  const f = fixture();
  const oldSigner = signer('AABBCCDD', enums.NetworkType.MAINNET, enums.SignerType.MY_KEEPER);
  oldSigner.id = f.scope.getKeyUID(oldSigner);
  oldSigner.signerXpubs[enums.XpubTypes.P2WPKH][0].xpriv = 'old-disposable-secret';
  f.scope.prepareRecoveryImage = async () => ({
    wallets: { wallet: wallet('old-wallet', enums.NetworkType.MAINNET) },
    signers: { signer: oldSigner },
    vaults: {},
    labels: {},
    nodes: {},
  });

  let session = 1;
  f.scope.currentBackupAccountSession = () => session;
  const paused = deferred();
  const resume = deferred();
  let recordsWritten = 0;
  f.scope.pauseBackup = async () => {
    recordsWritten += 1;
    // KeeperApp and wallet have been written; the stale signer is next.
    if (recordsWritten === 2) {
      paused.resolve();
      await resume.promise;
    }
  };

  const restoring = f.run(
    'recoverApp',
    'disposable mnemonic',
    Buffer.from('ab'.repeat(32), 'hex'),
    'disposable-key',
    f.app.id,
    f.app.subscription,
    f.remote,
    [],
    [],
    '2.5.16',
    session
  );
  await paused.promise;

  const newSigner = JSON.parse(JSON.stringify(oldSigner));
  newSigner.signerXpubs[enums.XpubTypes.P2WPKH][0].xpriv = 'new-disposable-secret';
  f.collections.Signer.push(newSigner);
  f.state.storage.appId = 'another-account';
  session += 1;
  f.state.storage.appId = f.app.id;
  session += 1;
  resume.resolve();

  await assert.rejects(restoring);
  assert.equal(
    f.collections.Signer[0].signerXpubs[enums.XpubTypes.P2WPKH][0].xpriv,
    'new-disposable-secret'
  );
});

test('a stale recovery response cannot write KeeperApp after A -> B -> A', async () => {
  const f = fixture();
  const entered = deferred();
  const resume = deferred();
  f.scope.prepareRecoveryImage = async () => {
    entered.resolve();
    await resume.promise;
    return { wallets: {}, signers: {}, vaults: {}, labels: {}, nodes: {} };
  };
  let session = 1;
  f.scope.currentBackupAccountSession = () => session;
  const restoring = f.run(
    'recoverApp',
    'old disposable mnemonic',
    Buffer.from('ab'.repeat(32), 'hex'),
    'disposable-key',
    f.app.id,
    f.app.subscription,
    f.remote,
    [],
    [],
    '2.5.16',
    session
  );
  await entered.promise;

  session += 1;
  f.state.storage.appId = 'another-account';
  session += 1;
  f.state.storage.appId = f.app.id;
  resume.resolve();

  await assert.rejects(restoring, /Backup account changed/);
  assert.equal(f.app.primaryMnemonic, undefined);
  assert.equal(f.collections.BackupHistory.length, 0);
});

test('successful recovery returns its session before adding the Recovery Key signer', async () => {
  const f = fixture();
  const session = 1;
  f.scope.currentBackupAccountSession = () => session;
  const key = encryption.generateEncryptionKey(f.scope.bip39.mnemonicToSeedSync().toString('hex'));
  const restoredWallet = wallet('disposable-wallet', enums.NetworkType.MAINNET);
  f.remote.wallets[restoredWallet.id] = encryption.encrypt(key, JSON.stringify(restoredWallet));
  const recover = f.scope.recoverApp;
  let returnedSession;
  f.scope.recoverApp = function* (...args) {
    returnedSession = yield* recover(...args);
    return returnedSession;
  };

  await f.run('getAppImageWorker', { payload: { primaryMnemonic: 'disposable mnemonic',
    selection: { source: 'legacy-older', olderCopyConfirmed: true } } });

  assert.equal(returnedSession, session);
  assert.ok(f.collections.Signer.some((row) => row.masterFingerprint === 'RECOVERY'));
  assert.equal(f.state.account.recoveryKeyStatusByAppId[f.app.id], 'confirmed');
  assert.ok(f.actions.some((action) => action.type === 'setAppCreated' && action.payload === true));
});
