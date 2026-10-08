import { CommonActions, useNavigation } from '@react-navigation/native';
import { Box, HStack, useColorMode, VStack } from '@gluestack-ui/themed-native-base';
import React, { useContext, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import useWalletAsset from 'src/hooks/useWalletAsset';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import AddWalletIcon from 'src/assets/images/addWallet_illustration.svg';
import Transactions from '../WalletDetails/components/Transactions';
import { useUSDTWallets } from 'src/hooks/useUSDTWallets';
import { getAvailableBalanceUSDTWallet } from 'src/services/wallets/factories/USDTWalletFactory';
import WalletDetailHeader from '../WalletDetails/components/WalletDetailHeader';
import DetailCards from '../WalletDetails/components/DetailCards';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';

function TransactionsAndUTXOs({ transactions, setPullRefresh, pullRefresh, wallet }) {
  const [initialLoading, setInitialLoading] = useState(false);

  return (
    <>
      <ActivityIndicatorView visible={initialLoading} showLoader />
      <Transactions
        transactions={transactions}
        setPullRefresh={setPullRefresh}
        pullRefresh={pullRefresh}
        currentWallet={wallet}
        setInitialLoading={setInitialLoading}
      />
    </>
  );
}

const UsdtDetails = ({ route }) => {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { translations } = useContext(LocalizationContext);
  const { common, usdtWalletText } = translations;
  const { getWalletCardGradient, getWalletTags } = useWalletAsset();
  const [pullRefresh, setPullRefresh] = useState(false);
  const { usdtWalletId } = route.params || {};
  const { getWalletById } = useUSDTWallets();
  const usdtWallet = getWalletById(usdtWalletId);
  const viewAll_color = ThemedColor({ name: 'viewAll_color' });

  return (
    <Box style={styles.wrapper}>
      <WalletDetailHeader
        settingCallBack={() =>
          navigation.dispatch(CommonActions.navigate('usdtsetting', { usdtWallet }))
        }
        backgroundColor={getWalletCardGradient(usdtWallet)}
        title={usdtWallet.presentationData.name}
        tags={getWalletTags(usdtWallet)}
        totalBalance={getAvailableBalanceUSDTWallet(usdtWallet)}
        description={usdtWallet.presentationData.description}
        wallet={usdtWallet}
      />
      <Box style={styles.detailCardsContainer}>
        <Box style={styles.detailCards}>
          <DetailCards
            sendCallback={() =>
              navigation.dispatch(CommonActions.navigate('sendUsdt', { usdtWallet }))
            }
            receiveCallback={() =>
              navigation.dispatch(CommonActions.navigate('usdtReceive', { usdtWallet }))
            }
            wallet={usdtWallet}
          />
        </Box>
      </Box>
      <Box
        style={styles.pausedNotice}
        backgroundColor={`${colorMode}.thirdBackground`}
        borderColor={`${colorMode}.separator`}
      >
        <Text medium color={`${colorMode}.primaryText`} style={styles.pausedTitle}>
          {usdtWalletText.pausedTitle}
        </Text>
        <Text color={`${colorMode}.primaryText`} style={styles.pausedBody}>
          {usdtWalletText.pausedBody}
        </Text>
      </Box>
      <VStack backgroundColor={`${colorMode}.primaryBackground`} style={styles.walletContainer}>
        {usdtWallet ? (
          <Box
            flex={1}
            style={styles.transactionsContainer}
            backgroundColor={`${colorMode}.thirdBackground`}
          >
            {usdtWallet?.specs?.transactions?.length ? (
              <HStack style={styles.transTitleWrapper}>
                <Text color={`${colorMode}.black`} medium fontSize={wp(14)}>
                  {common.recentTransactions}
                </Text>
                <Pressable
                  style={styles.viewAllBtn}
                  onPress={() =>
                    navigation.dispatch(
                      CommonActions.navigate({
                        name: 'usdtTransactionHistory',
                        params: { wallet: usdtWallet, transactions: usdtWallet.specs.transactions },
                      })
                    )
                  }
                >
                  <Text color={viewAll_color} medium fontSize={wp(14)}>
                    {common.viewAll}
                  </Text>
                </Pressable>
              </HStack>
            ) : null}
            <TransactionsAndUTXOs
              transactions={usdtWallet.specs.transactions}
              setPullRefresh={setPullRefresh}
              pullRefresh={pullRefresh}
              wallet={usdtWallet}
            />
            <Box style={styles.footerContainer}></Box>
          </Box>
        ) : (
          <Box
            style={styles.addNewWalletContainer}
            borderColor={`${colorMode}.separator`}
            borderTopWidth={1}
          >
            <AddWalletIcon />
            <Text
              color={`${colorMode}.primaryText`}
              numberOfLines={2}
              style={styles.addNewWalletText}
            >
              {common.addNewWalletOrImport}
            </Text>
          </Box>
        )}
      </VStack>
    </Box>
  );
};

export default UsdtDetails;

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  topContainer: {
    paddingHorizontal: 18,
  },
  walletContainer: {
    paddingTop: hp(8),
    paddingBottom: 20,
    flex: 1,
    justifyContent: 'space-between',
  },
  addNewWalletText: {
    fontSize: 12,
    letterSpacing: 0.6,
    marginVertical: 5,
    marginHorizontal: 16,
    opacity: 0.85,
  },
  addNewWalletContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    flex: 1,
  },
  transactionsContainer: {
    paddingHorizontal: wp(22),
    marginTop: hp(5),
    paddingTop: hp(24),
    borderBottomWidth: 0,
  },
  transTitleWrapper: {
    paddingTop: 5,
    marginLeft: wp(2),
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    paddingLeft: 10,
  },
  viewAllBtn: {
    width: wp(80),
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCard: {
    marginTop: 20,
    marginBottom: -50,
    zIndex: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingBtn: {
    paddingHorizontal: 8,
    paddingVertical: 16,
  },
  card: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: hp(20),
  },
  pausedNotice: {
    marginHorizontal: wp(22),
    marginTop: hp(65),
    paddingHorizontal: wp(16),
    paddingVertical: hp(12),
    borderWidth: 1,
    borderRadius: 10,
  },
  pausedTitle: {
    fontSize: wp(14),
  },
  pausedBody: {
    fontSize: wp(12),
    marginTop: hp(6),
  },
  detailCardsContainer: {
    zIndex: 1000,
  },
  detailCards: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    bottom: 0,
    transform: [{ translateY: hp(50) }],
  },
});
