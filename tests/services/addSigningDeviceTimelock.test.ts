import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { MiniscriptTypes, VaultType, XpubTypes } from 'src/services/wallets/enums';
import { resolveInitialTimelock } from 'src/services/wallets/operations/miniscript/initialTimelock';

// Run the production screen's route bindings, controller props and button callback.
// Native rendering, Realm persistence and funded migration remain separate acceptance work.
function sourceFile(name: string, override?: string) {
  return ts.createSourceFile(
    name,
    fs.readFileSync(override || path.join(process.cwd(), `src/screens/Vault/${name}`), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

const signingSource = sourceFile('AddSigningDevice.tsx', process.env.R02_ADD_SIGNING_DEVICE_SOURCE);
const detailsSource = sourceFile(
  'SigningDeviceDetails.tsx',
  process.env.R02_SIGNING_DEVICE_DETAILS_SOURCE
);

function findNode(source: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node;
  function visit(node: ts.Node) {
    if (!result && predicate(node)) result = node;
    if (!result) ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

function execute(code: string, scope: any = {}) {
  vm.runInNewContext(
    ts.transpileModule(code, {
      fileName: 'screen-contract.tsx',
      compilerOptions: { target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React },
    }).outputText,
    scope
  );
  return scope;
}

function expressionValue(source: ts.SourceFile, node: ts.Expression, scope: any) {
  expect(node).toBeDefined();
  return execute(`result = (${node.getText(source)});`, scope).result;
}

function componentAttribute(component: string, attribute: string): ts.Expression {
  const element = findNode(
    signingSource,
    (node) =>
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(signingSource) === component
  ) as ts.JsxOpeningElement | ts.JsxSelfClosingElement;
  const prop = element.attributes.properties.find(
    (node) => ts.isJsxAttribute(node) && node.name.getText(signingSource) === attribute
  ) as ts.JsxAttribute;
  expect(prop).toBeDefined();
  return (prop.initializer as ts.JsxExpression).expression;
}

function requirementFromStoredWallet(
  types: MiniscriptTypes[],
  routeFlag?: boolean,
  newScheme = false
) {
  const declaration = findNode(
    signingSource,
    (node) =>
      ts.isVariableDeclaration(node) && node.name.getText(signingSource) === 'hasInitialTimelock'
  ) as ts.VariableDeclaration;
  expect(declaration).toBeDefined();
  return expressionValue(signingSource, declaration.initializer, {
    isNewSchemeFlow: newScheme,
    hasInitialTimelockParam: routeFlag,
    activeVault: { scheme: { miniscriptScheme: { usedMiniscriptTypes: types } } },
    MiniscriptTypes,
  });
}

function footerFixture(overrides: any = {}) {
  const footer = findNode(
    signingSource,
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'Footer'
  ) as ts.FunctionDeclaration;
  const navigation = { navigate: jest.fn(), dispatch: jest.fn(), goBack: jest.fn() };
  const setCreating = jest.fn();
  const scope: any = {
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    Box: 'Box',
    Buttons: 'Buttons',
    styles: { bottomContainer: {} },
    useNavigation: () => navigation,
    useContext: () => ({ translations: { common: { proceed: 'Proceed', confirm: 'Confirm' } } }),
    LocalizationContext: {},
    getKeyUID: (key) => key.id,
    CommonActions: { navigate: (name, params) => ({ name, params }) },
    INHERITANCE_KEY_IDENTIFIER: 'IK',
    EMERGENCY_KEY_IDENTIFIER: 'EK',
  };
  execute(`${footer.getText(signingSource)}; result = Footer;`, scope);
  const keyToRotate = { id: 'old-primary' };
  const props = {
    areSignersValid: true,
    colorMode: 'light',
    setCreating,
    isCollaborativeFlow: false,
    isAssistedWalletFlow: false,
    hasInitialTimelock: true,
    initialTimelockDuration: undefined,
    isReserveKeyFlow: false,
    isEmergencyKeyFlow: false,
    isAddInheritanceKey: false,
    isAddEmergencyKey: false,
    currentBlockHeight: 100000,
    vaultKeys: [{ id: 'new-primary', masterFingerprint: 'AAAAAAAA' }],
    selectedSigners: new Map([['new-primary', true]]),
    signers: [{ id: 'new-primary' }],
    name: 'Disposable fixture',
    description: '',
    vaultId: 'fixture-wallet',
    scheme: { m: 1, n: 1 },
    vaultType: 'MINISCRIPT',
    keyToRotate,
    activeVault: {
      scheme: { miniscriptScheme: { miniscriptElements: { signerFingerprints: {} } } },
    },
    ...overrides,
  };
  const element = scope.result(props);
  const button = element.children.find((child) => child?.type === 'Buttons');
  expect(button).toBeDefined();
  button.props.primaryCallback();
  return { navigation, setCreating, keyToRotate };
}

describe('AddSigningDevice initial timelock contract', () => {
  test.each(['3 months', '6 months', '9 months', '12 months'])(
    'reads the selected duration %s from the real route binding',
    (duration) => {
      const binding = findNode(
        signingSource,
        (node) =>
          ts.isVariableDeclaration(node) &&
          ts.isObjectBindingPattern(node.name) &&
          node.initializer?.getText(signingSource) === 'route.params'
      ) as ts.VariableDeclaration;
      const scope = execute(
        `const ${binding.getText(
          signingSource
        )}; result = typeof initialTimelockDuration === 'undefined' ? undefined : initialTimelockDuration;`,
        { route: { params: { initialTimelockDuration: duration } } }
      );
      expect(scope.result).toBe(duration);
    }
  );

  test.each([undefined, false, true])(
    'retains the stored TIMELOCKED requirement when route flag is %s',
    (routeFlag) => {
      expect(requirementFromStoredWallet([MiniscriptTypes.TIMELOCKED], routeFlag)).toBe(true);
    }
  );

  test('respects an explicit new-scheme choice to remove the initial lock', () => {
    expect(requirementFromStoredWallet([MiniscriptTypes.TIMELOCKED], false, true)).toBe(false);
  });

  test.each(['VaultMigrationController', 'Footer'])(
    'passes the exact selected duration to %s',
    (component) => {
      const duration = expressionValue(
        signingSource,
        componentAttribute(component, 'initialTimelockDuration'),
        {
          initialTimelockDuration: '9 months',
        }
      );
      expect(duration).toBe('9 months');
    }
  );

  test.each([undefined, null, '', 0])(
    'keeps the controller requirement independent from invalid duration %s',
    (initialTimelockDuration) => {
      const hasInitialTimelock = requirementFromStoredWallet([MiniscriptTypes.TIMELOCKED]);
      const types = expressionValue(
        signingSource,
        componentAttribute('VaultMigrationController', 'miniscriptTypes'),
        {
          hasInitialTimelock,
          isAddInheritanceKey: true,
          isAddEmergencyKey: true,
          MiniscriptTypes,
        }
      );
      const duration = expressionValue(
        signingSource,
        componentAttribute('VaultMigrationController', 'initialTimelockDuration'),
        {
          initialTimelockDuration,
        }
      );
      expect(types).toContain(MiniscriptTypes.TIMELOCKED);
      expect(() => resolveInitialTimelock(types, duration, () => 6)).toThrow('initial timelock');
    }
  );

  test('routes replacement without a duration through the existing timelock selection', () => {
    const { navigation, setCreating, keyToRotate } = footerFixture();
    expect(setCreating).not.toHaveBeenCalled();
    expect(navigation.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'SelectInitialTimelock',
        params: expect.objectContaining({ hasInitialTimelock: true, keyToRotate }),
      })
    );
  });

  test.each([
    ['AddReserveKey', { isAddInheritanceKey: true }],
    ['AddEmergencyKey', { isAddEmergencyKey: true }],
  ])('forwards an explicit duration and replacement identity to %s', (name, overrides) => {
    const { navigation, keyToRotate } = footerFixture({
      initialTimelockDuration: '6 months',
      ...overrides,
    });
    expect(navigation.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        name,
        params: expect.objectContaining({
          hasInitialTimelock: true,
          initialTimelockDuration: '6 months',
          keyToRotate,
        }),
      })
    );
  });

  test('forwards an explicit duration to final confirmation for a new wallet', () => {
    const { navigation } = footerFixture({
      initialTimelockDuration: '12 months',
      keyToRotate: undefined,
    });
    expect(navigation.navigate).toHaveBeenCalledWith(
      'ConfirmWalletDetails',
      expect.objectContaining({ hasInitialTimelock: true, initialTimelockDuration: '12 months' })
    );
  });

  test('uses an explicit duration for primary-key replacement without reselection', () => {
    const { navigation, setCreating } = footerFixture({ initialTimelockDuration: '6 months' });
    expect(setCreating).toHaveBeenCalledWith(true);
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });

  test('preserves ordinary untimelocked key replacement', () => {
    const { navigation, setCreating } = footerFixture({ hasInitialTimelock: false });
    expect(setCreating).toHaveBeenCalledWith(true);
    expect(navigation.dispatch).not.toHaveBeenCalled();
  });
});

describe('Existing primary Change Key navigation', () => {
  test('requires duration selection from stored metadata when the unchanged caller omits it', () => {
    const action = findNode(
      detailsSource,
      (node) =>
        ts.isObjectLiteralExpression(node) &&
        node.properties.some(
          (prop) =>
            ts.isPropertyAssignment(prop) &&
            prop.name.getText(detailsSource) === 'text' &&
            prop.initializer.getText(detailsSource) === 'vaultText.changeKey'
        )
    ) as ts.ObjectLiteralExpression;
    const callback = (
      action.properties.find(
        (prop) => ts.isPropertyAssignment(prop) && prop.name.getText(detailsSource) === 'onPress'
      ) as ts.PropertyAssignment
    ).initializer;
    const activeVault = {
      presentationData: { name: 'Disposable fixture', description: '' },
      scheme: { miniscriptScheme: { usedMiniscriptTypes: [MiniscriptTypes.TIMELOCKED] } },
    };
    const vaultKey = { id: 'old-primary' };
    const entryNavigation = { dispatch: jest.fn() };
    const onPress = expressionValue(detailsSource, callback, {
      activeVault,
      vaultKey,
      vaultId: 'fixture-wallet',
      isInheritanceKey: false,
      isEmergencyKey: false,
      navigation: entryNavigation,
      CommonActions: { navigate: (action) => action },
    });
    onPress();
    const entry = entryNavigation.dispatch.mock.calls[0][0];
    expect(entry).toMatchObject({ name: 'AddSigningDevice', params: { keyToRotate: vaultKey } });
    expect(entry.params.hasInitialTimelock).toBeUndefined();
    expect(entry.params.initialTimelockDuration).toBeUndefined();
    const hasInitialTimelock = requirementFromStoredWallet(
      activeVault.scheme.miniscriptScheme.usedMiniscriptTypes,
      entry.params.hasInitialTimelock
    );
    expect(hasInitialTimelock).toBe(true);
    const { navigation, setCreating } = footerFixture({
      ...entry.params,
      hasInitialTimelock,
      initialTimelockDuration: entry.params.initialTimelockDuration,
    });
    expect(setCreating).not.toHaveBeenCalled();
    expect(navigation.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'SelectInitialTimelock',
        params: expect.objectContaining({ hasInitialTimelock: true, keyToRotate: vaultKey }),
      })
    );
    expect(navigation.dispatch.mock.calls[0][0].params.initialTimelockDuration).toBeUndefined();
  });
});

