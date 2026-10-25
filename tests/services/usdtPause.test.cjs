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
  const run = vm.runInNewContext(`(function (require, module, exports) { ${code}\n})`, {
    Date,
    Error,
    Promise,
  });
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
      transactions: [
        {
          transactionId: 'chain-1',
          from: 'TStoredGasFreeAddress',
          to: 'TRecipient',
          formattedValue: 2,
          confirmed: true,
          blockNumber: 1,
          blockTimestamp: 100,
        },
        {
          transactionId: 'chain-no-time',
          from: 'TStoredGasFreeAddress',
          to: 'TRecipient',
          formattedValue: 1,
          confirmed: true,
          blockNumber: 0,
          blockTimestamp: 0,
        },
      ],
      meta: { fingerprint: '', hasMore: false },
    };
  },
};
const usdtModule = loadTypeScript('src/services/wallets/operations/dollars/USDT.ts', {
  './GasFree': historical,
  'src/services/wallets/enums': { NetworkType: network },
  './Tron': tron,
});
const service = usdtModule.default;

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
    transactions: [
      {
        traceId: 'historical-trace',
        from: 'TStoredGasFreeAddress',
        to: 'TRecipient',
        amount: '2',
        status: historical.GasFreeTransferStatus.WAITING,
        timestamp: 50,
        isGasFree: true,
      },
    ],
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

test('stored address, chain reads and ambiguous historical request survive the pause', async () => {
  assert.equal(await factory.updateUSDTWalletAccountStatus(wallet), wallet.accountStatus);
  assert.equal(await factory.syncUSDTWalletBalance(wallet), 42);
  assert.equal(balanceCalls[0][0], wallet.accountStatus.gasFreeAddress);
  assert.equal(factory.getAvailableBalanceUSDTWallet(wallet), 10);

  const transactions = await factory.syncUSDTWalletTransactions(wallet);
  assert.equal(historyCalls[0][0], wallet.accountStatus.gasFreeAddress);
  assert.equal(transactions.length, 3);
  assert.equal(transactions[0].txId, 'chain-1');
  assert.equal(transactions[0].status, historical.GasFreeTransferStatus.CHAIN_CONFIRMED);
  assert.equal(transactions[1].traceId, 'historical-trace');
  assert.equal(transactions[0].to, transactions[1].to);
  assert.equal(transactions[0].amount, transactions[1].amount);
  assert.equal(transactions[1].txId, undefined);
  assert.equal(usdtModule.isHistoricalUnverifiedUSDTRequest(transactions[0]), false);
  assert.equal(usdtModule.isHistoricalUnverifiedUSDTRequest(transactions[1]), true);
  assert.equal(transactions[1].status, historical.GasFreeTransferStatus.WAITING);
  assert.equal(transactions[2].txId, 'chain-no-time');
  assert.equal(transactions[2].status, historical.GasFreeTransferStatus.CONFIRMING);
  assert.equal(transactions[2].blockNumber, 0);
  assert.equal(usdtModule.isUSDTStatusUnavailable(transactions[0]), false);
  assert.equal(usdtModule.isUSDTStatusUnavailable(transactions[1]), true);
  assert.equal(
    usdtModule.isHistoricalUnverifiedUSDTRequest({
      traceId: 'old-request',
      status: historical.GasFreeTransferStatus.SUCCEED,
    }),
    true,
    'a stored provider status is not independent proof of an on-chain transfer'
  );
});

test('refresh upgrades a cached pending entry when its confirmed chain record appears', async () => {
  const cached = {
    ...wallet,
    specs: {
      ...wallet.specs,
      transactions: [
        ...wallet.specs.transactions,
        {
          txId: 'chain-1',
          traceId: 'saved-provider-trace',
          from: 'TStoredGasFreeAddress',
          to: 'TRecipient',
          amount: '2',
          status: historical.GasFreeTransferStatus.CONFIRMING,
          timestamp: 90,
          blockNumber: 0,
          isGasFree: true,
        },
      ],
    },
  };
  const transactions = await factory.syncUSDTWalletTransactions(cached);
  const confirmed = transactions.find((tx) => tx.txId === 'chain-1');
  assert.equal(confirmed.status, historical.GasFreeTransferStatus.CHAIN_CONFIRMED);
  assert.equal(confirmed.blockNumber, 1);
  assert.equal(confirmed.traceId, 'saved-provider-trace');
  assert.equal(
    transactions.find((tx) => tx.traceId === 'historical-trace').status,
    historical.GasFreeTransferStatus.WAITING
  );
});

test('an unmatched legacy success stays in history but loses its success claim', async () => {
  const legacySuccess = {
    txId: 'older-than-first-page',
    traceId: 'saved-provider-trace',
    from: 'TStoredGasFreeAddress',
    to: 'TRecipient',
    amount: '3',
    status: historical.GasFreeTransferStatus.SUCCEED,
    timestamp: 20,
    blockNumber: 20,
    isGasFree: true,
  };
  const cached = {
    ...wallet,
    specs: { ...wallet.specs, transactions: [...wallet.specs.transactions, legacySuccess] },
  };

  // The UI must be truthful before refresh too, including when offline.
  assert.equal(usdtModule.isUSDTStatusUnavailable(legacySuccess), true);
  const transactions = await factory.syncUSDTWalletTransactions(cached);
  const retained = transactions.find((tx) => tx.txId === legacySuccess.txId);
  assert.equal(transactions.length, 4);
  assert.equal(retained.status, historical.GasFreeTransferStatus.UNVERIFIED);
  assert.equal(retained.traceId, legacySuccess.traceId);
  assert.equal(retained.timestamp, legacySuccess.timestamp);
  assert.equal(retained.blockNumber, legacySuccess.blockNumber);
  assert.equal(usdtModule.isUSDTStatusUnavailable(retained), true);
  assert.equal(legacySuccess.status, historical.GasFreeTransferStatus.SUCCEED);
});

test('matching confirmed history corrects a cached legacy success without losing its trace', async () => {
  const cached = {
    ...wallet,
    specs: {
      ...wallet.specs,
      transactions: [
        ...wallet.specs.transactions,
        {
          txId: 'chain-1',
          traceId: 'saved-provider-trace',
          from: 'TStoredGasFreeAddress',
          to: 'TRecipient',
          amount: '2',
          status: historical.GasFreeTransferStatus.SUCCEED,
          timestamp: 80,
          blockNumber: 1,
          isGasFree: true,
        },
      ],
    },
  };

  const transactions = await factory.syncUSDTWalletTransactions(cached);
  const confirmed = transactions.filter((tx) => tx.txId === 'chain-1');
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].status, historical.GasFreeTransferStatus.CHAIN_CONFIRMED);
  assert.equal(confirmed[0].traceId, 'saved-provider-trace');
  assert.equal(confirmed[0].blockNumber, 1);
  assert.equal(usdtModule.isUSDTStatusUnavailable(confirmed[0]), false);
});

test('missing saved address is never replaced by the owner address', async () => {
  const missing = { ...wallet, accountStatus: { ...wallet.accountStatus, gasFreeAddress: '' } };
  await assert.rejects(factory.syncUSDTWalletBalance(missing), /Stored USDT address/);
  await assert.rejects(factory.syncUSDTWalletTransactions(missing), /Stored USDT address/);
});
