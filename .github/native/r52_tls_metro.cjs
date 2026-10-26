// Only the isolated TLS native runner selects this entrypoint.
const path = require('node:path');
const base = require('../../metro.config');
const enhance = base.server?.enhanceMiddleware;
module.exports = { ...base, projectRoot: path.resolve(__dirname, '../..'), server: {
  ...base.server, enhanceMiddleware(middleware, server) {
    const inner = enhance ? enhance(middleware, server) : middleware;
    return (req, res, next) => {
      req.url = req.url.replace(/^\/index\.(bundle|map)(?=\?|$)/, '/.github/native/r52_tls_probe.$1');
      return inner(req, res, next);
    };
  },
} };
