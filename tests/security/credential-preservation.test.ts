'use strict';
export {};
// Production function bodies, synthetic storage only. This is not native acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const productionPath = path.join(__dirname, '../../src/storage/secure-store.ts');
const proposed = fs.readFileSync(productionPath, 'utf8');
function extract(source, name, params) {
  const start = source.indexOf(`export const ${name} = async (`);
  assert(start >= 0);
  const end = source.indexOf('\nexport const ', start + 1);
  const body = source.slice(start, end < 0 ? undefined : end).trim();
  const open = body.indexOf(') => {');
  assert(open > 0 && body.endsWith('};'));
  return `async (${params}) => {${body.slice(open + 6, -2)}}`;
}
function fixture({source = proposed, rejectWrite = false, falseWrite = false,
  onRead, onWrite, pending = false}: any = {}) {
  const credential = {hash: 'fixture-old-hash', enc_key: 'fixture-original-wrap', extra: 'retained'};
  const service = pending ? undefined : 'fixture-service-a';
  const records = new Map([[service, {username: 'fixture-existing-username', password: JSON.stringify(credential)}]]);
  const account = {appId: 'fixture-a', accountIdentifier: service ?? '', realmId: 'fixture-realm', hash: credential.hash};
  const state = {storage: {appId: pending ? '' : account.appId}, account: {
    allAccounts: pending ? [] : [account], tempDetails: pending ? {...account} : null}};
  let epoch = 1, reads = 0;
  const calls = [];
  const api = {
    ACCESSIBLE: {WHEN_UNLOCKED: 'fixture-when-unlocked'},
    async getGenericPassword(options) {
      const entry = records.get(options?.service);
      calls.push({kind: 'read', service: options?.service});
      if (onRead) await onRead(++reads, control, options);
      return entry ? {...entry} : false;
    },
    async resetGenericPassword(options) {
      calls.push({kind: 'delete', service: options?.service});
      records.delete(options?.service); return true;
    },
    async setGenericPassword(username, password, options) {
      calls.push({kind: 'write', username, options});
      if (rejectWrite) throw new Error('CONTROLLED_SYNTHETIC_REJECTION');
      if (falseWrite) return false;
      records.set(options?.service, {username, password});
      if (onWrite) await onWrite(control);
      return {service: options?.service};
    },
  };
  const context = vm.createContext({Keychain: api, reduxStore: {getState: () => state,dispatch(action){
      assert.equal(action.type,'fixture-update-account-hash');
      calls.push({kind:'owner-metadata',appId:action.payload.appId});
      state.account.allAccounts=state.account.allAccounts.map(a=>a.appId===action.payload.appId?{...a,hash:action.payload.newHash}:a);
    }},
    updatePasscodeHash:payload=>({type:'fixture-update-account-hash',payload}),
    currentBackupAccountSession: () => epoch, config: {ENC_KEY_STORAGE_IDENTIFIER: 'fixture-config-username'},
    console: {log(){}}});
  if (source.includes('let credentialWrite = Promise.resolve();')) {
    const start=source.indexOf('let credentialWrite = Promise.resolve();');
    const helper=source.slice(start,source.indexOf('export const store = ',start))
      .replace('const runCredentialWrite = <T>(work: () => Promise<T>): Promise<T> => {',
        'const runCredentialWrite = (work) => {');
    vm.runInContext(helper,context);
  }
  const control = {state, records, calls, service, original: JSON.stringify(credential),
    switchSession(){epoch++;},
    bio: (...args) => vm.runInContext('('+extract(source,'storeBiometricPubKey','pubKey, appId')+')', context)(...args),
    store: (...args) => vm.runInContext('('+extract(source,'store','hash, enc_key, identifier')+')', context)(...args)};
  return control;
}
const writes = f => f.calls.filter(row => row.kind === 'write');
test('proposed biometric body retains exact prior record when native replacement rejects', async () => {
  const f = fixture({rejectWrite: true});
  assert.equal(await f.bio('fixture-public-key','fixture-a'), false);
  assert.equal(f.records.get(f.service).password, f.original);
  assert.equal(f.calls.some(row => row.kind === 'delete'), false);
  assert.equal(writes(f)[0].options.keeperPreserveExisting, true);
});
test('proposed PIN replacement opts in and retains record on nondestructive native rejection', async () => {
  const f = fixture({rejectWrite: true});
  assert.equal(await f.store('fixture-new-hash','fixture-new-wrap',f.service), false);
  assert.equal(f.records.get(f.service).password, f.original);
  assert.equal(writes(f)[0].options.keeperPreserveExisting, true);
});
test('successful biometric write retains fields and original username and verifies readback', async () => {
  const f = fixture();
  assert.equal(await f.bio('fixture-public-key','fixture-a'), true);
  const record = f.records.get(f.service), saved = JSON.parse(record.password);
  assert.equal(record.username, 'fixture-existing-username');
  assert.equal(saved.hash, 'fixture-old-hash');
  assert.equal(saved.enc_key, 'fixture-original-wrap');
  assert.equal(saved.extra, 'retained');
  assert.equal(saved.pubKey, 'fixture-public-key');
  assert.equal(f.calls.at(-1).kind, 'read');
});
test('PIN replacement preserves existing username and acknowledges exact readback', async () => {
  const f = fixture();
  assert.equal(await f.store('fixture-new-hash','fixture-new-wrap',f.service), true);
  assert.equal(f.records.get(f.service).username,'fixture-existing-username');
  assert.equal(JSON.parse(f.records.get(f.service).password).enc_key,'fixture-new-wrap');
  assert.equal(f.calls.at(-2).kind,'read');
  assert.equal(f.calls.at(-1).kind,'owner-metadata');
});
test('unknown requested biometric account cannot fall back to the default service', async () => {
  const f = fixture();
  assert.equal(await f.bio('fixture-public-key','fixture-unknown'), false);
  assert.equal(f.calls.length,0);
});
test('missing account identity is rejected outside explicit pending first setup', async () => {
  const f = fixture();
  assert.equal(await f.bio('fixture-public-key',undefined),false);
  assert.equal(f.calls.length,0);
});
test('explicit pending first setup retains default service and its username', async () => {
  const f = fixture({pending:true});
  assert.equal(await f.bio('fixture-public-key',undefined),true);
  assert.equal(writes(f)[0].options.service,undefined);
  assert.equal(f.records.get(undefined).username,'fixture-existing-username');
});
test('missing pending metadata and mismatched setup verifier refuse enrollment', async () => {
  for (const mutate of [f=>{f.state.account.tempDetails=null;}, f=>{f.state.account.tempDetails.hash='fixture-other-hash';}]) {
    const f=fixture({pending:true}); mutate(f);
    assert.equal(await f.bio('fixture-public-key',undefined),false);
    assert.equal(writes(f).length,0);
  }
});
test('missing or malformed owned credential never gets recreated by biometric enrollment', async () => {
  for (const value of [null,'invalid-json',JSON.stringify({hash:'fixture-old-hash'})]) {
    const f=fixture();
    if(value===null)f.records.delete(f.service); else f.records.get(f.service).password=value;
    assert.equal(await f.bio('fixture-public-key','fixture-a'),false);
    assert.equal(writes(f).length,0);
  }
});
test('A to B to A session change after credential read blocks native write', async () => {
  for (const name of ['bio','store']) {
    const f=fixture({onRead(n,control){if(n===1){control.switchSession();control.switchSession();}}});
    const result=name==='bio'?await f.bio('fixture-public-key','fixture-a'):await f.store('fixture-new-hash','fixture-new-wrap',f.service);
    assert.equal(result,false);assert.equal(writes(f).length,0);
    assert.equal(f.records.get(f.service).password,f.original);
  }
});
test('account service or Realm mapping change after read blocks biometric write', async () => {
  for(const field of ['accountIdentifier','realmId','hash']) {
    const f=fixture({onRead(n,c){if(n===1)c.state.account.allAccounts=[{...c.state.account.allAccounts[0],[field]:'fixture-changed'}];}});
    assert.equal(await f.bio('fixture-public-key','fixture-a'),false);
    assert.equal(writes(f).length,0);
  }
});
test('other selected account cannot replace an owned PIN record', async () => {
  const f=fixture();f.state.storage.appId='fixture-other';
  assert.equal(await f.store('fixture-new-hash','fixture-new-wrap',f.service),false);
  assert.equal(writes(f).length,0);
});
test('new owned service can be created but unowned existing service cannot be overwritten', async () => {
  const f=fixture();
  assert.equal(await f.store('fixture-new-hash','fixture-new-wrap','fixture-fresh-service'),true);
  assert.equal(f.records.get('fixture-fresh-service').username,'fixture-config-username');
  assert.equal(f.records.get(f.service).password,f.original);
  assert.equal(await f.store('fixture-third-hash','fixture-third-wrap','fixture-fresh-service'),false);
  assert.equal(writes(f).length,1);
});
test('PIN uniqueness remains cross-account with no native write',async()=>{
  const f=fixture();
  assert.equal(await f.store('fixture-old-hash','fixture-new-wrap',f.service),'Passcode already exists');
  assert.equal(writes(f).length,0);
});
test('false setter acknowledgment cannot publish either credential success',async()=>{
  for(const name of ['bio','store']) {
    const f=fixture({falseWrite:true});
    assert.equal(name==='bio'?await f.bio('fixture-public-key','fixture-a'):await f.store('fixture-new-hash','fixture-new-wrap',f.service),false);
    assert.equal(f.records.get(f.service).password,f.original);
  }
});
test('lost current session after issued write suppresses success without deleting committed record',async()=>{
  const f=fixture({onWrite(c){c.switchSession();}});
  assert.equal(await f.bio('fixture-public-key','fixture-a'),false);
  assert.equal(JSON.parse(f.records.get(f.service).password).enc_key,'fixture-original-wrap');
  assert.equal(f.calls.some(r=>r.kind==='delete'),false);
});
test('readback mismatch cannot acknowledge success',async()=>{
  // A native write can succeed while a concurrent modeled writer changes its fields.
  const g=fixture({onWrite(c){c.records.get(c.service).password=JSON.stringify({hash:'fixture-old-hash',enc_key:'fixture-original-wrap',pubKey:'fixture-other-public'});}});
  assert.equal(await g.bio('fixture-public-key','fixture-a'),false);
});
test('paused biometric read cannot overwrite a subsequent PIN replacement',async()=>{
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const f=fixture({async onRead(n){if(n===1){started();await gate;}}});
  const bio=f.bio('fixture-public-key','fixture-a');await ready;
  const pin=f.store('fixture-new-hash','fixture-new-wrap',f.service);
  await Promise.resolve();assert.equal(writes(f).length,0);release();
  assert.equal(await bio,true);assert.equal(await pin,true);
  assert.equal(JSON.parse(f.records.get(f.service).password).hash,'fixture-new-hash');
});
test('biometric job queued behind PIN replacement uses reconciled owner verifier',async()=>{
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
  const f=fixture({async onRead(n){if(n===1){started();await gate;}}});
  const pin=f.store('fixture-new-hash','fixture-new-wrap',f.service);await ready;
  const bio=f.bio('fixture-public-key','fixture-a');release();
  assert.equal(await pin,true);assert.equal(await bio,true);
  assert.equal(writes(f).length,2);
  assert.equal(JSON.parse(f.records.get(f.service).password).hash,'fixture-new-hash');
});
test('confirmed A PIN write after switching to B reconciles only unchanged A routing metadata',async()=>{
  const f=fixture({onWrite(c){c.switchSession();c.state.storage.appId='fixture-b';}});
  f.state.account.allAccounts=[...f.state.account.allAccounts,
    {appId:'fixture-b',accountIdentifier:'fixture-service-b',realmId:'fixture-realm-b',hash:'fixture-b-hash'}];
  const beforeB=JSON.stringify(f.state.account.allAccounts[1]);
  assert.equal(await f.store('fixture-new-hash','fixture-new-wrap',f.service),false);
  const saved=JSON.parse(f.records.get(f.service).password);
  const owner=f.state.account.allAccounts.find(a=>a.appId==='fixture-a');
  assert.equal(owner.hash,saved.hash);assert.equal(owner.hash,'fixture-new-hash');
  assert.equal(f.state.account.allAccounts.find(a=>a.hash===saved.hash).realmId,'fixture-realm');
  assert.equal(f.state.storage.appId,'fixture-b');
  assert.equal(JSON.stringify(f.state.account.allAccounts[1]),beforeB);
  assert.deepEqual(f.calls.filter(c=>c.kind==='owner-metadata').map(c=>c.appId),['fixture-a']);
});
test('confirmed write cannot finalize a removed or replaced owner or create a ghost account',async()=>{
  for(const replace of [false,true]){
    const f=fixture({onWrite(c){c.switchSession();c.state.account.allAccounts=replace?
      [{...c.state.account.allAccounts[0],realmId:'fixture-replaced-realm'}]:[];}});
    assert.equal(await f.store('fixture-new-hash','fixture-new-wrap',f.service),false);
    assert.equal(f.calls.some(c=>c.kind==='owner-metadata'),false);
    assert.equal(f.state.account.allAccounts.length,replace?1:0);
  }
});

// Keep fixture names local to this TypeScript module. Jest provides global test.
export {};
