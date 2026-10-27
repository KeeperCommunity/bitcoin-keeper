'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {test}=require('node:test');
const fixtures=require('../../tests/electrum/fixtures.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const ids=['explicit_root_valid_before','selfsigned_untrusted','expired_leaf','wrong_host','forged_signature',
  'explicit_custom_ca','explicit_selfsigned_leaf','explicit_wrong_host','expired_custom_ca','expired_selfsigned_leaf',
  'custom_trust_not_inherited','wrong_custom_anchor',...Array.from({length:3},(_,i)=>'withdrawn_anchor_'+i),
  ...Array.from({length:8},(_,i)=>'compromised_spki_anchor_'+i),'explicit_root_valid_after','disposable_simulator_system_root'];
const positives=new Set(['explicit_root_valid_before','explicit_custom_ca','explicit_selfsigned_leaf',
  'explicit_root_valid_after','disposable_simulator_system_root']);

async function observedMatrix(platform) {
  let before;
  const original=fixtures.certificates;
  fixtures.certificates=()=>{
    const value=original();
    before={key:hash(fs.readFileSync(path.join(value.dir,'selfsigned.key'))),
      certs:Object.fromEntries(fs.readdirSync(value.dir).filter(n=>n.endsWith('.pem')).map(n=>
        [n,hash(new crypto.X509Certificate(fs.readFileSync(path.join(value.dir,n))).raw)]))};
    return value;
  };
  let createMatrix;
  try {
    delete require.cache[require.resolve('../native/r52_tls_fixture.cjs')];
    ({createMatrix}=require('../native/r52_tls_fixture.cjs'));
  }finally{fixtures.certificates=original;}
  const matrix=await createMatrix(platform);
  return {matrix,before};
}

test('IOS corrects only selfsigned certificate profile, preserving key, negatives and all25 expectations',async t=>{
  const {matrix,before}=await observedMatrix('IOS');t.after(matrix.close);
  const dir=path.dirname(matrix.rootPath),cert=new crypto.X509Certificate(fs.readFileSync(path.join(dir,'selfsigned.pem')));
  assert.equal(hash(fs.readFileSync(path.join(dir,'selfsigned.key'))),before.key);
  assert.equal(cert.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(path.join(dir,'selfsigned.key')))),true);
  assert.equal(cert.subject,'CN=selfsigned');assert.equal(cert.ca,false);
  assert.equal(cert.checkHost('localhost'),'localhost');assert.equal(cert.checkIP('127.0.0.1'),'127.0.0.1');
  assert.ok(cert.keyUsage.includes('1.3.6.1.5.5.7.3.1'));
  const usage=execFileSync('openssl',['x509','-in',path.join(dir,'selfsigned.pem'),'-noout','-ext','keyUsage'],{encoding:'utf8'});
  assert.match(usage,/Key Usage: critical/);assert.match(usage,/Digital Signature, Key Encipherment/);
  for(const[name,sha]of Object.entries(before.certs)){
    const actual=hash(new crypto.X509Certificate(fs.readFileSync(path.join(dir,name))).raw);
    if(name==='selfsigned.pem')assert.notEqual(actual,sha);else assert.equal(actual,sha,name);
  }
  assert.deepEqual(matrix.config.cases.map(({id,expected})=>({id,expected})),ids.map(id=>({id,expected:positives.has(id)?'ACCEPT':'REJECT'})));
  const expired=new crypto.X509Certificate(fs.readFileSync(path.join(dir,'expired-selfsigned.pem')));
  assert.equal(expired.validTo,'Jan  1 00:00:00 2001 GMT');
});

test('ANDROID preserves original CA-only selfsigned bytes and24 expectations',async t=>{
  const {matrix,before}=await observedMatrix('ANDROID');t.after(matrix.close);
  const dir=path.dirname(matrix.rootPath),cert=new crypto.X509Certificate(fs.readFileSync(path.join(dir,'selfsigned.pem')));
  assert.equal(hash(cert.raw),before.certs['selfsigned.pem']);assert.equal(cert.ca,true);
  assert.equal(hash(fs.readFileSync(path.join(dir,'selfsigned.key'))),before.key);
  assert.equal(cert.keyUsage?.includes('1.3.6.1.5.5.7.3.1')||false,false);
  assert.deepEqual(matrix.config.cases.map(({id,expected})=>({id,expected})),ids.slice(0,-1).map(id=>({id,expected:positives.has(id)?'ACCEPT':'REJECT'})));
});
