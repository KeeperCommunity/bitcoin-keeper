import * as bitcoinJS from 'bitcoinjs-lib';
import ElectrumClient, {
  ELECTRUM_CONNECTION_CHANGED_ERR,
} from '../../src/services/electrum/client';
import {
  predefinedMainnetNodes,
  predefinedTestnetNodes,
} from '../../src/services/electrum/predefinedNodes';
import { NetworkType } from '../../src/services/wallets/enums';
import dbManager from '../../src/storage/realm/dbManager';
import { RealmSchema } from '../../src/storage/realm/enum';
import { store } from '../../src/store/store';

const mockClients: any[] = [];
const mockInitReplies: Array<() => Promise<any>> = [];
let mockRealmAppId = 'account-a';
const mockState = {
  storage: { appId: 'account-a' },
  settings: {
    bitcoinNetworkType: NetworkType.TESTNET,
    bitcoinNetwork: bitcoinJS.networks.testnet,
  },
};

jest.mock('electrum-client', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => {
    const client = {
      initElectrum: jest.fn(
        () => mockInitReplies.shift()?.() || Promise.resolve(['server', '1.4'])
      ),
      close: jest.fn(),
      onError: null,
      blockchainScripthash_listunspentBatch: jest.fn(),
      blockchainScripthash_getHistoryBatch: jest.fn(),
      blockchainTransaction_getBatch: jest.fn(),
    };
    mockClients.push(client);
    return client;
  }),
}));
jest.mock('src/store/store', () => ({
  store: { getState: jest.fn(() => mockState), dispatch: jest.fn() },
}));
jest.mock('src/storage/realm/dbManager', () => ({
  __esModule: true,
  default: {
    getObjectByIndex: jest.fn(() => ({ id: mockRealmAppId })),
    updateObjectById: jest.fn(() => true),
  },
}));
jest.mock('src/services/rest/RestClient', () => ({
  __esModule: true,
  default: { getTorStatus: jest.fn() },
  TorStatus: { CONNECTED: 'connected' },
}));
jest.mock('src/services/electrum/torrific', () => ({ __esModule: true, default: {} }));

