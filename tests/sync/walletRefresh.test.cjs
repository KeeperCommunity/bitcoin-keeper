const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectWalletsForSync } = require('../../src/store/sagas/walletSyncSelection.js');
const { acquireWalletRefresh } = require('../../src/store/sagas/walletRefreshCoordinator.js');

const wallet = (id, networkType, archived = false, visibility = 'DEFAULT') => ({
  id, networkType, archived, entityKind: 'VAULT', presentationData: { visibility },
  specs: { balances: { confirmed: 0, unconfirmed: 0 } },
});

test('automatic sync retains empty and hidden archived vaults on the selected network', () => {
  const main = wallet('main', 'MAINNET');
  const emptyArchive = wallet('empty-archive', 'TESTNET', true, 'HIDDEN');
  const otherNetworkArchive = wallet('other-archive', 'MAINNET', true);
  const activeTestnet = wallet('active', 'TESTNET');
  const selected = selectWalletsForSync([main], [emptyArchive, otherNetworkArchive, activeTestnet], 'TESTNET');
  assert.deepEqual(selected.active.map((item) => item.id), ['active']);
  assert.deepEqual(selected.archived.map((item) => item.id), ['empty-archive']);

  const resumed = selectWalletsForSync([], [emptyArchive, activeTestnet], 'TESTNET', {
    archivedOnly: true,
  });
  assert.deepEqual(resumed.active, []);
  assert.deepEqual(resumed.archived.map((item) => item.id), ['empty-archive']);
});

test('identical requests join and overlapping wallet refreshes wait for the first write', async () => {
  const current = wallet('dedup', 'TESTNET');
  const first = acquireWalletRefresh('profile-a', 'TESTNET', [current], { hardRefresh: false });
  const duplicate = acquireWalletRefresh('profile-a', 'TESTNET', [current], { hardRefresh: false });
  const harder = acquireWalletRefresh('profile-a', 'TESTNET', [current], { hardRefresh: true });
  assert.equal(first.owner, true);
  assert.equal(duplicate.owner, false);
  assert.equal(duplicate.done, first.done);
  assert.equal(harder.owner, true);

  let harderReady = false;
  harder.ready.then(() => { harderReady = true; });
  await Promise.resolve();
  assert.equal(harderReady, false);
  first.complete(true);
  assert.equal(await duplicate.done, true);
  await harder.ready;
  assert.equal(harderReady, true);
  harder.complete(true);
});

test('refresh queues are isolated by profile and network', async () => {
  const current = wallet('shared-xpub', 'TESTNET');
  const first = acquireWalletRefresh('profile-a', 'TESTNET', [current]);
  const otherProfile = acquireWalletRefresh('profile-b', 'TESTNET', [current]);
  const otherNetwork = acquireWalletRefresh('profile-a', 'MAINNET', [current]);
  await Promise.all([otherProfile.ready, otherNetwork.ready]);
  assert.equal(otherProfile.owner, true);
  assert.equal(otherNetwork.owner, true);
  otherProfile.complete(true);
  otherNetwork.complete(true);
  first.complete(false);
  assert.equal(await first.done, false);
});
