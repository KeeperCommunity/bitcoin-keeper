import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { MiniscriptTypes } from 'src/services/wallets/enums';

function readSource(relativePath: string) {
  return ts.createSourceFile(
    relativePath,
    fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

function execute(expression: ts.Expression, source: ts.SourceFile, scope: any, declarations = '') {
  vm.runInNewContext(
    ts.transpileModule(`${declarations}\nresult = (${expression.getText(source)});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2019 },
    }).outputText,
    scope
  );
  return scope.result;
}

const walletSource = readSource('src/screens/AddWalletScreen/AddNewWallet.tsx');
const entrySource = readSource('src/screens/InheritanceToolsAndTips/components/AssistedKeys.tsx');

function inheritanceRouteBinding() {
  let declaration: ts.VariableStatement;
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.name.elements.some(
        (element) => element.name.getText(walletSource) === 'isAddInheritanceKeyFromParams'
      )
    ) {
      declaration = node.parent.parent as ts.VariableStatement;
    }
    ts.forEachChild(node, visit);
  }
  visit(walletSource);
  if (!declaration) throw new Error('Missing inheritance route binding');
  return declaration.getText(walletSource);
}

function inheritanceInitializer() {
  let expression: ts.Expression;
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.name.elements[0]?.getText(walletSource) === 'inheritanceKeySelected'
    ) {
      expression = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(walletSource);
  if (!expression) throw new Error('Missing inheritance state initializer');
  return expression;
}

function inheritanceEntryNavigation() {
  let expression: ts.Expression;
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(entrySource) === 'CommonActions.navigate'
    ) {
      expression = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(entrySource);
  if (!expression) throw new Error('Missing inheritance entry navigation');
  return execute(expression, entrySource, {
    CommonActions: { navigate: (action) => action },
  });
}

function initialSelection(route: any, activeVault?: any) {
  return execute(
    inheritanceInitializer(),
    walletSource,
    {
      route,
      activeVault,
      MiniscriptTypes,
      useState: (value) => value,
    },
    inheritanceRouteBinding()
  );
}

describe('Inheritance Planning entry into wallet creation', () => {
  it('passes its actual navigation params into the screen inheritance selection', () => {
    const action = inheritanceEntryNavigation();
    expect(action.name).toBe('AddNewWallet');
    expect(initialSelection({ params: action.params })).toBe(true);
  });

  it('leaves ordinary new-wallet creation unselected without route params', () => {
    expect(initialSelection({})).toBe(false);
    expect(initialSelection({ params: {} })).toBe(false);
    expect(initialSelection({ params: { isAddInheritanceKeyFromParams: false } })).toBe(false);
  });

  it('retains inheritance selection from an existing wallet policy', () => {
    expect(
      initialSelection(
        {},
        {
          scheme: { miniscriptScheme: { usedMiniscriptTypes: [MiniscriptTypes.INHERITANCE] } },
        }
      )
    ).toBe(true);
  });
});
