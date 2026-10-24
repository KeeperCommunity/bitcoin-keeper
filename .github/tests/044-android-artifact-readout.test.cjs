'use strict';
// Offline API/transport controls; no network, artifact download or native action.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const SCRIPT = path.join(__dirname, '../scripts/read-044-android-artifact.cjs');
const SOURCE = '044ebb6ea2d465f6a70e9116e3feac5a604cd696';
const WORKFLOW = '5a7b0c5da0a38197f6dd675ff424f3ba3f441d02';
const PAYLOAD = Buffer.from('OFFLINE_SYNTHETIC_METADATA_ZIP_BYTES');
const DIGEST = crypto.createHash('sha256').update(PAYLOAD).digest('hex');
const SELECTION = 'const ARTIFACT = null, ZIP_SIZE = null, DIGEST = null;';
const CONCLUSIONS = 'const RUN_CONCLUSION = null, NATIVE_CONCLUSION = null, BUILD_CONCLUSION = null, PROBES_CONCLUSION = null;';

function fixture(options = {}) {
  const context = { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' },
    eventName: 'push', ref: 'refs/heads/codex/r5-044-artifact-readout-preparation-20261023' };
  const runData = { id: 39873063291, run_attempt: 1, repository: { id: 470904030 },
    head_repository: { id: 470904030 }, head_sha: SOURCE, event: 'pull_request',
    head_branch: 'codex/r5-startup-credential-failure-observation-20261022', path: '.github/workflows/keeper-native-diagnostic.yml',
    status: 'completed', conclusion: 'failure', referenced_workflows: [{
      path: `KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-native-platform.yml@${WORKFLOW}`,
      ref: 'refs/pull/7131/merge', sha: WORKFLOW }] };
  const jobData = { id: 999, run_id: 39873063291, run_attempt: 1, head_sha: SOURCE,
    status: 'completed', conclusion: 'failure',
    steps: [['Build development app', 'success'],
      ['Run Android startup and native persistence probes', 'failure'],
      ['Retain safe Phase A evidence', 'success']].map(([name, conclusion]) => ({ name, conclusion, status: 'completed' })) };
  const artifact = { id: 991, name: `keeper-diagnostic-native-ANDROID-${SOURCE}-39873063291-1`,
    expired: false, size_in_bytes: PAYLOAD.length,
    digest: 'sha256:' + DIGEST, workflow_run: {
      id: 39873063291, head_sha: SOURCE, repository_id: 470904030, head_repository_id: 470904030 } };
  const calls = [], events = [], output = [], actions = {};
  for (const [name, data] of [['getWorkflowRun', runData], ['getJobForWorkflowRun', jobData], ['getArtifact', artifact]]) {
    actions[name] = async args => { calls.push([name, args]); return { data }; };
  }
  actions.downloadArtifact = async args => { calls.push(['downloadArtifact', args]); return { data: options.payload ?? PAYLOAD }; };
  const inputs = { github: { rest: { actions } }, context, core: {
    info(value) { events.push('info'); if (options.info) throw new Error('PRIVATE_SENTINEL'); output.push(value); },
    warning(value) { events.push('warning'); if (options.warning) throw new Error('PRIVATE_SENTINEL'); output.push(value); } } };
  let text = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(text.includes(SELECTION) && text.includes(CONCLUSIONS), 'Preparation must retain unavailable selection constants');
  if (!options.unavailable) text = text.replace('const JOB = null;', 'const JOB = 999;')
    .replace(SELECTION, `const ARTIFACT = 991, ZIP_SIZE = ${PAYLOAD.length}, DIGEST = '${DIGEST}';`)
    .replace(CONCLUSIONS, "const RUN_CONCLUSION = 'failure', NATIVE_CONCLUSION = 'failure', BUILD_CONCLUSION = 'success', PROBES_CONCLUSION = 'failure';");
  if (options.sourceChange) text = options.sourceChange(text);
  const api = { module: { exports: {} }, Buffer, process: { env: { RUNNER_TEMP: '/owned' } }, require(name) {
    if (name === 'node:assert/strict') return { ...assert, deepEqual(actual, expected) {
      assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
    } };
    if (name === 'node:crypto') return crypto;
    if (name === 'node:path') return path;
    if (name === 'node:fs') return {
      realpathSync: value => value,
      openSync(filename, flags, mode) { assert.equal(filename, '/owned/r5-044-android-fixed.zip'); assert.equal(flags, 'wx'); assert.equal(mode, 0o600); events.push('open'); return 42; },
      writeFileSync(fd, bytes) { assert.equal(fd, 42); assert.deepEqual(bytes, PAYLOAD); events.push('write'); if (options.write) throw new Error('PRIVATE_SENTINEL'); },
      closeSync(fd) { assert.equal(fd, 42); events.push('close'); if (options.close) throw new Error('PRIVATE_SENTINEL'); },
      unlinkSync(filename) { assert.equal(filename, '/owned/r5-044-android-fixed.zip'); events.push('unlink'); if (options.unlink) throw new Error('PRIVATE_SENTINEL'); },
    };
    if (name === 'node:child_process') return { execFileSync(command, args, settings) {
      assert.equal(command, 'python3'); assert.deepEqual(Array.from(args), ['-B', '.github/scripts/read-044-android-artifact.py']);
      assert.equal(settings.timeout, 30000); events.push('decoder');
      if (options.decoder) throw new Error('PRIVATE_SENTINEL');
      return options.wrongOutput ? 'PRIVATE_SENTINEL' :
        `FIXED_044_ANDROID_ARTIFACT_ZIP_BASE64_BEGIN\n${PAYLOAD.toString('base64')}\nFIXED_044_ANDROID_ARTIFACT_ZIP_BASE64_END\n`;
    } };
    throw new Error('Unexpected synthetic import');
  } };
  vm.runInNewContext(text, api);
  return { context, runData, jobData, artifact, calls, events, output, inputs,
    invoke: () => api.module.exports.run(inputs) };
}

