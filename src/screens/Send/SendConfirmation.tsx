import { StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import Text from 'src/components/KeeperText';
import { Box, useColorMode } from 'native-base';
import { CommonActions, useIsFocused, useNavigation } from '@react-navigation/native';
import React, { useCallback, useContext, useEffect, useState } from 'react';
import { sendPhaseTwo } from 'src/store/sagaActions/send_and_receive';
import { hp, wp } from 'src/constants/responsive';
import Share from 'react-native-share';
import Buttons from 'src/components/Buttons';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ScreenWrapper from 'src/components/ScreenWrapper';
import {
  EntityKind,
  MultisigScriptType,
  NetworkType,
  TxPriority,
} from 'src/services/wallets/enums';
import { MiniscriptTxSelectedSatisfier, Vault } from 'src/services/wallets/interfaces/vault';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import {
  customPrioritySendPhaseOneStatusReset,
  sendPhaseTwoReset,
} from 'src/store/reducers/send_and_receive';
import { useAppSelector } from 'src/store/hooks';
import { useDispatch } from 'react-redux';
import KeeperModal from 'src/components/KeeperModal';
import useToastMessage from 'src/hooks/useToastMessage';
import useBalance from 'src/hooks/useBalance';
import useWallets from 'src/hooks/useWallets';
import useVault from 'src/hooks/useVault';
import PasscodeVerifyModal from 'src/components/Modal/PasscodeVerify';
import { InputUTXOs, UTXO } from 'src/services/wallets/interfaces';
import CurrencyTypeSwitch from 'src/components/Switch/CurrencyTypeSwitch';
import FeeInsights from 'src/screens/FeeInsights/FeeInsightsContent';
import useOneDayInsight from 'src/hooks/useOneDayInsight';
import Clipboard from '@react-native-clipboard/clipboard';
import CVVInputsView from 'src/components/HealthCheck/CVVInputsView';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import InvalidUTXO from 'src/assets/images/invalidUTXO.svg';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ShareGreen from 'src/assets/images/share-arrow-green.svg';
import ShareWhite from 'src/assets/images/share-arrow-white.svg';
import { resetVaultMigration } from 'src/store/reducers/vaults';
import { MANAGEWALLETS, VAULTSETTINGS, WALLETSETTINGS } from 'src/navigation/contants';
import { refreshWallets } from 'src/store/sagaActions/wallets';
import idx from 'idx';
import { cachedTxSnapshot, dropTransactionSnapshot } from 'src/store/reducers/cachedTxn';
import AmountChangedWarningIllustration from 'src/assets/images/amount-changed-warning-illustration.svg';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { SentryErrorBoundary } from 'src/services/sentry';
import { credsAuthenticated } from 'src/store/reducers/login';
import WalletHeader from 'src/components/WalletHeader';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { deleteDelayedTransaction } from 'src/store/reducers/storage';
import { DelayedTransaction } from 'src/models/interfaces/AssistedKeys';
import ReceiptWrapper from './ReceiptWrapper';
import TransactionPriorityDetails from './TransactionPriorityDetails';
import HighFeeAlert from './HighFeeAlert';
import FeeRateStatementCard from '../FeeInsights/FeeRateStatementCard';
import AmountDetails from './AmountDetails';
import SendSuccessfulContent from './SendSuccessfulContent';
import PriorityModal from './PriorityModal';
import CustomPriorityModal from './CustomPriorityModal';
import SigningServer from '../../services/backend/SigningServer';
import SendingCard from './SendingCard';
import SendingCardIcon from 'src/assets/images/vault_icon.svg';
import WalletIcon from 'src/assets/images/daily_wallet.svg';
import MultiSendSvg from 'src/assets/images/@.svg';
import useExchangeRates from 'src/hooks/useExchangeRates';
import Relay from 'src/services/backend/Relay';

export interface SendConfirmationRouteParams {
  sender: Wallet | Vault;
  internalRecipients: (Wallet | Vault)[];
  addresses: string[];
  amounts: number[];
  walletId: string;
  note: string;
  selectedUTXOs: UTXO[];
  date: Date;
  parentScreen: string;
  transactionPriority: TxPriority;
  customFeePerByte: number;
  miniscriptSelectedSatisfier?: MiniscriptTxSelectedSatisfier;
  tipMessage: string;
}

export interface tnxDetailsProps {
  transactionPriority: TxPriority;
  txFeeInfo: any;
}

export enum ASSISTED_VAULT_ENTITIES {
  UK = 'UK',
  AK1 = 'AK1',
  AK2 = 'AK2',
}

function SendConfirmation({ route }) {
  const { colorMode } = useColorMode();
  const { showToast } = useToastMessage();
  const dispatch = useDispatch();
  const isFocused = useIsFocused();
  const {
    sender,
    internalRecipients,
    addresses,
    amounts: originalAmounts,
    walletId,
    note,
    selectedUTXOs,
    parentScreen,
    transactionPriority: initialTransactionPriority,
    customFeePerByte: initialCustomFeePerByte,
    miniscriptSelectedSatisfier,
    tipMessage = '',
  }: SendConfirmationRouteParams = route.params;
  const navigation = useNavigation();
  const exchangeRates = useExchangeRates();
  const { currencyCode } = useAppSelector((state) => state.settings);
  const BtcPrice = exchangeRates?.[currencyCode];
  const { conciergeUser } = useAppSelector((state) => state?.concierge);
  const txFeeInfo = useAppSelector((state) => state.sendAndReceive.transactionFeeInfo);
  const txRecipientsOptions = useAppSelector(
    (state) => state.sendAndReceive.sendPhaseOne?.outputs?.txRecipients
  );
  const customTxRecipientsOptions = useAppSelector(
    (state) => state.sendAndReceive.customPrioritySendPhaseOne?.outputs?.customTxRecipients
  );
  const sendMaxFee = useAppSelector((state) => state.sendAndReceive.sendMaxFee);

  const averageTxFees = useAppSelector((state) => state.network.averageTxFees);
  const [customFeePerByte, setCustomFeePerByte] = useState(initialCustomFeePerByte ?? 0);
  const { wallets } = useWallets({ getAll: true });
  const sourceWallet = wallets.find((item) => item?.id === walletId);
  const sourceWalletAmount = sourceWallet?.specs.balances.confirmed - sendMaxFee;

  const { activeVault: defaultVault } = useVault({ includeArchived: false, getFirst: true });

  const { translations } = useContext(LocalizationContext);
  const {
    wallet: walletTranslations,
    common,
    vault,
    error: errorText,
    transactions,
  } = translations;

  const { getSatUnit, getBalance, getCurrencyIcon } = useBalance();

  const isDarkMode = colorMode === 'dark';
  const [visibleModal, setVisibleModal] = useState(false);
  const [confirmPassVisible, setConfirmPassVisible] = useState(false);
  const [transPriorityModalVisible, setTransPriorityModalVisible] = useState(false);
  const [highFeeAlertVisible, setHighFeeAlertVisible] = useState(false);
  const [amountChangedAlertVisible, setAmountChangedAlertVisible] = useState(false);
  const [feeInsightVisible, setFeeInsightVisible] = useState(false);
  const [visibleCustomPriorityModal, setVisibleCustomPriorityModal] = useState(false);
  const [discardUTXOVisible, setDiscardUTXOVisible] = useState(false);
  const OneDayHistoricalFee = useOneDayInsight();

  const isMoveAllFunds =
    parentScreen === MANAGEWALLETS ||
    parentScreen === VAULTSETTINGS ||
    parentScreen === WALLETSETTINGS;
  const serializedPSBTEnvelops = useAppSelector(
    (state) => state.sendAndReceive.sendPhaseTwo.serializedPSBTEnvelops
  );

  const {
    txid: walletSendSuccessful,
    hasFailed: sendPhaseTwoFailed,
    failedErrorMessage: failedSendPhaseTwoErrorMessage,
    cachedTxid, // generated for new transactions as well(in case they get cached)
    cachedTxPriority,
  } = useAppSelector((state) => state.sendAndReceive.sendPhaseTwo);
  const cachedTxn = useAppSelector((state) => state.cachedTxn);
  const delayedTransactions = useAppSelector((state) => state.storage.delayedTransactions) || {};
  const snapshot: cachedTxSnapshot = cachedTxn.snapshots[cachedTxid];
  const isCachedTransaction = !!snapshot;
  const cachedTxPrerequisites = idx(snapshot, (_) => _.state.sendPhaseOne.outputs.txPrerequisites);
  const [transactionPriority, setTransactionPriority] = useState(
    isCachedTransaction
      ? cachedTxPriority || TxPriority.LOW
      : initialTransactionPriority || TxPriority.LOW
  );
  const [usualFee, setUsualFee] = useState(0);
  const [topText, setTopText] = useState('');
  const [isFeeHigh, setIsFeeHigh] = useState(false);
  const [isUsualFeeHigh, setIsUsualFeeHigh] = useState(false);
  const [validationModal, showValidationModal] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [otp, setOtp] = useState('');
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);

  const [amounts, setAmounts] = useState(
    isCachedTransaction
      ? originalAmounts
      : (
          txRecipientsOptions?.[transactionPriority] ||
          customTxRecipientsOptions?.[transactionPriority]
        )?.map((recipient) => recipient.amount)
  );

  const [customEstBlocks, setCustomEstBlocks] = useState(0);
  const [estimationSign, setEstimationSign] = useState('≈');

  useEffect(() => {
    if (!isCachedTransaction) {
      setAmounts(
        (
          txRecipientsOptions?.[transactionPriority] ||
          customTxRecipientsOptions?.[transactionPriority]
        )?.map((recipient) => recipient.amount)
      );
    }
  }, [txRecipientsOptions, customTxRecipientsOptions, transactionPriority]);

  function checkUsualFee(data: any[]) {
    if (data.length === 0) {
      return;
    }

    const total = data.reduce((sum, record) => sum + record.avgFee_75, 0);
    const historicalAverage = total / data.length;
    const recentFee = data[data.length - 1].avgFee_75;

    const difference = recentFee - historicalAverage;
    const percentageDifference = (difference / historicalAverage) * 100;
    setUsualFee(Math.abs(Number(percentageDifference.toFixed(2))));
    setIsUsualFeeHigh(usualFee > 10);
  }

  useEffect(() => {
    if (OneDayHistoricalFee.length > 0) {
      checkUsualFee(OneDayHistoricalFee);
    }
  }, [OneDayHistoricalFee]);

  useEffect(() => {
    const remove = navigation.addListener('beforeRemove', (e) => {
      e.preventDefault();
      remove();

      const routes = (e.data.action?.payload as any)?.routes || [];
      const isDiscarding = routes.length > 1 ? routes[1]?.params?.isDiscarding : false;

      if (navigation.getState().index > 2 && isCachedTransaction && !isDiscarding) {
        navigation.dispatch(
          CommonActions.reset({
            index: 1,
            routes: [{ name: 'Home' }, { name: 'VaultDetails', params: { vaultId: sender?.id } }],
          })
        );
        if (isFocused) {
          showToast(errorText.pendingTransactonSuccesful, <TickIcon />);
        }
      } else {
        navigation.dispatch(e.data.action);
      }
    });
    return remove;
  }, [navigation, isCachedTransaction]);

  useEffect(() => {
    let hasHighFee = false;
    const selectedFee = txFeeInfo[transactionPriority?.toLowerCase()].amount;
    if (selectedFee > amounts.reduce((sum, amount) => sum + amount, 0) / 10) hasHighFee = true; // if fee is greater than 10% of the total amount being sent

    if (hasHighFee) {
      setIsFeeHigh(true);
      setHighFeeAlertVisible(true);
    } else setHighFeeAlertVisible(false);

    if (
      !isCachedTransaction &&
      JSON.stringify(originalAmounts) !==
        JSON.stringify(
          (
            txRecipientsOptions?.[transactionPriority] ||
            customTxRecipientsOptions?.[transactionPriority]
          )?.map((recipient) => recipient.amount)
        )
    ) {
      setAmountChangedAlertVisible(true);
      const newMsg = updateSatsAmountInMsg(
        tipMessage,
        (
          txRecipientsOptions?.[transactionPriority] ||
          customTxRecipientsOptions?.[transactionPriority]
        )?.map((recipient) => recipient.amount)[0]
      );
      // @ts-ignore
      navigation.setParams({ tipMessage: newMsg });
    }
  }, [transactionPriority, amounts]);

  const [inProgress, setProgress] = useState(false);

  const onProceed = () => {
    setProgress(true);
  };

  useEffect(() => {
    if (isCachedTransaction) {
      // case: cached transaction; do not reset sendPhase as we already have phase two set via cache
    } else {
      // case: new transaction

      if (inProgress) {
        if (
          sender.entityKind === EntityKind.VAULT &&
          (sender as Vault).scheme.multisigScriptType === MultisigScriptType.MINISCRIPT_MULTISIG
        ) {
          if (!miniscriptSelectedSatisfier) {
            showToast(errorText.invalidPhase, <ToastErrorIcon />);
            return;
          }
        }

        WalletUtilities.fetchCurrentBlockHeight()
          .then(({ currentBlockHeight }) => {
            setTimeout(() => {
              dispatch(sendPhaseTwoReset());
              dispatch(
                sendPhaseTwo({
                  wallet: sender,
                  currentBlockHeight,
                  txnPriority: transactionPriority,
                  miniscriptTxElements: {
                    selectedPhase: miniscriptSelectedSatisfier?.selectedPhase.id,
                    selectedPaths: miniscriptSelectedSatisfier?.selectedPaths.map(
                      (path) => path.id
                    ),
                  },
                  note,
                })
              );
            }, 200);
          })
          .catch(() => showToast(errorText.failedToFetchCurrentBlock, <ToastErrorIcon />));
      }
    }
  }, [inProgress]);

  const { activeVault: currentSender } = useVault({ vaultId: sender?.id }); // current state of vault

  const validateUTXOsForCachedTxn = () => {
    // perform UTXO validation for cached transaction

    if (!cachedTxPrerequisites) return false;

    const cachedInputUTXOs: InputUTXOs[] = idx(
      cachedTxPrerequisites,
      (_) => _[transactionPriority].inputs
    );
    if (!cachedInputUTXOs) return false;

    const confirmedUTXOs: InputUTXOs[] = idx(currentSender, (_) => _.specs.confirmedUTXOs) || [];
    const unconfirmedUTXOs: InputUTXOs[] =
      idx(currentSender, (_) => _.specs.unconfirmedUTXOs) || [];

    const currentUTXOSet = [...confirmedUTXOs, ...unconfirmedUTXOs];

    for (const cachedUTXO of cachedInputUTXOs) {
      let found = false;
      for (const currentUTXO of currentUTXOSet) {
        if (cachedUTXO.txId === currentUTXO.txId && cachedUTXO.vout === currentUTXO.vout) {
          found = true;
          break;
        }
      }

      if (!found) return false;
    }

    return true;
  };

  const dropSnapshot = () => {
    dispatch(dropTransactionSnapshot({ cachedTxid }));
    navigation.dispatch(
      CommonActions.reset({
        index: 1,
        routes: [
          { name: 'Home' },
          { name: 'VaultDetails', params: { vaultId: sender?.id, isDiscarding: true } },
        ],
      })
    );
  };

  const cancelSigningRequestAndDiscardCache = async () => {
    const verificationToken = otp;
    const delayedTx: DelayedTransaction = delayedTransactions[cachedTxid];

    const { canceled } = await SigningServer.cancelDelayedTransaction(
      delayedTx.signerId,
      cachedTxid,
      verificationToken
    );

    if (canceled) {
      dispatch(deleteDelayedTransaction(cachedTxid));
      showValidationModal(false);
      showToast(errorText.serverKeysigningReq);

      dropSnapshot();
    } else {
      setOtp('');
      showValidationModal(false);
      showToast(errorText.failedToCancelServerKeysigningReq);
    }
  };

  const discardCachedTransaction = async () => {
    const delayedTx = delayedTransactions[cachedTxid];
    if (delayedTx) {
      const { signedPSBT } = delayedTx;
      if (signedPSBT) {
        // case: delayed transaction is already signed
        dispatch(deleteDelayedTransaction(cachedTxid));
        dropSnapshot();
      } else {
        // case: delayed transaction under process, initiate cancellation
        showValidationModal(true);
      }
    } else {
      dropSnapshot();
    }
  };

  useEffect(() => {
    if (serializedPSBTEnvelops && serializedPSBTEnvelops.length && inProgress) {
      if (isCachedTransaction) {
        // perform UTXO validation for cached transaction
        const isValid = validateUTXOsForCachedTxn();
        if (!isValid) {
          // block and show discard alert
          setDiscardUTXOVisible(true);
          return;
        }
      }

      navigation.dispatch(
        CommonActions.navigate('SignTransactionScreen', {
          isMoveAllFunds,
          note,
          vaultId: sender?.id,
          sender,
          sendConfirmationRouteParams: route.params,
          miniscriptTxElements: {
            selectedPhase: miniscriptSelectedSatisfier?.selectedPhase.id,
            selectedPaths: miniscriptSelectedSatisfier?.selectedPaths.map((path) => path.id),
          },
          tnxDetails: {
            txFeeInfo,
            transactionPriority,
          },
          amounts,
          addresses,
          internalRecipients,
          tipMessage,
        })
      );
      setProgress(false);
    }
  }, [serializedPSBTEnvelops, miniscriptSelectedSatisfier, inProgress]);

  useEffect(
    () => () => {
      dispatch(resetVaultMigration());
    },
    []
  );

  const viewDetails = () => {
    setVisibleModal(false);
    const navigationState = {
      index: 1,
      routes: [
        { name: 'Home' },
        {
          name: 'WalletDetails',
          params: {
            autoRefresh: true,
            hardRefresh: false,
            walletId: sender?.id,
            transactionToast: true,
          },
        },
      ],
    };
    navigation.dispatch(CommonActions.reset(navigationState));
  };

  const viewManageWallets = () => {
    new Promise((resolve, reject) => {
      try {
        const result = dispatch(refreshWallets([sender], { hardRefresh: false }));
        resolve(result);
      } catch (error) {
        reject(error);
      }
    })
      .then(() => {
        setVisibleModal(false);
        navigation.dispatch(
          CommonActions.reset({
            index: 1,
            routes: [
              { name: 'Home' },
              {
                name: 'ManageWallets',
              },
            ],
          })
        );
      })
      .catch((error) => {
        console.error('Error refreshing wallets:', error);
      });
  };

  const handleShare = async () => {
    const url = `https://mempool.space${
      bitcoinNetworkType === NetworkType.TESTNET ? '/testnet4' : ''
    }/tx/${walletSendSuccessful}`;

    try {
      await Share.open({
        title: transactions.transactionDetails,
        message: transactions.transactionSuccessSent + url,
      });
    } catch (err) {
      console.error('Share error:', err);
    }
  };

  useEffect(() => {
    if (walletSendSuccessful) {
      if (tipMessage.length) createZendeskTipTicket();
      else {
        setProgress(false);
        setVisibleModal(true);
      }
    }
  }, [walletSendSuccessful]);

  useEffect(() => {
    if (sendPhaseTwoFailed) setProgress(false);
    if (failedSendPhaseTwoErrorMessage) {
      showToast(`${errorText.failedToSendTransaction} ${failedSendPhaseTwoErrorMessage}`);
    }
  }, [sendPhaseTwoFailed]);

  const createZendeskTipTicket = async () => {
    await Relay.createZendeskTicket({
      desc: tipMessage.trim(),
      conciergeUser,
      isTip: true,
    });
    setProgress(false);
    setVisibleModal(true);
  };

  const toogleFeesInsightModal = () => {
    if (highFeeAlertVisible) {
      setHighFeeAlertVisible(false);
      // To give smooth transcation of modal,
      // After closing highfee modal.
      setTimeout(() => {
        setFeeInsightVisible(true);
      }, 300);
    } else {
      setFeeInsightVisible(!feeInsightVisible);
    }
  };

  const discardUTXOModalContent = () => {
    return (
      <Box style={{ width: wp(280) }}>
        <Box style={styles.imgCtr}>
          <InvalidUTXO />
        </Box>
        <Text color={`${colorMode}.primaryText`} style={styles.highFeeNote}>
          {walletTranslations.discardTnxDesc}
        </Text>
      </Box>
    );
  };

  const otpContent = useCallback(() => {
    const onPressNumber = (text) => {
      let tmpPasscode = otp;
      if (otp.length < 6) {
        if (text !== 'x') {
          tmpPasscode += text;
          setOtp(tmpPasscode);
        }
      }
      if (otp && text === 'x') {
        setOtp(otp.slice(0, -1));
      }
    };

    const onDeletePressed = () => {
      setOtp(otp.slice(0, otp.length - 1));
    };

    return (
      <Box style={styles.otpContainer}>
        <Box>
          <TouchableOpacity
            onPress={async () => {
              const clipBoardData = await Clipboard.getString();
              if (clipBoardData.match(/^\d{6}$/)) {
                setOtp(clipBoardData);
              } else {
                showToast('Invalid OTP');
                setOtp('');
              }
            }}
            testID="otpClipboardButton"
          >
            <CVVInputsView
              passCode={otp}
              passcodeFlag={false}
              backgroundColor
              textColor
              height={hp(46)}
              width={hp(46)}
              marginTop={hp(0)}
              marginBottom={hp(40)}
              inputGap={2}
              customStyle={styles.CVVInputsView}
            />
          </TouchableOpacity>
        </Box>
        <KeyPadView
          onPressNumber={onPressNumber}
          onDeletePressed={onDeletePressed}
          keyColor={`${colorMode}.primaryText`}
        />
        <Box mt={10} alignSelf="flex-end">
          <Box>
            <Buttons
              primaryCallback={cancelSigningRequestAndDiscardCache}
              fullWidth
              primaryText="Confirm"
              primaryDisable={otp.length !== 6}
            />
          </Box>
        </Box>
      </Box>
    );
  }, [otp, delayedTransactions]);

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={common.sendConfirmation} rightComponent={<CurrencyTypeSwitch />} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <Box style={styles.receiptContainer}>
          <ReceiptWrapper
            showThemedSvg
            toggleVisibilityButton
            setShowMore={setShowMore}
            showMore={showMore}
          >
            <SendingCard
              title={walletTranslations.sendingFrom}
              subTitle={sender?.presentationData?.name}
              icon={<SendingCardIcon width={30} height={30} />}
            />
            {amounts?.flatMap((amount, index) => [
              <SendingCard
                title={walletTranslations.sendingTo}
                subTitle={internalRecipients[index]?.presentationData?.name || addresses[index]}
                icon={amounts.length > 1 ? <MultiSendSvg /> : <WalletIcon />}
                amount={amount}
                multiItem={amounts.length > 1 ? true : false}
              />,
            ])}

            <TouchableOpacity
              testID="btn_transactionPriority"
              onPress={() => setTransPriorityModalVisible(true)}
              disabled={isCachedTransaction} // disable change priority for AutoTransfers
            >
              <TransactionPriorityDetails
                disabled={isCachedTransaction}
                transactionPriority={transactionPriority}
                txFeeInfo={txFeeInfo}
                getBalance={getBalance}
                getCurrencyIcon={getCurrencyIcon}
                getSatUnit={getSatUnit}
                estimationSign={estimationSign}
              />
            </TouchableOpacity>
            {showMore && [
              OneDayHistoricalFee.length > 0 && (
                <FeeRateStatementCard
                  key="feeCard"
                  showFeesInsightModal={toogleFeesInsightModal}
                  feeInsightData={OneDayHistoricalFee}
                />
              ),
              <Box key="btcBox">
                <Text
                  medium
                  color={`${colorMode}.primaryText`}
                  fontSize={13}
                  style={styles.currentBtcPrice}
                >
                  {walletTranslations.currentBtcPrice}
                </Text>
                <Text fontSize={12} color={`${colorMode}.primaryText`}>
                  {`${new Intl.NumberFormat('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }).format(BtcPrice?.last)} ${BtcPrice?.symbol}`}
                </Text>
              </Box>,
            ]}
          </ReceiptWrapper>
        </Box>
        <Box
          style={styles.totalAmountWrapper}
          borderColor={`${colorMode}.separator`}
          backgroundColor={`${colorMode}.textInputBackground`}
        >
          <AmountDetails
            title={walletTranslations.networkFee}
            titleFontSize={12}
            amount={txFeeInfo[transactionPriority?.toLowerCase()]?.amount}
            amountFontSize={12}
            unitFontSize={12}
            titleColor={`${colorMode}.secondaryLightGrey`}
            amountColor={`${colorMode}.secondaryLightGrey`}
            unitColor={`${colorMode}.secondaryLightGrey`}
          />
          <AmountDetails
            title={walletTranslations.amountBeingSend}
            titleFontSize={13}
            titleFontWeight={500}
            amount={amounts.reduce((sum, amount) => sum + amount, 0)}
            amountFontSize={15}
            unitFontSize={12}
            amountColor={`${colorMode}.secondaryText`}
            unitColor={`${colorMode}.secondaryText`}
          />
          <Box style={styles.horizontalLineStyle} borderBottomColor={`${colorMode}.Border`} />
          <AmountDetails
            title={walletTranslations.totalAmount}
            titleFontSize={13}
            titleFontWeight={500}
            amount={
              txFeeInfo[transactionPriority?.toLowerCase()]?.amount +
              amounts.reduce((sum, amount) => sum + amount, 0)
            }
            amountFontSize={15}
            unitFontSize={12}
            amountColor={`${colorMode}.secondaryText`}
            unitColor={`${colorMode}.secondaryText`}
          />
        </Box>
      </ScrollView>
      <Box marginTop={hp(15)}>
        <Buttons
          primaryText={common.confirmProceed}
          secondaryText={isCachedTransaction ? common.discard : common.cancel}
          secondaryCallback={() => {
            if (isCachedTransaction) discardCachedTransaction();
            else navigation.goBack();
          }}
          primaryCallback={() => {
            dispatch(credsAuthenticated(false));
            setConfirmPassVisible(true);
          }}
          primaryLoading={inProgress}
        />
      </Box>
      <KeeperModal
        visible={visibleModal}
        close={!isMoveAllFunds ? viewDetails : viewManageWallets}
        title={walletTranslations.SendSuccess}
        subTitle={walletTranslations.transactionBroadcasted}
        DarkCloseIcon={colorMode === 'dark'}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <SendSuccessfulContent
            transactionPriority={transactionPriority}
            amounts={amounts || [sourceWalletAmount]}
            sender={sender || sourceWallet}
            recipients={internalRecipients || [defaultVault]}
            addresses={addresses}
            primaryText={
              !isMoveAllFunds ? walletTranslations.ViewWallets : walletTranslations.ManageWallets
            }
            primaryCallback={!isMoveAllFunds ? viewDetails : viewManageWallets}
            secondaryCallback={handleShare}
            secondaryText={common.shareDetails}
            SecondaryIcon={isDarkMode ? <ShareWhite /> : <ShareGreen />}
            primaryButtonWidth={wp(142)}
          />
        )}
      />
      <KeeperModal
        visible={confirmPassVisible}
        close={() => setConfirmPassVisible(false)}
        title={walletTranslations.confirmPassTitle}
        subTitleWidth={wp(240)}
        subTitle=""
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <PasscodeVerifyModal
            useBiometrics
            close={() => {
              setConfirmPassVisible(false);
            }}
            onSuccess={onProceed}
          />
        )}
      />
      {/* Transaction Priority Modal */}
      <KeeperModal
        visible={transPriorityModalVisible}
        close={() => setTransPriorityModalVisible(false)}
        title={walletTranslations.transactionPriority}
        subTitle={walletTranslations.transactionPrioritySubTitle}
        buttonText={common.confirm}
        buttonCallback={() => {
          setTransPriorityModalVisible(false), setTransactionPriority;
        }}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => setTransPriorityModalVisible(false)}
        Content={() => (
          <PriorityModal
            selectedPriority={transactionPriority}
            setSelectedPriority={setTransactionPriority}
            averageTxFees={averageTxFees[bitcoinNetworkType]}
            txFeeInfo={txFeeInfo}
            customFeePerByte={customFeePerByte}
            onOpenCustomPriorityModal={() => {
              dispatch(customPrioritySendPhaseOneStatusReset());
              setVisibleCustomPriorityModal(true);
            }}
            customEstBlocks={customEstBlocks}
            setCustomEstBlocks={setCustomEstBlocks}
            estimationSign={estimationSign}
            setEstimationSign={setEstimationSign}
          />
        )}
      />
      {/* High fee alert Modal */}
      <KeeperModal
        visible={highFeeAlertVisible}
        close={() => setHighFeeAlertVisible(false)}
        showCloseIcon={false}
        title={walletTranslations.highFeeAlert}
        subTitleWidth={wp(240)}
        subTitle={topText}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        secButtonTextColor={`${colorMode}.greenText`}
        buttonText={common.proceed}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => setHighFeeAlertVisible(false)}
        buttonCallback={() => {
          setHighFeeAlertVisible(false);
        }}
        Content={() => (
          <HighFeeAlert
            transactionPriority={transactionPriority}
            txFeeInfo={txFeeInfo}
            amountToSend={amounts.reduce((sum, amount) => sum + amount, 0)}
            isFeeHigh={isFeeHigh}
            isUsualFeeHigh={isUsualFeeHigh}
            setTopText={setTopText}
          />
        )}
      />
      {/* Amount changed Modal */}
      <KeeperModal
        visible={amountChangedAlertVisible}
        close={() => setAmountChangedAlertVisible(false)}
        showCloseIcon={false}
        title={walletTranslations.transactionAmountChangedTitle}
        subTitle={walletTranslations.transactionAmountChangedSubtitle}
        buttonText={common.proceed}
        buttonCallback={() => {
          setAmountChangedAlertVisible(false);
        }}
        Content={() => (
          <Box
            marginBottom={hp(15)}
            alignContent="center"
            justifyContent="center"
            justifyItems="center"
            width="100%"
          >
            <AmountChangedWarningIllustration
              style={{ alignSelf: 'center', marginRight: wp(30), marginTop: hp(5) }}
            />
            <Text style={{ marginTop: hp(40) }} fontSize={14}>
              {walletTranslations.transactionAmountChangedExplainer}
            </Text>
          </Box>
        )}
      />
      {/* Fee insight Modal */}
      <KeeperModal
        visible={feeInsightVisible}
        close={toogleFeesInsightModal}
        showCloseIcon={false}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        buttonText={common.proceed}
        buttonCallback={toogleFeesInsightModal}
        Content={() => <FeeInsights />}
      />
      {/* Discard UTXO Modal */}
      <KeeperModal
        showCloseIcon={false}
        visible={discardUTXOVisible}
        close={() => {}}
        dismissible={false}
        title={walletTranslations.discardTnxTitle}
        subTitle={walletTranslations.discardTnxSubTitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        buttonText={common.discard}
        buttonCallback={discardCachedTransaction}
        buttonTextColor={`${colorMode}.buttonText`}
        secondaryButtonText="Cancel"
        secondaryCallback={() => {
          setProgress(false);
          setDiscardUTXOVisible(false);
        }}
        Content={discardUTXOModalContent}
        subTitleWidth={wp(280)}
      />
      <KeeperModal
        visible={validationModal}
        close={() => {
          showValidationModal(false);
          setOtp('');
        }}
        title={common.confirm2FACodeTitle}
        subTitle={common.confirm2FACodeSubtitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={otpContent}
      />
      {visibleCustomPriorityModal && (
        <CustomPriorityModal
          visible={visibleCustomPriorityModal}
          close={() => setVisibleCustomPriorityModal(false)}
          title={vault.CustomPriority}
          secondaryButtonText={common.Goback}
          secondaryCallback={() => setVisibleCustomPriorityModal(false)}
          subTitle={walletTranslations.enterAmonuntInSat}
          network={sender?.networkType || sourceWallet?.networkType}
          recipients={addresses.map((address, index) => ({
            address,
            amount: originalAmounts[index],
          }))}
          sender={sender || sourceWallet}
          selectedUTXOs={selectedUTXOs}
          buttonCallback={(setCustomTxPriority, customFeePerByte) => {
            setVisibleCustomPriorityModal(false);
            if (setCustomTxPriority) {
              setTransactionPriority(TxPriority.CUSTOM);
              setCustomFeePerByte(customFeePerByte);
            } else {
              if (customFeePerByte === '0') {
                setTransPriorityModalVisible(false);
                showToast(errorText.feeRateLessThanOne, <ToastErrorIcon />);
              }
            }
          }}
          existingCustomPriorityFee={customFeePerByte}
          miniscriptSelectedSatisfier={miniscriptSelectedSatisfier}
        />
      )}
    </ScreenWrapper>
  );
}
export default SentryErrorBoundary(SendConfirmation);

