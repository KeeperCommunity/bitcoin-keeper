import Node from '../../src/services/electrum/node';
import ElectrumClient from '../../src/services/electrum/client';
import dbManager from '../../src/storage/realm/dbManager';
import { NetworkType } from '../../src/services/wallets/enums';
import { commitBackupLocalOperation } from '../../src/services/backup/automatic';

let mockSession = 7;
jest.mock('src/services/electrum/client', () => ({
  __esModule: true, default: { testConnection: jest.fn() },
}));
jest.mock('src/storage/realm/dbManager', () => ({
  __esModule: true, default: {
    getObjectByIndex: jest.fn(() => ({ id: 'fixture-account' })),
    updateObjectById: jest.fn(() => true), createObject: jest.fn(), getCollection: jest.fn(),
  },
}));
jest.mock('src/store/store', () => ({ store: { getState: () => ({
  storage: { appId: 'fixture-account' }, settings: { bitcoinNetworkType: 'TESTNET' },
}) } }));
jest.mock('src/services/backup/transport', () => ({ currentBackupAccountSession: () => mockSession }));
jest.mock('src/services/backup/automatic', () => ({ commitBackupLocalOperation: jest.fn() }));

const ca = '-----BEGIN CERTIFICATE-----\nfixture-public-certificate\n-----END CERTIFICATE-----';
const saved = () => ({
  id: 1001, host: 'node.example', port: '50002', useSSL: true,
  useKeeperNode: false, isConnected: true, networkType: NetworkType.TESTNET, tlsCa: null,
});

describe('explicit TLS trust on an existing custom node', () => {
  let existing: ReturnType<typeof saved>;
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession = 7;
    existing = saved();
    jest.spyOn(Node, 'getAllNodes').mockImplementation(() => [existing]);
    (ElectrumClient.testConnection as jest.Mock).mockResolvedValue({ connected: true });
  });
  afterEach(() => jest.restoreAllMocks());

  it('tests and saves a new CA at the same stable id instead of silently keeping system trust', async () => {
    const candidate = { ...existing, id: null, tlsCa: ca, isConnected: false };
    await expect(Node.save(candidate, [])).resolves.toEqual({ saved: true });
    expect(ElectrumClient.testConnection).toHaveBeenCalledWith(candidate);
    expect(dbManager.updateObjectById).toHaveBeenCalledWith(expect.anything(), '1001', {
      ...existing, tlsCa: ca,
    });
    expect(dbManager.createObject).not.toHaveBeenCalled();
    expect(dbManager.getCollection).not.toHaveBeenCalled();
  });

  it('leaves the previous trust unchanged if candidate certificate verification fails', async () => {
    (ElectrumClient.testConnection as jest.Mock).mockResolvedValue({ connected: false, error: 'TLS certificate validity check failed' });
    await expect(Node.save({ ...existing, id: null, tlsCa: ca }, [])).resolves.toMatchObject({ saved: false });
    expect(dbManager.updateObjectById).not.toHaveBeenCalled();
    expect(existing.tlsCa).toBeNull();
  });

  it('uses the existing guarded local write when an operation is supplied', async () => {
    const operation = { accountSession: 7 } as any;
    const committed = { committed: true };
    (commitBackupLocalOperation as jest.Mock).mockImplementation((_operation, write) => {
      write({ objects: () => ({ filtered: () => [existing] }) });
      return committed;
    });
    await expect(Node.save({ ...existing, id: null, tlsCa: ca }, [], 'fixture-account', operation))
      .resolves.toMatchObject({ saved: true, committedOperation: committed });
    expect(commitBackupLocalOperation).toHaveBeenCalledWith(operation, expect.any(Function));
    expect(existing).toMatchObject({ id: 1001, host: 'node.example', tlsCa: ca });
    expect(dbManager.updateObjectById).not.toHaveBeenCalled();
  });

  it('does not write after the account session changes while the candidate is checked', async () => {
    (ElectrumClient.testConnection as jest.Mock).mockImplementation(async () => {
      mockSession += 1;
      return { connected: true };
    });
    await expect(Node.save({ ...existing, id: null, tlsCa: ca }, [])).resolves.toMatchObject({ saved: false });
    expect(dbManager.updateObjectById).not.toHaveBeenCalled();
    expect(commitBackupLocalOperation).not.toHaveBeenCalled();
  });

  it('keeps duplicate requests for the unchanged transport idempotent', async () => {
    await expect(Node.save({ ...existing, id: null }, [])).resolves.toEqual({ saved: true });
    expect(dbManager.updateObjectById).not.toHaveBeenCalled();
    expect(commitBackupLocalOperation).not.toHaveBeenCalled();
  });

  it('preserves the Keeper-node trust restriction when matching a saved endpoint', async () => {
    existing.useKeeperNode = true;
    await expect(Node.save({ ...existing, id: null, useKeeperNode: false, tlsCa: ca }, []))
      .resolves.toMatchObject({ saved: false });
    expect(dbManager.updateObjectById).not.toHaveBeenCalled();
  });
});
