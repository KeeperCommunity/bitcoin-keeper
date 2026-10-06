const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encryption, image, makeImage, harness, wallet } = require('./helpers.cjs');

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
  assert.deepEqual(f.diagnostics, [['Assisted Server Backup check failed at stage:', 'snapshot-request']]);
  assert.ok(!JSON.stringify(f.diagnostics).includes('private-fixture-identifier'));
  assert.deepEqual(f.calls, ['getBackupSnapshot']);
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
