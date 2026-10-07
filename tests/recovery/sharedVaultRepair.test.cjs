const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encryption, image, harness, wallet, loadModule } = require('./helpers.cjs');
const { prepareRecoveryImage } = loadModule('src/services/backup/restore.ts', { './image': image });
const clone = value => JSON.parse(JSON.stringify(value));
function fixture({ unavailable = ['shared'], leaveUnavailable = false } = {}) {
  const state = {
    appImage: { appId:'disposable', wallets:{}, signers:{}, nodes:[], vaults:['shared'], labels:[] },
    allVaultImages:[], labels:[], unavailableVaultIds:unavailable, revision:'a'.repeat(64),
  };
  let uploads=0;
  const f=harness({ adapter:async (endpoint,payload) => {
    if(endpoint==='getBackupSnapshot') return {data:clone(state)};
    assert.equal(endpoint,'repairAppBackup');
    assert.equal(payload.expectedRevision,state.revision);
    assert.equal(payload.replaceCurrentState,true);
    uploads++;
    Object.assign(state.appImage, {wallets:payload.walletObject,signers:payload.signersObject,
      nodes:payload.nodes,vaults:Object.keys(payload.vaultObject),labels:payload.labels.map(v=>v.id)});
    state.allVaultImages=Object.values(payload.vaultObject);
    state.labels=payload.labels;
    if (!leaveUnavailable) state.unavailableVaultIds=[];
    state.revision='b'.repeat(64);
    return {data:{updated:true}};
  }});
  f.local.Vault.push({...wallet('shared'),signers:[],scheme:{m:1,n:1},archived:false});
  const key=encryption.generateEncryptionKey(f.app.primarySeed);
  return {f,state,key,uploads:()=>uploads};
}
test('unavailable collaborative ciphertext requires user action and cannot be clean-restored',async()=>{
  const {f,state,key,uploads}=fixture();
  assert.equal(await f.run(),'different');
  assert.equal(uploads(),0);
  assert.deepEqual(f.calls,['getBackupSnapshot']);
  await assert.rejects(prepareRecoveryImage(key,f.app.id,state.appImage,state.allVaultImages,state.labels));
});
test('explicit local resubmission replaces missing account copy and verifies clean recovery',async()=>{
  const {f,state,key,uploads}=fixture();
  assert.equal(await f.run(true),'verified');
  assert.equal(uploads(),1);
  assert.deepEqual(state.unavailableVaultIds,[]);
  const recovered=await prepareRecoveryImage(key,f.app.id,state.appImage,state.allVaultImages,state.labels);
  assert.deepEqual(clone(recovered.vaults.shared),f.local.Vault[0]);
  assert.deepEqual(f.calls,['getBackupSnapshot','repairAppBackup','getBackupSnapshot']);
});
test('missing server-only vault cannot look matched; explicit current-state replacement removes it',async()=>{
  const {f,state,uploads}=fixture(); f.local.Vault.length=0;
  assert.equal(await f.run(),'different'); assert.equal(uploads(),0);
  assert.equal(await f.run(true),'verified');
  assert.deepEqual(state.appImage.vaults,[]); assert.equal(uploads(),1);
});
for(const problem of ['identity','ahead address counter']) test(`available ${problem} conflict still blocks missing-copy repair`,async()=>{
  const {f,state,key,uploads}=fixture();
  f.local.Wallet.push(wallet('other')); const remote=wallet('other');
  if(problem==='identity') remote.specs.xpub='another-key';
  else remote.specs.nextFreeAddressIndex=2;
  state.appImage.wallets.other=encryption.encrypt(key,JSON.stringify(remote));
  assert.equal(await f.run(true),'conflict'); assert.equal(uploads(),0);
});
for(const unavailable of [['not-referenced'],['shared','shared'],[null],'shared']) test(`malformed missing-copy metadata cannot authorize an upload: ${JSON.stringify(unavailable)}`,async()=>{
  const {f,uploads}=fixture({unavailable});
  assert.equal(await f.run(true),'unverified'); assert.equal(uploads(),0);
});
test('an acknowledged upload that still has unavailable vaults is never verified',async()=>{
  const {f,uploads}=fixture({leaveUnavailable:true});
  assert.equal(await f.run(true),'unverified'); assert.equal(uploads(),1);
});
test('archive metadata mismatch is read-only until explicit backup and must match after readback',async()=>{
  const {f,state,key,uploads}=fixture({unavailable:[]});
  f.local.Vault[0].archived=true;
  state.allVaultImages=[{vaultId:'shared',vault:encryption.encrypt(key,JSON.stringify(f.local.Vault[0])),isArchived:false}];
  assert.equal(await f.run(),'different'); assert.equal(uploads(),0);
  assert.equal(await f.run(true),'verified'); assert.equal(uploads(),1);
  assert.equal(state.allVaultImages[0].isArchived,true);
});

for(const archived of [true,false]) test(`existing-wallet update carries signer maps and archive state: archived=${archived}`,async()=>{
  const {fixture:sagaFixture,enums,signer}=require('./sagaHarness.cjs');
  const f=sagaFixture();
  const device=signer('AABBCCDD',enums.NetworkType.MAINNET,enums.SignerType.LEDGER,0);
  device.id=f.scope.getKeyUID(device);
  f.collections.Signer.push(device);
  const key={masterFingerprint:device.masterFingerprint,...device.signerXpubs[enums.XpubTypes.P2WPKH][0]};
  const vault={id:'reinstated',networkType:enums.NetworkType.MAINNET,signers:[key],scheme:{m:1,n:1},archived};
  let uploaded;
  f.scope.Relay.updateVaultImage=async payload=>{uploaded=payload;return {updated:true};};
  await f.run('updateVaultImageWorker',{payload:{vault,isUpdate:true}});
  assert.equal(uploaded.appId,f.app.id);
  assert.equal(uploaded.isArchived,archived);
  assert.equal(uploaded.signersData.length,1);
  assert.equal(uploaded.signersData[0].signerId,f.scope.getKeyUID(key));
  assert.equal(uploaded.signersData[0].xfpHash,encryption.hash256(key.masterFingerprint));
  const restored=JSON.parse(encryption.decrypt(encryption.generateEncryptionKey(f.app.primarySeed),uploaded.vault));
  assert.equal(restored.archived,uploaded.isArchived);
  assert.equal(restored.signers[0].masterFingerprint,key.masterFingerprint);
});
