'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const download = require('../native/ios_signature_download.cjs');
const source = 'ddcd0970f80e23adf86a093cf3eebf8ad363cec9';
const digest = 'fd1f27948a19811ecd9c80a6fe0a400a290766fbdaa5b55ef5eaa02b1224db37';
function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'signature-download-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const rows = {
    repository: { id: 839671816, private: true },
    pr: { head: { repo: { id: 839671816 }, sha: 'f'.repeat(40) }, labels: [{ name: 'keeper/ios-signature-comparison' }] },
    run: { id: 40189694110, run_attempt: 1, head_sha: source, status: 'completed', conclusion: 'failure', workflow_id: 395792275 },
    artifact: { id: 12598443612, expired: false, size_in_bytes: 33100856,
      name: `keeper-private-ios-simulator-app-${source}-40189694110-1`, digest: `sha256:${digest}`,
      workflow_run: { id: 40189694110, head_sha: source, repository_id: 839671816, head_repository_id: 839671816 } },
  };
  let fetched = 0;
  const github = { rest: { repos: { get: async () => ({ data: rows.repository }) },
    pulls: { get: async () => ({ data: rows.pr }) }, actions: {
      getWorkflowRun: async () => ({ data: rows.run }), getArtifact: async () => ({ data: rows.artifact }),
      downloadArtifact: async () => { fetched++; return { data: Buffer.from('MUTATED_ZIP') }; },
    } } };
  return { rows, fetched: () => fetched, args: { github,
    context: { repo: { owner: 'KeeperCommunity', repo: 'bitcoin-keeper-private' }, payload: {
      pull_request: { number: 73 }, action: 'labeled', label: { name: 'keeper/ios-signature-comparison' } } },
    env: { RUNNER_TEMP: folder, KEEPER_SOURCE_SHA: 'f'.repeat(40) } }, folder };
}
test('rejects moved source, public repository and absent opt-in before artifact retrieval', async t => {
  for (const mutate of [x => x.pr.head.sha = 'e'.repeat(40), x => x.repository.private = false, x => x.pr.labels = []]) {
    const f = fixture(t); mutate(f.rows);
    await assert.rejects(download(f.args), /selection changed/);
    assert.equal(f.fetched(), 0);
  }
});
test('rejects stale original run and wrong artifact provenance without downloading', async t => {
  for (const mutate of [x => x.run.run_attempt = 2, x => x.artifact.expired = true,
    x => x.artifact.workflow_run.repository_id = 1, x => x.artifact.digest = 'sha256:' + '0'.repeat(64)]) {
    const f = fixture(t); mutate(f.rows);
    await assert.rejects(download(f.args), /identity changed/);
    assert.equal(f.fetched(), 0);
  }
});
test('actual returned ZIP bytes must match size and SHA before private write', async t => {
  const f = fixture(t);
  await assert.rejects(download(f.args), /ZIP bytes changed/);
  assert.equal(f.fetched(), 1);
  assert.deepEqual(fs.readdirSync(f.folder), []);
});
