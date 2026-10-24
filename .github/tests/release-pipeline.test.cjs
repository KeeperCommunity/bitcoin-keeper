const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { WORKFLOWS, fingerprint, preflight } = require('../native/release_preflight.cjs');
const { REQUIRED, acceptance, markdown } = require('../native/release_acceptance.cjs');

// GitHub metadata models only: these tests supply no native or release evidence.
const repository = 'KeeperCommunity/bitcoin-keeper';
const repositoryId = 470904030;
const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const runBaseSha = 'c'.repeat(40);
const NATIVE_FILES = [
  'hosted_native.py', 'startup.yaml', 'nodeify.cjs', 'release_preflight.cjs',
  'release_acceptance.cjs', 'release_evidence.cjs', 'release_metro.cjs', 'release_probe.js',
  'release_probe_core.js', 'release_probe.yaml',
].map(name => '.github/native/' + name);
const clone = value => structuredClone(value);

function trustedTree() {
  const paths = [...WORKFLOWS, ...NATIVE_FILES, 'src/index.ts'];
  return {
    truncated: false,
    tree: paths.map((path, index) => ({
      path, mode: '100644', type: 'blob', sha: (index + 1).toString(16).padStart(40, '0'),
    })),
  };
}

function pullRequest() {
  return {
    number: 7058,
    head: { sha: headSha, ref: 'codex/future-release',
      repo: { full_name: repository, id: repositoryId } },
    base: { sha: baseSha, ref: 'sprint',
      repo: { full_name: repository, id: repositoryId } },
  };
}

async function evaluate(options = {}) {
  const original = pullRequest();
  original.base.sha = runBaseSha;
  const current = pullRequest();
  options.original?.(original);
  options.current?.(current);
  const latest = clone(current);
  options.latest?.(latest);
  const calls = [];
  let reads = 0;
  const github = {
    rest: {
      pulls: {
        get: async args => {
          calls.push({ api: 'pulls.get', ...args });
          reads += 1;
          if (options.pullError) throw new Error('Private API detail must not be reported');
          return { data: clone(reads === 1 ? current : latest) };
        },
      },
      git: {
        getTree: async args => {
          calls.push({ api: 'git.getTree', ...args });
          if (options.treeError === args.tree_sha) throw new Error('Private API detail');
          return { data: clone(options.trees?.[args.tree_sha] ?? trustedTree()) };
        },
      },
    },
  };
  const context = {
    eventName: options.eventName ?? 'pull_request',
    repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' },
    payload: { pull_request: options.withoutPR ? undefined : original },
  };
  return { result: await preflight(github, context), calls };
}

test('unchanged reviewed CI on app/current-base/run-base yields exact-head preflight only', async () => {
  const { result, calls } = await evaluate();
  assert.equal(result.trusted, true);
  assert.equal(calls.filter(call => call.api === 'pulls.get').length, 2);
  assert.deepEqual(calls.filter(call => call.api === 'git.getTree').map(call => call.tree_sha),
    [headSha, baseSha, runBaseSha]);
  assert.ok(calls.filter(call => call.api === 'git.getTree').every(call => call.recursive === '1'));
  assert.ok(calls.every(call => !/create|update|dispatch|status/.test(call.api)));
});

test('all later same-repository release PRs use the same preflight without release-number routing', async () => {
  for (const number of [7058, 8001, 12000]) {
    const { result } = await evaluate({
      original: pr => { pr.number = number; },
      current: pr => { pr.number = number; },
    });
    assert.equal(result.trusted, true, String(number));
  }
});

test('R4 is excluded before any API read, even when its source otherwise matches', async () => {
  const { result, calls } = await evaluate({ original: pr => { pr.number = 7045; } });
  assert.equal(result.trusted, false);
  assert.match(result.reason, /R4/);
  assert.deepEqual(calls, []);
});

test('non-PR events and missing PR metadata never trigger native authorization', async () => {
  for (const options of [{ eventName: 'workflow_dispatch' }, { eventName: 'pull_request_target' },
    { eventName: 'push' }, { withoutPR: true }]) {
    const { result, calls } = await evaluate(options);
    assert.equal(result.trusted, false);
    assert.deepEqual(calls, []);
  }
});

test('forks, wrong target branches, stale payloads and repository-ID drift fail before tree reads', async () => {
  const mutations = [
    pr => { pr.head.repo = { full_name: 'fork/bitcoin-keeper', id: 123 }; },
    pr => { pr.base.repo.full_name = 'fork/bitcoin-keeper'; },
    pr => { pr.base.ref = 'other-base'; },
    pr => { pr.head.ref = 'other-head'; },
    pr => { pr.head.sha = 'd'.repeat(40); },
    pr => { pr.head.sha = 'not-a-sha'; },
    pr => { pr.head.repo.id += 1; },
    pr => { pr.base.repo.id += 1; },
    pr => { delete pr.head.repo; },
    pr => { delete pr.base.repo.id; },
  ];
  for (const current of mutations) {
    const { result, calls } = await evaluate({ current });
    assert.equal(result.trusted, false);
    assert.equal(calls.filter(call => call.api === 'git.getTree').length, 0);
  }
});