test('unavailable real Android selection rejects before API, filesystem or logging', async () => {
  const f = fixture({ unavailable: true });
  await assert.rejects(f.invoke, /^Error: FIXED_NATIVE_ARTIFACT_READOUT_FAILED$/);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.events, []); assert.deepEqual(f.output, []);
  const text = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(text.includes('const RUN = 39873063291;') && text.includes('const JOB = null;'));
});

test('synthetic bound route reads only exact Android job/artifact and deletes before original-byte log', async () => {
    const f = fixture(); await f.invoke();
    assert.deepEqual(f.calls.map(([name]) => name), ['getWorkflowRun', 'getJobForWorkflowRun', 'getArtifact', 'downloadArtifact']);
    assert.equal(f.calls[1][1].job_id, 999);
    assert.equal(f.calls[3][1].artifact_id, 991);
    assert.ok(f.events.indexOf('close') < f.events.indexOf('unlink'));
    assert.ok(f.events.indexOf('unlink') < f.events.indexOf('info'));
    const lines = f.output[0].split('\n');
    assert.deepEqual(Buffer.from(lines[1], 'base64'), PAYLOAD);
    assert.equal(lines[0], 'FIXED_044_ANDROID_ARTIFACT_ZIP_BASE64_BEGIN');
    assert.equal(lines[2], 'FIXED_044_ANDROID_ARTIFACT_ZIP_BASE64_END');
});

