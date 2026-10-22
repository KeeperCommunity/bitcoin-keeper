const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { test } = require('node:test');
const { certificates, server, publicKeyCertificates } = require('./fixtures.cjs');

test('real dependency Java TLS: chain, name, explicit custom trust and startTLS', async (t) => {
  const fixture = certificates(); t.after(fixture.cleanup);
  const packageRoot = process.env.RN_TLS_PACKAGE || path.dirname(require.resolve('react-native-tcp-socket/package.json'));
  const source = path.join(packageRoot, 'android/src/main/java/com/asterinet/react/tcpsocket');
  const build = path.join(fixture.dir, 'classes'); fs.mkdirSync(build);
  const files = [];
  const stub = (name, text) => {
    const file = path.join(fixture.dir, `${name}.java`);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); files.push(file);
  };
  // Fail if a supposedly unused platform service is accidentally exercised.
  stub('android/content/Context', 'package android.content; public class Context { public android.content.res.Resources getResources(){throw new UnsupportedOperationException();} public String getPackageName(){throw new UnsupportedOperationException();} }');
  stub('android/content/res/Resources', 'package android.content.res; public class Resources { public java.io.InputStream openRawResource(int id){throw new UnsupportedOperationException();} public int getIdentifier(String a,String b,String c){throw new UnsupportedOperationException();} }');
  stub('android/net/Network', 'package android.net; public class Network { public void bindSocket(java.net.Socket s){throw new UnsupportedOperationException();} }');
  stub('android/os/Build', 'package android.os; public class Build { public static class VERSION { public static int SDK_INT=26; } public static class VERSION_CODES { public static int O=26; } }');
  for (const name of ['android/annotation/SuppressLint', 'androidx/annotation/NonNull', 'androidx/annotation/RawRes']) {
    const i = name.lastIndexOf('/'); stub(name, `package ${name.slice(0,i).replaceAll('/','.')}; public @interface ${name.slice(i+1)} { String[] value() default {}; }`);
  }
  stub('com/facebook/react/bridge/ReadableArray', 'package com.facebook.react.bridge; public interface ReadableArray { int size(); String getString(int i); }');
  stub('com/facebook/react/bridge/ReadableMap', 'package com.facebook.react.bridge; public interface ReadableMap { boolean hasKey(String k); String getString(String k); boolean getBoolean(String k); int getInt(String k); ReadableArray getArray(String k); }');
  stub('com/facebook/react/bridge/WritableMap', 'package com.facebook.react.bridge; public interface WritableMap extends ReadableMap { void putString(String k,String v); void putBoolean(String k,boolean v); void putInt(String k,int v); void putMap(String k,ReadableMap v); }');
  stub('com/facebook/react/bridge/Arguments', 'package com.facebook.react.bridge; public class Arguments { public static WritableMap createMap(){throw new UnsupportedOperationException();} }');
  stub('com/asterinet/react/tcpsocket/TcpEventListener', 'package com.asterinet.react.tcpsocket; public class TcpEventListener { public void onError(int i,Exception e){} public void onWritten(int i,int j,Exception e){} public void onClose(int i,Exception e){} public void onData(int i,byte[] b){} public void onEnd(int i){} }');
  stub('org/bouncycastle/util/io/pem/PemObject', 'package org.bouncycastle.util.io.pem; public class PemObject { public byte[] getContent(){throw new UnsupportedOperationException();} }');
  stub('org/bouncycastle/util/io/pem/PemReader', 'package org.bouncycastle.util.io.pem; public class PemReader implements AutoCloseable { public PemReader(java.io.Reader r){} public PemObject readPemObject(){throw new UnsupportedOperationException();} public void close(){} }');
  stub('org/json/JSONObject', 'package org.json; public class JSONObject {}');
  files.push(path.join(__dirname, 'NativeTlsProbe.java'));
  for (const name of ['TcpSocketClient', 'SSLCertificateHelper', 'TcpSocket', 'ResolvableOption', 'KeystoreInfo']) files.push(path.join(source, `${name}.java`));
  if (fs.existsSync(path.join(source, 'KeeperTrustPolicy.java'))) files.push(path.join(source, 'KeeperTrustPolicy.java'));
  execFileSync(process.env.JAVAC || 'javac', ['-d', build, ...files], { stdio: 'pipe' });
  async function execute(args, expected, message) {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.env.JAVA || 'java', ['-cp', build, 'com.asterinet.react.tcpsocket.NativeTlsProbe', ...args]); let output = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('native TLS probe timed out')); }, 10000);
      child.stdout.on('data', (b) => output += b); child.stderr.on('data', (b) => output += b);
      child.on('error', reject); child.on('close', (code) => { clearTimeout(timer); resolve({code,output}); });
    });
    assert.equal(result.code, expected ? 0 : 2, `${message}: ${result.output}`);
  }
  async function probe(identity, ca, mode, expected) {
    const service = await server(fixture, identity);
    try {
      const args = [path.join(fixture.dir, 'root.pem'), String(service.port),
        ca ? path.join(fixture.dir, ca) : 'none', mode];
      await execute(args, expected, `${identity}/${ca || 'system'}/${mode}`);
    } finally { await service.close(); }
  }
  const legacy = process.env.LEGACY_TLS_REPRO === '1';
  for (const name of ['valid', 'selfsigned', 'expired', 'wronghost', 'forged', 'custom-leaf']) {
    await t.test(`${name}: ${legacy ? 'old caller accepts' : 'verified native result'}`, async () => {
      await probe(name, null, legacy ? 'legacy' : 'secure', legacy || name === 'valid');
    });
  }
  if (legacy) {
    await t.test('old native chain verification alone accepts wrong host', () => probe('wronghost', null, 'secure', true));
  } else {
    for (const [identity, ca, accepted] of [
      ['custom-leaf', 'custom.pem', true], ['selfsigned', 'selfsigned.pem', true],
      ['expired-selfsigned', 'expired-selfsigned.pem', false], ['valid', 'expired-root.pem', false],
      ['wronghost', 'root.pem', false], ['expired', 'expired.pem', false],
      ['forged', 'root.pem', false], ['valid', 'custom.pem', false],
    ]) await t.test(`explicit ${identity}/${ca}`, () => probe(identity, ca, 'secure', accepted));
    await t.test('startTLS validates the original hostname', async () => {
      await probe('valid', null, 'upgrade', true); await probe('wronghost', null, 'upgrade', false);
    });
    const withdrawnRoots = process.env.WITHDRAWN_ROOTS || path.join(__dirname,'public-trust/roots');
    {
      const names = fs.readdirSync(withdrawnRoots).filter((n) => n.endsWith('.pem'));
      assert.equal(names.length,3,'All withdrawn incident roots must be tested');
      for (const name of names) {
        const cert = path.join(withdrawnRoots, name);
        await t.test(`withdrawn root ${name} rejected and filtered from system trust`, async () => {
          await execute([path.join(fixture.dir,'root.pem'),'0',cert,'policy'],false,name);
          await execute([path.join(fixture.dir,'root.pem'),'0',cert,'filter'],true,name);
          await execute([path.join(fixture.dir,'root.pem'),'0',cert,'explicit'],false,name);
        });
      }
    }
    const compromisedKeys = process.env.COMPROMISED_SPKI || path.join(__dirname,'public-trust/spki');
    {
      for (const {name,cert} of publicKeyCertificates(fixture,compromisedKeys)) {
        await t.test(`compromised public key ${name} rejected without using its private key`, () =>
          execute([path.join(fixture.dir,'root.pem'),'0',cert,'policy'],false,name));
      }
    }
  }
});
