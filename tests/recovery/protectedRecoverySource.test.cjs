// Production recovery discovery/adapter/saga with real image crypto and
// disposable in-memory storage. Authenticated HTTP and native Realm proof live
// in the separate exact-private-Relay genuine lane, not this unit adapter.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, enums, encryption, wallet, loadModule } = require('./sagaHarness.cjs');
const { image } = require('./helpers.cjs');
const { prepareRecoverySourceImage } = loadModule('src/services/backup/restore.ts', { './image': image });
const plain = value => JSON.parse(JSON.stringify(value));
const namespaceId = `bk3_${'ab'.repeat(32)}`;
const legacySelection = { source: 'legacy-older', olderCopyConfirmed: true };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function protectedFixture() {
  const f = fixture();
  const key = encryption.generateEncryptionKey(f.app.primarySeed);
  const record = wallet('protected-wallet', enums.NetworkType.MAINNET);
  const snapshot = {
    scope: 'protected-backup', exists: true, namespaceId, generation: 1, authEpoch: 0,
    revision: 'ab'.repeat(32), backupRevisionRequired: true, incrementalRevisionRequired: true,
    deleted: false, suppressLegacyFallback: false,
    appImage: { ...f.remote, appId: namespaceId, wallets: {
      [record.id]: encryption.encrypt(key, JSON.stringify(record)),
    }, vaults: [], labels: [] },
    allVaultImages: [], labels: [], vaultMaps: [], unavailableVaultIds: [], unavailableLabelIds: [],
  };
  const reads = [];
  f.scope.readProtectedBackup = async (...args) => {
    reads.push(args);
    return { state: snapshot.deleted ? 'deleted' : 'present', namespaceId, snapshot };
  };
  const legacy = f.scope.Relay.getAppImage;
  let legacyReads = 0;
  f.scope.Relay.getAppImage = async (...args) => { legacyReads++; return legacy(...args); };
  let writes = 0;
  const create = f.scope.dbManager.createObject;
  f.scope.dbManager.createObject = (...args) => { writes++; return create(...args); };
  return { ...f, key, record, snapshot, reads, writes: () => writes,
    legacyReads: () => legacyReads,
    restore: selection => f.run('getAppImageWorker', { payload: {
      primaryMnemonic: 'disposable mnemonic', ...(selection ? { selection } : {}),
    } }),
  };
}

test('default protected recovery normalizes namespace only after validation and retains original Keeper identity', async () => {
  const f = protectedFixture();
  const before = plain(f.snapshot);
  await f.restore();
  assert.equal(f.reads.length, 1);
  assert.equal(f.reads[0][2], f.app.id);
  assert.equal(f.legacyReads(), 0);
  assert.equal(f.app.id, f.state.storage.appId);
  assert.notEqual(f.app.id, namespaceId);
  assert.deepEqual(plain(f.collections.Wallet), [f.record]);
  assert.deepEqual(plain(f.snapshot), before, 'raw projection must remain unchanged');
  assert.equal(f.state.bhr.recoveryDiscovery.status, 'restored');
  assert.deepEqual(plain(f.state.bhr.recoveryDiscovery.provenance), {
    source: 'protected', keeperAppId: f.app.id, namespaceId,
    legacyMayPredateDeletion: false, legacyCopiesMayRemain: true,
  });
  assert.equal(f.actions.some(a => a.type === 'setAutomaticCloudBackup' && a.payload.enabled), false);
  assert.equal(f.state.bhr.automaticCloudBackupByAppId[f.app.id], false,
    'validated recovery explicitly revokes inherited opt-in without granting upload authority');
  assert.deepEqual(plain(f.state.bhr.protectedBackupStateByAppId[f.app.id]), {
    status: 'present', namespaceId, generation: 1, authEpoch: 0,
  });
  assert.equal(f.calls.length, 0, 'restoration must not enqueue upload');
});

for (const [state, status] of [['neverEnrolled', 'protected-absent'], ['deleted', 'protected-deleted']]) {
  test(`protected ${state} is an explicit no-write result with no older-copy lookup`, async () => {
    const f = protectedFixture();
    f.scope.readProtectedBackup = async () => ({ state, namespaceId,
      ...(state === 'deleted' ? { snapshot: { ...f.snapshot, deleted: true, suppressLegacyFallback: true } } : {}),
    });
    await f.restore();
    assert.equal(f.state.bhr.recoveryDiscovery.status, status);
    assert.equal(f.state.bhr.recoveryDiscovery.keeperAppId, f.app.id);
    assert.equal(f.writes(), 0);
    assert.equal(f.legacyReads(), 0);
    assert.equal(f.actions.some(a => a.type === 'setAppCreated'), false);
  });
}

test('an authenticated empty enrollment is distinct from absence and never fabricates a restored wallet', async () => {
  const f = protectedFixture();
  f.snapshot.appImage.wallets = {};
  await f.restore();
  assert.equal(f.state.bhr.recoveryDiscovery.status, 'protected-empty');
  assert.equal(f.writes(), 0);
  assert.equal(f.legacyReads(), 0);
});

