import Text from 'src/components/KeeperText';
import { Box, HStack, VStack, View, useColorMode } from 'native-base';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import CoinIcon from 'src/assets/images/coins.svg';
import SignerIcon from 'src/assets/images/keys-icon.svg';
import KeeperModal from 'src/components/KeeperModal';
import TransactionElement from 'src/components/TransactionElement';
import { MiniscriptTypes, VaultType } from 'src/services/wallets/enums';
import { refreshWallets } from 'src/store/sagaActions/wallets';
import { setIntroModal } from 'src/store/reducers/vaults';
import { useAppSelector } from 'src/store/hooks';
import { useDispatch } from 'react-redux';
import EmptyStateView from 'src/components/EmptyView/EmptyStateView';
import useVault from 'src/hooks/useVault';
import NoTransactionIcon from 'src/assets/images/noTransaction.svg';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useSigners from 'src/hooks/useSigners';
import { reinstateVault } from 'src/store/sagaActions/vaults';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParams } from 'src/navigation/types';
import ImportIcon from 'src/assets/images/import.svg';

import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/icon_tick.svg';
import useSignerMap from 'src/hooks/useSignerMap';
import { ConciergeTag } from 'src/store/sagaActions/concierge';
import { cachedTxSnapshot } from 'src/store/reducers/cachedTxn';
import { setStateFromSnapshot } from 'src/store/reducers/send_and_receive';
import PendingHealthCheckModal from 'src/components/PendingHealthCheckModal';
import { SentryErrorBoundary } from 'src/services/sentry';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { ELECTRUM_CLIENT } from 'src/services/electrum/client';
import useWalletAsset from 'src/hooks/useWalletAsset';
import ConciergeNeedHelp from 'src/assets/images/conciergeNeedHelp.svg';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import MiniscriptPathSelector, {
  MiniscriptPathSelectorRef,
} from 'src/components/MiniscriptPathSelector';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import Buttons from 'src/components/Buttons';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { isVaultUsingBlockHeightTimelock } from 'src/services/wallets/factories/VaultFactory';

import { getTnxIdFromCachedTnx } from 'src/utils/utilities';
import { discardBroadcastedTnx } from 'src/store/sagaActions/send_and_receive';
import WalletDetailHeader from '../WalletDetails/components/WalletDetailHeader';
import DetailCards from '../WalletDetails/components/DetailCards';
import MoreCard from '../WalletDetails/components/MoreCard';
import config from 'src/utils/service-utilities/config';
import { setShowTipModal } from 'src/store/reducers/settings';

function TransactionList({
  transactions,
  pullDownRefresh,
  pullRefresh,
  vault,
  isCollaborativeWallet,
}) {
  const { translations } = useContext(LocalizationContext);
  const { common } = translations;
  const navigation = useNavigation();
  const { colorMode } = useColorMode();
  const dispatch = useDispatch();

  const renderTransactionElement = ({ item }) => (
    <TransactionElement
      transaction={item}
      wallet={vault}
      isCached={item?.isCached}
      onPress={() => {
        if (item?.isCached) {
          dispatch(setStateFromSnapshot(item.snapshot.state));
          navigation.dispatch(
            CommonActions.navigate('SendConfirmation', {
              ...item.snapshot.routeParams,
              addresses: item.snapshot.routeParams.addresses
                ? item.snapshot.routeParams.addresses
                : [item.snapshot.routeParams.address],
              amounts: item.snapshot.routeParams.amounts
                ? item.snapshot.routeParams.amounts
                : [item.snapshot.routeParams.amount],
              internalRecipients: item.snapshot.routeParams.internalRecipients
                ? item.snapshot.routeParams.internalRecipients
                : [item.snapshot.routeParams.recipient],
            })
          );
        } else {
          navigation.dispatch(
            CommonActions.navigate('TransactionDetails', {
              transaction: item,
              wallet: vault,
            })
          );
        }
      }}
    />
  );
  return (
    <>
      {transactions?.length ? (
        <HStack style={styles.transTitleWrapper}>
          <Text color={`${colorMode}.black`} medium fontSize={wp(14)}>
            {common.recentTransactions}
          </Text>
          <Pressable
            style={styles.viewAllBtn}
            onPress={() =>
              navigation.dispatch(
                CommonActions.navigate({ name: 'TransactionHistory', params: { wallet: vault } })
              )
            }
          >
            <Text color={`${colorMode}.greenText`} medium fontSize={wp(14)}>
              {common.viewAll}
            </Text>
          </Pressable>
        </HStack>
      ) : null}
      <FlatList
        testID="view_TransactionList"
        refreshControl={<RefreshControl onRefresh={pullDownRefresh} refreshing={pullRefresh} />}
        data={transactions}
        renderItem={renderTransactionElement}
        keyExtractor={(item) => item.txid}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyStateView IllustartionImage={NoTransactionIcon} title={common.noTransYet} />
        }
      />
    </>
  );
}

