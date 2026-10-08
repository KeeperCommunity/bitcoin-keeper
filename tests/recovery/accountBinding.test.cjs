const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, wallet, signer, enums, loadModule } = require('./sagaHarness.cjs');
const { harness } = require('./helpers.cjs');

function switchToOptedInB(f) {
  f.app.id = 'B';
  f.app.primarySeed = 'cd'.repeat(32);
  f.state.storage.appId = 'B';
  f.state.bhr.automaticCloudBackupByAppId.B = true;
}

test('A wallet and vault actions queued before B login never use B key or destination', async () => {
  const f = fixture();
  const originAppId = f.app.id;
  const aWallet = wallet('A-wallet', enums.NetworkType.MAINNET);
  switchToOptedInB(f);
  const walletResult = await f.run('updateAppImageWorker', {
    originAppId,
    payload: { wallets: [aWallet], updateNodes: true },
  });
  const vaultResult = await f.run('updateVaultImageWorker', {
    originAppId,
    payload: { vault: { id: 'A-vault', signers: [], archived: false } },
  });
  const createResult = await f.run('addNewWalletsWorker', {
    originAppId,
    payload: [{ walletType: enums.WalletType.DEFAULT, walletDetails: { fixture: aWallet } }],
  });
  assert.equal(walletResult.updated, false);
  assert.equal(vaultResult.updated, false);
  assert.equal(createResult, false);
  assert.equal(f.calls.length, 0, 'B must receive no A ciphertext or appId');
  assert.equal(f.collections.Wallet.length, 0, 'A wallet must not be persisted in B Realm');
});

test('selected B blocks stale A writes even before Realm finishes switching', async () => {
  const f = fixture();
  const originAppId = f.app.id;
  const aWallet = wallet('same-wallet', enums.NetworkType.MAINNET);
  f.collections.Wallet.push({ ...aWallet, specs: { totalExternalAddresses: 4 } });
  f.state.storage.appId = 'B';
  f.state.bhr.automaticCloudBackupByAppId.B = true;
  const createResult = await f.run('addNewWalletsWorker', {
    originAppId,
    payload: [{ walletType: enums.WalletType.DEFAULT, walletDetails: { fixture: aWallet } }],
  });
  const backupResult = await f.run('updateAppImageWorker', {
    originAppId,
    payload: { wallets: [aWallet] },
  });
  const addressResult = await f.run('generateNewExternalAddressWorker', {
    originAppId,
    payload: { wallet: { ...aWallet, specs: { totalExternalAddresses: 7 } } },
  });
  assert.equal(createResult, false);
  assert.equal(backupResult.updated, false);
  assert.equal(addressResult, false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.collections.Wallet.length, 1);
  assert.equal(f.collections.Wallet[0].specs.totalExternalAddresses, 4);
});

test('A to opted-in B during connectivity wait blocks upload and preserves B local wallet', async () => {
  const f = fixture();
  const originAppId = f.app.id;
  const sharedId = 'same-id-in-both-accounts';
  f.collections.Wallet.push(wallet(sharedId, enums.NetworkType.MAINNET));
  let resumeConnectivity;
  f.scope.NetInfo.fetch = () => new Promise((resolve) => { resumeConnectivity = resolve; });
  const deleting = f.run('deleteAppImageEntityWorker', {
    originAppId,
    payload: { walletIds: [sharedId] },
  });
  for (let i = 0; i < 20 && !resumeConnectivity; i++) await new Promise(setImmediate);
  assert.ok(resumeConnectivity, 'test must switch while the original account is waiting');
  switchToOptedInB(f);
  resumeConnectivity({ isConnected: true });
  const result = await deleting;
  assert.equal(result.updated, false);
  assert.equal(f.calls.length, 0, 'no remote delete may target either account');
  assert.deepEqual(f.collections.Wallet.map(({ id }) => id), [sharedId]);

  let resumeSecondCheck;
  f.scope.NetInfo.fetch = () => new Promise((resolve) => { resumeSecondCheck = resolve; });
  f.app.id = originAppId;
  f.app.primarySeed = 'ab'.repeat(32);
  f.state.storage.appId = originAppId;
  const updating = f.run('updateAppImageWorker', {
    originAppId,
    payload: { wallets: [wallet('A-wallet', enums.NetworkType.MAINNET)], updateNodes: true },
  });
  for (let i = 0; i < 20 && !resumeSecondCheck; i++) await new Promise(setImmediate);
  assert.ok(resumeSecondCheck);
  switchToOptedInB(f);
  resumeSecondCheck({ isConnected: true });
  assert.equal((await updating).updated, false);
  assert.equal(f.calls.length, 0, 'A payload must never be encrypted with B seed or sent to B');
});

