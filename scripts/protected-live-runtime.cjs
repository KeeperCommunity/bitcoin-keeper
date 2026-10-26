'use strict';
// Only the current installed SDK worker calls this bridge, after its branded
// source/security/native/actor proof. Caller JSON is never authorization.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const readline = require('node:readline');
const { isDeepStrictEqual: equal } = require('node:util');
const live = require('./live-store-request.cjs');
const profiles = require('../.github/native/release_repository_profiles.cjs');
const demand = (ok, code) => { if (!ok) throw new Error(code); };
function requireBudget(plan, now = Date.now()) {
  const expires = Date.parse(plan?.authorizationExpiresAt);
  demand(Number.isFinite(expires) && expires > now + 2 * 3600000, 'LIVE_AUTHORIZATION_BUDGET');
  return plan.authorizationExpiresAt;
}

function validateUpload(request, artifact, run, receipt) {
  const profile = profiles.forRepository(request.repository);
  demand(!profile.private || (receipt.repository === profile.repository && receipt.repositoryId === profile.repositoryId && receipt.repositoryPrivate === true), 'LIVE_RECEIPT_REPOSITORY');
  const upload = request.operation.startsWith('ios-') ? 'testflight-upload' : 'play-internal-upload';
  demand(artifact.expired === false && artifact.workflow_run?.head_sha === request.sourceSha &&
    run.id === artifact.workflow_run.id && run.head_sha === request.sourceSha &&
    run.head_repository?.full_name === request.repository && run.event === 'workflow_dispatch' &&
    run.status === 'completed' && run.conclusion === 'success' && run.head_branch === 'sprint' &&
    run.repository?.id === profile.repositoryId && run.head_repository?.id === profile.repositoryId &&
    (!profile.private || (profiles.matches(run.repository, profile) && profiles.matches(run.head_repository, profile))) &&
    run.path === '.github/workflows/keeper-protected-release-workers.yml', 'LIVE_UPLOAD_PRODUCER');
  demand(receipt.schema === 1 && receipt.operation === upload && receipt.signatureVerified === true &&
    receipt.storeUploaded === true && receipt.sourceSha === request.sourceSha && receipt.driverSha === request.sourceSha &&
    ['version', 'build', 'artifactSha256', 'identitySha256', 'configSha256'].every(key => receipt[key] === request[key]) &&
    String(receipt.runId) === String(run.id) && receipt.runAttempt === run.run_attempt &&
    /^[1-9]\d{0,18}$/.test(receipt.artifactId || '') && Number.isSafeInteger(receipt.sourceRunId) &&
    receipt.sourceRunId > 0 && Number.isSafeInteger(receipt.sourceRunAttempt) && receipt.sourceRunAttempt > 0, 'LIVE_UPLOAD_RECEIPT');
}

async function runChild({ root, directory, childEnv, expected, refresh, upload, signed }) {
  const file = path.join(directory, 'live-context.json');
  fs.writeFileSync(file, JSON.stringify({ request: expected.request, provider: expected.provider,
    uploadReceipt: upload, signedReceipt: signed }), { mode: 0o600 });
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-B', path.join(__dirname, 'live_store_worker.py'), file, root, directory],
      { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let failed = false, result, sequence = 0, total = 0;
    const stop = () => { failed = true; child.kill('SIGTERM'); };
    const timer = setTimeout(stop, 30 * 60000);
    child.stdin.on('error', stop);
    // Capture no raw provider/native/credential diagnostics.
    child.stderr.on('data', chunk => { total += chunk.length; if (total > 65536) stop(); });
    let pending = Promise.resolve();
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    child.stdout.on('data', chunk => { total += chunk.length; if (total > 65536) stop(); });
    lines.on('line', line => {
      pending = pending.then(async () => {
        demand(line.length < 16384 && !failed, 'LIVE_CHILD_PROTOCOL');
        const value = require('../.github/native/strict_json.cjs').parseStrictJson(Buffer.from(line), 16384);
        if (value.kind === 'authorize') {
          demand(!result && value.sequence === ++sequence && equal(value.request, expected.provider), 'LIVE_CHILD_SCOPE');
          const deadline = requireBudget(await refresh());
          child.stdin.write(JSON.stringify({ sequence, authorized: true, authorizationExpiresAt: deadline }) + '\n');
        } else {
          demand(value.kind === 'result' && !result && value.value?.operation === expected.request.operation &&
            value.value.publicAvailabilityVerified === false, 'LIVE_CHILD_RESULT');
          result = value.value;
        }
      }).catch(stop);
    });
    child.on('error', () => { clearTimeout(timer); reject(new Error('LIVE_CHILD_UNAVAILABLE')); });
    child.on('close', code => {
      clearTimeout(timer);
      pending.then(() => {
        if (failed || code !== 0 || !result || sequence < 1) reject(new Error('LIVE_OPERATION_OUTCOME_REQUIRES_INSPECTION'));
        else resolve(result);
      }).catch(() => reject(new Error('LIVE_CHILD_FAILED')));
    });
  });
}

