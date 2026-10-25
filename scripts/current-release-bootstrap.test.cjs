'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { childEnvironment } = require('./protected-release-worker.cjs');
const networkNames = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE'];
const networkFixture = Object.fromEntries(networkNames.map(name => [name,
  /proxy/i.test(name) ? (name.toLowerCase() === 'no_proxy' ? 'disposable.invalid,127.0.0.1' :
    'http://127.0.0.1:9/disposable-' + name) : '/disposable/trust/' + name]));
const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/keeper-protected-release-workers.yml'), 'utf8');
const match = workflow.match(/          script: &current-installed-release-sdk \|\n([\s\S]+?)\n\n  approved-operation:/);
assert(match, 'the reviewed same-process bootstrap must remain one scalar anchor');
const source = match[1].split('\n').map(line => line.slice(12)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const execute = new AsyncFunction('require', 'github', 'context', 'core', source);
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-bootstrap-contract-'));
  const driver = path.join(directory, 'driver'); fs.mkdirSync(driver);
  const put = (name, value) => { const file = path.join(driver, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  put('.github/scripts/verify-ci-source.cjs', fs.readFileSync(path.join(root, '.github/scripts/verify-ci-source.cjs')));
  put('.github/native/canonical_native.cjs', `module.exports = {
    pinReaderFromEnvironment(github, env) { const value = env.KEEPER_CANONICAL_PIN_READ_TOKEN; delete env.KEEPER_CANONICAL_PIN_READ_TOKEN; return { value }; },
    privateReaderFromEnvironment(github, env) { const value = env.KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN; delete env.KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN; return { value }; }
  };`);
  put('scripts/protected-release-worker.cjs', `const actual = require(${JSON.stringify(path.join(root, 'scripts/protected-release-worker.cjs'))});
    module.exports = { childEnvironment: actual.childEnvironment,
      workerRequest() { return { operation: 'android-signed-build' }; },
      async run(stage, options) {
        const observed = JSON.parse(require('node:child_process').execFileSync('python3', ['-c', 'import json,os; print(json.dumps(dict(os.environ)))'], { env: actual.childEnvironment(options.env, 'android-signed-build'), encoding: 'utf8' }));
        const sourceObserved = JSON.parse(require('node:child_process').execFileSync('python3', ['-c', 'import json,os; print(json.dumps(dict(os.environ)))'], { encoding: 'utf8' }));
        global.__keeperBootstrapObservation = { stage, env: options.env, observed, sourceObserved,
          sourceKeys: Object.keys(process.env), pin: options.pinReader.value, private: options.privateGithub.value };
      }
    };`);
  const git = args => execFileSync('git', ['-C', driver, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Offline contract', '-c', 'user.email=offline@example.invalid', 'commit', '-qm', 'Synthetic bootstrap source']);
  return { directory, driver, sha: git(['rev-parse', 'HEAD']) };
}
async function invoke(f, mutate) {
  const original = { ...process.env }, failures = [];
  try {
    Object.assign(process.env, {
      GITHUB_WORKSPACE: f.directory, KEEPER_CANDIDATE_PATH: path.join(f.directory, 'candidate'),
      KEEPER_RELEASE_STAGE: 'execute', KEEPER_RELEASE_REQUEST_JSON: '{}',
      GITHUB_SHA: f.sha, GITHUB_REF: 'refs/heads/sprint', GITHUB_REPOSITORY: 'KeeperCommunity/bitcoin-keeper',
      GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
      'INPUT_GITHUB-TOKEN': 'DISPOSABLE_ACTION_TOKEN', GITHUB_TOKEN: 'DISPOSABLE_NORMAL_TOKEN',
      GH_TOKEN: 'DISPOSABLE_GH_TOKEN', ACTIONS_RUNTIME_TOKEN: 'DISPOSABLE_RUNTIME_TOKEN',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'DISPOSABLE_IDENTITY_TOKEN',
      KEEPER_CANONICAL_PIN_READ_TOKEN: 'DISPOSABLE_PIN_READER',
      KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN: 'DISPOSABLE_PRIVATE_READER',
      KEEPER_RELEASE_PROVENANCE_READ_TOKEN: 'DISPOSABLE_OTHER_READER',
      UNRELATED_SECRET: 'DISPOSABLE_UNRELATED_SECRET',
      KEEPER_ANDROID_KEYSTORE_BASE64: 'DISPOSABLE_ANDROID_IDENTITY',
      KEEPER_PRODUCTION_CONFIG_BASE64: 'DISPOSABLE_CONFIG', STORE_PASSWORD: 'DISPOSABLE_STORE_PASSWORD',
      KEY_PASSWORD: 'DISPOSABLE_KEY_PASSWORD', KEY_ALIAS: 'DISPOSABLE_ALIAS',
      KEEPER_ASC_KEY_BASE64: 'DISPOSABLE_WRONG_OPERATION_SECRET',
      ANDROID_HOME: '/synthetic/sdk', JAVA_HOME: '/synthetic/java', BUNDLE_PATH: '/synthetic/gems',
      ...networkFixture, UNRELATED_PROXY_TOKEN: 'DISPOSABLE_UNRELATED_NETWORK_TOKEN',
    });
    if (mutate) mutate();
    delete global.__keeperBootstrapObservation;
    await execute(require, {}, { sha: f.sha }, { setFailed: value => failures.push(value) });
    return { failures, result: global.__keeperBootstrapObservation };
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, original); delete global.__keeperBootstrapObservation;
  }
}
test('actual workflow bootstrap preserves configured proxy/CA trust and isolates real child credentials', async () => {
  const f = fixture();
  try {
    const { failures, result } = await invoke(f); assert.deepEqual(failures, []);
    assert.equal(result.stage, 'execute'); assert.equal(result.pin, 'DISPOSABLE_PIN_READER');
    assert.equal(result.private, 'DISPOSABLE_PRIVATE_READER');
    assert.equal(result.observed.KEEPER_ANDROID_KEYSTORE_BASE64, 'DISPOSABLE_ANDROID_IDENTITY');
    assert.equal(result.observed.ANDROID_HOME, '/synthetic/sdk');
    assert.equal(result.observed.JAVA_HOME, '/synthetic/java'); assert.equal(result.observed.BUNDLE_PATH, '/synthetic/gems');
    assert.equal(result.observed.KEEPER_ASC_KEY_BASE64, undefined);
    for (const name of networkNames) {
      assert.equal(result.sourceObserved[name], networkFixture[name], 'source child changed ' + name);
      assert.equal(result.env[name], networkFixture[name], 'worker input changed ' + name);
      assert.equal(result.observed[name], networkFixture[name], 'build child changed ' + name);
    }
    for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'INPUT_GITHUB-TOKEN', 'ACTIONS_RUNTIME_TOKEN',
      'ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'KEEPER_CANONICAL_PIN_READ_TOKEN',
      'KEEPER_CANONICAL_PRIVATE_ACTIONS_READ_TOKEN', 'KEEPER_RELEASE_PROVENANCE_READ_TOKEN',
      'UNRELATED_SECRET', 'UNRELATED_PROXY_TOKEN']) {
      assert.equal(result.env[key], undefined, key); assert.equal(result.observed[key], undefined, key);
      assert.equal(result.sourceObserved[key], undefined, key);
      assert(!result.sourceKeys.includes(key), key);
    }
    assert(!result.sourceKeys.includes('KEEPER_ANDROID_KEYSTORE_BASE64'));
  } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
});
for (const [name, file] of [['bootstrap', '.github/scripts/verify-ci-source.cjs'], ['worker', 'scripts/protected-release-worker.cjs']])
  test(`actual workflow rejects modified ${name} before importing it`, async () => {
    const f = fixture();
    try {
      fs.appendFileSync(path.join(f.driver, file), '\n// changed bytes\n');
      const { failures, result } = await invoke(f);
      assert.equal(failures.length, 1); assert.equal(result, undefined);
      assert(!failures[0].includes('DISPOSABLE_'));
    } finally { fs.rmSync(f.directory, { recursive: true, force: true }); }
  });
test('operation environment cannot forward credentials from another operation or runner', () => {
  const env = { PATH: process.env.PATH, KEEPER_ASC_KEY_BASE64: 'ASC', KEEPER_ANDROID_KEYSTORE_BASE64: 'ANDROID',
    KEEPER_PRODUCTION_CONFIG_BASE64: 'CONFIG', ACTIONS_RUNTIME_TOKEN: 'RUNTIME', UNRELATED_SECRET: 'OTHER' };
  assert.deepEqual(childEnvironment(env, 'testflight-upload'), { PATH: process.env.PATH, KEEPER_ASC_KEY_BASE64: 'ASC' });
  assert.deepEqual(childEnvironment(env, 'android-signed-build'), { PATH: process.env.PATH,
    KEEPER_ANDROID_KEYSTORE_BASE64: 'ANDROID', KEEPER_PRODUCTION_CONFIG_BASE64: 'CONFIG' });
});

test('every operation child retains only recognized proxy and CA variables alongside its scoped inputs', () => {
  const env = { PATH: process.env.PATH, ...networkFixture,
    ACTIONS_RUNTIME_TOKEN: 'DISPOSABLE_RUNTIME', 'INPUT_GITHUB-TOKEN': 'DISPOSABLE_READER',
    OIDC_TOKEN: 'DISPOSABLE_OIDC', UNRELATED_PROXY_TOKEN: 'DISPOSABLE_EXTRA',
    NODE_TLS_REJECT_UNAUTHORIZED: '0', CURL_SSL_VERIFY: 'false', PYTHONHTTPSVERIFY: '0' };
  for (const operation of ['ios-signed-build', 'android-signed-build', 'testflight-upload', 'play-internal-upload']) {
    const observed = JSON.parse(execFileSync('python3', ['-c', 'import json,os; print(json.dumps(dict(os.environ)))'],
      { env: childEnvironment(env, operation), encoding: 'utf8' }));
    for (const name of networkNames) assert.equal(observed[name], networkFixture[name], operation + ': ' + name);
    for (const name of ['ACTIONS_RUNTIME_TOKEN', 'INPUT_GITHUB-TOKEN', 'OIDC_TOKEN', 'UNRELATED_PROXY_TOKEN',
      'NODE_TLS_REJECT_UNAUTHORIZED', 'CURL_SSL_VERIFY', 'PYTHONHTTPSVERIFY']) assert.equal(observed[name], undefined, name);
  }
});
