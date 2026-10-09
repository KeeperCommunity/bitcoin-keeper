const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../../src/services/wallets/operations/dollars/Tron.ts'),
  'utf8'
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

test('TRC20 history requests confirmed rows and keeps the pagination filter', async () => {
  const requested = [];
  const imports = {
    '../../enums': { NetworkType: { MAINNET: 'MAINNET', TESTNET: 'TESTNET' } },
    bip39: {},
    bip32: () => ({}),
    '../taproot-utils/noble_ecc': {},
    'bitcoinjs-lib': {},
    tronweb: {
      TronWeb: class {
        isAddress() {
          return true;
        }
      },
    },
  };
  const fetch = async (url) => {
    requested.push(url);
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            transaction_id: 'disposable-confirmed',
            block_timestamp: 100000,
            from: 'TFrom',
            to: 'TTo',
            type: 'Transfer',
            value: '2000000',
            token_info: { address: 'TContract', decimals: 6 },
          },
        ],
        meta: { fingerprint: 'next-page', page_size: 2 },
      }),
    };
  };
  const module = { exports: {} };
  vm.runInNewContext(`(function (require, module, exports) { ${code}\n})`, {
    URLSearchParams,
    fetch,
  })(
    (name) => {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
    module,
    module.exports
  );

  const result = await module.exports.getTrc20Transactions(
    'TStoredAddress',
    'TContract',
    'MAINNET',
    2,
    'prior-page'
  );
  const url = new URL(requested[0]);
  assert.equal(url.searchParams.get('only_confirmed'), 'true');
  assert.equal(url.searchParams.has('only_unconfirmed'), false);
  assert.equal(url.searchParams.get('fingerprint'), 'prior-page');
  assert.equal(url.searchParams.get('limit'), '2');
  assert.equal(url.searchParams.get('contract_address'), 'TContract');
  assert.equal(result.transactions[0].confirmed, true);
  assert.equal(result.transactions[0].blockNumber, 100);
  assert.equal(result.meta.fingerprint, 'next-page');
  assert.equal(result.meta.hasMore, true);

  const usdtSource = fs.readFileSync(
    path.join(__dirname, '../../src/services/wallets/operations/dollars/USDT.ts'),
    'utf8'
  );
  const usdtCode = ts.transpileModule(usdtSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const usdtModule = { exports: {} };
  vm.runInNewContext(`(function (require, module, exports) { ${usdtCode}\n})`)(
    (name) => {
      if (name === './Tron') return module.exports;
      if (name === './GasFree')
        return {
          GasFreeTransferStatus: {
            CHAIN_CONFIRMED: 'CONFIRMED',
            CONFIRMING: 'CONFIRMING',
          },
        };
      if (name === 'src/services/wallets/enums') return imports['../../enums'];
      throw new Error(`Unexpected import: ${name}`);
    },
    usdtModule,
    usdtModule.exports
  );
  const mapped = await usdtModule.exports.default.getUSDTTransactions(
    'TStoredAddress',
    'MAINNET',
    2,
    'prior-page'
  );
  assert.equal(mapped.transactions[0].status, 'CONFIRMED');
  assert.equal(mapped.transactions[0].blockNumber, 100);
  assert.equal(mapped.meta.fingerprint, 'next-page');
  assert.equal(new URL(requested[1]).searchParams.get('only_confirmed'), 'true');
  assert.equal(new URL(requested[1]).searchParams.get('fingerprint'), 'prior-page');
});
