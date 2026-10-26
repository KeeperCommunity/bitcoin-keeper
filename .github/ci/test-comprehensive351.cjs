'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateEvents } = require('./run-comprehensive351.cjs');
function execute(body) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-ledger-test-'));
  fs.writeFileSync(path.join(app, 'proof.cjs'), "const {test}=require('node:test');\n" + body);
  try {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const p = spawnSync(process.execPath, ['--test', '--test-reporter=' + path.join(__dirname, 'comprehensive351-reporter.cjs'), path.join(app, 'proof.cjs')], { encoding: 'utf8', env });
    return { app, stdout: p.stdout, status: p.status };
  } finally { fs.rmSync(app, { recursive: true }); }
}
const suite = { file: 'proof.cjs', cases: [{ id: 'proof.cjs:1', name: 'retained obligation' }] };
test('actual Node event stream establishes only the expected executed case', () => {
  const r = execute("test('retained obligation',()=>{});");
  assert.equal(validateEvents(suite, r.stdout, r.status, r.app)[0].status, 'PASS');
});
for (const [name, body] of [
  ['skip', "test.skip('retained obligation',()=>{});"],
  ['todo', "test.todo('retained obligation',()=>{});"],
  ['failure', "test('retained obligation',()=>{throw new Error('red');});"],
  ['omission', ''],
  ['renaming', "test('unrelated obligation',()=>{});"],
  ['extra', "test('retained obligation',()=>{});test('extra',()=>{});"],
]) test('actual ' + name + ' cannot satisfy an obligation', () => {
  const r = execute(body); assert.throws(() => validateEvents(suite, r.stdout, r.status, r.app));
});
test('a result from another source file is rejected', () => {
  const r = execute("test('retained obligation',()=>{});");
  assert.throws(() => validateEvents(suite, r.stdout, r.status, r.app + '-other'));
});
