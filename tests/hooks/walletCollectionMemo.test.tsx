import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { useObject, useQuery } from '@realm/react';
import { useAppSelector } from 'src/store/hooks';
import useWallets from 'src/hooks/useWallets';
import useVault from 'src/hooks/useVault';
import { RealmSchema } from 'src/storage/realm/enum';
import { NetworkType, VaultType, VisibilityType, WalletType } from 'src/services/wallets/enums';

jest.mock('src/store/hooks', () => ({ useAppSelector: jest.fn() }));

const queryMock = useQuery as jest.Mock;
const objectMock = useObject as jest.Mock;
const selectorMock = useAppSelector as jest.Mock;

const makeManaged = (id: string, overrides: Record<string, any> = {}) => {
  const value = {
    id,
    type: WalletType.DEFAULT,
    networkType: NetworkType.MAINNET,
    archived: false,
    presentationData: { name: id, visibility: VisibilityType.DEFAULT },
    specs: { balances: { confirmed: 100, unconfirmed: 0 } },
    ...overrides,
  };
  return { ...value, toJSON: jest.fn(() => ({ ...value })) };
};

describe('wallet and Vault list snapshots', () => {
  let network: NetworkType;
  let wallets: any[];
  let vaults: any[];

  beforeEach(() => {
    network = NetworkType.MAINNET;
    wallets = [];
    vaults = [];
    queryMock.mockImplementation((schema) => (schema === RealmSchema.Wallet ? wallets : vaults));
    objectMock.mockReset();
    selectorMock.mockImplementation((selector) =>
      selector({ settings: { bitcoinNetworkType: network } })
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('wallets convert only selected network objects and refresh on query or network change', () => {
    const main = makeManaged('main');
    const otherNetwork = makeManaged('testnet', { networkType: NetworkType.TESTNET });
    const hidden = makeManaged('hidden', {
      presentationData: { name: 'hidden', visibility: VisibilityType.HIDDEN },
    });
    const legacy = makeManaged('legacy', { type: WalletType.PRE_MIX });
    wallets = [main, otherNetwork, hidden, legacy];
    let seen: any[] = [];
    const Probe = ({ getAll = false, tick = 0 }) => {
      seen = useWallets({ getAll }).wallets;
      return <>{tick}</>;
    };
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Probe />);
    });
    expect(seen.map((wallet) => wallet.id)).toEqual(['main']);
    expect(main.toJSON).toHaveBeenCalledTimes(1);
    expect(otherNetwork.toJSON).not.toHaveBeenCalled();
    expect(hidden.toJSON).not.toHaveBeenCalled();
    act(() => tree.update(<Probe tick={1} />));
    expect(main.toJSON).toHaveBeenCalledTimes(1);

    act(() => tree.update(<Probe getAll tick={2} />));
    expect(seen.map((wallet) => wallet.id)).toEqual(['main', 'hidden']);
    expect(hidden.toJSON).toHaveBeenCalledTimes(1);

    const changed = makeManaged('main', {
      specs: { balances: { confirmed: 250, unconfirmed: 0 } },
    });
    wallets = [changed, otherNetwork, hidden, legacy];
    act(() => tree.update(<Probe getAll tick={3} />));
    expect(seen[0].specs.balances.confirmed).toBe(250);
    expect(changed.toJSON).toHaveBeenCalledTimes(1);

    network = NetworkType.TESTNET;
    act(() => tree.update(<Probe getAll tick={4} />));
    expect(seen.map((wallet) => wallet.id)).toEqual(['testnet']);
    expect(otherNetwork.toJSON).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  test('Vaults preserve archived, hidden and canary selection while avoiding unrelated conversions', () => {
    const active = makeManaged('active');
    const archived = makeManaged('archive', {
      archived: true,
      specs: { balances: { confirmed: 0, unconfirmed: 0 } },
    });
    const hidden = makeManaged('hidden', {
      presentationData: { name: 'hidden', visibility: VisibilityType.HIDDEN },
    });
    const canary = makeManaged('canary', { type: VaultType.CANARY });
    const otherNetwork = makeManaged('testnet', { networkType: NetworkType.TESTNET });
    vaults = [active, archived, hidden, canary, otherNetwork];
    let seen: ReturnType<typeof useVault>;
    const Probe = ({ tick = 0, includeArchived = false, vaultId = '' }) => {
      seen = useVault({ includeArchived, getHiddenWallets: false, vaultId });
      return <>{tick}</>;
    };
    let tree: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Probe />);
    });
    expect(seen.allVaults.map((vault) => vault.id)).toEqual(['active']);
    expect(active.toJSON).toHaveBeenCalledTimes(1);
    expect(archived.toJSON).not.toHaveBeenCalled();
    expect(otherNetwork.toJSON).not.toHaveBeenCalled();
    act(() => tree.update(<Probe tick={1} />));
    expect(active.toJSON).toHaveBeenCalledTimes(1);

    act(() => tree.update(<Probe tick={2} vaultId="canary" />));
    expect(seen.activeVault?.id).toBe('canary');
    expect(canary.toJSON).toHaveBeenCalledTimes(1);
    expect(active.toJSON).toHaveBeenCalledTimes(1);

    act(() => tree.update(<Probe tick={3} includeArchived vaultId="archive" />));
    expect(seen.activeVault?.id).toBe('archive');
    expect(seen.allVaults.map((vault) => vault.id)).toEqual(['active', 'archive']);
    expect((seen.activeVault as any)?.specs.balances.confirmed).toBe(0);
    const updatedArchive = makeManaged('archive', {
      archived: true,
      specs: { balances: { confirmed: 50, unconfirmed: 0 } },
    });
    vaults = [active, updatedArchive, hidden, canary, otherNetwork];
    act(() => tree.update(<Probe tick={4} includeArchived vaultId="archive" />));
    expect((seen.activeVault as any)?.specs.balances.confirmed).toBe(50);
    act(() => tree.unmount());
  });
});
