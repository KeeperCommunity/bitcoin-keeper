'use strict';

// A source receipt, not native acceptance or release authorization.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const SHA = /^[a-f0-9]{40}$/;
const PAIRED_RELAY_SHA = '838049e537e07eb646a2a0393eb969fba43d0739';
const MANUAL_CONTRACTS = /^KeeperCommunity\/bitcoin-keeper\/\.github\/workflows\/keeper-(?:release-preparation-contracts|ruby-lock-contracts)\.yml@refs\/(?:heads|tags)\/[^\s]+$/;

function gitAt(directory, args, binary = false) {
  return execFileSync('git', ['--no-replace-objects', '--no-optional-locks', '-C', directory, ...args], {
    encoding: binary ? undefined : 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000, maxBuffer: 16 * 1024 * 1024,
  });
}

// Read HEAD's immutable tree, never the index or a checkout-authored manifest.
// Git status remains useful for added/staged files but index flags can hide edits.
function verifyRawCheckout(root, commit) {
  assert.match(commit ?? '', SHA, 'An exact raw source commit is required');
  const directory = path.resolve(root);
  assert.equal(fs.realpathSync(directory), directory, 'Checkout alias rejected');
  assert.ok(fs.lstatSync(directory).isDirectory(), 'Expected checkout directory');
  const git = (...args) => gitAt(directory, args).trim();
  assert.equal(path.resolve(git('rev-parse', '--show-toplevel')), directory, 'Expected checkout root');
  assert.equal(git('rev-parse', 'HEAD'), commit, 'Raw checkout commit changed');
  const tree = git('rev-parse', `${commit}^{tree}`);
  assert.match(tree, SHA);
  const listing = gitAt(directory, ['ls-tree', '-r', '-z', '--full-tree', commit], true);
  const decoded = listing.toString('utf8');
  assert.ok(Buffer.from(decoded, 'utf8').equals(listing), 'Unsupported Git path encoding');
  const records = decoded.split('\0');
  assert.equal(records.pop(), '', 'Incomplete raw source tree');
  assert.ok(records.length > 0, 'Empty raw source tree');
  const seen = new Set();
  for (const record of records) {
    const split = record.indexOf('\t');
    assert.ok(split > 0, 'Invalid raw source tree entry');
    const header = /^([0-9]{6}) blob ([a-f0-9]{40})$/.exec(record.slice(0, split));
    assert.ok(header && ['100644', '100755'].includes(header[1]), 'Expected regular tracked Git blob');
    const relative = record.slice(split + 1);
    assert.ok(relative && !path.isAbsolute(relative) &&
      !relative.split('/').some(part => !part || part === '.' || part === '..'), 'Invalid tracked source path');
    assert.ok(!seen.has(relative), 'Duplicate tracked source path');
    seen.add(relative);
    const filename = path.join(directory, relative);
    const before = fs.lstatSync(filename);
    assert.ok(before.isFile(), 'Expected regular tracked source file');
    assert.equal(fs.realpathSync(filename), filename, 'Tracked source alias rejected');
    // Do not follow a final symlink swapped in after the path check. Verify the
    // descriptor still belongs to the checked regular path before/after reading.
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    let bytes, opened;
    try {
      opened = fs.fstatSync(fd);
      assert.ok(opened.isFile(), 'Expected regular source descriptor');
      assert.equal(opened.dev, before.dev, 'Tracked source replaced');
      assert.equal(opened.ino, before.ino, 'Tracked source replaced');
      bytes = fs.readFileSync(fd);
      const after = fs.fstatSync(fd);
      assert.equal(after.size, bytes.length, 'Tracked source changed while reading');
      assert.equal(after.mtimeMs, opened.mtimeMs, 'Tracked source changed while reading');
    } finally {
      fs.closeSync(fd);
    }
    const final = fs.lstatSync(filename);
    assert.ok(final.isFile(), 'Expected regular tracked source file');
    assert.equal(fs.realpathSync(filename), filename, 'Tracked source alias rejected');
    assert.equal(final.dev, opened.dev, 'Tracked source replaced');
    assert.equal(final.ino, opened.ino, 'Tracked source replaced');
    assert.equal(final.size, bytes.length, 'Tracked source changed while reading');
    assert.equal(final.mtimeMs, opened.mtimeMs, 'Tracked source changed while reading');
    const oid = crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(oid, header[2], 'Raw source differs from its Git blob');
    // Git records owner execute (0100), not group or other execute permissions.
    assert.equal((final.mode & 0o100) !== 0, header[1] === '100755', 'Tracked source owner execute mode changed');
  }
  assert.equal(git('rev-parse', 'HEAD'), commit, 'Raw checkout commit changed');
  return { tree, files: records.length };
}

