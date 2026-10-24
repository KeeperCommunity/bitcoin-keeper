'use strict';
// Offline API/transport controls; no network, artifact download or native action.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const SCRIPT = path.join(__dirname, '../scripts/read-current-android-artifact.cjs');
const SOURCE = '1bc34890cb8618b2fffd446a63924974e0fe15b5';
const WORKFLOW = '3c44ab6412a8118b183273c402dd08136db05b28';
const PAYLOAD = Buffer.from('OFFLINE_SYNTHETIC_METADATA_ZIP_BYTES');
const DIGEST = crypto.createHash('sha256').update(PAYLOAD).digest('hex');
const SELECTION = "const ARTIFACT = 12466091444, ZIP_SIZE = 8950, DIGEST = '5c3210a6b0af7bf9ea0cddb61fd1494714e8cfac0db8385960fb6390f92aa545';";
const CONCLUSIONS = "const NATIVE_CONCLUSION = 'failure', BUILD_CONCLUSION = 'success', PROBES_CONCLUSION = 'failure';";

function fixture(options = {}) {
  const context = { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper' },
    eventName: 'push', ref: 'refs/heads/codex/r5-current-android-artifact-byte-readout-20261022' };
  const runData = { id: 39858617273, run_attempt: 1, repository: { id: 470904030 },
    head_repository: { id: 470904030 }, head_sha: SOURCE, event: 'pull_request',
    head_branch: 'codex/r5-ios-startup-diagnosis-20261022', path: '.github/workflows/keeper-native-diagnostic.yml',
    status: 'completed', conclusion: 'failure', referenced_workflows: [{
      path: `KeeperCommunity/bitcoin-keeper/.github/workflows/keeper-native-platform.yml@${WORKFLOW}`,
      ref: 'refs/pull/7116/merge', sha: WORKFLOW }] };
  const jobData = { id: 120125972406, run_id: 39858617273, run_attempt: 1, head_sha: SOURCE,
    status: 'completed', conclusion: 'failure',
    steps: [['Build development app', 'success'],
      ['Run Android startup and native persistence probes', 'failure'],
      ['Retain safe Phase A evidence', 'success']].map(([name, conclusion]) => ({ name, conclusion, status: 'completed' })) };
  const artifact = { id: options.production ? 12466091444 : 991, name: `keeper-diagnostic-native-ANDROID-${SOURCE}-39858617273-1`,
    expired: false, size_in_bytes: options.production ? 8950 : PAYLOAD.length,
    digest: 'sha256:' + (options.production ? '5c3210a6b0af7bf9ea0cddb61fd1494714e8cfac0db8385960fb6390f92aa545' : DIGEST), workflow_run: {
      id: 39858617273, head_sha: SOURCE, repository_id: 470904030, head_repository_id: 470904030 } };
  const calls = [], events = [], output = [], actions = {};
  for (const [name, data] of [['getWorkflowRun', runData], ['getJobForWorkflowRun', jobData], ['getArtifact', artifact]]) {
    actions[name] = async args => { calls.push([name, args]); return { data }; };
  }
  actions.downloadArtifact = async args => { calls.push(['downloadArtifact', args]); return { data: options.payload ?? PAYLOAD }; };
  const inputs = { github: { rest: { actions } }, context, core: {
    info(value) { events.push('info'); if (options.info) throw new Error('PRIVATE_SENTINEL'); output.push(value); },
    warning(value) { events.push('warning'); if (options.warning) throw new Error('PRIVATE_SENTINEL'); output.push(value); } } };
  let text = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(text.includes(SELECTION) && text.includes(CONCLUSIONS), 'Production selection must match the observed finite receipt');
  if (!options.production) text = text.replace(SELECTION,
    `const ARTIFACT = 991, ZIP_SIZE = ${PAYLOAD.length}, DIGEST = '${DIGEST}';`);
  if (options.sourceChange) text = options.sourceChange(text);
  const api = { module: { exports: {} }, Buffer, process: { env: { RUNNER_TEMP: '/owned' } }, require(name) {
    if (name === 'node:assert/strict') return { ...assert, deepEqual(actual, expected) {
      assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
    } };
    if (name === 'node:crypto') return crypto;
    if (name === 'node:path') return path;
    if (name === 'node:fs') return {
      realpathSync: value => value,
      openSync(filename, flags, mode) { assert.equal(filename, '/owned/r5-current-android-fixed.zip'); assert.equal(flags, 'wx'); assert.equal(mode, 0o600); events.push('open'); return 42; },
      writeFileSync(fd, bytes) { assert.equal(fd, 42); assert.deepEqual(bytes, PAYLOAD); events.push('write'); if (options.write) throw new Error('PRIVATE_SENTINEL'); },
      closeSync(fd) { assert.equal(fd, 42); events.push('close'); if (options.close) throw new Error('PRIVATE_SENTINEL'); },
      unlinkSync(filename) { assert.equal(filename, '/owned/r5-current-android-fixed.zip'); events.push('unlink'); if (options.unlink) throw new Error('PRIVATE_SENTINEL'); },
    };
    if (name === 'node:child_process') return { execFileSync(command, args, settings) {
      assert.equal(command, 'python3'); assert.deepEqual(Array.from(args), ['-B', '.github/scripts/read-current-android-artifact.py']);
      assert.equal(settings.timeout, 30000); events.push('decoder');
      if (options.decoder) throw new Error('PRIVATE_SENTINEL');
      return options.wrongOutput ? 'PRIVATE_SENTINEL' :
        `FIXED_ANDROID_ARTIFACT_ZIP_BASE64_BEGIN\n${PAYLOAD.toString('base64')}\nFIXED_ANDROID_ARTIFACT_ZIP_BASE64_END\n`;
    } };
    throw new Error('Unexpected synthetic import');
  } };
  vm.runInNewContext(text, api);
  return { context, runData, jobData, artifact, calls, events, output, inputs,
    invoke: () => api.module.exports.run(inputs) };
}

