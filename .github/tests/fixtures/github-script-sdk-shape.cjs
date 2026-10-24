'use strict';
// Purpose-written model of the pinned github-script v8 Octokit fetch boundary.
// Audited upstream commit ed597411d8f924073f98dfc5c65a23a2325f34cd, dist/index.js
// Git blob bb06b77b98c6d994acb116b86ce49a064712a240, fetchWrapper lines 9467ff.
// Its fetch init forwards method/body/headers/signal, NOT request.redirect.
// This fixture is fake transport; only the separately approved hosted probe
// can establish actual github-script adapter capability.
async function sdkDownloadArtifact(options, defaultFetch, observe = {}) {
  const url = observe.url || `https://api.github.com/repos/${options.owner}/${options.repo}/actions/artifacts/${options.artifact_id}/${options.archive_format}`;
  const request = options.request || {};
  const response = await (request.fetch || defaultFetch)(url, {
    method: observe.method || 'GET', body: observe.body,
    headers: { authorization: 'Bearer DISPOSABLE_TEST_API_IDENTITY', accept: 'application/vnd.github+json' },
    signal: request.signal,
  });
  // Reproduce the SDK's eager success-body parsing unless explicitly disabled.
  let data;
  if (request.parseSuccessResponseBody === false) data = response.body;
  else { observe.parsedBodies = (observe.parsedBodies || 0) + 1; data = await response.arrayBuffer(); }
  return { status: response.status, headers: Object.fromEntries(response.headers), data };
}
module.exports = { sdkDownloadArtifact };