async function execute({ request, root, directory, github, context, env, fresh, fetchImpl,
  childEnv, downloadSignedArtifact, validateArtifactRun }) {
  requireBudget(await fresh());
  const api = require('./current-release-origin.cjs').sdk(github, fetchImpl, request.repository);
  const workflow = (await api.json('actions/workflows/keeper-protected-release-workers.yml')).value;
  demand(workflow.state === 'active' && Number.isSafeInteger(workflow.id) &&
    workflow.path === '.github/workflows/keeper-protected-release-workers.yml', 'LIVE_WORKFLOW');
  const records = [];
  async function archive(id, destination, receiptOnly = false) {
    const artifact = (await api.json('actions/artifacts/' + id)).value;
    demand(artifact.id === Number(id) && !artifact.expired && artifact.workflow_run?.head_sha === request.sourceSha,
      'LIVE_ARCHIVE_IDENTITY');
    demand(!receiptOnly || artifact.size_in_bytes <= 65536, 'LIVE_UPLOAD_ARCHIVE_LIMIT');
    const run = (await api.json('actions/runs/' + artifact.workflow_run.id)).value;
    demand(run.workflow_id === workflow.id, 'LIVE_ARCHIVE_WORKFLOW');
    await downloadSignedArtifact(github, artifact, destination, { fetchImpl, repository: request.repository });
    records.push({ artifact, run });
    return { artifact, run };
  }
  const uploadArchive = path.join(directory, 'upload.zip');
  const uploadRecord = await archive(request.artifactId, uploadArchive, true);
  const adapter = path.join(__dirname, 'live_store_worker.py');
  const upload = JSON.parse(execFileSync('python3', ['-B', adapter, 'unpack-upload', uploadArchive, directory],
    { env: { PATH: childEnv.PATH }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  validateUpload(request, uploadRecord.artifact, uploadRecord.run, upload);
  const signedArchive = path.join(directory, 'artifact.zip');
  const signedRecord = await archive(upload.artifactId, signedArchive);
  demand(signedRecord.run.id === upload.sourceRunId && signedRecord.run.run_attempt === upload.sourceRunAttempt,
    'LIVE_SIGNED_UPLOAD_CHAIN');
  const unpackContext = { ...request, operation: request.operation.startsWith('ios-') ? 'testflight-upload' : 'play-internal-upload' };
  const contextFile = path.join(directory, 'signed-context.json');
  fs.writeFileSync(contextFile, JSON.stringify(unpackContext), { mode: 0o600 });
  const signed = JSON.parse(execFileSync('python3', [path.join(__dirname, 'cloud_release_worker.py'), 'unpack', contextFile, directory],
    { env: { PATH: childEnv.PATH }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  validateArtifactRun(unpackContext, signedRecord.artifact, signedRecord.run, signed);
  async function refresh() {
    const plan = await fresh(); requireBudget(plan);
    demand(equal((await api.json('actions/workflows/keeper-protected-release-workers.yml')).value, workflow), 'LIVE_WORKFLOW_CHANGED');
    for (const record of records) {
      const artifact = (await api.json('actions/artifacts/' + record.artifact.id)).value;
      demand(equal(artifact, record.artifact) &&
        equal((await api.json('actions/runs/' + record.run.id)).value, record.run), 'LIVE_UPLOAD_PROVENANCE_CHANGED');
    }
    requireBudget(plan);
    return plan;
  }
  await refresh();
  const provider = live.providerRequest(request, upload);
  return runChild({ root, directory, childEnv, expected: { request, provider }, refresh, upload, signed });
}
module.exports = { validateUpload, runChild, execute, requireBudget };
