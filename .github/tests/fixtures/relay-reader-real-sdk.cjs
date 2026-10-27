'use strict';
// Runs with github.constructor from the pinned github-script action. Every
// identity and provider response is disposable; no live network or real key.
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const relay = require('../../native/relay_reader_app.cjs');
module.exports = async function verify(Octokit) {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const token = 'ghs_10_' + ['a'.repeat(800), 'b-c_d'.repeat(180), 'z'.repeat(350)].join('.');
  let minted = 0, repoReads = 0;
  const now = Date.now();
  const mockFetch = async (url, init) => {
    const u = new URL(url); let body;
    if (u.pathname === '/app/installations/20') {
      assert.equal(init.redirect, 'error');
      body = { id: 20, app_id: 10, account: { id: 248454494, login: 'KeeperCommunity', type: 'Organization' },
        target_id: 248454494, target_type: 'Organization', repository_selection: 'selected', suspended_at: null,
        suspended_by: null, permissions: { ...relay.PERMISSIONS, metadata: 'read' } };
    } else if (u.pathname === '/app/installations/20/access_tokens') {
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { repository_ids: [relay.REPOSITORY_ID], permissions: relay.PERMISSIONS });
      minted++;
      body = { token, expires_at: new Date(now + 3600000).toISOString(),
        repository_selection: 'selected', permissions: relay.PERMISSIONS };
    } else if (u.pathname === '/installation/repositories') {
      body = { total_count: 1, repositories: [{ id: relay.REPOSITORY_ID, full_name: relay.REPOSITORY, private: true }] };
    } else {
      assert(u.pathname.startsWith('/repos/' + relay.REPOSITORY));
      assert.equal(init.redirect, 'manual'); assert.equal(init.method, 'GET');
      assert.equal(new Headers(init.headers).get('authorization'), 'token ' + token);
      repoReads++;
      body = u.pathname.endsWith('/actions/runs') ? { total_count: 1, workflow_runs: [{ id: 1 }] } :
        { id: relay.REPOSITORY_ID, private: true };
    }
    return new Response(JSON.stringify(body), { status: u.pathname.endsWith('/access_tokens') ? 201 : 200,
      headers: { 'content-type': 'application/json' } });
  };
  const MockOctokit = Octokit.defaults({ request: { fetch: mockFetch } });
  const reader = relay.client(new MockOctokit(), { appId: 10, installationId: 20,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, { fetchImpl: mockFetch, clock: () => now });
  const args = { owner: 'KeeperCommunity', repo: 'bitcoin-keeper-relay' };
  assert.equal((await reader.rest.repos.get(args)).data.id, relay.REPOSITORY_ID);
  assert.equal((await reader.rest.checks.get({ ...args, check_run_id: 9 })).status, 200);
  assert.equal((await reader.rest.repos.getBranch({ ...args, branch: 'codex/nested-branch' })).status, 200);
  assert.equal((await reader.paginate(reader.rest.actions.listWorkflowRunsForRepo, { ...args, per_page: 100 })).length, 1);
  let wire;
  await reader.request('GET https://api.github.com/repos/' + relay.REPOSITORY + '/git/blobs/' + 'a'.repeat(40), {
    request: { parseSuccessResponseBody: false, fetch: async (url, init) => {
      const response = await mockFetch(url, init); wire = Buffer.from(await response.arrayBuffer());
      return new Response(null, { status: 200, headers: { 'content-type': 'application/json' } });
    } } });
  assert.equal(JSON.parse(wire).id, relay.REPOSITORY_ID);
  await assert.rejects(reader.rest.repos.get({ owner: 'KeeperCommunity', repo: 'bitcoin-keeper-private' }),
    /PRIVATE_RELAY_READ_DESTINATION_REJECTED/);
  await assert.rejects(reader.rest.issues.create({ ...args, title: 'must not post' }), /PRIVATE_RELAY_READ_DESTINATION_REJECTED/);
  assert.equal(repoReads, 5); assert.equal(minted, 1); assert.equal((await reader.auth()).token, undefined);
};
