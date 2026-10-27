'use strict';
// Actual production service and hash-pinned SDK with real loopback TLS.
// Store/Realm/crypto imports are controlled only to isolate this lifecycle; not RN/native proof.
// The late-error race uses an event on the owned socket; natural close/RST remain separate tests.
const {test}=require('node:test');
const crypto=require('node:crypto');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),tls=require('node:tls'),net=require('node:net');
const root=path.resolve(__dirname,'../..');
const ts=require(process.env.KEEPER_TEST_TYPESCRIPT_PACKAGE || 'typescript');
const {certificates}=require(path.join(root,'tests/electrum/fixtures.cjs'));
const sdkRoot=process.env.KEEPER_TEST_ELECTRUM_DIR || path.dirname(require.resolve('electrum-client/package.json'));
const pins=JSON.parse(fs.readFileSync(path.join(root,'.github/native/r52_retained_manifest.json')));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function execute(source,requireFn,isTS=false,extras={}){
 const module={exports:{}};const code=isTS?ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText:source;
 vm.runInNewContext(code,{module,exports:module.exports,require:requireFn,console:{log(){},warn(){}},setTimeout,clearTimeout,Buffer,Error,...extras});return module.exports;
}
function pinnedSDK(){const cache=new Map();function load(name){name=name.replace(/\.js$/,'');if(cache.has(name))return cache.get(name);const file=path.join(sdkRoot,name+'.js');assert.ok(fs.existsSync(file));const raw=fs.readFileSync(file),pin=[...pins.runtime_files,...pins.patch_outputs].find(r=>r.path==='node_modules/electrum-client/'+name+'.js');assert.ok(pin);assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),pin.sha256,'Exact executed SDK bytes required');const value=execute(raw.toString(),req=>{if(req==='events')return require('node:events');assert.ok(req.startsWith('.'));return load(path.posix.normalize(path.posix.join(path.posix.dirname(name),req)));});cache.set(name,value);return value;}return load('index');}
async function waitFor(fn,ms=4500){const end=Date.now()+ms;while(!fn()&&Date.now()<end)await sleep(20);assert.ok(fn(),'CONTROL_BOUND_EXCEEDED');}
async function run(mode){
 const fixture=certificates(),rawSockets=new Set(),secureSockets=new Set(),events={clientErrors:0,clientCloses:0,SDKcallbacks:0,connections:0,versions:0};let app;const instances=[],calls=[];
 const service=tls.createServer({key:fixture.read('leaf.key'),cert:fixture.read('custom-leaf.pem')},socket=>{
  secureSockets.add(socket);socket.on('close',()=>secureSockets.delete(socket));let buffer='';socket.setEncoding('utf8');
  socket.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const end=buffer.indexOf('\n'),request=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(request.method==='server.version'){events.versions++;socket.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:['controlled-loopback','1.4']})+'\n');}else if(request.method==='server.ping')socket.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:null})+'\n');else assert.equal(request.method,'blockchain.headers.subscribe');}});
 });
 service.on('connection',socket=>{events.connections++;rawSockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>rawSockets.delete(socket));});
 await new Promise(resolve=>service.listen(0,'127.0.0.1',resolve));const port=service.address().port;
 const selected={id:910001,host:'127.0.0.1',port:String(port),useSSL:true,useKeeperNode:false,isConnected:false,networkType:'TESTNET',tlsCa:fixture.read('custom.pem')};
 const current={storage:{appId:null},settings:{bitcoinNetworkType:'TESTNET'}},actions=[];
 const enums={NetworkType:{MAINNET:'MAINNET',TESTNET:'TESTNET'}};
 const stateStore={getState:()=>current,dispatch:a=>actions.push(a)};
 const bridge={connectTLS(options,callback){assert.equal(options.host,'127.0.0.1');assert.equal(Number(options.port),port);assert.equal(options.rejectUnauthorized,true);assert.equal(options.tlsCheckValidity,true);assert.equal(options.servername,'127.0.0.1');assert.equal(options.ca,selected.tlsCa.trim());calls.push({caBound:true,portBound:true,verificationRequired:true});const socket=tls.connect(options,callback);socket.on('error',()=>events.clientErrors++);socket.on('close',()=>events.clientCloses++);return socket;}};
 const transport=execute(fs.readFileSync(path.join(root,'src/services/electrum/tls.js'),'utf8'),name=>{assert.equal(name,'react-native-tcp-socket');return bridge;});
 const predefined=execute(fs.readFileSync(path.join(root,'src/services/electrum/predefinedNodes.ts'),'utf8'),()=>enums,true);
 const peers=execute(fs.readFileSync(path.join(root,'src/services/electrum/peerSelection.ts'),'utf8'),name=>name.includes('predefinedNodes')?predefined:enums,true);
 const errors=execute(fs.readFileSync(path.join(root,'src/services/electrum/errorClassification.ts'),'utf8'),()=>{throw Error('UNEXPECTED_IMPORT')},true);
 const SDK=pinnedSDK();
 class ObservedSDK extends SDK{
  constructor(...args){super(...args);instances.push(this);}
  initElectrum(config,policy){assert.equal(policy.maxRetry,0);assert.equal(typeof policy.callback,'function');const callback=policy.callback;return super.initElectrum(config,{...policy,callback:()=>{events.SDKcallbacks++;return callback();}});}
 }
 const dependencies={'electrum-client':ObservedSDK,'buffer-reverse':value=>Buffer.from(value).reverse(),'bitcoinjs-lib':{initEccLib(){},networks:{bitcoin:{bech32:'bc'},testnet:{bech32:'tb'}}},'src/services/wallets/enums':enums,
  'src/storage/realm/dbManager':{getObjectByIndex:()=>({id:current.storage.appId}),updateObjectById:()=>true},'src/storage/realm/enum':{RealmSchema:{KeeperApp:'KeeperApp',NodeConnect:'NodeConnect'}},
  'src/store/reducers/login':{electrumClientConnectionExecuted:v=>({type:'CONTROL_OBSERVABLE_DISPATCH',payload:v})},'./torrific':{},'./tls':transport,'../rest/RestClient':{__esModule:true,default:{getTorStatus:()=>null},TorStatus:{CONNECTED:'connected'}},'../wallets/operations/taproot-utils/noble_ecc':{},'src/store/store':{store:stateStore},'./peerSelection':peers,'./errorClassification':errors};
 const module=execute(fs.readFileSync(path.join(root,'src/services/electrum/client.ts'),'utf8'),name=>{assert.ok(Object.hasOwn(dependencies,name),'UNEXPECTED_APP_IMPORT '+name);return dependencies[name]},true,{global:{net}});app=module.default;
 try{
  const other={...selected,id:910002,port:String(port+1),tlsCa:null};app.setActivePeer([selected,other],selected);assert.equal(module.ELECTRUM_CLIENT.peers.length,1);assert.equal((await app.connect()).connected,true);
  const original=module.ELECTRUM_CLIENT.electrumClient,oldSocket=original.conn,before=app.getConnectionGeneration();let pending='NOT_CREATED',settled=0,pendingGeneration;
  const hasPending=['CLOSE_ONLY_PENDING','ERROR_CLOSE_PENDING','CLOSE_THEN_LATE_ERROR'].includes(mode);
  if(hasPending){pending='PENDING';original.subscribe.on('blockchain.headers.subscribe',()=>{});app.getBlockchainHeaders().then(()=>{pending='RESOLVED';settled++;pendingGeneration=app.getConnectionGeneration();},()=>{pending='REJECTED';settled++;pendingGeneration=app.getConnectionGeneration();});await sleep(30);}
  if(mode==='STALE_SELECTION')current.storage.appId='CONTROL_NEW_ACCOUNT';
  if(mode==='STALE_NETWORK')current.settings.bitcoinNetworkType='MAINNET';
  if(mode==='ERROR_CLOSE_PENDING')for(const socket of rawSockets)socket.resetAndDestroy();
  else for(const socket of secureSockets)socket.end();
  if(mode==='CLOSE_THEN_LATE_ERROR'){await waitFor(()=>events.clientCloses===1);original.conn.emit('error',new Error('CONTROL_LATE_SOCKET_ERROR'));}
  if(mode==='FORCE_DISCONNECT'){await waitFor(()=>events.clientCloses===1);app.forceDisconnect();}
  if(mode==='REPLACED_GENERATION'){await waitFor(()=>events.clientCloses===1);const replacement={...selected,id:910003,isConnected:false};app.setActivePeer([replacement],replacement);assert.equal((await app.connect()).connected,true);}
  if(hasPending)await waitFor(()=>instances.length===2&&module.ELECTRUM_CLIENT.isClientConnected&&events.versions===2);
  else await sleep(1700);
  // Allow both delayed callbacks in the close-before-late-error control to run.
  await sleep(1200);
  const result={mode,instances:instances.length,connections:events.connections,versions:events.versions,naturalSocketErrors:events.clientErrors,naturalSocketCloses:events.clientCloses,SDKpolicyCallbacks:events.SDKcallbacks,appGenerationBefore:before,appGenerationAfter:app.getConnectionGeneration(),appClientReplaced:module.ELECTRUM_CLIENT.electrumClient!==original,sdkSocketReplaced:original.conn!==oldSocket,appConnected:module.ELECTRUM_CLIENT.isClientConnected,eligiblePeers:module.ELECTRUM_CLIENT.peers.length,allTLSConnectionsVerifiedAndCASelected:calls.every(r=>r.caBound&&r.portBound&&r.verificationRequired),pendingOutcome:pending,pendingSettlements:settled,pendingGeneration,oldPendingQueue:Object.keys(original.callback_message_queue).length,oldHeaderSubscriptions:original.subscribe.listenerCount('blockchain.headers.subscribe')};
  if(hasPending){assert.equal(result.instances,2);assert.equal(result.connections,2);assert.equal(result.versions,2);assert.equal(result.appClientReplaced,true);assert.ok(result.appGenerationAfter>before);assert.equal(result.pendingOutcome,'REJECTED');assert.equal(result.pendingSettlements,1);if(mode==='ERROR_CLOSE_PENDING')assert.ok(result.pendingGeneration>before,'Error-owned reconnect advances generation before rejection consumers resume');else assert.equal(result.pendingGeneration,before,'SDK close rejects pending calls before its documented delayed policy callback');assert.equal(result.oldPendingQueue,0);assert.equal(result.oldHeaderSubscriptions,0);}
  if(mode==='CLOSE_ONLY_PENDING')assert.equal(result.naturalSocketErrors,0);
  if(mode==='ERROR_CLOSE_PENDING')assert.ok(result.naturalSocketErrors>=1);
  if(['STALE_SELECTION','STALE_NETWORK'].includes(mode)){assert.equal(result.connections,1);assert.equal(result.instances,1);assert.equal(result.appGenerationAfter,before);assert.throws(()=>app.assertConnectionGeneration(before));}
  if(mode==='FORCE_DISCONNECT'){assert.equal(result.connections,1);assert.equal(result.instances,1);assert.equal(result.appConnected,false);assert.ok(result.appGenerationAfter>before);}
  if(mode==='REPLACED_GENERATION'){assert.equal(result.connections,2);assert.equal(result.instances,2);assert.equal(result.appClientReplaced,true);assert.ok(result.appGenerationAfter>before);}
  assert.equal(result.eligiblePeers,1);assert.equal(result.allTLSConnectionsVerifiedAndCASelected,true);return result;
 }finally{
  try{app?.forceDisconnect()}catch{};for(const socket of rawSockets)socket.destroy();for(const socket of secureSockets)socket.destroy();await new Promise(resolve=>service.close(resolve));fixture.cleanup();
 }
}
for(const mode of ['CLOSE_ONLY_PENDING','ERROR_CLOSE_PENDING','CLOSE_THEN_LATE_ERROR','STALE_SELECTION','STALE_NETWORK','REPLACED_GENERATION','FORCE_DISCONNECT'])
 test('actual production connection lifecycle: '+mode,{timeout:12000},async()=>{await run(mode)});
