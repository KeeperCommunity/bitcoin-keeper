/* CI-only fixture. Secret bytes remain in native Keychain or this process. */
const BACKUP_SERVICE = 'keeper-ci-malformed-credential-recovery-v1';
const MALFORMED = '{"keeperCiMalformedCredential":';
class FixtureFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function check(value, code) { if (!value) throw new FixtureFailure(code); }
function owner(storage) {
  const root = JSON.parse(storage.getString('persist:root'));
  const accounts = JSON.parse(root.account).allAccounts;
  const current = JSON.parse(root.storage).appId;
  check(Array.isArray(accounts) && accounts.length === 1, 'sole-account-required');
  const account = accounts[0];
  check(account.isDefault === true && account.accountIdentifier === '' &&
    typeof account.appId === 'string' && account.appId.length > 0 &&
    account.appId === current && typeof account.realmId === 'string' && account.realmId.length > 0 &&
    typeof account.hash === 'string' && account.hash.length > 0, 'default-owner-required');
  return { appId: account.appId, realmId: account.realmId, hash: account.hash };
}
function validOriginal(value, current, username) {
  check(value && value.username === username && typeof value.password === 'string', 'credential-required');
  const parsed = JSON.parse(value.password);
  check(parsed && parsed.hash === current.hash && typeof parsed.enc_key === 'string' &&
    parsed.enc_key.length > 0, 'matching-credential-required');
}
async function runFixture({ phase, Keychain, storage, config, development }) {
  check(development === true && config.ENVIRONMENT === 'DEVELOPMENT' &&
    config.RELAY === 'http://127.0.0.1:8765/' &&
    config.ENC_KEY_STORAGE_IDENTIFIER === 'KEEPER-HOSTED-DISPOSABLE', 'disposable-build-required');
  check(phase === 'arm' || phase === 'restore', 'phase-rejected');
  const current = owner(storage);
  const defaultOptions = { service: undefined };
  const backupOptions = { service: BACKUP_SERVICE, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED };
  const username = config.ENC_KEY_STORAGE_IDENTIFIER;
  if (phase === 'arm') {
    // Successfully empty is never labelled a read fault or turned into a test account.
    check((await Keychain.getGenericPassword({ service: BACKUP_SERVICE })) === false, 'backup-already-present');
    const original = await Keychain.getGenericPassword(defaultOptions);
    validOriginal(original, current, username);
    const payload = JSON.stringify({ schema: 1, owner: current,
      original: { username: original.username, password: original.password } });
    check(await Keychain.setGenericPassword(username, payload, backupOptions), 'backup-write-failed');
    const saved = await Keychain.getGenericPassword({ service: BACKUP_SERVICE });
    check(saved && saved.username === username && saved.password === payload, 'backup-readback-failed');
    check(await Keychain.setGenericPassword(username, MALFORMED,
      { ...defaultOptions, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED }), 'malformed-write-failed');
    const malformed = await Keychain.getGenericPassword(defaultOptions);
    check(malformed && malformed.username === username && malformed.password === MALFORMED,
      'malformed-readback-failed');
    return 'armed';
  }
  const saved = await Keychain.getGenericPassword({ service: BACKUP_SERVICE });
  check(saved && saved.username === username, 'backup-required');
  const payload = JSON.parse(saved.password);
  check(payload && payload.schema === 1 && JSON.stringify(payload.owner) === JSON.stringify(current),
    'backup-owner-mismatch');
  validOriginal(payload.original, current, username);
  const malformed = await Keychain.getGenericPassword(defaultOptions);
  check(malformed && malformed.username === username && malformed.password === MALFORMED,
    'restore-source-changed');
  check(await Keychain.setGenericPassword(payload.original.username, payload.original.password,
    { ...defaultOptions, accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED }), 'restore-write-failed');
  const restored = await Keychain.getGenericPassword(defaultOptions);
  check(restored && restored.username === payload.original.username &&
    restored.password === payload.original.password, 'restore-readback-failed');
  check(await Keychain.resetGenericPassword({ service: BACKUP_SERVICE }), 'backup-cleanup-failed');
  check((await Keychain.getGenericPassword({ service: BACKUP_SERVICE })) === false,
    'backup-cleanup-readback-failed');
  return 'restored';
}
module.exports = { BACKUP_SERVICE, MALFORMED, FixtureFailure, runFixture };
