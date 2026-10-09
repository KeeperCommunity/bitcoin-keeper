const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '../..');
const translations = { usdtWalletText: { statusUnavailable: 'Status unavailable' } };
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useContext: () => ({ translations }),
};

function loadSource(file, imports) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function (require, module, exports) { ${code}\n})`)(
    (specifier) => {
      if (!(specifier in imports)) throw new Error(`Unexpected import: ${specifier}`);
      return imports[specifier];
    },
    module,
    module.exports
  );
  return module.exports;
}

function nodes(tree) {
  if (tree == null || tree === false) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [tree];
  return [tree, ...nodes(tree.children)];
}

const statuses = loadSource('src/services/wallets/operations/dollars/GasFree.ts', {});
const { GasFreeTransferStatus } = statuses;
const usdt = loadSource('src/services/wallets/operations/dollars/USDT.ts', {
  './GasFree': statuses,
  'src/services/wallets/enums': { NetworkType: { MAINNET: 'MAINNET' } },
  './Tron': {},
});

const uiImports = {
  react: React,
  '@gluestack-ui/themed-native-base': {
    Box: 'Box',
    useColorMode: () => ({ colorMode: 'light' }),
  },
  'react-native': {
    StyleSheet: { create: (styles) => styles },
    TouchableOpacity: 'TouchableOpacity',
  },
  'src/constants/responsive': { hp: (value) => value, wp: (value) => value },
  'src/components/KeeperText': 'Text',
  'src/theme/Colors': {},
  'src/context/Localization/LocContext': { LocalizationContext: {} },
  'src/services/wallets/operations/dollars/GasFree': statuses,
  'src/services/wallets/operations/dollars/USDT': usdt,
};

const StatusContent = loadSource(
  'src/screens/USDT/components/StatusContent.tsx',
  uiImports
).default;

const rowImports = {
  ...uiImports,
  moment: () => ({ format: () => 'saved date' }),
  'src/screens/Home/components/CurrencyInfo': 'CurrencyInfo',
  'src/hooks/useLabelsNew': () => ({ labels: {} }),
  'src/services/wallets/enums': { EntityKind: { USDT_WALLET: 'USDT_WALLET' } },
  './ThemedColor/ThemedColor': () => 'color',
};
for (const icon of [
  'icon_sent_red',
  'icon_recieved_red',
  'icon_recieved_dark',
  'transaction_pending',
  'cache_icon',
  'icon_arrow_grey',
  'icon_arrow_white',
]) {
  rowImports[`src/assets/images/${icon}.svg`] = icon;
}
const TransactionElement = loadSource('src/components/TransactionElement.tsx', rowImports).default;

const wallet = {
  entityKind: 'USDT_WALLET',
  accountStatus: { gasFreeAddress: 'TStoredGasFreeAddress' },
};
const storedTransaction = {
  txId: 'saved-chain-id',
  traceId: 'saved-provider-trace',
  from: 'TStoredGasFreeAddress',
  to: 'TRecipient',
  amount: '2',
  timestamp: 100,
  blockNumber: 100,
  status: GasFreeTransferStatus.SUCCEED,
  isGasFree: true,
};

test('offline legacy success with txId shows unavailable in the row and detail badge', () => {
  assert.equal(usdt.isHistoricalUnverifiedUSDTRequest(storedTransaction), false);
  assert.equal(usdt.isUSDTStatusUnavailable(storedTransaction), true);

  const row = nodes(
    TransactionElement({
      transaction: storedTransaction,
      wallet,
      isCached: false,
    })
  );
  assert.ok(row.includes('Status unavailable'));
  assert.equal(
    row.some((node) => node.type === 'transaction_pending'),
    false
  );

  // The badge stays safe even if a caller forgets to pass `unavailable`.
  const badge = nodes(StatusContent({ status: storedTransaction.status }));
  assert.ok(badge.includes('Status unavailable'));
  assert.equal(badge.includes('SUCCESS'), false);
});

test('only a confirmed chain status shows SUCCESS; actual pending rows keep the icon', () => {
  const confirmed = { ...storedTransaction, status: GasFreeTransferStatus.CHAIN_CONFIRMED };
  assert.equal(usdt.isUSDTStatusUnavailable(confirmed), false);
  const row = nodes(TransactionElement({ transaction: confirmed, wallet, isCached: false }));
  assert.equal(row.includes('Status unavailable'), false);
  assert.equal(
    row.some((node) => node.type === 'transaction_pending'),
    false
  );
  assert.ok(nodes(StatusContent({ status: confirmed.status })).includes('SUCCESS'));

  const pending = {
    ...storedTransaction,
    status: GasFreeTransferStatus.CONFIRMING,
    blockNumber: 0,
  };
  const pendingRow = nodes(TransactionElement({ transaction: pending, wallet, isCached: false }));
  assert.equal(
    pendingRow.some((node) => node.type === 'transaction_pending'),
    true
  );
});
