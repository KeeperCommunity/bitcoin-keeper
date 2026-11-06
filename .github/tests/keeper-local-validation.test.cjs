const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflowPath = path.join(__dirname, '..', 'workflows', 'keeper-local-validation.yml');
const lines = fs.readFileSync(workflowPath, 'utf8').split(/\r?\n/);
const scriptStart = lines.findIndex(line => line.trim() === 'script: |');
assert.notEqual(scriptStart, -1, 'workflow must contain an inline github-script');
const script = lines.slice(scriptStart + 1).map(line =>
  line.startsWith('            ') ? line.slice(12) : line
).join('\n');
const runWorkflow = new (Object.getPrototypeOf(async function () {}).constructor)(
  'github', 'context', 'core', script
);

const sha = 'b78b480eb4223390b2d17073387f9887d2e35f95';
const baseSha = 'a'.repeat(40);
const runBaseSha = 'c'.repeat(40);
const repository = 'KeeperCommunity/bitcoin-keeper';
const repositoryId = 470904030;
const headRef = 'codex/example-change';
const nativeWorkflowPath = '.github/workflows/keeper-hosted-native.yml';
const prNumber = 7045;
const comment = (body, login) => ({ body, user: { login } });
const handoff = (head = sha, checks = 'IOS, ANDROID, HARDWARE') => comment(
  `## Codex local handoff\nState: NEEDS_LOCAL\nHead commit: ${head}\nRequired local checks: ${checks}`,
  'cloud-writer'
);
const decision = (overrides = {}, login = 'antuz123') => comment(
  `## Codex local scope decision
State: ${overrides.state ?? 'OWNER_DEFERRED_PHYSICAL'}
PR: ${overrides.pr ?? '#7045'}
Head commit: ${overrides.head ?? sha}
Deferred local checks: ${overrides.checks ?? 'HARDWARE'}
Reason: ${overrides.reason ?? 'owner-directed post-release physical testing'}
Post-release follow-up: ${overrides.followup ?? 'owner tests physical phones and signers after release'}`,
  login
);
const report = (overrides = {}) => comment(
  `## Codex local validation
State: ${overrides.state || 'LOCAL_PASSED'}
Tested commit: ${overrides.head || sha}
iOS build/simulator: ${overrides.ios || 'PASS for tested development subset'}
Android build/emulator: ${overrides.android || 'PASS for tested development subset'}
Real devices/signers: ${overrides.hardware || 'NOT RUN / POST-RELEASE by owner decision'}`,
  'local-writer'
);

const hostedRun = (overrides = {}) => ({
  id: 90,
  workflow_id: 123,
  path: nativeWorkflowPath,
  head_sha: sha,
  head_branch: headRef,
  head_repository: { full_name: repository, id: repositoryId },
  repository: { full_name: repository, id: repositoryId },
  event: 'pull_request',
  status: 'completed',
  conclusion: 'success',
  run_attempt: 2,
  html_url: `https://github.com/${repository}/actions/runs/90`,
  pull_requests: [{
    number: prNumber,
    head: { sha, ref: headRef, repo: { id: repositoryId } },
    base: { sha: runBaseSha, ref: 'sprint', repo: { id: repositoryId } }
  }],
  ...overrides
});
const hostedJob = (platform, overrides = {}) => ({
  name: platform === 'IOS' ? 'Hosted iOS simulator' : 'Hosted Android emulator',
  head_sha: sha,
  run_id: 90,
  run_attempt: 2,
  status: 'completed',
  conclusion: 'success',
  steps: ['Build development app', 'Run disposable startup smoke'].map(name => ({
    name, status: 'completed', conclusion: 'success'
  })),
  ...overrides
});
const trustedTree = () => ({
  truncated: false,
  tree: [
    { path: nativeWorkflowPath, mode: '100644', type: 'blob', sha: '1'.repeat(40) },
    { path: '.github/native', mode: '040000', type: 'tree', sha: '2'.repeat(40) },
    { path: '.github/native/smoke.yaml', mode: '100644', type: 'blob', sha: '3'.repeat(40) },
    { path: '.github/native/build.sh', mode: '100755', type: 'blob', sha: '4'.repeat(40) },
    { path: 'src/App.tsx', mode: '100644', type: 'blob', sha: '5'.repeat(40) }
  ]
});
const hostedOptions = (overrides = {}) => ({
  runs: [hostedRun()], jobs: [hostedJob('IOS'), hostedJob('ANDROID')], ...overrides
});