test('partial or wrong finite selection fails before any API/filesystem operation', async () => {
  for (const [before, after] of [["const JOB = 999", "const JOB = null"], ["const ARTIFACT = 991", "const ARTIFACT = null"],
    [`ZIP_SIZE = ${PAYLOAD.length}`, 'ZIP_SIZE = null'], [`DIGEST = '${DIGEST}'`, 'DIGEST = null'],
    ["RUN_CONCLUSION = 'failure'", "RUN_CONCLUSION = null"],
    ["NATIVE_CONCLUSION = 'failure'", "NATIVE_CONCLUSION = null"],
    ["BUILD_CONCLUSION = 'success'", "BUILD_CONCLUSION = null"],
    ["PROBES_CONCLUSION = 'failure'", "PROBES_CONCLUSION = null"]]) {
    const f = fixture({ sourceChange: text => { assert.ok(text.includes(before)); return text.replace(before, after); } });
    await assert.rejects(f.invoke, /^Error: FIXED_NATIVE_ARTIFACT_READOUT_FAILED$/);
    assert.deepEqual(f.calls, []); assert.deepEqual(f.events, []); assert.deepEqual(f.output, []);
  }
});

test('foreign, stale, unknown or incomplete provenance never downloads bytes', async () => {
  for (const change of [f => f.context.repo.owner = 'foreign', f => f.context.eventName = 'workflow_dispatch',
    f => f.context.ref = 'refs/heads/sprint', f => f.runData.run_attempt++, f => f.runData.head_sha = '0'.repeat(40),
    f => f.runData.repository.id++, f => f.runData.head_repository.id++, f => f.runData.status = 'queued',
    f => { f.runData.status = 'in_progress'; f.runData.conclusion = null; },
    f => f.runData.conclusion = 'success', f => f.runData.referenced_workflows = [],
    f => f.runData.referenced_workflows[0].sha = SOURCE, f => f.jobData.id++, f => f.jobData.run_id++,
    f => f.jobData.run_attempt++, f => f.jobData.status = 'in_progress', f => f.jobData.conclusion = 'success',
    f => f.jobData.steps[0].conclusion = 'failure', f => f.jobData.steps[1].conclusion = 'success',
    f => f.jobData.steps[2].conclusion = 'failure', f => f.jobData.steps.push(f.jobData.steps[2]),
    f => f.artifact.id++, f => f.artifact.name += '-foreign', f => f.artifact.expired = true,
    f => f.artifact.size_in_bytes++, f => f.artifact.digest = 'sha256:' + '0'.repeat(64),
    f => f.artifact.workflow_run.id++, f => f.artifact.workflow_run.head_repository_id++]) {
    const f = fixture(); change(f);
    await assert.rejects(f.invoke, /^Error: FIXED_NATIVE_ARTIFACT_READOUT_FAILED$/);
    assert.equal(f.calls.some(([name]) => name === 'downloadArtifact'), false);
    assert.deepEqual(f.events, []); assert.deepEqual(f.output, []);
  }
});

test('wrong size or digest bytes fail before owned-file creation or logging', async () => {
  for (const payload of [Buffer.from('PRIVATE_SENTINEL'), Buffer.alloc(PAYLOAD.length)]) {
    const f = fixture({ payload });
    await assert.rejects(f.invoke, /^Error: FIXED_NATIVE_ARTIFACT_READOUT_FAILED$/);
    assert.deepEqual(f.events, []); assert.deepEqual(f.output, []);
  }
});

test('write, close, decoder, cleanup and logger failures retain fixed errors and purge ordering', async () => {
  for (const options of [{ write: true, unlink: true, warning: true }, { close: true },
    { decoder: true, unlink: true, warning: true }, { wrongOutput: true },
    { unlink: true, warning: true }, { info: true }]) {
    const f = fixture(options);
    await assert.rejects(f.invoke, options.unlink && !options.write && !options.decoder ?
      /^Error: FIXED_NATIVE_ARTIFACT_PRIVATE_CLEANUP_FAILED$/ : /^Error: FIXED_NATIVE_ARTIFACT_READOUT_FAILED$/);
    assert.equal(f.events.filter(value => value === 'unlink').length, 1);
    if (options.info) assert.ok(f.events.indexOf('unlink') < f.events.indexOf('info'));
    else assert.equal(f.events.includes('info'), false);
    assert.equal(JSON.stringify(f.output).includes('PRIVATE_SENTINEL'), false);
  }
});