describe('AddSigningDevice existing primary-key selection', () => {
  function selectionFixture(type: VaultType, n = 3, keyToRotate?: string) {
    const declaration = findNode(
      signingSource,
      (node) =>
        ts.isVariableDeclaration(node) && node.name.getText(signingSource) === 'setInitialKeys'
    ) as ts.VariableDeclaration;
    const keys = ['K1', 'K2', 'K3', 'IK1', 'EK1'].map((id) => ({ id, masterFingerprint: id }));
    const signerMap = Object.fromEntries(
      keys.map((key) => [
        key.id,
        {
          ...key,
          signerXpubs: {
            [XpubTypes.P2WSH]: [{}],
            [XpubTypes.P2WPKH]: [{}],
            [XpubTypes.AMF]: [{}],
          },
        },
      ])
    );
    const scope = {
      getKeyUID: (key) => key.id,
      VaultType,
      MiniscriptTypes,
      XpubTypes,
      isSignerValidForScheme: () => ({ isValid: true }),
      WalletUtilities: { getKeyForScheme: (_isMultisig, signer) => ({ id: signer.id }) },
    };
    const setInitialKeys = expressionValue(signingSource, declaration.initializer, scope);
    const setVaultKeys = jest.fn();
    const setSelectedSigners = jest.fn();
    const activeVault = {
      type,
      signers: keys,
      scheme: {
        miniscriptScheme: {
          usedMiniscriptTypes: [
            MiniscriptTypes.TIMELOCKED,
            MiniscriptTypes.INHERITANCE,
            MiniscriptTypes.EMERGENCY,
          ],
          miniscriptElements: {
            signerFingerprints: Object.fromEntries(
              keys.map((key) => [key.id, key.masterFingerprint])
            ),
          },
        },
      },
    };
    setInitialKeys(
      activeVault,
      type,
      { m: 2, n },
      signerMap,
      setVaultKeys,
      setSelectedSigners,
      new Map(),
      keys.find((key) => key.id === keyToRotate)
    );
    return {
      vaultKeys: setVaultKeys.mock.calls[0][0],
      selected: setSelectedSigners.mock.calls[0][0] as Map<string, boolean>,
    };
  }

  test('leaves the replacement slot free and excludes IK/EK from primary preselection', () => {
    const { vaultKeys, selected } = selectionFixture(VaultType.MINISCRIPT, 3, 'K1');
    expect(vaultKeys).toEqual([{ id: 'K2' }, { id: 'K3' }]);
    expect(Array.from(selected.keys())).toEqual(['K2', 'K3']);
    expect(selected.size).toBeLessThan(3);
  });

  test('respects the chosen primary count when changing a scheme', () => {
    const { vaultKeys, selected } = selectionFixture(VaultType.MINISCRIPT, 1, 'K1');
    expect(vaultKeys).toEqual([{ id: 'K2' }]);
    expect(Array.from(selected.keys())).toEqual(['K2']);
  });

  test('preserves a fresh new-scheme selection without a rotation target', () => {
    const { vaultKeys, selected } = selectionFixture(VaultType.MINISCRIPT);
    expect(vaultKeys).toEqual([]);
    expect(selected.size).toBe(0);
  });

  test('preserves ordinary wallet preselection', () => {
    const { vaultKeys, selected } = selectionFixture(VaultType.DEFAULT, 3, 'K1');
    expect(vaultKeys).toEqual([{ id: 'K2' }, { id: 'K3' }, { id: 'IK1' }]);
    expect(Array.from(selected.keys())).toEqual(['K2', 'K3', 'IK1']);
  });
});

