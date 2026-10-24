'use strict';
// One finite metadata projection; no native worker, release authority or selector input.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const OWNER = 'KeeperCommunity', REPO = 'bitcoin-keeper';
const RUN = 40078818062, JOB = 120835800614;
const SOURCE = 'bea6056724dd75d1db99f4ce394ba4896edd10bf';
const WORKFLOW = 'fbb97bfe160e4b17d52bdf67aacc3f16aeb22f99', NATIVE_HEAD_BRANCH = 'codex/r5-native-failure-continuation-20261024', WORKFLOW_PULL_REF = 'refs/pull/7154/merge', RUN_CONCLUSION = 'failure';
// Exact terminal Android job/artifact API and upload facts.
const ARTIFACT = 12556810367, ZIP_SIZE = 9632, DIGEST = 'c653b9d73044a8cc67cc098ff561d5a42f0a11d49013ae88dfa9edf5bf69df1b';
const NATIVE_CONCLUSION = 'failure', STEP_CONCLUSIONS = ['success', 'failure'];
const STEPS = ['Build development app', 'Run Android startup and native persistence probes'];
const CONCLUSIONS = ['success', 'failure', 'skipped'];
const NAME = `keeper-diagnostic-native-ANDROID-${SOURCE}-${RUN}-1`;

