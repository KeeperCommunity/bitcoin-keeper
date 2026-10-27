'use strict';
// Executed inside the installed RN app with the real native Realm binding.
const CASES = [
  'historical109_encrypted_create_and_reopen', 'production_initializer_109_to_110',
  'node_identity_and_defaults_preserved', 'default_node_preserved_without_trust',
  'selected_public_ca_survives_close_reopen', 'same_host_other_port_has_no_trust',
  'onion_plaintext_preserved_without_trust', 'separate_database_has_no_inherited_trust',
  'wrong_key_rejected', 'omitted_key_rejected', 'correct_key_recovers_without_reset',
];
const FAILURE_CODES = new Set(['REALM109_CONFIG','REALM109_OLD_SCHEMA','REALM109_CURRENT_SCHEMA',
  'REALM109_KEYS','REALM109_CASE_ORDER','REALM109_OLD_REOPEN','REALM109_INITIALIZE',
  'REALM109_NATIVE_MIGRATION','REALM109_ROWS','REALM109_DEFAULT','REALM109_REOPEN',
  'REALM109_PERSIST','REALM109_PORT_ISOLATION','REALM109_ONION','REALM109_DATABASE_ISOLATION',
  'REALM109_ENCRYPTION_REJECTION','REALM109_FINAL_OPEN','REALM109_NO_RESET',
  'REALM109_DEVELOPMENT_FIXTURE_REQUIRED','REALM109_STALE_DATABASE','REALM109_CLEANUP',
  'REALM109_NATIVE_CLEANUP_FAILED','REALM109_NATIVE_OR_APP_EXCEPTION','REALM109_IDENTITY_LOOKUP']);
function failureCode(error) {
  try { const code=error?.message; if (FAILURE_CODES.has(code)) return code; } catch {}
  return 'REALM109_NATIVE_OR_APP_EXCEPTION';
}
const NODES = [
  { id: 101, host: 'private-node.fixture.invalid', port: '50002', useKeeperNode: false,
    isConnected: true, useSSL: true, networkType: 'TESTNET' },
  { id: 102, host: 'a'.repeat(56) + '.onion', port: '50001', useKeeperNode: false,
    isConnected: true, useSSL: false, networkType: 'MAINNET' },
  { id: 103, host: 'private-node.fixture.invalid', port: '50003', useKeeperNode: false,
    isConnected: false, useSSL: true, networkType: 'TESTNET' },
];
const DEFAULT = { id: 201, host: 'keeper.fixture.invalid', port: '50002', useKeeperNode: true,
  isConnected: false, useSSL: true, networkType: 'TESTNET' };
