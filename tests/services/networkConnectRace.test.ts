import { runSaga } from 'redux-saga';
import ElectrumClient from '../../src/services/electrum/client';
import { predefinedTestnetNodes } from '../../src/services/electrum/predefinedNodes';
import { NetworkType } from '../../src/services/wallets/enums';
import dbManager from '../../src/storage/realm/dbManager';
import { RealmSchema } from '../../src/storage/realm/enum';
import { connectToNodeWorker } from '../../src/store/sagas/network';

let mockGeneration = 0;
let mockRealmAppId = 'account-a';
const mockNodes = predefinedTestnetNodes;
const mockState = {
  settings: { bitcoinNetworkType: NetworkType.TESTNET },
  storage: { appId: 'account-a' },
  network: {
    initialNodesSaved: true,
    testnetFallbackNodeAddedByAppId: { 'account-a': true },
  },
};

jest.mock('src/store/store', () => ({ store: { getState: jest.fn(() => mockState) } }));
jest.mock('src/storage/realm/dbManager', () => ({
  __esModule: true,
  default: {
    getObjectByIndex: jest.fn(() => ({ id: mockRealmAppId })),
    getCollection: jest.fn(() => mockNodes),
    createObject: jest.fn(() => true),
    updateObjectById: jest.fn(() => true),
  },
}));
jest.mock('src/services/electrum/client', () => ({
  __esModule: true,
  default: {
    setActivePeer: jest.fn(() => {
      mockGeneration += 1;
    }),
    connect: jest.fn(),
    getConnectionGeneration: jest.fn(() => mockGeneration),
    getActivePeer: jest.fn(() => mockNodes[0]),
  },
}));
jest.mock('src/services/sentry', () => ({ captureError: jest.fn() }));

const deferred = () => {
  let resolve: (value: any) => void;
  const promise = new Promise<any>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('overlapping Electrum connection workers', () => {
  beforeEach(() => {
    mockGeneration = 0;
    mockRealmAppId = 'account-a';
    mockState.storage.appId = 'account-a';
    jest.clearAllMocks();
    (ElectrumClient.connect as jest.Mock).mockReset();
    (dbManager.getCollection as jest.Mock).mockReturnValue(mockNodes);
  });

  it('does not publish a late result from the older worker', async () => {
    const first = deferred();
    const second = deferred();
    (ElectrumClient.connect as jest.Mock)
      .mockImplementationOnce(() => {
        mockGeneration += 1;
        return first.promise;
      })
      .mockImplementationOnce(() => {
        mockGeneration += 1;
        return second.promise;
      });
    const actions: any[] = [];
    const environment = {
      dispatch: (action) => actions.push(action),
      getState: () => mockState,
    };

    const firstTask = runSaga(environment, connectToNodeWorker);
    const secondTask = runSaga(environment, connectToNodeWorker);
    expect(ElectrumClient.connect).toHaveBeenCalledTimes(2);

    second.resolve({ connected: true, connectedTo: 'winner', generation: mockGeneration });
    await secondTask.toPromise();
    first.resolve({ connected: false, error: 'old failure', generation: mockGeneration - 2 });
    await firstTask.toPromise();

    const connectionResults = actions.filter(
      (action) => action.type === 'login/electrumClientConnectionExecuted'
    );
    expect(connectionResults).toEqual([
      expect.objectContaining({ payload: { successful: true, connectedTo: 'winner' } }),
    ]);
    expect(dbManager.getCollection).toHaveBeenCalled();
  });

  it('adds the Testnet fallback for a second account despite the first account marker', async () => {
    mockState.storage.appId = 'account-b';
    mockRealmAppId = 'account-b';
    (dbManager.getCollection as jest.Mock).mockReturnValue([mockNodes[0]]);
    (ElectrumClient.connect as jest.Mock).mockImplementation(() => {
      mockGeneration += 1;
      return Promise.resolve({
        connected: true,
        connectedTo: mockNodes[0].host,
        generation: mockGeneration,
      });
    });
    const actions: any[] = [];

    await runSaga(
      { dispatch: (action) => actions.push(action), getState: () => mockState },
      connectToNodeWorker
    ).toPromise();

    expect(dbManager.createObject).toHaveBeenCalledWith(RealmSchema.NodeConnect, mockNodes[1]);
    expect(actions).toContainEqual(
      expect.objectContaining({
        type: 'network/setTestnetFallbackNodeAdded',
        payload: 'account-b',
      })
    );
  });

  it('does not write node flags into the newly opened Realm while Redux still names the old app', async () => {
    const pendingConnection = deferred();
    (ElectrumClient.connect as jest.Mock).mockImplementation(() => {
      mockGeneration += 1;
      return pendingConnection.promise;
    });
    (ElectrumClient.getActivePeer as jest.Mock).mockReturnValue(mockNodes[1]);
    const actions: any[] = [];
    const task = runSaga(
      { dispatch: (action) => actions.push(action), getState: () => mockState },
      connectToNodeWorker
    );
    expect(ElectrumClient.connect).toHaveBeenCalledTimes(1);

    mockRealmAppId = 'account-b';
    pendingConnection.resolve({
      connected: true,
      connectedTo: mockNodes[1].host,
      generation: mockGeneration,
    });
    await task.toPromise();

    expect(mockState.storage.appId).toBe('account-a');
    expect(dbManager.updateObjectById).not.toHaveBeenCalled();
    expect(
      actions.filter((action) => action.type === 'login/electrumClientConnectionExecuted')
    ).toEqual([]);
  });
});
