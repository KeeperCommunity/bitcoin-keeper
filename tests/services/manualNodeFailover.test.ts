import Node from '../../src/services/electrum/node';
import ElectrumClient from '../../src/services/electrum/client';
import dbManager from '../../src/storage/realm/dbManager';
import { store } from '../../src/store/store';
import {
  predefinedMainnetNodes,
  predefinedTestnetNodes,
} from '../../src/services/electrum/predefinedNodes';

jest.mock('src/services/electrum/client', () => ({
  __esModule: true,
  default: {
    setActivePeer: jest.fn(),
    connect: jest.fn(),
    setFailoverPeers: jest.fn(),
  },
}));
jest.mock('src/storage/realm/dbManager', () => ({
  __esModule: true,
  default: { getObjectByIndex: jest.fn() },
}));
jest.mock('src/store/store', () => ({ store: { getState: jest.fn() } }));

describe('manual Electrum selection', () => {
  let activeAppId: string;

  beforeEach(() => {
    activeAppId = 'A';
    (store.getState as jest.Mock).mockImplementation(() => ({ storage: { appId: activeAppId } }));
    (dbManager.getObjectByIndex as jest.Mock).mockImplementation(() => ({ id: activeAppId }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('connects the tapped node first, then equips only same-network saved peers', async () => {
    const selected = predefinedTestnetNodes[0];
    const saved = [...predefinedTestnetNodes, predefinedMainnetNodes[0]];
    jest.spyOn(Node, 'getAllNodes').mockReturnValue(saved);
    (ElectrumClient.connect as jest.Mock).mockResolvedValue({
      connected: true,
      connectedTo: selected.host,
      generation: 2,
    });

    await Node.connectToSelectedNode(selected);

    expect(ElectrumClient.setActivePeer).toHaveBeenCalledWith([], selected);
    expect(ElectrumClient.setFailoverPeers).toHaveBeenCalledWith(predefinedTestnetNodes, 2);
  });

  it('does not equip fallback peers when the tapped node never connects', async () => {
    (ElectrumClient.connect as jest.Mock).mockResolvedValue({
      connected: false,
      error: 'unreachable',
    });

    await Node.connectToSelectedNode(predefinedTestnetNodes[0]);

    expect(ElectrumClient.setFailoverPeers).not.toHaveBeenCalled();
  });

  it('does not read another account’s nodes or equip peers after an account switch', async () => {
    const selected = predefinedTestnetNodes[0];
    let finishConnection: (result: object) => void;
    const connection = new Promise((resolve) => {
      finishConnection = resolve;
    });
    (ElectrumClient.connect as jest.Mock).mockReturnValue(connection);
    const getAllNodes = jest.spyOn(Node, 'getAllNodes');

    const result = Node.connectToSelectedNode(selected);
    expect(ElectrumClient.setActivePeer).toHaveBeenCalledWith([], selected);

    activeAppId = 'B';
    finishConnection({ connected: true, connectedTo: selected.host, generation: 2 });

    await expect(result).resolves.toEqual({
      connected: false,
      connectedTo: undefined,
      error: 'Account changed',
    });
    expect(getAllNodes).not.toHaveBeenCalled();
    expect(ElectrumClient.setFailoverPeers).not.toHaveBeenCalled();
  });
});
