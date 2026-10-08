import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { RealmSchema } from 'src/storage/realm/enum';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { VisibilityType, WalletType } from 'src/services/wallets/enums';
import { useQuery } from '@realm/react';
import { useAppSelector } from 'src/store/hooks';
import { useMemo } from 'react';

type useWalletsInterface = ({ getAll, walletIds }?: { getAll?: boolean; walletIds?: string[] }) => {
  wallets: Wallet[];
};

const filterByNetwork = (wallets: Wallet[], bitcoinNetworkType?: string): Wallet[] =>
  bitcoinNetworkType
    ? (wallets
        .filter((wallet) => wallet.networkType === bitcoinNetworkType)
        .map(getJSONFromRealmObject) as unknown as Wallet[])
    : wallets;

const useWallets: useWalletsInterface = ({ walletIds = [], getAll = false } = {}) => {
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const realmWallets = useQuery(RealmSchema.Wallet) as unknown as Wallet[];
  const validWalletIds = walletIds?.filter((item) => !!item) || [];
  const walletIdsKey = JSON.stringify(validWalletIds);
  const hasWalletIds = validWalletIds.length > 0;

  // useQuery changes its collection reference when Realm reports an insert,
  // deletion, or modification. Other screen renders can reuse this snapshot.
  const listedWallets = useMemo(() => {
    if (hasWalletIds && !getAll) return [];
    const regularWallets = realmWallets.filter(
      (wallet) => wallet.type === WalletType.DEFAULT || wallet.type === WalletType.IMPORTED
    );
    const visibleWallets = getAll
      ? regularWallets
      : regularWallets.filter(
          (wallet) => wallet.presentationData.visibility == VisibilityType.DEFAULT
        );
    return filterByNetwork(visibleWallets, bitcoinNetworkType);
  }, [realmWallets, bitcoinNetworkType, getAll, hasWalletIds]);

  // Resolve IDs from the same reactive query. Calling useObject in a loop
  // changes the number of hooks when a route gains or loses an ID.
  const selectedWallets = useMemo(() => {
    if (getAll || !hasWalletIds) return [];
    const ids = JSON.parse(walletIdsKey) as string[];
    const matched = ids
      .map((id) => realmWallets.find((wallet) => wallet.id === id))
      .filter((wallet): wallet is Wallet => !!wallet);
    return filterByNetwork(matched, bitcoinNetworkType);
  }, [realmWallets, bitcoinNetworkType, getAll, hasWalletIds, walletIdsKey]);

  if (getAll) {
    return { wallets: listedWallets };
  }

  if (hasWalletIds) {
    return { wallets: selectedWallets };
  }

  return { wallets: listedWallets };
};

export default useWallets;
