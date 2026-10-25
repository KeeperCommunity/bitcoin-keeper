'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const wrapper = path.resolve(__dirname, '../native/nodeify.cjs');

test('native shim preparation filters upstream defaults without requesting installation', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-nodeify-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstream = path.join(root, 'node_modules/rn-nodeify');
  fs.mkdirSync(upstream, { recursive: true });
  fs.writeFileSync(path.join(upstream, 'coreList.js'), "module.exports = ['constants', 'fs', 'net'];\n");
  fs.writeFileSync(path.join(upstream, 'cmd.js'), `
    process.stdout.write(JSON.stringify({
      shims: require('./coreList'), arguments: process.argv.slice(2)
    }));
  `);
  const result = spawnSync(process.execPath, ['-e',
    'require(process.argv[1]).runNodeify(process.cwd())', wrapper], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.arguments, ['--hack']);
  assert.deepEqual(output.shims, [
    'buffer', 'events', 'process', 'stream', 'inherits', 'path', 'assert', 'crypto',
  ]);
  assert.ok(!output.shims.includes('constants'));
});

test('native shim preparation rejects an unrelated working directory', () => {
  const { runNodeify } = require(wrapper);
  assert.throws(() => runNodeify(path.join(os.tmpdir(), 'unrelated-keeper-checkout')),
    /repository root/);
});
