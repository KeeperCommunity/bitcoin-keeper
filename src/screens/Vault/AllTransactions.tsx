import { FlatList, RefreshControl } from 'react-native';
import React from 'react';
import { useColorMode } from '@gluestack-ui/themed-native-base';
import { useQuery } from '@realm/react';

import { RealmSchema } from 'src/storage/realm/enum';
import TransactionElement from 'src/components/TransactionElement';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { useWalletRefresh } from 'src/hooks/useWalletRefresh';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import useVault from 'src/hooks/useVault';
import { EntityKind } from 'src/services/wallets/enums';
import { Transaction } from 'src/services/wallets/interfaces';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';

function AllTransactions({ route }) {
  const { colorMode } = useColorMode();
  const { title, entityKind, subtitle, vaultId = '' } = route?.params;
  const { activeVault: vault } = useVault({ vaultId });

  const wallet: Wallet = useQuery(RealmSchema.Wallet)
    .map(getJSONFromRealmObject)
    .filter((wallet) => !wallet.archived)[0];

  const { refreshing: pullRefresh, refresh } = useWalletRefresh();

  const vaultTrans: Transaction[] = vault?.specs?.transactions || [];
  const walletTrans: Transaction[] = wallet?.specs.transactions || [];
  const currentWallet = entityKind === EntityKind.WALLET ? wallet : vault;
  const renderTransactionElement = ({ item }) => (
    <TransactionElement transaction={item} wallet={currentWallet} />
  );

  const pullDownRefresh = () => {
    refresh([currentWallet], { hardRefresh: true });
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={title} subTitle={subtitle} />
      <FlatList
        data={entityKind === EntityKind.WALLET ? walletTrans : vaultTrans}
        refreshControl={<RefreshControl onRefresh={pullDownRefresh} refreshing={pullRefresh} />}
        renderItem={renderTransactionElement}
        keyExtractor={(item: Transaction) => item.txid}
        showsVerticalScrollIndicator={false}
      />
    </ScreenWrapper>
  );
}

export default AllTransactions;
