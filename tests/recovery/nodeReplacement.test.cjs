const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, encryption, wallet, enums } = require('./sagaHarness.cjs');

test('removing the final node emits an explicit empty-list replacement', async () => {
  const f = fixture();
  await f.run('updateAppImageWorker', { payload: { updateNodes: true } });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1].replaceNodes, true);
  assert.deepEqual(Array.from(f.calls[0][1].nodes), []);
});

test('unrelated wallet update never requests node replacement', async () => {
  const f = fixture();
  await f.run('updateAppImageWorker', { payload: { wallets: [wallet('one', enums.NetworkType.MAINNET)] } });
  assert.equal(f.calls[0][1].replaceNodes, false);
});

test('node-list replacement encrypts nodes without changing local connection state', async () => {
  const f = fixture();
  const node = { id: 'disposable', host: 'fixture.invalid', port: 50002, isConnected: true };
  f.collections.NodeConnect.push(node);
  await f.run('updateAppImageWorker', { payload: { updateNodes: true } });
  const sent = f.calls[0][1];
  assert.equal(sent.replaceNodes, true);
  const restored = JSON.parse(encryption.decrypt(encryption.generateEncryptionKey(f.app.primarySeed), sent.nodes[0]));
  assert.deepEqual(restored, { ...node, isConnected: false });
  assert.equal(node.isConnected, true);
});
