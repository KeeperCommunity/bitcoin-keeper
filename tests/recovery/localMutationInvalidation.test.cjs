const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, image, harness, wallet, encryption } = require('./helpers.cjs');

function fixture(rows = {}) {
  const { RealmSchema } = loadModule('src/storage/realm/enum.ts');
  const changes = loadModule('src/services/backup/localMutation.ts', {
    'src/storage/realm/enum': { RealmSchema }, './image': image,
  });
  const collections = new Map(Object.entries(rows));
  const list = (schema) => {
    const records = collections.get(schema) || [];
    records.filtered = (_query, id) => records.filter((record) => String(record.id) === String(id));
    return records;
  };
  const realm = {
    get: list,
    write: (callback) => callback(),
    create: (schema, value) => { list(schema).push(value); return true; },
    createBulk: (schema, values) => { list(schema).push(...values); return true; },
    delete: (value) => {
      for (const records of collections.values()) {
        const index = records.indexOf(value);
        if (index >= 0) records.splice(index, 1);
      }
    },
  };
  const manager = loadModule('src/storage/realm/dbManager.ts', {
    './enum': { RealmSchema }, './realm': realm,
    'src/services/backup/localMutation': changes,
  }, { Realm: { UpdateMode: { All: 'all' } } }).default;
  return { manager, RealmSchema, list };
}

function realmRecord(value) {
  const record = { ...value };
  Object.defineProperty(record, 'toJSON', {
    value: () => JSON.parse(JSON.stringify({ ...record })),
  });
  return record;
}

test('Realm recovery writes invalidate before commit while cache-only changes do not', () => {
  const w = realmRecord(wallet());
  const node = realmRecord({ id: 'node', host: 'fixture', isConnected: false });
  const f = fixture({ Wallet: [w], NodeConnect: [node] });
  const seen = [];
  f.manager.setRecoveryMutationObserver(() => seen.push(w.specs.nextFreeAddressIndex));

  const cache = { ...w.specs, balances: { confirmed: 25 }, transactions: [{ txid: 'fixture' }] };
  assert.equal(f.manager.updateObjectById(f.RealmSchema.Wallet, w.id, { specs: cache }), true);
  assert.deepEqual(seen, []);
  assert.equal(f.manager.updateObjectById(f.RealmSchema.NodeConnect, node.id, { isConnected: true }), true);
  assert.deepEqual(seen, []);

  const recovery = { ...w.specs, nextFreeAddressIndex: 2 };
  assert.equal(f.manager.updateObjectById(f.RealmSchema.Wallet, w.id, { specs: recovery }), true);
  assert.deepEqual(seen, [1], 'observer runs before the recovery write commits');
  assert.equal(w.specs.nextFreeAddressIndex, 2);
  assert.equal(f.manager.updateObjectById(f.RealmSchema.Wallet, w.id,
    { presentationData: { name: 'Renamed wallet' } }), true);
  assert.deepEqual(seen, [1, 2]);

  const manualChoice = { txId: 'coin', vout: 0, isManualOverride: true, spendability: 'spendable' };
  assert.equal(f.manager.updateObjectById(f.RealmSchema.Wallet, w.id,
    { specs: { ...w.specs, confirmedUTXOs: [manualChoice] } }), true);
  assert.deepEqual(seen, [1, 2, 2]);
});

test('create, delete, signer, and vault edits invalidate; unrelated Realm records do not', () => {
  const vault = realmRecord({ id: 'vault', archived: false, specs: {}, signers: [] });
  const signer = realmRecord({ id: 'signer', signerPolicy: { limit: 1 } });
  const f = fixture({ Vault: [vault], Signer: [signer], UAI: [] });
  let invalidations = 0;
  f.manager.setRecoveryMutationObserver(() => invalidations++);
  f.manager.updateObjectById(f.RealmSchema.Vault, vault.id, { archived: true });
  f.manager.updateObjectById(f.RealmSchema.Signer, signer.id, { signerPolicy: { limit: 2 } });
  f.manager.createObject(f.RealmSchema.Tags, { id: 'tag', label: 'fixture' });
  f.manager.deleteObjectById(f.RealmSchema.Vault, vault.id);
  f.manager.createObject(f.RealmSchema.UAI, { id: 'notice' });
  assert.equal(invalidations, 4);
});

