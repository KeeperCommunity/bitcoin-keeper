'use strict';

// Observe the normal Metro configuration. Never alter requests or response bodies.
const config = require('../../metro.config.js');
const { record: emit } = require('./startup_reporter.cjs');
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
        options.app = query.has('app') ? query.get('app') === 'io.hexawallet.keeper.development' ? 'EXPECTED' : 'OTHER' : null;
        const started = Date.now();
        emit({ kind: 'REQUEST', request: kind, options });
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
