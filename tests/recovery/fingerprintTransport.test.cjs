const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadModule, harness, wallet } = require('./helpers.cjs');

const signerChanges = [{
  oldSignerId: 'fixture-old', newSignerId: 'fixture-new', newSignerDetails: 'fixture-ciphertext',
}];

function relay(transport, rest = { post: () => assert.fail('Migration bypassed backup transport') }, errors = []) {
  return loadModule('src/services/backend/Relay.ts', {
    '../backup/transport': transport,
    '../rest/RestClient': rest,
    '../sentry': { captureError: (error) => errors.push(error) },
    'src/services/wallets/enums': {},
    'src/utils/service-utilities/config': { RELAY: 'fixture/' },
    'react-native': { Platform: { OS: 'fixture' } },
  }).default;
}

for (const repair of [false, true]) {
  test(`fingerprint migration waits for ${repair ? 'repair readback' : 'inspection'} and invalidates its completion`, async (t) => {
    let armed = false, reads = 0, release, entered;
    const events = [];
    const readGate = new Promise((resolve) => { release = resolve; });
    const readStarted = new Promise((resolve) => { entered = resolve; });
    t.after(() => release());
    let f;
    let vaults = [], labels = [];
    const revision = () => crypto.createHash('sha256')
      .update(JSON.stringify({ remote: f.remote, vaults, labels })).digest('hex');
    f = harness({
      post: async ({ path }) => {
        if (armed && path.endsWith('getBackupSnapshot')) {
          events.push(`snapshot-request:${++reads}`);
          if (reads === (repair ? 2 : 1)) {
            entered();
            await readGate;
          }
        }
      },
      adapter: (path, payload, config) => {
        assert.ok(config.signal, 'Every backup request must use bounded transport');
        if (path === 'getBackupSnapshot') {
          if (armed) events.push(`snapshot-response:${reads}`);
          return { data: {
            appImage: f.remote, allVaultImages: vaults, labels, revision: revision(),
          } };
        }
        if (path === 'migrateXfps') {
          assert.equal(payload.appId, f.app.id);
          assert.deepEqual(JSON.parse(JSON.stringify(payload.signerChanges)), signerChanges);
          events.push('migration-acknowledged');
          return { data: { updated: true } };
        }
        assert.equal(path, 'repairAppBackup');
        assert.equal(payload.expectedRevision, revision());
        f.remote.wallets = { ...payload.walletObject };
        f.remote.signers = { ...payload.signersObject };
        f.remote.nodes = payload.nodes;
        vaults = Object.values(payload.vaultObject);
        labels = payload.labels;
        f.remote.vaults = vaults.map((record) => record.vaultId);
        f.remote.labels = labels.map((record) => record.id);
        return { data: { updated: true } };
      },
    });
    f.local.Wallet.push(wallet());
    assert.equal(await f.run(true), 'verified');
    if (repair) f.local.Wallet[0].presentationData.name = 'Updated fixture wallet';
    f.calls.length = 0;
    f.phases.length = 0;
    armed = true;
    const checking = f.repair.inspectBackup(f.app.id, repair, (phase) => {
      f.phases.push(phase);
      events.push(`phase:${phase}`);
    });
    await readStarted;
    const previousRevision = f.transport.backupRevision(f.app.id);
    const migration = relay(f.transport).migrateXfp(f.app.id, signerChanges);
    const completed = Promise.allSettled([checking, migration]);
    const requestedRevision = f.transport.backupRevision(f.app.id);
    const migrationStartedDuringCheck = f.calls.includes('migrateXfps');
    release();
    const [checked, migrated] = await completed;
    assert.equal(requestedRevision, previousRevision + 1);
    assert.equal(migrationStartedDuringCheck, false);
    assert.equal(checked.status, 'fulfilled');
    assert.equal(migrated.status, 'fulfilled');
    assert.equal(migrated.value.updated, true);
    if (!repair && checked.value === 'verified') {
      // A read-only retry may verify a new snapshot after queued writes drain.
      // The invalidated first attempt must never publish verified completion.
      assert.deepEqual(f.calls, ['getBackupSnapshot', 'migrateXfps', 'getBackupSnapshot']);
      assert.equal(reads, 2);
      assert.equal(f.phases.filter((phase) => phase === 'verified').length, 1);
      const acknowledged = events.indexOf('migration-acknowledged');
      const freshRequest = events.indexOf('snapshot-request:2');
      const freshResponse = events.indexOf('snapshot-response:2');
      const verified = events.indexOf('phase:verified');
      assert.ok(acknowledged >= 0 && freshRequest > acknowledged);
      assert.ok(freshResponse > freshRequest && verified > freshResponse);
    } else {
      assert.equal(checked.value, 'unverified');
      assert.equal(f.phases.includes('verified'), false);
      assert.deepEqual(f.calls, repair
        ? ['getBackupSnapshot', 'repairAppBackup', 'getBackupSnapshot', 'migrateXfps']
        : ['getBackupSnapshot', 'migrateXfps']);
    }
  });
}

test('migration rejection and transport failure preserve responses, invalidate checks, and release the queue', async () => {
  let fail = false;
  const errors = [];
  const rest = { post: async (_path, _body, _headers, config) => {
    assert.ok(config.signal);
    if (fail) throw Error('fixture request body must stay redacted');
    return { json: { updated: false, err: 'fixture-rejection' } };
  } };
  const transport = loadModule('src/services/backup/transport.ts', { '../rest/RestClient': rest });
  const service = relay(transport, rest, errors);
  assert.deepEqual(JSON.parse(JSON.stringify(await service.migrateXfp('fixture-account', signerChanges))),
    { updated: false, err: 'fixture-rejection' });
  assert.equal(transport.backupRevision('fixture-account'), 1);
  fail = true;
  await assert.rejects(service.migrateXfp('fixture-account', signerChanges),
    /^Error: Failed to do migrate the xfp$/);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'Backup request could not be completed');
  assert.equal(transport.backupRevision('fixture-account'), 2);
  fail = false;
  assert.equal((await service.migrateXfp('fixture-account', signerChanges)).updated, false);
  assert.equal(transport.backupRevision('fixture-account'), 3);
});