function verifySource({ root = process.cwd(), env = process.env, event, allowPairedRelay = false,
  allowContractDispatch = false } = {}) {
  const manual = env.GITHUB_EVENT_NAME === 'workflow_dispatch' && allowContractDispatch === true;
  assert.ok(['pull_request', 'push'].includes(env.GITHUB_EVENT_NAME) || manual, 'Unsupported CI source event');
  if (manual) {
    // This opt-in checks source only on two existing offline contract routes.
    // It does not admit native/canonical dispatch or authorize any operation.
    assert.ok(!allowPairedRelay && MANUAL_CONTRACTS.test(env.GITHUB_WORKFLOW_REF || ''), 'Unsupported manual contract route');
  }
  const payload = event ?? JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const expected = env.GITHUB_EVENT_NAME === 'pull_request' ? payload.pull_request?.head?.sha : env.GITHUB_SHA;
  assert.match(expected ?? '', SHA, 'An exact event source commit is required');
  const git = (...args) => gitAt(root, args).trim();
  const actual = git('rev-parse', 'HEAD');
  assert.equal(actual, expected, 'Checked-out source differs from the event source commit');
  // Reject added source too. Only the matrix job owns a separate fixed Relay
  // checkout; it is independently checked rather than hidden by a broad ignore.
  const status = git('status', '--porcelain', '--untracked-files=normal');
  assert.equal(status.split('\n').filter(line => line &&
    !(allowPairedRelay && line === '?? .ci-relay/')).length, 0, 'Source changed during CI');
  if (allowPairedRelay) {
    const relay = path.join(root, '.ci-relay');
    assert.equal(fs.lstatSync(relay).isSymbolicLink(), false, 'Paired checkout alias rejected');
    assert.equal(fs.realpathSync(relay), path.resolve(relay), 'Paired checkout alias rejected');
    assert.equal(git('-C', relay, 'rev-parse', 'HEAD'), PAIRED_RELAY_SHA, 'Unexpected paired Relay source');
    assert.equal(git('-C', relay, 'status', '--porcelain', '--untracked-files=normal'), '', 'Paired Relay source changed');
    verifyRawCheckout(relay, PAIRED_RELAY_SHA);
  }
  const { tree } = verifyRawCheckout(root, actual);
  return { schema: 1, source_sha: actual, source_tree: tree, event: env.GITHUB_EVENT_NAME,
    run_id: env.GITHUB_RUN_ID ?? null, run_attempt: env.GITHUB_RUN_ATTEMPT ?? null,
    workflow_sha: env.GITHUB_WORKFLOW_SHA ?? null,
    scope: 'Source identity only; no native, security or release acceptance.' };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    assert.ok(args.length === 0 || (args.length === 1 && ['--paired-relay', '--contract-dispatch'].includes(args[0])), 'Unexpected source option');
    console.log(JSON.stringify(verifySource({ allowPairedRelay: args[0] === '--paired-relay',
      allowContractDispatch: args[0] === '--contract-dispatch' })));
  } catch (_) {
    console.error('CI_SOURCE_IDENTITY_FAILED');
    process.exitCode = 1;
  }
}
module.exports = { verifySource, verifyRawCheckout };
