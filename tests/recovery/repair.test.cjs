const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encryption, image, makeImage, harness, wallet, loadModule } = require('./helpers.cjs');

test('upgrade check detects omissions without uploading; explicit repair verifies readback', async () => {
  const f = harness(); f.local.Wallet.push(wallet());
  assert.equal(await f.run(), 'different'); assert.deepEqual(f.calls, ['getBackupSnapshot']);
  assert.equal(await f.run(true), 'verified');
  assert.deepEqual(f.phases, ['checking','different','checking','preparing','uploading','verifying','verified']);
  assert.deepEqual(JSON.parse(encryption.decrypt(encryption.generateEncryptionKey(f.app.primarySeed), f.remote.wallets.wallet)), wallet());
});

test('matching upgrade only reads and does not reupload', async () => {
  const f = harness(); f.local.Wallet.push(wallet()); await f.run(true); f.calls.length = 0;
  assert.equal(await f.run(), 'verified'); assert.deepEqual(f.calls, ['getBackupSnapshot']);
});

for (const failure of ['readError','reject','corruptWrite']) test(`${failure} never claims success`, async () => {
  const f = harness({ [failure]: true }); f.local.Wallet.push(wallet());
  assert.equal(await f.run(true), 'unverified'); assert.ok(!f.phases.includes('verified'));
  if (failure === 'readError') assert.deepEqual(f.calls, ['getBackupSnapshot']);
});

test('read-only failure identifies its stage without logging error contents or backup identifiers', async () => {
  const f = harness({ adapter: async () => { throw Error('private-fixture-identifier'); } });
  f.local.Wallet.push(wallet());
  assert.equal(await f.run(), 'unverified');
  assert.deepEqual(f.diagnostics, [['Assisted Server Backup check failed at stage:', 'snapshot-request', 'other']]);
  assert.ok(!JSON.stringify(f.diagnostics).includes('private-fixture-identifier'));
  assert.deepEqual(f.calls, ['getBackupSnapshot']);
});

for (const [error, category] of [
  [{ response: { status: 404, data: 'private-fixture-identifier' }, config: { headers: { Authorization: 'private-fixture-identifier' } } }, 'http-4xx'],
  [{ response: { status: 503, data: 'private-fixture-identifier' } }, 'http-5xx'],
  [{ code: 'ECONNABORTED', message: 'private-fixture-identifier' }, 'timeout'],
  [{ code: 'ERR_NETWORK', message: 'private-fixture-identifier' }, 'network'],
]) test(`snapshot transport diagnostics classify ${category} without request data`, async () => {
  const f = harness({ adapter: async () => { throw error; } });
  assert.equal(await f.run(), 'unverified');
  assert.deepEqual(f.diagnostics, [['Assisted Server Backup check failed at stage:', 'snapshot-request', category]]);
  assert.ok(!JSON.stringify(f.diagnostics).includes('private-fixture-identifier'));
});

for (const [error, category] of [
  [{ response: { status: 503, data: 'private-fixture-identifier' } }, 'http-5xx'],
  [{ code: 'ERR_NETWORK', message: 'private-fixture-identifier' }, 'network'],
  [{ code: 'ECONNABORTED', message: 'private-fixture-identifier' }, 'timeout'],
]) test(`read-only ${category} failure retries once and verifies the existing backup without upload`, async () => {
  let calls = 0;
  const f = harness({ post: async ({ path }) => {
    if (path.endsWith('getBackupSnapshot') && ++calls === 1) throw error;
  } });
  assert.equal(await f.run(), 'verified');
  assert.deepEqual(f.calls, ['getBackupSnapshot', 'getBackupSnapshot']);
  assert.deepEqual(f.phases, ['checking', 'checking', 'verified']);
  assert.deepEqual(f.diagnostics, []);
});