describe('primary selection validation with retained fallback keys', () => {
  const intelSource = ts.createSourceFile('useSignerIntel.tsx', fs.readFileSync(
    path.join(process.cwd(), 'src/hooks/useSignerIntel.tsx'), 'utf8'
  ), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = (name: string) => findNode(intelSource, node =>
    ts.isVariableDeclaration(node) && node.name.getText(intelSource) === name
  ) as ts.VariableDeclaration;
  function validate(n: number, selectedCount: number, types: MiniscriptTypes[]) {
    const keys = Array.from({ length: selectedCount }, (_, i) => ({ id: `new-${i}`, xfp: `new-${i}` }));
    const selectedSigners = new Map(keys.map(key => [key.id, true]));
    const scope = execute(`const areSignersSame = ${declaration('areSignersSame').initializer.getText(intelSource)};
      const useSignerIntel = ${declaration('useSignerIntel').initializer.getText(intelSource)};
      result = useSignerIntel(input);`, {
      useSignerMap: () => ({ signerMap: Object.fromEntries(keys.map(key => [key.id, { type: 'MY_KEEPER' }])) }),
      usePlan: () => ({ plan: 'L1' }), SubscriptionTier: { L1: 'L1' },
      useContext: () => ({ translations: { signer: {} } }), LocalizationContext: {},
      isSignerAMF: () => false, getKeyUID: key => key.id,
      SignerType: { POLICY_SERVER: 'POLICY_SERVER' }, getSignerNameFromType: () => 'Mobile Key',
      input: { scheme: { m: 1, n, miniscriptScheme: { usedMiniscriptTypes: types } },
        vaultKeys: keys, selectedSigners, existingKeys: [{ xfp: 'old-primary' }, { xfp: 'retained-inheritance' }] },
    });
    return scope.result.areSignersValid;
  }
  test.each([
    [1, 1, true], [1, 0, false], [1, 2, false], [3, 3, true], [3, 2, false], [3, 4, false],
  ])('requires exactly %i primary keys when %i are selected', (n, selected, valid) => {
    expect(validate(n, selected, [MiniscriptTypes.TIMELOCKED, MiniscriptTypes.INHERITANCE])).toBe(valid);
  });
  test('Emergency Key also does not increase the primary quorum count', () => {
    expect(validate(1, 1, [MiniscriptTypes.TIMELOCKED, MiniscriptTypes.INHERITANCE, MiniscriptTypes.EMERGENCY])).toBe(true);
  });
});
