import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import idx from 'idx';
import { resolveInitialTimelock } from 'src/services/wallets/operations/miniscript/initialTimelock';
import {
  MiniscriptTypes,
  MultisigScriptType,
  NetworkType,
  VaultType,
} from 'src/services/wallets/enums';
import * as durations from 'src/screens/Vault/constants';
import {
  ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_MAINNET,
  ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_TESTNET,
  ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_MAINNET,
  ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_TESTNET,
  INHERITANCE_KEY_IDENTIFIER,
  EMERGENCY_KEY_IDENTIFIER,
  generateEnhancedVaultElements,
} from 'src/services/wallets/operations/miniscript/default/EnhancedVault';
import { generateMiniscriptPolicy } from 'src/services/wallets/operations/miniscript/policy-generator';
import { generateMiniscript } from 'src/services/wallets/operations/miniscript/miniscript';

jest.mock('src/utils/utilities', () => ({ getKeyUID: (s) => s.masterFingerprint }));
jest.mock('src/utils/service-utilities/utils', () => ({
  getDerivationPath: (p) => p.replace('m/', ''),
}));

// Evaluate the actual TSX expressions and controller/factory functions. This
// exercises the screen boundary without rendering native UI or using wallet data.
function readSource(relativePath: string) {
  return ts.createSourceFile(
    relativePath,
    fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

function variableExpression(source: ts.SourceFile, name: string) {
  let expression: ts.Expression;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      expression = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error(`Missing production variable ${name}`);
  return expression;
}

function execute(expression: ts.Expression, source: ts.SourceFile, scope: any) {
  vm.runInNewContext(
    ts.transpileModule(`result = (${expression.getText(source)});`, {
      fileName: 'screen-boundary.tsx',
      compilerOptions: { target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React },
    }).outputText,
    scope
  );
  return scope.result;
}

function migrationProps(source: ts.SourceFile, scope: any) {
  let component: ts.JsxOpeningLikeElement;
  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === 'VaultMigrationController'
    ) {
      component = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!component) throw new Error('Missing production VaultMigrationController');
  const props: any = {};
  for (const attribute of component.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = attribute.name.getText(source);
    if (
      !['miniscriptTypes', 'initialTimelockDuration', 'inheritanceKeys', 'emergencyKeys'].includes(
        name
      )
    )
      continue;
    if (!attribute.initializer || !ts.isJsxExpression(attribute.initializer)) continue;
    props[name] = execute(attribute.initializer.expression, source, scope);
  }
  return props;
}

function proceedCallback(source: ts.SourceFile, scope: any) {
  let expression: ts.Expression;
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'primaryCallback') {
      if (node.initializer && ts.isJsxExpression(node.initializer)) {
        expression = node.initializer.expression;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error('Missing production primaryCallback');
  return execute(expression, source, scope);
}

const reserveSource = readSource('src/screens/Vault/AddReserveKey.tsx');
const emergencySource = readSource('src/screens/Vault/AddEmergencyKey.tsx');
const controllerSource = readSource('src/screens/Vault/VaultMigrationController.tsx');
const factorySource = readSource('src/services/wallets/factories/VaultFactory.ts');
const mk = (masterFingerprint: string) => ({
  masterFingerprint,
  derivationPath: "m/48'/0'/0'/2'",
  xpub: `xpub${masterFingerprint}`,
  account: 0,
});

function screenScope(hasInitialTimelock: boolean, initialTimelockDuration: any) {
  return {
    MiniscriptTypes,
    hasInitialTimelock,
    initialTimelockDuration,
    selectedSigner: [mk('DDDDDDDD')],
    selectedOption: { label: durations.MONTHS_12 },
    inheritanceKeys: [{ key: mk('DDDDDDDD'), duration: durations.MONTHS_12 }],
  };
}

function controllerFixture(network: NetworkType, blockHeight: boolean) {
  const base = blockHeight ? 950000 : 1767225600;
  const scope: any = {
    ...durations,
    resolveInitialTimelock,
    MiniscriptTypes,
    VaultType,
    NetworkType,
    MultisigScriptType,
    ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_MAINNET,
    ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_TESTNET,
    ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_MAINNET,
    ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_TESTNET,
    generateEnhancedVaultElements: jest.fn(generateEnhancedVaultElements),
    generateMiniscriptPolicy,
    generateMiniscript,
    bitcoinNetworkType: network,
    currentBlockHeight: base,
    activeVault: {
      scheme: { miniscriptScheme: { miniscriptElements: { timelocks: [base] } } },
    },
    Date: { now: () => base * 1000 },
    WalletUtilities: {
      fetchCurrentBlockHeight: jest.fn().mockRejectedValue(new Error('Disposable offline fixture')),
    },
    idx,
    getKeyUID: (key) => key.masterFingerprint,
    showToast: jest.fn(),
    ErrorText: { invalidDuration: 'Invalid duration' },
    React: { createElement: () => null },
    ToastErrorIcon: () => null,
  };
  for (const name of ['isVaultUsingBlockHeightTimelock', 'generateMiniscriptScheme']) {
    scope[name] = execute(variableExpression(factorySource, name), factorySource, scope);
  }
  for (const name of ['getCurrentTimeForLock', 'getTimelockDuration', 'prepareMiniscriptScheme']) {
    scope[name] = execute(variableExpression(controllerSource, name), controllerSource, scope);
  }
  const table = blockHeight
    ? network === NetworkType.MAINNET
      ? ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_MAINNET
      : ENHANCED_VAULT_TIMELOCKS_BLOCK_HEIGHT_TESTNET
    : network === NetworkType.MAINNET
    ? ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_MAINNET
    : ENHANCED_VAULT_TIMELOCKS_TIMESTAMP_TESTNET;
  const info: any = {
    vaultType: VaultType.MINISCRIPT,
    vaultScheme: { m: 2, n: 3 },
    vaultSigners: [mk('AAAAAAAA'), mk('BBBBBBBB'), mk('CCCCCCCC')],
  };
  return { scope, info, base, table };
}

function migrationCaller(scope: any, info: any, props: any) {
  scope.activeVault.id = 'disposable';
  Object.assign(scope, {
    vaultType: VaultType.MINISCRIPT,
    scheme: info.vaultScheme,
    vaultKeys: info.vaultSigners,
    name: 'Disposable fixture',
    description: '',
    miniscriptTypes: props.miniscriptTypes,
    inheritanceKeys: props.inheritanceKeys,
    emergencyKeys: props.emergencyKeys,
    initialTimelockDuration: props.initialTimelockDuration,
    allVaults: [],
    archivedVaults: [],
    vaultAlreadyExists: jest.fn(() => false),
    dispatch: jest.fn(),
    migrateVault: jest.fn((newVaultInfo, vaultId) => ({
      type: 'DISPOSABLE_MIGRATION_FIXTURE',
      newVaultInfo,
      vaultId,
    })),
    addNewVault: jest.fn(),
    generateVaultId: jest.fn(),
    setGeneratedVaultId: jest.fn(),
    setSavedGeneratedVaultId: jest.fn(),
    setCreating: jest.fn(),
    captureError: jest.fn(),
  });
  return execute(variableExpression(controllerSource, 'initiateNewVault'), controllerSource, scope);
}

const invalidHeights = [null, undefined, 0, -1, NaN, 950000.5, '950000', 500000000];
const chainDataError =
  'Failed to fetch current chain data, please check your connection and try again';

describe('Actual block-height replacement refuses missing or invalid chain data', () => {
  test.each(invalidHeights)(
    'preparation rejects invalid supplied and fetched height %s before policy construction',
    async (height) => {
      const props = migrationProps(reserveSource, screenScope(true, durations.MONTHS_6));
      const { scope, info } = controllerFixture(NetworkType.MAINNET, true);
      scope.currentBlockHeight = height;
      scope.WalletUtilities.fetchCurrentBlockHeight.mockResolvedValue({
        currentBlockHeight: height,
      });
      await expect(
        scope.prepareMiniscriptScheme(
          info,
          props.miniscriptTypes,
          props.inheritanceKeys,
          props.emergencyKeys,
          props.initialTimelockDuration
        )
      ).rejects.toThrow(chainDataError);
      expect(scope.WalletUtilities.fetchCurrentBlockHeight).toHaveBeenCalledTimes(1);
      expect(scope.generateEnhancedVaultElements).not.toHaveBeenCalled();
      expect(info).not.toHaveProperty('miniscriptElements');
      expect(info.vaultScheme).toEqual({ m: 2, n: 3 });
    }
  );

  test.each(invalidHeights)(
    'actual migration caller does not dispatch for current height %s',
    async (height) => {
      const props = migrationProps(reserveSource, screenScope(true, durations.MONTHS_6));
      const { scope, info } = controllerFixture(NetworkType.MAINNET, true);
      scope.currentBlockHeight = height;
      const initiate = migrationCaller(scope, info, props);
      await initiate();
      expect(scope.WalletUtilities.fetchCurrentBlockHeight).toHaveBeenCalledTimes(1);
      expect(scope.dispatch).not.toHaveBeenCalled();
      expect(scope.migrateVault).not.toHaveBeenCalled();
      expect(scope.addNewVault).not.toHaveBeenCalled();
      expect(scope.vaultAlreadyExists).not.toHaveBeenCalled();
      expect(scope.generateEnhancedVaultElements).not.toHaveBeenCalled();
      expect(scope.scheme).toEqual({ m: 2, n: 3 });
      expect(scope.setCreating).toHaveBeenCalledWith(false);
      expect(scope.showToast).toHaveBeenCalledWith(
        `Failed to prepare enhanced vault: ${chainDataError}`,
        null
      );
      expect(scope.captureError).toHaveBeenCalledTimes(1);
    }
  );

  test.each(invalidHeights)(
    'timestamp wallet timing is unaffected by irrelevant height %s',
    async (height) => {
      const props = migrationProps(reserveSource, screenScope(true, durations.MONTHS_6));
      const { scope, info, base, table } = controllerFixture(NetworkType.MAINNET, false);
      scope.currentBlockHeight = height;
      await scope.prepareMiniscriptScheme(
        info,
        props.miniscriptTypes,
        props.inheritanceKeys,
        props.emergencyKeys,
        props.initialTimelockDuration
      );
      expect(
        info.vaultScheme.miniscriptScheme.miniscriptElements.phases.map((phase) => phase.timelock)
      ).toEqual([base + table.MONTHS_6, base + table.MONTHS_6 + table.MONTHS_12]);
      expect(scope.WalletUtilities.fetchCurrentBlockHeight).not.toHaveBeenCalled();
    }
  );

  test('the same migration caller recovers after reconnecting and uses one fetched phase anchor', async () => {
    const props = migrationProps(emergencySource, {
      ...screenScope(true, durations.MONTHS_6),
      selectedSigner: [mk('EEEEEEEE')],
      selectedOption: { label: durations.MONTHS_36 },
    });
    const { scope, info, table } = controllerFixture(NetworkType.MAINNET, true);
    const fetchedHeight = 975000;
    scope.currentBlockHeight = null;
    const fetchHeight = scope.WalletUtilities.fetchCurrentBlockHeight;
    fetchHeight
      .mockRejectedValueOnce(new Error('Disposable offline fixture'))
      .mockResolvedValueOnce({ currentBlockHeight: fetchedHeight });
    const initiate = migrationCaller(scope, info, props);

    await initiate();
    expect(scope.dispatch).not.toHaveBeenCalled();
    expect(scope.generateEnhancedVaultElements).not.toHaveBeenCalled();
    expect(scope.scheme).toEqual({ m: 2, n: 3 });
    expect(scope.showToast).toHaveBeenCalledWith(
      `Failed to prepare enhanced vault: ${chainDataError}`,
      null
    );
    expect(scope.setCreating).toHaveBeenCalledWith(false);

    // Repeat the same closure; no screen remount or prop/state change repairs it.
    await initiate();
    expect(fetchHeight).toHaveBeenCalledTimes(2);
    expect(scope.currentBlockHeight).toBeNull();
    expect(scope.generateEnhancedVaultElements).toHaveBeenCalledTimes(1);
    expect(scope.migrateVault).toHaveBeenCalledTimes(1);
    expect(scope.dispatch).toHaveBeenCalledTimes(1);
    expect(scope.addNewVault).not.toHaveBeenCalled();
    const [replacement, vaultId] = scope.migrateVault.mock.calls[0];
    expect(vaultId).toBe('disposable');
    expect(scope.dispatch).toHaveBeenCalledWith({
      type: 'DISPOSABLE_MIGRATION_FIXTURE',
      newVaultInfo: replacement,
      vaultId,
    });
    const expected = [
      fetchedHeight + table.MONTHS_6,
      fetchedHeight + table.MONTHS_6 + table.MONTHS_12,
      fetchedHeight + table.MONTHS_6 + table.MONTHS_36,
    ];
    const replacementScheme = replacement.vaultScheme.miniscriptScheme;
    expect(replacementScheme.miniscriptElements.phases.map((phase) => phase.timelock)).toEqual(
      expected
    );
    for (const timelock of expected)
      expect(replacementScheme.miniscriptPolicy).toContain(`after(${timelock})`);
    expect(replacementScheme.usedMiniscriptTypes).toEqual([
      MiniscriptTypes.TIMELOCKED,
      MiniscriptTypes.INHERITANCE,
      MiniscriptTypes.EMERGENCY,
    ]);
    expect(scope.captureError).toHaveBeenCalledTimes(1);
  });
});

describe('AddReserveKey production migration boundary', () => {
  test.each([undefined, null, '', 0, NaN, -1, 'invalid'])(
    'retains required TIMELOCKED and rejects missing/invalid duration %s',
    async (duration) => {
      const props = migrationProps(reserveSource, screenScope(true, duration));
      expect(props.miniscriptTypes).toContain(MiniscriptTypes.TIMELOCKED);
      const { scope, info } = controllerFixture(NetworkType.MAINNET, false);
      await expect(
        scope.prepareMiniscriptScheme(
          info,
          props.miniscriptTypes,
          props.inheritanceKeys,
          props.emergencyKeys,
          props.initialTimelockDuration
        )
      ).rejects.toThrow('initial timelock duration');
      expect(info).not.toHaveProperty('miniscriptElements');
      expect(info.vaultScheme).not.toHaveProperty('miniscriptScheme');
    }
  );

  test.each([
    ['mainnet timestamp', NetworkType.MAINNET, false],
    ['testnet timestamp', NetworkType.TESTNET, false],
    ['mainnet height', NetworkType.MAINNET, true],
    ['testnet height', NetworkType.TESTNET, true],
  ])(
    'preserves primary and inheritance timing through actual policy generation (%s)',
    async (_name, network: NetworkType, blockHeight: boolean) => {
      const props = migrationProps(reserveSource, screenScope(true, durations.MONTHS_6));
      const { scope, info, base, table } = controllerFixture(network, blockHeight);
      await scope.prepareMiniscriptScheme(
        info,
        props.miniscriptTypes,
        props.inheritanceKeys,
        props.emergencyKeys,
        props.initialTimelockDuration
      );
      const scheme = info.vaultScheme.miniscriptScheme;
      const expected = [base + table.MONTHS_6, base + table.MONTHS_6 + table.MONTHS_12];
      expect(scheme.miniscriptElements.phases.map((phase) => phase.timelock)).toEqual(expected);
      for (const timelock of expected)
        expect(scheme.miniscriptPolicy).toContain(`after(${timelock})`);
      expect(scheme.usedMiniscriptTypes).toContain(MiniscriptTypes.TIMELOCKED);
    }
  );

  test('preserves primary, inheritance and emergency timing across both add-key screens', async () => {
    const navigate = jest.fn();
    proceedCallback(reserveSource, {
      ...screenScope(true, durations.MONTHS_6),
      navigation: { navigate },
      isAddEmergencyKey: true,
      isAddInheritanceKey: true,
      vaultKeys: [mk('AAAAAAAA'), mk('BBBBBBBB'), mk('CCCCCCCC')],
      vaultId: 'disposable',
      scheme: { m: 2, n: 3 },
      name: 'Disposable fixture',
      description: '',
      currentBlockHeight: 950000,
      route: { params: { selectedSigners: [] } },
      keyToRotate: mk('FFFFFFFF'),
      setCreating: jest.fn(),
      VaultType,
    })();
    expect(navigate.mock.calls[0][0]).toBe('AddEmergencyKey');
    const nextParams = navigate.mock.calls[0][1];
    expect(nextParams.hasInitialTimelock).toBe(true);
    expect(nextParams.initialTimelockDuration).toBe(durations.MONTHS_6);
    const props = migrationProps(emergencySource, {
      ...nextParams,
      MiniscriptTypes,
      selectedSigner: [mk('EEEEEEEE')],
      selectedOption: { label: durations.MONTHS_36 },
    });
    const { scope, info, base, table } = controllerFixture(NetworkType.MAINNET, false);
    await scope.prepareMiniscriptScheme(
      info,
      props.miniscriptTypes,
      props.inheritanceKeys,
      props.emergencyKeys,
      props.initialTimelockDuration
    );
    const scheme = info.vaultScheme.miniscriptScheme;
    const expected = [
      base + table.MONTHS_6,
      base + table.MONTHS_6 + table.MONTHS_12,
      base + table.MONTHS_6 + table.MONTHS_36,
    ];
    expect(scheme.miniscriptElements.phases.map((phase) => phase.timelock)).toEqual(expected);
    for (const timelock of expected)
      expect(scheme.miniscriptPolicy).toContain(`after(${timelock})`);
  });

  test.each([undefined, null, '', 0])(
    'accepts a legitimate no-initial-lock wallet (%s)',
    async (duration) => {
      const props = migrationProps(reserveSource, screenScope(false, duration));
      expect(props.miniscriptTypes).not.toContain(MiniscriptTypes.TIMELOCKED);
      const { scope, info, base, table } = controllerFixture(NetworkType.MAINNET, false);
      await scope.prepareMiniscriptScheme(
        info,
        props.miniscriptTypes,
        props.inheritanceKeys,
        props.emergencyKeys,
        props.initialTimelockDuration
      );
      expect(
        info.vaultScheme.miniscriptScheme.miniscriptElements.phases.map((phase) => phase.timelock)
      ).toEqual([0, base + table.MONTHS_12]);
    }
  );
});

describe('Add-key screens forward initial duration to AddSigningDevice', () => {
  test.each([
    ['AddReserveKey', reserveSource],
    ['AddEmergencyKey', emergencySource],
  ])(
    '%s passes the independent flag and exact selected duration',
    (_name, source: ts.SourceFile) => {
      const push = jest.fn();
      const scope: any = {
        ...screenScope(true, durations.MONTHS_6),
        navigation: { push },
        ADDRESERVEKEY: 'AddReserveKey',
        ADDEMERGENCYKEY: 'AddEmergencyKey',
        vaultKeys: [mk('AAAAAAAA'), mk('BBBBBBBB'), mk('CCCCCCCC')],
        route: { params: { selectedSigners: [] } },
        scheme: { m: 2, n: 3 },
        isAddInheritanceKey: true,
        isAddEmergencyKey: true,
        currentBlockHeight: 950000,
        setSelectedSigner: jest.fn(),
      };
      const useCallback = variableExpression(source, 'userKeyCallback');
      if (!ts.isCallExpression(useCallback)) throw new Error('Expected production useCallback');
      const callback = execute(useCallback.arguments[0], source, scope);
      callback();
      expect(push).toHaveBeenCalledTimes(1);
      expect(push.mock.calls[0][0]).toBe('AddSigningDevice');
      expect(push.mock.calls[0][1].hasInitialTimelock).toBe(true);
      expect(push.mock.calls[0][1].initialTimelockDuration).toBe(durations.MONTHS_6);
    }
  );
});

describe('Add-key screens preserve fallback roles while replacing a primary key', () => {
  test.each([
    ['AddReserveKey', reserveSource, 'DDDDDDDD'],
    ['AddEmergencyKey', emergencySource, 'EEEEEEEE'],
  ])(
    '%s preloads the existing fallback for a primary rotation',
    (_name, source: ts.SourceFile, fingerprint: string) => {
      const setSelectedSigner = jest.fn();
      const scope: any = {
        selectedSigner: null,
        keyToRotate: mk('AAAAAAAA'),
        activeVault: {
          id: 'disposable',
          signers: ['AAAAAAAA', 'BBBBBBBB', 'CCCCCCCC', 'DDDDDDDD', 'EEEEEEEE'].map(mk),
          scheme: {
            miniscriptScheme: {
              miniscriptElements: {
                signerFingerprints: {
                  K1: 'AAAAAAAA',
                  K2: 'BBBBBBBB',
                  K3: 'CCCCCCCC',
                  IK1: 'DDDDDDDD',
                  EK1: 'EEEEEEEE',
                },
              },
            },
          },
        },
        INHERITANCE_KEY_IDENTIFIER,
        EMERGENCY_KEY_IDENTIFIER,
        getKeyUID: (key) => key.masterFingerprint,
        setSelectedSigner,
      };
      let expression: ts.Expression;
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === 'useEffect' &&
          node.arguments[0].getText(source).includes('setSelectedSigner(')
        ) {
          expression = node.arguments[0];
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
      if (!expression) throw new Error('Missing production fallback preload effect');
      const effect = execute(expression, source, scope);
      effect();
      expect(setSelectedSigner).toHaveBeenCalledWith([mk(fingerprint)]);

      // Replacing the fallback itself must still require choosing its replacement.
      setSelectedSigner.mockClear();
      scope.keyToRotate = mk(fingerprint);
      effect();
      expect(setSelectedSigner).not.toHaveBeenCalled();

      // Re-rendering must not overwrite an explicit user selection.
      scope.keyToRotate = mk('AAAAAAAA');
      scope.selectedSigner = [mk('FFFFFFFF')];
      effect();
      expect(setSelectedSigner).not.toHaveBeenCalled();
    }
  );
});