const deferred = () => {
  let resolve: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const testnetNode = () => ({ ...predefinedTestnetNodes[0], isConnected: false });
const mainnetNode = () => ({ ...predefinedMainnetNodes[0], isConnected: false });

describe('Electrum connection generation', () => {
  beforeEach(() => {
    mockRealmAppId = 'account-a';
    mockState.storage.appId = 'account-a';
    mockState.settings.bitcoinNetworkType = NetworkType.TESTNET;
    mockState.settings.bitcoinNetwork = bitcoinJS.networks.testnet;
    mockClients.length = 0;
    mockInitReplies.length = 0;
    jest.clearAllMocks();
  });

  afterEach(() => jest.useRealTimers());

  it('ignores a late handshake and error callback from a replaced account connection', async () => {
    const firstHandshake = deferred();
    mockInitReplies.push(
      () => firstHandshake.promise,
      () => Promise.resolve(['server', '1.4'])
    );
    ElectrumClient.setActivePeer([testnetNode()], testnetNode());
    const firstConnect = ElectrumClient.connect();
    const firstClient = mockClients[0];

    mockState.storage.appId = 'account-b';
    mockRealmAppId = 'account-b';
    ElectrumClient.setActivePeer([testnetNode()], testnetNode());
    const currentResult = await ElectrumClient.connect();
    const currentGeneration = ElectrumClient.getConnectionGeneration();

    firstHandshake.resolve(['server', '1.4']);
    await expect(firstConnect).resolves.toMatchObject({
      connected: false,
      error: ELECTRUM_CONNECTION_CHANGED_ERR,
    });
    firstClient.onError(new Error('old socket closed'));

    expect(currentResult.connected).toBe(true);
    expect(ElectrumClient.getConnectionGeneration()).toBe(currentGeneration);
    expect(mockClients).toHaveLength(2);
    expect(store.dispatch as jest.Mock).not.toHaveBeenCalled();
  });

  it('stops remaining UTXO batches if the selected network changes mid-request', async () => {
    const selected = testnetNode();
    ElectrumClient.setActivePeer([selected], selected);
    await ElectrumClient.connect();
    const pendingBatch = deferred();
    mockClients[0].blockchainScripthash_listunspentBatch.mockReturnValue(pendingBatch.promise);
    const address = 'tb1qd2u9tvuqzadgeh02vppd33e7u2fatuwrw7h4q5';
    const pendingSync = ElectrumClient.syncUTXOByAddress(
      [address, address],
      bitcoinJS.networks.testnet,
      1
    );

    mockState.settings.bitcoinNetworkType = NetworkType.MAINNET;
    mockState.settings.bitcoinNetwork = bitcoinJS.networks.bitcoin;
    const next = mainnetNode();
    ElectrumClient.setActivePeer([next], next);
    pendingBatch.resolve([]);

    await expect(pendingSync).rejects.toThrow(ELECTRUM_CONNECTION_CHANGED_ERR);
    expect(mockClients[0].blockchainScripthash_listunspentBatch).toHaveBeenCalledTimes(1);
  });

  it('rejects a Bitcoin network that differs from the active peer before sending', async () => {
    const selected = testnetNode();
    ElectrumClient.setActivePeer([selected], selected);
    await ElectrumClient.connect();

    await expect(
      ElectrumClient.syncUTXOByAddress(['unused'], bitcoinJS.networks.bitcoin)
    ).rejects.toThrow(ELECTRUM_CONNECTION_CHANGED_ERR);
    expect(mockClients[0].blockchainScripthash_listunspentBatch).not.toHaveBeenCalled();
  });

  it('does not fetch another transaction chunk through a replaced connection', async () => {
    const selected = testnetNode();
    ElectrumClient.setActivePeer([selected], selected);
    await ElectrumClient.connect();
    const pendingBatch = deferred();
    mockClients[0].blockchainTransaction_getBatch.mockReturnValue(pendingBatch.promise);
    const pendingFetch = ElectrumClient.getTransactionsById(['first', 'second'], true, 1);

    mockState.storage.appId = 'account-b';
    mockRealmAppId = 'account-b';
    ElectrumClient.setActivePeer([testnetNode()], testnetNode());
    pendingBatch.resolve([]);

    await expect(pendingFetch).rejects.toThrow(ELECTRUM_CONNECTION_CHANGED_ERR);
    expect(mockClients[0].blockchainTransaction_getBatch).toHaveBeenCalledTimes(1);
  });

  it('persists live public rotation and publishes the active server', async () => {
    jest.useFakeTimers();
    const first = testnetNode();
    const fallback = { ...predefinedTestnetNodes[1], isConnected: false };
    mockInitReplies.push(
      () => Promise.resolve(['server', '1.4']),
      () => Promise.reject(new Error('first server unavailable')),
      () => Promise.resolve(['server', '1.4'])
    );
    ElectrumClient.setActivePeer([first, fallback], first);
    await ElectrumClient.connect();

    const reconnect = mockClients[0].onError(new Error('socket closed'));
    await jest.advanceTimersByTimeAsync(500);
    await reconnect;

    expect(ElectrumClient.getActivePeer()?.id).toBe(fallback.id);
    expect(dbManager.updateObjectById).toHaveBeenCalledWith(
      RealmSchema.NodeConnect,
      first.id.toString(),
      { isConnected: false }
    );
    expect(dbManager.updateObjectById).toHaveBeenCalledWith(
      RealmSchema.NodeConnect,
      fallback.id.toString(),
      { isConnected: true }
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { successful: true, connectedTo: fallback.host },
      })
    );
  });

  it('stops reconnect when Realm switches accounts before Redux catches up', async () => {
    jest.useFakeTimers();
    const selected = testnetNode();
    ElectrumClient.setActivePeer([selected], selected);
    await ElectrumClient.connect();
    const generation = ElectrumClient.getConnectionGeneration();
    const reconnect = mockClients[0].onError(new Error('socket closed'));

    mockRealmAppId = 'account-b';
    expect(() => ElectrumClient.assertConnectionGeneration(generation)).toThrow(
      ELECTRUM_CONNECTION_CHANGED_ERR
    );
    await jest.advanceTimersByTimeAsync(500);
    await expect(reconnect).resolves.toMatchObject({
      connected: false,
      error: ELECTRUM_CONNECTION_CHANGED_ERR,
    });

    expect(mockClients).toHaveLength(1);
    expect(dbManager.updateObjectById).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});