for (const os of ['ios', 'android']) test(`${os} RestClient preserves the read-only retry and abortable transport`, async () => {
  const requests = [];
  const rest = loadModule('src/services/rest/RestClient.ts', {
    axios: { post: async (path, body, options) => {
      requests.push({ path, body, options });
      if (requests.length === 1) throw { code: 'ERR_NETWORK' };
      return { data: {
        appImage: { appId: 'disposable', wallets: {}, signers: {}, nodes: [], vaults: [], labels: [] },
        allVaultImages: [], labels: [], revision: 'a'.repeat(64),
      } };
    } },
    'react-native-device-info': { getVersion: () => 'fixture', getBuildNumber: () => 'fixture' },
    'react-native': { Platform: { OS: os } },
    'src/utils/service-utilities/config': { HEXA_ID: 'fixture-only' },
  }).default;
  const f = harness({ adapter: (path, body, options) => rest.post(path, body, undefined, options) });
  assert.equal(await f.run(), 'verified');
  assert.deepEqual(requests.map(({ path }) => path), ['getBackupSnapshot', 'getBackupSnapshot']);
  for (const { body, options } of requests) {
    assert.deepEqual(Object.keys(body), ['appId']);
    assert.equal(options.headers.os, os);
    assert.equal(options.signal.aborted, false);
    assert.equal(typeof options.onDownloadProgress, 'function');
  }
});

test('read-only retry shares the first attempt deadline', async () => {
  let now = 0, reads = 0;
  const f = harness({ now: () => now, post: async ({ path }) => {
    if (path.endsWith('getBackupSnapshot')) {
      now += 300_000;
      if (++reads === 1) throw { code: 'ERR_NETWORK' };
    }
  } });
  assert.equal(await f.run(), 'unverified');
  assert.deepEqual(f.calls, ['getBackupSnapshot', 'getBackupSnapshot']);
  assert.deepEqual(f.phases, ['checking', 'checking', 'unverified']);
});

test('expired inspection makes no transient retry', async () => {
  let now = 0;
  const f = harness({ now: () => now, post: async () => {
    now = 600_000;
    throw { code: 'ERR_NETWORK' };
  } });
  assert.equal(await f.run(), 'unverified');
  assert.deepEqual(f.calls, ['getBackupSnapshot']);
});

test('persistent network failures stop after one read-only retry', async () => {
  const f = harness({ adapter: async () => { throw { code: 'ERR_NETWORK' }; } });
  assert.equal(await f.run(), 'unverified');
  assert.deepEqual(f.calls, ['getBackupSnapshot', 'getBackupSnapshot']);
  assert.deepEqual(f.phases, ['checking', 'checking', 'unverified']);
  assert.deepEqual(f.diagnostics, [['Assisted Server Backup check failed at stage:', 'snapshot-request', 'network']]);
});

test('4xx responses and invalid snapshots never retry', async () => {
  for (const options of [
    { adapter: async () => { throw { response: { status: 404 } }; } },
    { response: { revision: 'a'.repeat(64) } },
  ]) {
    const f = harness(options);
    assert.equal(await f.run(), 'unverified');
    assert.deepEqual(f.calls, ['getBackupSnapshot']);
  }
});

test('transient snapshot failure after account switch makes no retry or upload', async () => {
  const f = harness({ post: async ({ app }) => {
    app.id = 'second';
    throw { code: 'ERR_NETWORK' };
  } });
  assert.equal(await f.run(), 'unverified');
  assert.deepEqual(f.calls, ['getBackupSnapshot']);
});

test('repair does not retry a failed snapshot request', async () => {
  const f = harness({ adapter: async () => { throw { code: 'ERR_NETWORK' }; } });
  f.local.Wallet.push(wallet());
  assert.equal(await f.run(true), 'unverified');
  assert.deepEqual(f.calls, ['getBackupSnapshot']);
});

test('read-only check retries once after a concurrent incremental backup changes its revision', async () => {
  let f, changed = false, write;
  f = harness({ post: async ({ path, remote }) => {
    if (path.endsWith('getBackupSnapshot') && !changed) {
      changed = true;
      write = f.transport.backupPost('fixture/updateAppImage', { appId: f.app.id });
    }
    if (path.endsWith('updateAppImage')) {
      remote.wallets.wallet = encryption.encrypt(
        encryption.generateEncryptionKey(f.app.primarySeed), JSON.stringify(wallet())
      );
    }
  } });
  f.local.Wallet.push(wallet());
  assert.equal(await f.run(), 'verified');
  await write;
  assert.deepEqual(f.calls, ['getBackupSnapshot', 'updateAppImage', 'getBackupSnapshot']);
  assert.deepEqual(f.phases, ['checking', 'checking', 'verified']);
  assert.deepEqual(f.diagnostics, []);
});

test('early revision change without a queued write stays unverified', async () => {
  let f;
  f = harness({ post: async ({ path }) => {
    if (path.endsWith('getBackupSnapshot')) f.transport.markBackupMutation(f.app.id);
  } });
  f.local.Wallet.push(wallet());
  assert.equal(await f.run(), 'unverified');
  assert.deepEqual(f.calls, ['getBackupSnapshot']);
  assert.deepEqual(f.phases, ['checking', 'unverified']);
});