test('protected request errors stay errors with zero fallback or local mutation', async () => {
  const f = protectedFixture();
  f.scope.readProtectedBackup = async () => { throw new Error('Protected backup request failed'); };
  await f.restore();
  assert.equal(f.state.bhr.recoveryDiscovery.status, 'read-error');
  assert.equal(f.writes(), 0);
  assert.equal(f.legacyReads(), 0);
});

test('explicit older recovery requires its affirmative selection and records older-copy provenance', async () => {
  const invalid = protectedFixture();
  await invalid.restore({ source: 'legacy-older' });
  assert.equal(invalid.state.bhr.recoveryDiscovery.status, 'read-error');
  assert.equal(invalid.writes(), 0);
  assert.equal(invalid.legacyReads(), 0);

  const f = protectedFixture();
  f.remote.wallets = f.snapshot.appImage.wallets;
  await f.restore(legacySelection);
  assert.equal(f.reads.length, 0);
  assert.equal(f.legacyReads(), 1);
  assert.equal(f.state.bhr.recoveryDiscovery.status, 'restored');
  assert.equal(f.state.bhr.recoveryDiscovery.provenance.source, 'legacy-older');
  assert.equal(f.state.bhr.recoveryDiscovery.provenance.legacyMayPredateDeletion, true);
  assert.equal(f.state.bhr.recoveryDiscovery.provenance.namespaceId, undefined);
});

test('protected adapter rejects foreign projection identities before local mutation', async () => {
  for (const corrupt of [
    snapshot => { snapshot.appImage.appId = 'legacy-app-id'; },
    snapshot => { snapshot.allVaultImages = [{ appId: 'foreign-namespace', vaultId: 'foreign', vault: 'ciphertext' }]; },
    snapshot => { snapshot.unavailableLabelIds = ['missing']; },
  ]) {
    const f = protectedFixture();
    corrupt(f.snapshot);
    await f.restore();
    assert.equal(f.state.bhr.recoveryDiscovery.status, 'read-error');
    assert.equal(f.writes(), 0);
    assert.equal(f.legacyReads(), 0);
  }
});

test('all protected records decode before first write, including late corrupt or unavailable references', async () => {
  for (const corrupt of [
    snapshot => { snapshot.appImage.signers = { late: 'unreadable ciphertext' }; },
    snapshot => { snapshot.appImage.nodes = ['unreadable ciphertext']; },
    snapshot => { snapshot.appImage.vaults = ['missing-vault']; },
    snapshot => { snapshot.appImage.labels = ['missing-label']; },
  ]) {
    const f = protectedFixture();
    const before = plain({ app: f.app, collections: f.collections });
    corrupt(f.snapshot);
    await f.restore();
    assert.equal(f.state.bhr.recoveryDiscovery.status, 'read-error');
    assert.equal(f.writes(), 0);
    assert.deepEqual(plain({ app: f.app, collections: f.collections }), before);
  }
});

test('an otherwise empty protected image with missing recovery references is an error rather than empty enrollment', async () => {
  for (const field of ['vaults', 'labels']) {
    const f = protectedFixture();
    f.snapshot.appImage.wallets = {};
    f.snapshot.appImage[field] = ['missing-record'];
    await f.restore();
    assert.equal(f.state.bhr.recoveryDiscovery.status, 'read-error');
    assert.equal(f.writes(), 0);
    assert.equal(f.legacyReads(), 0);
  }
});

test('a recreated protected image remains recoverable without undoing suppression of automatic legacy fallback', () => {
  const f = protectedFixture();
  f.snapshot.suppressLegacyFallback = true;
  const result = prepareRecoverySourceImage(f.app.id, { source: 'protected', namespaceId, response: f.snapshot });
  assert.equal(result.appImage.appId, f.app.id);
  assert.equal(f.snapshot.suppressLegacyFallback, true);
});

test('a protected restore does not overwrite a newer authenticated tombstone hint', async () => {
  const f = protectedFixture();
  f.state.bhr.protectedBackupStateByAppId = { [f.app.id]: {
    status: 'deleted', namespaceId, generation: 2, authEpoch: 1,
  } };
  await f.restore();
  assert.equal(f.state.bhr.recoveryDiscovery.status, 'restored');
  assert.deepEqual(plain(f.state.bhr.protectedBackupStateByAppId[f.app.id]), {
    status: 'deleted', namespaceId, generation: 2, authEpoch: 1,
  });
  assert.equal(f.actions.some(a => a.type === 'setProtectedBackupState'), false);
});

test('explicit older restore never replaces an existing protected tombstone hint', async () => {
  const f = protectedFixture();
  f.state.bhr.protectedBackupStateByAppId = { [f.app.id]: {
    status: 'deleted', namespaceId, generation: 2, authEpoch: 1,
  } };
  f.remote.wallets = f.snapshot.appImage.wallets;
  await f.restore(legacySelection);
  assert.equal(f.state.bhr.recoveryDiscovery.status, 'restored');
  assert.equal(f.state.bhr.protectedBackupStateByAppId[f.app.id].status, 'deleted');
  assert.equal(f.actions.some(a => a.type === 'setProtectedBackupState'), false);
});

