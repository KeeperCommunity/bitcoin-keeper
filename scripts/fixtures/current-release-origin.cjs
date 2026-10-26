'use strict';
// Disposable host-only corpus. Test-only policy installation never changes the
// committed finite production profile, and no network/native/provider is used.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), os = require('node:os');
const { createRequire } = require('node:module');
const { canonicalFixture, withWindow, loadWindow } = require('../../.github/tests/fixtures/installed-parent.cjs');
const { fixtureSoftware, zip } = require('../../.github/tests/fixtures/private-software.cjs');
const { WORKER_SOURCES } = require('../../.github/native/public_software_receipts.cjs');
const ROOT = path.resolve(__dirname, '../..');
const profiles = require('../../.github/native/release_repository_profiles.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = bytes => crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const clone = value => structuredClone(value);
function syntheticInstalledOrigin() {
  const parentFile = path.join(ROOT, '.github/native/installed_parent_software.cjs');
  const parentRequire = createRequire(parentFile), parent = { exports: {} }, window = loadWindow();
  new Function('require', 'module', fs.readFileSync(parentFile, 'utf8'))(name =>
    name === './installed_parent_window.cjs' ? window : parentRequire(name), parent);
  const file = path.join(ROOT, 'scripts/current-release-origin.cjs'), original = createRequire(file), module = { exports: {} };
  new Function('require', 'module', fs.readFileSync(file, 'utf8'))(name =>
    name === '../.github/native/installed_parent_software.cjs' ? parent.exports : original(name), module);
  return module.exports;
}
function sarifFixture({ score = '5.0', results = 1 } = {}) {
  const rule = { id: 'synthetic/rule', properties: { tags: ['security'], 'security-severity': score } };
  const analysis = { id: 990, commit_sha: 'a'.repeat(40), ref: 'refs/heads/sprint',
    sarif_id: '12345678-1234-1234-1234-123456789abc',
    analysis_key: '.github/workflows/codeql.yml:analyze', category: 'keeper-javascript-typescript/',
    environment: '{}', tool: { name: 'CodeQL', version: '2.23.0' },
    error: '', warning: '', rules_count: 1, results_count: results };
  const sarif = { version: '2.1.0', runs: [{ tool: { driver: { name: 'CodeQL', version: analysis.tool.version, rules: [rule] } },
    automationDetails: { id: analysis.category }, results: Array.from({ length: results }, () =>
      ({ ruleId: rule.id, ruleIndex: 0, rule: { id: rule.id, index: 0 } })) }] };
  return { analysis, sarif };
}
function fixture({ Octokit, profile = profiles.PUBLIC } = {}) {
  const REPO = profile.repository;
  const p = withWindow(canonicalFixture({ profile })), f = fixtureSoftware({ appTree: 'c'.repeat(40), appProfile: profile });
  if (profile.private) {
    // The app client stays distinct from the Relay artifact client. Both use
    // this test-only source corpus; no actual network or credential is used.
    const sourceRepository = p.github.rest.repos.get, sourceCommit = p.github.rest.git.getCommit;
    p.github.rest.repos.get = async args => ({ status: 200, headers: {}, ...await sourceRepository(args) });
    p.github.rest.git.getCommit = async args => ({ status: 200, headers: {}, ...await sourceCommit(args) });
    p.github.rest.git.getTree = async args => f.github.rest.git.getTree(args);
    p.github.rest.repos.getContent = async args => f.github.rest.repos.getContent(args);
  }
  p.window.app = clone(f.expected.IOS.app); p.window.private = clone(f.expected);
  p.sourceBytes = Object.fromEntries(Object.keys(WORKER_SOURCES).map(name => [name, fs.readFileSync(path.join(ROOT, name))]));
  p.workerSources = Object.entries(WORKER_SOURCES).map(([name, names]) =>
    ({ path: name, names: [...names], sha256: hash(p.sourceBytes[name]) }));
  for (const platform of ['IOS', 'ANDROID']) p.metadata[platform].r5_feature_evidence.source_functions = clone(p.workerSources);
  p.archives = Object.values(p.metadata).map(value => zip({ 'metadata.json': Buffer.from(JSON.stringify(value)) }));
  p.artifacts.forEach((artifact, i) => Object.assign(artifact,
    { size_in_bytes: p.archives[i].length, digest: 'sha256:' + hash(p.archives[i]) }));
  Object.assign(p.run, { status: 'completed', conclusion: 'success', repository: clone(p.repository), updated_at: '2026-10-22T23:29:59Z' });
  const s = { p, f, calls: [], driver: syntheticInstalledOrigin(), ...sarifFixture(),
    onApi: () => {}, onStorage: () => {}, transportStatus: 200 };
  s.context = { ...p.context, runId: 900, job: 'plan' };
  s.request = { repository: REPO, ref: 'refs/heads/sprint', driverSha: p.request.sourceSha,
    sourceSha: p.request.sourceSha, releaseRef: 'refs/tags/unused-synthetic', operation: 'android-signed-build',
    version: '9.9.9', build: '123', artifactSha256: '1'.repeat(64), approvalCommentId: '10',
    identitySha256: '2'.repeat(64), configSha256: '3'.repeat(64), artifactId: 'none' };
  s.options = { pinReader: p.pinReader, privateGithub: f.github, clock: () => f.now, stage: 'plan', workerAttempt: 1 };
  const app = { id: 15368, slug: 'github-actions' }, source = s.request.sourceSha;
  s.workflows = Object.fromEntries([['test.yml', 10], ['codeql.yml', 20], ['keeper-canonical-native.yml', 30],
    ['keeper-protected-release-workers.yml', 40]].map(([name, id]) =>
    [name, { id, path: '.github/workflows/' + name, state: 'active' }]));
  const run = (id, file, event, status = 'completed', conclusion = 'success') => ({
    id, workflow_id: s.workflows[file].id, path: s.workflows[file].path, run_attempt: 1,
    head_sha: source, head_branch: 'sprint', event, status, conclusion, check_suite_id: id + 2000,
    repository: clone(p.repository), head_repository: clone(p.repository), updated_at: '2026-10-22T23:29:59Z' });
  s.runs = { 100: run(100, 'test.yml', 'push', 'completed', 'failure'),
    200: run(200, 'codeql.yml', 'push'), 400: p.run,
    900: run(900, 'keeper-protected-release-workers.yml', 'workflow_dispatch', 'in_progress', null) };
  const dispatcher = { id: 789012, login: 'release-operator' };
  Object.assign(s.runs[900], { actor: clone(dispatcher), triggering_actor: clone(dispatcher),
    run_started_at: '2026-10-22T23:00:00Z' });
  s.actorPermissions = { 'release-operator': { permission: 'write', user: clone(dispatcher) } };
  const steps = names => names.map(name => ({ name, status: 'completed', conclusion: 'success' }));
  const job = (id, name, runId, conclusion = 'success', status = 'completed') => ({ id, name,
    run_id: runId, run_attempt: s.runs[runId].run_attempt, head_sha: source, status, conclusion,
    check_run_url: 'https://api.github.com/repos/' + REPO + '/check-runs/' + (id + 10000) });
  s.jobs = { 100: [job(1010, 'Lint', 100), job(1011, 'Tests', 100), job(1012, 'Automatic backup native Realm and Relay', 100, 'failure')],
    200: [job(2010, 'Analyze JavaScript/TypeScript', 200)], 400: p.jobs,
    900: [job(9010, 'plan', 900, null, 'in_progress')] };
  if (fs.readFileSync(path.join(ROOT, '.github/workflows/test.yml'), 'utf8').includes('  protected-backup-v3:')) {
    if (profile.private) { s.jobs[100][2].conclusion = 'skipped'; s.runs[100].conclusion = 'success'; }
    const backup = job(1013, 'Protected backup v3 proof', 100, profile.private ? 'success' : 'skipped');
    backup.steps = steps(['Execute all 351 private-v3 cases and verify all 295 retained obligations',
      'Verify exact source after checks', "Remove only this job's owned disposable replica",
      'Preserve exact-source private-v3 proof ledger']);
    s.jobs[100].push(backup);
  }
  s.jobs[100][1].steps = steps(['Run tests', 'Run recovery regression tests',
    'Verify checked-out release version consistency', 'Run release and packaged-artifact tests']);
  s.jobs[200][0].steps = steps(['Initialize CodeQL', 'Analyze', 'Capture official CodeQL upload ID', 'Upload CodeQL analysis provenance']);
  s.suites = Object.fromEntries(Object.values(s.runs).map(row => [row.check_suite_id,
    { id: row.check_suite_id, head_sha: source, app: clone(app) }]));
  s.checks = {};
  for (const [runId, jobs] of Object.entries(s.jobs)) for (const row of jobs) {
    const id = Number(row.check_run_url.split('/').at(-1));
    s.checks[id] = { id, name: row.name, head_sha: source, status: row.status, conclusion: row.conclusion,
      app: clone(app), check_suite: { id: s.runs[runId].check_suite_id } };
  }
  s.gas = { id: 9999, name: 'CodeQL', head_sha: source, status: 'completed', conclusion: 'success',
    app: { id: 57789, slug: 'github-advanced-security' } };
  const receipt = { schema: 1, kind: 'keeper-codeql-upload', repository: REPO, source_sha: source,
    source_ref: 'refs/heads/sprint', workflow_sha: source, workflow_path: '.github/workflows/codeql.yml',
    run_id: 200, run_attempt: 1, analysis_key: s.analysis.analysis_key,
    category: s.analysis.category, sarif_id: s.analysis.sarif_id };
  s.codeqlArchive = zip({ 'analysis.json': Buffer.from(JSON.stringify(receipt)) });
  // Python's default ZipInfo mode omits the regular-file type. The public
  // provenance format requires a regular member, as the actual producer emits.
  const end = s.codeqlArchive.length - 22, central = s.codeqlArchive.readUInt32LE(end + 16);
  s.codeqlArchive.writeUInt32LE(0o100600 * 65536, central + 38);
  s.codeqlArtifact = { id: 777, name: 'keeper-codeql-analysis-' + source + '-200-1', expired: false,
    size_in_bytes: s.codeqlArchive.length, digest: 'sha256:' + hash(s.codeqlArchive),
    workflow_run: { id: 200, head_sha: source }, expires_at: '2026-10-29T23:00:00Z' };
  s.codeqlProcessing = { processing_status: 'complete', errors: [] };
  s.content = {};
  for (const name of ['test.yml', 'codeql.yml']) {
    const bytes = fs.readFileSync(path.join(ROOT, '.github/workflows', name));
    s.content[name] = { type: 'file', path: '.github/workflows/' + name, encoding: 'base64',
      size: bytes.length, sha: blob(bytes), content: bytes.toString('base64') };
  }
  const list = (rows, key) => ({ total_count: rows.length, [key]: rows });
  s.api = (url, init) => {
    s.calls.push(url.pathname + url.search); s.onApi(url, init);
    const endpoint = url.pathname.slice(('/repos/' + REPO + '/').length), bits = endpoint.split('/');
    if (endpoint.startsWith('contents/.github/workflows/')) return s.content[bits.at(-1)];
    if (endpoint.startsWith('actions/workflows/')) {
      if (bits[3] === 'runs') return list(Object.values(s.runs).filter(row => row.workflow_id === Number(bits[2])), 'workflow_runs');
      return s.workflows[bits[2]];
    }
    if (endpoint.startsWith('actions/runs/')) {
      const id = Number(bits[2]);
      if (bits[3] === 'attempts') return list(s.jobs[id], 'jobs');
      if (bits[3] === 'artifacts') return list(id === 200 ? [s.codeqlArtifact] : [], 'artifacts');
      return s.runs[id];
    }
    if (endpoint.startsWith('check-suites/')) return s.suites[bits[1]];
    if (endpoint.startsWith('check-runs/')) return s.checks[bits[1]];
    if (endpoint.startsWith('commits/')) return list([s.gas], 'check_runs');
    if (endpoint.startsWith('actions/artifacts/')) return s.codeqlArtifact;
    if (endpoint.startsWith('code-scanning/sarifs/')) return s.codeqlProcessing;
    if (endpoint === 'code-scanning/analyses') return [s.analysis];
    if (endpoint.startsWith('code-scanning/analyses/')) {
      return init.headers.accept === 'application/sarif+json' ? s.sarif : s.analysis;
    }
    if (endpoint.startsWith('collaborators/')) return s.actorPermissions[bits[1]];
    throw new Error('UNPLANNED_DISPOSABLE_ENDPOINT');
  };
  p.github.request = Octokit ? new Octokit({ auth: 'SYNTHETIC_ONLY', request: { fetch: async () => {
    throw new Error('UNPLANNED_SDK_NETWORK_DISABLED');
  } } }).request : async (route, options) => {
    const response = await options.request.fetch(route.slice(4), { method: 'GET',
      headers: { ...options.headers, authorization: 'Bearer SYNTHETIC_ONLY' } });
    return { status: response.status, headers: Object.fromEntries(response.headers) };
  };
  const privateFetch = f.fetchImpl;
  s.fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.pathname.includes('/bitcoin-keeper-relay/') || url.hostname === 'fixture.blob.core.windows.net')
      return privateFetch(input, init);
    if (url.hostname === 'origin-fixture.blob.core.windows.net') {
      if (init.headers || init.redirect !== 'error') throw new Error('STORAGE_CREDENTIAL_OR_REDIRECT_LEAK');
      s.onStorage(); return new Response(s.codeqlArchive, { headers: { 'content-length': String(s.codeqlArchive.length) } });
    }
    if (url.hostname !== 'api.github.com' || !/^(?:token|bearer) SYNTHETIC_ONLY$/i.test(init.headers.authorization))
      throw new Error('UNPLANNED_DISPOSABLE_TRANSPORT');
    if (url.pathname.endsWith('/777/zip')) {
      if (init.redirect !== 'manual') throw new Error('REDIRECT_NOT_MANUAL');
      return new Response('', { status: 302, headers: { location: 'https://origin-fixture.blob.core.windows.net/777' } });
    }
    if (init.redirect !== 'error') throw new Error('API_REDIRECT_NOT_BLOCKED');
    const value = s.api(url, init);
    return new Response(JSON.stringify(value), { status: s.transportStatus, headers: { 'content-type': 'application/json' } });
  };
  s.options.fetchImpl = s.fetchImpl;
  s.collect = () => s.driver.collectCurrentReleaseOrigin(p.github, s.context, s.request, s.options);
  return s;
}
function gateFixture(options) {
  const REPO = (options?.profile || profiles.PUBLIC).repository;
  const f = fixture(options), file = path.join(ROOT, 'scripts/protected-release-plan.cjs');
  const original = createRequire(file), module = { exports: {} };
  new Function('require', 'module', fs.readFileSync(file, 'utf8').replace(/^#![^\n]*\n/, ''))(name =>
    name === './current-release-origin.cjs' ? f.driver : original(name), module);
  f.gate = module.exports;
  f.candidate = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-synthetic-release-source-'));
  for (const name of ['release/version.json', 'package.json', 'android/app/build.gradle',
    'ios/hexa_keeper.xcodeproj/project.pbxproj', 'ios/hexa_keeper/Info.plist', 'ios/hexa_keeper_dev-Info.plist']) {
    const destination = path.join(f.candidate, name); fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(ROOT, name), destination);
  }
  f.manifest = JSON.parse(fs.readFileSync(path.join(f.candidate, 'release/version.json'), 'utf8'));
  for (const baseline of Object.values(f.manifest.baselines)) baseline.verifiedAt = new Date(f.f.now - 3600000).toISOString();
  fs.writeFileSync(path.join(f.candidate, 'release/version.json'), JSON.stringify(f.manifest));
  Object.assign(f.request, { releaseRef: 'release/' + f.manifest.version, version: f.manifest.version,
    build: String(f.manifest.androidVersionCode), artifactSha256: 'pending' });
  f.approval = { user: { login: 'antuz123' }, body: f.gate.approvalBody(f.request,
    new Date(f.f.now + 3600000).toISOString().replace('.000Z', 'Z')),
    updated_at: new Date(f.f.now - 60000).toISOString() };
  f.permission = { permission: 'write' };
  f.driverBranch = { protected: true, commit: { sha: f.request.sourceSha } };
  f.releaseBranch = clone(f.driverBranch);
  f.environment = { name: 'keeper-release-android', can_admins_bypass: false,
    protection_rules: [{ type: 'required_reviewers', prevent_self_review: true, reviewers: [{ id: 17 }] }],
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } };
  const sourceApi = f.api;
  f.api = (url, init) => {
    const endpoint = url.pathname.slice(('/repos/' + REPO + '/').length);
    if (endpoint.startsWith('branches/') || endpoint.startsWith('issues/comments/') ||
      endpoint === 'collaborators/antuz123/permission' || endpoint.startsWith('environments/')) {
      f.calls.push(url.pathname + url.search); f.onApi(url, init);
      if (endpoint === 'branches/sprint') return f.driverBranch;
      if (endpoint.startsWith('branches/')) return f.releaseBranch;
      if (endpoint.startsWith('issues/comments/')) return f.approval;
      if (endpoint.startsWith('collaborators/')) return f.permission;
      return f.environment;
    }
    return sourceApi(url, init);
  };
  f.collectGate = () => f.gate.collectEvidenceWithSDK(f.request, f.candidate, f.p.github, f.context, f.options);
  f.validate = evidence => f.gate.validateEvidence(f.request, evidence, f.f.now);
  f.cleanup = () => fs.rmSync(f.candidate, { recursive: true, force: true });
  return f;
}
module.exports = { fixture, gateFixture, syntheticInstalledOrigin, sarifFixture };