async function evaluate(comments, options = {}) {
  const filesRoute = () => {};
  const commentsRoute = () => {};
  const runsRoute = () => {};
  const jobsRoute = () => {};
  const statuses = [];
  const failures = [];
  const warnings = [];
  const calls = [];
  const pullsRequested = [];
  let pullReads = 0;
  const github = {
    paginate: async (route, args) => {
      calls.push({ route, args });
      if (route === filesRoute) return options.files || [{ filename: 'src/App.tsx' }];
      if (route === commentsRoute) return comments;
      if (route === runsRoute) {
        if (options.runsError) throw new Error(options.runsError);
        return [...(options.runs || [])];
      }
      if (route === jobsRoute) {
        if (options.jobsError) throw new Error(options.jobsError);
        return options.jobsByRun?.[args.run_id] || options.jobs || [];
      }
      throw new Error('Unexpected paginate route');
    },
    rest: {
      pulls: {
        get: async ({ pull_number }) => {
          pullsRequested.push(pull_number);
          pullReads += 1;
          return { data: {
            base: { ref: options.baseRef || 'sprint', sha: baseSha,
              repo: { full_name: repository, id: repositoryId } },
            head: { sha: pullReads > 1 && options.afterHead ? options.afterHead : options.head || sha,
              ref: headRef, repo: options.headRepository || { full_name: repository, id: repositoryId } },
            body: options.body || '', user: { login: 'cloud-writer' },
            html_url: `https://github.com/${repository}/pull/${pull_number}`
          } };
        },
        listFiles: filesRoute
      },
      actions: { listWorkflowRuns: runsRoute, listJobsForWorkflowRunAttempt: jobsRoute },
      git: {
        getTree: async ({ tree_sha }) => {
          if (options.treeErrors?.includes(tree_sha)) throw new Error('Tree unavailable');
          return { data: options.trees?.[tree_sha] || trustedTree() };
        }
      },
      issues: { listComments: commentsRoute },
      repos: {
        getCollaboratorPermissionLevel: async ({ username }) => ({ data: {
          permission: options.permissions?.[username] ??
            (['cloud-writer', 'local-writer', 'antuz123', 'other-writer']
              .includes(username) ? 'write' : 'read')
        } }),
        createCommitStatus: async status => { statuses.push(status); }
      }
    }
  };
  const context = { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' },
    issue: { number: prNumber }, payload: {}, ...options.context };
  const core = { info: () => {}, warning: text => warnings.push(text),
    setFailed: text => failures.push(text) };
  await runWorkflow(github, context, core);
  assert.equal(statuses.length, options.afterHead || options.baseRef ? 0 : 1);
  return { status: statuses[0], statuses, failures, warnings, calls, pullsRequested,
    runsCalls: calls.filter(c => c.route === runsRoute),
    jobsCalls: calls.filter(c => c.route === jobsRoute) };
}

test('current requirements still fail without an owner decision', async () => {
  const { status } = await evaluate([handoff(), report()]);
  assert.equal(status.state, 'failure');
  assert.equal(status.description, 'Missing local PASS: HARDWARE');
});

test('exact-SHA owner deferral passes only with a later honest local report', async () => {
  const { status, failures } = await evaluate([handoff(), decision(), report()]);
  assert.equal(status.state, 'success');
  assert.match(status.description, /Validated at current SHA: IOS, ANDROID; owner-deferred HARDWARE/);
  assert.equal(failures.length, 0);
});

test('a report before the scope decision must be refreshed', async () => {
  const { status } = await evaluate([handoff(), report(), decision()]);
  assert.equal(status.state, 'failure');
  assert.equal(status.description, 'Missing local PASS: HARDWARE');
});

test('a write collaborator other than the release owner cannot defer hardware', async () => {
  const { status } = await evaluate([handoff(), decision({}, 'other-writer'), report()]);
  assert.equal(status.state, 'failure');
  assert.equal(status.description, 'Missing local PASS: HARDWARE');
});

