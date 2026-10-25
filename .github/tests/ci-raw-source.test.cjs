'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const { verifySource, verifyRawCheckout } = require('../scripts/verify-ci-source.cjs');

function fixture(t, kind = 'app') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-raw-source-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const app = path.join(base, 'app');
  fs.mkdirSync(app);
  const root = kind === 'app' ? app : path.join(app, '.ci-relay');
  fs.mkdirSync(root, { recursive: true });
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git('init', '--quiet');
  git('config', 'user.email', 'disposable-source@example.invalid');
  git('config', 'user.name', 'Disposable raw source control');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/source.js'), 'module.exports = "original";\n');
  fs.writeFileSync(path.join(root, 'src/run.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 255, 1, 13, 10]));
  fs.writeFileSync(path.join(root, 'space\ttab\nline-☃.txt'), 'unusual Git path\n');
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored-output/\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'disposable candidate');
  return { base, root, git, kind, head: git('rev-parse', 'HEAD') };
}
function check(f, root = f.root) {
  return f.kind === 'app' ? verifySource({ root, event: { pull_request: { head: { sha: f.head } } },
    env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' } }) :
    verifyRawCheckout(root, f.head);
}
function hidden(f, flag, paths = ['src/source.js']) {
  f.git('update-index', flag, '--', ...paths);
}
function cleanStatus(f) { assert.equal(f.git('status', '--porcelain', '--untracked-files=normal'), ''); }
function commit(f) { f.git('add', '.'); f.git('commit', '--quiet', '-m', 'changed disposable candidate'); f.head = f.git('rev-parse', 'HEAD'); }

for (const kind of ['app', 'paired Relay raw primitive']) {
  test(`${kind}: clean bytes include binary and NUL-delimited unusual paths`, t => {
    const f = fixture(t, kind);
    cleanStatus(f);
    assert.equal(verifyRawCheckout(f.root, f.head).files, 5);
    check(f);
    if (kind === 'app') assert.deepEqual(Object.keys(check(f)),
      ['schema', 'source_sha', 'source_tree', 'event', 'run_id', 'run_attempt', 'workflow_sha', 'scope']);
  });
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    test(`${kind}: ${flag} cannot hide a same-length tracked edit or change index flags`, t => {
      const f = fixture(t, kind); hidden(f, flag);
      const filename = path.join(f.root, 'src/source.js'), before = fs.statSync(filename);
      const bytes = fs.readFileSync(filename);
      fs.writeFileSync(filename, 'module.exports = "tampered";\n');
      assert.equal(fs.statSync(filename).size, bytes.length);
      fs.utimesSync(filename, before.atime, before.mtime);
      cleanStatus(f);
      const index = fs.readFileSync(path.join(f.root, '.git/index'));
      assert.throws(() => check(f), /Raw source differs/);
      assert.deepEqual(fs.readFileSync(path.join(f.root, '.git/index')), index);
    });
    test(`${kind}: ${flag} cannot hide a changed binary input`, t => {
      const f = fixture(t, kind); hidden(f, flag, ['binary.bin']);
      fs.writeFileSync(path.join(f.root, 'binary.bin'), Buffer.from([0, 254, 1, 13, 10]));
      cleanStatus(f);
      assert.throws(() => check(f), /Raw source differs/);
    });
    test(`${kind}: ${flag} cannot hide a deleted tracked input`, t => {
      const f = fixture(t, kind); hidden(f, flag);
      fs.unlinkSync(path.join(f.root, 'src/source.js'));
      cleanStatus(f);
      assert.throws(() => check(f), /ENOENT/);
    });
    test(`${kind}: ${flag} cannot replace a tracked file with a directory`, t => {
      const f = fixture(t, kind); hidden(f, flag);
      fs.unlinkSync(path.join(f.root, 'src/source.js'));
      fs.mkdirSync(path.join(f.root, 'src/source.js'));
      cleanStatus(f);
      assert.throws(() => check(f), /regular tracked source/);
    });
    test(`${kind}: ${flag} cannot substitute a symlink with even the exact expected bytes`, t => {
      const f = fixture(t, kind); hidden(f, flag);
      const filename = path.join(f.root, 'src/source.js'), alternate = path.join(f.base, 'same-bytes.js');
      fs.writeFileSync(alternate, fs.readFileSync(filename));
      fs.unlinkSync(filename); fs.symlinkSync(alternate, filename);
      cleanStatus(f);
      assert.throws(() => check(f), /regular tracked source|alias rejected/);
    });
    test(`${kind}: parent directory alias is rejected by raw checking with ${flag}`, t => {
      const f = fixture(t, kind); hidden(f, flag, ['src/source.js', 'src/run.sh']);
      const directory = path.join(f.root, 'src'), alternate = path.join(f.base, 'same-directory');
      fs.renameSync(directory, alternate); fs.symlinkSync(alternate, directory, 'dir');
      // Git already exposes this directory substitution as added source. Check
      // raw path admission independently rather than claiming status hid it.
      assert.equal(f.git('status', '--porcelain'), '?? src');
      assert.throws(() => verifyRawCheckout(f.root, f.head), /alias rejected/);
      if (kind === 'app') assert.throws(() => check(f), /Source changed/);
    });
  }
  for (const [relative, expectedExecutable] of [['src/source.js', false], ['src/run.sh', true]]) {
    for (const mode of [0o644, 0o645, 0o654, 0o655, 0o744, 0o745, 0o754, 0o755]) {
      test(`${kind}: ${relative} owner-only Git execute mode ${mode.toString(8)}`, t => {
        const f = fixture(t, kind);
        // Only this throwaway repository hides mode changes from status.
        f.git('config', 'core.filemode', 'false');
        fs.chmodSync(path.join(f.root, relative), mode);
        cleanStatus(f);
        if (((mode & 0o100) !== 0) === expectedExecutable) check(f);
        else assert.throws(() => check(f), /owner execute mode changed/);
      });
    }
  }
  test(`${kind}: an actual path replacement during delegated reading cannot pass`, t => {
    const f = fixture(t, kind), filename = path.join(f.root, 'src/source.js');
    const inode = fs.statSync(filename).ino, originalRead = fs.readFileSync;
    let replaced = false;
    t.mock.method(fs, 'readFileSync', function (input, ...args) {
      const bytes = originalRead.call(this, input, ...args);
      if (!replaced && typeof input === 'number' && fs.fstatSync(input).ino === inode) {
        replaced = true;
        fs.renameSync(filename, path.join(f.base, 'replaced-original'));
        fs.writeFileSync(filename, bytes);
      }
      return bytes;
    });
    assert.throws(() => check(f), /Tracked source replaced/);
    assert.equal(replaced, true);
  });
  test(`${kind}: local replacement refs cannot substitute the pinned commit's raw tree`, t => {
    const f = fixture(t, kind), original = f.head;
    fs.writeFileSync(path.join(f.root, 'src/source.js'), 'module.exports = "tampered";\n');
    commit(f);
    const replacement = f.head;
    f.git('replace', original, replacement);
    f.git('update-ref', 'HEAD', original);
    f.head = original;
    cleanStatus(f);
    assert.throws(() => check(f), /Source changed|Raw source differs/);
  });
  test(`${kind}: a checkout-root symlink cannot earn a source receipt`, t => {
    const f = fixture(t, kind), alias = path.join(f.base, 'checkout-alias');
    fs.symlinkSync(f.root, alias, 'dir');
    assert.throws(() => check(f, alias), /Checkout alias rejected/);
  });
  test(`${kind}: committed symlink entries are rejected even with clean status`, t => {
    const f = fixture(t, kind), filename = path.join(f.root, 'src/source.js');
    fs.unlinkSync(filename); fs.symlinkSync('../binary.bin', filename); commit(f); cleanStatus(f);
    assert.throws(() => check(f), /regular tracked Git blob/);
  });
  test(`${kind}: gitlink entries cannot omit a nested source tree`, t => {
    const f = fixture(t, kind);
    // A genuine initialized nested repository avoids a missing-submodule
    // deletion being caught by status before raw Git entry admission.
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', f.root, path.join(f.root, 'vendor')],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    f.git('update-index', '--add', '--cacheinfo', `160000,${f.head},vendor`);
    f.git('commit', '--quiet', '-m', 'disposable unsupported gitlink'); f.head = f.git('rev-parse', 'HEAD');
    cleanStatus(f);
    assert.throws(() => check(f), /regular tracked Git blob/);
  });
}

test('ignored generated output keeps its existing allowance and is never treated as tracked source', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'ignored-output'));
  fs.writeFileSync(path.join(f.root, 'ignored-output/result.txt'), 'generated output');
  cleanStatus(f); check(f);
});

test('a failed raw-source CLI prints no edited bytes, path, environment value or receipt', t => {
  const f = fixture(t); hidden(f, '--assume-unchanged');
  fs.writeFileSync(path.join(f.root, 'src/source.js'), 'PRIVATE_RAW_SENTINEL'); cleanStatus(f);
  const event = path.join(f.base, 'event.json');
  fs.writeFileSync(event, JSON.stringify({ pull_request: { head: { sha: f.head } } }));
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/verify-ci-source.cjs')], {
    cwd: f.root, encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: event, PRIVATE_ENV_SENTINEL: 'never-export-this' },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'CI_SOURCE_IDENTITY_FAILED\n');
});
