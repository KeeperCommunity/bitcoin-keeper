'use strict';
// Original artifact bytes only. API responses and internal IPC have separate boundaries.
// Callers supply their reviewed member cap; the default public bound stays at 512 KiB.
const DEFAULT_MAX_BYTES = 512 * 1024, MAX_BYTES = 2000000, MAX_DEPTH = 128;
const ERROR = 'STRICT_ARTIFACT_JSON_INVALID';
const fail = () => { throw new Error(ERROR); };

function parseStrictJson(raw, maxBytes = DEFAULT_MAX_BYTES) {
  try {
    if (!Buffer.isBuffer(raw) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES ||
        raw.length < 1 || raw.length > maxBytes) fail();
    // Preserve a BOM as a character so it is rejected rather than silently discarded.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    const numberToken = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    let at = 0;
    const whitespace = () => {
      while (text[at] === ' ' || text[at] === '\t' || text[at] === '\r' || text[at] === '\n') at++;
    };
    const string = () => {
      if (text[at] !== '"') fail();
      const start = at++;
      for (;;) {
        if (at >= text.length) fail();
        const char = text[at++];
        if (char === '"') break;
        if (char.charCodeAt(0) < 0x20) fail();
        if (char === '\\') {
          const escaped = text[at++];
          if (escaped === 'u') {
            if (!/^[a-fA-F0-9]{4}$/.test(text.slice(at, at + 4))) fail();
            at += 4;
          } else if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escaped)) fail();
        }
      }
      const value = JSON.parse(text.slice(start, at));
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const low = value.charCodeAt(++i);
          if (!(low >= 0xdc00 && low <= 0xdfff)) fail();
        } else if (code >= 0xdc00 && code <= 0xdfff) fail();
      }
      return value;
    };
    const value = depth => {
      whitespace();
      const char = text[at];
      if (char === '"') return string();
      if (char === '{' || char === '[') {
        if (++depth > MAX_DEPTH) fail();
        at++;
        whitespace();
        if (char === '[') {
          const result = [];
          if (text[at] === ']') { at++; return result; }
          for (;;) {
            result.push(value(depth));
            whitespace();
            if (text[at] === ']') { at++; return result; }
            if (text[at++] !== ',') fail();
          }
        }
        const result = {}, seen = new Set();
        if (text[at] === '}') { at++; return result; }
        for (;;) {
          whitespace();
          const key = string();
          if (seen.has(key)) fail();
          seen.add(key);
          whitespace();
          if (text[at++] !== ':') fail();
          // Assignment would invoke Object.prototype.__proto__; define an ordinary own data key.
          Object.defineProperty(result, key, { value: value(depth), writable: true, enumerable: true, configurable: true });
          whitespace();
          if (text[at] === '}') { at++; return result; }
          if (text[at++] !== ',') fail();
        }
      }
      for (const [token, result] of [['true', true], ['false', false], ['null', null]]) {
        if (text.startsWith(token, at)) { at += token.length; return result; }
      }
      numberToken.lastIndex = at;
      const token = numberToken.exec(text);
      if (!token) fail();
      at = numberToken.lastIndex;
      const result = Number(token[0]);
      if (!Number.isFinite(result)) fail();
      return result;
    };
    const result = value(0);
    whitespace();
    if (at !== text.length) fail();
    return result;
  } catch {
    // Never expose untrusted byte contents, parser excerpts, paths or URLs.
    throw new Error(ERROR);
  }
}

module.exports = { parseStrictJson, DEFAULT_MAX_BYTES, MAX_BYTES, MAX_DEPTH };