test('the release owner must still have repository write permission', async () => {
  const { status } = await evaluate([handoff(), decision(), report()],
    { permissions: { antuz123: 'read' } });
  assert.equal(status.state, 'failure');
  assert.equal(status.description, 'Missing local PASS: HARDWARE');
});

test('a stale or wrongly scoped owner decision cannot defer the current PR head', async () => {
  for (const change of [{ head: 'a'.repeat(40) }, { pr: '#7046' },
    { checks: 'IOS, ANDROID, HARDWARE' }, { reason: '' }, { followup: '' }]) {
    const { status } = await evaluate([handoff(), decision(change), report()]);
    assert.equal(status.state, 'failure');
    assert.equal(status.description, 'Missing local PASS: HARDWARE');
  }
});

test('a later handoff cannot erase an earlier HARDWARE requirement', async () => {
  const { status } = await evaluate([handoff(), handoff(sha, 'IOS, ANDROID'), report()]);
  assert.equal(status.state, 'failure');
  assert.equal(status.description, 'Missing local PASS: HARDWARE');
});

test('a later owner decision can revoke physical deferral', async () => {
  const { status } = await evaluate([handoff(), decision(),
    decision({ state: 'OWNER_REQUIRES_PRE_RELEASE' }), report()]);
  assert.equal(status.state, 'failure');
  assert.equal(status.description, 'Missing local PASS: HARDWARE');
});

test('failed hardware and missing iOS/Android PASS cannot be deferred', async () => {
  const failedHardware = await evaluate([handoff(), decision(),
    report({ hardware: 'FAIL: signer address mismatch' })]);
  assert.equal(failedHardware.status.state, 'failure');
  assert.equal(failedHardware.status.description, 'Missing local PASS: HARDWARE');
  const missingIos = await evaluate([handoff(), decision(),
    report({ ios: 'NOT RUN' })]);
  assert.equal(missingIos.status.state, 'failure');
  assert.equal(missingIos.status.description, 'Missing local PASS: IOS');
});

test('hardware-only handoff cannot turn into a no-test success', async () => {
  const { status } = await evaluate([handoff(sha, 'HARDWARE'), decision(), report()]);
  assert.equal(status.state, 'failure');
  assert.equal(status.description, 'IOS or ANDROID required before HARDWARE deferral');
});

test('a new PR head invalidates both handoff and owner decision', async () => {
  const { status } = await evaluate([handoff(), decision(), report()],
    { head: 'b'.repeat(40) });
  assert.equal(status.state, 'failure');
  assert.equal(status.description, 'Trusted Cloud handoff for current SHA required');
});

test('trusted exact-head hosted smoke passes both platforms without a local attestation', async () => {
  const result = await evaluate([handoff(sha, 'IOS, ANDROID')], hostedOptions());
  assert.equal(result.status.state, 'success');
  assert.match(result.status.description, /hosted IOS, ANDROID/);
  assert.equal(result.status.sha, sha);
  assert.equal(result.failures.length, 0);
  assert.deepEqual(result.runsCalls[0].args, {
    owner: 'KeeperCommunity', repo: 'bitcoin-keeper', workflow_id: 'keeper-hosted-native.yml',
    head_sha: sha, event: 'pull_request', per_page: 100
  });
  assert.equal(result.jobsCalls[0].args.attempt_number, 2);
});

test('successful hosted Android can combine with local iOS when hosted iOS fails', async () => {
  const { status } = await evaluate([
    handoff(sha, 'IOS, ANDROID'), report({ android: 'NOT RUN' })
  ], hostedOptions({
    runs: [hostedRun({ conclusion: 'failure' })],
    jobs: [hostedJob('IOS', { conclusion: 'failure' }), hostedJob('ANDROID')]
  }));
  assert.equal(status.state, 'success');
  assert.match(status.description, /hosted ANDROID/);
});

test('one platform success cannot satisfy the other platform', async () => {
  const { status } = await evaluate([handoff(sha, 'IOS, ANDROID')], hostedOptions({
    jobs: [hostedJob('ANDROID')]
  }));
  assert.equal(status.state, 'failure');
  assert.match(status.description, /IOS/);
});

test('hosted platform passes do not satisfy physical hardware checks', async () => {
  const { status } = await evaluate([handoff()], hostedOptions());
  assert.equal(status.state, 'failure');
  assert.equal(status.description, 'Missing local PASS: HARDWARE');
});

