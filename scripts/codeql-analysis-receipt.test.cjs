'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { receipt } = require('./codeql-analysis-receipt.cjs');

const env = { GITHUB_REPOSITORY: 'KeeperCommunity/bitcoin-keeper', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/sprint',
  GITHUB_SHA: 'a'.repeat(40), KEEPER_WORKFLOW_SHA: 'a'.repeat(40),
  GITHUB_WORKFLOW_REF: 'KeeperCommunity/bitcoin-keeper/.github/workflows/codeql.yml@refs/heads/sprint',
  GITHUB_RUN_ID: '200', GITHUB_RUN_ATTEMPT: '1', KEEPER_CODEQL_SARIF_ID: '11111111-2222-3333-4444-555555555555' };

const privateEnv = { ...env, GITHUB_REPOSITORY: 'KeeperCommunity/bitcoin-keeper-private',
  GITHUB_REPOSITORY_ID: '839671816', KEEPER_PRIVATE_CODEQL_ENABLED: 'true',
  GITHUB_WORKFLOW_REF: 'KeeperCommunity/bitcoin-keeper-private/.github/workflows/codeql.yml@refs/heads/sprint' };

test('finite private opt-in records its actual repository without claiming entitlement or security clearance', () => {
  const value = receipt(privateEnv);
  assert.equal(value.repository, privateEnv.GITHUB_REPOSITORY);
  assert.equal(value.source_sha, privateEnv.GITHUB_SHA);
  assert.equal(value.sarif_id, privateEnv.KEEPER_CODEQL_SARIF_ID);
  assert.equal(Object.hasOwn(value, 'security_passed'), false);
  assert.equal(Object.hasOwn(value, 'entitlement_enabled'), false);
});

test('pre-analysis process rejects case-insensitive lookalikes before any output or upload receipt', () => {
  for (const enabled of ['TRUE', 'True', 'true ', 'false', '']) {
    const child = spawnSync(process.execPath, [path.join(__dirname, 'codeql-analysis-receipt.cjs'), '--check-selection'], {
      env: { ...privateEnv, KEEPER_PRIVATE_CODEQL_ENABLED: enabled }, encoding: 'utf8',
    });
    assert.notEqual(child.status, 0);
    assert.equal(child.stdout, '');
  }
  const selected = spawnSync(process.execPath, [path.join(__dirname, 'codeql-analysis-receipt.cjs'), '--check-selection'], {
    env: { GITHUB_REPOSITORY: privateEnv.GITHUB_REPOSITORY, GITHUB_REPOSITORY_ID: '839671816',
      KEEPER_PRIVATE_CODEQL_ENABLED: 'true' }, encoding: 'utf8',
  });
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.stdout, '');
});

for (const [name, fields] of [
  ['unset private selection', { KEEPER_PRIVATE_CODEQL_ENABLED: undefined }],
  ['false private selection', { KEEPER_PRIVATE_CODEQL_ENABLED: 'false' }],
  ['nonliteral private selection', { KEEPER_PRIVATE_CODEQL_ENABLED: 'TRUE' }],
  ['missing private repository ID', { GITHUB_REPOSITORY_ID: undefined }],
  ['another repository ID', { GITHUB_REPOSITORY_ID: '470904030' }],
  ['another private copy', { GITHUB_REPOSITORY: 'KeeperCommunity/another-private-copy' }],
  ['public workflow substituted into private receipt', { GITHUB_WORKFLOW_REF: env.GITHUB_WORKFLOW_REF }],
]) test(`private upload receipt rejects ${name}`, () => {
  assert.throws(() => receipt({ ...privateEnv, ...fields }), /CODEQL_UPLOAD_RECEIPT_CONTEXT_INVALID/);
});

test('official upload ID becomes bounded metadata only; credentials and SARIF never enter artifact', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-codeql-receipt-'));
  try {
    const child = spawnSync(process.execPath, [path.join(__dirname, 'codeql-analysis-receipt.cjs')], {
      env: { ...env, RUNNER_TEMP: directory, GITHUB_TOKEN: 'do-not-include-token', SARIF_CONTENT: 'do-not-include-SARIF' }, encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, '');
    const files = fs.readdirSync(path.join(directory, 'keeper-codeql-analysis'));
    assert.deepEqual(files, ['analysis.json']);
    const raw = fs.readFileSync(path.join(directory, 'keeper-codeql-analysis', files[0]), 'utf8');
    assert.ok(raw.length < 1024);
    assert.doesNotMatch(raw, /do-not-include/);
    const value = JSON.parse(raw);
    assert.equal(value.sarif_id, env.KEEPER_CODEQL_SARIF_ID);
    assert.equal(value.run_id, 200);
    assert.equal(value.run_attempt, 1);
    assert.equal(value.source_sha, env.GITHUB_SHA);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

for (const [name, fields] of [
  ['PR run', { GITHUB_EVENT_NAME: 'pull_request' }],
  ['other branch', { GITHUB_REF: 'refs/heads/dev' }],
  ['different workflow commit', { KEEPER_WORKFLOW_SHA: 'b'.repeat(40) }],
  ['uninstalled workflow', { GITHUB_WORKFLOW_REF: 'KeeperCommunity/bitcoin-keeper/.github/workflows/codeql.yml@refs/heads/feature' }],
  ['missing official output', { KEEPER_CODEQL_SARIF_ID: '' }],
  ['invalid official output', { KEEPER_CODEQL_SARIF_ID: '${github.run_id}' }],
  ['invalid attempt', { GITHUB_RUN_ATTEMPT: 'true' }],
  ['unsafe run id', { GITHUB_RUN_ID: '9007199254740993' }],
]) test(`receipt writer rejects ${name}`, () => {
  assert.throws(() => receipt({ ...env, ...fields }), /CODEQL_UPLOAD_RECEIPT_CONTEXT_INVALID/);
});

test('installed workflow captures the official action output and requires upload success', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/codeql.yml'), 'utf8');
  assert.match(workflow, /id: codeql\n\s+uses: github\/codeql-action\/analyze@[a-f0-9]{40}/);
  assert.match(workflow, /KEEPER_CODEQL_SARIF_ID: \$\{\{ steps\.codeql\.outputs\.sarif-id \}\}/);
  assert.match(workflow, /wait-for-processing: true/);
  assert.match(workflow, /name: keeper-codeql-analysis-\$\{\{ github.sha \}\}-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
  assert.match(workflow, /path: \$\{\{ runner.temp \}\}\/keeper-codeql-analysis\/analysis.json/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.doesNotMatch(workflow, /continue-on-error|workflow_dispatch|workflow_call/);
  assert.match(workflow, /fromJSON\(vars\.KEEPER_PRIVATE_CODEQL_ENABLED \|\| 'false'\) == true/);
  assert(workflow.indexOf('run: node scripts/codeql-analysis-receipt.cjs --check-selection') <
    workflow.indexOf('uses: github/codeql-action/init@'));
});
