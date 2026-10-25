// Build-time extraction of unchanged production workers for a CI-only native probe.
// No eval, source rewriting or production entrypoint changes occur in the app.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '../..');
const SELECTION = Object.freeze({
  'src/utils/utilities.ts': ['getAccountFromSigner', 'getKeyUID'],
  'src/store/sagas/storage.ts': ['setupKeeperAppWorker'],
  'src/store/sagas/wallets.ts': [
    'currentWalletAccountId',
    'assertWalletAccount',
    'deleteSigningDeviceWorker',
  ],
  'src/store/sagas/bhr.ts': ['currentBackupAppId', 'deleteAppImageEntityWorker'],
  'src/services/backup/transport.ts': [
    'observeBackupAccount',
    'currentBackupAccountSession',
    'clearVerifiedRemoteRevision',
  ],
});
const DEPENDENCIES = [
  'call',
  'put',
  'select',
  'dbManager',
  'realm',
  'store',
  'RealmSchema',
  'SignerType',
  'NetworkType',
  'XpubTypes',
  'WalletType',
  'DerivationPurpose',
  'getJSONFromRealmObject',
  'beginBackupLocalOperation',
  'commitBackupLocalOperation',
  'queueCommittedBackupWorker',
  'captureError',
  'uaiType',
  'uaiChecks',
  'showDeletingKeyModal',
  'hideDeletingKeyModal',
  'showKeyDeletedSuccessModal',
  'relaySignersUpdateFail',
  'Relay',
  'WalletUtilities',
  'setupRecoveryKeySigningKey',
  'addNewWalletsWorker',
  'addSigningDeviceWorker',
  'SubscriptionTier',
  'AppSubscriptionLevel',
  'DeviceInfo',
  'setAppId',
  'addAccount',
  'updateDefaultWalletCreatedByAppId',
  'setAppCreated',
  'resetRealyWalletState',
  'loadConciergeUser',
  'loadConciergeTickets',
  'LoginMethod',
  'setBiometricEnabledAppId',
  'setAppCreationError',
];

function extract(file, names) {
  const source = fs.readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found = new Map();
  for (const statement of parsed.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      names.includes(statement.name.text)
    ) {
      if (found.has(statement.name.text)) throw new Error('Duplicate selected function');
      found.set(statement.name.text, statement.getText(parsed).replace(/^export\s+/, ''));
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) {
          if (found.has(declaration.name.text)) throw new Error('Duplicate selected variable');
          found.set(declaration.name.text, `const ${declaration.getText(parsed)};`);
        }
      }
    }
  }
  if (found.size !== names.length) throw new Error('Production probe selection changed');
  return {
    source: names.map((name) => found.get(name)).join('\n'),
    sha256: crypto.createHash('sha256').update(source).digest('hex'),
  };
}

function prepare(root = ROOT) {
  const sources = [];
  const provenance = [];
  for (const [relative, names] of Object.entries(SELECTION)) {
    const extracted = extract(path.join(root, relative), names);
    sources.push(extracted.source);
    provenance.push({ path: relative, sha256: extracted.sha256, names });
  }
  const input = `function createWorkers(deps) {
    const { ${DEPENDENCIES.join(',')} } = deps;
    let activeAccount; let accountSession = 0; let lastDiagnostic;
    const verifiedRemoteRevisions = new Map(); const baselineEpochs = new Map();
    ${sources.join('\n')}
    return { setupKeeperAppWorker, deleteSigningDeviceWorker, deleteAppImageEntityWorker,
      getKeyUID, observeBackupAccount, currentBackupAccountSession };
  }
  module.exports = { createWorkers, provenance: ${JSON.stringify(provenance)} };`;
  const result = ts.transpileModule(input, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  });
  if (result.diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error))
    throw new Error('Probe extraction syntax failed');
  const directory = path.join(root, '.github/native/.generated');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'r5_workers.js'), result.outputText);
  return provenance;
}
if (require.main === module) {
  prepare();
  process.stdout.write('R5 production worker extraction prepared\n');
}
module.exports = { prepare, extract, SELECTION, DEPENDENCIES };
