'use strict';
// Control hooks and exact SDK prebinding behavior only; no native Realm binding/DB is loaded.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const crypto=require('node:crypto');const {test}=require('node:test');
const core=require('../native/r52_realm109_core.js');
const root=path.resolve(__dirname,'../..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const config={schema:1,scope:'ACTUAL_NATIVE_SYNTHETIC_REALM109_TO_110',realm_package:'12.15.0',schema_count:50,
  public_ca:'-----BEGIN CERTIFICATE-----\nSYNTHETIC_CONTROL_ONLY'};
const oldSchema=[{name:'NodeConnect',properties:{}},{name:'DefaultNodeConnect',properties:{}},...Array.from({length:48},()=>({}))];
const schema=[{name:'NodeConnect',properties:{tlsCa:'string?'}},{name:'DefaultNodeConnect',properties:{tlsCa:'string?'}}];
function control(writeFailure,closeFailure,initialize=false){
  const events=[],keys=[],store={NodeConnect:[],DefaultNodeConnect:[]};
  const Realm={open:async()=>({schemaVersion:109,isClosed:false,
    write(fn){if(writeFailure.present)throw writeFailure.value;fn();},create(type,row){store[type].push({...row});},
    objects(type){return store[type];},close(){events.push('native_close');if(closeFailure)throw closeFailure;this.isClosed=true;}})};
  class RealmDatabase{static schemaVersion=110;async initializeDatabase(){return{success:initialize};}}
  return{events,keys,options:{Realm,RealmDatabase,oldSchema,schema,config,directory:'/SYNTHETIC_CONTROL',
    randomBytes:length=>{const key=new Uint8Array(length).fill(keys.length+1);keys.push(key);return key;}}};
}
test('original core failure wins receipt callback and handle cleanup failures, including falsy throws',async()=>{
  for(const primary of [new Error('PRIVATE_NATIVE_SENTINEL'),null,0,false]){
    const value=control({present:true,value:primary},new Error('PRIVATE_CLOSE_SENTINEL'));
    let failure,cleanup,caught=false;
    try{await core.run({...value.options,onFailure:async row=>{value.events.push('failure_receipt');failure=row;throw Error('PRIVATE_RECEIPT_SENTINEL');},
      onCleanup:row=>{cleanup=row;value.events.push('cleanup_observed');}});}catch(error){caught=true;assert.equal(error,primary);}
    assert.equal(caught,true);assert.deepEqual(failure,{failure:'REALM109_NATIVE_OR_APP_EXCEPTION',cases:[]});
    assert.equal(cleanup.native_handles,'FAIL');assert.equal(cleanup.key_zeroization,'PASS');
    assert.ok(value.events.indexOf('failure_receipt')<value.events.indexOf('native_close'));
    assert.ok(value.keys.every(key=>key.every(b=>b===0)));
    assert.doesNotMatch(JSON.stringify({failure,cleanup}),/PRIVATE_/);
  }
});
test('completed progress is an isolated ordered prefix and literal assertion failure remains literal',async()=>{
  const value=control({present:false});let observed;
  await assert.rejects(()=>core.run({...value.options,onProgress:rows=>{rows[0].id='PRIVATE_MUTATION';},
    onFailure:async row=>{observed=row;}}),/REALM109_INITIALIZE/);
  assert.deepEqual(observed,{failure:'REALM109_INITIALIZE',cases:[{id:core.CASES[0],status:'PASS'}]});
});
test('failure category reads hostile error fields once and never exports arbitrary messages',()=>{
  let calls=0;const error={get message(){calls++;return calls===1?'REALM109_ROWS':'PRIVATE_SENTINEL';}};
  assert.equal(core.failureCode(error),'REALM109_ROWS');assert.equal(calls,1);
  assert.equal(core.failureCode({message:'/private/key/db.realm'}),'REALM109_NATIVE_OR_APP_EXCEPTION');
});
test('bounded unique id lookup requires exactly one actual id and never calls primary-key API',()=>{
  const row={id:101};assert.equal(core.identity({objects:()=>[row]},'NodeConnect',101),row);
  for(const rows of [[],[{id:101},{id:101}],Array.from({length:17},(_,id)=>({id}))])
    assert.throws(()=>core.identity({objects:()=>rows},'NodeConnect',101),/REALM109_IDENTITY_LOOKUP/);
  assert.throws(()=>core.identity({objects:()=>[]},'Other',101),/REALM109_IDENTITY_LOOKUP/);
});
test('actual current/historical schemas reject exact pinned SDK primary-key method before native binding',()=>{
  let ts;try{ts=require('typescript');}catch{ts=require('/workspace/r5-private-265-intake-20261025/r52-host-security-20261025/node_modules/typescript');}
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'.github/native/r52_retained_manifest.json')));
  const expected=manifest.runtime_files.find(r=>r.path==='node_modules/realm/dist/Realm.js').sha256;
  const candidates=[path.join(root,'node_modules/realm/dist/Realm.js'),'/workspace/r5-resume/security-tools/private4f48-deps/node_modules/realm/dist/Realm.js'];
  const sdk=fs.readFileSync(candidates.find(f=>fs.existsSync(f)));assert.equal(hash(sdk),expected);
  const tree=ts.createSourceFile('Realm.js',sdk.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let method;
  const walk=node=>{if(ts.isMethodDeclaration(node)&&node.name?.getText(tree)==='objectForPrimaryKey')method=node.getText(tree);ts.forEachChild(node,walk);};walk(tree);
  assert.ok(method);assert.equal(hash(method),'e447c06ba085382462715d54b5fe05823fa0965b7fb41d551713302efdab0f35');
  const Exact=vm.runInNewContext('(class ExactSDK {'+method+'})');
  const historical=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/realm109-node-schema-source.json')));
  const approved=JSON.parse(fs.readFileSync(path.join(root,'tests/recovery/fixtures/realm109-node-source.json')));
  const compile=(source,imports={})=>{const module={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,require:name=>imports[name]});return module.exports;};
  for(const revision of ['CURRENT','HISTORICAL']){
    const read=name=>revision==='CURRENT'?fs.readFileSync(path.join(root,name),'utf8'):historical.sources[name];
    if(revision==='HISTORICAL')for(const[name,raw]of Object.entries(historical.sources))assert.equal(hash(raw),approved.files.find(r=>r.path===name).sha256);
    const enums=compile(read('src/storage/realm/enum.ts'));
    const nodes=compile(read('src/storage/realm/schema/nodeConnect.ts'),{'../enum':enums});
    for(const objectSchema of Object.values(nodes)){
      assert.equal(Object.hasOwn(objectSchema,'primaryKey'),false);
      const realm=new Exact();realm.classes={getHelpers:()=>({objectSchema,properties:new Map(),wrapObject(){throw Error('MUST_NOT_REACH_BINDING');}})};
      assert.throws(()=>realm.objectForPrimaryKey(objectSchema.name,101),/Expected a primary key/);
    }
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root,'.github/native/r52_realm109_core.js'),'utf8'),/\.objectForPrimaryKey\(/);
});

