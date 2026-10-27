'use strict';
export {};
// Actual production generator bodies with disposable effects/storage models.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const proposed=fs.readFileSync(path.join(__dirname,'../../src/store/sagas/login.ts'),'utf8');
function worker(source,name,watcher){
  const start=source.indexOf('function* '+name+'('),end=source.indexOf('\nexport const '+watcher,start);
  assert(start>=0&&end>start);
  let text=source.slice(start,end).replaceAll('(state: RootState)','(state)');
  if(name==='changeLoginMethodWorker'){
    const open=text.indexOf('\n}) {');assert(open>0);
    text='function* changeLoginMethodWorker({payload}) {'+text.slice(open+'\n}) {'.length);
  }
  return text;
}
function fixture({source=proposed,storeResult=true,afterWrite,afterRealm,realmAppId='fixture-a'}: any = {}){
  let epoch=1;
  const state={storage:{appId:'fixture-a'},account:{allAccounts:[
    {appId:'fixture-a',accountIdentifier:'fixture-service-a',realmId:'fixture-realm-a',hash:'digest:pin-a'},
    {appId:'fixture-b',accountIdentifier:'fixture-service-b',realmId:'fixture-realm-b',hash:'digest:pin-b'}]}};
  const calls=[],puts=[];
  const effects={call:(fn,...args)=>({kind:'call',fn,args}),select:fn=>({kind:'select',fn}),put:action=>({kind:'put',action})};
  const action=(type)=>(payload)=>({type,payload});
  const secure={
    async fetch(hash){calls.push({kind:'fetch',hash});return hash==='digest:pin-b'?'wrap-b':'wrap-a';},
    async fetchSpecific(hash,appId){calls.push({kind:'fetchSpecific',hash,appId});if(appId!=='fixture-a'||hash!=='digest:pin-a')throw new Error('CONTROLLED_WRONG_CURRENT_PIN');return 'wrap-a';},
    async store(hash,wrap,service){calls.push({kind:'store',hash,wrap,service});if(afterWrite)afterWrite(control);
      // The separately source-executed store body finalizes only its confirmed owner.
      if(source===proposed&&storeResult===true)state.account.allAccounts=state.account.allAccounts.map(a=>
        a.accountIdentifier===service?{...a,hash}:a);
      return storeResult;},
    async storeBiometricPubKey(){calls.push({kind:'bio'});if(afterWrite)afterWrite(control);return true;},
  };
  const context=vm.createContext({...effects,SecureStore:secure,store:{getState:()=>state},
    currentBackupAccountSession:()=>epoch,hash512:pin=>'digest:'+pin,
    decrypt:(_hash,wrap)=>wrap==='wrap-b'?'b'.repeat(64):'a'.repeat(64),
    encrypt:(hash,key)=>({hash,key}),
    updatePasscodeHash:action('updateHash'),setPinHash:action('currentPinHash'),credsChanged:action('credsChanged'),pinChangedFailed:action('pinFailed'),
    dbManager:{getObjectByIndex:()=>{if(afterRealm)afterRealm(control);return {id:realmAppId};}},RealmSchema:{KeeperApp:'fixture-schema'},
    LoginMethod:{PIN:'pin',BIOMETRIC:'bio'},setLoginMethod:action('loginMethod'),setBiometricEnabledAppId:action('biometricApp'),console:{log(){}}});
  async function execute(name,watcher,payload){
    const fn=vm.runInContext('('+worker(source,name,watcher)+')',context),g=fn({payload});
    let step=g.next();
    while(!step.done){
      const e=step.value;
      try{
        let result;
        if(e.kind==='call')result=await e.fn(...e.args);
        else if(e.kind==='select')result=e.fn(state);
        else if(e.kind==='put'){puts.push(e.action);result=undefined;}
        else throw new Error('Unexpected modeled effect');
        step=g.next(result);
      }catch(err){step=g.throw(err);}
    }
  }
  const control={state,calls,puts,switchSession(){epoch++;},
    pin:(oldPasscode='pin-a',newPasscode='new-pin')=>execute('changeAuthCredWorker','changeAuthCredWatcher',{oldPasscode,newPasscode}),
    bio:()=>execute('changeLoginMethodWorker','changeLoginMethodWatcher',{method:'bio',pubKey:'fixture-public-key'})};
  return control;
}
test('patched PIN caller rejects another account PIN before any write',async()=>{
  const f=fixture();await f.pin('pin-b');
  assert.equal(f.calls.some(c=>c.kind==='store'),false);
  assert.equal(f.calls[0].kind,'fetchSpecific');assert.equal(f.calls[0].appId,'fixture-a');
  assert.equal(f.puts.some(a=>a.type==='updateHash'),false);
});
test('patched PIN caller performs one write and preserves exact current64ASCII key',async()=>{
  const f=fixture();await f.pin();const writes=f.calls.filter(c=>c.kind==='store');
  assert.equal(writes.length,1);assert.equal(writes[0].wrap.key,'a'.repeat(64));
  assert.equal(f.state.account.allAccounts[0].hash,'digest:new-pin');
  assert.equal(f.puts.filter(a=>a.type==='updateHash').length,0);
  assert(f.puts.some(a=>a.type==='credsChanged'&&a.payload==='changed'));
  assert(f.puts.some(a=>a.type==='currentPinHash'&&a.payload==='digest:new-pin'));
});
test('truthy duplicate PIN result is failure without metadata publication or second write',async()=>{
  const f=fixture({storeResult:'Passcode already exists'});await f.pin();
  assert.equal(f.calls.filter(c=>c.kind==='store').length,1);
  assert.equal(f.puts.some(a=>a.type==='updateHash'),false);
  assert(f.puts.some(a=>a.type==='credsChanged'&&a.payload==='not-changed'));
});
test('false write result cannot publish PIN success',async()=>{
  const f=fixture({storeResult:false});await f.pin();
  assert.equal(f.puts.some(a=>a.type==='updateHash'),false);
});
test('session change after issued PIN write suppresses stale completion',async()=>{
  const f=fixture({afterWrite(c){c.switchSession();}});await f.pin();
  assert.equal(f.puts.length,0);
});
test('session change after biometric write cannot enable new account login method',async()=>{
  const f=fixture({afterWrite(c){c.switchSession();}});await f.bio();
  assert.equal(f.puts.length,0);
});
test('account switch during initial Realm read cannot bind biometric request to another account',async()=>{
  const f=fixture({afterRealm(c){c.switchSession();c.state.storage.appId='fixture-b';}});await f.bio();
  assert.equal(f.calls.some(c=>c.kind==='bio'),false);assert.equal(f.puts.length,0);
});
test('wrong Realm identity cannot enable biometric login for selected account',async()=>{
  const f=fixture({realmAppId:'fixture-b'});await f.bio();
  assert.equal(f.calls.some(c=>c.kind==='bio'),false);assert.equal(f.puts.length,0);
});
test('same-app Realm identity change after biometric write suppresses completion',async()=>{
  const f=fixture({afterWrite(c){c.state.account.allAccounts=c.state.account.allAccounts.map(a=>a.appId==='fixture-a'?{...a,realmId:'fixture-replaced-realm'}:a);}});await f.bio();
  assert.equal(f.puts.length,0);
});

// Keep fixture names local to this TypeScript module. Jest provides global test.
export {};
