'use strict';
const { parseStrictJson } = require('../.github/native/strict_json.cjs');
const operations = new Set(['ios-submit-review', 'ios-release-approved-version', 'play-production-rollout']);
const hash = /^[a-f0-9]{64}$/, id = /^[1-9]\d{0,18}$/, resource = /^[A-Za-z0-9-]{1,100}$/;
const demand = (ok, code) => { if (!ok) throw new Error(code); };
function parameters(operation, text) {
  demand(operations.has(operation) && typeof text === 'string', 'LIVE_REQUEST_OPERATION');
  const value = parseStrictJson(Buffer.from(text), 4096);
  const fields = ['mode', 'store_snapshot_sha256'];
  if (operation.startsWith('ios-')) fields.push('app_id', 'app_store_version_id', 'build_id');
  if (operation === 'ios-submit-review') fields.push('review_submission_id');
  demand(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(name => typeof value[name] === 'string') &&
    Object.keys(value).every(name => fields.includes(name)), 'LIVE_REQUEST_FIELDS');
  demand(['inspect', 'execute'].includes(value.mode) &&
    (value.mode === 'inspect' ? value.store_snapshot_sha256 === 'pending' : hash.test(value.store_snapshot_sha256)),
  'LIVE_REQUEST_SNAPSHOT');
  for (const name of fields.filter(name => name.endsWith('_id'))) {
    demand((name === 'app_id' ? id : resource).test(value[name]), 'LIVE_REQUEST_RESOURCE_ID');
  }
  return Object.fromEntries(fields.map(name => [name, value[name]]));
}
function providerRequest(request, upload) {
  const p = parameters(request.operation, request.liveParameters);
  const result = Object.fromEntries(['operation', 'sourceSha', 'artifactSha256', 'identitySha256',
    'configSha256', 'version', 'build'].map(name => [name, request[name]]));
  Object.assign(result, { uploadRunId: String(upload.runId), uploadRunAttempt: String(upload.runAttempt),
    storeSnapshotSha256: p.store_snapshot_sha256 });
  for (const [input, output] of Object.entries({ app_id: 'appId', app_store_version_id: 'appStoreVersionId',
    build_id: 'buildId', review_submission_id: 'reviewSubmissionId' })) if (p[input]) result[output] = p[input];
  return result;
}
module.exports = { operations, parameters, providerRequest };