test('cleanup observer mutation cannot hide native cleanup failure after all original assertions succeed',async()=>{
  // This finite in-memory I/O control executes the real core; it is not a native migration proof.
  const files=new Map(),keys=[];let current,closing=false;
  const open=async options=>{
    let file=files.get(options.path);
    if(file){if(!options.encryptionKey||options.encryptionKey!==file.key)throw Error('CONTROL_WRONG_KEY');}
    else{file={key:options.encryptionKey,version:options.schemaVersion,NodeConnect:[],DefaultNodeConnect:[]};files.set(options.path,file);}
    return {schemaVersion:file.version,isClosed:false,objects:type=>file[type],write:fn=>fn(),
      create(type,row){file[type].push({...row,tlsCa:file.version===110?null:undefined});},
      close(){if(closing)throw Error('CONTROL_NATIVE_CLOSE');this.isClosed=true;}};
  };
  class RealmDatabase{
    static schemaVersion=110;
    async initializeDatabase(key,filename){const file=files.get(filename);file.version=110;
      for(const type of ['NodeConnect','DefaultNodeConnect'])for(const row of file[type])if(row.tlsCa===undefined)row.tlsCa=null;
      current=await open({path:filename,encryptionKey:key});return {success:true};}
    getDatabase(){return current;}
  }
  let observed;
  await assert.rejects(()=>core.run({Realm:{open},RealmDatabase,oldSchema,schema,config,directory:'/SYNTHETIC_CONTROL',
    randomBytes:length=>{const key=new Uint8Array(length).fill(keys.length+1);keys.push(key);return key;},
    onProgress:rows=>{if(rows.length===11)closing=true;},
    onCleanup:row=>{observed={...row};row.native_handles='PASS';row.key_zeroization='PASS';}}),/REALM109_NATIVE_CLEANUP_FAILED/);
  assert.equal(observed.native_handles,'FAIL');assert.ok(keys.every(key=>key.every(b=>b===0)));
});
