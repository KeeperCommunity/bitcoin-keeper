/* CI-only native persistence acceptance. No accounts, network or fundable keys. */
const PHASE_KEY = 'keeper-ci-release-probe-v1-phase';
const MARKER_KEY = 'keeper-ci-release-probe-v1-marker';
const PRIMARY = 'keeper-ci-synthetic-wallet';
const OTHER = 'keeper-ci-synthetic-unrelated-wallet';
const ROLLBACK = 'keeper-ci-synthetic-rolled-back-wallet';
const SCHEMA_VERSION = 1; // Fresh current schema only; never an upgrade/migration claim.

class ProbeFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function check(condition, code) {
  if (!condition) throw new ProbeFailure(code);
}

function wallet(id, name) {
  return {
    id,
    entityKind: 'WALLET',
    type: 'DEFAULT',
    networkType: 'TESTNET',
    scriptType: 'P2WPKH',
    // Invalid public sentinel, deliberately unusable as an account/key fixture.
    specs: {
      xpub: 'CI-SYNTHETIC-NOT-A-KEY',
      nextFreeAddressIndex: 0,
      nextFreeChangeAddressIndex: 0,
      totalExternalAddresses: 0,
      confirmedUTXOs: [],
      unconfirmedUTXOs: [],
      balances: { confirmed: 0, unconfirmed: 0 },
      transactions: [],
      hasNewUpdates: false,
      lastSynched: 0,
    },
    presentationData: { name, description: 'Disposable CI fixture', visibility: 'DEFAULT' },
  };
}

// Realm and storage are the actual native modules in release_probe.js.
// Injection exists solely to test failure/phase orchestration on non-native hosts.
async function runProbe({ Realm, schema, storage }) {
  const phase = storage.getString(PHASE_KEY);
  check(phase === undefined || phase === 'seeded' || phase === 'mutated', 'invalid-phase');
  const directory = Realm.defaultPath.slice(0, Realm.defaultPath.lastIndexOf('/') + 1);
  check(directory.length > 0, 'missing-native-directory');
  // Published constants encrypt synthetic disposable data, never product secrets.
  const config = (suffix, keyByte = 7) => ({
    path: `${directory}keeper-ci-release-probe-v1-${suffix}.realm`,
    schema,
    schemaVersion: SCHEMA_VERSION,
    encryptionKey: new Uint8Array(64).fill(keyByte),
  });
  const aConfig = config('a');
  const bConfig = config('b', 8);
  let a;
  let b;
  try {
    a = await Realm.open(aConfig);
    b = await Realm.open(bConfig);
    const get = (realm, id) => realm.objectForPrimaryKey('Wallet', id);
    if (phase === undefined) {
      check(a.objects('Wallet').length === 0 && b.objects('Wallet').length === 0, 'fixture-not-fresh');
      a.write(() => {
        a.create('Wallet', wallet(PRIMARY, 'CI primary'));
        a.create('Wallet', wallet(OTHER, 'CI unrelated'));
      });
      b.write(() => b.create('Wallet', wallet(PRIMARY, 'CI separate database')));
      storage.setItem(MARKER_KEY, 'synthetic-marker-v1');
      storage.setItem(PHASE_KEY, 'seeded');
      return 'seeded';
    }

    check(storage.getString(MARKER_KEY) === 'synthetic-marker-v1', 'mmkv-marker-not-persisted');
    check(get(a, OTHER)?.presentationData.name === 'CI unrelated', 'unrelated-wallet-not-persisted');
    const otherSpecs = get(a, OTHER).specs;
    check(otherSpecs.xpub === 'CI-SYNTHETIC-NOT-A-KEY'
      && otherSpecs.balances.confirmed === 0 && otherSpecs.balances.unconfirmed === 0
      && otherSpecs.confirmedUTXOs.length === 0 && otherSpecs.transactions.length === 0,
    'embedded-wallet-state-not-persisted');
    check(get(b, PRIMARY)?.presentationData.name === 'CI separate database', 'separate-file-not-persisted');
    check(a.objects('Wallet').length === (phase === 'seeded' ? 2 : 1), 'unexpected-primary-record-count');
    check(b.objects('Wallet').length === 1, 'unexpected-separate-record-count');

    if (phase === 'seeded') {
      check(get(a, PRIMARY)?.presentationData.name === 'CI primary', 'primary-wallet-not-persisted');
      const aborted = new Error('intentional-synthetic-transaction-abort');
      let rolledBack = false;
      try {
        a.write(() => {
          a.create('Wallet', wallet(ROLLBACK, 'CI rollback'));
          throw aborted;
        });
      } catch (error) {
        if (error !== aborted) throw error;
        rolledBack = true;
      }
      check(rolledBack && !get(a, ROLLBACK), 'transaction-rollback-failed');

      // Close the correct-key handle first so rejection checks persisted file encryption.
      a.close();
      a = undefined;
      let rejected = false;
      let wrongKeyRealm;
      try {
        wrongKeyRealm = await Realm.open(config('a', 9));
      } catch {
        rejected = true;
      } finally {
        if (wrongKeyRealm) wrongKeyRealm.close();
      }
      check(rejected, 'wrong-encryption-key-accepted');
      a = await Realm.open(aConfig);
      check(get(a, PRIMARY)?.presentationData.name === 'CI primary', 'correct-key-reopen-failed');
      // Deliberately only Realm deletion semantics; no claim about product key deletion.
      a.write(() => a.delete(get(a, PRIMARY)));
      check(!get(a, PRIMARY) && get(a, OTHER), 'targeted-wallet-delete-failed');
      storage.setItem(PHASE_KEY, 'mutated');
      return 'mutated';
    }

    check(!get(a, PRIMARY) && !get(a, ROLLBACK), 'delete-or-rollback-not-persisted');
    a.close();
    b.close();
    a = undefined;
    b = undefined;
    Realm.deleteFile(aConfig);
    Realm.deleteFile(bConfig);
    storage.deleteItem(MARKER_KEY);
    storage.deleteItem(PHASE_KEY);
    check(storage.getString(MARKER_KEY) === undefined && storage.getString(PHASE_KEY) === undefined,
      'fixture-cleanup-failed');
    return 'pass';
  } finally {
    if (a) a.close();
    if (b) b.close();
  }
}

module.exports = { runProbe, ProbeFailure, PHASE_KEY, MARKER_KEY, PRIMARY, OTHER, ROLLBACK };
