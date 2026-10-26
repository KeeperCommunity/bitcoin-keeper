'use strict';
// Source/bootstrap contract only; no native or release acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');

test('infrastructure imports without app fixtures; actual fixture start still fails closed when absent', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-bootstrap-import-'));
  try {
    const names = execFileSync('git', ['ls-tree', '-rz', '--name-only', 'HEAD', '--',
      '.github/native', '.github/scripts/verify-ci-source.cjs'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    assert(names.length > 100);
    for (const name of names) {
      const target = path.join(temporary, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, name), target);
    }
    assert.equal(fs.existsSync(path.join(temporary, 'tests')), false);
    const probe = `
      const assert = require('node:assert/strict');
      for (const name of ['release_acceptance', 'release_evidence', 'native_phase_receipts'])
        require('./.github/native/' + name + '.cjs');
      const fixture = require('./.github/native/r52_trust_ui_fixture.cjs');
      assert.equal(typeof fixture.verifyStage, 'function');
      assert.equal(fixture.STAGES.length, 9);
      assert.rejects(fixture.createFixture('IOS', 0), error =>
        error.code === 'MODULE_NOT_FOUND' && error.message.includes('tests/electrum/fixtures.cjs'))
        .catch(() => { process.exitCode = 1; });
    `;
    execFileSync(process.execPath, ['-e', probe], { cwd: temporary, timeout: 10000,
      env: { PATH: process.env.PATH, NODE_PATH: '', PYTHONPYCACHEPREFIX: '/dev/null', PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'] });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
