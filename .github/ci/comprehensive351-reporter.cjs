'use strict';
// Node's actual test-runner event stream; no callback interception or test stubs.
module.exports = async function* reporter(source) {
  for await (const event of source) {
    const d = event.data || {};
    if (['test:pass', 'test:fail', 'test:summary', 'test:diagnostic'].includes(event.type)) {
      yield JSON.stringify({ type: event.type, name: d.name, file: d.file,
        nesting: d.nesting, testNumber: d.testNumber, skip: d.skip, todo: d.todo,
        details: d.details && { duration_ms: d.details.duration_ms,
          error: d.details.error && { message: d.details.error.message,
            code: d.details.error.code, failureType: d.details.error.failureType } },
        message: d.message, counts: d.counts, success: d.success }) + '\n';
    }
  }
};
