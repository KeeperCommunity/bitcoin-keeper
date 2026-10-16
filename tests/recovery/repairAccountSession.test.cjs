const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, wallet } = require('./helpers.cjs');

function switchAwayAndBack(f) {
  const originalId = f.app.id;
  f.app.id = 'other-disposable-account';
  f.transport.observeBackupAccount(f.app.id);
  f.app.id = originalId;
  f.transport.observeBackupAccount(originalId);
}

test('queued repair cannot begin after an A to B to A account switch', async () => {
  const f = harness();
  f.local.Wallet.push(wallet());
  f.transport.observeBackupAccount(f.app.id);
  let releaseQueue;
  const queueBarrier = new Promise((resolve) => { releaseQueue = resolve; });
  f.transport.withBackupSession(f.app.id, () => queueBarrier);

  const repairing = f.run(true);
  switchAwayAndBack(f);
  releaseQueue();

  assert.equal(await repairing, 'unverified');
  assert.deepEqual(f.calls, [], 'stale queued repair must make no server request');
});

test('caller session captured before async work cannot start a later repair', async () => {
  const f = harness();
  f.local.Wallet.push(wallet());
  f.transport.observeBackupAccount(f.app.id);
  const originalSession = f.transport.currentBackupAccountSession();
  switchAwayAndBack(f);

  const outcome = await f.repair.inspectBackup(f.app.id, true, () => {}, false, originalSession);
  assert.equal(outcome, 'unverified');
  assert.deepEqual(f.calls, []);
});

test('in-flight repair cannot upload after an A to B to A account switch', async () => {
  let reachedSnapshot;
  const snapshotStarted = new Promise((resolve) => { reachedSnapshot = resolve; });
  let releaseSnapshot;
  const snapshotBarrier = new Promise((resolve) => { releaseSnapshot = resolve; });
  let firstSnapshot = true;
  const f = harness({
    post: async ({ path }) => {
      if (path.endsWith('getBackupSnapshot') && firstSnapshot) {
        firstSnapshot = false;
        reachedSnapshot();
        await snapshotBarrier;
      }
    },
  });
  f.local.Wallet.push(wallet());
  f.transport.observeBackupAccount(f.app.id);

  const staleRepair = f.run(true);
  await snapshotStarted;
  switchAwayAndBack(f);
  const freshRepair = f.run(true);
  releaseSnapshot();

  assert.equal(await staleRepair, 'unverified');
  assert.equal(await freshRepair, 'verified', 'new session must inspect independently');
  assert.equal(f.calls.filter((path) => path === 'revisionedBackupMutation').length, 1);
  assert.equal(f.calls.filter((path) => path === 'getBackupSnapshot').length, 3);
});
