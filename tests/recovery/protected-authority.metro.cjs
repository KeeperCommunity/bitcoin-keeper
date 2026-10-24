// Focused real Metro Android graph / JS execution / Hermes compilation proof.
// Full App/native startup is NOT exercised. Only actual shim native boundaries
// are trapped; authority, encoder, Buffer and every new crypto module are real.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const Metro = require('metro');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const output = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-authority-metro-'));
fs.mkdirSync(output, { recursive: true });
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const namespace = 'bk3_7SolLs5PrxK2ybpJGsah8spJqewmCskdDW_L9gnI2FY';
const source = (name) => fs.readFileSync(path.join(root, name), 'utf8');

async function main() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  assert.ok(major === 22 && (minor > 23 || (minor === 23 && patch >= 3)), 'Run the proof with Node22.23.3 or a later22.x patch');
  const index = source('index.js');
  const tree = ts.createSourceFile('index.js', index, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = tree.statements.filter(ts.isImportDeclaration).map((node) => node.moduleSpecifier.text);
  assert.ok(imports.indexOf('./shim') < imports.indexOf('./src/services/backup/encoding'));
  assert.ok(imports.indexOf('./src/services/backup/encoding') < imports.indexOf('./App'));
  assert.ok(imports.indexOf('react-native-get-random-values') < imports.indexOf('./App'));
  assert.ok(source('src/services/backup/authority.ts').startsWith("import './encoding';"));
  const entry = path.join(output, 'entry.js');
  fs.writeFileSync(entry, `
    import ${JSON.stringify(path.join(root, 'shim.js'))};
    import ${JSON.stringify(path.join(root, 'src/services/backup/encoding.ts'))};
    import { deriveBackupAuthority } from ${JSON.stringify(path.join(root, 'src/services/backup/authority.ts'))};
    if (typeof TextEncoder !== 'function' || typeof TextDecoder !== 'undefined') throw new Error('ENCODER_SCOPE');
    const input = ['ASCII', 'A€😀', '\\ud800', '\\udc00', 'a\\ud800b', 'é', 'e\\u0301'];
    const encoder = new TextEncoder();
    const encoded = input.map(value => Array.from(encoder.encode(value)));
    const encodeInto = [0,1,2,3,4,5,6,7,8].map(size => {
      const target = new Uint8Array(size);
      const progress = encoder.encodeInto('A€😀', target);
      return {size, progress, output:Array.from(target)};
    });
    const authority = deriveBackupAuthority(${JSON.stringify(mnemonic)});
    try {
      if (authority.namespaceId !== ${JSON.stringify(namespace)}) throw new Error('NAMESPACE_VECTOR');
      const raw = Buffer.from(JSON.stringify({namespaceId:authority.namespaceId,publicJwk:authority.publicJwk}));
      const token = authority.signRawBody(raw,'/backup/v3/snapshot','https://keeper-fixture.invalid',2000000000);
      globalThis.__keeperAuthorityProof = {namespaceId:authority.namespaceId,publicJwk:authority.publicJwk,
        token,raw:Array.from(raw),input,encoded,encodeInto,decoderInstalled:typeof TextDecoder!=='undefined'};
    } finally { authority.dispose(); }
  `);
  const traps = new Map();
  for (const name of ['net', 'tls', 'crypto']) {
    const filename = path.join(output, `native-${name}-trap.js`);
    fs.writeFileSync(filename, `
      (globalThis.__keeperLegacyTraps || (globalThis.__keeperLegacyTraps=[])).push(${JSON.stringify(name)});
      const forbidden = () => { throw new Error('LEGACY_NATIVE_BOUNDARY_FORBIDDEN'); };
      module.exports = Object.freeze({connect:forbidden,randomBytes:forbidden,createHash:forbidden});
    `);
    traps.set(name, filename);
  }
  const modules = new Set();
  const config = await Metro.loadConfig({ cwd: root, config: path.join(root, 'metro.config.js') });
  const priorResolver = config.resolver.resolveRequest;
  const priorFilter = config.serializer.processModuleFilter;
  const build = {
    ...config, maxWorkers: 1, watchFolders: [...config.watchFolders, output],
    reporter: { update() {} },
    resolver: { ...config.resolver, resolveRequest(context, name, platform) {
      if (context.originModulePath === path.join(root, 'shim.js')) {
        const trap = name === './src/services/electrum/net' ? 'net'
          : name === './src/services/electrum/tls' ? 'tls' : name === 'crypto' ? 'crypto' : null;
        if (trap) return { type: 'sourceFile', filePath: traps.get(trap) };
      }
      return priorResolver ? priorResolver(context, name, platform) : context.resolveRequest(context, name, platform);
    } },
    serializer: { ...config.serializer,
      // Native InitializeCore needs a running RN bridge. Its exclusion is a
      // disclosed boundary; all ordinary Metro JS polyfills remain configured.
      getModulesRunBeforeMainModule: () => [],
      processModuleFilter(module) { modules.add(module.path); return priorFilter ? priorFilter(module) : true; },
    },
  };
  const bundlePath = path.join(output, 'authority.android.bundle');
  const built = await Metro.runBuild(build, { entry, platform: 'android', dev: true, minify: false });
  fs.writeFileSync(bundlePath, built.code, { mode: 0o600 });
  const bundle = fs.readFileSync(bundlePath, 'utf8');
  const scope = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval };
  scope.global = scope;
  vm.createContext(scope);
  assert.equal(vm.runInContext('typeof TextEncoder', scope), 'undefined');
  assert.equal(vm.runInContext('typeof TextDecoder', scope), 'undefined');
  vm.runInContext(bundle, scope, { filename: bundlePath, timeout: 15000 });
  const proof = JSON.parse(JSON.stringify(scope.__keeperAuthorityProof));
  assert.equal(proof.namespaceId, namespace);
  assert.equal(proof.decoderInstalled, false);
  assert.deepEqual(Array.from(scope.__keeperLegacyTraps), ['net', 'tls', 'crypto']);
  for (let i = 0; i < proof.input.length; i++) {
    assert.deepEqual(proof.encoded[i], Array.from(new TextEncoder().encode(proof.input[i])));
  }
  for (const entry of proof.encodeInto) {
    const target = new Uint8Array(entry.size);
    const progress = new TextEncoder().encodeInto('A€😀', target);
    assert.deepEqual(entry.progress, progress); assert.deepEqual(entry.output, Array.from(target));
  }
  const parts = proof.token.split('.');
  const key = crypto.createPublicKey({ key: proof.publicJwk, format: 'jwk' });
  assert.equal(crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`),
    { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(parts[2], 'base64url')), true);
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
  assert.equal(claims.bodySha256, sha(Buffer.from(proof.raw)));
  assert.ok([...modules].some((name) => name.endsWith('/@exodus/bytes/utf8.js')));
  assert.ok(![...modules].some((name) => /\/@exodus\/bytes\/.*\.node\.js$/.test(name)));
  const compilerDirectory = { linux: 'linux64-bin', darwin: 'osx-bin' }[process.platform];
  assert.ok(compilerDirectory, 'This focused proof supports the repository Linux and macOS Hermes compilers');
  const compiler = path.join(root, 'node_modules/hermes-compiler/hermesc', compilerDirectory, 'hermesc');
  const hbc = path.join(output, 'authority.android.hbc');
  const compiled = spawnSync(compiler, ['-emit-binary', '-O', '-out', hbc, bundlePath],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(compiled.status, 0, compiled.stderr);
  const receipt = { state: 'FOCUSED_METRO_VM_AND_HERMESC_COMPILE_PASS_NOT_NATIVE_ACCEPTANCE',
    node: process.versions.node, platform: 'android', metroVersion: require('metro/package.json').version,
    appIndexImportOrder: imports, nativeInitializeCore: 'NOT_RUN', nativeShimEdges: ['net', 'tls', 'crypto'],
    textGlobalsInitiallyAbsent: true, decoderInstalled: false, fullDerivationNamespace: namespace,
    nativeOpenSSLVerification: true, whatwgEncodeIntoBoundaryCases: proof.encodeInto.length,
    hermesCompilation: 'PASS', hermesRuntimeExecution: 'NOT_RUN_COMPILER_ONLY',
    IOS: 'NOT_RUN', ANDROID_NATIVE: 'NOT_RUN', HARDWARE: 'NOT_RUN',
    sourceHashes: Object.fromEntries(['index.js', 'shim.js', 'src/services/backup/encoding.ts',
      'src/services/backup/authority.ts', 'metro.config.js', 'babel.config.js'].map((name) => [name, sha(source(name))])),
    bundle: { bytes: Buffer.byteLength(bundle), sha256: sha(bundle) },
    hbc: { bytes: fs.statSync(hbc).size, sha256: sha(fs.readFileSync(hbc)) },
    modules: [...modules].sort(),
  };
  fs.writeFileSync(path.join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ state: receipt.state, output, bundleBytes: receipt.bundle.bytes,
    hermesCompilation: 'PASS', hermesRuntimeExecution: receipt.hermesRuntimeExecution, modules: modules.size }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
