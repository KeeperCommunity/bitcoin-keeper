'use strict';

// Supported React Native CLI custom reporter; forward its normal TerminalReporter.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fromText } = require('./startup_source_frames.cjs');
const output = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'keeper-native-private', 'startup-observer.jsonl');
let rows = 0;
function emit(row) {
  if (process.env.KEEPER_STARTUP_OBSERVER_PATH !== output || rows >= 512) return;
  try {
    fs.appendFileSync(output, JSON.stringify({ time_ms: Date.now(), ...row }) + '\n', { mode: 0o600 });
    rows += 1;
  } catch (_) { /* Observation cannot change Metro behavior. */ }
}
const enumeration = (value, allowed) => value == null ? null : allowed.includes(value) ? value : 'OTHER';
function failure(error) {
  const message = String(error && error.message || '');
  return {
    error_type: enumeration(error && (error.type || error.name), ['SyntaxError', 'TypeError', 'ReferenceError', 'RangeError', 'TransformError', 'UnableToResolveError', 'ResolutionError', 'AmbiguousModuleResolutionError', 'NotFoundError', 'ResourceNotFoundError', 'GraphNotFoundError', 'RevisionNotFoundError']),
    categories: [
      ['MODULE_RESOLUTION', /unable to resolve|cannot find module|module not found/i],
      ['SYNTAX', /syntaxerror|unexpected token|syntax error/i],
      ['TYPE', /typeerror/i], ['REFERENCE', /referenceerror/i],
      ['MEMORY', /heap out of memory|allocation failed/i],
      ['TRANSFORM', /transformerror|transform failed|babel.*error/i],
      ['CONNECTION', /econnrefused|connection refused|socket hang up/i],
    ].filter(([, pattern]) => pattern.test(message)).map(([name]) => name),
  };
}
// These identifiers come from the app's checked-in startup source or pinned
// native packages. Only these fixed codes/names and source coordinates leave
// the observer; console data, messages and stacks never do.
const runtimeCodes = [
  ['NATIVE_REGISTRY_MODULE_MISSING', /TurboModuleRegistry(?:\.getEnforcing)?[\s\S]{0,240}(?:could not be found|not found)/i],
  ['NATIVE_EVENT_EMITTER_NULL', /NativeEventEmitter[\s\S]{0,40}(?:requires a non-null argument|cannot be null)/i],
  ['APP_NOT_REGISTERED', /(?:hexa_keeper|Application)[\s\S]{0,80}(?:has not been registered|not registered)/i],
  ['REACT_INVALID_HOOK_CALL', /Invalid hook call/i],
  ['REACT_INVALID_ELEMENT', /Element type is invalid/i],
  ['REDUX_PROVIDER_MISSING', /could not find react-redux context value/i],
  ['GLOBAL_BUFFER_MISSING', /(?:Property\s+['"]?Buffer['"]?\s+doesn.t exist|\bBuffer is not defined)/i],
  ['GLOBAL_PROCESS_MISSING', /(?:Property\s+['"]?process['"]?\s+doesn.t exist|\bprocess is not defined)/i],
  ['GLOBAL_CRYPTO_MISSING', /(?:Property\s+['"]?crypto['"]?\s+doesn.t exist|\bcrypto is not defined|crypto\.getRandomValues\(\) not supported)/i],
  ['REALM_NATIVE_BINDING_MISSING', /Could not find[\s\S]{0,80}Realm binary|Failed to load[\s\S]{0,80}Realm|Realm[\s\S]{0,80}native[\s\S]{0,80}(?:not found|missing)/i],
  ['FIREBASE_DEFAULT_APP_MISSING', /No Firebase App[\s\S]{0,120}has been created|Default FirebaseApp is not initialized/i],
  ['MMKV_INITIALIZATION_FAILED', /(?:Failed to create|Failed to initialize)[\s\S]{0,80}MMKV/i],
  ['IAP_INITIALIZATION_FAILED', /Failed to initialize IAP connection:/i],
  ['NITRO_BINDING_MISSING', /NitroModules[\s\S]{0,120}(?:not found|not installed|not available|could not)|Nitro runtime not installed yet|Failed to install Nitro:/i],
];
const nativeModules = ['RNKeychainManager', 'ReactNativeConfigModule', 'RNGetRandomValues',
  'ReanimatedModule', 'RNGestureHandlerModule', 'RNCSafeAreaContext', 'RNFBAppModule',
  'RNFBMessagingModule', 'RNDeviceInfo', 'ReactNativeBiometrics', 'RNFSManager', 'Hce', 'NitroModules'];
const own = (object, key) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch (_) { return undefined; }
};
function runtimeFailure(event) {
  const result = { error_type: null, categories: [], diagnostic_codes: [], native_modules: [],
    source_frames: [], data_truncated: false, invalid_data: false,
    items_scanned: 0, unclassified_items: 0 };
  const values = Array.isArray(event.data) ? event.data :
    event.type === 'unstable_server_log' && typeof event.data === 'string' ? [event.data] : null;
  if (!values) { result.invalid_data = true; return result; }
  if (values.length > 16) result.data_truncated = true;
  const texts = [];
  for (let index = 0; index < Math.min(values.length, 16); index += 1) {
    const value = own(values, String(index));
    result.items_scanned += 1;
    let message, stack, name;
    if (typeof value === 'string') message = value;
    else if (value !== null && typeof value === 'object') {
      message = own(value, 'message'); stack = own(value, 'stack'); name = own(value, 'name');
    }
    if (typeof message !== 'string' && typeof stack !== 'string') {
      result.unclassified_items += 1; continue;
    }
    const bounded = (text) => {
      if (typeof text !== 'string') return '';
      if (text.length > 8192) result.data_truncated = true;
      return text.slice(0, 8192);
    };
    const text = [bounded(message), bounded(stack)].join('\n');
    const detail = failure({ message: text, name });
    if (['Error', 'Invariant Violation', 'EvalError', 'URIError', 'AggregateError'].includes(name)) detail.error_type = name;
    const errorMatch = /\b(SyntaxError|TypeError|ReferenceError|RangeError|EvalError|URIError|AggregateError|Error)\b/.exec(text);
    if ((!detail.error_type || detail.error_type === 'OTHER') && errorMatch) detail.error_type = errorMatch[1];
    const codes = runtimeCodes.filter(([, pattern]) => pattern.test(text)).map(([code]) => code);
    const modules = nativeModules.filter(module => new RegExp(
      '(?:[\'"`]|NativeModules\\.)' + module + '(?:[\'"`]|\\b)').test(text));
    if ((!detail.error_type || detail.error_type === 'OTHER') && detail.categories.length === 0 && codes.length === 0 && modules.length === 0) {
      result.unclassified_items += 1;
    }
    if (!result.error_type || result.error_type === 'OTHER' || result.error_type === 'Error') {
      result.error_type = detail.error_type || result.error_type;
    }
    for (const [key, entries] of [['categories', detail.categories], ['diagnostic_codes', codes], ['native_modules', modules]]) {
      for (const entry of entries) if (!result[key].includes(entry)) result[key].push(entry);
    }
    texts.push(text);
  }
  const frames = fromText(texts);
  result.source_frames = frames.source_frames;
  result.data_truncated ||= frames.truncated;
  return result;
}

class StartupReporter {
  constructor(terminal) {
    // Resolve from the app's CLI plugin, matching runServer even with nested Metros.
    const { createRequire } = require('node:module');
    const fromReactNative = createRequire(require.resolve('react-native/package.json'));
    const fromCLI = createRequire(fromReactNative.resolve('@react-native/community-cli-plugin/package.json'));
    const { TerminalReporter } = fromCLI('metro');
    this.original = new TerminalReporter(terminal);
  }
  update(event) {
    try {
      if (['bundle_build_started', 'bundle_build_done', 'bundle_build_failed'].includes(event.type)) {
        const details = event.bundleDetails || {};
        emit({ kind: 'BUILD', event: event.type,
          platform: enumeration(details.platform, ['android', 'ios']),
          dev: typeof details.dev === 'boolean' ? details.dev : null,
          minify: typeof details.minify === 'boolean' ? details.minify : null,
        });
      } else if (['bundling_error', 'initialize_failed', 'transformer_load_failed', 'hmr_client_error', 'cache_read_error', 'cache_write_error'].includes(event.type)) {
        emit({ kind: 'ERROR', event: event.type, ...failure(event.error) });
      } else if (['client_log', 'unstable_server_log'].includes(event.type)) {
        emit({ kind: 'CONSOLE', event: event.type,
          level: enumeration(event.level, ['trace', 'info', 'warn', 'error', 'log', 'group', 'groupCollapsed', 'groupEnd', 'debug']),
          ...runtimeFailure(event) });
      } else if (event.type === 'worker_stderr_chunk') {
        emit({ kind: 'ERROR', event: event.type, ...failure({ message: event.chunk }) });
      }
    } catch (_) { /* Do not interfere with reporting. */ }
    return this.original.update(event);
  }
  static record(row) { emit(row); }
}
module.exports = StartupReporter;
