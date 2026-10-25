'use strict';
// Host-only source admission fixtures. Never installed policy or native evidence.
const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..');
const profile = { repository: 'KeeperCommunity/bitcoin-keeper-relay', repositoryId: 496119449,
  workflowPath: '.github/workflows/r5-native-integration.yml',
  ref: 'refs/heads/codex/r5-native-integration-execution-20261022',
  driverBase: '448e09d7a373fc7e9d9c540880b45e2c742997f7',
  backendSha: '29597b27eeeb299205bf7d0555db0a90c38cc4be', rawProfile: 'D448_RAW13' };
function canonicalFixture() {
  const file = path.join(root, '.github/tests/canonical-native.test.cjs');
  const text = fs.readFileSync(file, 'utf8').split('\nfunction origin(')[0];
  if (!text.endsWith('}\n')) throw new Error('fixture source changed');
  const module = { exports: {} };
  new Function('require', 'module', text + '\nmodule.exports = fixture;')(createRequire(file), module);
  return module.exports();
}
function manifest(f) {
  const app = { repository: 'KeeperCommunity/bitcoin-keeper', sha: f.request.sourceSha, tree: 'c'.repeat(40) };
  const backend = { repository: profile.repository, sha: profile.backendSha }, privateWindows = {};
  for (const [i, platform] of ['IOS', 'ANDROID'].entries()) {
    const control = { repository: profile.repository, sha: (i ? 'e' : 'c').repeat(40), tree: (i ? 'f' : 'd').repeat(40) };
    privateWindows[platform] = { platform, app: structuredClone(app), control, backend: structuredClone(backend), execution: {
      repository: profile.repository, workflowPath: profile.workflowPath, workflowSha: control.sha, ref: profile.ref,
      runId: 123 + i, runAttempt: 2 } };
  }
  return { schema: 1, profile: 'synthetic-reviewed-profile', window_id: '1'.repeat(64), app, backend,
    public: { workflowPath: '.github/workflows/keeper-canonical-native.yml', workflowSha: f.request.workflowSha,
      ref: 'refs/heads/sprint', runId: f.request.runId, runAttempt: f.request.attempt }, private: privateWindows };
}
function withWindow(f) {
  f.window = manifest(f); f.windowReads = 0;
  const original = f.pinReader.rest.actions.getRepoVariable;
  f.pinReader.rest.actions.getRepoVariable = async args => {
    if (args.name === 'KEEPER_CANONICAL_NATIVE_DRIVER_SHA') return original(args);
    if (args.name !== 'KEEPER_CANONICAL_PRIVATE_WINDOW_JSON' || args.headers['cache-control'] !== 'no-cache') throw new Error('unexpected read');
    f.windowReads++;
    if (f.windowUnavailable) throw new Error('private API detail must not escape');
    return { data: { name: args.name, value: f.rawWindow ?? JSON.stringify(f.window) } };
  };
  return f;
}
function loadWindow({ installed = true, typesOnly = false } = {}) {
  const file = path.join(root, '.github/native/installed_parent_window.cjs');
  let text = fs.readFileSync(file, 'utf8');
  if (installed) {
    const needle = 'const INSTALLED_PROFILES = Object.freeze({});';
    if (text.split(needle).length !== 2) throw new Error('policy seam changed');
    text = text.replace(needle, `const INSTALLED_PROFILES = Object.freeze(${JSON.stringify({ 'synthetic-reviewed-profile': profile })});`);
  }
  const module = { exports: {} };
  if (typesOnly) text += '\nmodule.exports.typePredicates = { sha, hex };';
  new Function('require', 'module', 'Buffer', text)(createRequire(file), module, Buffer);
  return module.exports;
}
module.exports = { canonicalFixture, manifest, withWindow, loadWindow, profile };
