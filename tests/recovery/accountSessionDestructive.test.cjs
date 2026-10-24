const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture, enums, wallet } = require('./sagaHarness.cjs');
const { loadModule } = require('./helpers.cjs');

// Producer orchestration tests with the explicit unit transaction/queue adapter.
// Native Realm, immutable queue authority and CAS/readback are covered separately
// by automaticWriteRealmRelay.integration; a Relay acknowledgement is not proof.
async function waitForPause(getResume) {
  for (let attempt = 0; attempt < 20 && !getResume(); attempt++) await new Promise(setImmediate);
  assert.equal(typeof getResume(), 'function', 'the action must reach its intended pause');
}

function accountRoundTrip(f, originalAppId, advanceSession) {
  f.app.id = 'other-disposable-account';
  f.state.storage.appId = f.app.id;
  advanceSession();
  f.app.id = originalAppId;
  f.state.storage.appId = originalAppId;
  advanceSession();
}

function owner(f) {
  const appId = f.app.id;
  let session = 1;
  f.scope.currentBackupAccountSession = () => session;
  return {
    appId,
    session: () => session,
    roundTrip: () =>
      accountRoundTrip(f, appId, () => {
        session++;
      }),
  };
}

function hasDeleteSuccess(f) {
  return f.actions.some(
    (action) => action.type === 'setDeleteBackupSuccess' && action.payload?.status === true
  );
}

function assertConsentRetained(f, appId) {
  assert.equal(f.state.bhr.automaticCloudBackupByAppId[appId], true);
  assert.ok(!hasDeleteSuccess(f));
}

test('stale queued wallet deletion cannot commit into the returned A session', async () => {
  const f = fixture();
  const active = owner(f);
  const walletId = 'disposable-wallet';
  f.collections.Wallet.push(wallet(walletId, enums.NetworkType.MAINNET));
  const action = {
    originAppId: active.appId,
    originBackupAccountSession: active.session(),
    payload: { walletIds: [walletId] },
  };
  active.roundTrip();
  f.remote.wallets[walletId] = 'newer-A-ciphertext';

  assert.equal((await f.run('deleteAppImageEntityWorker', action)).updated, false);
  assert.deepEqual(f.calls, []);
  assert.equal(f.remote.wallets[walletId], 'newer-A-ciphertext');
  assert.deepEqual(
    f.collections.Wallet.map(({ id }) => id),
    [walletId]
  );
});

test('old committed vault deletion receipt cannot delete newer A after returning to A', async () => {
  const f = fixture();
  const active = owner(f);
  const vaultId = 'disposable-vault';
  f.collections.Vault.push({ id: vaultId, signers: [] });
  const operation = f.scope.beginBackupLocalOperation(
    active.appId,
    { appId: active.appId, accountSession: active.session() },
    active.session()
  );
  const receipt = f.scope.commitBackupLocalOperation(operation, (raw) => {
    raw.delete(raw.objectForPrimaryKey('Vault', vaultId));
  });
  assert.equal(receipt.committed, true);
  const originalSession = active.session();
  active.roundTrip();
  f.collections.Vault.push({ id: vaultId, signers: [], name: 'newer A vault' });
  const remoteVaults = { [vaultId]: 'newer-A-ciphertext' };
  f.scope.Relay.deleteVaults = async ({ vaults }) => {
    f.calls.push(['delete-vault']);
    vaults.forEach((id) => delete remoteVaults[id]);
    return { updated: true };
  };

  const result = await f.run('deleteVaultImageWorker', {
    originAppId: active.appId,
    originBackupAccountSession: originalSession,
    committedOperation: receipt,
    payload: { vaultIds: [vaultId] },
  });
  assert.equal(result.updated, false);
  assert.deepEqual(f.calls, []);
  assert.equal(remoteVaults[vaultId], 'newer-A-ciphertext');
  assert.equal(f.collections.Vault[0].name, 'newer A vault');
});

test('whole-backup deletion rejects a preflight captured before A to B to A', async () => {
  const f = fixture({ confirmBackupDeletion: true });
  const active = owner(f);
  f.remote.wallets.shared = 'initial-A-ciphertext';
  const beginDelete = f.scope.beginBackupDeleteOperation;
  let resumePreflight;
  f.scope.beginBackupDeleteOperation = async (...args) => {
    const receipt = await beginDelete(...args);
    return new Promise((resolve) => {
      resumePreflight = () => resolve(receipt);
    });
  };

  const deleting = f.run('deleteBackupWorker', {
    appId: active.appId,
    originBackupAccountSession: active.session(),
  });
  await waitForPause(() => resumePreflight);
  active.roundTrip();
  f.remote.wallets.shared = 'newer-A-ciphertext';
  resumePreflight();

  assert.equal(await deleting, false);
  assert.deepEqual(f.calls, []);
  assert.equal(f.remote.wallets.shared, 'newer-A-ciphertext');
  assertConsentRetained(f, active.appId);
});

