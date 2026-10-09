// Archived vaults remain in the local Realm even when they have no balance.
// Keep them in the automatic sync set so a later deposit is discovered.
export const selectWalletsForSync = (
  wallets,
  vaults,
  networkType,
  { syncAll = false, archivedOnly = false } = {}
) => {
  const onNetwork = (wallet) => wallet.networkType === networkType;
  const archived = vaults.filter((vault) => vault.archived && onNetwork(vault));
  const active = archivedOnly
    ? []
    : [...wallets, ...vaults.filter((vault) => !vault.archived)].filter(
        (wallet) =>
          onNetwork(wallet) && (syncAll || wallet.presentationData.visibility === 'DEFAULT')
      );

  return { active, archived };
};