test('source or base movement while checking provenance cannot receive current-head credit', async () => {
  for (const latest of [pr => { pr.head.sha = 'd'.repeat(40); },
    pr => { pr.base.sha = 'd'.repeat(40); }]) {
    const { result } = await evaluate({ latest });
    assert.equal(result.trusted, false);
    assert.match(result.reason, /changed|provenance/);
  }
});

test('retargeting or repository/ref identity drift at unchanged SHAs is still a race', async () => {
  for (const latest of [pr => { pr.base.ref = 'another-branch-at-same-sha'; },
    pr => { pr.head.ref = 'another-head-at-same-sha'; },
    pr => { pr.base.repo.id += 1; }, pr => { pr.head.repo.id += 1; },
    pr => { pr.base.repo.full_name = 'fork/bitcoin-keeper'; },
    pr => { pr.head.repo.full_name = 'fork/bitcoin-keeper'; }]) {
    const { result } = await evaluate({ latest });
    assert.equal(result.trusted, false);
  }
});

test('every workflow/harness addition, deletion, content, mode or type mutation denies trust in each snapshot', async () => {
  for (const ref of [headSha, baseSha, runBaseSha]) {
    for (const target of [...WORKFLOWS, ...NATIVE_FILES]) {
      for (const mutation of ['content', 'delete', 'mode', 'type']) {
        const tree = trustedTree();
        const index = tree.tree.findIndex(entry => entry.path === target);
        if (mutation === 'content') tree.tree[index].sha = 'f'.repeat(40);
        if (mutation === 'delete') tree.tree.splice(index, 1);
        if (mutation === 'mode') tree.tree[index].mode = '100755';
        if (mutation === 'type') tree.tree[index].type = 'commit';
        const { result } = await evaluate({ trees: { [ref]: tree } });
        assert.equal(result.trusted, false, `${ref}:${target}:${mutation}`);
      }
    }
    const tree = trustedTree();
    tree.tree.push({ path: '.github/native/unreviewed-helper.cjs', mode: '100644',
      type: 'blob', sha: 'f'.repeat(40) });
    assert.equal((await evaluate({ trees: { [ref]: tree } })).result.trusted, false);
  }
});

test('bootstrap is unavailable when any transitive workflow/native dependency is absent from every snapshot', async () => {
  for (const missing of [...WORKFLOWS, ...NATIVE_FILES]) {
    const tree = trustedTree();
    tree.tree = tree.tree.filter(entry => entry.path !== missing);
    const { result } = await evaluate({ trees: {
      [headSha]: tree, [baseSha]: tree, [runBaseSha]: tree,
    } });
    assert.equal(result.trusted, false, missing);
  }
});

test('required infrastructure symlinks cannot move executable dependencies outside the fingerprint', async () => {
  for (const target of [...WORKFLOWS, ...NATIVE_FILES]) {
    const tree = trustedTree();
    tree.tree.find(entry => entry.path === target).mode = '120000';
    const { result } = await evaluate({ trees: {
      [headSha]: tree, [baseSha]: tree, [runBaseSha]: tree,
    } });
    assert.equal(result.trusted, false, target);
  }
});

test('truncated or unavailable GitHub trees fail closed with bounded public reasons', async () => {
  for (const ref of [headSha, baseSha, runBaseSha]) {
    const tree = trustedTree();
    tree.truncated = true;
    for (const options of [{ trees: { [ref]: tree } }, { treeError: ref }]) {
      const { result } = await evaluate(options);
      assert.equal(result.trusted, false);
      assert.doesNotMatch(result.reason, /Private API detail/);
    }
  }
});

test('fingerprinting is order independent and ordinary app changes are outside CI provenance', async () => {
  const tree = trustedTree();
  tree.tree.reverse();
  assert.equal(fingerprint(tree), fingerprint(trustedTree()));
  tree.tree.find(entry => entry.path === 'src/index.ts').sha = 'f'.repeat(40);
  const { result } = await evaluate({ trees: { [headSha]: tree } });
  assert.equal(result.trusted, true);
});

test('two successful native jobs record only their implemented scope and never imply release readiness', () => {
  const result = acceptance({ trusted: true, ios: 'success', android: 'success' });
  assert.equal(result.release_ready, false);
  assert.equal(result.phase_a, 'BLOCKED');
  assert.deepEqual(result.cases.map(scenario => scenario.id), REQUIRED);
  assert.deepEqual(result.cases.slice(0, 2).map(scenario => scenario.status), ['PASS', 'PASS']);
  assert.ok(result.cases.slice(2).every(scenario => scenario.status === 'NOT IMPLEMENTED'));
  assert.match(result.cases[1].scope, /not application account isolation/);
  assert.match(result.signing, /NOT IMPLEMENTED.*NOT VERIFIED/);
  assert.match(result.physical, /NOT RUN/);
});

