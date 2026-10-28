const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual focus-effect callback used by the screen. The synthetic
// sequence mirrors a zero-balance rotation whose Realm row arrives after the
// success flag; it neither opens a wallet nor mocks the navigation decision.
function controllerCallback() {
  const filename = process.env.KEEPER_VAULT_CONTROLLER_SOURCE ||
    path.join(process.cwd(), 'src/screens/Vault/VaultMigrationController.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useFocusEffect') {
      const wrapped = node.arguments[0];
      if (wrapped && ts.isCallExpression(wrapped) &&
          wrapped.expression.getText(source) === 'useCallback') {
        const candidate = wrapped.arguments[0];
        if (candidate && candidate.getText(source).includes('savedGeneratedVaultId') &&
            candidate.getText(source).includes('relayVaultUpdate')) callback = candidate;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(callback, 'production migration focus callback must exist');
  return ts.transpileModule(`result = ${callback.getText(source)};`, {
    fileName: 'VaultMigrationController.tsx',
    compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React },
  }).outputText;
}

const callbackSource = controllerCallback();
function runNavigationState({ existingVault, hydrated }) {
  const navigation = [];
  const actions = [];
  const creating = [];
  const modal = [];
  const context = {
    activeVault: existingVault ? { id: 'old' } : null,
    hasMigrationSucceeded: existingVault,
    migrationError: null,
    vaultId: existingVault ? 'old' : null,
    relayVaultUpdate: true,
    relayVaultError: false,
    savedGeneratedVaultId: hydrated ? 'new' : null,
    allVaults: hydrated ? [{ id: 'new' }] : [],
    confirmed: 0,
    unconfirmed: 0,
    vaultSigners: [],
    DEVICES_WITH_SCREEN: [],
    navigation: { dispatch: (action) => navigation.push(action) },
    dispatch: (action) => actions.push(action),
    CommonActions: { reset: (state) => ({ type: 'navigation/reset', state }) },
    resetRealyVaultState: () => ({ type: 'relay/reset' }),
    resetVaultMigration: () => ({ type: 'migration/reset' }),
    setCreating: (value) => creating.push(value),
    setVaultCreatedModalVisible: (value) => modal.push(value),
    showToast: () => { throw new Error('unexpected error toast'); },
    initiateSweep: () => { throw new Error('zero-balance path must not sweep'); },
    result: undefined,
  };
  vm.runInNewContext(callbackSource, context);
  context.result();
  return { navigation, actions, creating, modal };
}

test('existing zero-balance rotation waits for its new Vault row before leaving replacement screen', () => {
  const pending = runNavigationState({ existingVault: true, hydrated: false });
  assert.deepEqual(pending.navigation, []);
  assert.deepEqual(pending.actions, []);
  assert.deepEqual(pending.creating, []);
  assert.deepEqual(pending.modal, []);

  const committed = runNavigationState({ existingVault: true, hydrated: true });
  assert.deepEqual(committed.navigation, []);
  assert.deepEqual(committed.modal, [true]);
  assert.deepEqual(committed.creating, [false]);
  assert.deepEqual(committed.actions.map((action) => action.type),
    ['relay/reset', 'migration/reset']);
});

test('new-Vault fallback still returns Home when relay update has no selected Vault', () => {
  const newVault = runNavigationState({ existingVault: false, hydrated: false });
  assert.equal(newVault.navigation.length, 1);
  assert.equal(newVault.navigation[0].type, 'navigation/reset');
  assert.deepEqual(Array.from(newVault.navigation[0].state.routes, (route) => route.name), ['Home']);
  assert.deepEqual(newVault.actions.map((action) => action.type), ['relay/reset']);
  assert.deepEqual(newVault.creating, [false]);
});
