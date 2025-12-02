import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import { Box, useColorMode } from 'native-base';
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { useDispatch } from 'react-redux';
import Buttons from 'src/components/Buttons';
import KeeperTextInput from 'src/components/KeeperTextInput';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useIsSmallDevices from 'src/hooks/useSmallDevices';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import { Vault } from 'src/services/wallets/interfaces/vault';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import WalletSmallIcon from 'src/assets/images/daily-wallet-small.svg';
import CollaborativeSmallIcon from 'src/assets/images/collaborative-icon-small.svg';
import VaultSmallIcon from 'src/assets/images/vault-icon-small.svg';
import ArrowIcon from 'src/assets/images/icon_arrow.svg';
import RemoveIcon from 'src/assets/images/remove-green-icon.svg';
import RemoveIconDark from 'src/assets/images/remove-white-icon.svg';
import Text from 'src/components/KeeperText';
import HexagonIcon from 'src/components/HexagonIcon';
import { EntityKind, MiniscriptTypes, VaultType } from 'src/services/wallets/enums';
import { hp, windowHeight, wp } from 'src/constants/responsive';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import { sendPhaseOneReset } from 'src/store/reducers/send_and_receive';
import { sendPhaseOne } from 'src/store/sagaActions/send_and_receive';
import { useAppSelector } from 'src/store/hooks';
import KeeperModal from 'src/components/KeeperModal';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import { isVaultUsingBlockHeightTimelock } from 'src/services/wallets/factories/VaultFactory';
import WalletUtilities from 'src/services/wallets/operations/utils';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import MiniscriptPathSelector, {
  MiniscriptPathSelectorRef,
} from 'src/components/MiniscriptPathSelector';
import config from 'src/utils/service-utilities/config';
import EquivalentGreen from 'src/assets/images/equivalent-green.svg';
import EquivalentGrey from 'src/assets/images/equivalent-grey.svg';
import CurrencyInfo from '../Home/components/CurrencyInfo';
import useBalance from 'src/hooks/useBalance';
import CurrencyKind from 'src/models/enums/CurrencyKind';
import { BtcToSats, SatsToBtc } from 'src/constants/Bitcoin';

const PRESET = [
  { id: 0, amount: 5000 },
  { id: 1, amount: 25000 },
  { id: 2, amount: 100000 },
];

