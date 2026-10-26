'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { category } = require('../native/ios_r52_fixture_probe.cjs');
test('raw fixture errors reduce to finite categories without private output', () => {
  assert.equal(category({ message: 'PRIVATE_SENTINEL', stderr: Buffer.from('x509: Unknown option -new PRIVATE_SENTINEL') }), 'OPENSSL_OPTION_UNSUPPORTED');
  assert.equal(category({ message: 'PRIVATE_SENTINEL', status: 1 }), 'OPENSSL_COMMAND_FAILED');
  assert.equal(category({ message: 'PRIVATE_SENTINEL', code: 'EACCES' }), 'LOOPBACK_LISTEN_FAILED');
  assert.equal(category({ message: 'PRIVATE_SENTINEL', code: 'ENOENT' }), 'REQUIRED_FILE_OR_TOOL_MISSING');
  assert.equal(category({ message: 'PRIVATE_SENTINEL' }), 'FIXTURE_INITIALIZATION_FAILED');
});
test('bootstrap imports the actual probe without TLS driver or app fixture modules', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-fixture-bootstrap-'));
  try {
    const target = path.join(directory, 'ios_r52_fixture_probe.cjs');
    fs.copyFileSync(require.resolve('../native/ios_r52_fixture_probe.cjs'), target);
    const child = spawnSync(process.execPath, ['-e',
      'const p=require(process.argv[1]); if(Object.keys(p).join()!=="category") process.exit(1)', target],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
    assert.equal(child.status, 0); assert.equal(child.stdout, ''); assert.equal(child.stderr, '');
    // Actual invocation still fails closed when its required fixture is absent.
    const invocation = spawnSync(process.execPath, [target], { encoding: 'utf8', timeout: 5000,
      maxBuffer: 4096, env: { ...process.env, TMPDIR: directory } });
    assert.equal(invocation.status, 1);
    const facts = JSON.parse(invocation.stdout);
    assert.equal(facts.readiness, 'FAIL'); assert.equal(facts.native_acceptance, false);
    assert.equal(facts.error_category, 'FIXTURE_INITIALIZATION_FAILED');
    assert.equal(invocation.stderr, '');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
