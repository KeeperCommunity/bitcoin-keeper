#!/usr/bin/env node
'use strict';

// Capture only the official analyze action's upload ID, never SARIF contents.
const fs = require('node:fs');
const path = require('node:path');
const profiles = require('../.github/native/release_repository_profiles.cjs');
const WORKFLOW = '.github/workflows/codeql.yml';
const CATEGORY = 'keeper-javascript-typescript/';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function selection(env) {
  let profile;
  try { profile = profiles.forRepository(env.GITHUB_REPOSITORY); }
  catch { throw new Error('CODEQL_UPLOAD_RECEIPT_CONTEXT_INVALID'); }
  const privateSelection = !profile.private ||
    (env.GITHUB_REPOSITORY_ID === String(profile.repositoryId) && env.KEEPER_PRIVATE_CODEQL_ENABLED === 'true');
  const repositoryIdMatches = env.GITHUB_REPOSITORY_ID == null || env.GITHUB_REPOSITORY_ID === String(profile.repositoryId);
  if (!privateSelection || !repositoryIdMatches) throw new Error('CODEQL_UPLOAD_RECEIPT_CONTEXT_INVALID');
  return profile;
}

function receipt(env) {
  const profile = selection(env);
  const integer = value => /^[1-9]\d*$/.test(value || '') && Number.isSafeInteger(Number(value));
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/sprint' ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '') || env.KEEPER_WORKFLOW_SHA !== env.GITHUB_SHA ||
    env.GITHUB_WORKFLOW_REF !== `${profile.repository}/${WORKFLOW}@refs/heads/sprint` ||
    !integer(env.GITHUB_RUN_ID) || !integer(env.GITHUB_RUN_ATTEMPT) || !UUID.test(env.KEEPER_CODEQL_SARIF_ID || '')) {
    throw new Error('CODEQL_UPLOAD_RECEIPT_CONTEXT_INVALID');
  }
  return { schema: 1, kind: 'keeper-codeql-upload', repository: profile.repository, source_sha: env.GITHUB_SHA,
    source_ref: env.GITHUB_REF, workflow_sha: env.KEEPER_WORKFLOW_SHA, workflow_path: WORKFLOW,
    run_id: Number(env.GITHUB_RUN_ID), run_attempt: Number(env.GITHUB_RUN_ATTEMPT),
    analysis_key: `${WORKFLOW}:analyze`, category: CATEGORY, sarif_id: env.KEEPER_CODEQL_SARIF_ID };
}

if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === '--check-selection') {
    selection(process.env);
    process.exit(0);
  }
  if (process.argv.length !== 2) throw new Error('CODEQL_UPLOAD_RECEIPT_CONTEXT_INVALID');
  const value = receipt(process.env);
  const directory = path.join(process.env.RUNNER_TEMP, 'keeper-codeql-analysis');
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'analysis.json'), JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
}

module.exports = { receipt, selection, UUID, CATEGORY };