test('failed, skipped, cancelled, pending or missing platform jobs provide no matrix credit', () => {
  for (const value of [undefined, null, '', 'failure', 'skipped', 'cancelled', 'pending',
    'in_progress', 'neutral', 'SUCCESS', true]) {
    for (const platform of ['ios', 'android']) {
      const result = acceptance({ trusted: true, ios: 'success', android: 'success', [platform]: value });
      assert.ok(result.cases.slice(0, 2).every(scenario => scenario.status === 'NOT VERIFIED'),
        `${platform}:${value}`);
      assert.equal(result.release_ready, false);
      assert.equal(result.phase_a, 'BLOCKED');
    }
  }
});

test('only a boolean trusted preflight permits implemented native scope to receive PASS', () => {
  for (const trusted of [undefined, null, false, 'true', 1, {}]) {
    const result = acceptance({ trusted, ios: 'success', android: 'success' });
    assert.ok(result.cases.slice(0, 2).every(scenario => scenario.status === 'NOT VERIFIED'));
    assert.equal(result.release_ready, false);
  }
});

test('human-readable acceptance preserves all blocked scenarios and separate signing/physical requirements', () => {
  const result = acceptance({ trusted: true, ios: 'success', android: 'success' });
  const text = markdown(result);
  assert.match(text, /Phase A release acceptance: BLOCKED/);
  assert.match(text, /cannot approve a release/);
  for (const id of REQUIRED) assert.ok(text.includes(id));
  assert.match(text, /NOT IMPLEMENTED/);
  assert.match(text, /exact distributed artifact required/);
});

test('Phase A caller and reusable worker expose no production-secret, protected-environment or privileged-event path', () => {
  // The inherited #7060 workflow is independently reviewed; protect new Phase A execution here.
  for (const filename of WORKFLOWS.filter(name => !name.endsWith('/keeper-hosted-native.yml'))) {
    const source = fs.readFileSync(path.join(__dirname, '../..', filename), 'utf8')
      .split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n');
    // Static security policy: these constructs change the runner trust boundary.
    assert.doesNotMatch(source, /^\s*(?:secrets|environment)\s*:/m, filename);
    assert.doesNotMatch(source, /\bsecrets\s*\./, filename);
    assert.doesNotMatch(source, /^\s*(?:pull_request_target|workflow_dispatch|repository_dispatch)\s*:/m,
      filename);
    assert.doesNotMatch(source, /^\s*[\w-]+:\s*write\s*$/m, filename);
    assert.doesNotMatch(source, /\bfastlane\b|\bgh\s+release\b/, filename);
    for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
      assert.ok(match[1].startsWith('./.github/workflows/') || /@[a-f0-9]{40}$/.test(match[1]),
        `${filename}: unpinned dependency ${match[1]}`);
    }
  }
});

function probeMiddleware(enhanced) {
  const seen = [];
  const original = (request, response, next) => {
    seen.push({ url: request.url, response, next });
    return 'served';
  };
  const base = { resolver: { preserved: true }, server: { preserveSetting: true } };
  let enhancementCalls = 0;
  if (enhanced) base.server.enhanceMiddleware = (inner, server) => {
    enhancementCalls += 1;
    assert.equal(inner, original);
    assert.equal(server.marker, true);
    return (request, response, next) => original(request, response, next);
  };
  const file = path.join(__dirname, '../native/release_metro.cjs');
  const context = {
    __dirname: path.dirname(file), module: { exports: {} },
    require: name => {
      if (name === '../../metro.config') return base;
      if (name === 'node:path') return path;
      throw new Error('Unexpected Metro dependency: ' + name);
    },
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const config = context.module.exports;
  assert.equal(config.resolver, base.resolver);
  assert.equal(config.server.preserveSetting, true);
  assert.equal(config.projectRoot, path.resolve(__dirname, '../..'));
  assert.equal(base.projectRoot, undefined);
  return { middleware: config.server.enhanceMiddleware(original, { marker: true }),
    seen, getEnhancementCalls: () => enhancementCalls };
}

test('CI Metro remaps only the native entrypoint while preserving query, source maps and base middleware', () => {
  for (const enhanced of [true, false]) {
    const state = probeMiddleware(enhanced);
    const cases = [
      ['/index.bundle?platform=ios&dev=true', '/.github/native/release_probe.bundle?platform=ios&dev=true'],
      ['/index.map?platform=android', '/.github/native/release_probe.map?platform=android'],
      ['/index.bundle', '/.github/native/release_probe.bundle'],
      ['/status', '/status'],
      ['/nested/index.bundle?platform=ios', '/nested/index.bundle?platform=ios'],
      ['/index.bundle.other?platform=ios', '/index.bundle.other?platform=ios'],
      ['/another.bundle?platform=android', '/another.bundle?platform=android'],
    ];
    for (const [url, expected] of cases) {
      const response = {};
      const next = () => {};
      assert.equal(state.middleware({ url }, response, next), 'served');
      assert.deepEqual(state.seen.at(-1), { url: expected, response, next });
    }
    assert.equal(state.getEnhancementCalls(), enhanced ? 1 : 0);
  }
});
