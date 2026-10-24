'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { run } = require('../scripts/read-23f-native-artifact.cjs');
const SOURCE = '23f14e01f3437c213f1443c3167d96022f3a43bc';
const WORKFLOW = '1f084ee4486709e0066034a452349df897eb2434';
const DIGEST = '4d464ef5f8faa7de4f02292e683f0dad8242544843610da9371f2c675dc183f0';

function fixture() {
  const context = { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' },
    eventName: 'push', ref: 'refs/heads/codex/r5-23f-artifact-readout' };
  const runData = { id: 39846002094, run_attempt: 1, repository: { id: 470904030 },
    head_repository: { id: 470904030 }, head_sha: SOURCE, event: 'pull_request',
    head_branch: 'codex/r5-native-acceptance-20261022', path: '.github/workflows/keeper-native-diagnostic.yml',
    status: 'completed', conclusion: 'failure', referenced_workflows: [{
      path: `KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-native-platform.yml@${WORKFLOW}`,
      ref: 'refs/pull/7107/merge', sha: WORKFLOW }] };
  const jobData = { id: 120075215316, run_id: 39846002094, head_sha: SOURCE, status: 'completed', conclusion: 'failure',
    steps: [['Build development app', 'success'], ['Run Android startup and native persistence probes', 'failure'],
      ['Retain safe Phase A evidence', 'success']].map(([name, conclusion]) => ({ name, conclusion, status: 'completed' })) };
  const artifact = { id: 12458149136, name: `keeper-diagnostic-native-ANDROID-${SOURCE}-39846002094-1`,
    expired: false, size_in_bytes: 8395, digest: `sha256:${DIGEST}`, workflow_run: {
      id: 39846002094, head_sha: SOURCE, repository_id: 470904030, head_repository_id: 470904030 } };
  const calls = [], output = [];
  const actions = {};
  for (const [name, data] of [['getWorkflowRun', runData], ['getJobForWorkflowRun', jobData], ['getArtifact', artifact]]) {
    actions[name] = async args => { calls.push([name, args]); return { data }; };
  }
  actions.downloadArtifact = async args => { calls.push(['downloadArtifact', args]); return { data: Buffer.from('PRIVATE_SENTINEL') }; };
  const inputs = { github: { rest: { actions } }, context,
    core: { info: value => output.push(value), warning: value => output.push(value) } };
  return { context, runData, jobData, artifact, calls, output, inputs, invoke: () => run(inputs) };
}

test('valid API provenance reaches only the fixed archive; unverified bytes emit no receipt', async () => {
  const f = fixture();
  await assert.rejects(f.invoke, /^Error: FIXED_NATIVE_ARTIFACT_READOUT_FAILED$/);
  assert.deepEqual(f.calls.at(-1), ['downloadArtifact', {
    owner: 'KeeperCommunity', repo: 'bitcoin-keeper', request: { timeout: 30000 },
    artifact_id: 12458149136, archive_format: 'zip' }]);
  assert.deepEqual(f.output, []);
});