test('A to B to A while protected read is queued cannot write or replace current recovery discovery', async () => {
  const f = protectedFixture();
  const entered = deferred();
  const resume = deferred();
  f.scope.readProtectedBackup = async () => {
    entered.resolve(); await resume.promise;
    return { state: 'present', namespaceId, snapshot: f.snapshot };
  };
  const pending = f.restore();
  await entered.promise;
  f.state.storage.appId = 'another-account';
  f.state.storage.appId = f.app.id;
  f.state.bhr.recoveryDiscovery = { status: 'idle', source: 'protected' };
  resume.resolve();
  await pending;
  assert.equal(f.writes(), 0);
  assert.equal(f.state.bhr.recoveryDiscovery.status, 'idle');
  assert.equal(f.legacyReads(), 0);
});

test('a newer discovery supersedes a paused protected response without taking its provenance or starting a restore', async () => {
  const f = protectedFixture();
  const entered = deferred();
  const resume = deferred();
  let requests = 0;
  f.scope.readProtectedBackup = async () => {
    if (++requests === 1) {
      entered.resolve(); await resume.promise;
      return { state: 'present', namespaceId, snapshot: f.snapshot };
    }
    return { state: 'neverEnrolled', namespaceId };
  };
  const old = f.restore();
  await entered.promise;
  await f.restore();
  resume.resolve();
  await old;
  assert.equal(f.state.bhr.recoveryDiscovery.status, 'protected-absent');
  assert.equal(f.writes(), 0);
  assert.equal(f.legacyReads(), 0);
});

test('a post-selection local write failure reports failure in only its owned recovery session and retains committed local data', async () => {
  const f = protectedFixture();
  f.state.storage.appId = 'initial-recovery-screen-account';
  const create = f.scope.dbManager.createObject;
  f.scope.dbManager.createObject = (schema, value) => schema === 'Wallet' ? false : create(schema, value);
  await f.restore();
  assert.equal(f.state.storage.appId, f.app.id, 'the restore selected its original Keeper identity');
  assert.equal(f.app.primaryMnemonic, 'disposable mnemonic', 'committed KeeperApp remains local after later failure');
  assert.equal(f.collections.Wallet.length, 0);
  assert.equal(f.state.bhr.recoveryDiscovery.status, 'read-error');
  assert.equal(f.state.storage.appCreated, undefined);
  assert.equal(f.actions.at(-1).type, 'appImagerecoveryRetry');
  assert.equal(f.legacyReads(), 0);
});

test('a post-selection A to B to A cannot project its local-write failure into a new session', async () => {
  const f = protectedFixture();
  f.state.storage.appId = 'initial-recovery-screen-account';
  const create = f.scope.dbManager.createObject;
  f.scope.dbManager.createObject = (schema, value) => {
    const result = create(schema, value);
    if (schema === 'Wallet') {
      f.state.storage.appId = 'another-account';
      f.state.storage.appId = f.app.id;
      f.state.bhr.recoveryDiscovery = { status: 'idle', source: 'protected' };
    }
    return result;
  };
  await f.restore();
  assert.equal(f.state.bhr.recoveryDiscovery.status, 'idle');
  assert.equal(f.state.storage.appCreated, undefined);
  assert.equal(f.actions.some(a => a.type === 'setAppImageError' && a.payload), false);
  assert.equal(f.collections.Signer.length, 0, 'no later signing keys may cross the stale session');
  assert.equal(f.collections.Wallet.length, 1, 'already committed local recovery data is retained');
});

test('recovery action defaults protected and persisted source hints cannot enable backup consent or verification', () => {
  const actions = loadModule('src/store/sagaActions/bhr.ts');
  assert.deepEqual(plain(actions.getAppImage('fixture', false).payload.selection), { source: 'protected' });
  let persistConfig;
  const reducer = loadModule('src/store/reducers/bhr.ts', {
    'src/models/enums/BHR': loadModule('src/models/enums/BHR.ts'),
    'src/storage': { reduxStorage: {} },
    'redux-persist': { persistReducer: (config, reduce) => { persistConfig = config; return reduce; } },
  });
  let state = reducer.default(undefined, { type: 'fixture/init' });
  const before = plain(state);
  state = reducer.default(state, reducer.setProtectedBackupState({ appId: 'original', state: {
    status: 'deleted', namespaceId, generation: 4, authEpoch: 2,
  } }));
  assert.equal(state.protectedBackupStateByAppId.original.status, 'deleted');
  const { protectedBackupStateByAppId, ...after } = plain(state);
  const { protectedBackupStateByAppId: ignored, ...prior } = before;
  assert.deepEqual(after, prior);
  state = reducer.default(state, reducer.setRecoveryDiscovery({ status: 'restored', source: 'legacy-older' }));
  state = reducer.default(state, reducer.resetRecoveryDiscovery());
  assert.deepEqual(plain(state.recoveryDiscovery), { status: 'idle', source: 'protected' });
  assert.equal(persistConfig.blacklist.includes('recoveryDiscovery'), true);
  assert.equal(persistConfig.blacklist.includes('protectedBackupStateByAppId'), false);
});
