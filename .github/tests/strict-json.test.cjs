'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseStrictJson, DEFAULT_MAX_BYTES, MAX_BYTES, MAX_DEPTH } = require('../native/strict_json.cjs');
const parse = value => parseStrictJson(Buffer.from(value));
const invalid = value => assert.throws(() => parse(value), { message: 'STRICT_ARTIFACT_JSON_INVALID' });

test('ordinary receipt values preserve JSON semantics, Unicode and own-property order', () => {
  const original = { schema: 1, measurements: [0, -0, 1.25, -7e20, true, false, null],
    text: 'é 😀 \n\t " \\ /', nested: { status: 'PASS', run: '39853694295' } };
  const bytes = Buffer.from(JSON.stringify(original));
  assert.deepEqual(parseStrictJson(bytes), JSON.parse(bytes));
  assert.deepEqual(Object.keys(parseStrictJson(bytes)), Object.keys(original));
  assert.equal(Object.getPrototypeOf(parseStrictJson(bytes)), Object.prototype);
});

test('standard scalars, whitespace and escaped surrogate pairs parse', () => {
  for (const value of ['null', 'true', 'false', '-0', '0', '1e308', '-1.3E-200', '"\\ud83d\\ude00"',
    '  \r\n\t[{},[],"\\/\\b\\f\\n\\r\\t\\\\\\\""]\n']) {
    assert.deepEqual(parse(value), JSON.parse(value));
  }
});

test('Object prototype-sensitive names are ordinary own data and do not mutate prototypes', () => {
  const result = parse('{"__proto__":{"polluted":true},"constructor":{"prototype":null},"prototype":5}');
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(result, '__proto__'), {
    value: { polluted: true }, enumerable: true, writable: true, configurable: true,
  });
  assert.equal({}.polluted, undefined);
  assert.equal(result.constructor.prototype, null);
});

test('duplicate smoke FAIL then PASS is rejected before status projection', () => {
  const original = '{"smoke":"FAIL","smoke":"PASS"}';
  assert.equal(JSON.parse(original).smoke, 'PASS', 'reproduce the unsafe last-key-wins decoder');
  invalid(original);
});

for (const [name, value] of [
  ['nested object duplicate', '{"x":{"status":"FAIL","status":"PASS"}}'],
  ['array-contained duplicate', '[{"status":"FAIL","status":"PASS"}]'],
  ['escaped root equivalent key', '{"smoke":"FAIL","smo\\u006be":"PASS"}'],
  ['escaped nested equivalent key', '{"x":[{"\\u0073tatus":"FAIL","status":"PASS"}]}'],
  ['escaped slash equivalent key', '{"a/b":1,"a\\/b":2}'],
  ['surrogate-pair equivalent key', '{"😀":1,"\\ud83d\\ude00":2}'],
  ['prototype-sensitive duplicate', '{"__proto__":0,"\\u005f_proto__":1}'],
  ['empty key duplicate', '{"":0,"":1}'],
  ['empty input', ''], ['whitespace only', ' \r\n\t'],
  ['NaN', 'NaN'], ['Infinity', 'Infinity'], ['negative Infinity', '-Infinity'],
  ['positive overflow', '1e400'], ['negative overflow', '-1E400'],
  ['nested overflow', '{"timing":[1e400]}'],
  ['leading zero', '01'], ['negative leading zero', '-01'],
  ['missing fraction digits', '1.'], ['missing leading integer', '.1'],
  ['incomplete exponent', '1e+'], ['plus prefix', '+1'],
  ['hexadecimal', '0x10'], ['numeric separator', '1_000'],
  ['undefined', 'undefined'], ['uppercase literal', 'TRUE'],
  ['trailing value', '{}{}'], ['trailing scalar', 'true false'],
  ['line comment', '{"x":1}// private'], ['block comment', '/* private */{}'],
  ['single quoted key', "{'x':1}"], ['unquoted key', '{x:1}'],
  ['object trailing comma', '{"x":1,}'], ['array trailing comma', '[1,]'],
  ['array missing value', '[,1]'], ['missing colon', '{"x" 1}'],
  ['missing comma', '{"x":1 "y":2}'], ['missing close', '{"x":1'],
  ['unterminated string', '"private'], ['unescaped newline', '"private\nvalue"'],
  ['unescaped control', '"private\u0001value"'], ['invalid escape', '"\\x42"'],
  ['incomplete Unicode escape', '"\\u123"'], ['invalid Unicode escape', '"\\u123z"'],
  ['unpaired high surrogate', '"\\ud800"'], ['unpaired low surrogate', '"\\udc00"'],
  ['high surrogate then ordinary character', '"\\ud800A"'],
  ['high surrogate in object key', '{"\\ud800":1}'],
  ['BOM prefix', '\ufeff{}'], ['non-JSON whitespace', '\u00a0{}'],
]) test(`rejects ${name} with a fixed content-free error`, () => invalid(value));

