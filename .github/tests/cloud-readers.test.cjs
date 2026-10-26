'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const workflow = fs.readFileSync(path.join(__dirname, '../workflows/keeper-cloud-readers.yml'), 'utf8');
const scriptMatch = workflow.match(/          script: \|\n([\s\S]*)$/);
assert.ok(scriptMatch, 'test the actual installed inline script');
const script = scriptMatch[1].split('\n').map(line => line.startsWith('            ') ? line.slice(12) : line).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('fetch', 'core', 'process', script);
const settingsToken = 'github_pat_' + 's'.repeat(30);
const privateToken = 'github_pat_' + 'p'.repeat(30);
const settingsUrl = 'https://api.github.com/repos/KeeperCommunity/bitcoin-keeper/actions/variables?per_page=1';
const privateUrl = 'https://api.github.com/repos/KeeperCommunity/bitcoin-keeper-private/actions/runs?per_page=1';

function fixture(options = {}) {
  const calls = [], messages = [], masked = [];
  const process = { env: { SETTINGS_READER: settingsToken, PRIVATE_TEST_READER: privateToken, ...(options.env || {}) } };
  const summary = {
    addHeading(text) { messages.push(text); return this; },
    addRaw(text) { messages.push(text); return this; },
    async write() { messages.push('summary written'); },
  };
  const core = { setSecret(value) { masked.push(value); }, info(value) { messages.push(value); }, summary };
  const fetch = async (url, request) => {
    assert.equal(process.env.SETTINGS_READER, undefined);
    assert.equal(process.env.PRIVATE_TEST_READER, undefined);
    assert.equal(request.method, 'GET');
    assert.equal(request.redirect, 'error');
    assert.ok(request.signal instanceof AbortSignal);
    assert.ok([settingsUrl, privateUrl].includes(url));
    const token = request.headers.Authorization.slice('Bearer '.length);
    calls.push({ url, token });
    if (options.transportError) throw new Error(settingsToken + ' private transport detail');
    const allowed = (token === settingsToken && url === settingsUrl) || (token === privateToken && url === privateUrl);
    const status = allowed ? (options.allowedStatus || 200) : (options.deniedStatus || 404);
    return { status, async json() {
      if (options.invalidJson) throw new Error(privateToken + ' response detail');
      if (options.invalidShape) return { unexpected: true };
      return url === settingsUrl ? { variables: [{ name: 'PRIVATE', value: 'private configuration value' }] }
        : { workflow_runs: [{ name: 'private job details', id: 123 }] };
    } };
  };
  return { calls, messages, masked, run: () => execute(fetch, core, process), process };
}

test('both independent readers use only their allowed API and do not expose returned data', async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.calls, [
    { url: settingsUrl, token: settingsToken }, { url: privateUrl, token: settingsToken },
    { url: privateUrl, token: privateToken }, { url: settingsUrl, token: privateToken },
  ]);
  assert.deepEqual(f.masked, [settingsToken, privateToken]);
  const output = f.messages.join('\n');
  for (const forbidden of [settingsToken, privateToken, 'private configuration value', 'private job details']) {
    assert.equal(output.includes(forbidden), false);
  }
  assert.ok(output.includes('does not establish native acceptance or release readiness'));
});

for (const missing of ['SETTINGS_READER', 'PRIVATE_TEST_READER']) {
  test('missing ' + missing + ' prevents every network call', async () => {
    const f = fixture({ env: { [missing]: '' } });
    await assert.rejects(f.run(), /Both approved fine-grained readers are required/);
    assert.equal(f.calls.length, 0);
  });
}
for (const status of [401, 403, 404, 429, 500]) {
  test('denied or unavailable intended capability fails closed: ' + status, async () => {
    const f = fixture({ allowedStatus: status });
    await assert.rejects(f.run(), /read failed/);
    assert.equal(f.messages.length, 0);
  });
}
for (const status of [200, 302, 429, 500]) {
  test('an unproven negative capability does not pass: ' + status, async () => {
    const f = fixture({ deniedStatus: status });
    await assert.rejects(f.run(), /outside its approved capability/);
  });
}
test('403 also proves the other capability is denied', async () => {
  await fixture({ deniedStatus: 403 }).run();
});
for (const option of ['invalidJson', 'invalidShape', 'transportError']) {
  test(option + ' never leaks a token or response details through an error', async () => {
    const f = fixture({ [option]: true });
    await assert.rejects(f.run(), error => !error.message.includes(settingsToken) && !error.message.includes(privateToken) && !error.message.includes('private transport detail'));
  });
}
test('manual protected-source route has no checkout, build, or repository-token permissions', () => {
  assert.match(workflow, /on:\n  workflow_dispatch:\n/);
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/sprint'/);
  assert.equal(workflow.includes('actions/checkout'), false);
  assert.equal(workflow.includes('run:'), false);
});
