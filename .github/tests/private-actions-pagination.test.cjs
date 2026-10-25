'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { authenticatePrivateActionsOrigins } = require('../native/private_actions_origin.cjs');
const { fixture } = require('./fixtures/private-actions.cjs');
function pagedFixture(change = () => {}) {
  const f = fixture(); f.pages = [];
  f.github.rest.actions.listWorkflowRuns = async args => {
    f.pages.push({ head: args.head_sha, page: args.page });
    assert.equal(args.per_page, 100);
    const actual = f.lists[args.head_sha][0], offset = actual.id === 1001 ? 0 : 150;
    const all = [...Array.from({ length: 150 }, (_, i) => ({ ...actual, id: offset + i + 1,
      status: 'completed', conclusion: 'failure' })), actual];
    const data = { total_count: all.length, workflow_runs: all.slice((args.page - 1) * 100, args.page * 100) };
    const response = { status: 200, headers: args.page === 1 ? { link: '<https://ignored.invalid/>; rel="next"' } : {}, data };
    change(response, args, f); return response;
  };
  return f;
}
test('origin reads every bounded page without following the supplied URL or filtering earlier failures', async () => {
  const f = pagedFixture(), proof = await authenticatePrivateActionsOrigins(f.github, f.expected, { clock: () => f.now });
  assert.equal(proof.platforms.IOS.descriptor.execution.runId, 1001);
  assert.equal(f.pages.filter(row => row.page === 1).length, f.pages.filter(row => row.page === 2).length);
  assert(f.pages.some(row => row.page === 2));
});
for (const [name, mutate] of Object.entries({
  changedCount: (r, a) => { if (a.page === 2) r.data.total_count++; },
  duplicate: (r, a) => { if (a.page === 2) r.data.workflow_runs[0].id = 1; },
  missingContinuation: (r, a) => { if (a.page === 1) r.headers = {}; },
  extraContinuation: (r, a) => { if (a.page === 2) r.headers = { link: '<x>; rel="next"' }; },
  excessiveCount: r => r.data.total_count = 1001,
  emptyPage: r => r.data.workflow_runs = [],
})) test(`bounded pagination rejects ${name} without issuing an origin`, async () => {
  const f = pagedFixture(mutate);
  await assert.rejects(authenticatePrivateActionsOrigins(f.github, f.expected, { clock: () => f.now }),
    /^Error: PRIVATE_ACTIONS_API_INCOMPLETE$/);
});