const styles = StyleSheet.create({
  horizontalLineStyle: {
    borderBottomWidth: 0.3,
    marginTop: hp(12),
    marginBottom: hp(6),
    opacity: 0.5,
  },
  highFeeNote: {
    fontSize: 13,
    letterSpacing: 0.13,
  },
  container: {
    flex: 1,
    marginHorizontal: wp(0),
    marginTop: hp(5),
  },
  contentContainer: {
    paddingBottom: hp(30),
  },
  imgCtr: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  receiptContainer: {
    paddingTop: hp(30),
    paddingBottom: hp(10),
  },
  totalAmountWrapper: {
    width: '100%',
    gap: 5,
    paddingVertical: hp(22),
    paddingHorizontal: wp(20),
    marginBottom: hp(10),
    marginTop: hp(15),
    borderWidth: 1,
    borderRadius: wp(20),
  },
  otpContainer: {
    width: '100%',
  },
  CVVInputsView: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  currentBtcPrice: {
    marginBottom: hp(5),
  },
});

function updateSatsAmountInMsg(message: string, newAmount) {
  try {
    const satsRegex = /(\d+)\s*sats/i;
    return message.replace(satsRegex, `${newAmount} sats`);
  } catch (error) {
    console.log('🚀 ~ updateSatsAmountInMsg ~ error:', error);
    return message;
  }
}