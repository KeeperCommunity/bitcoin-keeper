import { Box, StatusBar, useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useContext } from 'react';
import { SectionList, StyleSheet } from 'react-native';
import EmptyStateView from 'src/components/EmptyView/EmptyStateView';
import TransactionElement from 'src/components/TransactionElement';
import Text from 'src/components/KeeperText';
import WalletHeader from 'src/components/WalletHeader';
import { hp, wp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import NoTransactionIcon from 'src/assets/images/noTransaction.svg';
import { USDTTransaction } from 'src/services/wallets/operations/dollars/USDT';
import { partitionUSDTWalletHistory } from 'src/services/wallets/factories/USDTWalletFactory';
import { CommonActions, useNavigation } from '@react-navigation/native';

const UsdtTransactionHistory = ({ route }) => {
  const { colorMode } = useColorMode();
  const { wallet, transactions } = route.params;
  const { translations } = useContext(LocalizationContext);
  const { common, usdtWalletText } = translations;
  const navigation = useNavigation();
  const { onChainTransactions, earlierRequests } = partitionUSDTWalletHistory(transactions);
  const sections = [
    { title: '', data: onChainTransactions },
    { title: usdtWalletText.legacyRequestTitle, data: earlierRequests },
  ].filter((section) => section.data.length > 0);

  const renderTransactionElement = ({ item }) => (
    <TransactionElement
      transaction={item}
      wallet={wallet}
      isCached={item?.isCached}
      onPress={() => {
        navigation.dispatch(
          CommonActions.navigate('usdtTransactionDetail', {
            transaction: item,
            wallet,
          })
        );
      }}
    />
  );
  return (
    <Box safeAreaTop backgroundColor={`${colorMode}.primaryBackground`} style={styles.wrapper}>
      <StatusBar
        barStyle={colorMode === 'light' ? 'dark-content' : 'light-content'}
        backgroundColor="transparent"
      />
      <Box style={styles.topSection}>
        <WalletHeader title={usdtWalletText.usdtTransactionHistory} />
      </Box>
      <Box style={styles.bottomSection} backgroundColor={`${colorMode}.boxSecondaryBackground`}>
        <Box style={styles.transactionList}>
          <SectionList
            testID="view_TransactionList"
            sections={sections}
            renderSectionHeader={({ section }) =>
              section.title ? (
                <Text medium color={`${colorMode}.primaryText`} style={styles.sectionTitle}>
                  {section.title}
                </Text>
              ) : null
            }
            renderItem={renderTransactionElement}
            keyExtractor={(item: USDTTransaction) => item.txId || item.traceId}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.contentContainerStyle}
            ListEmptyComponent={
              <EmptyStateView IllustartionImage={NoTransactionIcon} title={common.noTransYet} />
            }
          />
        </Box>
      </Box>
    </Box>
  );
};

export default UsdtTransactionHistory;

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  topSection: {
    paddingTop: hp(20),
    paddingHorizontal: wp(20),
    paddingBottom: hp(30),
  },
  bottomSection: {
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    flex: 1,
  },
  transactionList: {
    paddingLeft: wp(22),
    paddingRight: wp(26),
  },
  contentContainerStyle: {
    paddingBottom: hp(100),
  },
  sectionTitle: {
    paddingTop: hp(18),
    paddingBottom: hp(8),
  },
});
