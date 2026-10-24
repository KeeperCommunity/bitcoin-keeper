'use strict';

// Observe the normal Metro configuration. Never alter requests or response bodies.
const config = require('../../metro.config.js');
const { record: emit } = require('./startup_reporter.cjs');
const { fromSymbolicatedStack } = require('./startup_source_frames.cjs');
const RESPONSE_LIMIT = 256 * 1024;

function observeSymbolication(res) {
  const originalWrite = res.write;
  const originalEnd = res.end;
  if (typeof originalWrite !== 'function' || typeof originalEnd !== 'function') {
    try { emit({ kind: 'SYMBOLICATE_RESPONSE', capture_status: 'UNAVAILABLE', source_frames: [],
      observed_frames: 0, rejected_frames: 0, truncated: false }); } catch (_) { /* optional */ }
    return;
  }
  let chunks = [], size = 0, failure = null, complete = false;
  // The pinned CLI installs compression before Metro's enhanced middleware.
  // Our wrappers see application JSON before that earlier layer compresses it;
  // a gzip header set during the first write therefore does not describe our
  // captured bytes. Reject only an encoding already present at this boundary.
  try {
    const encoding = typeof res.getHeader === 'function' ? res.getHeader('content-encoding') : undefined;
    if (encoding != null && encoding !== 'identity') failure = 'UNSUPPORTED_ENCODING';
  } catch (_) { failure = 'UNAVAILABLE'; }
  const empty = capture_status => ({ capture_status, source_frames: [], observed_frames: 0,
    rejected_frames: 0, truncated: ['OVERSIZED', 'DEPTH_LIMIT'].includes(capture_status) });
  function purge() {
    for (const chunk of chunks) chunk.fill(0);
    chunks = []; size = 0;
  }
  function capture(chunk, encoding) {
    if (failure || complete || chunk == null || typeof chunk === 'function') return;
    let bytes, length;
    if (typeof chunk === 'string') length = Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : 'utf8');
    else if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) length = chunk.byteLength;
    else { failure = 'UNSUPPORTED_CHUNK'; purge(); return; }
    if (size + length > RESPONSE_LIMIT) {
      failure = 'OVERSIZED'; purge(); return;
    }
    bytes = typeof chunk === 'string' ? Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8') : Buffer.from(chunk);
    size += bytes.length; chunks.push(bytes);
  }
  function wrappedWrite(...args) {
    if (this === res) {
      try { capture(args[0], args[1]); } catch (_) { failure = 'UNSUPPORTED_CHUNK'; purge(); }
    }
    try { return originalWrite.apply(this, args); }
    catch (error) { if (this === res) finish(true); throw error; }
  }
  function wrappedEnd(...args) {
    if (this === res) {
      try { capture(args[0], args[1]); } catch (_) { failure = 'UNSUPPORTED_CHUNK'; purge(); }
    }
    try { return originalEnd.apply(this, args); }
    catch (error) { if (this === res) finish(true); throw error; }
  }
  function finish(incomplete) {
    if (complete) return;
    complete = true;
    let result, body;
    try {
      if (incomplete) result = empty('INCOMPLETE_RESPONSE');
      else if (failure) result = empty(failure);
      else if (res.statusCode !== 200) result = empty('HTTP_ERROR');
      else {
        body = Buffer.concat(chunks, size);
        let parsed;
        try {
          const text = body.toString('utf8');
          const encoded = Buffer.from(text, 'utf8');
          const valid = encoded.equals(body);
          encoded.fill(0);
          if (!valid) throw Error('Invalid UTF-8.');
          parsed = JSON.parse(text);
        } catch (_) { result = empty('INVALID_JSON'); }
        if (!result) {
          const pending = [[parsed, 0]];
          let nodes = 0;
          while (pending.length) {
            const [value, depth] = pending.pop();
            nodes += 1;
            if (depth > 16 || nodes > 10000) { result = empty('DEPTH_LIMIT'); break; }
            if (value && typeof value === 'object') {
              for (const item of Object.values(value)) pending.push([item, depth + 1]);
            }
          }
          if (!result) {
            result = parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
              Object.hasOwn(parsed, 'stack') ? fromSymbolicatedStack(parsed.stack) : empty('INVALID_RESPONSE');
          }
        }
      }
    } catch (_) { result = empty('UNAVAILABLE'); }
    finally {
      if (body) body.fill(0);
      purge();
      try { if (res.write === wrappedWrite) res.write = originalWrite; } catch (_) { /* optional */ }
      try { if (res.end === wrappedEnd) res.end = originalEnd; } catch (_) { /* optional */ }
    }
    try { emit({ kind: 'SYMBOLICATE_RESPONSE', ...result }); } catch (_) { /* optional */ }
  }
  try {
    res.write = wrappedWrite; res.end = wrappedEnd;
    res.once('finish', () => finish(false));
    res.once('close', () => finish(true));
  } catch (_) { finish(true); }
}
const bool = (value) => value == null ? null : value === 'true' ? true : value === 'false' ? false : 'OTHER';
const enumeration = (value, allowed) => value == null ? null : allowed.includes(value) ? value : 'OTHER';
const originalEnhance = config.server && config.server.enhanceMiddleware;
function enhanceMiddleware(middleware, server) {
  const inner = originalEnhance ? originalEnhance.call(config.server, middleware, server) : middleware;
  return function observe(req, res, next) {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const kind = url.pathname === '/index.bundle' ? 'ENTRY_BUNDLE' : url.pathname.endsWith('.bundle') ? 'SPLIT_BUNDLE' : url.pathname === '/symbolicate' ? 'SYMBOLICATE' : null;
      if (kind) {
        const query = url.searchParams;
        const options = {};
        for (const key of ['dev', 'lazy', 'minify', 'modulesOnly', 'runModule', 'excludeSource']) options[key] = bool(query.get(key));
        options.platform = enumeration(query.get('platform'), ['android', 'ios']);
        options.sourcePaths = enumeration(query.get('sourcePaths'), ['url-server', 'absolute']);
        options.engine = enumeration(query.get('transform.engine'), ['hermes', 'jsc']);
        const appIds = { android: 'io.hexawallet.keeper.development', ios: 'io.hexawallet.hexakeeper.dev' };
        options.app = query.has('app') ? query.get('app') === appIds[options.platform] ? 'EXPECTED' : 'OTHER' : null;
        const started = Date.now();
        emit({ kind: 'REQUEST', request: kind, options });
        if (kind === 'SYMBOLICATE') observeSymbolication(res);
        res.once('finish', () => {
          const duration = Date.now() - started;
          emit({ kind: 'RESPONSE', request: kind,
            outer_http_status: Number.isInteger(res.statusCode) && res.statusCode >= 100 && res.statusCode <= 599 ? res.statusCode : null,
            duration_ms: duration >= 0 && duration <= 600000 ? duration : null,
          });
        });
      }
    } catch (_) { /* Request observation is optional. */ }
    return inner.call(this, req, res, next);
  };
}
module.exports = { ...config, server: { ...config.server, enhanceMiddleware } };