test('actual private-file finally retains primary even when decoder, unlink and logger all fail', async () => {
  for (const options of [{}, { decoder: true, unlink: true, warning: true },
    { unlink: true, warning: true }, { write: true, unlink: true, warning: true }]) {
    const f = fixture(), events = [];
    f.inputs.github.rest.actions.downloadArtifact = async () => ({ data: Buffer.alloc(8395) });
    const api = { module: { exports: {} }, Buffer, process: { env: { RUNNER_TEMP: '/owned' } }, require(name) {
      if (name === 'node:assert/strict') return { ...assert, deepEqual(actual, expected, message) {
        // The source runs in a separate VM realm; compare its API JSON by value.
        assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);
      } };
      if (name === 'node:path') return path;
      if (name === 'node:crypto') return { createHash: () => ({ update() { return this; }, digest: () => DIGEST }) };
      if (name === 'node:fs') return { realpathSync: x => x,
        openSync(filename, flags, mode) { assert.equal(filename, '/owned/r5-23f-android-fixed.zip'); assert.equal(flags, 'wx'); assert.equal(mode, 0o600); events.push('open'); return 42; },
        writeFileSync(fd) { assert.equal(fd, 42); events.push('write'); if (options.write) throw new Error('PRIVATE_SENTINEL'); },
        closeSync(fd) { assert.equal(fd, 42); events.push('close'); },
        unlinkSync() { events.push('unlink'); if (options.unlink) throw new Error('PRIVATE_SENTINEL'); } };
      if (name === 'node:child_process') return { execFileSync(command, args, settings) {
        assert.equal(command, 'python3'); assert.deepEqual(Array.from(args), ['-B', '.github/scripts/read-23f-android-artifact.py']);
        assert.equal(settings.timeout, 30000); events.push('decoder');
        if (options.decoder) throw new Error('PRIVATE_SENTINEL'); return 'SAFE_R5_ANDROID_READOUT {}\n'; } };
      throw new Error('Unexpected synthetic import');
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/read-23f-native-artifact.cjs'), 'utf8'), api);
    f.inputs.core = { info() { events.push('info'); }, warning() { events.push('warning'); if (options.warning) throw new Error('PRIVATE_SENTINEL'); } };
    const action = () => api.module.exports.run(f.inputs);
    if (options.decoder || options.write) await assert.rejects(action, /^Error: FIXED_NATIVE_ARTIFACT_READOUT_FAILED$/);
    else if (options.unlink) await assert.rejects(action, /^Error: FIXED_NATIVE_ARTIFACT_PRIVATE_CLEANUP_FAILED$/);
    else await action();
    assert.equal(events.filter(x => x === 'unlink').length, 1);
    assert.ok(events.indexOf('close') < events.indexOf('unlink'));
    if (!options.decoder && !options.write && !options.unlink) assert.ok(events.indexOf('unlink') < events.indexOf('info'));
    else assert.equal(events.includes('info'), false);
  }
});

test('foreign context cannot make any API request', async () => {
  for (const change of [f => f.context.repo.owner = 'foreign', f => f.context.repo.repo = 'foreign',
    f => f.context.eventName = 'workflow_dispatch', f => f.context.ref = 'refs/heads/sprint']) {
    const f = fixture(); change(f);
    await assert.rejects(f.invoke, /FIXED_NATIVE_ARTIFACT_READOUT_FAILED/);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.output, []);
  }
});

test('stale, cross-source, foreign, missing and failed-upload metadata reject before archive download', async () => {
  for (const change of [
    f => f.runData.id++, f => f.runData.run_attempt++, f => f.runData.head_sha = '0'.repeat(40),
    f => f.runData.head_repository.id++, f => f.runData.event = 'push',
    f => f.runData.path = '.github/workflows/other.yml', f => f.runData.status = 'in_progress',
    f => f.runData.referenced_workflows[0].sha = SOURCE, f => f.runData.referenced_workflows = [],
    f => f.jobData.run_id++, f => f.jobData.head_sha = WORKFLOW,
    f => f.jobData.steps[2].conclusion = 'failure', f => f.jobData.steps.push(f.jobData.steps[2]),
    f => f.artifact.id++, f => f.artifact.name += '-foreign', f => f.artifact.expired = true,
    f => f.artifact.size_in_bytes++, f => f.artifact.digest = 'sha256:' + '0'.repeat(64),
    f => f.artifact.workflow_run.id++, f => f.artifact.workflow_run.head_sha = WORKFLOW,
  ]) {
    const f = fixture(); change(f);
    await assert.rejects(f.invoke, /FIXED_NATIVE_ARTIFACT_READOUT_FAILED/);
    assert.equal(f.calls.some(([name]) => name === 'downloadArtifact'), false);
    assert.deepEqual(f.output, []);
  }
});
