// Host-only contract checks. They do not execute a native Realm or grant app acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { extract, prepare, SELECTION } = require('../native/r5_prepare.cjs');
const {
  recordBuilder,
  runFeatures,
  FeatureFailure,
  SCENARIOS,
  LIMITS,
} = require('../native/r5_features_core');
const root = path.resolve(__dirname, '../..');

test('build-time probe extracts every selected production definition and records its source hash', () => {
  const provenance = prepare();
  assert.equal(provenance.length, Object.keys(SELECTION).length);
  for (const item of provenance) {
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(item.names, SELECTION[item.path]);
  }
  const generated = require('../native/.generated/r5_workers');
  const workers = generated.createWorkers({});
  for (const name of [
    'setupKeeperAppWorker',
    'deleteSigningDeviceWorker',
    'deleteAppImageEntityWorker',
    'getKeyUID',
    'observeBackupAccount',
    'currentBackupAccountSession',
  ])
    assert.equal(typeof workers[name], 'function');
  assert.deepEqual(generated.provenance, provenance);
});

test('missing or duplicate production definitions fail closed rather than execute a substitute', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-r5-extraction-'));
  try {
    const file = path.join(directory, 'source.ts');
    fs.writeFileSync(file, 'export const retained = () => 1;');
    assert.throws(() => extract(file, ['missing']), /selection changed/);
    fs.writeFileSync(file, 'function retained(){}; function retained(){};');
    assert.throws(() => extract(file, ['retained']), /Duplicate/);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('actual production session observer invalidates an A to B to A worker scope', () => {
  prepare();
  const { createWorkers } = require('../native/.generated/r5_workers');
  const workers = createWorkers({});
  workers.observeBackupAccount('A');
  const first = workers.currentBackupAccountSession();
  workers.observeBackupAccount('A');
  assert.equal(workers.currentBackupAccountSession(), first);
  workers.observeBackupAccount('B');
  workers.observeBackupAccount('A');
  assert.ok(workers.currentBackupAccountSession() > first);
});

test('native fixture builder uses actual current schemas, required linked objects and sentinel-only inputs', () => {
  const cache = new Map();
  function load(relative) {
    let file = path.resolve(root, relative);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.ts');
    else if (!fs.existsSync(file)) file = `${file}.ts`;
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = fs.readFileSync(file, 'utf8');
    const javascript = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText;
    vm.runInNewContext(
      javascript,
      {
        exports: module.exports,
        module,
        Date,
        require(name) {
          if (name.startsWith('src/')) return load(name);
          if (name.startsWith('.'))
            return load(path.relative(root, path.resolve(path.dirname(file), name)));
          throw new Error(`Unexpected schema import ${name}`);
        },
      },
      { filename: file }
    );
    return module.exports;
  }
  const schema = load('src/storage/realm/schema').default;
  const make = recordBuilder(schema);
  const wallet = make('Wallet');
  assert.equal(wallet.specs.xpub, '');
  assert.equal(wallet.specs.balances.confirmed, 0);
  assert.deepEqual(wallet.specs.transactions, []);
  assert.equal(make('Vault').archived, false);
  assert.equal(make('KeeperApp').subscription.level, 0);
  assert.equal(make('Signer').lastHealthCheck.valueOf(), 0);
  assert.throws(() => make('Missing'), /schema-missing/);
});

test('invalid persistent process state fails before opening any native database', async () => {
  let opened = false;
  const Realm = {
    defaultPath: '/disposable/default.realm',
    open() {
      opened = true;
    },
  };
  for (const serialized of [
    'broken',
    '{"iteration":6,"measurements":[]}',
    '{"iteration":1,"measurements":[]}',
  ]) {
    await assert.rejects(
      runFeatures({ Realm, schema: [], storage: { getString: () => serialized } }),
      (error) => error instanceof FeatureFailure && error.code === 'invalid-phase'
    );
  }
  assert.equal(opened, false);
});

test('probe reports a bounded worker scope and cannot imply product startup, UI or backend coverage', () => {
  assert.equal(SCENARIOS.length, 5);
  assert.ok(SCENARIOS.every((id) => /^(production-|native-worker-)/.test(id)));
  assert.ok(LIMITS.includes('no-product-ui-navigation-pin-or-biometric-acceptance'));
  assert.ok(LIMITS.includes('probe-and-worker-timings-not-product-startup-ux'));
  const entry = fs.readFileSync(path.join(root, '.github/native/r5_features.js'), 'utf8');
  assert.ok(entry.includes('production-worker-native-storage'));
  assert.ok(!/from ['"].*(?:App|store\/store|services\/backend)/.test(entry));
});
