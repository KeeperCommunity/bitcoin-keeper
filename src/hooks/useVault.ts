import { RealmSchema } from 'src/storage/realm/enum';
import { Vault } from 'src/services/wallets/interfaces/vault';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { useQuery } from '@realm/react';
import { VaultType, VisibilityType } from 'src/services/wallets/enums';
import { useAppSelector } from 'src/store/hooks';
import { useMemo } from 'react';

type Params =
  | {
      vaultId: string;
      includeArchived?: boolean;
      getFirst?: boolean;
      getHiddenWallets?: boolean;
    }
  | {
      vaultId?: string;
      includeArchived?: boolean;
      getFirst?: boolean;
      getHiddenWallets?: boolean;
    };

const useVault = ({
  vaultId = '',
  includeArchived = true,
  getFirst = false,
  getHiddenWallets = true,
}: Params) => {
  const realmVaults = useQuery(RealmSchema.Vault) as unknown as Vault[];
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  // Select before converting: toJSON traverses address, UTXO and history data.
  // The useQuery reference changes on Realm writes, but stays stable across
  // unrelated renders of the same screen.
  const allVaultsIncludingCanary: Vault[] = useMemo(
    () =>
      realmVaults
        .filter(
          (vault) =>
            (includeArchived || !vault.archived) && vault.networkType === bitcoinNetworkType
        )
        .map(getJSONFromRealmObject) as unknown as Vault[],
    [realmVaults, includeArchived, bitcoinNetworkType]
  );
  //Filtering Canary Vaults from at all UI level where Vaults are consumed
  const allVaults = useMemo(
    () => allVaultsIncludingCanary.filter((vault) => vault.type !== VaultType.CANARY),
    [allVaultsIncludingCanary]
  );
  const allNonHiddenNonArchivedVaults = useMemo(
    () => allVaults.filter((vault) => vault.presentationData.visibility === VisibilityType.DEFAULT),
    [allVaults]
  );
  if (!vaultId) {
    if (getHiddenWallets) {
      return { allVaults, activeVault: getFirst ? allVaults[0] : null };
    } else {
      return {
        allVaults: allNonHiddenNonArchivedVaults,
        activeVault: getFirst ? allVaults[0] : null,
      };
    }
  }

  const activeVault: Vault = vaultId
    ? allVaultsIncludingCanary.filter((v) => v.id === vaultId)[0]
    : allVaultsIncludingCanary.filter((v) => !v.archived)[0];

  if (!getHiddenWallets) {
    return { activeVault, allVaults: allNonHiddenNonArchivedVaults };
  } else {
    return { activeVault, allVaults };
  }
};

export default useVault;
