'use strict';
// Prepared fixed transport; unavailable job/artifact bindings reject before I/O.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const OWNER = 'KeeperCommunity', REPO = 'bitcoin-keeper';
const RUN = 39873063291;
const JOB = null;
const SOURCE = '044ebb6ea2d465f6a70e9116e3feac5a604cd696';
const WORKFLOW = '5a7b0c5da0a38197f6dd675ff424f3ba3f441d02';
// Bind only after observing the actual completed Android job and artifact APIs.
const ARTIFACT = null, ZIP_SIZE = null, DIGEST = null;
const RUN_CONCLUSION = null, NATIVE_CONCLUSION = null, BUILD_CONCLUSION = null, PROBES_CONCLUSION = null;
const NAME = `keeper-diagnostic-native-ANDROID-${SOURCE}-${RUN}-1`;

async function run({ github, context, core }) {
  let owned, primary = false, output;
  try {
    // Check the finite selection before API, filesystem or decoder operations.
    assert.ok(Number.isSafeInteger(JOB) && JOB > 0);
    assert.ok(Number.isSafeInteger(ARTIFACT) && ARTIFACT > 0);
    assert.ok(Number.isSafeInteger(ZIP_SIZE) && ZIP_SIZE > 0 && ZIP_SIZE <= 1024 * 1024 + 4096);
    assert.match(DIGEST ?? '', /^[a-f0-9]{64}$/);
    assert.ok(['success', 'failure'].includes(RUN_CONCLUSION));
    assert.ok(['success', 'failure'].includes(NATIVE_CONCLUSION));
    assert.ok(['success', 'failure', 'skipped'].includes(BUILD_CONCLUSION));
    assert.ok(['success', 'failure', 'skipped'].includes(PROBES_CONCLUSION));
    assert.equal(context.repo.owner, OWNER); assert.equal(context.repo.repo, REPO);
    assert.equal(context.eventName, 'push');
    assert.equal(context.ref, 'refs/heads/codex/r5-044-artifact-readout-preparation-20261023');
    const args = { owner: OWNER, repo: REPO, request: { timeout: 30000 } };
    const [r, j, a] = await Promise.all([
      github.rest.actions.getWorkflowRun({ ...args, run_id: RUN }),
      github.rest.actions.getJobForWorkflowRun({ ...args, job_id: JOB }),
      github.rest.actions.getArtifact({ ...args, artifact_id: ARTIFACT }),
    ]);
    assert.equal(r.data.id, RUN); assert.equal(r.data.run_attempt, 1);
    assert.equal(r.data.repository.id, 470904030); assert.equal(r.data.head_repository.id, 470904030);
    assert.equal(r.data.head_sha, SOURCE); assert.equal(r.data.event, 'pull_request');
    assert.equal(r.data.head_branch, 'codex/r5-startup-credential-failure-observation-20261022');
    assert.equal(r.data.path, '.github/workflows/keeper-native-diagnostic.yml');
    assert.equal(r.data.status, 'completed'); assert.equal(r.data.conclusion, RUN_CONCLUSION);
    assert.deepEqual(r.data.referenced_workflows, [{
      path: `${OWNER}/${REPO}/.github/workflows/keeper-native-platform.yml@${WORKFLOW}`,
      ref: 'refs/pull/7131/merge', sha: WORKFLOW,
    }]);
    assert.equal(j.data.run_attempt, 1);
    assert.equal(j.data.id, JOB); assert.equal(j.data.run_id, RUN); assert.equal(j.data.head_sha, SOURCE);
    assert.equal(j.data.status, 'completed'); assert.equal(j.data.conclusion, NATIVE_CONCLUSION);
    for (const [name, conclusion] of [['Build development app', BUILD_CONCLUSION],
      ['Run Android startup and native persistence probes', PROBES_CONCLUSION],
      ['Retain safe Phase A evidence', 'success']]) {
      const steps = j.data.steps.filter(step => step.name === name);
      assert.equal(steps.length, 1); assert.equal(steps[0].status, 'completed');
      assert.equal(steps[0].conclusion, conclusion);
    }
    assert.equal(a.data.id, ARTIFACT); assert.equal(a.data.name, NAME);
    assert.equal(a.data.expired, false); assert.equal(a.data.size_in_bytes, ZIP_SIZE);
    assert.equal(a.data.digest, `sha256:${DIGEST}`);
    assert.equal(a.data.workflow_run.id, RUN); assert.equal(a.data.workflow_run.head_sha, SOURCE);
    assert.equal(a.data.workflow_run.repository_id, 470904030);
    assert.equal(a.data.workflow_run.head_repository_id, 470904030);
    const download = await github.rest.actions.downloadArtifact({ ...args, artifact_id: ARTIFACT, archive_format: 'zip' });
    const bytes = Buffer.from(download.data);
    assert.equal(bytes.length, ZIP_SIZE);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), DIGEST);
    const temp = process.env.RUNNER_TEMP;
    assert.ok(temp && path.isAbsolute(temp));
    assert.equal(fs.realpathSync(temp), path.resolve(temp));
    const filename = path.join(temp, 'r5-044-android-fixed.zip');
    const descriptor = fs.openSync(filename, 'wx', 0o600); owned = filename;
    try { fs.writeFileSync(descriptor, bytes); }
    finally { fs.closeSync(descriptor); }
    output = execFileSync('python3', ['-B', '.github/scripts/read-044-android-artifact.py'],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(output, 'FIXED_044_ANDROID_ARTIFACT_ZIP_BASE64_BEGIN\n' + bytes.toString('base64') +
      '\nFIXED_044_ANDROID_ARTIFACT_ZIP_BASE64_END\n');
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
  try { core.info(output.trim()); }
  catch (_) { throw new Error('FIXED_NATIVE_ARTIFACT_READOUT_FAILED'); }
}
module.exports = { run };
