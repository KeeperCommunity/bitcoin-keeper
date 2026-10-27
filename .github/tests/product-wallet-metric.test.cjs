'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const script = fs.readFileSync(path.join(__dirname, '../native/product_wallet_metric.js'), 'utf8');

function observe(marker, post) {
  const calls = [];
  vm.runInNewContext(script, { MARKER: marker, http: { post: (...args) => {
    calls.push(args);
    return post ? post() : { status: 200 };
  } } });
  return calls;
}

test('wallet observer sends only authored fixed labels to its loopback endpoint', () => {
  for (const marker of ['next_tapped', 'education_visible', 'skip_for_now_tapped',
    'warning_visible', 'skip_backup_tapped']) {
    const calls = observe(marker);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'http://127.0.0.1:8765/wallet-progress');
    assert.deepEqual(JSON.parse(calls[0][1].body), { marker });
  }
});

test('unknown strings and nonstrings never reach HTTP or serialization', () => {
  const privateObject = { toJSON() { throw Error('must not inspect private data'); } };
  for (const value of ['PRIVATE_SENTINEL', '', true, null, undefined, privateObject, ['next_tapped']]) {
    assert.equal(observe(value).length, 0);
  }
});

test('observer transport failure cannot replace the existing app test outcome', () => {
  assert.equal(observe('next_tapped', () => { throw Error('PRIVATE_SENTINEL'); }).length, 1);
  assert.equal(observe('next_tapped', () => ({ status: 503 })).length, 1);
});