test('transport refuses an unbranded delete even when queued across A to B to A', async () => {
  let active = 'A';
  const remote = { wallets: { shared: 'initial-A-ciphertext' } };
  const requests = [];
  const transport = loadModule('src/services/backup/transport.ts', {
    '../rest/RestClient': {
      post: async (path, body) => {
        requests.push({ path, body });
        remote.wallets = {};
        return { data: { updated: true } };
      },
    },
  });
  transport.setBackupUploadGuard((appId, explicitChoice) => appId === active && explicitChoice);
  transport.observeBackupAccount(active);
  let release;
  const busy = transport.withBackupSession(
    'A',
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  await waitForPause(() => release);

  const deleting = transport.backupPost('fixture/deleteBackup', { appId: 'A' }, true);
  active = 'B';
  transport.observeBackupAccount(active);
  remote.wallets.shared = 'newer-A-ciphertext';
  active = 'A';
  transport.observeBackupAccount(active);
  release();
  await busy;

  await assert.rejects(deleting, (error) => error.category === 'protocol');
  assert.deepEqual(requests, []);
  assert.equal(remote.wallets.shared, 'newer-A-ciphertext');
});

test('whole-backup delete queued before A to B to A sends no request for the returned A', async () => {
  const f = fixture({ confirmBackupDeletion: true });
  const active = owner(f);
  const enqueue = f.scope.enqueueAutomaticBackupOperation;
  let resumeQueue;
  f.scope.enqueueAutomaticBackupOperation = async (...args) => {
    await new Promise((resolve) => {
      resumeQueue = resolve;
    });
    return enqueue(...args);
  };
  f.scope.Relay.deleteBackup = async () => {
    f.calls.push(['delete-backup']);
    f.remote.wallets = {};
    return { updated: true };
  };
  const deleting = f.run('deleteBackupWorker', {
    appId: active.appId,
    originBackupAccountSession: active.session(),
  });
  await waitForPause(() => resumeQueue);
  active.roundTrip();
  f.remote.wallets.shared = 'newer-A-ciphertext';
  resumeQueue();

  assert.equal(await deleting, false);
  assert.deepEqual(f.calls, []);
  assert.equal(f.remote.wallets.shared, 'newer-A-ciphertext');
  assert.equal(f.state.bhr.pendingAllBackupByAppId[active.appId], true);
  assertConsentRetained(f, active.appId);
});

test('wallet deletes locally before queue but cannot remove newer A data after A to B to A', async () => {
  const f = fixture();
  const active = owner(f);
  const walletId = 'disposable-wallet';
  f.collections.Wallet.push(wallet(walletId, enums.NetworkType.MAINNET));
  const enqueue = f.scope.enqueueAutomaticBackupOperation;
  let resumeQueue;
  f.scope.enqueueAutomaticBackupOperation = async (...args) => {
    await new Promise((resolve) => {
      resumeQueue = resolve;
    });
    return enqueue(...args);
  };
  const deleting = f.run('deleteAppImageEntityWorker', {
    originAppId: active.appId,
    originBackupAccountSession: active.session(),
    payload: { walletIds: [walletId] },
  });
  await waitForPause(() => resumeQueue);
  assert.equal(f.collections.Wallet.length, 0, 'the original A local deletion has committed');
  active.roundTrip();
  const newerWallet = wallet(walletId, enums.NetworkType.MAINNET);
  newerWallet.presentationData.name = 'Newer A wallet';
  f.collections.Wallet.push(newerWallet);
  f.remote.wallets[walletId] = 'newer-A-ciphertext';
  resumeQueue();

  const result = await deleting;
  assert.equal(result.updated, false);
  assert.equal(result.localCommitted, true);
  assert.deepEqual(f.calls, []);
  assert.equal(f.remote.wallets[walletId], 'newer-A-ciphertext');
  assert.equal(f.collections.Wallet[0].presentationData.name, 'Newer A wallet');
  assert.equal(f.state.bhr.pendingAllBackupByAppId[active.appId], true);
});

test('whole-delete acknowledgement after A to B to A cannot clear consent or report success', async () => {
  const f = fixture({ confirmBackupDeletion: true });
  const active = owner(f);
  let finishDelete;
  f.scope.Relay.deleteBackup = () => {
    f.calls.push(['delete-backup']);
    f.remote.wallets = {};
    return new Promise((resolve) => {
      finishDelete = resolve;
    });
  };
  const deleting = f.run('deleteBackupWorker', {
    appId: active.appId,
    originBackupAccountSession: active.session(),
  });
  await waitForPause(() => finishDelete);
  active.roundTrip();
  f.remote.wallets.shared = 'newer-A-ciphertext';
  finishDelete({ updated: true });

  assert.equal(await deleting, false);
  assert.equal(f.remote.wallets.shared, 'newer-A-ciphertext');
  assert.equal(f.state.bhr.pendingAllBackupByAppId[active.appId], true);
  assertConsentRetained(f, active.appId);
});

test('wallet delete acknowledgement after A to B to A cannot report a new-session deletion', async () => {
  const f = fixture();
  const active = owner(f);
  const walletId = 'disposable-wallet';
  f.collections.Wallet.push(wallet(walletId, enums.NetworkType.MAINNET));
  let finishDelete;
  f.scope.Relay.deleteAppImageEntity = ({ walletIds }) => {
    f.calls.push(['delete']);
    walletIds.forEach((id) => delete f.remote.wallets[id]);
    return new Promise((resolve) => {
      finishDelete = resolve;
    });
  };
  const completion = [];
  const deleting = f.run('deleteAppImageEntityRequestWorker', {
    originAppId: active.appId,
    originBackupAccountSession: active.session(),
    payload: { walletIds: [walletId] },
    onComplete: (deleted) => completion.push(deleted),
  });
  await waitForPause(() => finishDelete);
  assert.equal(f.collections.Wallet.length, 0);
  active.roundTrip();
  f.collections.Wallet.push(wallet(walletId, enums.NetworkType.MAINNET));
  f.remote.wallets[walletId] = 'newer-A-ciphertext';
  finishDelete({ updated: true });

  assert.equal(await deleting, false);
  assert.deepEqual(completion, [false]);
  assert.deepEqual(f.calls, [['delete']]);
  assert.equal(f.remote.wallets[walletId], 'newer-A-ciphertext');
  assert.deepEqual(
    f.collections.Wallet.map(({ id }) => id),
    [walletId]
  );
  assert.equal(f.state.bhr.pendingAllBackupByAppId[active.appId], true);
});
