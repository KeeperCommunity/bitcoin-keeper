const assert = require('node:assert/strict');
const { test } = require('node:test');
const { evidence } = require('../native/release_evidence.cjs');
function fixture() {
  const repository = 'KeeperCommunity/bitcoin-keeper';
  const pr = { number: 7058, head: { sha: 'a'.repeat(40), ref: 'future-release',
    repo: { full_name: repository, id: 1 } }, base: { sha: 'b'.repeat(40), ref: 'sprint',
    repo: { full_name: repository, id: 1 } } };
  const context = { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' },
    eventName: 'pull_request', runId: 90, payload: { pull_request: pr } };
  const run = { id: 90, run_attempt: 2, path: '.github/workflows/keeper-release-acceptance.yml',
    event: 'pull_request', head_sha: pr.head.sha, head_branch: pr.head.ref,
    head_repository: pr.head.repo, pull_requests: [structuredClone(pr)], status: 'in_progress' };
  const jobs = ['IOS', 'ANDROID'].map(platform => ({
    name: `${platform.toLowerCase()} / Native ${platform} build and probes`, head_sha: pr.head.sha,
    run_id: 90, run_attempt: 2, status: 'completed', conclusion: 'success',
    steps: ['Build development app', ...(platform === 'IOS'
      ? ['Run disposable startup smoke', 'Run disposable native persistence probe']
      : ['Run Android startup and native persistence probes'])].map(name =>
      ({ name, status: 'completed', conclusion: 'success' })),
  }));
  const state = { runs: [run], jobs, context, input: { ios: 'success', android: 'success', attempt: 2 }, calls: [] };
  const runsAPI = () => {}; const jobsAPI = () => {};
  state.github = { rest: { actions: { listWorkflowRuns: runsAPI, listJobsForWorkflowRunAttempt: jobsAPI } },
    paginate: async (api, args) => { state.calls.push(args); if (state.error) throw new Error('private');
      return api === runsAPI ? [...state.runs] : state.jobs; } };
  state.check = () => evidence(state.github, state.context, state.input);
  return state;
}
test('current in-progress summary credits both completed exact-attempt native jobs only', async () => {
  const state = fixture(); assert.equal(await state.check(), true);
  assert.equal(state.calls[1].attempt_number, 2);
  assert.equal(state.calls[0].head_sha, state.context.payload.pull_request.head.sha);
});
test('latest run and attempt prevent summary-only partial reruns and older-run reuse', async () => {
  for (const mutate of [s => { s.jobs.pop(); }, s => { s.jobs[0].run_attempt = 1; },
    s => { s.runs[0].run_attempt = 3; }, s => { s.runs.push({ ...s.runs[0], id: 91 }); }]) {
    const state = fixture(); mutate(state); assert.equal(await state.check(), false);
  }
});
test('wrong source, workflow, event, PR association and repository provide no evidence', async () => {
  for (const mutate of [s => { s.runs[0].head_sha = 'c'.repeat(40); },
    s => { s.runs[0].path = 'other.yml'; }, s => { s.runs[0].event = 'push'; },
    s => { s.runs[0].head_branch = 'other'; }, s => { s.runs[0].head_repository = { id: 9 }; },
    s => { s.runs[0].pull_requests[0].number += 1; },
    s => { s.runs[0].pull_requests[0].base.sha = 'c'.repeat(40); }]) {
    const state = fixture(); mutate(state); assert.equal(await state.check(), false);
  }
});
test('failed/skipped/pending jobs, build-only results and ambiguous steps cannot pass', async () => {
  for (const mutate of [s => { s.jobs[0].conclusion = 'failure'; },
    s => { s.jobs[1].status = 'in_progress'; }, s => { s.jobs[0].steps.pop(); },
    s => { s.jobs[1].steps[1].conclusion = 'skipped'; }, s => { s.jobs.push(s.jobs[0]); },
    s => { s.jobs[0].steps.push(s.jobs[0].steps[0]); }, s => { s.input.android = 'skipped'; },
    s => { s.context.payload.pull_request.number = 7045; },
    s => { s.context.payload.pull_request.head.repo.full_name = 'fork/bitcoin-keeper'; },
    s => { s.runs[0].status = 'queued'; },
    s => { Object.assign(s.runs[0], { status: 'completed', conclusion: 'cancelled' }); }, s => { s.error = true; }]) {
    const state = fixture(); mutate(state); assert.equal(await state.check(), false);
  }
});
