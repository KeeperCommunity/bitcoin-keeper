const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { supportedNode } = require('../../scripts/verify-node-runtime.cjs');

const app = path.resolve(__dirname, '../..');
const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
const withEnvironment = process.env.RN_WITH_ENVIRONMENT ||
  path.join(app, 'node_modules/react-native/scripts/xcode/with-environment.sh');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-ios node-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, body, mode = 0o600) => {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, body, { mode });
    return filename;
  };
  const copy = (relative, mode) => write(relative, fs.readFileSync(path.join(app, relative)), mode);
  copy('scripts/verify-node-runtime.cjs');
  copy('ios/ci_scripts/ci_post_clone.sh');
  copy('ios/scripts/bundle-react-native.sh', 0o700);
  write('log.cjs', `
    const fs = require('node:fs');
    const [tool, ...args] = process.argv.slice(2);
    fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({tool, args, cwd:process.cwd(),
      node:process.versions.node, selected:process.env.NODE_BINARY,
      gemfile:process.env.BUNDLE_GEMFILE, frozen:process.env.BUNDLE_FROZEN})+'\\n');
    if (tool === 'yarn' && args[0] === '--version') console.log(process.env.FIXTURE_YARN || '1.22.22');
    if (tool === process.env.FIXTURE_FAIL) process.exit(7);
  `);
  const tool = (relative, name) => write(relative,
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(root, 'log.cjs'))} ${quote(name)} "$@"\n`, 0o700);
  for (const name of ['yarn', 'bundle', 'git']) tool(`bin/${name}`, name);
  tool('node_modules/.bin/patch-package', 'patch-package');
  tool('node_modules/react-native/scripts/react-native-xcode.sh', 'bundle-phase');
  // The real post-clone hook prepends its selected Node directory to PATH.
  // Give it an owned executable so a runner-installed Yarn cannot shadow the
  // fixture tools. A byte-for-byte copy retains the real runtime attestation.
  const nodeBinary = path.join(root, 'selected-node/node');
  fs.mkdirSync(path.dirname(nodeBinary));
  fs.copyFileSync(process.execPath, nodeBinary, fs.constants.COPYFILE_FICLONE);
  fs.chmodSync(nodeBinary, 0o700);
  fs.mkdirSync(path.join(root, 'ios/Pods'), { recursive: true });
  const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`,
    NODE_BINARY: nodeBinary, FIXTURE_LOG: path.join(root, 'calls.jsonl'),
    PODS_ROOT: path.join(root, 'ios/Pods'), SRCROOT: path.join(root, 'ios') };
  const calls = () => fs.existsSync(env.FIXTURE_LOG)
    ? fs.readFileSync(env.FIXTURE_LOG, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const run = (script, overrides = {}) => spawnSync('/bin/sh', [path.join(root, script)],
    { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' });
  const prepareXcode = () => {
    const body = fs.readFileSync(withEnvironment);
    assert.equal(crypto.createHash('sha256').update(body).digest('hex'),
      '13dada2085d86d3f97de84eddcd1d85f6473298f0e97b9d31a7585e8f945aeb6',
      'Use the unchanged locked React Native 0.83.9 environment helper');
    write('node_modules/react-native/scripts/xcode/with-environment.sh', body, 0o700);
    write('ios/.xcode.env', `export NODE_BINARY=${quote(process.execPath)}\n`);
    return write('run-phase.sh', phaseScripts()[0]);
  };
  return { root, write, env, calls, run, prepareXcode, nodeBinary };
}

function phaseScripts() {
  return fs.readFileSync(path.join(app, 'ios/hexa_keeper.xcodeproj/project.pbxproj'), 'utf8')
    .split('\n').filter((line) => line.includes('shellScript = "set -e\\nWITH_ENVIRONMENT='))
    .map((line) => JSON.parse(line.match(/shellScript = (".*");/)[1]));
}

test('native builds reject vulnerable Node patches, other majors and prereleases', () => {
  for (const version of ['22.23.4', 'v22.23.4', '22.24.0']) assert.equal(supportedNode(version), true);
  for (const version of ['16.20.2', '22.23.3', '22.22.9', '22.23.4-rc.1', '24.0.0', 'invalid'])
    assert.equal(supportedNode(version), false);
});

test('CI verifies its executable, uses frozen installs and preserves patch failure gates', (t) => {
  const f = fixture(t);
  assert.ok(fs.statSync(path.join(app, 'ios/ci_scripts/ci_post_clone.sh')).mode & 0o111,
    'Xcode Cloud must be able to execute the existing post-clone hook');
  const result = f.run('ios/ci_scripts/ci_post_clone.sh');
  assert.equal(result.status, 0, result.stderr);
  const attestation = JSON.parse(result.stdout.trim());
  assert.equal(attestation.executable, f.nodeBinary);
  assert.equal(attestation.sha256, crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex'));
  const calls = f.calls();
  assert.deepEqual(calls.map(({ tool }) => tool),
    ['yarn', 'yarn', 'patch-package', 'git', 'bundle', 'bundle', 'git']);
  assert.deepEqual(calls[1].args, ['install', '--frozen-lockfile', '--non-interactive']);
  assert.deepEqual(calls[2].args, ['--error-on-fail']);
  assert.deepEqual(calls[5].args, ['exec', 'pod', 'install', '--deployment']);
  assert.equal(calls[5].cwd, path.join(f.root, 'ios'));
  assert.equal(calls[5].gemfile, path.join(f.root, 'Gemfile'));
  assert.equal(calls[5].frozen, 'true');
  assert.ok(calls.every(({ selected }) => selected === f.nodeBinary));
});

test('CI stops before dependency execution when selected runtime is unusable', (t) => {
  const f = fixture(t);
  const result = f.run('ios/ci_scripts/ci_post_clone.sh', { NODE_BINARY: '/bin/false' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.calls(), []);
});

test('CI stops on patch failure without attempting Ruby or Pods', (t) => {
  const f = fixture(t);
  const result = f.run('ios/ci_scripts/ci_post_clone.sh', { FIXTURE_FAIL: 'patch-package' });
  assert.equal(result.status, 7);
  assert.deepEqual(f.calls().map(({ tool }) => tool), ['yarn', 'yarn', 'patch-package']);
});

test('CI refuses a different Yarn line before installation', (t) => {
  const f = fixture(t);
  const result = f.run('ios/ci_scripts/ci_post_clone.sh', { FIXTURE_YARN: '4.0.0' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.calls().map(({ tool }) => tool), ['yarn']);
});

test('both app phases use locked RN resolution and retain a local executable path containing spaces', (t) => {
  const f = fixture(t);
  f.prepareXcode();
  assert.equal(phaseScripts().length, 2);
  const selected = path.join(f.root, 'Node installation/node');
  fs.mkdirSync(path.dirname(selected));
  fs.symlinkSync(process.execPath, selected);
  f.write('ios/.xcode.env.local', `export NODE_BINARY=${quote(selected)}\n`);
  for (const [index, body] of phaseScripts().entries()) {
    f.write(`phase-${index}.sh`, body);
    const result = f.run(`phase-${index}.sh`);
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(f.calls().length, 2);
  assert.ok(f.calls().every(({ tool, selected: value }) => tool === 'bundle-phase' && value === selected));
});

test('a stale local Node override fails before the actual RN bundle script', (t) => {
  const f = fixture(t);
  f.prepareXcode();
  f.write('ios/.xcode.env.local', 'export NODE_BINARY=/bin/false\n');
  const result = f.run('run-phase.sh');
  assert.notEqual(result.status, 0);
  assert.deepEqual(f.calls(), []);
});
