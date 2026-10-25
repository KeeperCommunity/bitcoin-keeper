'use strict';
// Actual disposable Git controls, no network/native/provider operations.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const child = require('node:child_process');
const sourceRoot = path.resolve(__dirname, '../..');
const guardBytes = fs.readFileSync(path.join(sourceRoot, '.github/scripts/verify-ci-source.cjs'));
function bootstraps() {
  const found = [];
  for (const name of ['keeper-canonical-native.yml', 'keeper-canonical-native-platform.yml']) {
    const text = fs.readFileSync(path.join(sourceRoot, '.github/workflows', name), 'utf8');
    for (const match of text.matchAll(/              \/\/ Remove read credentials[\s\S]+?              \/\/ End pinned source bootstrap\./g))
      found.push(match[0].split('\n').map(line => line.slice(14)).join('\n'));
  }
  return found;
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-parent-bootstrap-'));
  fs.mkdirSync(path.join(root, '.github/scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github/scripts/verify-ci-source.cjs'), guardBytes);
  fs.writeFileSync(path.join(root, 'canary.txt'), 'committed original bytes\n');
  const git = (...args) => child.execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.email', 'host-controls@example.invalid'); git('config', 'user.name', 'Host controls');
  git('add', '.'); git('commit', '-qm', 'Synthetic raw source fixture');
  return { root, git, sha: git('rev-parse', 'HEAD'), guard: path.join(root, '.github/scripts/verify-ci-source.cjs') };
}
function run(f, snippet = bootstraps()[0]) {
  const cwd = process.cwd(); process.chdir(f.root);
  try { new Function('require', 'context', snippet)(require, { sha: f.sha }); }
  finally { process.chdir(cwd); }
}
test('all three actual canonical pre-import bootstraps are identical and hard-pin reviewed guard bytes', () => {
  const snippets = bootstraps(); assert.equal(snippets.length, 3);
  assert.equal(new Set(snippets).size, 1);
  assert.match(snippets[0], /2c36d299851261d68965d37dbda024b950d46d8d/);
  assert.match(snippets[0], /verifyRawCheckout\(root, context.sha\)/);
});
test('actual bootstrap loads captured pinned bytes, verifies full Git tree and strips both read credentials before Git', () => {
  const f = fixture(), original = child.execFileSync, saved = {};
  for (const name of ['KEEPER_CANONICAL_PIN_READ_TOKEN', 'KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN']) {
    saved[name] = process.env[name]; process.env[name] = 'DISPOSABLE_HOST_CONTROL_ONLY';
  }
  let calls = 0;
  child.execFileSync = (...args) => {
    assert.equal(process.env.KEEPER_CANONICAL_PIN_READ_TOKEN, undefined);
    assert.equal(process.env.KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN, undefined);
    calls++; return original(...args);
  };
  try { run(f); assert.ok(calls > 0); }
  finally {
    child.execFileSync = original;
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
for (const [name, mutate] of Object.entries({
  hiddenRuntimeBytes: f => { f.git('update-index', '--skip-worktree', 'canary.txt'); fs.writeFileSync(path.join(f.root, 'canary.txt'), 'forged\n'); },
  hiddenGuardBytes: f => { f.git('update-index', '--assume-unchanged', '.github/scripts/verify-ci-source.cjs'); fs.appendFileSync(f.guard, '\n'); },
  executableGuard: f => fs.chmodSync(f.guard, 0o755),
  guardDirectory: f => { fs.unlinkSync(f.guard); fs.mkdirSync(f.guard); },
  guardSymlink: f => { fs.renameSync(f.guard, f.guard + '.saved'); fs.symlinkSync(f.guard + '.saved', f.guard); },
  guardHardlink: f => fs.linkSync(f.guard, f.guard + '.alias'),
  parentSymlink: f => { const parent = path.dirname(f.guard); fs.renameSync(parent, parent + '.saved'); fs.symlinkSync(parent + '.saved', parent); },
  replacedHead: f => f.git('commit', '--allow-empty', '-qm', 'Different exact commit, identical tree'),
})) test(`canonical bootstrap rejects actual Git/filesystem ${name}`, () => {
  const f = fixture();
  try { mutate(f); assert.throws(() => run(f)); }
  finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
test('group/other executable bits do not substitute for Git owner0100', () => {
  const f = fixture();
  try { fs.chmodSync(f.guard, 0o655); run(f); }
  finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