test('hosted passes can fill unrun platforms while exact owner rules defer hardware', async () => {
  const { status } = await evaluate([handoff(), decision(),
    report({ ios: 'NOT RUN', android: 'NOT RUN' })], hostedOptions());
  assert.equal(status.state, 'success');
  assert.match(status.description, /hosted IOS, ANDROID; owner-deferred HARDWARE/);
});

test('hosted success cannot waive hardware failures or remove later-report requirements', async () => {
  for (const comments of [
    [handoff(), decision()],
    [handoff(), report(), decision()],
    [handoff(), decision(), report({ hardware: 'FAIL: incorrect signer address' })],
    [handoff(), decision({}, 'other-writer'), report()]
  ]) {
    const { status } = await evaluate(comments, hostedOptions());
    assert.equal(status.state, 'failure');
    assert.match(status.description, /HARDWARE/);
  }
});

test('latest trusted local failure or blocked report cannot be hidden by hosted passes', async () => {
  for (const state of ['LOCAL_FAILED', 'BLOCKED']) {
    const { status } = await evaluate([handoff(sha, 'IOS, ANDROID'),
      report(), report({ state })], hostedOptions());
    assert.equal(status.state, 'failure');
    assert.equal(status.description, 'Latest local validation is not LOCAL_PASSED');
  }
});

test('explicit local platform failures cannot be relabeled as passed by hosted results', async () => {
  for (const failedField of ['ios', 'android']) {
    const { status } = await evaluate([handoff(sha, 'IOS, ANDROID'),
      report({ [failedField]: 'FAIL: reproducible startup crash' })], hostedOptions());
    assert.equal(status.state, 'failure', failedField);
  }
});

test('hosted passes still require a trusted current-head Cloud handoff', async () => {
  for (const comments of [[], [handoff('d'.repeat(40), 'IOS, ANDROID')],
    [comment(handoff(sha, 'IOS, ANDROID').body, 'read-only-user')]]) {
    const result = await evaluate(comments, hostedOptions());
    assert.equal(result.status.state, 'failure');
    assert.equal(result.runsCalls.length, 0);
  }
});

test('reject hosted runs with stale, wrong, missing or untrusted identity metadata', async () => {
  const badRuns = [
    { head_sha: 'd'.repeat(40) },
    { head_branch: 'other-branch' },
    { head_repository: { full_name: 'attacker/bitcoin-keeper', id: 1 } },
    { path: '.github/workflows/build-only.yml' },
    { event: 'push' },
    { event: 'pull_request_target' },
    { pull_requests: [] },
    { pull_requests: [{ ...hostedRun().pull_requests[0], number: prNumber + 1 }] },
    { pull_requests: [{ ...hostedRun().pull_requests[0],
      head: { sha: 'd'.repeat(40), ref: headRef, repo: { id: repositoryId } } }] },
    { pull_requests: [{ ...hostedRun().pull_requests[0],
      base: { ref: 'sprint', repo: { id: repositoryId } } }] },
    { run_attempt: 0 },
    { run_attempt: '2' }
  ];
  for (const change of badRuns) {
    const { status } = await evaluate([handoff(sha, 'IOS, ANDROID')],
      hostedOptions({ runs: [hostedRun(change)] }));
    assert.equal(status.state, 'failure', JSON.stringify(change));
  }
});

test('reject hosted evidence whose recorded PR association has wrong refs or repositories', async () => {
  const original = hostedRun().pull_requests[0];
  for (const change of [
    { base: { ...original.base, ref: 'dev' } },
    { base: { ...original.base, repo: { id: 1 } } },
    { head: { ...original.head, ref: 'other-branch' } },
    { head: { ...original.head, repo: { id: 1 } } }
  ]) {
    const { status } = await evaluate([handoff(sha, 'IOS, ANDROID')],
      hostedOptions({ runs: [hostedRun({ pull_requests: [{ ...original, ...change }] })] }));
    assert.equal(status.state, 'failure', JSON.stringify(change));
  }
});

