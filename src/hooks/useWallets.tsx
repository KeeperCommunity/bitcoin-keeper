import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { RealmSchema } from 'src/storage/realm/enum';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { VisibilityType, WalletType } from 'src/services/wallets/enums';
import { useObject, useQuery } from '@realm/react';
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
  walletIds = walletIds?.filter((item) => !!item);
  const hasWalletIds = !!walletIds?.length;

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

  if (getAll) {
    return { wallets: listedWallets };
  }

  if (hasWalletIds) {
    const extractedWallets = [];
    for (let index = 0; index < walletIds.length; index += 1) {
      const id = walletIds[index];
      const wallet: Wallet = useObject(RealmSchema.Wallet, id);
      if (wallet) extractedWallets.push(wallet);
    }
    return { wallets: filterByNetwork(extractedWallets, bitcoinNetworkType) };
  }

  return { wallets: listedWallets };
};

export default useWallets;
