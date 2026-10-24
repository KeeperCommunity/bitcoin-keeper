// User-initiated diagnostics retain only fixed enums, bounded timing and HTTP
// status, never the original error/body or a previous account session's result.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, harness } = require('./helpers.cjs');
const plain = (value) => JSON.parse(JSON.stringify(value));

function transportWithFailure(error) {
  return loadModule('src/services/backup/transport.ts', {
    '../rest/RestClient': {
      post: async () => {
        throw error;
      },
    },
  });
}

test('HTTP failure exposes status and fixed category without retaining private transport data', async () => {
  const secret = 'private-body-header-account-token';
  const t = transportWithFailure({
    response: { status: 403, data: secret },
    config: { headers: { Authorization: secret }, data: secret },
    message: secret,
  });
  t.observeBackupAccount('disposable-account');
  let failure;
  try {
    await t.boundedBackupPost('https://disposable.invalid', {});
  } catch (error) {
    failure = error;
  }
  t.recordBackupDiagnostic(
    'disposable-account',
    t.currentBackupAccountSession(),
    'check',
    'snapshot-request',
    failure,
    Date.now() - 25
  );
  const diagnostic = plain(t.getBackupDiagnostic('disposable-account'));
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    'category',
    'elapsedMs',
    'httpStatus',
    'operation',
    'stage',
  ]);
  assert.equal(diagnostic.operation, 'check');
  assert.equal(diagnostic.stage, 'snapshot-request');
  assert.equal(diagnostic.category, 'http-4xx');
  assert.equal(diagnostic.httpStatus, 403);
  assert.ok(diagnostic.elapsedMs >= 25 && diagnostic.elapsedMs <= t.BACKUP_DEADLINE_MS);
  assert.equal(JSON.stringify({ failure, diagnostic }).includes(secret), false);
  assert.equal(Object.isFrozen(t.getBackupDiagnostic('disposable-account')), true);
});

test('unknown errors cannot project arbitrary messages or invalid statuses into diagnostic output', () => {
  const t = transportWithFailure();
  t.observeBackupAccount('A');
  const session = t.currentBackupAccountSession();
  for (const httpStatus of ['403', 399, 600, 403.5, NaN, Infinity, undefined]) {
    t.recordBackupDiagnostic(
      'A',
      session,
      'delete',
      'delete-upload',
      new t.BackupRequestError('other', httpStatus),
      Date.now() - 1e9
    );
    const diagnostic = t.getBackupDiagnostic('A');
    assert.equal(diagnostic.httpStatus, undefined);
    assert.equal(diagnostic.elapsedMs, t.BACKUP_DEADLINE_MS);
  }
  t.recordBackupDiagnostic(
    'A',
    session,
    'delete',
    'delete-validation',
    { message: 'private fixture', response: { status: 403 } },
    Date.now() + 500
  );
  assert.deepEqual(plain(t.getBackupDiagnostic('A')), {
    operation: 'delete',
    stage: 'delete-validation',
    category: 'non-transport',
    elapsedMs: 0,
  });
});

test('authority and endpoint sentinels have fixed categories without exposing caught messages', () => {
  const t = transportWithFailure();
  t.observeBackupAccount('A');
  for (const [message, category] of [
    ['PROTECTED_BACKUP_AUTHORITY_UNAVAILABLE', 'authority-unavailable'],
    ['Invalid protected backup endpoint', 'endpoint-configuration'],
    ['Protected backup requires HTTPS', 'endpoint-configuration'],
    ['Invalid protected backup response', 'protocol'],
  ]) {
    t.recordBackupDiagnostic(
      'A',
      t.currentBackupAccountSession(),
      'check',
      'snapshot-request',
      new Error(message),
      Date.now()
    );
    const diagnostic = t.getBackupDiagnostic('A');
    assert.equal(diagnostic.category, category);
    assert.equal(JSON.stringify(diagnostic).includes(message), false);
  }
});

test('not-enrolled guidance requires the internal authenticated-absence error, never a matching arbitrary message', () => {
  const t = transportWithFailure();
  t.observeBackupAccount('A');
  for (const error of [
    new Error('Protected backup is not enrolled'),
    { message: 'Protected backup is not enrolled' },
  ]) {
    t.recordBackupDiagnostic(
      'A',
      t.currentBackupAccountSession(),
      'delete',
      'snapshot-request',
      error,
      Date.now()
    );
    assert.equal(t.getBackupDiagnostic('A').category, 'non-transport');
  }
  t.recordBackupDiagnostic(
    'A',
    t.currentBackupAccountSession(),
    'delete',
    'snapshot-request',
    t.backupNotEnrolledError(),
    Date.now()
  );
  assert.equal(t.getBackupDiagnostic('A').category, 'never-enrolled');
});

