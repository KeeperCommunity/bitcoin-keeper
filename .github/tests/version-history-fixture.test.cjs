/* Offline fake-native boundary controls; these are NOT native acceptance. */
const assert = require('node:assert/strict');
const test = require('node:test');
const { BACKUP_KEY, STALE, runFixture } = require('../native/version_history_fixture_core');
const original = [{version:'2.6.4(627)',title:'Initially installed',date:'2026-10-22T01:02:03.000Z',releaseNote:'fixture retained'}];
function setup() {
  const account = {isDefault:true,accountIdentifier:'',realmId:'keeper.realm',appId:'owned-fixture',hash:'known-pin-hash'};
  const state = {appId:account.appId,appVersion:'2.6.4'};
  const rows = structuredClone(original), backups = new Map();
  const app = {id:account.appId,version:'2.6.4'};
  let writes = 0, opens = 0, closes = 0, schemaVersion = 109;
  const db = {
    objects(name) { return {VersionHistory:rows,KeeperApp:[app],Wallet:[{id:'fixture-wallet'}],Vault:[]}[name]; },
    write(fn) { writes++; fn(); }, delete(collection) { assert.equal(collection,rows); rows.length=0; },
    create(name,row) { assert.equal(name,'VersionHistory'); rows.push(structuredClone(row)); },
    close() { closes++; },
  };
  const args = {
    phase:'seed_stale', development:true, now:()=>Date.parse('2026-10-22T02:03:04.500Z'),
    config:{ENVIRONMENT:'DEVELOPMENT',RELAY:'http://127.0.0.1:8765/',ENC_KEY_STORAGE_IDENTIFIER:'KEEPER-HOSTED-DISPOSABLE'},
    storage:{getString:()=>JSON.stringify({account:JSON.stringify({allAccounts:[account]}),storage:JSON.stringify(state)})},
    fixtureStorage:{getString:(k)=>backups.get(k),set:(k,v)=>backups.set(k,v),remove:(k)=>backups.delete(k)},
    Keychain:{getGenericPassword:async()=>({username:'KEEPER-HOSTED-DISPOSABLE',password:JSON.stringify({hash:account.hash,enc_key:'controlled-ciphertext'})})},
    cryptoJS:{SHA512:()=>({toString:()=> 'known-pin-hash'}),enc:{Hex:{},Utf8:{}},AES:{decrypt:()=>({toString:()=> 'a'.repeat(64)})}},
    DeviceInfo:{getVersion:()=> '2.6.4',getBuildNumber:()=> '627'},schema:['controlled-fake-native-schema'],
    Realm:{schemaVersion:async(path,key)=>{assert.equal(path,'keeper.realm');assert.equal(key.length,64);return schemaVersion;},open:async()=>{opens++;return db;}},
  };
  const run=(phase)=>runFixture({...args,phase});
  const observe=(date='2026-10-22T02:03:04.000Z')=>rows.push({version:'2.6.4(627)',title:'Current installation observed',date,releaseNote:null});
  return {args,run,rows,backups,app,state,account,observe,get writes(){return writes;},get opens(){return opens;},get closes(){return closes;},set schemaVersion(v){schemaVersion=v;}};
}
async function staleFirst(f) {await f.run('seed_stale');f.observe();await f.run('verify_stale_first');}
async function staleRepeat(f) {await staleFirst(f);await f.run('verify_stale_repeat');}
test('full controlled stale/empty cycle preserves both provenance dates, repeated observation date, and exact original rows',async()=>{
  const f=setup(); await staleRepeat(f);
  assert.deepEqual(f.rows.filter(r=>r.version!=='2.6.4(627)').map(({releaseNote,...r})=>r),STALE);
  await f.run('seed_empty'); assert.equal(f.rows.length,0);
  f.observe();await f.run('verify_empty_first');await f.run('verify_empty_repeat');
  await f.run('restore');await f.run('verify_restored');
  assert.deepEqual(f.rows,original);assert.equal(f.backups.has(BACKUP_KEY),false);
  assert.equal(f.app.version,'2.6.4');assert.equal(f.state.appVersion,'2.6.4');
  assert.equal(f.opens,f.closes);assert.equal(f.writes,3);
});
test('missing native Realm is rejected before opening or creating data',async()=>{
  const f=setup();f.schemaVersion=-1;await assert.rejects(f.run('seed_stale'),/existing-schema-required/);
  assert.equal(f.opens,0);assert.equal(f.writes,0);assert.deepEqual(f.rows,original);
});
test('foreign or changed account version cannot seed history',async()=>{
  for(const mutate of [f=>f.account.appId='other',f=>f.app.id='other',f=>f.app.version='2.6.3',f=>f.state.appVersion='2.6.3']) {
    const f=setup();mutate(f);await assert.rejects(f.run('seed_stale'));assert.equal(f.writes,0);assert.deepEqual(f.rows,original);
  }
});
test('successful empty credentials, foreign username, wrong PIN, and malformed native key fail before Realm open',async()=>{
  for(const value of [false,{username:'other',password:'{}'},{username:'KEEPER-HOSTED-DISPOSABLE',password:JSON.stringify({hash:'wrong-pin',enc_key:'x'})}]) {
    const f=setup();f.args.Keychain.getGenericPassword=async()=>value;
    await assert.rejects(f.run('seed_stale'));assert.equal(f.opens,0);assert.equal(f.writes,0);
  }
  const f=setup();f.args.cryptoJS.AES.decrypt=()=>({toString:()=> 'invalid'});
  await assert.rejects(f.run('seed_stale'),/valid-native-realm-key-required/);assert.equal(f.opens,0);
});
test('foreign backup owner and malformed original rows cannot restore over current history',async()=>{
  for(const mutate of [b=>b.identity.appId='other',b=>b.original=[]]) {
    const f=setup();await f.run('seed_stale');const b=JSON.parse(f.backups.get(BACKUP_KEY));mutate(b);f.backups.set(BACKUP_KEY,JSON.stringify(b));
    await assert.rejects(f.run('restore'));assert.equal(f.writes,1);assert.equal(f.rows.length,2);
  }
});
test('missing observation and fabricated migration cannot satisfy current observation',async()=>{
  const f=setup();await f.run('seed_stale');await assert.rejects(f.run('verify_stale_first'),/observation-required/);
  f.observe();f.rows[2].title='Upgraded from 2.6.3 to 2.6.4';await assert.rejects(f.run('verify_stale_first'),/observation-required/);
});
test('changed old date, missing recovery provenance, and extra upgrade rows are rejected',async()=>{
  for(const mutate of [f=>f.rows[0].date='2026-03-04T00:00:00Z',f=>f.rows.shift(),f=>f.rows.push({version:'1.0.0(1)',title:'Upgraded from old',date:'2026-01-01'})]) {
    const f=setup();await f.run('seed_stale');f.observe();mutate(f);
    await assert.rejects(f.run('verify_stale_first'),/provenance-mutated-or-fabricated-upgrade/);
  }
});
test('repeat login must preserve observed date and cannot skip first verification',async()=>{
  const f=setup();await f.run('seed_stale');f.observe();await assert.rejects(f.run('verify_stale_repeat'),/history-phase-order-required/);
  await f.run('verify_stale_first');f.rows[2].date='2026-10-22T03:04:05Z';
  await assert.rejects(f.run('verify_stale_repeat'),/observation-date-changed-on-relaunch/);
});
test('empty fixture never erases unexpected history after previous verification',async()=>{
  const f=setup();await staleRepeat(f);f.rows.push({version:'1.0.0(1)',title:'unexpected',date:'2026-01-01'});
  await assert.rejects(f.run('seed_empty'),/verified-history-changed-before-empty-fixture/);assert.equal(f.writes,1);
});
test('empty history yields exactly one observation; extra rows cannot pass',async()=>{
  const f=setup();await staleRepeat(f);await f.run('seed_empty');f.observe();f.rows.push({...STALE[0]});
  await assert.rejects(f.run('verify_empty_first'),/provenance-mutated-or-fabricated-upgrade/);
});
test('fixture is development/loopback only and fixed phase names do not create arbitrary hooks',async()=>{
  const f=setup();f.args.development=false;await assert.rejects(f.run('seed_stale'),/disposable-build-required/);
  f.args.development=true;await assert.rejects(f.run('arbitrary'),/phase-rejected/);assert.equal(f.opens,0);
});

test('first observation must be inside the device-local seed and verification clock window',async()=>{
  for(const date of ['2026-01-01T00:00:00.000Z','2030-01-01T00:00:00.000Z']) {
    const f=setup();await f.run('seed_stale');f.observe(date);
    await assert.rejects(f.run('verify_stale_first'),/observation-outside-device-clock-window/);
  }
  const f=setup();await staleRepeat(f);await f.run('seed_empty');f.observe('2026-10-21T02:03:04.000Z');
  await assert.rejects(f.run('verify_empty_first'),/observation-outside-device-clock-window/);
});
