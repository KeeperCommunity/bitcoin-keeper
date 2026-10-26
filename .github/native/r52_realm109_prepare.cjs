'use strict';
// Source-only preparation. This module never opens Realm or claims native evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '../..');
const HISTORICAL = '2b6c3ce56857b5dc92f17cc37453ff308d5a3ae8';
const MANIFEST = 'tests/recovery/fixtures/realm109-node-source.json';
const MANIFEST_SHA = 'bc46b37001c423f96e8aff5ed3e8b63a3ac261224e5647a1dab13179eb54d4d2';
const DESTINATION = '.github/native/.generated/r52_realm109';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
function git(root, ...args) {
  return execFileSync('git', ['--no-replace-objects', ...args], { cwd: root, maxBuffer: 2 * 1024 * 1024,
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
      GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
}
function closure(root = ROOT) {
  const raw = fs.readFileSync(path.join(root, MANIFEST));
  if (digest(raw) !== MANIFEST_SHA) fail('REALM109_MANIFEST_IDENTITY');
  const manifest = JSON.parse(raw);
  if (manifest.commit !== HISTORICAL || manifest.realm_schema_version !== 109
      || manifest.realm_package !== '12.15.0' || manifest.files.length !== 17) fail('REALM109_MANIFEST');
  const files = new Map();
  for (const row of manifest.files) {
    const bytes = git(root, 'show', HISTORICAL + ':' + row.path);
    const blob = crypto.createHash('sha1').update(Buffer.concat([
      Buffer.from('blob ' + bytes.length + '\0'), bytes])).digest('hex');
    if (digest(bytes) !== row.sha256 || blob !== row.git_blob) fail('REALM109_HISTORICAL_BYTES');
    files.set(row.path, bytes.toString('utf8'));
  }
  const source = ts.createSourceFile('realm.ts', files.get('src/storage/realm/realm.ts'), ts.ScriptTarget.Latest, true);
  const database = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'RealmDatabase');
  if (database?.members.find(node => node.name?.getText(source) === 'schemaVersion')?.initializer?.getText(source) !== '109')
    fail('REALM109_HISTORICAL_VERSION');
  const packageJSON = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  if (packageJSON.dependencies.realm !== manifest.realm_package) fail('REALM109_PACKAGE_VERSION');
  return { manifest, files };
}
function compile(files) {
  const modules = new Map();
  for (const [name, source] of files) {
    if (name === 'src/storage/realm/realm.ts') continue; // provenance only; current initializer is used unchanged
    const code = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const ast = ts.createSourceFile(name + '.js', code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
    const transformed = ts.transform(ast, [context => {
      function visit(node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) fail('REALM109_DYNAMIC_IMPORT');
          const request = node.arguments[0].text;
          if (request === 'realm') return node;
          const base = request.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(name), request)) : request;
          const target = [base, base + '.ts', base + '/index.ts'].find(item => files.has(item));
          if (!target || target === 'src/storage/realm/realm.ts') fail('REALM109_IMPORT_OUTSIDE_CLOSURE');
          let relative = path.posix.relative(path.posix.dirname(name), target).replace(/\.ts$/, '.js');
          if (!relative.startsWith('.')) relative = './' + relative;
          return context.factory.updateCallExpression(node, node.expression, undefined, [context.factory.createStringLiteral(relative)]);
        }
        return ts.visitEachChild(node, visit, context);
      }
      return node => ts.visitNode(node, visit);
    }]);
    modules.set(name.replace(/\.ts$/, '.js'), ts.createPrinter().printFile(transformed.transformed[0]));
    transformed.dispose();
  }
  return modules;
}
function publicCA() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-realm109-ca-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'key.pem',
      '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Keeper disposable Realm109 persistence fixture',
      '-addext', 'basicConstraints=critical,CA:TRUE'], { cwd: directory, stdio: 'pipe' });
    return new crypto.X509Certificate(fs.readFileSync(path.join(directory, 'ca.pem'))).toString();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function prepare(root, platform) {
  if (!['IOS', 'ANDROID'].includes(platform)) fail('REALM109_PLATFORM');
  const { manifest, files } = closure(root), modules = compile(files);
  const source = git(root, 'rev-parse', 'HEAD').toString().trim();
  // Only fixed generated children may be created, never a caller-selected output.
  const parent = path.join(root, '.github/native/.generated');
  for (const segment of ['.github', '.github/native', '.github/native/.generated']) {
    const entry = path.join(root, segment);
    if (fs.existsSync(entry) && (fs.lstatSync(entry).isSymbolicLink() || !fs.lstatSync(entry).isDirectory())) fail('REALM109_OUTPUT_PARENT');
  }
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const destination = path.join(root, DESTINATION);
  fs.mkdirSync(destination, { mode: 0o700 }); // exclusive ownership; stale output is a failure
  try {
    for (const [name, bytes] of modules) {
      const file = path.join(destination, name);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    }
    const config = { schema: 1, scope: 'ACTUAL_NATIVE_SYNTHETIC_REALM109_TO_110', source_sha: source,
      platform, nonce: crypto.randomBytes(24).toString('hex'), historical_commit: HISTORICAL,
      manifest_sha256: MANIFEST_SHA, realm_package: manifest.realm_package, schema_count: 50,
      public_ca: publicCA(), generated: [...modules].map(([name, bytes]) => ({ name, sha256: digest(bytes) })) };
    const raw = JSON.stringify(config) + '\n';
    fs.writeFileSync(path.join(destination, 'config.json'), raw, { flag: 'wx', mode: 0o600 });
    return { config_sha256: digest(raw), generated_modules: modules.size, historical_files: files.size };
  } catch (error) { fs.rmSync(destination, { recursive: true, force: true }); throw error; }
}
module.exports = { closure, compile, prepare, HISTORICAL, MANIFEST_SHA, DESTINATION };
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(prepare(ROOT, process.argv[2])) + '\n'); }
  catch { process.stderr.write('REALM109_PREPARATION_FAILED\n'); process.exitCode = 1; }
}
