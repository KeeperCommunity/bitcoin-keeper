const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers.cjs');

function fixture() {
  const calls = [];
  const reconciliations = [];
  const transport = loadModule('src/services/backup/transport.ts', {
    '../rest/RestClient': { post: async (...args) => {
      calls.push(args);
      assert.fail('An incremental mutation must not reach Relay without intent fencing');
    } },
  });
  transport.setBackupUploadGuard((appId) => appId === 'A');
  transport.setBackupReconciliationHandler((appId) => reconciliations.push(appId));
  transport.observeBackupAccount('A');
  return { transport, calls, reconciliations };
}

test('all seven incremental operations fail closed and mark pending before any network request', async () => {
  const f = fixture();
  const operations = [
    'updateAppImage', 'migrateXfps', 'deleteAppImageEntity', 'deleteVaults',
    'updateVaultImage', 'modifyLabels', 'deleteBackup',
  ];
  for (const operation of operations) {
    const body = operation === 'updateVaultImage' ? { appID: 'A' } : { appId: 'A' };
    await assert.rejects(
      f.transport.backupPost(`fixture/${operation}`, body, operation === 'deleteBackup'),
      (error) => error.category === 'protocol'
    );
  }
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.reconciliations, operations.map(() => 'A'));
  assert.equal(f.transport.backupRevision('A'), operations.length);
});

test('a prepared payload cannot adopt a revision established by later repair', async () => {
  const f = fixture();
  const oldCiphertext = { appId: 'A', walletsObject: { wallet: 'old-ciphertext' } };
  let release;
  const heldRepair = f.transport.withBackupSession('A', () => new Promise((resolve) => { release = resolve; }));
  const pending = f.transport.backupPost('fixture/updateAppImage', oldCiphertext);
  await assert.rejects(pending, (error) => error.category === 'protocol');
  release();
  await heldRepair;
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.reconciliations, ['A']);
});

test('verified baseline is session bound and invalidated by any attempted mutation', async () => {
  const f = fixture();
  const session = f.transport.currentBackupAccountSession();
  f.transport.recordVerifiedRemoteRevision('A', 'a'.repeat(64), session,
    { namespaceId: 'unit-protected-A', revision: 'a'.repeat(64), generation: 0, authEpoch: 0 });
  const first = f.transport.captureBackupWriteIntent('A');
  assert.equal(first.baseRevision, 'a'.repeat(64));
  assert.equal(first.accountSession, session);
  await assert.rejects(f.transport.backupPost('fixture/updateAppImage', { appId: 'A' }),
    (error) => error.category === 'protocol');
  assert.equal(f.transport.captureBackupWriteIntent('A'), undefined);
  f.transport.recordVerifiedRemoteRevision('A', 'b'.repeat(64), session,
    { namespaceId: 'unit-protected-A', revision: 'b'.repeat(64), generation: 1, authEpoch: 0 });
  const next = f.transport.captureBackupWriteIntent('A');
  assert.ok(next.baselineEpoch > first.baselineEpoch);
  f.transport.observeBackupAccount('B');
  f.transport.observeBackupAccount('A');
  assert.equal(f.transport.captureBackupWriteIntent('A'), undefined);
  assert.deepEqual(f.calls, []);
});

test('stale sessions and denied accounts also request reconciliation', async () => {
  const f = fixture();
  const firstSession = f.transport.currentBackupAccountSession();
  const oldIntent = { appId: 'A', accountSession: firstSession,
    baseRevision: 'a'.repeat(64), baselineEpoch: 0 };
  f.transport.observeBackupAccount('B');
  f.transport.observeBackupAccount('A');
  await assert.rejects(
    f.transport.backupPost('fixture/migrateXfps', { appId: 'A' }, false, oldIntent),
    /Backup account session changed/
  );
  await assert.rejects(
    f.transport.backupPost('fixture/updateAppImage', { appId: 'B' }),
    /Backup account is not active or opted in/
  );
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.reconciliations, ['A', 'B']);
  assert.equal(f.transport.backupRevision('A'), 1);
  assert.equal(f.transport.backupRevision('B'), 1);
});

test('the old full writer remains disabled', async () => {
  const f = fixture();
  await assert.rejects(
    f.transport.backupPost('fixture/backupAllSignersAndVaults', { appId: 'A' }),
    (error) => error.category === 'protocol'
  );
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.reconciliations, ['A']);
});
