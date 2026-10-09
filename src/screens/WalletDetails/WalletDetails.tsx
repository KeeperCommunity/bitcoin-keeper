import { Pressable, StyleSheet } from 'react-native';
import { Box, HStack, useColorMode, VStack } from '@gluestack-ui/themed-native-base';
import React, { useContext, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { CommonActions, useNavigation } from '@react-navigation/native';
import AddWalletIcon from 'src/assets/images/addWallet_illustration.svg';
import TickIcon from 'src/assets/images/icon_tick.svg';
import { hp, wp } from 'src/constants/responsive';
import Text from 'src/components/KeeperText';
import { useWalletRefresh } from 'src/hooks/useWalletRefresh';
import { setIntroModal } from 'src/store/reducers/wallets';
import { useAppSelector } from 'src/store/hooks';
import useWallets from 'src/hooks/useWallets';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { AppStackParams } from 'src/navigation/types';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import LearnMoreModal from './components/LearnMoreModal';
import Transactions from './components/Transactions';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import { SentryErrorBoundary } from 'src/services/sentry';
import useWalletAsset from 'src/hooks/useWalletAsset';
import { sendPhaseOneReset } from 'src/store/reducers/send_and_receive';
import WalletDetailHeader from './components/WalletDetailHeader';
import DetailCards from './components/DetailCards';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import { useUTXOSpendability } from 'src/hooks/useUTXOSpendability';

// TODO: add type definitions to all components
function TransactionsAndUTXOs({ transactions, pullRefresh, onRefresh, wallet }) {
  const { walletSyncing } = useAppSelector((state) => state.wallet);
  const syncing = walletSyncing && wallet ? !!walletSyncing[wallet.id] : false;

  return (
    <>
      <ActivityIndicatorView visible={syncing} showLoader />
      <Transactions
        transactions={transactions}
        pullRefresh={pullRefresh}
        currentWallet={wallet}
        onBitcoinRefresh={onRefresh}
      />
    </>
  );
}

type ScreenProps = NativeStackScreenProps<AppStackParams, 'WalletDetails'>;
function WalletDetails({ route }: ScreenProps) {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const { common, wallet: walletTranslations } = translations;
  const {
    autoRefresh = false,
    hardRefresh: autoHardRefresh = false,
    walletId,
    transactionToast = false,
    viewTransaction = null,
  } = route.params || {};
  const [syncingCompleted, setSyncingCompleted] = useState(false);
  const wallet = useWallets({ walletIds: [walletId] })?.wallets[0];

  const { getWalletCardGradient, getWalletTags } = useWalletAsset();
  const { hasDoNotSpendUTXOs } = useUTXOSpendability(wallet ?? null);

  const { walletSyncing } = useAppSelector((state) => state.wallet);
  const syncing = walletSyncing && wallet ? !!walletSyncing[wallet.id] : false;
  const introModal = useAppSelector((state) => state.wallet.introModal) || false;
  const { refreshing: pullRefresh, refresh } = useWalletRefresh();
  const viewAll_color = ThemedColor({ name: 'viewAll_color' });

  useEffect(() => {
    dispatch(sendPhaseOneReset());
  }, []);

  useEffect(() => {
    if (autoRefresh) pullDownRefresh(autoHardRefresh);
  }, [autoRefresh]);

  useEffect(() => {
    if (!syncing && syncingCompleted && transactionToast) {
      showToast(
        walletTranslations.transactionToastMessage,
        <TickIcon />,
        IToastCategory.DEFAULT,
        5000
      );
      navigation.dispatch(CommonActions.setParams({ transactionToast: false }));
    }
  }, [syncingCompleted, transactionToast]);

  useEffect(() => {
    if (!syncing) {
      setSyncingCompleted(true);
    } else {
      setSyncingCompleted(false);
    }
  }, [syncing]);

  useEffect(() => {
    if (viewTransaction) {
      const transaction = wallet?.specs?.transactions.find((tx) => tx.txid === viewTransaction);
      if (transaction) {
        navigation.navigate('TransactionDetails', { transaction, wallet });

        // Remove viewTransaction from route params
        navigation.setParams({ viewTransaction: null });
      }
    }
  }, [viewTransaction, wallet, navigation]);

  const pullDownRefresh = (hardRefresh) => {
    refresh([wallet], { hardRefresh });
  };

  return (
    <Box style={styles.wrapper} backgroundColor={`${colorMode}.primaryBackground`}>
      <WalletDetailHeader
        settingCallBack={() =>
          navigation.dispatch(CommonActions.navigate('WalletSettings', { wallet }))
        }
        backgroundColor={getWalletCardGradient(wallet)}
        title={wallet.presentationData.name}
        tags={getWalletTags(wallet)}
        totalBalance={wallet.specs.balances.confirmed + wallet.specs.balances.unconfirmed}
        description={wallet.presentationData.description}
        wallet={wallet}
      />
      <Box style={styles.detailCardsContainer}>
        <Box style={styles.detailCards}>
          <DetailCards
            disabled={false}
            wallet={wallet}
            hasDoNotSpendUTXOs={hasDoNotSpendUTXOs}
            sendCallback={() =>
              navigation.dispatch(CommonActions.navigate('Send', { sender: wallet }))
            }
            receiveCallback={() =>
              navigation.dispatch(CommonActions.navigate('Receive', { wallet }))
            }
            buyCallback={() =>
              navigation.dispatch(
                CommonActions.navigate({ name: 'BuyBitcoin', params: { wallet } })
              )
            }
          />
        </Box>
      </Box>
      <VStack backgroundColor={`${colorMode}.primaryBackground`} style={styles.walletContainer}>
        {wallet ? (
          <Box
            flex={1}
            style={styles.transactionsContainer}
            backgroundColor={`${colorMode}.primaryBackground`}
          >
            {wallet?.specs?.transactions?.length ? (
              <HStack style={styles.transTitleWrapper}>
                <Text color={`${colorMode}.black`} medium fontSize={wp(14)}>
                  {common.recentTransactions}
                </Text>
                <Pressable
                  style={styles.viewAllBtn}
                  onPress={() =>
                    navigation.dispatch(
                      CommonActions.navigate({ name: 'TransactionHistory', params: { wallet } })
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
              transactions={wallet?.specs?.transactions}
              pullRefresh={pullRefresh}
              wallet={wallet}
              onRefresh={() => pullDownRefresh(true)}
            />
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
      <LearnMoreModal introModal={introModal} setIntroModal={setIntroModal} />
    </Box>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  topContainer: {
    paddingHorizontal: 18,
  },
  walletContainer: {
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
    paddingTop: hp(10),
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
  detailCardsContainer: {
    position: 'relative',
    zIndex: 1000,
    elevation: 20,
    overflow: 'visible',
    height: hp(120),
    marginTop: -hp(50),
  },
  detailCards: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    elevation: 20,
  },
});
export default SentryErrorBoundary(WalletDetails);
