const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = 'src/screens/AppSettings/Node/NodeSettings.tsx';
const source = ts.createSourceFile(
  file,
  fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const component = source.statements.find(
  (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'NodeSettings'
);
const names = new Set(['onDelete', 'onDisconnectToNode']);
const handlers = component.body.statements
  .filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        names.has(declaration.name.getText(source))
      )
  )
  .map((statement) => statement.getText(source))
  .join('\n');
const code = ts.transpileModule(
  `${handlers}\nglobalThis.handlers = { onDelete, onDisconnectToNode };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }
).outputText;

function fixture({ switchOnDisconnect = false, switchOnDisconnectRoundTrip = false } = {}) {
  const state = { activeAppId: 'A', session: 1, disconnected: 0, deleted: 0, updated: 0, dispatched: 0 };
  const scope = {
    nodeListAppId: 'A',
    nodeListAccountSession: 1,
    currentBackupAccountSession: () => state.session,
    Node: {
      isAccountActive: (appId) => state.activeAppId === appId,
      nodeConnectionStatus: () => true,
      disconnect: () => {
        state.disconnected += 1;
        if (switchOnDisconnect) state.activeAppId = 'B';
        if (switchOnDisconnectRoundTrip) {
          state.activeAppId = 'B'; state.session++;
          state.activeAppId = 'A'; state.session++;
        }
      },
      delete: () => {
        state.deleted += 1;
        return true;
      },
      update: () => { state.updated += 1; },
      getAllNodes: () => [],
    },
    setLoading: () => {},
    setNodeList: () => {},
    dispatch: () => { state.dispatched += 1; },
    showToast: () => {},
    console,
  };
  vm.runInNewContext(code, scope);
  return { state, handlers: scope.handlers };
}

test('delayed node confirmation from A cannot act on B', async () => {
  const f = fixture();
  f.state.activeAppId = 'B';
  const selected = { id: 7, host: 'a.example', port: 50002 };

  await f.handlers.onDisconnectToNode(selected, 'A');
  await f.handlers.onDelete(selected, 'A');

  assert.equal(f.state.disconnected, 0);
  assert.equal(f.state.deleted, 0);
  assert.equal(f.state.updated, 0);
  assert.equal(f.state.dispatched, 0);
});

test('node confirmation from the first A session cannot delete or disconnect after A to B to A', async () => {
  const f = fixture();
  f.state.activeAppId = 'B'; f.state.session++;
  f.state.activeAppId = 'A'; f.state.session++;
  const selected = { id: 7, host: 'a.example', port: 50002 };
  await f.handlers.onDisconnectToNode(selected, 'A', 1);
  await f.handlers.onDelete(selected, 'A', 1);
  assert.equal(f.state.disconnected, 0);
  assert.equal(f.state.deleted, 0);
  assert.equal(f.state.updated, 0);
  assert.equal(f.state.dispatched, 0);
});

test('account roundtrip during node disconnect cannot update the later A session', async () => {
  const f = fixture({ switchOnDisconnectRoundTrip: true });
  await f.handlers.onDisconnectToNode({ id: 7, host: 'a.example', port: 50002 }, 'A', 1);
  assert.equal(f.state.disconnected, 1);
  assert.equal(f.state.updated, 0);
  assert.equal(f.state.dispatched, 0);
});

test('saved node callback retained from first A render cannot save under the later A session', async () => {
  const selectedFile = 'src/screens/AppSettings/Node/NodeSelection.tsx';
  const selectedSource = ts.createSourceFile(selectedFile,
    fs.readFileSync(path.join(__dirname, '../..', selectedFile), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selectedComponent = selectedSource.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'NodeSelection');
  const callback = selectedComponent.body.statements.find((statement) =>
    ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
      declaration.name.getText(selectedSource) === 'onSaveCallback'));
  let writes = 0;
  const selectedScope = {
    renderedAppId: 'A', renderedAccountSession: 1,
    currentBackupAccountSession: () => 3,
    Node: { isAccountActive: (id) => id === 'A', save: () => { writes++; } },
    beginBackupLocalOperation: () => { writes++; },
  };
  vm.runInNewContext(ts.transpileModule(`${callback.getText(selectedSource)};globalThis.save = onSaveCallback;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText, selectedScope);
  await selectedScope.save({ id: 7, host: 'a.example', port: 50002 });
  assert.equal(writes, 0);
});

test('node disconnect switching accounts cannot update the new Realm', async () => {
  const f = fixture({ switchOnDisconnect: true });
  await f.handlers.onDisconnectToNode({ id: 7, host: 'a.example', port: 50002 }, 'A');

  assert.equal(f.state.disconnected, 1);
  assert.equal(f.state.updated, 0);
  assert.equal(f.state.dispatched, 0);
});
