const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { certificates, publicKeyCertificates } = require('./fixtures.cjs');

test('production iOS DER policy parses dates and SPKI, rejecting malformed and expired trust', () => {
  const fixture = certificates();
  try {
    const root = process.env.RN_TLS_PACKAGE || path.dirname(require.resolve('react-native-tcp-socket/package.json'));
    const header = path.join(root, 'ios/KeeperCertificatePolicy.h');
    const code = `#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "${header}"
static void date(unsigned tag,const char *text,int ok,int64_t expected) {
 unsigned char bytes[32];size_t n=strlen(text);bytes[0]=tag;bytes[1]=(unsigned char)n;memcpy(bytes+2,text,n);
 KeeperDER input={bytes,n+2};int64_t actual=0;assert(keeper_der_time(&input,&actual)==ok);
 if(ok){assert(actual==expected);assert(!input.size);}
}
int main(int argc,char **argv) {
 int64_t now=(int64_t)time(NULL);
 date(0x17,"500101000000Z",1,-631152000LL);
 date(0x17,"491231235959Z",1,2524607999LL);
 date(0x18,"20500101000000Z",1,2524608000LL);
 date(0x18,"20000229000000Z",1,951782400LL);
 date(0x18,"19000229000000Z",0,0);
 date(0x17,"261301000000Z",0,0);date(0x17,"260000000000Z",0,0);
 date(0x17,"261022240000Z",0,0);date(0x17,"261022006000Z",0,0);
 date(0x17,"261022000060Z",0,0);date(0x17,"261022000000+0000",0,0);
 date(0x17,"2610220000Z",0,0);date(0x18,"20500101000000X",0,0);
 date(0x17,"26x022000000Z",0,0);date(0x19,"261022000000Z",0,0);
 unsigned char malformed[]={0x30,0x80,0,0};KeeperDER m={malformed,sizeof malformed},v;
 assert(!keeper_der_take(&m,0x30,&v));
 unsigned char nonminimal[]={0x30,0x81,0x01,0};m=(KeeperDER){nonminimal,sizeof nonminimal};
 assert(!keeper_der_take(&m,0x30,&v));
 for(int i=1;i<argc;i++) {
  FILE *file=fopen(argv[i],"rb");assert(file);unsigned char bytes[8192];size_t count=fread(bytes,1,sizeof bytes,file);fclose(file);
  int expected=i<3||i>=6;assert(keeper_certificate_is_current(bytes,count,now)==expected);
  KeeperDER key;assert(keeper_certificate_spki(bytes,count,&key));
  char name[1024];assert(snprintf(name,sizeof name,"%s.spki",argv[i])<(int)sizeof name);
  file=fopen(name,"wb");assert(file);assert(fwrite(key.data,1,key.size,file)==key.size);fclose(file);
  assert(!keeper_certificate_is_current(bytes,count-1,now));
  assert(!keeper_certificate_spki(bytes,count-1,&key));
  for(size_t n=0;n<count;n++) {
   assert(!keeper_certificate_is_current(bytes,n,now));
   assert(!keeper_certificate_spki(bytes,n,&key));
  }
  assert(!keeper_certificate_is_current(bytes,count,0));
  assert(!keeper_certificate_is_current(bytes,count,4102444800LL));
 }
 return 0;
}`;
    const source = path.join(fixture.dir, 'policy.c'), binary = path.join(fixture.dir, 'policy');
    fs.writeFileSync(source, code);
    execFileSync(process.env.CC || 'cc', ['-std=c11', '-Wall', '-Wextra', '-Werror',
      '-fsanitize=address,undefined', source, '-o', binary], {stdio:'pipe'});
    const names = ['valid', 'root', 'expired', 'expired-root', 'expired-selfsigned'];
    const publicKeys = publicKeyCertificates(fixture);
    const certificates = [...names.map((name) => path.join(fixture.dir,`${name}.pem`)), ...publicKeys.map((entry) => entry.cert)];
    const ders = certificates.map((cert) => {
      const der = `${cert}.der`;
      execFileSync('openssl', ['x509','-in',cert,'-outform','DER','-out',der]); return der;
    });
    execFileSync(binary, ders, {stdio:'pipe'});
    for (let i=0;i<certificates.length;i++) {
      const publicKey = execFileSync('openssl', ['x509','-in',certificates[i],'-pubkey','-noout']);
      const spki = execFileSync('openssl',['pkey','-pubin','-outform','DER'], {input:publicKey});
      assert.deepEqual(fs.readFileSync(`${ders[i]}.spki`),spki);
      if(i>=names.length) assert.deepEqual(spki,publicKeys[i-names.length].spki);
    }
  } finally { fixture.cleanup(); }
});