test('continuous queued writes limit a read-only check to one retry', async () => {
  let f;
  const writes = [];
  f = harness({ post: async ({ path }) => {
    if (path.endsWith('getBackupSnapshot'))
      writes.push(f.transport.backupPost('fixture/updateAppImage', { appId: f.app.id }));
  } });
  f.local.Wallet.push(wallet());
  assert.equal(await f.run(), 'unverified');
  await Promise.all(writes);
  assert.equal(f.calls.filter((path) => path === 'getBackupSnapshot').length, 2);
  assert.deepEqual(f.phases, ['checking', 'checking', 'unverified']);
});

test('lost upload acknowledgement is resolved by readback without duplicate upload', async () => {
  const f = harness({ lostResponse: true }); f.local.Wallet.push(wallet());
  assert.equal(await f.run(true), 'verified'); assert.deepEqual(f.calls, ['getBackupSnapshot','repairAppBackup','getBackupSnapshot']);
});

test('server-only wallet needs user action, then repair removes it and verifies readback', async () => {
  const f = harness({ post: async ({ path, payload }) => {
    if (path.endsWith('repairAppBackup')) assert.equal(payload.replaceCurrentState, true);
  } }); f.remote.wallets.other = encryption.encrypt(encryption.generateEncryptionKey(f.app.primarySeed), JSON.stringify(wallet('other')));
  assert.equal(await f.run(), 'different'); assert.deepEqual(f.calls, ['getBackupSnapshot']); assert.ok(f.remote.wallets.other);
  assert.equal(await f.run(true), 'verified'); assert.deepEqual(f.calls.slice(1), ['getBackupSnapshot','repairAppBackup','getBackupSnapshot']);
  assert.equal(f.remote.wallets.other, undefined);
});

test('current-state repair keeps hidden keys and archived wallets while dropping deleted records', async () => {
  const f = harness();
  const key = encryption.generateEncryptionKey(f.app.primarySeed);
  f.local.Signer.push({ id:'hidden-key', masterFingerprint:'hidden', signerXpubs:{}, hidden:true });
  f.local.Vault.push({ ...wallet('archived'), archived:true, signers:[], scheme:{m:1,n:1} });
  f.remote.wallets.deleted = encryption.encrypt(key, JSON.stringify(wallet('deleted')));
  assert.equal(await f.run(), 'different');
  assert.equal(await f.run(true), 'verified');
  assert.equal(f.remote.wallets.deleted, undefined);
  assert.equal(JSON.parse(encryption.decrypt(key, f.remote.signers['hidden-key'])).hidden, true);
  assert.deepEqual(f.remote.vaults, ['archived']);
});

test('same IDs with different recovery keys are a conflict', async () => {
  const l = makeImage(), r = makeImage(); l.wallets.a = wallet(); r.wallets.a = wallet(); r.wallets.a.specs.xpub = 'other';
  assert.equal(await image.compareImages(l, r), 'conflict');
});

test('same IDs with changed user metadata require an update', async () => {
  const l = makeImage(), r = makeImage(); l.wallets.a = wallet(); r.wallets.a = wallet(); r.wallets.a.presentationData.name = 'Old';
  assert.equal(await image.compareImages(l, r), 'different');
});

test('canonical comparison ignores object order and chain caches but retains address counters', async () => {
  const l = makeImage(), r = makeImage(); l.wallets.a = wallet(); r.wallets.a = wallet(); r.wallets.a.specs.balances.confirmed = 100;
  assert.equal(await image.compareImages(l, r), 'matched'); r.wallets.a.specs.nextFreeAddressIndex = 2;
  assert.equal(await image.compareImages(l, r), 'conflict');
  assert.equal(image.canonical({ b:2,a:1 }), image.canonical({ a:1,b:2 }));
});

