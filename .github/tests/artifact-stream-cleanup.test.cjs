'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./fixtures/actions-software.cjs');
const { readPublicArtifactBytes } = require('../native/actions_software_evidence.cjs');

function storageResponse(options = {}) {
  const observed = { bodyReads: 0, bodyCancellations: 0, readerCancellations: 0 };
  const reader = {
    async read() {
      observed.bodyReads++;
      if (options.readError) throw new Error('PRIVATE_READ_PAYLOAD');
      return observed.bodyReads === 1 ? { done: false, value: options.bigChunk ? Buffer.alloc(1048577) : Buffer.from('disposable') } : { done: true };
    },
    async cancel() {
      observed.readerCancellations++;
      if (options.cancelError) throw new Error('PRIVATE_CANCEL_PAYLOAD https://private.invalid/?sig=SECRET');
    },
  };
  const body = {
    getReader() { if (options.lockError) throw new Error('PRIVATE_LOCK_PAYLOAD'); return reader; },
    async cancel() {
      observed.bodyCancellations++;
      if (options.cancelError) throw new Error('PRIVATE_CANCEL_PAYLOAD https://private.invalid/?sig=SECRET');
    },
  };
  return { observed, response: { ok: options.ok ?? true, body,
    headers: { get: () => { if (options.headerError) throw new Error('PRIVATE_HEADER_PAYLOAD'); return options.length ?? null; } } } };
}
async function read(options) {
  const state = fixture(), original = state.options.fetchImpl, storage = storageResponse(options);
  state.options.fetchImpl = (url, init) => new URL(url).hostname === 'api.github.com'
    ? original(url, init) : storage.response;
  return { observed: storage.observed, result: readPublicArtifactBytes(state.github, 101, state.options) };
}
for (const [name, options, code] of [
  ['failed status', { ok: false }, 'SOFTWARE_ARCHIVE_READ_FAILED'],
  ['oversized length', { length: '1048577' }, 'SOFTWARE_ARCHIVE_TOO_LARGE'],
  ['malformed length', { length: 'private-body-length' }, 'SOFTWARE_ARCHIVE_TOO_LARGE'],
  ['negative length', { length: '-1' }, 'SOFTWARE_ARCHIVE_TOO_LARGE'],
  ['reader acquisition failure', { lockError: true }, 'SOFTWARE_ARCHIVE_READ_FAILED'],
  ['header read failure', { headerError: true }, 'SOFTWARE_ARCHIVE_READ_FAILED'],
]) test('cancels the unread storage body on ' + name, async () => {
  const { observed, result } = await read(options);
  await assert.rejects(result, new RegExp('^Error: ' + code + '$'));
  assert.deepEqual(observed, { bodyReads: 0, bodyCancellations: 1, readerCancellations: 0 });
});
for (const [name, options, code] of [
  ['successful read', {}, null],
  ['stream failure', { readError: true }, 'SOFTWARE_ARCHIVE_READ_FAILED'],
  ['oversized streamed bytes', { bigChunk: true }, 'SOFTWARE_ARCHIVE_TOO_LARGE'],
  ['length mismatch', { length: '1' }, 'SOFTWARE_ARCHIVE_SIZE_MISMATCH'],
]) test('cancels exactly the acquired reader on ' + name, async () => {
  const { observed, result } = await read(options);
  if (code) await assert.rejects(result, new RegExp('^Error: ' + code + '$'));
  else assert.equal((await result).toString(), 'disposable');
  assert.equal(observed.readerCancellations, 1);
  assert.equal(observed.bodyCancellations, 0);
  assert.ok(observed.bodyReads > 0);
});
for (const options of [{ cancelError: true }, { ok: false, cancelError: true },
  { length: '1048577', cancelError: true }, { readError: true, cancelError: true }]) {
  test('cleanup failure remains blocking and exposes only a fixed code', async () => {
    const { observed, result } = await read(options);
    await assert.rejects(result, /^Error: SOFTWARE_ARCHIVE_READ_FAILED$/);
    assert.equal(observed.readerCancellations + observed.bodyCancellations, 1);
  });
}
