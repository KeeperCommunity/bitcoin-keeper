const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, encryption, wallet, enums } = require('./sagaHarness.cjs');

function commitFixtureRecovery(f, write) {
  const session = f.scope.currentBackupAccountSession();
  const operation = f.scope.beginBackupLocalOperation(f.app.id, {
    appId: f.app.id, accountSession: session,
  }, session);
  const receipt = f.scope.commitBackupLocalOperation(operation, write);
  assert.equal(receipt.committed, true);
  return receipt;
}

test('removing the final node emits an explicit empty-list replacement', async () => {
  const f = fixture();
  f.collections.NodeConnect.push({ id: 'last', host: 'fixture.invalid', port: 50002, isConnected: true });
  const committedOperation = commitFixtureRecovery(f, realm =>
    realm.delete(realm.objectForPrimaryKey('NodeConnect', 'last')));
  await f.run('updateAppImageWorker', { payload: { updateNodes: true }, committedOperation });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1].replaceNodes, true);
  assert.deepEqual(Array.from(f.calls[0][1].nodes), []);
});

test('unrelated wallet update never requests node replacement', async () => {
  const f = fixture();
  const created = wallet('one', enums.NetworkType.MAINNET);
  const committedOperation = commitFixtureRecovery(f, realm => realm.create('Wallet', created));
  await f.run('updateAppImageWorker', { payload: { wallets: [created] }, committedOperation });
  assert.equal(f.calls[0][1].replaceNodes, false);
});

test('node-list replacement encrypts nodes without changing local connection state', async () => {
  const f = fixture();
  const node = { id: 'disposable', host: 'fixture.invalid', port: 50002, isConnected: true };
  const committedOperation = commitFixtureRecovery(f, realm => realm.create('NodeConnect', node));
  await f.run('updateAppImageWorker', { payload: { updateNodes: true }, committedOperation });
  const sent = f.calls[0][1];
  assert.equal(sent.replaceNodes, true);
  const restored = JSON.parse(encryption.decrypt(encryption.generateEncryptionKey(f.app.primarySeed), sent.nodes[0]));
  assert.deepEqual(restored, { ...node, isConnected: false });
  assert.equal(node.isConnected, true);
  assert.equal(f.collections.NodeConnect[0].isConnected, true);
});
