'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { verifySource } = require('../scripts/verify-ci-source.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-ci-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet');
  git('config', 'user.email', 'disposable-ci@example.invalid');
  git('config', 'user.name', 'Disposable source control');
  fs.writeFileSync(path.join(root, 'source.txt'), 'immutable input\n');
  git('add', '.'); git('commit', '--quiet', '-m', 'candidate');
  const head = git('rev-parse', 'HEAD');
  return { root, git, head, env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2' },
    event: { pull_request: { head: { sha: head } } } };
}

test('actual clean event head emits its exact commit and tree without secret environment data', t => {
  const f = fixture(t);
  const r = verifySource({ ...f, env: { ...f.env, PRIVATE_SENTINEL: 'never-export-this' } });
  assert.equal(r.source_sha, f.head);
  assert.equal(r.source_tree, f.git('rev-parse', 'HEAD^{tree}'));
  assert.equal(r.run_attempt, '2');
  assert.equal(JSON.stringify(r).includes('never-export-this'), false);
});

test('a different commit is rejected even when it has the exact same source tree', t => {
  const f = fixture(t);
  f.git('commit', '--allow-empty', '--quiet', '-m', 'synthetic merge stand-in');
  assert.equal(f.git('rev-parse', 'HEAD^{tree}'), f.git('rev-parse', `${f.head}^{tree}`));
  assert.throws(() => verifySource(f), /differs from the event source/);
});

test('tracked staged or unstaged changes cannot retain a source pass', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, 'source.txt'), 'changed\n');
  assert.throws(() => verifySource(f), /Source changed/);
  f.git('add', '.');
  assert.throws(() => verifySource(f), /Source changed/);
});

test('added nonignored source and counterfeit or aliased paired checkouts are rejected', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'src'));
  fs.writeFileSync(path.join(f.root, 'src/extra.js'), 'module.exports = true;\n');
  assert.throws(() => verifySource(f), /Source changed/);
  fs.rmSync(path.join(f.root, 'src'), { recursive: true });
  const relay = path.join(f.root, '.ci-relay');
  fs.mkdirSync(relay);
  f.git('-C', relay, 'init', '--quiet');
  f.git('-C', relay, 'config', 'user.email', 'disposable-ci@example.invalid');
  f.git('-C', relay, 'config', 'user.name', 'Disposable paired control');
  f.git('-C', relay, 'commit', '--allow-empty', '--quiet', '-m', 'wrong paired source');
  assert.throws(() => verifySource(f), /Source changed/);
  assert.throws(() => verifySource({ ...f, allowPairedRelay: true }), /Unexpected paired Relay source/);
  fs.rmSync(relay, { recursive: true });
  fs.symlinkSync(os.tmpdir(), relay, 'dir');
  assert.throws(() => verifySource({ ...f, allowPairedRelay: true }), /Source changed|alias rejected/);
});

test('push uses its event commit while invalid or absent PR heads and other events fail closed', t => {
  const f = fixture(t);
  assert.equal(verifySource({ ...f, env: { ...f.env, GITHUB_EVENT_NAME: 'push', GITHUB_SHA: f.head } }).source_sha, f.head);
  for (const sha of [undefined, '', 'refs/heads/sprint', 'a'.repeat(39), 'A'.repeat(40)])
    assert.throws(() => verifySource({ ...f, event: { pull_request: { head: { sha } } } }), /exact event source/);
  assert.throws(() => verifySource({ ...f, env: { ...f.env, GITHUB_EVENT_NAME: 'pull_request_target' } }), /Unsupported/);
});

test('only explicit offline contract dispatch checks its exact GITHUB_SHA', t => {
  const f = fixture(t);
  for (const workflow of ['keeper-release-preparation-contracts', 'keeper-ruby-lock-contracts']) {
    for (const ref of ['refs/heads/sprint', 'refs/heads/disposable-review', 'refs/tags/source-only-test']) {
      const options = { ...f, allowContractDispatch: true, env: { ...f.env,
        GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: f.head,
        GITHUB_WORKFLOW_REF: `KeeperCommunity/bitcoin-keeper/.github/workflows/${workflow}.yml@${ref}` } };
      const result = verifySource(options);
      assert.equal(result.source_sha, f.head);
      assert.equal(result.event, 'workflow_dispatch');
      assert.match(result.scope, /Source identity only; no native, security or release acceptance/);
      assert.throws(() => verifySource({ ...options, allowContractDispatch: false }), /Unsupported CI source event/);
      assert.throws(() => verifySource({ ...options, allowPairedRelay: true }), /Unsupported manual contract route/);
      for (const sha of [undefined, '', 'refs/heads/sprint', 'b'.repeat(40)]) {
        assert.throws(() => verifySource({ ...options, env: { ...options.env, GITHUB_SHA: sha } }), /event source/);
      }
    }
  }
});

