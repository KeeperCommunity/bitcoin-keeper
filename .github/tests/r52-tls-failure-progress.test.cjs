'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Executes the real probe's async coordinator body. Native socket/RPC calls and
// RNFS are explicit source-bound mocks; these controls are not native TLS tests.
const source = fs.readFileSync(path.join(__dirname, '../native/r52_tls_probe.js'), 'utf8');
const start = source.indexOf('execution = (async () => {');
const end = source.indexOf('    execution.then(value', start);
assert.ok(start >= 0 && end > start);
const coordinator = source.slice(start, end) + '\nexecution;';
function run({ platform = 'ANDROID', probe, rpc, write } = {}) {
  const writes = [], probes = [];
  const fixture = { schema: 1, platform, nonce: 'a'.repeat(48), cases: [
    { id: 'valid', expected: 'ACCEPT' }, { id: 'expired', expected: 'REJECT' },
  ] };
  const context = { __DEV__: true, execution: undefined, fixture,
    Platform: { OS: platform.toLowerCase() },
    RNFS: { DocumentDirectoryPath: '/owned-app', async writeFile(name, raw) {
      if (write) await write(name, raw);
      writes.push({ kind: name.endsWith('progress.json') ? 'progress' : 'final', data: JSON.parse(raw) });
    } },
    async probe(row) {
      probes.push(row.id);
      if (probe) return probe(row, writes);
      return { id: row.id, outcome: row.expected, connected: row.expected === 'ACCEPT' };
    },
    require(name) {
      assert.equal(name, './r52_rpc_probe');
      return { runActualRpc: rpc || (async () => ({ status: 'PASS', cases: [] })) };
    },
  };
  const promise = vm.runInNewContext(coordinator, context);
  return { promise, writes, probes };
}

test('real coordinator writes bound Android phase/case progress and unchanged final shape', async () => {
  const result = run();
  assert.equal(await result.promise, 'pass');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result.probes, ['valid', 'expired']);
  assert.deepEqual(result.writes.filter(row => row.kind === 'progress').map(row => row.data.phase), ['TLS', 'TLS', 'RPC', 'WRITE', 'WRITE']);
  assert.deepEqual(result.writes.filter(row => row.kind === 'progress').map(row => row.data.cases.length), [0, 1, 2, 2, 2]);
  const final = result.writes.find(row => row.kind === 'final').data;
  assert.equal(final.status, 'PASS');
  assert.deepEqual(Object.keys(final).sort(), ['cases', 'nonce', 'platform', 'rpc', 'schema', 'scope', 'status', 'transport_status']);
  assert.equal(result.writes.at(-1).data.state, 'COMPLETE');
});

test('completed mismatch remains FAIL and does not run RPC', async () => {
  const result = run({ probe: async row => ({ id: row.id, outcome: 'TIMEOUT', connected: false }),
    rpc: () => { throw new Error('RPC must not run after failed TLS'); } });
  assert.equal(await result.promise, 'failed');
  const final = result.writes.find(row => row.kind === 'final').data;
  assert.equal(final.status, 'FAIL');
  assert.equal(final.rpc.status, 'NOT RUN');
  assert.equal(final.cases.length, 2);
});

test('coordinator exception records only fixed state and entered case', async () => {
  const result = run({ probe: () => { throw new Error('PRIVATE_SECRET'); } });
  assert.equal(await result.promise, 'failed');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(result.writes.at(-1).data.state, 'EXCEPTION');
  assert.equal(result.writes.at(-1).data.active_case, 'valid');
  assert.equal(result.writes.some(row => row.kind === 'final'), false);
  assert.equal(JSON.stringify(result.writes).includes('PRIVATE_SECRET'), false);
});

test('unfinished RPC preserves completed TLS rows and RPC phase without fabricating final evidence', async () => {
  let finish;
  const result = run({ rpc: () => new Promise(resolve => { finish = resolve; }) });
  await new Promise(resolve => setImmediate(resolve));
  const progress = result.writes.at(-1).data;
  assert.equal(progress.phase, 'RPC');
  assert.equal(progress.state, 'RUNNING');
  assert.equal(progress.cases.length, 2);
  assert.equal(result.writes.some(row => row.kind === 'final'), false);
  finish({ status: 'FAIL', failure: 'RPC_APP_TIMEOUT', cases: [] });
  assert.equal(await result.promise, 'failed');
});

test('rejected or never-settling progress I/O cannot block original cases RPC or authoritative receipt', async () => {
  for (const stall of [false, true]) {
    let rpcCalls = 0;
    const result = run({
      write: name => name.endsWith('progress.json') ? (stall ? new Promise(() => {}) : Promise.reject(new Error('PRIVATE_SECRET'))) : undefined,
      rpc: async () => { rpcCalls++; return { status: 'PASS', cases: [] }; },
    });
    assert.equal(await result.promise, 'pass');
    assert.deepEqual(result.probes, ['valid', 'expired']);
    assert.equal(rpcCalls, 1);
    assert.equal(result.writes.find(row => row.kind === 'final').data.status, 'PASS');
    assert.equal(JSON.stringify(result.writes).includes('PRIVATE_SECRET'), false);
    const failed = run({
      write: name => name.endsWith('progress.json') ? (stall ? new Promise(() => {}) : Promise.reject(new Error('PRIVATE_SECRET'))) : undefined,
      probe: async row => ({ id: row.id, outcome: 'TIMEOUT', connected: false }),
    });
    assert.equal(await failed.promise, 'failed');
    assert.equal(failed.writes.find(row => row.kind === 'final').data.status, 'FAIL');
  }
});

test('authoritative receipt failure still fails and iOS keeps original final-only writes', async () => {
  const broken = run({ write: name => name.endsWith('evidence.json') ? Promise.reject(new Error('PRIVATE_SECRET')) : undefined });
  assert.equal(await broken.promise, 'failed');
  assert.equal(broken.writes.some(row => row.kind === 'final'), false);
  const ios = run({ platform: 'IOS' });
  assert.equal(await ios.promise, 'pass');
  assert.deepEqual(ios.writes.map(row => row.kind), ['final']);
});
