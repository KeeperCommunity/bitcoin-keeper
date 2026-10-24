'use strict';

// Supported React Native CLI custom reporter; forward its normal TerminalReporter.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
      } else if (event.type === 'worker_stderr_chunk') {
        emit({ kind: 'ERROR', event: event.type, ...failure({ message: event.chunk }) });
      }
    } catch (_) { /* Do not interfere with reporting. */ }
    return this.original.update(event);
  }
  static record(row) { emit(row); }
}
module.exports = StartupReporter;
