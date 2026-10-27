'use strict';
// Execute the real probe wrapper with bounded fake RNFS/run callbacks; no native DB result is claimed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');const {test}=require('node:test');
const {CASES,failureCode}=require('../native/r52_realm109_core.js');
const root=path.resolve(__dirname,'../..'),source=fs.readFileSync(path.join(root,'.github/native/r52_realm109_probe.js'),'utf8');
const body=source.slice(source.indexOf('async function executeProbe() {'),source.indexOf('\nfunction Probe()'));
const config={schema:1,scope:'ACTUAL_NATIVE_SYNTHETIC_REALM109_TO_110',source_sha:'a'.repeat(40),nonce:'b'.repeat(48),platform:'IOS',
  historical_commit:'2b6c3ce56857b5dc92f17cc37453ff308d5a3ae8',manifest_sha256:'bc46b37001c423f96e8aff5ed3e8b63a3ac261224e5647a1dab13179eb54d4d2'};
const complete=()=>({...config,status:'PASS',old_version:109,new_version:110,schema_count:50,cases:CASES.map(id=>({id,status:'PASS'}))});
function harness(run,{writeFailure=false,unlinkFailure=false,stale=false,valid=true}={}){
  const events=[],writes=[];let exists=stale;
  const RNFS={DocumentDirectoryPath:'/SYNTHETIC_OWNED_APP/Documents',
    exists:async()=>exists,mkdir:async()=>{events.push('mkdir');exists=true;},
    unlink:async()=>{events.push('directory_cleanup');if(unlinkFailure)throw Error('PRIVATE_UNLINK_SENTINEL');exists=false;},
    writeFile:async(file,text)=>{events.push('receipt_write');writes.push(JSON.parse(text));if(writeFailure)throw Error('PRIVATE_WRITE_SENTINEL');}};
  const module={exports:{}};
  vm.runInNewContext(body+'\nmodule.exports=executeProbe;', {module,run,CASES,failureCode,RNFS,
    config:{...config,nonce:valid?config.nonce:'INVALID'},__DEV__:true,Platform:{OS:'ios'},Realm:{},RealmDatabase:{},oldSchema:[],schema:[],
    global:{crypto:{getRandomValues:array=>array.fill(1)}}});
  return{execute:module.exports,events,writes};
}
test('failure receipt precedes native and directory cleanup and preserves ordered completed prefix',async()=>{
  const primary=Error('REALM109_INITIALIZE');let h;
  h=harness(async options=>{
    options.onProgress([{id:CASES[0],status:'PASS'}]);
    await options.onFailure({failure:'REALM109_INITIALIZE',cases:[{id:CASES[0],status:'PASS'}]});
    h.events.push('native_cleanup');options.onCleanup({native_handles:'PASS',key_zeroization:'PASS'});throw primary;
  });
  await assert.rejects(h.execute,error=>error===primary);
  assert.ok(h.events.indexOf('receipt_write')<h.events.indexOf('native_cleanup'));
  assert.ok(h.events.indexOf('native_cleanup')<h.events.indexOf('directory_cleanup'));
  const first=h.writes[0],last=h.writes.at(-1);
  assert.equal(first.failure_capture_phase,'BEFORE_NATIVE_HANDLE_CLEANUP');assert.equal(first.first_write_before_cleanup,'PENDING');
  assert.equal(first.failure_receipt_write,'ATTEMPTED');assert.equal(last.first_write_before_cleanup,'PASS');
  assert.equal(last.status,'FAIL');assert.equal(last.failure,'REALM109_INITIALIZE');assert.equal(last.cleanup.owned_directory,'PASS');
  assert.deepEqual(last.cases,[{id:CASES[0],status:'PASS'}]);assert.equal(last.complete_native_acceptance,false);
  assert.doesNotMatch(JSON.stringify(last),/SYNTHETIC_OWNED_APP|PRIVATE_/);
});
test('receipt and directory cleanup errors never replace any original unknown or falsy throw',async()=>{
  for(const primary of [Error('PRIVATE_NATIVE_SENTINEL'),null,undefined,0,false,'']){
    const h=harness(async options=>{await options.onFailure({failure:'REALM109_NATIVE_OR_APP_EXCEPTION',cases:[]});throw primary;},
      {writeFailure:true,unlinkFailure:true});
    let caught=false;try{await h.execute();}catch(error){caught=true;assert.equal(error,primary);}
    assert.equal(caught,true);const last=h.writes.at(-1);assert.equal(last.status,'FAIL');
    assert.equal(last.failure,'REALM109_NATIVE_OR_APP_EXCEPTION');assert.equal(last.cleanup.owned_directory,'FAIL');
    assert.equal(last.first_write_before_cleanup,'FAIL');assert.doesNotMatch(JSON.stringify(last),/PRIVATE_/);
  }
});
test('success receipt has exactly the unchanged payload shape accepted by the actual Python validator',async()=>{
  const h=harness(async()=>complete());assert.equal(await h.execute(),'pass');
  const actual=h.writes.at(-1),expected={...complete(),synthetic_database_cleanup:'PASS'};
  assert.deepEqual(actual,expected);assert.equal(h.writes.length,1);
  const program="import importlib.util,json,sys;from pathlib import Path;p=Path('.github/native/r52_realm109_native.py');s=importlib.util.spec_from_file_location('m',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);v=json.load(sys.stdin);assert len(m.validate({'nonce':v['nonce']},v,'IOS',v['source_sha']))==11";
  const checked=spawnSync('python3',['-B','-c',program],{cwd:root,input:JSON.stringify(actual),encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
});
test('stale directories are never adopted and invalid source context emits no fabricated receipt',async()=>{
  const stale=harness(async()=>{throw Error('MUST_NOT_RUN');},{stale:true});
  await assert.rejects(stale.execute,/REALM109_STALE_DATABASE/);assert.equal(stale.events.includes('directory_cleanup'),false);
  assert.equal(stale.writes.at(-1).cleanup.owned_directory,'NOT_OWNED');
  const invalid=harness(async()=>{throw Error('MUST_NOT_RUN');},{valid:false});
  await assert.rejects(invalid.execute,/REALM109_DEVELOPMENT_FIXTURE_REQUIRED/);assert.equal(invalid.writes.length,0);
  assert.deepEqual(invalid.events,[]);
});
test('probe UI retains failed state and top-level import/bootstrap gaps remain explicitly uncaptured',()=>{
  assert.match(source,/executeProbe\(\)\.catch\(\(\) => 'failed'\)/);
  assert.ok(source.indexOf("import Realm from 'realm'")<source.indexOf('async function executeProbe'));
  assert.match(source,/r52-realm109-\$\{stage\}/);
});