test('fork-hosted runs retain local fallback but cannot supply trusted hosted evidence', async () => {
  const options = hostedOptions({ headRepository: { full_name: 'contributor/bitcoin-keeper', id: 1 } });
  const hostedOnly = await evaluate([handoff(sha, 'IOS, ANDROID')], options);
  assert.equal(hostedOnly.status.state, 'failure');
  const local = await evaluate([handoff(sha, 'IOS, ANDROID'), report()], options);
  assert.equal(local.status.state, 'success');
});

test('hosted CI requires matching workflow and entire native harness in source and both bases', async () => {
  for (const ref of [sha, baseSha, runBaseSha]) {
    for (const mutation of ['workflow', 'smoke', 'add', 'delete', 'mode']) {
      const tree = trustedTree();
      if (mutation === 'workflow') tree.tree[0].sha = 'f'.repeat(40);
      if (mutation === 'smoke') tree.tree[2].sha = 'f'.repeat(40);
      if (mutation === 'add') tree.tree.push({
        path: '.github/native/extra.sh', mode: '100755', type: 'blob', sha: 'f'.repeat(40)
      });
      if (mutation === 'delete') tree.tree.splice(2, 1);
      if (mutation === 'mode') tree.tree[3].mode = '100644';
      const { status } = await evaluate([handoff(sha, 'IOS, ANDROID')],
        hostedOptions({ trees: { [ref]: tree } }));
      assert.equal(status.state, 'failure', `${ref}: ${mutation}`);
    }
  }
});

test('unrelated source changes do not invalidate immutable hosted CI definitions', async () => {
  const tree = trustedTree();
  tree.tree[4].sha = 'f'.repeat(40);
  const { status } = await evaluate([handoff(sha, 'IOS, ANDROID')],
    hostedOptions({ trees: { [sha]: tree } }));
  assert.equal(status.state, 'success');
});

test('bootstrap without trusted native infrastructure and truncated trees fail closed', async () => {
  for (const tree of [{ truncated: false, tree: [] },
    { ...trustedTree(), truncated: true },
    { truncated: false, tree: trustedTree().tree.filter(e => e.path !== nativeWorkflowPath) },
    { truncated: false, tree: trustedTree().tree.filter(e => !e.path.startsWith('.github/native/')) }]) {
    const { status } = await evaluate([handoff(sha, 'IOS, ANDROID')],
      hostedOptions({ trees: { [baseSha]: tree } }));
    assert.equal(status.state, 'failure');
  }
});

test('hosted API failures never become a pass and preserve genuine local fallback', async () => {
  for (const failure of [{ runsError: 'Actions unavailable' },
    { jobsError: 'Jobs unavailable' }, { treeErrors: [runBaseSha] }]) {
    const options = hostedOptions(failure);
    const hostedOnly = await evaluate([handoff(sha, 'IOS, ANDROID')], options);
    assert.equal(hostedOnly.status.state, 'failure');
    assert.ok(hostedOnly.warnings.length);
    const local = await evaluate([handoff(sha, 'IOS, ANDROID'), report()], options);
    assert.equal(local.status.state, 'success');
  }
});

test('cancelled, skipped, pending or incomplete hosted runs provide no platform evidence', async () => {
  for (const change of [{ status: 'queued', conclusion: null },
    { status: 'in_progress', conclusion: null }, { conclusion: 'cancelled' },
    { conclusion: 'skipped' }, { conclusion: 'timed_out' }, { conclusion: 'action_required' },
    { conclusion: 'neutral' }, { conclusion: null }]) {
    const { status } = await evaluate([handoff(sha, 'IOS, ANDROID')],
      hostedOptions({ runs: [hostedRun(change)] }));
    assert.equal(status.state, 'failure', JSON.stringify(change));
  }
});

test('a newer failed or pending run supersedes an older successful run regardless of API order', async () => {
  for (const newest of [hostedRun({ id: 91, conclusion: 'cancelled' }),
    hostedRun({ id: 91, status: 'in_progress', conclusion: null }),
    hostedRun({ id: 91, conclusion: 'failure' })]) {
    const { status, jobsCalls } = await evaluate([handoff(sha, 'IOS, ANDROID')], hostedOptions({
      runs: [hostedRun(), newest], jobsByRun: { 91: [] }
    }));
    assert.equal(status.state, 'failure');
    assert.ok(jobsCalls.every(call => call.args.run_id === 91));
  }
});