test('BTC both networks, USDT, vaults, keys, labels and nodes are verified without mutating local data', async () => {
  const f = harness(); f.local.Wallet.push(wallet('main'), wallet('test','TESTNET'));
  f.local.USDTWallet.push({ ...wallet('usdt'), specs: { privateKey:'fixture-only', address:'fixture-only' } });
  f.local.Signer.push({ id:'signer', masterFingerprint:'fixture', signerXpubs:{} });
  f.local.Vault.push({ ...wallet('vault'), archived:true, signers:[{ masterFingerprint:'fixture' }], scheme:{m:1,n:1} });
  f.local.Tags.push({ id:'tag', label:'label', ref:'tx', type:'TXN' }); f.local.NodeConnect.push({ id:'node', isConnected:true, host:'fixture' });
  const before = JSON.stringify(f.local);
  assert.equal(await f.run(true), 'verified'); assert.equal(JSON.stringify(f.local), before);
  assert.deepEqual(Object.keys(f.remote.wallets).sort(), ['main','test','usdt']);
});

test('malformed or partial server response is unavailable, never an empty snapshot', async () => {
  for (const response of [{}, { appImage:{} }, { appImage:{appId:'another',wallets:{},signers:{},nodes:[]}, allVaultImages:[],labels:[] }]) {
    const f = harness({ response }); f.local.Wallet.push(wallet());
    assert.equal(await f.run(true), 'unverified'); assert.deepEqual(f.calls, ['getBackupSnapshot']);
  }
});

test('mutation arriving during upload invalidates completion and remains queued until readback', async () => {
  let f;
  f = harness({ post: async ({ path }) => { if (path.endsWith('repairAppBackup')) f.transport.markBackupMutation(f.app.id); } });
  f.local.Wallet.push(wallet()); assert.equal(await f.run(true), 'unverified'); assert.ok(!f.phases.includes('verified'));
  assert.deepEqual(f.calls, ['getBackupSnapshot', 'repairAppBackup', 'getBackupSnapshot']);
});

test('account switch during check cannot upload one account with another account data', async () => {
  const f = harness({ post: async ({ app }) => { app.id = 'second'; } }); f.local.Wallet.push(wallet());
  assert.equal(await f.run(true), 'unverified'); assert.deepEqual(f.calls, ['getBackupSnapshot']);
});

test('chunked encryption remains compatible with existing recovery including Unicode', async () => {
  const record = { id:'fixture', text: ('A'.repeat(16370) + '🔑বাংলা').repeat(5) };
  let yielded = false; setTimeout(() => { yielded = true; }, 0);
  const cipher = await image.encryptRecord('test-only', record);
  assert.equal(yielded, true); assert.deepEqual(JSON.parse(encryption.decrypt('test-only',cipher)),record);
  assert.deepEqual(JSON.parse(JSON.stringify(await image.decryptRecord('test-only',cipher))), record);
});

test('existing large CryptoJS ciphertext remains readable by streamed backup verification', async () => {
  const record = { id: 'legacy-large', text: 'a'.repeat(100_000) + '🔑বাংলা' };
  const ciphertext = encryption.encrypt('test-only', JSON.stringify(record));
  assert.equal(JSON.stringify(await image.decryptRecord('test-only', ciphertext)), JSON.stringify(record));
});

test('oversized record fails without uploading or truncating', async () => {
  const f = harness(); f.local.Wallet.push({ ...wallet(), text:'x'.repeat(image.MAX_RECORD_BYTES) });
  assert.equal(await f.run(true),'unverified'); assert.deepEqual(f.calls,[]);
});


test('server change after read rejects stale upload and preserves remote data', async () => {
  const f = harness({ post: async ({ path, remote }) => {
    if (path.endsWith('repairAppBackup')) remote.wallets.other = 'new-device-encrypted-data';
  } });
  f.local.Wallet.push(wallet());
  assert.equal(await f.run(true), 'unverified');
  assert.equal(f.remote.wallets.other, 'new-device-encrypted-data');
  assert.equal(f.remote.wallets.wallet, undefined);
});

test('relay without revision support fails closed without legacy replacement', async () => {
  const f = harness({ response: { appImage:{appId:'disposable',wallets:{},signers:{},nodes:[],vaults:[],labels:[]},allVaultImages:[],labels:[] } });
  f.local.Wallet.push(wallet());
  assert.equal(await f.run(true), 'unverified');
  assert.deepEqual(f.calls, ['getBackupSnapshot']);
});

test('archived vault is uploaded with archived server metadata', async () => {
  let archived;
  const f = harness({ post: async ({ path,payload }) => {
    if (path.endsWith('repairAppBackup')) archived=payload.vaultObject.vault.isArchived;
  } });
  f.local.Vault.push({ ...wallet('vault'), archived:true,signers:[],scheme:{m:1,n:1} });
  assert.equal(await f.run(true), 'verified');
  assert.equal(archived,true);
});