export const SendTip = () => {
  const { tipAddress = config.ADDRESS.settings }: any = useRoute().params;
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { showToast } = useToastMessage();
  const dispatch = useDispatch();
  const isSmallDevice = useIsSmallDevices();
  const {
    common,
    error: errorText,
    vault: vaultTranslation,
    settings,
    home,
  } = useContext(LocalizationContext).translations;
  const [selectedWallet, setSelectedWallet] = useState<Wallet | Vault>(null);
  const isDarkMode = colorMode === 'dark';
  const HexagonIconColor = ThemedColor({ name: 'HexagonIcon' });
  const [amountToSend, setAmountToSend] = useState(null);
  const sendPhaseOneState = useAppSelector((state) => state.sendAndReceive.sendPhaseOne);
  const [showTimeLockModal, setShowTimeLockModal] = useState(false);
  const [timeUntilTimeLockExpires, setTimeUntilTimeLockExpires] = useState<string | null>(null);
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null);
  const [currentMedianTimePast, setCurrentMedianTimePast] = useState<number | null>(null);
  const miniscriptPathSelectorRef = useRef<MiniscriptPathSelectorRef>(null);
  const miniscriptSelectedSatisfierRef = useRef(null);
  const { satsEnabled } = useAppSelector((state) => state.settings);

  const walletBalance = useMemo(() => {
    return (
      selectedWallet?.specs?.balances?.confirmed + selectedWallet?.specs?.balances?.unconfirmed || 0
    );
  }, [selectedWallet]);

  useEffect(() => {
    if (selectedWallet?.type === VaultType.MINISCRIPT) {
      if (isVaultUsingBlockHeightTimelock(selectedWallet)) {
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
    if (selectedWallet?.type !== VaultType.MINISCRIPT) return setTimeUntilTimeLockExpires(null);
    if (
      !selectedWallet.scheme?.miniscriptScheme?.usedMiniscriptTypes?.includes(
        MiniscriptTypes.TIMELOCKED
      ) ||
      (isVaultUsingBlockHeightTimelock(selectedWallet) && currentBlockHeight === null) ||
      (!isVaultUsingBlockHeightTimelock(selectedWallet) && currentMedianTimePast === null)
    )
      return;

    try {
      let secondsUntilActivation = 0;
      if (isVaultUsingBlockHeightTimelock(selectedWallet)) {
        const blocksUntilActivation =
          selectedWallet.scheme?.miniscriptScheme?.miniscriptElements.timelocks[0] -
          currentBlockHeight;
        secondsUntilActivation = blocksUntilActivation * 10 * 60;
      } else {
        secondsUntilActivation =
          selectedWallet.scheme?.miniscriptScheme?.miniscriptElements.timelocks[0] -
          currentMedianTimePast;
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

        setTimeUntilTimeLockExpires(`${timeString}`);
      } else {
        setTimeUntilTimeLockExpires(null);
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
  }, [currentBlockHeight, selectedWallet, showToast]);

  useEffect(() => {
    if (sendPhaseOneState.isSuccessful) {
      if (amountToSend && amountToSend !== 0) {
        navigateToNext();
      } else {
        dispatch(sendPhaseOneReset());
      }
    } else if (sendPhaseOneState.hasFailed) {
      if (sendPhaseOneState.failedErrorMessage === 'Insufficient balance') {
        showToast(errorText.insufficientBalance);
      } else showToast(sendPhaseOneState.failedErrorMessage);
    }
  }, [sendPhaseOneState]);

  const getSmallWalletIcon = (wallet) => {
    if (wallet.entityKind === EntityKind.VAULT) {
      return wallet.type === VaultType.COLLABORATIVE ? (
        <CollaborativeSmallIcon />
      ) : (
        <VaultSmallIcon />
      );
    } else {
      return <WalletSmallIcon />;
    }
  };

  const navigateToSelectWallet = () => {
    navigation.dispatch(
      CommonActions.navigate('SelectWallet', {
        sender: {},
        handleSelectWallet,
        selectedWalletIdFromParams: selectedWallet?.id,
        subTitle: settings.selectTipWalletSubtitle,
      })
    );
  };

  const handleSelectWallet = (wallet) => {
    setSelectedWallet(wallet);
    miniscriptSelectedSatisfierRef.current = null;
  };

  const handleSelectWalletPress = () => {
    if (!selectedWallet) {
      navigation.dispatch(
        CommonActions.navigate({
          name: 'SelectWallet',
          params: {
            sender: {},
            handleSelectWallet,
            subTitle: settings.selectTipWalletSubtitle,
          },
        })
      );
    } else {
      setSelectedWallet(null);
    }
  };

  const navigateToNext = () => {
    if (selectedWallet) {
      const amt = satsEnabled ? amountToSend : BtcToSats(amountToSend);
      navigation.dispatch(
        CommonActions.navigate('SendConfirmation', {
          sender: selectedWallet,
          internalRecipients: [null],
          addresses: [tipAddress],
          amounts: [parseInt(amt)],
          note: 'Tip to developer',
          selectedUTXOs: [],
          parentScreen: undefined,
          date: new Date(),
          transactionPriority: 'low',
          customFeePerByte: 0,
          miniscriptSelectedSatisfier: miniscriptSelectedSatisfierRef.current,
        })
      );
    }
  };

  const executeSendPhaseOne = (miniscriptSelectedSatisfier = null) => {
    miniscriptSelectedSatisfierRef.current = miniscriptSelectedSatisfier;
    dispatch(sendPhaseOneReset());
    if (!amountToSend) {
      showToast(errorText.enterValidAmount);
      return;
    }
    const recipients = [];
    recipients.push({
      address: tipAddress,
      amount: satsEnabled ? amountToSend : BtcToSats(amountToSend),
      name: '',
    });

    dispatch(
      sendPhaseOne({
        wallet: selectedWallet,
        recipients,
        selectedUTXOs: [],
        miniscriptSelectedSatisfier,
      })
    );
  };

  const continueToSend = () => {
    if ((satsEnabled ? walletBalance : SatsToBtc(walletBalance)) < amountToSend) {
      showToast(errorText.insufficientBalance);
      return;
    }
    if (selectedWallet.type == VaultType.MINISCRIPT) miniscriptSend();
    else executeSendPhaseOne();
  };

  const miniscriptSend = async () => {
    if (timeUntilTimeLockExpires) {
      setShowTimeLockModal(true);
      return;
    }
    if (selectedWallet.type === VaultType.MINISCRIPT) {
      try {
        await selectVaultSpendingPaths();
      } catch (err) {
        showToast(typeof err === 'string' ? err : err?.message, <ToastErrorIcon />);
        return null;
      }
    }
  };

  const selectVaultSpendingPaths = async () => {
    if (miniscriptPathSelectorRef.current) {
      await miniscriptPathSelectorRef.current.selectVaultSpendingPaths();
    }
  };

  const showTimeLockModalContent = useCallback(() => {
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
          <Text fontSize={13}>{timeUntilTimeLockExpires}</Text>
        </Box>
        <Box style={styles.buttonContainer}>
          <Buttons
            primaryCallback={() => {
              setShowTimeLockModal(false);
            }}
            fullWidth
            primaryText={common.continue}
          />
        </Box>
      </Box>
    );
  }, [timeUntilTimeLockExpires]);

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : null}
        enabled
        keyboardVerticalOffset={Platform.select({ ios: 8, android: 500 })}
        style={styles.scrollViewWrapper}
      >
        <WalletHeader title={settings.sendTipTitle} subTitle={settings.sendTipSubTitle} />

        <ScrollView
          style={styles.scrollViewWrapper}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={isSmallDevice && { paddingBottom: hp(100) }}
        >
          <Box style={styles.container}>
            <Box style={styles.sendToWalletContainer}>
              <Pressable onPress={handleSelectWalletPress}>
                <Box
                  flexDirection="row"
                  justifyContent="space-between"
                  alignItems="center"
                  style={styles.sendToWalletWrapper}
                >
                  <Text color={`${colorMode}.primaryText`}>Select spending wallet</Text>
                  {!selectedWallet ? (
                    <ArrowIcon opacity={1} />
                  ) : isDarkMode ? (
                    <RemoveIconDark />
                  ) : (
                    <RemoveIcon />
                  )}
                </Box>
              </Pressable>
              {selectedWallet && (
                <>
                  <Pressable onPress={navigateToSelectWallet}>
                    <Box
                      flexDirection="row"
                      justifyContent="space-between"
                      alignItems="center"
                      style={styles.sendToWalletWrapper}
                    >
                      <Box style={styles.walletDetails}>
                        <Box>
                          <HexagonIcon
                            width={29}
                            height={26}
                            icon={getSmallWalletIcon(selectedWallet)}
                            backgroundColor={HexagonIconColor}
                          />
                        </Box>
                        <Text color={`${colorMode}.primaryText`}>
                          {selectedWallet?.presentationData.name}
                        </Text>
                      </Box>
                      <Text color={`${colorMode}.greenText`}>Change Wallet</Text>
                    </Box>
                  </Pressable>
                  <Box
                    backgroundColor={`${colorMode}.boxSecondaryBackground`}
                    borderColor={`${colorMode}.dashedButtonBorderColor`}
                    style={{ marginTop: hp(20) }}
                  >
                    {PRESET.map((item) => (
                      <OptionItem
                        colorMode={colorMode}
                        onPress={(amount) => setAmountToSend(amount)}
                        amount={item.amount}
                        key={item.id}
                      />
                    ))}
                    <KeeperTextInput
                      placeholder={home.AddAmount}
                      inpuBackgroundColor={`${colorMode}.textInputBackground`}
                      inpuBorderColor={`${colorMode}.dullGreyBorder`}
                      height={50}
                      value={amountToSend?.toString()}
                      keyboardType="numeric"
                      onChangeText={(text) => {
                        const numericValue = text.replace(/[^0-9/.]/g, '');
                        setAmountToSend(numericValue);
                      }}
                      blurOnSubmit={true}
                      paddingLeft={5}
                    />
                  </Box>
                </>
              )}
            </Box>
          </Box>
        </ScrollView>
      </KeyboardAvoidingView>

      <Box backgroundColor={`${colorMode}.primaryBackground`}>
        <Buttons
          primaryCallback={continueToSend}
          primaryText={common.proceed}
          primaryDisable={!selectedWallet || !amountToSend}
          fullWidth
        />
      </Box>
      <KeeperModal
        visible={showTimeLockModal}
        close={() => {
          setShowTimeLockModal(false);
          setSelectedWallet(null);
        }}
        title={common.vaultTimelockActive}
        subTitle={common.vaultTimelockActiveDesc}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={showTimeLockModalContent}
      />
      {selectedWallet?.type == VaultType.MINISCRIPT && (
        <MiniscriptPathSelector
          ref={miniscriptPathSelectorRef}
          vault={selectedWallet}
          onPathSelected={executeSendPhaseOne}
          onError={(err) => showToast(err, <ToastErrorIcon />)}
          onCancel={() => {}}
        />
      )}
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: hp(30),
  },
  scrollViewWrapper: {
    flex: 1,
  },
  inputWrapper: {
    alignSelf: 'center',
    width: '100%',
    paddingLeft: wp(11),
    paddingRight: wp(21),
  },
  walletContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: hp(70),
    width: '95%',
    borderRadius: hp(10),
    marginHorizontal: wp(10),
    paddingHorizontal: wp(25),
    marginTop: hp(5),
  },
  sendToWalletWrapper: {
    marginTop: windowHeight > 680 ? hp(10) : hp(10),
  },
  walletDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sendToWalletContainer: {
    gap: 10,
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
  optionCTR: {
    flexDirection: 'row',
    paddingVertical: wp(10),
    paddingHorizontal: wp(15),
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: wp(16),
    borderRadius: 12,
    borderWidth: 1.2,
    marginBottom: hp(10),
  },
});

