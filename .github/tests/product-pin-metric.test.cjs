/* Host marker script controls only; these tests grant no native acceptance. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../native/product_pin_metric.js'), 'utf8');
const markers = [
  'confirm_passcode_visible', 'confirmation_digits_tapped', 'create_tapped',
  'continue_visible', 'continue_tapped', 'cancel_visible', 'cancel_tapped',
  'skip_visible', 'skip_tapped', 'start_new_visible',
];

function observe(marker, post = () => ({ status: 200 })) {
  const calls = [];
  const context = {
    http: { post(url, options) { calls.push({ url, options }); return post(); } },
    console: new Proxy({}, { get() { throw new Error('Logging is forbidden'); } }),
  };
  if (marker !== undefined) context.MARKER = marker;
  vm.runInNewContext(source, context);
  return calls;
}

test('every fixed marker sends exactly one field to the fixed loopback host', () => {
  for (const marker of markers) {
    const calls = observe(marker);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:8765/pin-progress');
    assert.deepEqual(JSON.parse(calls[0].options.body), { marker });
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.deepEqual(Object.keys(calls[0].options).sort(), ['body', 'headers']);
  }
});

test('unknown or non-string marker values never leave the script', () => {
  for (const marker of [undefined, null, true, 1111, 'DO_NOT_RETAIN',
    { toString() { throw new Error('DO_NOT_RETAIN'); } }, ['confirm_passcode_visible']]) {
    assert.deepEqual(observe(marker), []);
  }
});

test('transport errors and rejected progress do not become new UI acceptance conditions', () => {
  assert.equal(observe(markers[0], () => { throw new Error('DO_NOT_RETAIN'); }).length, 1);
  for (const reply of [{ status: 422, body: 'DO_NOT_RETAIN' }, undefined]) {
    assert.equal(observe(markers[0], () => reply).length, 1);
  }
});
