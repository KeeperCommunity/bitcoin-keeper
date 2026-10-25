// Execute App's actual billing effect and the pinned IAP adapter with disposable
// native boundaries. This proves promise ownership, not native startup success.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const babel = require('@babel/core');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const cases = ['CREATE_REJECTED', 'INIT_REJECTED', 'END_REJECTED', 'SUCCESS'];
const root = path.resolve(__dirname, '../..');
const library = path.join(path.dirname(require.resolve('react-native-iap/package.json')), 'src');

function billingEffect() {
  const source = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  let effect;
  traverse(parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }), {
    FunctionDeclaration(p) {
      if (p.node.id?.name !== 'App') return;
      p.traverse({
        CallExpression(q) {
          if (q.node.callee.name !== 'useEffect') return;
          assert.equal(effect, undefined, 'App has exactly one lifecycle effect');
          effect = source.slice(q.node.arguments[0].start, q.node.arguments[0].end);
        },
      });
    },
  });
  assert(effect, 'App billing effect exists');
  return effect;
}

function compile(source, filename) {
  return babel.transformSync(source, {
    filename, babelrc: false, configFile: false,
    plugins: ['@babel/plugin-transform-typescript', '@babel/plugin-transform-modules-commonjs'],
  }).code;
}

async function scenario(kind) {
  const logs = [], unhandled = [], calls = [];
  const context = vm.createContext({
    Promise, Error, process: { env: {} }, global: {},
    console: { error: (...args) => logs.push(args) },
    isVegaOS: () => false,
    getVegaIapModule: () => { throw Error('Unexpected controlled boundary'); },
    tryAttachPendingNativeListeners: () => {}, resetListenerState: () => {},
    NitroModules: {
      createHybridObject() {
        calls.push('CREATE');
        if (kind === 'CREATE_REJECTED') throw Error('Disposable unavailable binding');
        return {
          initConnection: async () => {
            calls.push('INIT');
            if (kind === 'INIT_REJECTED') throw Error('Disposable initialization rejection');
            return true;
          },
          endConnection: async () => {
            calls.push('END');
            if (kind === 'END_REJECTED') throw Error('Disposable cleanup rejection');
            return true;
          },
        };
      },
    },
  });
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    assert(file.startsWith(library + path.sep));
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    cache.set(file, module.exports);
    const source = compile(fs.readFileSync(file, 'utf8'), file);
    const fn = vm.runInContext(`(function(require,module,exports){${source}\n})`, context);
    fn(relative => {
      assert(relative.startsWith('.'));
      let target = path.resolve(path.dirname(file), relative);
      if (!path.extname(target)) target += '.ts';
      return load(target);
    }, module, module.exports);
    cache.set(file, module.exports);
    return module.exports;
  }
  Object.assign(context, load(path.join(library, 'utils/error.ts')),
    load(path.join(library, 'utils/errorMapping.ts')), load(path.join(library, 'utils/debug.ts')));
  const source = fs.readFileSync(path.join(library, 'index.ts'), 'utf8');
  const names = new Set(['toErrorMessage', 'parseErrorAndLogIfNeeded', 'iapRef',
    'attachingPendingNativeListeners', 'getRawIapInstance', 'IAP', 'initConnection', 'endConnection']);
  const fragments = [];
  for (let node of parser.parse(source, { sourceType: 'module', plugins: ['typescript'] }).program.body) {
    if (node.type === 'ExportNamedDeclaration') node = node.declaration;
    if (node && ((node.type === 'FunctionDeclaration' && names.has(node.id.name)) ||
      (node.type === 'VariableDeclaration' && node.declarations.length === 1 &&
        names.has(node.declarations[0].id.name)))) fragments.push(source.slice(node.start, node.end));
  }
  assert.equal(fragments.length, names.size);
  const apiSource = compile(`${fragments.join('\n')}\nglobal.api={initConnection,endConnection};`,
    path.join(library, 'selected.ts'));
  vm.runInContext(`(function(){${apiSource}\n})()`, context);
  const effectCalls = { init: 0, cleanup: 0 };
  context.initConnection = () => { effectCalls.init++; return context.global.api.initConnection(); };
  context.endConnection = () => { effectCalls.cleanup++; return context.global.api.endConnection(); };
  const onUnhandled = error => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    const cleanup = vm.runInContext(`(${billingEffect()})`, context)();
    await new Promise(setImmediate);
    await new Promise(setImmediate);
    assert.equal(typeof cleanup, 'function');
    assert.equal(cleanup(), undefined);
    await new Promise(setImmediate);
    await new Promise(setImmediate);
    return { unhandled: unhandled.length, libraryLogs: logs.length, effectCalls, calls };
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
}

if (process.argv[2] === '--disposable-scenario') {
  const kind = process.argv[3];
  assert(cases.includes(kind));
  scenario(kind).then(result => process.stdout.write(JSON.stringify(result)))
    .catch(() => { process.stderr.write('DISPOSABLE_BILLING_SCENARIO_FAILED'); process.exitCode = 1; });
} else {
  for (const kind of cases) {
    test(`App owns optional billing promises: ${kind}`, () => {
      // Isolate actual rejected promises from node:test's global failure tracker.
      const result = spawnSync(process.execPath, [__filename, '--disposable-scenario', kind],
        { encoding: 'utf8', timeout: 15000, maxBuffer: 4096 });
      assert.equal(result.status, 0, 'Disposable scenario exits successfully');
      const actual = JSON.parse(result.stdout);
      assert.equal(actual.unhandled, 0, 'No discarded initialization/cleanup rejection');
      assert.equal(actual.libraryLogs, kind === 'SUCCESS' ? 0 : 1, 'Adapter error reporting retained');
      assert.deepEqual(actual.effectCalls, { init: 1, cleanup: 1 });
      assert.deepEqual(actual.calls, kind === 'CREATE_REJECTED' ? ['CREATE'] : ['CREATE', 'INIT', 'END']);
    });
  }
}
