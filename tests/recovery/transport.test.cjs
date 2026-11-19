const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, harness, wallet } = require('./helpers.cjs');

function fakeTransport() {
  let now = 0, next = 0, config;
  const timers = new Map();
  const module = loadModule('src/services/backup/transport.ts', {
    '../rest/RestClient': { post: (_path, _body, _headers, options) => {
      config = options;
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('secret request body'))));
    } },
  }, { Date: { now: () => now }, setTimeout: (fn, ms) => { const id = ++next; timers.set(id, { at:now+ms, fn }); return id; }, clearTimeout: id => timers.delete(id) });
  const tick = (ms) => {
    const until = now+ms;
    while (true) {
      const first = [...timers.entries()].filter(([,t]) => t.at <= until).sort((a,b) => a[1].at-b[1].at)[0];
      if (!first) break;
      now = first[1].at; timers.delete(first[0]); first[1].fn();
    }
    now = until;
  };
  return { module, tick, get config() { return config; }, timers };
}

test('stalled transport aborts after 30 seconds and redacts request errors', async () => {
  const f = fakeTransport(); const promise = f.module.boundedBackupPost('fixture', {});
  f.tick(29999); assert.equal(f.config.signal.aborted,false); f.tick(1);
  await assert.rejects(promise, /^Error: Backup request could not be completed$/); assert.equal(f.timers.size,0);
});

test('only real progress resets stall clock; active transfer still has overall deadline', async () => {
  const f = fakeTransport(); const promise = f.module.boundedBackupPost('fixture', {});
  for (let n=1;n<30;n++) { f.tick(20000); f.config.onDownloadProgress({ loaded:n }); }
  assert.equal(f.config.signal.aborted,false); f.tick(20000);
  assert.equal(f.config.signal.aborted,true); await assert.rejects(promise); assert.equal(f.timers.size,0);
  const g = fakeTransport(); const stalled = g.module.boundedBackupPost('fixture', {});
  g.tick(20000); g.config.onUploadProgress({ loaded:0 }); g.tick(10000); await assert.rejects(stalled);
});

test('same-account writes serialize, another account runs independently, rejected queue recovers', async () => {
  const f = fakeTransport(); const order = []; let release;
  const first = f.module.withBackupSession('a', () => new Promise(resolve => { order.push('first'); release=resolve; }));
  const next = f.module.withBackupSession('a', async () => { order.push('next'); throw Error('fixture'); });
  const recovered = f.module.withBackupSession('a', async () => order.push('recovered'));
  await f.module.withBackupSession('b', async () => order.push('other'));
  assert.deepEqual(order,['first','other']); release(); await first; await assert.rejects(next); await recovered;
  assert.deepEqual(order,['first','other','next','recovered']);
});

test('repeated repair actions share one upload and readback', async () => {
  const f = harness(); f.local.Wallet.push(wallet());
  const results = await Promise.all([f.run(true),f.run(true),f.run(true)]);
  assert.deepEqual(results,['verified','verified','verified']);
  assert.deepEqual(f.calls,['getBackupSnapshot','repairAppBackup','getBackupSnapshot']);
});
