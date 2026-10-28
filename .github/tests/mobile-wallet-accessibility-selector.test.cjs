'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const native=path.resolve(__dirname,'../native');
const pattern='(?:Hot Wallet, Single-Key, )?Mobile Wallet';
test('the actual Android leaf and iOS grouped card satisfy every mobile-wallet assertion',()=>{
 let count=0;
 for(const file of fs.readdirSync(native).filter(x=>x.endsWith('.yaml'))){
  const text=fs.readFileSync(path.join(native,file),'utf8');
  assert.ok(!text.includes('- assertVisible: Mobile Wallet'),file+' must handle the observed iOS accessibility group');
  for(const line of text.split('\n').filter(x=>x.includes('- assertVisible:')&&x.includes('Mobile Wallet'))){
   assert.equal(line.trim(),"- assertVisible: '"+pattern+"'");
   const regex=new RegExp('^(?:'+pattern+')$');
   for(const label of ['Mobile Wallet','Hot Wallet, Single-Key, Mobile Wallet'])assert.ok(regex.test(label));
   for(const label of ['Other Wallet','Hot Wallet, Multi-Key, Mobile Wallet','Mobile Wallet 2','Hot Wallet, Single-Key, Other Wallet',''])assert.ok(!regex.test(label));
   count++;
  }
 }
 assert.equal(count,17,'Keep every existing wallet-name obligation');
});