test('manual contract admission rejects native, foreign and unsupported routes', t => {
  const f = fixture(t);
  for (const route of [undefined, '',
    'KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-canonical-native.yml@refs/heads/sprint',
    'KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-protected-release-plan.yml@refs/heads/sprint',
    'foreign/repository/.github/workflows/keeper-ruby-lock-contracts.yml@refs/heads/sprint',
    'KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-ruby-lock-contracts.yml@refs/pull/1/merge']) {
    assert.throws(() => verifySource({ ...f, allowContractDispatch: true, env: { ...f.env,
      GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: f.head, GITHUB_WORKFLOW_REF: route } }), /Unsupported manual contract route/);
  }
});

test('manual source checks reject same-tree other commits and added or changed source', t => {
  const f = fixture(t);
  const options = { ...f, allowContractDispatch: true, env: { ...f.env, GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_SHA: f.head, GITHUB_WORKFLOW_REF: 'KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-ruby-lock-contracts.yml@refs/heads/review' } };
  fs.writeFileSync(path.join(f.root, 'unexpected.js'), 'never accepted');
  assert.throws(() => verifySource(options), /Source changed/);
  fs.rmSync(path.join(f.root, 'unexpected.js'));
  fs.appendFileSync(path.join(f.root, 'source.txt'), 'changed');
  assert.throws(() => verifySource(options), /Source changed/);
  f.git('add', '.');
  assert.throws(() => verifySource(options), /Source changed/);
  f.git('restore', '--staged', '--worktree', '.');
  f.git('commit', '--allow-empty', '--quiet', '-m', 'same-tree different source');
  assert.equal(f.git('rev-parse', 'HEAD^{tree}'), f.git('rev-parse', `${f.head}^{tree}`));
  assert.throws(() => verifySource(options), /differs from the event source/);
});

test('manual contract CLI emits only a source receipt and rejects combined options', t => {
  const f = fixture(t), events = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-source-event-'));
  t.after(() => fs.rmSync(events, { recursive: true, force: true }));
  const eventPath = path.join(events, 'event.json');
  fs.writeFileSync(eventPath, '{}');
  const script = path.resolve(__dirname, '../scripts/verify-ci-source.cjs');
  const options = { cwd: f.root, encoding: 'utf8', env: { PATH: process.env.PATH,
    GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_EVENT_PATH: eventPath, GITHUB_SHA: f.head,
    GITHUB_WORKFLOW_REF: 'KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-ruby-lock-contracts.yml@refs/heads/review' } };
  const result = JSON.parse(execFileSync(process.execPath, [script, '--contract-dispatch'], options));
  assert.equal(result.source_sha, f.head);
  assert.equal(result.event, 'workflow_dispatch');
  assert.equal(result.authorization_eligible, undefined);
  assert.equal(result.execution_allowed, undefined);
  assert.throws(() => execFileSync(process.execPath, [script, '--contract-dispatch', '--paired-relay'],
    { ...options, stdio: ['ignore', 'pipe', 'pipe'] }), /CI_SOURCE_IDENTITY_FAILED/);
});

test('all three CI jobs select the event head and verify source before setup, after setup and after checks', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../workflows/test.yml'), 'utf8');
  const chunks = source.split(/\n  (?:lint|test|automatic-backup-genuine):\n/).slice(1);
  assert.equal(chunks.length, 3);
  for (const chunk of chunks) {
    assert.match(chunk, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
    assert.equal((chunk.match(/node \.github\/scripts\/verify-ci-source\.cjs/g) || []).length, 3);
    const first = chunk.indexOf('node .github/scripts/verify-ci-source.cjs');
    const install = chunk.search(/Install (?:Keeper )?dependencies/);
    const last = chunk.lastIndexOf('node .github/scripts/verify-ci-source.cjs');
    assert.ok(first < install && last > install);
    assert.match(chunk, /name: Verify exact source after checks\n\s+if: always\(\)/);
    const finalCheck = chunk.lastIndexOf('name: Verify exact source after checks');
    assert.ok(finalCheck > chunk.lastIndexOf('name: Test Android reproducibility tools'));
    if (chunk.includes('name: Automatic backup native Realm and Relay'))
      assert.equal((chunk.match(/verify-ci-source\.cjs --paired-relay/g) || []).length, 3);
    else assert.equal(chunk.includes('--paired-relay'), false);
  }
});
