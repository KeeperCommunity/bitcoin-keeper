'use strict';
// Retrieve one existing diagnostic receipt. No native/release/provider operation.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const OWNER = 'KeeperCommunity', REPO = 'bitcoin-keeper';
const RUN = 39846002094, JOB = 120075215316, ARTIFACT = 12458149136;
const SOURCE = '23f14e01f3437c213f1443c3167d96022f3a43bc';
const WORKFLOW = '1f084ee4486709e0066034a452349df897eb2434';
const DIGEST = '4d464ef5f8faa7de4f02292e683f0dad8242544843610da9371f2c675dc183f0';
const NAME = `keeper-diagnostic-native-ANDROID-${SOURCE}-${RUN}-1`;

async function run({ github, context, core }) {
  let owned, primary = false, output;
  try {
    assert.equal(context.repo.owner, OWNER); assert.equal(context.repo.repo, REPO);
    assert.equal(context.eventName, 'push');
    assert.equal(context.ref, 'refs/heads/codex/r5-23f-artifact-readout');
    const args = { owner: OWNER, repo: REPO, request: { timeout: 30000 } };
    const [r, j, a] = await Promise.all([
      github.rest.actions.getWorkflowRun({ ...args, run_id: RUN }),
      github.rest.actions.getJobForWorkflowRun({ ...args, job_id: JOB }),
      github.rest.actions.getArtifact({ ...args, artifact_id: ARTIFACT }),
    ]);
    assert.equal(r.data.id, RUN); assert.equal(r.data.run_attempt, 1);
    assert.equal(r.data.repository.id, 470904030); assert.equal(r.data.head_repository.id, 470904030);
    assert.equal(r.data.head_sha, SOURCE); assert.equal(r.data.event, 'pull_request');
    assert.equal(r.data.head_branch, 'codex/r5-native-acceptance-20261022');
    assert.equal(r.data.path, '.github/workflows/keeper-native-diagnostic.yml');
    assert.equal(r.data.status, 'completed'); assert.equal(r.data.conclusion, 'failure');
    assert.deepEqual(r.data.referenced_workflows, [{
      path: `${OWNER}/${REPO}/.github/workflows/keeper-native-platform.yml@${WORKFLOW}`,
      ref: 'refs/pull/7107/merge', sha: WORKFLOW,
    }]);
    assert.equal(j.data.id, JOB); assert.equal(j.data.run_id, RUN); assert.equal(j.data.head_sha, SOURCE);
    assert.equal(j.data.status, 'completed'); assert.equal(j.data.conclusion, 'failure');
    for (const [name, conclusion] of [['Build development app', 'success'],
      ['Run Android startup and native persistence probes', 'failure'], ['Retain safe Phase A evidence', 'success']]) {
      const steps = j.data.steps.filter(step => step.name === name);
      assert.equal(steps.length, 1); assert.equal(steps[0].status, 'completed');
      assert.equal(steps[0].conclusion, conclusion);
    }
    assert.equal(a.data.id, ARTIFACT); assert.equal(a.data.name, NAME);
    assert.equal(a.data.expired, false); assert.equal(a.data.size_in_bytes, 8395);
    assert.equal(a.data.digest, `sha256:${DIGEST}`);
    assert.equal(a.data.workflow_run.id, RUN); assert.equal(a.data.workflow_run.head_sha, SOURCE);
    assert.equal(a.data.workflow_run.repository_id, 470904030);
    assert.equal(a.data.workflow_run.head_repository_id, 470904030);
    const download = await github.rest.actions.downloadArtifact({ ...args, artifact_id: ARTIFACT, archive_format: 'zip' });
    const bytes = Buffer.from(download.data);
    assert.equal(bytes.length, 8395);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), DIGEST);
    const temp = process.env.RUNNER_TEMP;
    assert.ok(temp && path.isAbsolute(temp));
    assert.equal(fs.realpathSync(temp), path.resolve(temp));
    const filename = path.join(temp, 'r5-23f-android-fixed.zip');
    const descriptor = fs.openSync(filename, 'wx', 0o600); owned = filename;
    try { fs.writeFileSync(descriptor, bytes); }
    finally { fs.closeSync(descriptor); }
    output = execFileSync('python3', ['-B', '.github/scripts/read-23f-android-artifact.py'],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.ok(output.startsWith('SAFE_R5_ANDROID_READOUT '));
  } catch (_) {
    primary = true;
    throw new Error('FIXED_NATIVE_ARTIFACT_READOUT_FAILED');
  } finally {
    if (owned) {
      try { fs.unlinkSync(owned); }
      catch (_) {
        try { core.warning('FIXED_NATIVE_ARTIFACT_PRIVATE_CLEANUP_FAILED'); } catch (_) { /* retain primary */ }
        if (!primary) throw new Error('FIXED_NATIVE_ARTIFACT_PRIVATE_CLEANUP_FAILED');
      }
    }
  }
  try { core.info(output.trim()); } // Only the reviewed reconstructed Python receipt.
  catch (_) { throw new Error('FIXED_NATIVE_ARTIFACT_READOUT_FAILED'); }
}
module.exports = { run };
