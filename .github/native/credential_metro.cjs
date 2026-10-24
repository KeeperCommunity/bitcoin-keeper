// Only the owned hosted runner starts this config, while the ordinary app is stopped.
const path = require('node:path');
const base = require('../../metro.config');
const phase = process.env.KEEPER_CREDENTIAL_FIXTURE_PHASE;
if (!['arm', 'restore'].includes(phase)) throw new Error('CREDENTIAL_FIXTURE_PHASE_REQUIRED');
const enhance = base.server?.enhanceMiddleware;
module.exports = {
  ...base,
  projectRoot: path.resolve(__dirname, '../..'),
  server: {
    ...base.server,
    enhanceMiddleware(middleware, server) {
      const inner = enhance ? enhance(middleware, server) : middleware;
      return (req, res, next) => {
        req.url = req.url.replace(/^\/index\.(bundle|map)(?=\?|$)/,
          `/.github/native/credential_${phase}.$1`);
        return inner(req, res, next);
      };
    },
  },
};