async function run({ github, context, core }) {
  let owned, primary = false, output, stage = 'SELECTION';
  try {
    assert.match(WORKFLOW ?? '', /^[a-f0-9]{40}$/);
    assert.ok(typeof NATIVE_HEAD_BRANCH === 'string' && /^codex\/[a-z0-9-]+$/.test(NATIVE_HEAD_BRANCH));
    assert.match(WORKFLOW_PULL_REF ?? '', /^refs\/pull\/[1-9][0-9]*\/merge$/);
    assert.ok(['success', 'failure'].includes(RUN_CONCLUSION));
    assert.ok(Number.isSafeInteger(ARTIFACT) && ARTIFACT > 0);
    assert.ok(Number.isSafeInteger(ZIP_SIZE) && ZIP_SIZE > 0 && ZIP_SIZE <= 1024 * 1024 + 4096);
    assert.match(DIGEST ?? '', /^[a-f0-9]{64}$/);
    assert.ok(['success', 'failure'].includes(NATIVE_CONCLUSION));
    assert.ok(Array.isArray(STEP_CONCLUSIONS) && STEP_CONCLUSIONS.length === STEPS.length &&
      STEPS.every((_, index) => CONCLUSIONS.includes(STEP_CONCLUSIONS[index])));
    assert.equal(context.repo.owner, OWNER); assert.equal(context.repo.repo, REPO);
    assert.equal(context.eventName, 'push');
    assert.equal(context.ref, 'refs/heads/codex/r5-bea-android-artifact-readout-20261024');
    const args = { owner: OWNER, repo: REPO, request: { timeout: 30000 } };
    const admit = async () => {
    stage = 'API_LOOKUP';
    const [r, j, a] = await Promise.all([
      github.rest.actions.getWorkflowRun({ ...args, run_id: RUN }),
      github.rest.actions.getJobForWorkflowRun({ ...args, job_id: JOB }),
      github.rest.actions.getArtifact({ ...args, artifact_id: ARTIFACT }),
    ]);
    stage = 'RUN_BINDING';
    assert.equal(r.data.id, RUN); assert.equal(r.data.run_attempt, 1);
    assert.equal(r.data.repository.id, 470904030); assert.equal(r.data.head_repository.id, 470904030);
    assert.equal(r.data.head_sha, SOURCE); assert.equal(r.data.event, 'pull_request');
    assert.equal(r.data.head_branch, NATIVE_HEAD_BRANCH);
    assert.equal(r.data.path, '.github/workflows/keeper-native-diagnostic.yml');
    assert.equal(r.data.status, 'completed'); assert.equal(r.data.conclusion, RUN_CONCLUSION);
    assert.deepEqual(r.data.referenced_workflows, [{
      path: `${OWNER}/${REPO}/.github/workflows/keeper-native-platform.yml@${WORKFLOW}`,
      ref: WORKFLOW_PULL_REF, sha: WORKFLOW,
    }]);
    stage = 'JOB_BINDING';
    assert.equal(j.data.id, JOB); assert.equal(j.data.run_id, RUN); assert.equal(j.data.run_attempt, 1);
    assert.equal(j.data.head_sha, SOURCE); assert.equal(j.data.status, 'completed');
    assert.equal(j.data.conclusion, NATIVE_CONCLUSION);
    for (const [index, name] of STEPS.entries()) {
      const steps = j.data.steps.filter(step => step.name === name);
      assert.equal(steps.length, 1); assert.equal(steps[0].status, 'completed');
      assert.equal(steps[0].conclusion, STEP_CONCLUSIONS[index]);
    }
    const upload = j.data.steps.filter(step => step.name === 'Retain safe Phase A evidence');
    assert.equal(upload.length, 1); assert.equal(upload[0].status, 'completed');
    assert.equal(upload[0].conclusion, 'success');
    stage = 'ARTIFACT_BINDING';
    assert.equal(a.data.id, ARTIFACT); assert.equal(a.data.name, NAME);
    assert.equal(a.data.expired, false); assert.equal(a.data.size_in_bytes, ZIP_SIZE);
    assert.equal(a.data.digest, `sha256:${DIGEST}`);
    assert.equal(a.data.workflow_run.id, RUN); assert.equal(a.data.workflow_run.head_sha, SOURCE);
    assert.equal(a.data.workflow_run.repository_id, 470904030);
    assert.equal(a.data.workflow_run.head_repository_id, 470904030);
    };
    await admit();
    stage = 'DOWNLOAD';
    const download = await github.rest.actions.downloadArtifact({ ...args, artifact_id: ARTIFACT, archive_format: 'zip' });
    const bytes = Buffer.from(download.data);
    assert.equal(bytes.length, ZIP_SIZE);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), DIGEST);
    stage = 'PRIVATE_FILE';
    const temp = process.env.RUNNER_TEMP;
    assert.ok(temp && path.isAbsolute(temp)); assert.equal(fs.realpathSync(temp), path.resolve(temp));
    const filename = path.join(temp, 'r5-bea-android-fixed.zip');
    const descriptor = fs.openSync(filename, 'wx', 0o600); owned = filename;
    try { fs.writeFileSync(descriptor, bytes); }
    finally { fs.closeSync(descriptor); }
    stage = 'DECODE';
    try {
      output = execFileSync('python3', ['-B', '.github/scripts/read-bea-android-artifact.py'],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      const match = /^BEA_ANDROID_OBSERVATION_READOUT_FAILED:(SELECTION|PRIVATE_FILE|KERNEL|ZIP_IDENTITY|ZIP_LAYOUT|JSON|ROOT_KEYS|PRODUCT|PROJECTED_METADATA)\n$/.exec(String(error.stdout ?? ''));
      if (match) stage = 'DECODE_' + match[1];
      throw error;
    }
    stage = 'PROJECTION_FRAME';
    const lines = output.trim().split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[0], 'BEA_ANDROID_OBSERVATIONS_BEGIN');
    assert.equal(lines[2], 'BEA_ANDROID_OBSERVATIONS_END');
    const projection = JSON.parse(lines[1]);
    assert.deepEqual(Object.keys(projection).sort(), ['schema', 'scope', 'original_zip_sha256', 'metadata_sha256', 'observations'].sort());
    assert.equal(projection.schema, 1);
    assert.equal(projection.scope, 'OBSERVATIONS_ONLY_NOT_NATIVE_ACCEPTANCE_OR_CAUSE');
    assert.equal(projection.original_zip_sha256, DIGEST);
    assert.match(projection.metadata_sha256, /^[a-f0-9]{64}$/);
    assert.equal(projection.observations.source_sha, SOURCE);
    assert.equal(projection.observations.run_id, String(RUN));
    assert.equal(projection.observations.run_attempt, '1');
    await admit(); // Recheck official immutable source/workflow/job/attempt/artifact before releasing output.
  } catch (_) {
    primary = true;
    throw new Error('FIXED_NATIVE_ARTIFACT_READOUT_FAILED_' + stage);
  } finally {
    if (owned) {
      try { fs.unlinkSync(owned); }
      catch (_) {
        try { core.warning('FIXED_NATIVE_ARTIFACT_PRIVATE_CLEANUP_FAILED'); } catch (_) { /* retain primary */ }
        if (!primary) throw new Error('FIXED_NATIVE_ARTIFACT_PRIVATE_CLEANUP_FAILED');
      }
    }
  }
  try { core.info(output.trim()); }
  catch (_) { throw new Error('FIXED_NATIVE_ARTIFACT_READOUT_FAILED'); }
}
module.exports = { run };