test('queued A transport cannot execute after opted-in B becomes active', async () => {
  const calls = [];
  const transport = loadModule('src/services/backup/transport.ts', {
    '../rest/RestClient': { post: async (_path, body) => { calls.push(body); return { data: { updated: true } }; } },
  });
  let active = 'A';
  const consent = { A: true, B: true };
  transport.setBackupUploadGuard((id, explicitChoice) => id === active && (consent[id] || explicitChoice));
  let release;
  const busy = transport.withBackupSession('A', () => new Promise((resolve) => { release = resolve; }));
  for (let i = 0; i < 20 && !release; i++) await new Promise(setImmediate);
  assert.ok(release);
  const pending = transport.backupPost('fixture/updateAppImage', { appId: 'A', walletsObject: { secret: 'A-ciphertext' } });
  active = 'B';
  release();
  await busy;
  await assert.rejects(pending, /not active or opted in/);
  assert.deepEqual(calls, [], 'the queued request must never reach the network');
});

test('per-account consent starts off, survives switches, and legacy consent needs attribution', () => {
  const reducer = loadModule('src/store/reducers/bhr.ts', {
    'src/models/enums/BHR': loadModule('src/models/enums/BHR.ts'),
    'src/storage': { reduxStorage: {} },
    'redux-persist': { persistReducer: (_settings, fn) => fn },
  });
  let state = reducer.default(undefined, { type: 'init' });
  assert.equal(reducer.isAutomaticCloudBackupEnabled(state, 'A'), false);
  assert.equal(reducer.isAutomaticCloudBackupEnabled(state, 'B'), false);
  state = reducer.default(state, reducer.setAutomaticCloudBackup({ appId: 'A', enabled: true }));
  assert.equal(reducer.isAutomaticCloudBackupEnabled(state, 'A'), true);
  assert.equal(reducer.isAutomaticCloudBackupEnabled(state, 'B'), false);
  state = reducer.default(state, reducer.setBackupAllSuccess({ appId: 'A', status: true }));
  state = reducer.default(state, reducer.setAutomaticCloudBackup({ appId: 'A', enabled: false }));
  assert.equal(state.backupAllSuccessByAppId.A, false, 'stale UI success cannot reenable A');
  assert.equal(reducer.isAutomaticCloudBackupEnabled(state, 'A'), false);
  const legacy = { ...state, automaticCloudBackup: true, automaticCloudBackupByAppId: {} };
  const ambiguous = reducer.default(legacy, reducer.migrateLegacyAutomaticCloudBackup({ appId: 'A', canAttributeConsent: false }));
  assert.equal(reducer.isAutomaticCloudBackupEnabled(ambiguous, 'A'), false);
  assert.equal(ambiguous.automaticCloudBackup, false);
  const attributable = reducer.default(legacy, reducer.migrateLegacyAutomaticCloudBackup({ appId: 'A', canAttributeConsent: true }));
  assert.equal(reducer.isAutomaticCloudBackupEnabled(attributable, 'A'), true);
  assert.equal(reducer.isAutomaticCloudBackupEnabled(attributable, 'B'), false);
});

test('explicit backup can repair an off account only while that account stays active', async () => {
  const f = harness();
  f.local.Wallet.push(wallet('explicit', enums.NetworkType.MAINNET));
  f.transport.setBackupUploadGuard((id, explicitChoice) => id === f.app.id && explicitChoice);
  assert.equal(await f.repair.inspectBackup(f.app.id, true, () => {}, true), 'verified');
  assert.deepEqual(f.calls, ['getBackupSnapshot', 'repairAppBackup', 'getBackupSnapshot']);
});

test('unconfirmed server deletion retains account consent and reports failure', async () => {
  const f = fixture();
  f.scope.Relay.deleteBackup = async () => ({ updated: false });
  assert.equal(await f.run('deleteBackupWorker', { appId: f.app.id }), false);
  assert.equal(f.state.bhr.automaticCloudBackupByAppId[f.app.id], true);
  assert.ok(f.actions.some((action) => action.type === 'setDeleteBackupFailure' &&
    action.payload.appId === f.app.id && action.payload.status === true));
  assert.ok(!f.actions.some((action) => action.type === 'setAutomaticCloudBackup' &&
    action.payload.enabled === false));
});