test('a receive counter mutation at the final verification boundary cannot report verified', async () => {
  const f = harness();
  const w = realmRecord(wallet());
  f.local.Wallet.push(w);
  f.remote.wallets.wallet = encryption.encrypt(
    encryption.generateEncryptionKey(f.app.primarySeed), JSON.stringify(w)
  );
  const db = fixture({ Wallet: f.local.Wallet }).manager;
  let pending = false;
  db.setRecoveryMutationObserver(() => {
    f.transport.markBackupMutation(f.app.id);
    f.transport.clearVerifiedRemoteRevision(f.app.id);
    pending = true;
  });
  const original = image.compareImages;
  let comparisons = 0;
  image.compareImages = async (...args) => {
    const result = await original(...args);
    if (++comparisons === 2) queueMicrotask(() => db.updateObjectById('Wallet', w.id,
      { specs: { ...w.specs, nextFreeAddressIndex: 2 } }));
    return result;
  };
  try {
    assert.equal(await f.run(false), 'unverified');
    assert.equal(w.specs.nextFreeAddressIndex, 2);
    assert.equal(f.transport.backupRevision(f.app.id), 1);
    assert.equal(pending, true);
    assert.deepEqual(f.calls, ['getBackupSnapshot']);
  } finally {
    image.compareImages = original;
  }
});

test('saved USDT receive addresses invalidate recovery trust while refresh status does not', () => {
  const stored = realmRecord({
    ...wallet('usdt'), entityKind: 'USDT_WALLET',
    accountStatus: {
      address: 'disposable-wallet-address', gasFreeAddress: 'disposable-gasfree-address',
      nextNonce: 0, isActive: false, fees: { transferFee: 1, activateFee: 2 },
    },
  });
  const f = fixture({ USDTWallet: [stored] });
  let invalidations = 0;
  f.manager.setRecoveryMutationObserver(() => invalidations++);

  assert.equal(f.manager.updateObjectById(f.RealmSchema.USDTWallet, stored.id, {
    accountStatus: { ...stored.accountStatus, nextNonce: 1, fees: { transferFee: 3, activateFee: 2 } },
  }), true);
  assert.equal(invalidations, 0);
  assert.equal(f.manager.updateObjectById(f.RealmSchema.USDTWallet, stored.id, {
    accountStatus: { ...stored.accountStatus, gasFreeAddress: 'different-saved-address' },
  }), true);
  assert.equal(invalidations, 1);
  assert.equal(f.manager.updateObjectById(f.RealmSchema.USDTWallet, stored.id, {
    accountStatus: { ...stored.accountStatus, address: 'different-wallet-address' },
  }), true);
  assert.equal(invalidations, 2);
});

for (const accountStatus of [
  undefined,
  { address: 'disposable-wallet-address', gasFreeAddress: 'different-saved-address' },
]) test(`USDT remote account status ${accountStatus ? 'different' : 'missing'} is never verified`, async () => {
  const f = harness();
  const localWallet = {
    ...wallet('usdt'), entityKind: 'USDT_WALLET',
    accountStatus: {
      address: 'disposable-wallet-address', gasFreeAddress: 'disposable-gasfree-address',
      nextNonce: 0,
    },
  };
  f.local.USDTWallet.push(localWallet);
  f.remote.wallets[localWallet.id] = encryption.encrypt(
    encryption.generateEncryptionKey(f.app.primarySeed),
    JSON.stringify({ ...localWallet, accountStatus })
  );

  assert.equal(await f.run(false), 'different');
  assert.equal(await f.run(true), 'conflict');
  assert.deepEqual(f.calls, ['getBackupSnapshot', 'getBackupSnapshot']);
  assert.equal(f.phases.includes('verified'), false);
});
