'use strict';
// Actual disposable Git controls, no network/native/provider operations.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const child = require('node:child_process');
const sourceRoot = path.resolve(__dirname, '../..');
const guardBytes = fs.readFileSync(path.join(sourceRoot, '.github/scripts/verify-ci-source.cjs'));
const workflowNames = ['keeper-canonical-native.yml', 'keeper-canonical-native-platform.yml'];
// Decode YAML scalars before examining JavaScript: the caller uses block scalars,
// while both reusable worker jobs currently serialize their scripts as quoted YAML.
const workflows = JSON.parse(child.execFileSync('python3', ['-c',
  'import json,sys,yaml; print(json.dumps({name: yaml.safe_load(text) for name,text in json.load(sys.stdin).items()}))'], {
  input: JSON.stringify(Object.fromEntries(workflowNames.map(name => [name,
    fs.readFileSync(path.join(sourceRoot, '.github/workflows', name), 'utf8')]))),
  encoding: 'utf8', timeout: 10000, maxBuffer: 512 * 1024,
  env: { PATH: process.env.PATH, PYTHONPYCACHEPREFIX: '/dev/null', PYTHONDONTWRITEBYTECODE: '1' },
}));
const expectedLocations = ['keeper-canonical-native.yml:provenance', 'keeper-canonical-native.yml:attestation',
  'keeper-canonical-native-platform.yml:android-build', 'keeper-canonical-native-platform.yml:native'].sort();
function bootstraps(documents = workflows) {
  const found = [];
  const start = '// Remove read credentials before raw-source Git/Python subprocesses.';
  const end = '// End pinned source bootstrap.';
  for (const name of workflowNames) {
    for (const [job, value] of Object.entries(documents[name].jobs)) {
      for (const step of value.steps || []) {
        const script = step.with?.script;
        if (typeof script !== 'string' || (!script.includes(start) && !script.includes(end))) continue;
        const lines = script.split('\n');
        const starts = lines.flatMap((line, index) => line.trim() === start ? [index] : []);
        const ends = lines.flatMap((line, index) => line.trim() === end ? [index] : []);
        assert.equal(starts.length, 1, `${name}:${job} bootstrap start`);
        assert.equal(ends.length, 1, `${name}:${job} bootstrap end`);
        assert(starts[0] < ends[0], `${name}:${job} bootstrap order`);
        const indent = lines[starts[0]].match(/^\s*/)[0];
        const snippet = lines.slice(starts[0], ends[0] + 1).map(line => {
          assert(line.startsWith(indent), `${name}:${job} bootstrap indentation`);
          return line.slice(indent.length);
        }).join('\n');
        found.push({ location: `${name}:${job}`, snippet });
      }
    }
  }
  return found;
}
function checkedBootstraps(documents = workflows) {
  const found = bootstraps(documents);
  assert.deepEqual(found.map(row => row.location).sort(), expectedLocations, 'Canonical bootstrap location coverage changed');
  assert.equal(new Set(found.map(row => row.snippet)).size, 1, 'Canonical bootstrap bodies differ');
  for (const { snippet } of found) {
    assert.match(snippet, /2c36d299851261d68965d37dbda024b950d46d8d/);
    assert.match(snippet, /verifyRawCheckout\(root, context.sha\)/);
  }
  return found.map(row => row.snippet);
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
function run(f, snippet = checkedBootstraps()[0]) {
  const cwd = process.cwd(); process.chdir(f.root);
  try { new Function('require', 'context', snippet)(require, { sha: f.sha }); }
  finally { process.chdir(cwd); }
}
test('all four actual caller and producer/runtime pre-import bootstraps are identical and hard-pin reviewed guard bytes', () => {
  assert.equal(checkedBootstraps().length, 4);
});
test('semantic workflow discovery rejects a missing producer bootstrap', () => {
  const changed = structuredClone(workflows);
  const producer = changed['keeper-canonical-native-platform.yml'].jobs['android-build'];
  producer.steps = producer.steps.filter(step => step.name !== 'Verify canonical installed source');
  assert.throws(() => checkedBootstraps(changed), /bootstrap location coverage changed/);
});
test('semantic workflow discovery rejects a changed producer guard pin', () => {
  const changed = structuredClone(workflows);
  const producer = changed['keeper-canonical-native-platform.yml'].jobs['android-build'];
  const step = producer.steps.find(step => step.name === 'Verify canonical installed source');
  step.with.script = step.with.script.replace('2c36d299851261d68965d37dbda024b950d46d8d', '0'.repeat(40));
  assert.throws(() => checkedBootstraps(changed), /bootstrap bodies differ/);
});
test('actual bootstrap loads captured pinned bytes, verifies full Git tree and strips both read credentials before Git', () => {
  const f = fixture(), original = child.execFileSync, saved = {};
  for (const name of ['KEEPER_CANONICAL_PIN_READ_TOKEN', 'KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN',
    'KEEPER_RELAY_READER_APP_ID', 'KEEPER_RELAY_READER_INSTALLATION_ID', 'KEEPER_RELAY_READER_PRIVATE_KEY']) {
    saved[name] = process.env[name]; process.env[name] = 'DISPOSABLE_HOST_CONTROL_ONLY';
  }
  let calls = 0;
  child.execFileSync = (...args) => {
    assert.equal(process.env.KEEPER_CANONICAL_PIN_READ_TOKEN, undefined);
    assert.equal(process.env.KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN, undefined);
    for (const name of ['KEEPER_RELAY_READER_APP_ID', 'KEEPER_RELAY_READER_INSTALLATION_ID', 'KEEPER_RELAY_READER_PRIVATE_KEY'])
      assert.equal(process.env[name], undefined, name);
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
