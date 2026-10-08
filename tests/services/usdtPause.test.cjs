const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '../..');
function loadTypeScript(relativePath, imports = {}) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const loadImport = (specifier) => {
    if (!(specifier in imports)) throw new Error(`Unexpected import: ${specifier}`);
    return imports[specifier];
  };
  const run = vm.runInNewContext(
    `(function (require, module, exports) { ${code}\n})`,
    { Date, Error, Promise }
  );
  run(loadImport, module, module.exports);
  return module.exports;
}

const network = { MAINNET: 'MAINNET', TESTNET: 'TESTNET' };
const historical = loadTypeScript('src/services/wallets/operations/dollars/GasFree.ts');
const balanceCalls = [];
const historyCalls = [];
const tron = {
  isValidTronAddress: () => true,
  getTrc20Balance: async (...args) => {
    balanceCalls.push(args);
    return { balance: 42, decimals: 6 };
  },
  getTrc20Transactions: async (...args) => {
    historyCalls.push(args);
    return {
      transactions: [{
        transactionId: 'chain-1',
        from: 'TSender',
        to: 'TStoredGasFreeAddress',
        formattedValue: 5,
        blockNumber: 1,
        blockTimestamp: 100,
      }],
      meta: { fingerprint: '', hasMore: false },
    };
  },
};
const service = loadTypeScript('src/services/wallets/operations/dollars/USDT.ts', {
  './GasFree': historical,
  'src/services/wallets/enums': { NetworkType: network },
  './Tron': tron,
}).default;

const wallet = {
  networkType: network.MAINNET,
  accountStatus: {
    address: 'TOwner',
    gasFreeAddress: 'TStoredGasFreeAddress',
    frozen: 3,
    isActive: true,
    canTransfer: true,
    nextNonce: 2,
    fees: { transferFee: 1, activateFee: 0 },
  },
  specs: {
    address: 'TOwner',
    privateKey: 'fixture-only',
    balance: 10,
    transactions: [{
      traceId: 'historical-trace',
      from: 'TStoredGasFreeAddress',
      to: 'TRecipient',
      amount: '2',
      status: historical.GasFreeTransferStatus.WAITING,
      timestamp: 50,
      isGasFree: true,
    }],
    hasNewUpdates: false,
    lastSynched: 1,
  },
};

const factory = loadTypeScript('src/services/wallets/factories/USDTWalletFactory.ts', {
  'crypto-js': { SHA256: () => ({ toString: () => 'fixture-id' }) },
  '../enums': {
    NetworkType: network,
    EntityKind: { USDT_WALLET: 'USDT_WALLET' },
    VisibilityType: { DEFAULT: 'DEFAULT' },
  },
  '../operations/dollars/Tron': {},
  '../operations/dollars/USDT': { __esModule: true, default: service },
  '../operations/BIP85': { __esModule: true, default: {} },
  '../operations/dollars/GasFree': historical,
  'src/utils/service-utilities/config': {
    __esModule: true,
    default: { isDevMode: () => false },
  },
});

test('retired provider operations fail closed without a provider import', async () => {
  assert.equal(await service.isGasFreeSupported(network.MAINNET), false);
  assert.equal((await service.getServiceProviders(network.MAINNET)).length, 0);
  await assert.rejects(service.getAccountStatus('TOwner'), /USDT activity is paused/);
  assert.equal((await service.prepareTransfer({ source: wallet })).isValid, false);
  assert.equal((await service.submitTransfer(wallet, {})).success, false);
  await assert.rejects(service.getTransferStatus('historical-trace'), /USDT activity is paused/);
  assert.equal((await service.monitorTransfer('historical-trace')).success, false);
});

test('stored address, chain reads and historical trace survive the pause', async () => {
  assert.equal(await factory.updateUSDTWalletAccountStatus(wallet), wallet.accountStatus);
  assert.equal(await factory.syncUSDTWalletBalance(wallet), 42);
  assert.equal(balanceCalls[0][0], wallet.accountStatus.gasFreeAddress);
  assert.equal(factory.getAvailableBalanceUSDTWallet(wallet), 10);

  const transactions = await factory.syncUSDTWalletTransactions(wallet);
  assert.equal(historyCalls[0][0], wallet.accountStatus.gasFreeAddress);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].txId, 'chain-1');
  assert.equal(transactions[1].traceId, 'historical-trace');
  assert.equal(transactions[1].status, historical.GasFreeTransferStatus.WAITING);
});

test('missing saved address is never replaced by the owner address', async () => {
  const missing = { ...wallet, accountStatus: { ...wallet.accountStatus, gasFreeAddress: '' } };
  await assert.rejects(factory.syncUSDTWalletBalance(missing), /Stored USDT address/);
  await assert.rejects(factory.syncUSDTWalletTransactions(missing), /Stored USDT address/);
});