test('exact production receipt admits offline API facts but rejects wrong bytes before file/log output', async () => {
  const f = fixture({ production: true, payload: Buffer.alloc(8950) });
  await assert.rejects(f.invoke, /^Error: FIXED_NATIVE_ARTIFACT_READOUT_FAILED$/);
  assert.deepEqual(f.calls.map(([name]) => name), ['getWorkflowRun', 'getJobForWorkflowRun', 'getArtifact', 'downloadArtifact']);
  assert.equal(f.calls[2][1].artifact_id, 12466091444);
  assert.equal(f.calls[3][1].artifact_id, 12466091444);
  assert.deepEqual(f.events, []); assert.deepEqual(f.output, []);
  const workflow = fs.readFileSync(path.join(__dirname, '../workflows/r5-current-android-artifact-readout.yml'), 'utf8');
  assert.ok(workflow.includes("if: ${{ github.repository == 'KeeperCommunity/bitcoin-keeper' && github.event_name == 'push' && github.ref == 'refs/heads/codex/r5-current-android-artifact-byte-readout-20261022' }}"));
});

test('synthetic bound route reads only exact Android job/artifact and deletes before original-byte log', async () => {
    const f = fixture(); await f.invoke();
    assert.deepEqual(f.calls.map(([name]) => name), ['getWorkflowRun', 'getJobForWorkflowRun', 'getArtifact', 'downloadArtifact']);
    assert.equal(f.calls[1][1].job_id, 120125972406);
    assert.equal(f.calls[3][1].artifact_id, 991);
    assert.ok(f.events.indexOf('close') < f.events.indexOf('unlink'));
    assert.ok(f.events.indexOf('unlink') < f.events.indexOf('info'));
    const lines = f.output[0].split('\n');
    assert.deepEqual(Buffer.from(lines[1], 'base64'), PAYLOAD);
    assert.equal(lines[0], 'FIXED_ANDROID_ARTIFACT_ZIP_BASE64_BEGIN');
    assert.equal(lines[2], 'FIXED_ANDROID_ARTIFACT_ZIP_BASE64_END');
});

test('partial or wrong finite selection fails before any API/filesystem operation', async () => {
  for (const [before, after] of [["const ARTIFACT = 991", "const ARTIFACT = null"],
    [`ZIP_SIZE = ${PAYLOAD.length}`, 'ZIP_SIZE = null'], [`DIGEST = '${DIGEST}'`, 'DIGEST = null'],
    ["NATIVE_CONCLUSION = 'failure'", "NATIVE_CONCLUSION = 'success'"],
    ["BUILD_CONCLUSION = 'success'", "BUILD_CONCLUSION = 'failure'"],
    ["PROBES_CONCLUSION = 'failure'", "PROBES_CONCLUSION = 'success'"]]) {
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
    const f = fixture({ production: true, payload: Buffer.alloc(8950) }); change(f);
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
