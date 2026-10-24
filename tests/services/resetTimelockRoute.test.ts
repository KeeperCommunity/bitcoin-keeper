import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

// Execute the real route-parameter expression, without native UI or wallet secrets.
const source = ts.createSourceFile(
  'ResetInheritanceKey.tsx',
  fs.readFileSync(path.join(process.cwd(), 'src/screens/Vault/ResetInheritanceKey.tsx'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let params: ts.Expression;
function visit(node: ts.Node) {
  if (ts.isObjectLiteralExpression(node)) {
    const name = node.properties.find(
      (p) => ts.isPropertyAssignment(p) && p.name.getText(source) === 'name'
    ) as ts.PropertyAssignment;
    if (name?.initializer.getText(source) === "'ResetEmergencyKey'") {
      params = (
        node.properties.find(
          (p) => ts.isPropertyAssignment(p) && p.name.getText(source) === 'params'
        ) as ts.PropertyAssignment
      ).initializer;
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);

describe('Reset Keys navigation contract', () => {
  test.each(['3 months', '6 months', '9 months', '12 months'])(
    'forwards selected initial duration %s',
    (initialTimelockDuration) => {
      const vault = { id: 'disposable' };
      const script = ts.transpile(`result = (${params.getText(source)});`, {
        target: ts.ScriptTarget.ES2019,
      });
      const scope: any = {
        initialTimelockDuration,
        vault,
        inheritanceSigners: [{ id: 'test-key' }],
        selectedOptions: { 'test-key': { label: '12 months' } },
        getKeyUID: (s) => s.id,
      };
      vm.runInNewContext(script, scope);
      expect(scope.result.initialTimelockDuration).toBe(initialTimelockDuration);
      expect(scope.result.vault).toBe(vault);
      expect(scope.result.inheritanceKeys[0].duration).toBe('12 months');
    }
  );
});