test('diagnostics expire across A to B to A and stale completion cannot clear or replace a newer result', () => {
  const t = transportWithFailure();
  t.observeBackupAccount('A');
  const oldSession = t.currentBackupAccountSession();
  t.recordBackupDiagnostic(
    'A',
    oldSession,
    'check',
    'snapshot-request',
    Error('private'),
    Date.now()
  );
  assert.ok(t.getBackupDiagnostic('A'));
  assert.equal(t.getBackupDiagnostic('B'), undefined);
  t.observeBackupAccount('B');
  t.observeBackupAccount('A');
  assert.equal(t.getBackupDiagnostic('A'), undefined);
  const currentSession = t.currentBackupAccountSession();
  t.recordBackupDiagnostic(
    'A',
    currentSession,
    'delete',
    'delete-readback',
    Error('private'),
    Date.now()
  );
  t.recordBackupDiagnostic(
    'A',
    oldSession,
    'check',
    'snapshot-request',
    Error('private'),
    Date.now()
  );
  t.clearBackupDiagnostic('A', oldSession);
  assert.equal(t.getBackupDiagnostic('A').operation, 'delete');
  t.clearBackupDiagnostic('A', currentSession);
  assert.equal(t.getBackupDiagnostic('A'), undefined);
});

test('actual inspection failure supplies its bounded diagnostic; a subsequent successful check clears it', async () => {
  let failing = true;
  const f = harness({
    post: async () => {
      if (failing) throw { response: { status: 401, data: 'private response' } };
    },
  });
  f.transport.observeBackupAccount(f.app.id);
  assert.equal(await f.run(), 'unverified');
  const diagnostic = f.transport.getBackupDiagnostic(f.app.id);
  assert.equal(diagnostic.operation, 'check');
  assert.equal(diagnostic.stage, 'snapshot-request');
  assert.equal(diagnostic.category, 'http-4xx');
  assert.equal(diagnostic.httpStatus, 401);
  failing = false;
  assert.equal(await f.run(), 'verified');
  assert.equal(f.transport.getBackupDiagnostic(f.app.id), undefined);
  assert.deepEqual(f.calls, ['getBackupSnapshot', 'getBackupSnapshot']);
});

for (const status of [401, 503])
  test(`repair preserves denied upload ${status} diagnostic after honest readback`, async () => {
    const { wallet } = require('./helpers.cjs');
    const f = harness({
      post: async ({ path }) => {
        if (path.endsWith('revisionedBackupMutation'))
          throw { response: { status, data: 'private upload response' } };
      },
    });
    f.transport.observeBackupAccount(f.app.id);
    f.local.Wallet.push(wallet());
    assert.equal(await f.run(true), 'unverified');
    const diagnostic = f.transport.getBackupDiagnostic(f.app.id);
    assert.equal(diagnostic.operation, 'backup');
    assert.equal(diagnostic.stage, 'repair-upload');
    assert.equal(diagnostic.httpStatus, status);
    assert.equal(diagnostic.category, status < 500 ? 'http-4xx' : 'http-5xx');
    assert.deepEqual(f.calls, [
      'getBackupSnapshot',
      'revisionedBackupMutation',
      'getBackupSnapshot',
    ]);
    assert.equal(f.phases.includes('verified'), false);
  });

test('lost upload acknowledgement retains uncertainty even when readback matches', async () => {
  const { wallet } = require('./helpers.cjs');
  const f = harness({ lostResponse: true });
  f.transport.observeBackupAccount(f.app.id);
  f.local.Wallet.push(wallet());
  assert.equal(await f.run(true), 'unverified');
  assert.ok(f.remote.wallets.wallet, 'disposable remote write really committed');
  assert.equal(f.transport.getBackupDiagnostic(f.app.id).stage, 'repair-upload');
  assert.equal(f.phases.includes('verified'), false);
  assert.equal(f.calls.filter((call) => call === 'revisionedBackupMutation').length, 1);
});