test('reruns inspect only the newest attempt and do not reuse earlier success', async () => {
  const result = await evaluate([handoff(sha, 'IOS, ANDROID')], hostedOptions({
    runs: [hostedRun({ run_attempt: 3 })], jobs: [hostedJob('IOS'), hostedJob('ANDROID')]
  }));
  assert.equal(result.jobsCalls[0].args.attempt_number, 3);
  assert.equal(result.status.state, 'failure');
});

test('wrong run identity and stale source on jobs cannot satisfy current platform checks', async () => {
  for (const change of [{ head_sha: 'd'.repeat(40) }, { run_id: 89 },
    { run_attempt: 1 }, { status: 'in_progress' }, { conclusion: 'cancelled' },
    { conclusion: 'skipped' }, { conclusion: 'failure' }]) {
    const { status } = await evaluate([handoff(sha, 'IOS')], hostedOptions({
      jobs: [hostedJob('IOS', change)]
    }));
    assert.equal(status.state, 'failure', JSON.stringify(change));
  }
});

test('a build-only job or missing, skipped, cancelled or failed smoke is not native validation', async () => {
  for (const steps of [[], [hostedJob('IOS').steps[0]], [hostedJob('IOS').steps[1]],
    ...['skipped', 'cancelled', 'failure'].map(conclusion => [
      hostedJob('IOS').steps[0], { ...hostedJob('IOS').steps[1], conclusion }
    ]), [hostedJob('IOS').steps[0], { ...hostedJob('IOS').steps[1], status: 'in_progress' }]]) {
    const { status } = await evaluate([handoff(sha, 'IOS')], hostedOptions({
      jobs: [hostedJob('IOS', { steps })]
    }));
    assert.equal(status.state, 'failure', JSON.stringify(steps));
  }
});

test('duplicate platform jobs or required steps do not ambiguously satisfy validation', async () => {
  for (const jobs of [[hostedJob('IOS'), hostedJob('IOS')],
    [hostedJob('IOS', { steps: [...hostedJob('IOS').steps, hostedJob('IOS').steps[1]] })]]) {
    const { status } = await evaluate([handoff(sha, 'IOS')], hostedOptions({ jobs }));
    assert.equal(status.state, 'failure');
  }
});

test('workflow_run routing evaluates the associated PR and refreshes its current head', async () => {
  const routedNumber = 7059;
  const run = hostedRun({ pull_requests: [{ ...hostedRun().pull_requests[0], number: routedNumber }] });
  const result = await evaluate([handoff(sha, 'IOS, ANDROID')], hostedOptions({
    runs: [run], context: { issue: {}, eventName: 'workflow_run', payload: { workflow_run: run } }
  }));
  assert.equal(result.status.state, 'success');
  assert.deepEqual(result.pullsRequested, [routedNumber, routedNumber]);
  assert.match(result.status.target_url, /pull\/7059$/);
});

test('a PR head change during validation prevents posting obsolete success', async () => {
  const result = await evaluate([handoff(sha, 'IOS, ANDROID')], hostedOptions({
    afterHead: 'd'.repeat(40)
  }));
  assert.equal(result.statuses.length, 0);
  assert.match(result.failures[0], /PR head changed/);
});

test('documentation and GitHub metadata exemption never consumes hosted CI assertions', async () => {
  const result = await evaluate([], hostedOptions({ files: [
    { filename: 'AGENTS.md' }, { filename: '.github/workflows/keeper-hosted-native.yml' }
  ] }));
  assert.equal(result.status.state, 'success');
  assert.equal(result.runsCalls.length, 0);
  assert.equal(result.jobsCalls.length, 0);
});

test('hosted workflow lifecycle events refresh the privileged gate under the exact workflow name', () => {
  const nativeWorkflow = fs.readFileSync(path.join(path.dirname(workflowPath),
    'keeper-hosted-native.yml'), 'utf8');
  const name = nativeWorkflow.match(/^name:\s*(.+)$/m)?.[1];
  assert.ok(name, 'hosted workflow must have a name');
  assert.ok(lines.some(line => line.trim() === `workflows: [${name}]`),
    'workflow_run must name the actual hosted workflow');
  assert.ok(lines.some(line => line.trim() === 'types: [completed, requested, in_progress]'),
    'new attempts must invalidate old hosted evidence promptly');
});