const check = (value, code) => { if (!value) throw new Error(code); };
function same(row, expected, ca) {
  return row && Object.entries(expected).every(([key, value]) => row[key] === value) && row.tlsCa === ca;
}
function identity(realm, type, id) {
  check(['NodeConnect','DefaultNodeConnect'].includes(type) && Number.isInteger(id), 'REALM109_IDENTITY_LOOKUP');
  const rows=realm.objects(type), count=rows.length, matches=[];
  check(Number.isInteger(count) && count>=0 && count<=16, 'REALM109_IDENTITY_LOOKUP');
  for(let index=0;index<count;index++) if(rows[index]?.id===id) matches.push(rows[index]);
  check(matches.length===1,'REALM109_IDENTITY_LOOKUP');
  return matches[0];
}
async function run({ Realm, RealmDatabase, oldSchema, schema, config, directory, randomBytes,
  onProgress = () => {}, onFailure = async () => {}, onCleanup = () => {} }) {
  check(config.schema === 1 && config.scope === 'ACTUAL_NATIVE_SYNTHETIC_REALM109_TO_110'
    && config.realm_package === '12.15.0' && config.schema_count === 50
    && oldSchema.length === 50 && RealmDatabase.schemaVersion === 110
    && /^-----BEGIN CERTIFICATE-----\n/.test(config.public_ca), 'REALM109_CONFIG');
  for (const name of ['NodeConnect', 'DefaultNodeConnect']) {
    check(!Object.hasOwn(oldSchema.find(row => row.name === name).properties, 'tlsCa'), 'REALM109_OLD_SCHEMA');
    check(Object.hasOwn(schema.find(row => row.name === name).properties, 'tlsCa'), 'REALM109_CURRENT_SCHEMA');
  }
  const key = randomBytes(64), wrong = randomBytes(64), handles = new Set(), cases = [];
  const filename = directory + '/historical.realm', isolated = directory + '/independent.realm';
  const open = async options => { const realm = await Realm.open(options); handles.add(realm); return realm; };
  const passed = id => {
    check(CASES[cases.length] === id, 'REALM109_CASE_ORDER'); cases.push({ id, status: 'PASS' });
    try { onProgress(cases.map(({id,status}) => ({id,status}))); } catch {}
  };
  const close = realm => { if (realm && !realm.isClosed) realm.close(); };
  let primaryPresent=false;
  try {
    check(key.length === 64 && wrong.length === 64 && key.some((byte, i) => byte !== wrong[i]), 'REALM109_KEYS');
    let old = await open({ path: filename, encryptionKey: key, schema: oldSchema, schemaVersion: 109 });
    old.write(() => { NODES.forEach(row => old.create('NodeConnect', row)); old.create('DefaultNodeConnect', DEFAULT); });
    close(old);
    old = await open({ path: filename, encryptionKey: key, schema: oldSchema, schemaVersion: 109, readOnly: true });
    check(old.schemaVersion === 109 && old.objects('NodeConnect').length === 3
      && old.objects('DefaultNodeConnect').length === 1, 'REALM109_OLD_REOPEN');
    close(old); passed(CASES[0]);
    const db = new RealmDatabase();
    check((await db.initializeDatabase(key, filename)).success === true, 'REALM109_INITIALIZE');
    let current = db.getDatabase(); handles.add(current);
    check(current.schemaVersion === 110, 'REALM109_NATIVE_MIGRATION'); passed(CASES[1]);
    check(current.objects('NodeConnect').length === 3
      && NODES.every(row => same(identity(current, 'NodeConnect', row.id), row, null)), 'REALM109_ROWS');
    passed(CASES[2]);
    check(current.objects('DefaultNodeConnect').length === 1
      && same(identity(current, 'DefaultNodeConnect', 201), DEFAULT, null), 'REALM109_DEFAULT');
    passed(CASES[3]);
    // Only synthetic rows in this newly created fixture database are written.
    current.write(() => { identity(current, 'NodeConnect', 101).tlsCa = config.public_ca; });
    close(current);
    check((await db.initializeDatabase(key, filename)).success === true, 'REALM109_REOPEN');
    current = db.getDatabase(); handles.add(current);
    check(current.schemaVersion === 110 && same(identity(current, 'NodeConnect', 101), NODES[0], config.public_ca), 'REALM109_PERSIST');
    passed(CASES[4]);
    check(same(identity(current, 'NodeConnect', 103), NODES[2], null), 'REALM109_PORT_ISOLATION'); passed(CASES[5]);
    check(same(identity(current, 'NodeConnect', 102), NODES[1], null), 'REALM109_ONION'); passed(CASES[6]);
    const other = await open({ path: isolated, encryptionKey: wrong, schema, schemaVersion: 110 });
    other.write(() => other.create('NodeConnect', NODES[0])); close(other);
    const reopenedOther = await open({ path: isolated, encryptionKey: wrong, schema, schemaVersion: 110, readOnly: true });
    check(same(identity(reopenedOther, 'NodeConnect', 101), NODES[0], null), 'REALM109_DATABASE_ISOLATION');
    close(reopenedOther); passed(CASES[7]); close(current);
    for (const [candidate, id] of [[wrong, CASES[8]], [undefined, CASES[9]]]) {
      let rejected = false;
      try { close(await open({ path: filename, encryptionKey: candidate, readOnly: true })); } catch { rejected = true; }
      check(rejected, 'REALM109_ENCRYPTION_REJECTION'); passed(id);
    }
    check((await db.initializeDatabase(key, filename)).success === true, 'REALM109_FINAL_OPEN');
    current = db.getDatabase(); handles.add(current);
    check(current.schemaVersion === 110 && current.objects('NodeConnect').length === 3
      && current.objects('DefaultNodeConnect').length === 1
      && NODES.every(row => same(identity(current, 'NodeConnect', row.id), row, row.id === 101 ? config.public_ca : null))
      && same(identity(current, 'DefaultNodeConnect', 201), DEFAULT, null), 'REALM109_NO_RESET');
    passed(CASES[10]);
    return { schema: 1, scope: config.scope, source_sha: config.source_sha, nonce: config.nonce,
      platform: config.platform, historical_commit: config.historical_commit, manifest_sha256: config.manifest_sha256,
      status: 'PASS', old_version: 109, new_version: 110, schema_count: 50, cases };
  } catch (error) {
    primaryPresent=true;
    try { await onFailure({failure:failureCode(error),cases:cases.map(({id,status}) => ({id,status}))}); } catch {}
    throw error;
  } finally {
    const cleanup = {native_handles:'PASS',key_zeroization:'PASS'};
    for (const realm of handles) { try { close(realm); } catch { cleanup.native_handles='FAIL'; } }
    for (const value of [key,wrong]) { try { value.fill(0); } catch { cleanup.key_zeroization='FAIL'; } }
    try { onCleanup({ ...cleanup }); } catch {}
    if (!primaryPresent && Object.values(cleanup).some(value => value !== 'PASS'))
      throw new Error('REALM109_NATIVE_CLEANUP_FAILED');
  }
}
module.exports = { run, CASES, failureCode, identity };
