import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { resolveInitialTimelock } from 'src/services/wallets/operations/miniscript/initialTimelock';
import {
  MiniscriptTypes,
  VaultType,
  MultisigScriptType,
  NetworkType,
} from 'src/services/wallets/enums';

const source = ts.createSourceFile(
  'VaultMigrationController.tsx',
  fs.readFileSync(
    path.join(process.cwd(), 'src/screens/Vault/VaultMigrationController.tsx'),
    'utf8'
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let prepareExpression: ts.Expression;
let initiateExpression: ts.Expression;
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'prepareMiniscriptScheme')
    prepareExpression = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'initiateNewVault')
    initiateExpression = node.initializer;
  ts.forEachChild(node, visit);
}
visit(source);
function fixture() {
  const generateEnhancedVaultElements = jest.fn(() => ({}));
  const scope: any = {
    resolveInitialTimelock,
    MiniscriptTypes,
    VaultType,
    MultisigScriptType,
    NetworkType,
    bitcoinNetworkType: NetworkType.TESTNET,
    getTimelockDuration: () => 6,
    getCurrentTimeForLock: () => 100000,
    generateEnhancedVaultElements,
    generateMiniscriptScheme: () => ({}),
    getKeyUID: (key) => key.id,
  };
  vm.runInNewContext(
    ts.transpileModule(`prepare = (${prepareExpression.getText(source)});`, {
      fileName: 'boundary.tsx',
      compilerOptions: { target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React },
    }).outputText,
    scope
  );
  return {
    scope,
    generateEnhancedVaultElements,
    info: {
      vaultType: VaultType.MINISCRIPT,
      vaultScheme: { m: 1, n: 1 },
      vaultSigners: [{ id: 'test' }],
    },
  };
}
describe('Actual migration preparation boundary', () => {
  test.each([undefined, null, '', 0])(
    'rejects dropped required value %s before policy construction',
    async (value) => {
      const { scope, generateEnhancedVaultElements, info } = fixture();
      await expect(
        scope.prepare(
          info,
          [MiniscriptTypes.TIMELOCKED, MiniscriptTypes.EMERGENCY],
          [],
          [{ key: { id: 'emergency' }, duration: '12 months' }],
          value
        )
      ).rejects.toThrow('initial timelock');
      expect(generateEnhancedVaultElements).not.toHaveBeenCalled();
      expect(info).not.toHaveProperty('miniscriptElements');
    }
  );
  test('uses the selected initial lock in primary and emergency policy inputs', async () => {
    const { scope, generateEnhancedVaultElements, info } = fixture();
    await scope.prepare(
      info,
      [MiniscriptTypes.TIMELOCKED, MiniscriptTypes.EMERGENCY],
      [],
      [{ key: { id: 'emergency' }, duration: '12 months' }],
      '6 months'
    );
    const call = generateEnhancedVaultElements.mock.calls[0] as any[];
    expect(call[4]).toBe(100006);
    expect(call[2][0].timelock).toBe(100012);
  });
  test('still accepts an emergency-only wallet with no initial lock', async () => {
    const { scope, generateEnhancedVaultElements, info } = fixture();
    await scope.prepare(
      info,
      [MiniscriptTypes.EMERGENCY],
      [],
      [{ key: { id: 'emergency' }, duration: '12 months' }],
      undefined
    );
    const call = generateEnhancedVaultElements.mock.calls[0] as any[];
    expect(call[4]).toBe(0);
    expect(call[2][0].timelock).toBe(100006);
  });
});

describe('Migration caller fails closed', () => {
  test.each([false, true])(
    'does not dispatch creation or migration on missing required lock (existing=%s)',
    async (existing) => {
      const { scope, info } = fixture();
      Object.assign(scope, {
        vaultType: VaultType.MINISCRIPT,
        scheme: info.vaultScheme,
        vaultKeys: info.vaultSigners,
        name: 'Disposable fixture',
        description: '',
        miniscriptTypes: [MiniscriptTypes.TIMELOCKED, MiniscriptTypes.EMERGENCY],
        inheritanceKeys: [],
        emergencyKeys: [{ key: { id: 'emergency' }, duration: '12 months' }],
        initialTimelockDuration: undefined,
        activeVault: existing ? { id: 'old-wallet', scheme: { miniscriptScheme: {} } } : null,
        allVaults: [],
        archivedVaults: [],
        vaultAlreadyExists: jest.fn(() => false),
        dispatch: jest.fn(),
        migrateVault: jest.fn(),
        addNewVault: jest.fn(),
        generateVaultId: jest.fn(),
        setGeneratedVaultId: jest.fn(),
        setSavedGeneratedVaultId: jest.fn(),
        showToast: jest.fn(),
        setCreating: jest.fn(),
        captureError: jest.fn(),
        React: { createElement: () => null },
        ToastErrorIcon: () => null,
        prepareMiniscriptScheme: scope.prepare,
      });
      vm.runInNewContext(
        ts.transpileModule(`initiate = (${initiateExpression.getText(source)});`, {
          fileName: 'caller.tsx',
          compilerOptions: { target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React },
        }).outputText,
        scope
      );
      await scope.initiate();
      expect(scope.dispatch).not.toHaveBeenCalled();
      expect(scope.vaultAlreadyExists).not.toHaveBeenCalled();
      expect(scope.generateVaultId).not.toHaveBeenCalled();
      expect(scope.setCreating).toHaveBeenCalledWith(false);
      expect(scope.showToast.mock.calls[0][0]).toContain(
        'Failed to prepare enhanced vault: Failed to determine initial timelock duration'
      );
      expect(scope.captureError).toHaveBeenCalledTimes(1);
    }
  );
});
