import assert from 'assert';
import ElectrumClient from '../../src/services/electrum/client';
import { predefinedTestnetNodes } from '../../src/services/electrum/predefinedNodes';
import * as bitcoinJS from 'bitcoinjs-lib';

const mockClients: any[] = [];
const mockTxid = '24913105c497b4bb4ccf81b03857c8306aba0e58ccde792d981f6c18efdb24b8';

// Exercise the real ElectrumClient facade against deterministic protocol replies.
// A public Electrum server is outside the control of CI.
jest.mock('electrum-client', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((_net, _tls, _port, host) => {
    const client = {
      host,
      initElectrum: jest.fn(async () => {
        if (host === 'blackie.c3-soft.com') {
          throw new Error('connect ECONNREFUSED 127.0.0.1:50002');
        }
        return ['fixture-server', '1.4'];
      }),
      close: jest.fn(),
      onError: null,
      server_ping: jest.fn(async () => undefined),
      server_features: jest.fn(async () => ({
        server_version: 'fixture-server',
        protocol_min: '1.4',
        protocol_max: '1.4.3',
      })),
      blockchainScripthash_listunspentBatch: jest.fn(async (hashes) =>
        hashes.map((param, index) => ({
          param,
          result: index === 0 ? [{ tx_hash: mockTxid, tx_pos: 1, value: 12345, height: 100 }] : [],
        }))
      ),
      blockchainScripthash_getHistoryBatch: jest.fn(async (hashes) =>
        hashes.map((param, index) => ({
          param,
          result: index === 0 ? [{ tx_hash: mockTxid, height: 100 }] : [],
        }))
      ),
      blockchainEstimatefee: jest.fn(async () => 0.00002),
      blockchainTransaction_getBatch: jest.fn(async (txids) =>
        txids.map((param) => ({
          param,
          result: {
            txid: param,
            hex: 'fixture-hex',
            vout: [{ scriptPubKey: { address: 'tb1qfixture' } }],
          },
        }))
      ),
    };
    mockClients.push(client);
    return client;
  }),
}));

jest.mock('src/store/store', () => ({
  store: {
    getState: () => ({
      settings: { bitcoinNetworkType: 'TESTNET' },
    }),
  },
}));

const onlineNode = {
  ...predefinedTestnetNodes[1],
  isConnected: true,
};
const offlineNode = {
  ...predefinedTestnetNodes[0],
  isConnected: true,
};
const addresses = [
  'tb1qd2u9tvuqzadgeh02vppd33e7u2fatuwrw7h4q5',
  'tb1qwdm8hdyvv5jn05qq858lgnk50heucvxvqtl4sx',
];

beforeEach(async () => {
  mockClients.length = 0;
  ElectrumClient.setActivePeer([onlineNode], onlineNode);
  const connection = await ElectrumClient.connect();
  assert.ok(connection.connected);
});

afterAll(() => {
  ElectrumClient.forceDisconnect();
});

describe('ElectrumClient', () => {
  describe('Connection Tests', () => {
    it('should test connection successfully', async () => {
      const result = await ElectrumClient.testConnection(onlineNode);
      assert.ok(result.connected);
    });

    it('should fail connection when node is unreachable', async () => {
      const result = await ElectrumClient.testConnection(offlineNode);
      assert.ok(!result.connected);
      assert.ok(result.error);
      assert.strictEqual(result.errorType, 'network');
    });

    it('should reconnect to the next peer when connection fails', async () => {
      ElectrumClient.setActivePeer([offlineNode, onlineNode], offlineNode);
      const result = await ElectrumClient.connect();
      assert.ok(result.connected);
      assert.strictEqual(result.connectedTo, onlineNode.host);
      assert.strictEqual(ElectrumClient.getActivePeer()?.host, onlineNode.host);

      ElectrumClient.forceDisconnect();
      const reconnected = await ElectrumClient.reconnect();
      assert.ok(reconnected.connected);
      assert.strictEqual(reconnected.connectedTo, onlineNode.host);
      assert.ok(mockClients.some((client) => client.host === offlineNode.host));
    });
  });

  describe('Ping Tests', () => {
    it('should ping successfully', async () => {
      const isActive = await ElectrumClient.ping();
      assert.ok(isActive);
    });
  });

  describe('Feature Tests', () => {
    it('should retrieve server features', async () => {
      const features = await ElectrumClient.serverFeatures();
      assert.strictEqual(features.server_version, 'fixture-server');
      assert.strictEqual(features.protocol_min, '1.4');
      assert.strictEqual(features.protocol_max, '1.4.3');
    });
  });

  describe('UTXO and History Tests', () => {
    it('should sync UTXOs by address', async () => {
      const utxos = await ElectrumClient.syncUTXOByAddress(addresses, bitcoinJS.networks.testnet);
      assert.deepStrictEqual(utxos[addresses[0]], [
        { txId: mockTxid, vout: 1, value: 12345, height: 100, address: addresses[0] },
      ]);
      assert.deepStrictEqual(utxos[addresses[1]], []);
    });

    it('should sync history by address', async () => {
      const history = await ElectrumClient.syncHistoryByAddress(
        addresses,
        bitcoinJS.networks.testnet
      );
      assert.deepStrictEqual(history.historyByAddress[addresses[0]], [
        { tx_hash: mockTxid, height: 100 },
      ]);
      assert.deepStrictEqual(history.historyByAddress[addresses[1]], []);
      assert.deepStrictEqual(history.txids, [mockTxid]);
      assert.strictEqual(history.txidToAddress[mockTxid], addresses[0]);
    });
  });

  describe('Transaction Tests', () => {
    it('should estimate fee', async () => {
      const fee = await ElectrumClient.estimateFee(1);
      assert.strictEqual(fee, 2);
    });

    it('should fetch transactions by ID', async () => {
      const txids = [mockTxid, '9a15008af30580039bc7a07d36c3544902a2e1618ad31f4dda94fe0044a8dcce'];
      const transactions = await ElectrumClient.getTransactionsById(txids);
      assert.deepStrictEqual(Object.keys(transactions), txids);
      for (const txid of txids) {
        assert.strictEqual(transactions[txid].txid, txid);
        assert.strictEqual(transactions[txid].hex, undefined);
        assert.deepStrictEqual(transactions[txid].vout[0].scriptPubKey.addresses, ['tb1qfixture']);
      }
    });
  });
});
