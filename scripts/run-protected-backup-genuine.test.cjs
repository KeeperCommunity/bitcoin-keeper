const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { supportedNode, disposableMongoUrl, checkedBackend } = require('./run-protected-backup-genuine.cjs');

test('protected proof requires the reviewed current22 runtime without accepting other majors or prereleases', () => {
  for (const version of ['22.23.3', 'v22.23.4', '22.24.0']) assert.equal(supportedNode(version), true);
  for (const version of ['22.16.0', '22.23.2', '20.23.3', '23.0.0', '22.23.3-rc.1', 'invalid'])
    assert.equal(supportedNode(version), false);
});

test('protected proof refuses hosted, credentialed, aliased-port or database-selecting Mongo targets', () => {
  assert.equal(disposableMongoUrl('mongodb://127.0.0.1:27038'), 'mongodb://127.0.0.1:27038');
  assert.equal(disposableMongoUrl('mongodb://localhost:27038/'), 'mongodb://localhost:27038/');
  for (const address of ['mongodb://example.invalid:27038', 'mongodb://user:pass@127.0.0.1:27038',
    'mongodb+srv://localhost', 'mongodb://127.0.0.1:27028', 'mongodb://127.0.0.1:27038/production',
    'mongodb://127.0.0.1:27038/?replicaSet=elsewhere', 'mongodb://127.0.0.1:27038/#fragment'])
    assert.throws(() => disposableMongoUrl(address));
});

test('an unreviewed local checkout is rejected before any fixture source can load', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-protected-guard-'));
  try {
    for (const args of [['init', '--quiet'], ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      '-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid',
      'commit', '--quiet', '--allow-empty', '-m', 'Disposable unreviewed fixture']]) {
      const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, 'Create only an owned disposable local Git fixture');
    }
    assert.throws(() => checkedBackend(directory), /Use exact reviewed backend/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
