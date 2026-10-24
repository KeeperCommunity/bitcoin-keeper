/* CI-only controlled history fixture. No credentials or identifiers leave the device. */
const BACKUP_KEY = 'version-history-original-v1';
const PHASES = ['seed_stale', 'verify_stale_first', 'verify_stale_repeat', 'seed_empty',
  'verify_empty_first', 'verify_empty_repeat', 'restore', 'verify_restored'];
const STALE = [
  { version: '2.6.2(600)', title: 'Recovered Wallet', date: '2026-01-02T03:04:05.000Z' },
  { version: '2.6.3(619)', title: 'Initially installed', date: '2026-02-03T04:05:06.000Z' },
];
class FixtureFailure extends Error { constructor(code) { super(code); this.code = code; } }
function check(value, code) { if (!value) throw new FixtureFailure(code); }
function sorted(rows) { return rows.map((r) => ({ ...r })).sort((a,b) => a.version.localeCompare(b.version)); }
function rowsOf(db) { return sorted(Array.from(db.objects('VersionHistory'), (r) => ({
  version: r.version, title: r.title, date: r.date, releaseNote: r.releaseNote ?? null,
}))); }
function normalized(rows) { return sorted(rows.map((r) => ({ ...r, releaseNote: r.releaseNote ?? null }))); }
function same(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
function owner(storage) {
  const root = JSON.parse(storage.getString('persist:root'));
  const accounts = JSON.parse(root.account).allAccounts;
  const state = JSON.parse(root.storage);
  check(Array.isArray(accounts) && accounts.length === 1, 'sole-account-required');
  const a = accounts[0];
  check(a.isDefault === true && a.accountIdentifier === '' && a.realmId === 'keeper.realm' &&
    typeof a.appId === 'string' && !!a.appId && a.appId === state.appId &&
    typeof a.hash === 'string' && !!a.hash, 'default-owner-required');
  return { appId: a.appId, realmId: a.realmId, hash: a.hash, sharedVersion: state.appVersion };
}
function replaceHistory(db, rows) {
  db.write(() => {
    db.delete(db.objects('VersionHistory'));
    rows.forEach((r) => db.create('VersionHistory', r));
  });
  check(same(rowsOf(db), normalized(rows)), 'history-write-readback-failed');
}
async function runFixture({ phase, storage, fixtureStorage, Keychain, cryptoJS, Realm, schema,
  DeviceInfo, config, development, now = () => Date.now() }) {
  check(development === true && config.ENVIRONMENT === 'DEVELOPMENT' &&
    config.RELAY === 'http://127.0.0.1:8765/' &&
    config.ENC_KEY_STORAGE_IDENTIFIER === 'KEEPER-HOSTED-DISPOSABLE', 'disposable-build-required');
  check(PHASES.includes(phase), 'phase-rejected');
  const current = owner(storage);
  const version = DeviceInfo.getVersion(), build = DeviceInfo.getBuildNumber();
  check(version === '2.6.4' && /^(620|627)$/.test(build) && current.sharedVersion === version,
    'expected-current-installed-version-required');
  const key = `${version}(${build})`;
  const credential = await Keychain.getGenericPassword({ service: undefined });
  check(credential && credential.username === config.ENC_KEY_STORAGE_IDENTIFIER,
    'fixture-credential-required');
  const parsed = JSON.parse(credential.password);
  check(parsed.hash === current.hash && parsed.hash === cryptoJS.SHA512('1111').toString(cryptoJS.enc.Hex) &&
    typeof parsed.enc_key === 'string' && !!parsed.enc_key, 'matching-disposable-pin-required');
  const clearKey = cryptoJS.AES.decrypt(parsed.enc_key, parsed.hash).toString(cryptoJS.enc.Utf8);
  check(/^[a-f0-9]{64}$/.test(clearKey), 'valid-native-realm-key-required');
  const encryptionKey = Uint8Array.from(clearKey, (c) => c.codePointAt(0));
  // A missing database is rejected before open; this helper never creates an account.
  check(await Realm.schemaVersion(current.realmId, encryptionKey) === 109, 'existing-schema-required');
  const db = await Realm.open({ path: current.realmId, encryptionKey, schema, schemaVersion: 109 });
  try {
    const apps = Array.from(db.objects('KeeperApp'));
    const walletIds = Array.from(db.objects('Wallet'), (w) => w.id).sort();
    check(apps.length === 1 && apps[0].id === current.appId && apps[0].version === version &&
      walletIds.length === 1 && db.objects('Vault').length === 0, 'owned-current-account-required');
    const identity = { ...current, version, build, walletIds };
    let saved = fixtureStorage.getString(BACKUP_KEY);
    if (phase === 'seed_stale') {
      check(saved === undefined, 'history-backup-already-present');
      const original = rowsOf(db);
      check(original.length === 1 && original[0].version === key &&
        original[0].title === 'Initially installed' && Number.isFinite(Date.parse(original[0].date)),
        'initial-disposable-history-required');
      saved = { schema: 1, identity, original, phase: 'stale_seeded', seededAt: now() };
      fixtureStorage.set(BACKUP_KEY, JSON.stringify(saved));
      check(same(JSON.parse(fixtureStorage.getString(BACKUP_KEY)), saved), 'backup-readback-failed');
      replaceHistory(db, STALE);
      return 'pass';
    }
    check(typeof saved === 'string', 'history-backup-required');
    saved = JSON.parse(saved);
    check(saved.schema === 1 && same(saved.identity, identity), 'history-owner-changed');
    check(Array.isArray(saved.original) && saved.original.length === 1 &&
      saved.original[0].version === key && saved.original[0].title === 'Initially installed' &&
      Number.isFinite(Date.parse(saved.original[0].date)) &&
      same(saved.original, normalized(saved.original)), 'original-history-backup-invalid');
    if (phase === 'restore') {
      replaceHistory(db, saved.original);
      saved.phase = 'restored';
    } else if (phase === 'verify_restored') {
      check(saved.phase === 'restored' && same(rowsOf(db), saved.original), 'restored-history-required');
      fixtureStorage.remove(BACKUP_KEY);
      check(fixtureStorage.getString(BACKUP_KEY) === undefined, 'history-backup-cleanup-failed');
      return 'pass';
    } else if (phase === 'seed_empty') {
      check(saved.phase === 'stale_repeat_verified', 'stale-relaunch-verification-required');
      check(same(rowsOf(db), saved.lastVerifiedRows), 'verified-history-changed-before-empty-fixture');
      saved.seededAt = now();
      replaceHistory(db, []);
      saved.phase = 'empty_seeded';
      delete saved.observationDate;
    } else {
      const stale = phase.startsWith('verify_stale_');
      const repeat = phase.endsWith('_repeat');
      const scenario = stale ? 'stale' : 'empty';
      check(saved.phase === `${scenario}_${repeat ? 'first_verified' : 'seeded'}`,
        'history-phase-order-required');
      const observed = rowsOf(db);
      const row = observed.find((r) => r.version === key);
      check(row && row.title === 'Current installation observed' &&
        Number.isFinite(Date.parse(row.date)) && row.releaseNote === null, 'observation-required');
      check(same(observed.filter((r) => r.version !== key), normalized(stale ? STALE : [])),
        'provenance-mutated-or-fabricated-upgrade');
      if (repeat) check(row.date === saved.observationDate, 'observation-date-changed-on-relaunch');
      else {
        const observedAt = Date.parse(row.date), verifiedAt = now();
        // Production Date.toString() has second precision. Keep the actual
        // device clock window; an arbitrary old or future date is not evidence.
        check(Number.isFinite(saved.seededAt) && Number.isFinite(verifiedAt) &&
          observedAt >= saved.seededAt - 1500 && observedAt <= verifiedAt + 1500,
          'observation-outside-device-clock-window');
        saved.observationDate = row.date;
      }
      saved.phase = `${scenario}_${repeat ? 'repeat' : 'first'}_verified`;
      saved.lastVerifiedRows = observed;
    }
    fixtureStorage.set(BACKUP_KEY, JSON.stringify(saved));
    return 'pass';
  } finally { db.close(); }
}
module.exports = { BACKUP_KEY, PHASES, STALE, FixtureFailure, runFixture };