type ScreenProps = NativeStackScreenProps<AppStackParams, 'VaultDetails'>;

function VaultDetails({ navigation, route }: ScreenProps) {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { vault: vaultTranslation, common } = translations;
  const [showHealthCheckModal, setShowHealthCheckModal] = useState(false);
  const [showTimelockModal, setShowTimelockModal] = useState(false);
  const {
    vaultTransferSuccessful = false,
    autoRefresh = false,
    hardRefresh: autoHardRefresh = false,
    vaultId = '',
    transactionToast = false,
    viewTransaction = null,
  } = route.params || {};
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();
  const { activeVault: vault } = useVault({ vaultId });
  const [pullRefresh, setPullRefresh] = useState(false);
  const { vaultSigners: keys } = useSigners(vault.id);
  const transactions = useMemo(
    () =>
      [...(vault?.specs?.transactions || [])]
        .sort((a, b) => {
          // Sort unconfirmed transactions first
          if (a.confirmations === 0 && b.confirmations !== 0) return -1;
          if (a.confirmations !== 0 && b.confirmations === 0) return 1;

          // Then sort by date
          if (!a.date && !b.date) return 0;
          if (!a.date) return -1;
          if (!b.date) return 1;
          return new Date(b.date).getTime() - new Date(a.date).getTime();
        })
        .slice(0, 5),
    [vault?.specs?.transactions]
  );
  const isCollaborativeWallet = vault.type === VaultType.COLLABORATIVE;
  const isCanaryWallet = vault.type === VaultType.CANARY;
  const introModal =
    useAppSelector((state) => state.vault.introModal) && (isCollaborativeWallet || isCanaryWallet);
  const { signerMap } = useSignerMap();
  const { signers: vaultKeys } = vault || { signers: [] };
  const [pendingHealthCheckCount, setPendingHealthCheckCount] = useState(0);
  const [cachedTransactions, setCachedTransactions] = useState([]);
  const snapshots = useAppSelector((state) => state.cachedTxn.snapshots);
  const { walletSyncing } = useAppSelector((state) => state.wallet);
  const [syncingCompleted, setSyncingCompleted] = useState(false);
  const syncing =
    ELECTRUM_CLIENT.isClientConnected && walletSyncing && vault ? !!walletSyncing[vault.id] : false;

  const isDarkMode = colorMode === 'dark';
  const { getWalletIcon, getWalletCardGradient, getWalletTags } = useWalletAsset();
  const WalletIcon = getWalletIcon(vault);
  const green_modal_text_color = ThemedColor({ name: 'green_modal_text_color' });
  const green_modal_background = ThemedColor({ name: 'green_modal_background' });
  const green_modal_button_background = ThemedColor({ name: 'green_modal_button_background' });
  const green_modal_button_text = ThemedColor({ name: 'green_modal_button_text' });
  const green_modal_sec_button_text = ThemedColor({ name: 'green_modal_sec_button_text' });

  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null);
  const [currentMedianTimePast, setCurrentMedianTimePast] = useState<number | null>(null);
  const [timeUntilTimelockExpires, setTimeUntilTimelockExpires] = useState<string | null>(null);
  const [showmore, setShowMore] = useState(false);
  const [loadingMiniscript, setLoadingMiniscript] = useState(false);

  const miniscriptPathSelectorRef = useRef<MiniscriptPathSelectorRef>(null);

  useEffect(() => {
    if (vault?.type === VaultType.MINISCRIPT) {
      if (isVaultUsingBlockHeightTimelock(vault)) {
        WalletUtilities.fetchCurrentBlockHeight()
          .then(({ currentBlockHeight }) => {
            setCurrentBlockHeight(currentBlockHeight);
          })
          .catch((err) => showToast(err));
      } else {
        WalletUtilities.fetchCurrentMedianTime()
          .then(({ currentMedianTime }) => {
            setCurrentMedianTimePast(currentMedianTime);
          })
          .catch((err) => showToast(err));
      }
    }
  }, [setCurrentBlockHeight, setCurrentMedianTimePast, showToast]);

  useEffect(() => {
    if (
      !vault.scheme?.miniscriptScheme?.usedMiniscriptTypes?.includes(MiniscriptTypes.TIMELOCKED) ||
      (isVaultUsingBlockHeightTimelock(vault) && currentBlockHeight === null) ||
      (!isVaultUsingBlockHeightTimelock(vault) && currentMedianTimePast === null)
    )
      return;

    try {
      let secondsUntilActivation = 0;
      if (isVaultUsingBlockHeightTimelock(vault)) {
        const blocksUntilActivation =
          vault.scheme?.miniscriptScheme?.miniscriptElements.timelocks[0] - currentBlockHeight;
        secondsUntilActivation = blocksUntilActivation * 10 * 60;
      } else {
        secondsUntilActivation =
          vault.scheme?.miniscriptScheme?.miniscriptElements.timelocks[0] - currentMedianTimePast;
      }

      if (secondsUntilActivation > 0) {
        const days = Math.floor(secondsUntilActivation / (24 * 60 * 60));
        const months = Math.floor(days / 30);

        let timeString = '';
        if (months > 0) {
          timeString = `${months} month${months > 1 ? 's' : ''}`;
        } else if (days > 0) {
          timeString = `${days} day${days > 1 ? 's' : ''}`;
        } else {
          const hours = Math.floor(secondsUntilActivation / 3600);
          const minutes = Math.floor((secondsUntilActivation % 3600) / 60);
          timeString = `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${
            minutes > 1 ? 's' : ''
          }`;
        }

        setTimeUntilTimelockExpires(`${timeString}`);
      } else {
        setTimeUntilTimelockExpires(null);
      }
    } catch {
      showToast(
        vaultTranslation.failedToCheckTimelockEndTime,
        null,
        IToastCategory.DEFAULT,
        3000,
        true
      );
    }
  }, [currentBlockHeight, keys, translations, vault, showToast]);

  useEffect(() => {
    if (viewTransaction) {
      const transaction = transactions.find((tx) => tx.txid === viewTransaction);
      if (transaction) {
        navigation.navigate('TransactionDetails', { transaction, wallet: vault });

        // Remove viewTransaction from route params
        navigation.setParams({ viewTransaction: null });
      }
    }
  }, [viewTransaction, transactions, navigation, vault]);

  useEffect(() => {
    if (
      vault?.specs?.balances?.confirmed + vault?.specs?.balances?.unconfirmed === 0 &&
      vault?.isMigrating
    ) {
      try {
        dbManager.updateObjectById(RealmSchema.Vault, vault.id, {
          archived: true,
          isMigrating: false,
        });
        showToast(
          'Vault migration completed successfully',
          <TickIcon />,
          IToastCategory.DEFAULT,
          5000
        );
        setTimeout(() => {
          navigation.navigate('Home');
        }, 100);
      } catch (error) {
        console.log(error);
      }
    }
  }, [vault]);

  useEffect(() => {
    const cached = [];
    for (const cachedTxid in snapshots) {
      const snapshot: cachedTxSnapshot = snapshots[cachedTxid];
      if (!snapshot.routeParams) continue; // route params missing

      const { address, addresses, amount, amounts, sender, date } = snapshot.routeParams;
      if (sender?.id !== vault.id) continue; // doesn't belong to the current vault

      const cachedTx = {
        address: address ? address : addresses[0], // TODO: Refactor, doesn't seem to be used
        amount: amount ? amount : amounts.reduce((sum, amount) => sum + amount, 0),
        blockTime: null,
        confirmations: 0,
        date,
        fee: 0,
        recipientAddresses: [],
        senderAddresses: [],
        tags: [],
        txid: cachedTxid,
        isCached: true,
        snapshot,
        potentialTxId: snapshot.potentialTxId,
      };
      cached.push(cachedTx);
    }

    if (cached.length) {
      cached.reverse(); // order from newest to oldest
      setCachedTransactions(cached);
    } else setCachedTransactions([]);
  }, [snapshots]);

  useEffect(() => {
    if (autoRefresh) syncVault(autoHardRefresh);
  }, [autoRefresh]);

  useEffect(() => {
    if (!syncing && syncingCompleted && transactionToast) {
      showToast(
        vaultTranslation.transactionToastMessage,
        <TickIcon />,
        IToastCategory.DEFAULT,
        5000
      );
      navigation.dispatch(CommonActions.setParams({ transactionToast: false }));
    }
  }, [syncingCompleted, transactionToast]);

  useEffect(() => {
    if (!ELECTRUM_CLIENT.isClientConnected || !syncing) {
      setSyncingCompleted(true);
    } else {
      setSyncingCompleted(false);
    }
  }, [syncing, ELECTRUM_CLIENT]);

  const syncVault = (hardRefresh) => {
    setPullRefresh(true);
    dispatch(refreshWallets([vault], { hardRefresh }));
    setPullRefresh(false);
  };

  const showTimelockModalContent = useCallback(() => {
    return (
      <Box style={styles.delayModalContainer}>
        <ThemedSvg name={'DelayModalIcon'} />
        <Box
          style={styles.timeContainer}
          backgroundColor={
            isDarkMode ? `${colorMode}.primaryBackground` : `${colorMode}.secondaryCreamWhite`
          }
        >
          <Text fontSize={13}>{common.RemainingTime}:</Text>
          <Text fontSize={13}>{timeUntilTimelockExpires}</Text>
        </Box>
        <Box style={styles.buttonContainer}>
          <Buttons
            primaryCallback={() => {
              setShowTimelockModal(false);
            }}
            fullWidth
            primaryText={common.continue}
          />
        </Box>
      </Box>
    );
  }, [timeUntilTimelockExpires]);

  const VaultContent = useCallback(
    () => (
      <View style={styles.vaultModalContainer}>
        <Box style={styles.alignSelf}>
          <ThemedSvg name={'vault_setting_icon'} />
        </Box>
        {isCanaryWallet ? (
          <Text color={green_modal_text_color} style={styles.modalContent}>
            {vaultTranslation.canaryLearnMoreDesc}
          </Text>
        ) : (
          <>
            <Text color={green_modal_text_color} style={styles.modalContent}>
              {isCollaborativeWallet
                ? vaultTranslation.walletSetupDetails
                : vaultTranslation.keeperSupportSigningDevice}
            </Text>
            {!isCollaborativeWallet && (
              <Text color={green_modal_text_color} style={styles.descText}>
                {vaultTranslation.additionalOptionForSignDevice}
              </Text>
            )}
          </>
        )}
      </View>
    ),
    [isCollaborativeWallet, isCanaryWallet]
  );

  useEffect(() => {
    validateCachedTnx();
  }, [transactions]);

  const validateCachedTnx = () => {
    if (!cachedTransactions.length || !transactions.length) return;
    for (const tnx of cachedTransactions) {
      const txid = tnx?.potentialTxId || getTnxIdFromCachedTnx(tnx);
      for (const broadcastedTnx of transactions) {
        if (broadcastedTnx.txid === txid) {
          dispatch(discardBroadcastedTnx({ cachedTxid: tnx.txid, vault }));
        }
      }
    }
  };

  const selectVaultSpendingPaths = async () => {
    if (miniscriptPathSelectorRef.current) {
      setLoadingMiniscript(true);
      await miniscriptPathSelectorRef.current.selectVaultSpendingPaths();
      setLoadingMiniscript(false);
    }
  };

  const handlePathSelected = (miniscriptSelectedSatisfier) => {
    navigation.dispatch(
      CommonActions.navigate('Send', {
        sender: vault,
        miniscriptSelectedSatisfier,
      })
    );
  };

  return (
    <Box style={styles.wrapper} backgroundColor={`${colorMode}.primaryBackground`}>
      <WalletDetailHeader
        settingCallBack={() => {
          if (!vault.archived) {
            navigation.dispatch(CommonActions.navigate('VaultSettings', { vaultId: vault.id }));
          } else {
            navigation.push('VaultSettings', { vaultId: vault.id });
          }
        }}
        backgroundColor={getWalletCardGradient(vault)}
        title={vault.presentationData.name}
        tags={getWalletTags(vault)}
        totalBalance={vault.specs.balances.confirmed + vault.specs.balances.unconfirmed}
        description={vault.presentationData.description}
        wallet={vault}
      />
      <Box style={styles.detailCardsContainer}>
        <Box style={styles.detailCards}>
          <DetailCards
            setShowMore={setShowMore}
            disabled={vault.archived}
            sendCallback={async () => {
              if (timeUntilTimelockExpires) {
                setShowTimelockModal(true);
                return;
              }
              if (vault.type === VaultType.MINISCRIPT) {
                try {
                  await selectVaultSpendingPaths();
                } catch (err) {
                  showToast(typeof err === 'string' ? err : err?.message, <ToastErrorIcon />);
                  return null;
                }
              } else {
                navigation.dispatch(CommonActions.navigate('Send', { sender: vault }));
              }
            }}
            receiveCallback={() => {
              if (pendingHealthCheckCount >= vault.scheme.m) {
                setShowHealthCheckModal(true);
              } else {
                navigation.dispatch(CommonActions.navigate('Receive', { wallet: vault }));
              }
            }}
            buyCallback={() =>
              navigation.dispatch(
                CommonActions.navigate({ name: 'BuyBitcoin', params: { wallet: vault } })
              )
            }
          />
        </Box>
      </Box>
      <VStack backgroundColor={`${colorMode}.primaryBackground`} style={styles.bottomSection}>
        <Box
          flex={1}
          style={styles.transactionsContainer}
          backgroundColor={`${colorMode}.primaryBackground`}
        >
          <TransactionList
            transactions={[...cachedTransactions, ...transactions]}
            pullDownRefresh={() => syncVault(true)}
            pullRefresh={pullRefresh}
            vault={vault}
            isCollaborativeWallet={isCollaborativeWallet}
          />
        </Box>
        <Box></Box>
      </VStack>
      <KeeperModal
        visible={introModal}
        close={() => {
          dispatch(setIntroModal(false));
          isCanaryWallet &&
            dispatch(setShowTipModal({ status: true, address: config.ADDRESS.canary }));
        }}
        title={
          isCollaborativeWallet
            ? vaultTranslation.collaborativeWallet
            : isCanaryWallet
            ? vaultTranslation.canaryWallet
            : vaultTranslation.keeperVault
        }
        subTitle={
          isCollaborativeWallet
            ? vaultTranslation.collaborativeWalletMultipleUsers
            : isCanaryWallet
            ? vaultTranslation.canaryLearnMoreSubtitle
            : vaultTranslation.vaultLearnMoreSubtitle
        }
        modalBackground={green_modal_background}
        textColor={green_modal_text_color}
        Content={VaultContent}
        buttonText={common.Okay}
        secondaryButtonText={common.needHelp}
        buttonTextColor={green_modal_button_text}
        buttonBackground={green_modal_button_background}
        secButtonTextColor={green_modal_sec_button_text}
        secondaryIcon={<ConciergeNeedHelp />}
        secondaryCallback={() => {
          dispatch(setIntroModal(false));
          isCanaryWallet &&
            dispatch(setShowTipModal({ status: true, address: config.ADDRESS.canary }));
          navigation.dispatch(
            CommonActions.navigate({
              name: 'CreateTicket',
              params: {
                tags: isCollaborativeWallet
                  ? [ConciergeTag.COLLABORATIVE_Wallet]
                  : [ConciergeTag.VAULT],
                screenName: 'vault-details',
              },
            })
          );
        }}
        buttonCallback={() => {
          dispatch(setIntroModal(false));
          isCanaryWallet &&
            dispatch(setShowTipModal({ status: true, address: config.ADDRESS.canary }));
        }}
        DarkCloseIcon
      />
      <PendingHealthCheckModal
        selectedItem={vault}
        vaultKeys={vaultKeys}
        signerMap={signerMap}
        keys={keys}
        showHealthCheckModal={showHealthCheckModal}
        pendingHealthCheckCount={pendingHealthCheckCount}
        setPendingHealthCheckCount={setPendingHealthCheckCount}
        setShowHealthCheckModal={setShowHealthCheckModal}
        primaryButtonCallback={() => {
          setShowHealthCheckModal(false);
          navigation.dispatch(CommonActions.navigate('Receive', { wallet: vault }));
        }}
      />
      <KeeperModal
        visible={showTimelockModal}
        close={() => {
          setShowTimelockModal(false);
        }}
        title={common.vaultTimelockActive}
        subTitle={common.vaultTimelockActiveDesc}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={showTimelockModalContent}
      />
      <KeeperModal
        visible={showmore}
        close={() => setShowMore(false)}
        title={common.moreOptions}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        textColor={`${colorMode}.textGreen`}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        Content={() => {
          return (
            <Box>
              {/* <MoreCard
                title={common.swapBtc}
                callBack={() => {
                  setShowMore(false);
                }}
                Icon={<SwapSvg />}
              /> */}
              <MoreCard
                title={common.viewAllCoins}
                callBack={() => {
                  setShowMore(false);
                  setTimeout(() => {
                    navigation.navigate('UTXOManagement', {
                      data: vault,
                      routeName: 'Vault',
                      vaultId,
                    });
                  }, 300);
                }}
                Icon={<CoinIcon />}
              />
              {!isCanaryWallet && (
                <MoreCard
                  title={common.manageKeys}
                  callBack={() => {
                    setShowMore(false);
                    setTimeout(() => {
                      navigation.dispatch(
                        CommonActions.navigate({
                          name: 'ManageSigners',
                          params: { vaultId, vaultKeys: vault.signers },
                        })
                      );
                    }, 300);
                  }}
                  Icon={<SignerIcon />}
                />
              )}
              {vault.archived && (
                <MoreCard
                  title={common.reinstate}
                  callBack={() => {
                    setShowMore(false);
                    setTimeout(() => {
                      dispatch(reinstateVault(vault.id));
                      showToast('Vault reinstated successfully', <TickIcon />);
                    }, 300);
                  }}
                  Icon={<ImportIcon />}
                />
              )}
            </Box>
          );
        }}
      />

      <MiniscriptPathSelector
        ref={miniscriptPathSelectorRef}
        vault={vault}
        onPathSelected={handlePathSelected}
        onError={(err) => showToast(err, <ToastErrorIcon />)}
        onCancel={() => {}}
      />
      <ActivityIndicatorView visible={syncing || loadingMiniscript} showLoader />
    </Box>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  vaultInfoContainer: {
    flexDirection: 'row',
    paddingLeft: '3%',
    marginTop: 20,
    marginBottom: 10,
    justifyContent: 'space-between',
  },
  pillsContainer: {
    gap: 2,
  },
  actionCardContainer: {
    marginTop: 20,
    marginBottom: -50,
    zIndex: 10,
    gap: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topSection: {
    paddingHorizontal: 20,
  },
  bottomSection: {
    paddingTop: wp(65),
    paddingBottom: 20,
    flex: 1,
    justifyContent: 'space-between',
  },
  transactionsContainer: {
    paddingHorizontal: wp(22),
    marginTop: hp(5),
    paddingTop: hp(10),
    borderBottomWidth: 0,
  },

  transTitleWrapper: {
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
  IconText: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  signerCard: {
    elevation: 4,
    shadowRadius: 4,
    shadowOpacity: 0.3,
    shadowOffset: { height: 2, width: 0 },
    height: 130,
    width: 70,
    borderTopLeftRadius: 100,
    borderTopRightRadius: 100,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 5,
  },
  scrollContainer: {
    padding: '8%',
    minWidth: windowWidth,
  },
  knowMore: {
    paddingHorizontal: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FAFCFC',
    alignSelf: 'flex-end',
  },
  footerText: {
    fontSize: 12,
    letterSpacing: 0.84,
  },
  vaultInfoText: {
    letterSpacing: 1.28,
  },
  indicator: {
    height: 10,
    width: 10,
    borderRadius: 10,
    position: 'absolute',
    zIndex: 2,
    right: '10%',
    top: '5%',
    borderWidth: 1,
    borderColor: 'white',
    backgroundColor: '#F86B50',
  },
  unregistered: {
    color: '#6E563B',
    fontSize: 8,
    letterSpacing: 0.6,
    textAlign: 'center',
    lineHeight: 16,
  },
  rampBuyContentWrapper: {
    padding: 1,
  },
  byProceedingContent: {
    color: '#073B36',
    fontSize: 13,
    letterSpacing: 0.65,
    marginVertical: 1,
  },
  cardWrapper: {
    marginVertical: 5,
    alignItems: 'center',
    borderRadius: 10,
    padding: 5,
    backgroundColor: '#F9F4F0',
    flexDirection: 'row',
  },
  atIconWrapper: {
    backgroundColor: '#FAC48B',
    borderRadius: 20,
    height: 35,
    width: 35,
    justifyItems: 'center',
    alignItems: 'center',
  },
  buyAddressText: {
    fontSize: 19,
    letterSpacing: 1.28,
    color: '#041513',
    width: wp(200),
  },
  addPhoneEmailWrapper: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: hp(20),
    paddingVertical: hp(10),
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  iconWrapper: {
    width: '15%',
  },
  titleWrapper: {
    width: '75%',
  },
  addPhoneEmailTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  addPhoneEmailSubTitle: {
    fontSize: 12,
  },
  rightIconWrapper: {
    width: '10%',
    marginLeft: 5,
  },
  vaultModalContainer: {
    marginVertical: 5,
    gap: 4,
  },
  alignSelf: {
    alignSelf: 'center',
  },
  modalContent: {
    marginTop: hp(20),
    fontSize: 14,
    padding: 1,
  },
  descText: {
    fontSize: 14,
  },
  mt3: {
    marginTop: 3,
  },
  alignItems: {
    alignItems: 'center',
  },
  signerListContainer: {
    marginTop: hp(-16),
  },
  topContainer: {
    flex: 1,
  },
  addedSignersContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  desc: {
    marginTop: hp(15),
    fontSize: 13,
  },
  settingBtn: {
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  archivedBalance: {
    alignItems: 'flex-end',
    marginTop: hp(25),
  },
  card: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: {
    marginBottom: hp(5),
  },
  optionIconCtr: {
    height: hp(39),
    width: wp(39),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 100,
  },
  optionCTR: {
    flexDirection: 'row',
    paddingHorizontal: wp(15),
    paddingVertical: hp(22),
    alignItems: 'center',
    gap: wp(16),
    borderRadius: 12,
    borderWidth: 1,
  },
  delayModalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  timeContainer: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: wp(15),
    paddingVertical: hp(21),
    borderRadius: 10,
    marginTop: hp(20),
    marginBottom: hp(15),
  },
  buttonContainer: {
    marginTop: hp(15),
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

export default SentryErrorBoundary(VaultDetails);
