'use strict';
// Internal readiness probe only. Never print certificates, keys, argv or raw errors.
const fs = require('node:fs');
const path = require('node:path');

function category(error) {
  const text = Buffer.concat([Buffer.from(String(error?.message || '').slice(0, 4096)),
    Buffer.isBuffer(error?.stderr) ? error.stderr.subarray(0, 8192) : Buffer.alloc(0)]).toString();
  if (/unknown (?:option|flag)|unrecognized (?:option|flag)|unsupported option|illegal option/i.test(text)) return 'OPENSSL_OPTION_UNSUPPORTED';
  if (error?.code === 'ENOENT') return 'REQUIRED_FILE_OR_TOOL_MISSING';
  if (['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL'].includes(error?.code)) return 'LOOPBACK_LISTEN_FAILED';
  if (typeof error?.status === 'number') return 'OPENSSL_COMMAND_FAILED';
  return 'FIXTURE_INITIALIZATION_FAILED';
}

async function probe() {
  if (process.argv.length !== 2 || !process.env.TMPDIR ||
      fs.realpathSync(process.env.TMPDIR) !== path.resolve(process.env.TMPDIR)) throw Error('PROBE_CONTEXT');
  let matrix, result = { schema: 1, scope: 'HOST_FIXTURE_READINESS_ONLY_NOT_NATIVE_ACCEPTANCE',
    readiness: 'FAIL', cleanup: 'NOT_RUN', error_category: null, native_acceptance: false };
  try {
    // Bootstrap imports expose category only; app fixtures load at actual execution.
    const { createMatrix } = require('./r52_tls_fixture.cjs');
    matrix = await createMatrix('IOS');
    const cases = matrix.config.cases, ports = matrix.ports;
    if (matrix.config.schema !== 1 || matrix.config.platform !== 'IOS' || cases.length !== 25 ||
        cases.some(row => row.host !== '127.0.0.1') ||
        !Array.isArray(ports) || new Set(ports).size !== ports.length ||
        ports.some(port => !Number.isInteger(port) || port < 1025 || port > 65535)) throw Error('PROBE_MATRIX');
    result.readiness = 'PASS'; result.case_count = cases.length;
    result.loopback_listener_count = ports.length;
  } catch (error) { result.error_category = category(error); }
  finally {
    if (matrix) {
      try { await matrix.close(); result.cleanup = 'PASS'; }
      catch { result.cleanup = 'FAIL'; result.readiness = 'FAIL'; result.error_category = 'FIXTURE_CLOSE_FAILED'; }
    }
  }
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.readiness === 'PASS' && result.cleanup === 'PASS' ? 0 : 1;
}
module.exports = { category };
if (require.main === module) probe().catch(() => {
  process.stdout.write(JSON.stringify({ schema: 1, readiness: 'FAIL', cleanup: 'NOT_RUN',
    error_category: 'PROBE_CONTEXT_REJECTED', native_acceptance: false }) + '\n');
  process.exitCode = 1;
});
