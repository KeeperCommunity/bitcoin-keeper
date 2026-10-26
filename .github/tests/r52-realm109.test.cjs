'use strict';
// Host preparation/core regression only; these are not iOS/Android observations.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const generator = require('../native/r52_realm109_prepare.cjs');
const root = path.resolve(__dirname, '../..');
const temporary = [];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
function checkout() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-realm109-contract-')); temporary.push(directory);
  git(directory, 'init', '-q');
  fs.writeFileSync(path.join(directory, '.git/objects/info/alternates'), git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'objects') + '\n');
  git(directory, 'update-ref', 'refs/heads/fixture', git(root, 'rev-parse', 'HEAD'));
  git(directory, 'symbolic-ref', 'HEAD', 'refs/heads/fixture');
  for (const name of ['tests/recovery/fixtures/realm109-node-source.json', 'package.json']) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    fs.copyFileSync(path.join(root, name), path.join(directory, name));
  }
  return directory;
}
function generated() {
  const directory = checkout(), receipt = generator.prepare(directory, 'IOS');
  const base = path.join(directory, generator.DESTINATION);
  return { directory, receipt, base, config: JSON.parse(fs.readFileSync(path.join(base, 'config.json'))),
    oldSchema: require(path.join(base, 'src/storage/realm/schema/index.js')).default };
}
after(() => { temporary.forEach(directory => fs.rmSync(directory, { recursive: true, force: true })); });

test('all17 actual historical bytes compile to isolated16 modules and unchanged50 schemas', () => {
  const value = generated();
  assert.equal(value.receipt.historical_files, 17); assert.equal(value.receipt.generated_modules, 16);
  assert.equal(value.oldSchema.length, 50);
  for (const name of ['NodeConnect', 'DefaultNodeConnect'])
    assert.equal(Object.hasOwn(value.oldSchema.find(row => row.name === name).properties, 'tlsCa'), false);
  for (const row of value.config.generated) {
    const raw = fs.readFileSync(path.join(value.base, row.name), 'utf8');
    assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), row.sha256);
    assert.doesNotMatch(raw, /require\(["']src\//);
  }
  assert.equal(new crypto.X509Certificate(value.config.public_ca).ca, true);
  assert.doesNotMatch(JSON.stringify(value.config), /PRIVATE KEY/);
});
test('modified historical manifest cannot redefine the109 source authority', () => {
  const directory = checkout(), file = path.join(directory, 'tests/recovery/fixtures/realm109-node-source.json');
  const value = JSON.parse(fs.readFileSync(file)); value.commit = 'a'.repeat(40); fs.writeFileSync(file, JSON.stringify(value));
  assert.throws(() => generator.prepare(directory, 'IOS'), /MANIFEST_IDENTITY/);
});
test('historical imports cannot resolve into current application code', () => {
  const { files } = generator.closure(root);
  files.set('src/storage/realm/schema/nodeConnect.ts', 'export { default } from "src/current/schema";');
  assert.throws(() => generator.compile(files), /OUTSIDE_CLOSURE/);
});
test('stale output and symlinked output parents are rejected without overwriting', () => {
  const value = generated();
  assert.throws(() => generator.prepare(value.directory, 'IOS'), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(value.base, 'config.json'), 'utf8').includes(value.config.nonce), true);
  const directory = checkout(); fs.symlinkSync(value.directory, path.join(directory, '.github'));
  assert.throws(() => generator.prepare(directory, 'ANDROID'), /OUTPUT_PARENT/);
});
test('unsupported platform and a different installed Realm contract are rejected', () => {
  const directory = checkout(); assert.throws(() => generator.prepare(directory, 'HOST'), /PLATFORM/);
  const file = path.join(directory, 'package.json'), pkg = JSON.parse(fs.readFileSync(file));
  pkg.dependencies.realm = '13.0.0'; fs.writeFileSync(file, JSON.stringify(pkg));
  assert.throws(() => generator.prepare(directory, 'IOS'), /PACKAGE_VERSION/);
});
test('actual preparation CLI exits with its exact bounded receipt and no retained private key', () => {
  const directory = checkout(), script = path.join(directory, '.github/native/r52_realm109_prepare.cjs');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.copyFileSync(path.join(root, '.github/native/r52_realm109_prepare.cjs'), script);
  const output = execFileSync(process.execPath, [script, 'ANDROID'], { cwd: directory, timeout: 15000,
    env: { ...process.env, NODE_PATH: [path.dirname(path.dirname(require.resolve('typescript/package.json'))),
      process.env.NODE_PATH].filter(Boolean).join(path.delimiter) },
    stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const receipt = JSON.parse(output), base = path.join(directory, generator.DESTINATION);
  assert.deepEqual(Object.keys(receipt).sort(), ['config_sha256', 'generated_modules', 'historical_files']);
  const raw = fs.readFileSync(path.join(base, 'config.json'));
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), receipt.config_sha256);
  assert.equal(JSON.parse(raw).platform, 'ANDROID');
  const walk = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
  const files = walk(base); assert.equal(files.length, 17);
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /PRIVATE KEY/);
});
