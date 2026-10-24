'use strict';

// Fixed first-party source identity only. Never return a URL, method name,
// message, code frame, arbitrary path or stack text.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const startupPaths = Object.freeze(['index.js', 'App.tsx', 'shim.js', 'src/navigation/Navigator.tsx',
  'src/screens/Splash/SplashScreen.tsx', 'src/store/store.ts', 'src/store/sagas/login.ts',
  'src/storage/secure-store.ts', 'src/storage/realm/realm.ts', 'src/storage/realm/dbManager.ts',
  'src/context/AppContext.tsx', 'src/context/TorContext.tsx', 'src/context/ThemeContext.tsx',
  'src/context/Localization/LocContext.tsx', 'src/services/sentry/index.ts',
  'src/storage/index.ts', 'src/hooks/useNotificationHandler.tsx']);
const allowed = new Set(startupPaths);
const lengths = new Map();
const own = (value, key) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch (_) { return undefined; }
};
const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fresh = () => ({ source_frames: [], observed_frames: 0, rejected_frames: 0, truncated: false });

function publicPath(file) {
  if (typeof file !== 'string') return null;
  if (allowed.has(file)) return file;
  // No URL decoding, suffix matching or path normalization: those could turn a
  // foreign/traversal path into a false first-party attribution.
  const prefix = root + path.sep;
  return file.startsWith(prefix) && allowed.has(file.slice(prefix.length)) ? file.slice(prefix.length) : null;
}

function frame(file, line, column) {
  const source = publicPath(file);
  if (!source || !Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 1 || column < 1) return null;
  if (!lengths.has(source)) {
    try { lengths.set(source, fs.readFileSync(path.join(root, source), 'utf8').split('\n').map(value => value.length)); }
    catch (_) { lengths.set(source, []); }
  }
  const lines = lengths.get(source);
  if (line > lines.length || column > lines[line - 1] + 1) return null;
  return { path: source, line, column };
}

function add(result, value) {
  if (!value) { result.rejected_frames += 1; return; }
  if (result.source_frames.some(item => item.path === value.path && item.line === value.line && item.column === value.column)) return;
  if (result.source_frames.length < 8) result.source_frames.push(value);
  else result.truncated = true;
}

function fromText(texts) {
  const result = fresh();
  if (!Array.isArray(texts)) return result;
  if (texts.length > 16) result.truncated = true;
  for (const file of startupPaths) {
    const expression = new RegExp('(?:^|[\\s(])(?:' + escaped(root + path.sep) + ')?' +
      escaped(file) + ':(\\d{1,7}):(\\d{1,6})(?=$|[\\s)])', 'g');
    for (let index = 0; index < Math.min(texts.length, 16); index += 1) {
      const text = own(texts, String(index));
      if (typeof text !== 'string') continue;
      if (text.length > 16385) result.truncated = true;
      for (const match of text.slice(0, 16385).matchAll(expression)) {
        if (result.observed_frames >= 64) { result.truncated = true; return result; }
        result.observed_frames += 1;
        add(result, frame(file, Number(match[1]), Number(match[2])));
      }
    }
  }
  return result;
}

function fromSymbolicatedStack(stack) {
  const result = { ...fresh(), capture_status: 'INVALID_STACK' };
  if (!Array.isArray(stack)) return result;
  result.capture_status = stack.length > 64 ? 'STACK_LIMIT_EXCEEDED' : 'NO_PUBLIC_SOURCE_FRAMES';
  result.truncated = stack.length > 64;
  for (let index = 0; index < Math.min(stack.length, 64); index += 1) {
    result.observed_frames += 1;
    const value = own(stack, String(index));
    if (!value || typeof value !== 'object' || Array.isArray(value)) { add(result, null); continue; }
    const column = own(value, 'column');
    // Pinned Metro symbolicate.js returns line1Based and column0Based.
    add(result, frame(own(value, 'file'), own(value, 'lineNumber'),
      Number.isSafeInteger(column) && column >= 0 ? column + 1 : null));
  }
  if (result.source_frames.length && stack.length <= 64) result.capture_status = 'OBSERVED';
  return result;
}

module.exports = { startupPaths, fromText, fromSymbolicatedStack };