const OptionItem = ({ onPress, amount, colorMode }) => {
  const isDarkMode = colorMode === 'dark';
  const { getFiatCurrencyIcon, getCustomConvertedBalance } = useBalance();
  const { satsEnabled } = useAppSelector((state) => state.settings);
  return (
    <TouchableOpacity onPress={() => onPress(satsEnabled ? amount : SatsToBtc(amount))}>
      <Box
        style={styles.optionCTR}
        backgroundColor={`${colorMode}.boxSecondaryBackground`}
        borderColor={`${colorMode}.separator`}
      >
        <CurrencyInfo
          hideAmounts={false}
          amount={amount}
          fontSize={14}
          satsFontSize={14}
          color={`${colorMode}.black`}
          variation={!isDarkMode ? 'dark' : 'light'}
        />
        <Box style={{ flexDirection: 'row', alignItems: 'center' }}>
          {isDarkMode ? <EquivalentGrey /> : <EquivalentGreen />}
          <Box marginLeft={1}>{getFiatCurrencyIcon('light')}</Box>
          <Text color={`${colorMode}.secondaryText`} fontSize={14} medium>
            {getCustomConvertedBalance(
              satsEnabled ? amount : SatsToBtc(amount),
              CurrencyKind.BITCOIN,
              CurrencyKind.FIAT
            )}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};
