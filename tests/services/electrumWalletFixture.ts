import ElectrumClient from 'src/services/electrum/client';
import WalletOperations from 'src/services/wallets/operations';

const fundingTxid = '608710eb040d935dedb6c4d6321369382b2bd45533a7442a6fa98add3860d46b';
const previousTxid = '89b193b61f7681ee588939932219f3d92e54a1873a9fb823647038f3879fba00';
const externalAddress = 'tb1ql7w62elx9ucw4pj5lgw4l028hmuw80sndtntxt';

// The wallet and vault suites exercise address scanning, transaction parsing, coin selection,
// and PSBT signing. Give each generated wallet one funded testnet address without using a
// public Electrum server or a mutable public wallet balance.
export const installElectrumWalletFixture = () => {
  let fundedAddress: string | null = null;
  const syncWallets = WalletOperations.syncWalletsViaElectrumClient;

  jest.spyOn(WalletOperations, 'syncWalletsViaElectrumClient').mockImplementation((...args) => {
    fundedAddress = null;
    return syncWallets(...args);
  });
  jest.spyOn(WalletOperations, 'fetchFeeRatesByPriority').mockImplementation(async () =>
    WalletOperations.mockFeeRates()
  );

  jest.spyOn(ElectrumClient, 'setActivePeer').mockImplementation(() => undefined);
  jest.spyOn(ElectrumClient, 'connect').mockResolvedValue({
    connected: true,
    connectedTo: 'fixture.electrum.test',
  });
  jest.spyOn(ElectrumClient, 'forceDisconnect').mockImplementation(() => undefined);
  jest.spyOn(ElectrumClient, 'getBlockchainHeaders').mockResolvedValue({ height: 85172, hex: '00' });
  jest.spyOn(ElectrumClient, 'syncUTXOByAddress').mockImplementation(async (addresses) => {
    if (!fundedAddress) fundedAddress = addresses[0];
    return Object.fromEntries(
      addresses.map((address) => [
        address,
        address === fundedAddress
          ? [{ txId: fundingTxid, vout: 1, value: 6000, height: 85000, address }]
          : [],
      ])
    );
  });
  jest.spyOn(ElectrumClient, 'syncHistoryByAddress').mockImplementation(async (addresses) => {
    const hasFunding = addresses.includes(fundedAddress);
    return {
      historyByAddress: Object.fromEntries(
        addresses.map((address) => [
          address,
          hasFunding && address === fundedAddress ? [{ tx_hash: fundingTxid, height: 85000 }] : [],
        ])
      ),
      txids: hasFunding ? [fundingTxid] : [],
      txidToAddress: hasFunding ? { [fundingTxid]: fundedAddress } : {},
    };
  });
  jest.spyOn(ElectrumClient, 'getTransactionsById').mockImplementation(async (txids) => {
    const transactions: Record<string, any> = {};
    for (const txid of txids) {
      if (txid === fundingTxid) {
        transactions[txid] = {
          txid,
          vin: [{ txid: previousTxid, vout: 0 }],
          vout: [
            { value: 0.00001, scriptPubKey: { addresses: [externalAddress] } },
            { value: 0.00006, scriptPubKey: { addresses: [fundedAddress] } },
          ],
          confirmations: 12,
          time: 1700000000,
          blocktime: 1700000000,
        };
      } else if (txid === previousTxid) {
        transactions[txid] = {
          txid,
          vin: [],
          vout: [{ value: 0.0001, scriptPubKey: { addresses: [externalAddress] } }],
        };
      }
    }
    return transactions;
  });
};
