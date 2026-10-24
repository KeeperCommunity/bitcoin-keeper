'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { run } = require('../scripts/read-current-ios-artifact.cjs');
const SOURCE = '1bc34890cb8618b2fffd446a63924974e0fe15b5';
const WORKFLOW = '3c44ab6412a8118b183273c402dd08136db05b28';
const DIGEST = '550142809a0faf812741a586630b17d6f458b2b6c935b5bab4b00f84da67c84f';

function fixture() {
  const context = { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' },
    eventName: 'push', ref: 'refs/heads/codex/r5-current-ios-artifact-byte-readout-20261022' };
  const runData = { id: 39858617273, run_attempt: 1, repository: { id: 470904030 },
    head_repository: { id: 470904030 }, head_sha: SOURCE, event: 'pull_request',
    head_branch: 'codex/r5-ios-startup-diagnosis-20261022', path: '.github/workflows/keeper-native-diagnostic.yml',
    status: 'completed', conclusion: 'failure', referenced_workflows: [{
      path: `KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-native-platform.yml@${WORKFLOW}`,
      ref: 'refs/pull/7116/merge', sha: WORKFLOW }] };
  const jobData = { id: 120103187854, run_id: 39858617273, head_sha: SOURCE, run_attempt: 1, status: 'completed', conclusion: 'failure',
    steps: [['Build development app', 'success'], ['Run disposable startup smoke', 'failure'],
      ['Retain safe Phase A evidence', 'success']].map(([name, conclusion]) => ({ name, conclusion, status: 'completed' })) };
  const artifact = { id: 12462694619, name: `keeper-diagnostic-native-IOS-${SOURCE}-39858617273-1`,
    expired: false, size_in_bytes: 6884, digest: `sha256:${DIGEST}`, workflow_run: {
      id: 39858617273, head_sha: SOURCE, repository_id: 470904030, head_repository_id: 470904030 } };
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
    artifact_id: 12462694619, archive_format: 'zip' }]);
  assert.deepEqual(f.output, []);
});

test('completed iOS job is readable while the current whole run and Android remain in progress', async () => {
  const f = fixture();
  f.runData.status = 'in_progress'; f.runData.conclusion = null;
  await assert.rejects(f.invoke, /^Error: FIXED_NATIVE_ARTIFACT_READOUT_FAILED$/); // Deliberately wrong ZIP.
  assert.equal(f.calls.filter(([name]) => name === 'downloadArtifact').length, 1);
  assert.equal(f.calls.filter(([name]) => name === 'getJobForWorkflowRun').length, 1);
  assert.deepEqual(f.output, []);
});

test('correct-length wrong-digest bytes fail before creating or logging any private file', async () => {
  const f = fixture();
  f.inputs.github.rest.actions.downloadArtifact = async () => ({ data: Buffer.alloc(6884) });
  await assert.rejects(f.invoke, /^Error: FIXED_NATIVE_ARTIFACT_READOUT_FAILED$/);
  assert.deepEqual(f.output, []);
});

test('actual private-file finally retains primary even when decoder, unlink and logger all fail', async () => {
  for (const options of [{}, { decoder: true, unlink: true, warning: true },
    { unlink: true, warning: true }, { write: true, unlink: true, warning: true }, { info: true }]) {
    const f = fixture(), events = [];
    f.inputs.github.rest.actions.downloadArtifact = async () => ({ data: Buffer.alloc(6884) });
    const api = { module: { exports: {} }, Buffer, process: { env: { RUNNER_TEMP: '/owned' } }, require(name) {
      if (name === 'node:assert/strict') return { ...assert, deepEqual(actual, expected, message) {
        // The source runs in a separate VM realm; compare its API JSON by value.
        assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message);
      } };
      if (name === 'node:path') return path;
      if (name === 'node:crypto') return { createHash: () => ({ update() { return this; }, digest: () => DIGEST }) };
      if (name === 'node:fs') return { realpathSync: x => x,
        openSync(filename, flags, mode) { assert.equal(filename, '/owned/r5-current-ios-fixed.zip'); assert.equal(flags, 'wx'); assert.equal(mode, 0o600); events.push('open'); return 42; },
        writeFileSync(fd) { assert.equal(fd, 42); events.push('write'); if (options.write) throw new Error('PRIVATE_SENTINEL'); },
        closeSync(fd) { assert.equal(fd, 42); events.push('close'); },
        unlinkSync() { events.push('unlink'); if (options.unlink) throw new Error('PRIVATE_SENTINEL'); } };
      if (name === 'node:child_process') return { execFileSync(command, args, settings) {
        assert.equal(command, 'python3'); assert.deepEqual(Array.from(args), ['-B', '.github/scripts/read-current-ios-artifact.py']);
        assert.equal(settings.timeout, 30000); events.push('decoder');
        if (options.decoder) throw new Error('PRIVATE_SENTINEL');
        return 'FIXED_IOS_ARTIFACT_ZIP_BASE64_BEGIN\n' + Buffer.alloc(6884).toString('base64') + '\nFIXED_IOS_ARTIFACT_ZIP_BASE64_END\n'; } };
      throw new Error('Unexpected synthetic import');
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/read-current-ios-artifact.cjs'), 'utf8'), api);
    f.inputs.core = { info() { events.push('info'); if (options.info) throw new Error('PRIVATE_SENTINEL'); }, warning() { events.push('warning'); if (options.warning) throw new Error('PRIVATE_SENTINEL'); } };
    const action = () => api.module.exports.run(f.inputs);
    if (options.decoder || options.write || options.info) await assert.rejects(action, /^Error: FIXED_NATIVE_ARTIFACT_READOUT_FAILED$/);
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
    f => f.runData.path = '.github/workflows/other.yml', f => f.runData.status = 'queued', f => f.runData.conclusion = 'success',
    f => f.jobData.run_attempt++, f => f.jobData.status = 'in_progress',
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