test('rejected entity deletion retains local wallet and queues an account repair', async () => {
  const f = fixture();
  const id = f.app.id;
  f.collections.Wallet.push(wallet('keep', enums.NetworkType.MAINNET));
  f.scope.Relay.deleteAppImageEntity = async () => ({ updated: false, error: 'rejected' });
  const result = await f.run('deleteAppImageEntityWorker', {
    originAppId: id,
    payload: { walletIds: ['keep'] },
  });
  assert.equal(result.updated, false);
  assert.deepEqual(f.collections.Wallet.map((w) => w.id), ['keep']);
  assert.equal(f.state.bhr.pendingAllBackupByAppId[id], true);
});

test('remote entity deletion followed by local failure reports partial deletion', async () => {
  const f = fixture();
  const id = f.app.id;
  f.collections.Wallet.push(wallet('keep', enums.NetworkType.MAINNET));
  f.scope.dbManager.deleteObjectById = () => false;
  const result = await f.run('deleteAppImageEntityWorker', {
    originAppId: id,
    payload: { walletIds: ['keep'] },
  });
  assert.equal(result.updated, false);
  assert.deepEqual(f.collections.Wallet.map((w) => w.id), ['keep']);
  assert.equal(f.state.bhr.pendingAllBackupByAppId[id], true);
});

test('signer delete reports failure and never shows success after rejected remote delete', async () => {
  const f = fixture();
  const key = signer('AABBCCDD', enums.NetworkType.MAINNET);
  f.scope.deleteAppImageEntityWorker = function* () { return { updated: false, error: 'rejected' }; };
  const result = await f.run('deleteSigningDeviceWorker', {
    originAppId: f.app.id,
    payload: { signers: [key] },
  });
  assert.equal(result, false);
  assert.ok(f.actions.some((action) => action.type === 'relaySignersUpdateFail'));
  assert.ok(!f.actions.some((action) => action.type === 'showKeyDeletedSuccessModal'));
});

test('remote vault deletion followed by failed local delete reports failure and pending repair', async () => {
  const f = fixture();
  f.scope.deleteVaultImageWorker = function* () { return { updated: true }; };
  f.scope.dbManager.deleteObjectById = () => false;
  await f.run('deleteVaultWorker', { originAppId: f.app.id, payload: { vaultId: 'keep-vault' } });
  assert.ok(f.actions.some((action) => action.type === 'relayVaultUpdateFail'));
  assert.ok(!f.actions.some((action) => action.type === 'relayVaultUpdateSuccess'));
  assert.equal(f.state.bhr.pendingAllBackupByAppId[f.app.id], true);
});

test('queued A address action cannot change B wallet with the same ID', async () => {
  const f = fixture();
  const originAppId = f.app.id;
  const aWallet = { ...wallet('same-wallet', enums.NetworkType.MAINNET),
    specs: { totalExternalAddresses: 7 } };
  f.collections.Wallet.push({ ...wallet('same-wallet', enums.NetworkType.MAINNET),
    specs: { totalExternalAddresses: 4 } });
  switchToOptedInB(f);
  assert.equal(await f.run('generateNewExternalAddressWorker', {
    originAppId, payload: { wallet: aWallet },
  }), false);
  assert.equal(f.collections.Wallet[0].specs.totalExternalAddresses, 4);
  assert.equal(aWallet.specs.totalExternalAddresses, 7);
});

test('A policy response after B login cannot change B signer or policy UI state', async () => {
  const f = fixture();
  const originAppId = f.app.id;
  let completePolicy;
  f.scope.SigningServer.updatePolicy = () => new Promise((resolve) => { completePolicy = resolve; });
  let writes = 0;
  f.scope.dbManager.updateObjectByPrimaryId = () => { writes++; return true; };
  const policy = f.run('updateSignerPolicyWorker', {
    originAppId,
    payload: {
      signer: { masterFingerprint: 'AABBCCDD', signerPolicy: {} },
      signingKey: { xfp: 'AABBCCDD' },
      updates: { restrictions: {}, signingDelay: 0 },
      verificationToken: 123456,
    },
  });
  for (let i = 0; i < 20 && !completePolicy; i++) await new Promise(setImmediate);
  assert.ok(completePolicy);
  switchToOptedInB(f);
  completePolicy({ updated: true, delayedPolicyUpdate: { id: 'A-policy' } });
  await policy;
  assert.equal(writes, 0);
  assert.ok(!f.actions.some((action) =>
    action.type === 'updateDelayedPolicyUpdate' ||
    (action.type === 'setSignerPolicyError' && action.payload === 'success')));
});
