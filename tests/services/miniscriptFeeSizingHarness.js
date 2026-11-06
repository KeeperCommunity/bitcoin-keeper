// Execute the checked-out production fee bodies without loading the app's
// native, Electrum, storage or key-management dependencies. No fee logic is mocked.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const bitcoinJS = require('bitcoinjs-lib');
const root = path.resolve(__dirname, '../..');

function evaluate(source, bindings = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, ...bindings });
  return module.exports;
}

const enums = evaluate(fs.readFileSync(path.join(root, 'src/services/wallets/enums/index.ts'), 'utf8'));
const miniscript = evaluate(
  fs.readFileSync(path.join(root, 'src/services/wallets/operations/miniscript/miniscript.ts'), 'utf8'),
  { require: (name) => {
    if (name !== '@bitcoinerlab/miniscript') throw new Error(`Unexpected dependency: ${name}`);
    return require(name);
  } }
);
const { coinselect } = evaluate(
  fs.readFileSync(path.join(root, 'src/services/wallets/operations/coinselectFixed.js'), 'utf8')
);

function operations(sourceText = fs.readFileSync(path.join(root, 'src/services/wallets/operations/index.ts'), 'utf8')) {
  const ast = ts.createSourceFile('operations.ts', sourceText, ts.ScriptTarget.Latest, true);
  const declarations = ['deepClone', 'fixedCoinselect', 'updateInputsForFeeCalculation', 'updateOutputsForFeeCalculation'];
  const members = ['getSpendableUTXOs', 'calculateSendMaxFee', 'prepareTransactionPrerequisites', 'prepareCustomTransactionPrerequisites'];
  const selected = declarations.map((name) => {
    const declaration = ast.statements.find((node) => ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((entry) => entry.name.getText(ast) === name));
    if (!declaration) throw new Error(`Missing production declaration: ${name}`);
    return declaration.getText(ast);
  });
  const walletClass = ast.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'WalletOperations');
  if (!walletClass) throw new Error('Missing production WalletOperations class');
  const selectedMembers = members.map((name) => {
    const member = walletClass.members.find((node) => node.name?.getText(ast) === name);
    if (!member) throw new Error(`Missing production member: ${name}`);
    return member.getText(ast);
  });
  return evaluate(`${selected.join('\n')}\nclass WalletOperations {\n${selectedMembers.join('\n')}\n}\nmodule.exports = { updateInputsForFeeCalculation, WalletOperations };`, {
    ...enums, bitcoinJS, coinselect, generateBitcoinScript: miniscript.generateBitcoinScript,
  });
}

function wallet(m, n, scriptType = enums.ScriptTypes.P2WSH, compiledMiniscript = 'pk(K1<0;1>)') {
  return {
    entityKind: enums.EntityKind.VAULT, isMultiSig: true, type: enums.VaultType.MINISCRIPT,
    scriptType, networkType: enums.NetworkType.TESTNET,
    scheme: { m, n, miniscriptScheme: { miniscript: compiledMiniscript } },
    specs: { confirmedUTXOs: [], unconfirmedUTXOs: [] },
  };
}

function inputLength(api, vault, witness) {
  return api.updateInputsForFeeCalculation(vault, [{ value: 100000, txId: 'disposable-input', vout: 0 }], {
    selectedScriptWitness: witness,
  })[0].script.length;
}

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = (value) => JSON.parse(JSON.stringify(value));
const recipientAddress = bitcoinJS.payments.p2wpkh({ hash: Buffer.alloc(20, 1), network: bitcoinJS.networks.testnet }).address;
const secondAddress = bitcoinJS.payments.p2wsh({ hash: Buffer.alloc(32, 2), network: bitcoinJS.networks.testnet }).address;

// A small financial integration matrix runs all three real public APIs. The
// golden digest includes selected inputs, fees, adjusted recipients and change.
function apiOutcomes(api, vault, witness, inputMode, feeRate, insufficient = false) {
  const funds = insufficient ? [1] : [100000, 200000, 40000];
  function fresh() {
    const currentWallet = plain(vault);
    const inputs = funds.map((value, i) => ({ txId: `disposable-${i}`, vout: i, value, spendability: 'spendable' }));
    currentWallet.specs.confirmedUTXOs = inputs.slice(0, 2);
    currentWallet.specs.unconfirmedUTXOs = inputs.slice(2).concat({ txId: 'excluded', vout: 9, value: 99999, spendability: 'doNotSpend' });
    return { currentWallet, inputs, selected: inputMode === 'explicit' ? inputs : undefined };
  }
  const satisfier = { selectedScriptWitness: witness };
  const recipients = [{ address: recipientAddress, amount: 50000 }, { address: secondAddress, amount: 25000 }];
  const averageFees = {
    low: { feePerByte: feeRate, estimatedBlocks: 6 },
    medium: { feePerByte: feeRate + 2, estimatedBlocks: 3 },
    high: { feePerByte: feeRate + 4, estimatedBlocks: 1 },
  };
  const results = {};
  if (!insufficient) {
    const f = fresh();
    results.sendMax = api.WalletOperations.calculateSendMaxFee(f.currentWallet, [{ address: recipientAddress, amount: 0 }], feeRate, f.selected, satisfier);
    results.sendMaxInputsAfter = f.inputs;
  }
  {
    const f = fresh();
    results.priorities = api.WalletOperations.prepareTransactionPrerequisites(f.currentWallet, recipients, averageFees, f.selected, satisfier);
    results.priorityInputsAfter = f.inputs;
  }
  {
    const f = fresh();
    results.custom = api.WalletOperations.prepareCustomTransactionPrerequisites(f.currentWallet,
      recipients.map(({ address, amount }) => ({ address, value: amount })), feeRate, f.selected, satisfier);
    results.customInputsAfter = f.inputs;
  }
  return plain(results);
}

module.exports = { operations, wallet, inputLength, apiOutcomes, hash, plain, enums, miniscript, recipientAddress };