test('duplicate keys are local to each object, not incorrectly global across siblings', () => {
  assert.deepEqual(parse('[{"status":"PASS"},{"status":"PASS"}]'), [{ status: 'PASS' }, { status: 'PASS' }]);
  assert.deepEqual(parse('{"x":1,"nested":{"x":2}}'), { x: 1, nested: { x: 2 } });
});

test('Unicode normalization is not invented for distinct decoded keys', () => {
  assert.deepEqual(Object.keys(parse('{"é":1,"e\\u0301":2}')), ['é', 'e\u0301']);
});

test('fatal UTF8 rejects malformed, overlong, truncated and surrogate encodings', () => {
  for (const bytes of [Buffer.from([0xff]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xe2, 0x82]),
    Buffer.from([0x22, 0xed, 0xa0, 0x80, 0x22]), Buffer.from([0xf4, 0x90, 0x80, 0x80])]) {
    assert.throws(() => parseStrictJson(bytes), { message: 'STRICT_ARTIFACT_JSON_INVALID' });
  }
});

test('default 512 KiB remains enforced while explicit reviewed caps have a 2,000,000 byte ceiling', () => {
  const atLimit = Buffer.from('"' + 'a'.repeat(DEFAULT_MAX_BYTES - 2) + '"');
  assert.equal(parseStrictJson(atLimit).length, DEFAULT_MAX_BYTES - 2);
  assert.throws(() => parseStrictJson(Buffer.concat([atLimit, Buffer.from(' ')])), { message: 'STRICT_ARTIFACT_JSON_INVALID' });
  const maximum = Buffer.from('"' + 'a'.repeat(MAX_BYTES - 2) + '"');
  assert.equal(parseStrictJson(maximum, MAX_BYTES).length, MAX_BYTES - 2);
  assert.throws(() => parseStrictJson(Buffer.concat([maximum, Buffer.from(' ')]), MAX_BYTES), { message: 'STRICT_ARTIFACT_JSON_INVALID' });
  assert.throws(() => parseStrictJson(maximum), { message: 'STRICT_ARTIFACT_JSON_INVALID' });
  assert.deepEqual(parseStrictJson(Buffer.from('{}'), 2), {});
  for (const limit of [0, -1, 1, 1.1, NaN, Infinity, '2', MAX_BYTES + 1]) {
    assert.throws(() => parseStrictJson(Buffer.from('{}'), limit), { message: 'STRICT_ARTIFACT_JSON_INVALID' });
  }
});

test('only original Buffers are accepted', () => {
  for (const value of ['{}', new Uint8Array([123, 125]), {}, null, undefined, Buffer.alloc(0)]) {
    assert.throws(() => parseStrictJson(value), { message: 'STRICT_ARTIFACT_JSON_INVALID' });
  }
});

test('128 nested containers accepted; deeper arrays, objects and mixed structures rejected', () => {
  assert.ok(Array.isArray(parse('['.repeat(MAX_DEPTH) + '0' + ']'.repeat(MAX_DEPTH))));
  invalid('['.repeat(MAX_DEPTH + 1) + '0' + ']'.repeat(MAX_DEPTH + 1));
  invalid('{"x":'.repeat(MAX_DEPTH + 1) + '0' + '}'.repeat(MAX_DEPTH + 1));
  invalid('[{"x":'.repeat(65) + '0' + '}]'.repeat(65));
});

test('large flat data is bounded by bytes without an arbitrary member-count acceptance shortcut', () => {
  const original = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`case${i}`, i]));
  assert.deepEqual(parse(JSON.stringify(original)), original);
});
