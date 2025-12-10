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
  TextInput,
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
import Text from 'src/components/KeeperText';
import HexagonIcon from 'src/components/HexagonIcon';
import { EntityKind, MiniscriptTypes, VaultType } from 'src/services/wallets/enums';
import { hp, windowWidth, wp } from 'src/constants/responsive';
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
import useBalance from 'src/hooks/useBalance';
import { SatsToBtc } from 'src/constants/Bitcoin';
import useWallets from 'src/hooks/useWallets';
import useVault from 'src/hooks/useVault';
import Colors from 'src/theme/Colors';
import { formatSatsCompact } from 'src/utils/utilities';
import { loadConciergeUser } from 'src/store/sagaActions/concierge';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import Fonts from 'src/constants/Fonts';

const PRESET = [
  { id: 0, dollars: 10 },
  { id: 1, dollars: 100 },
  { id: 2, dollars: 1000 },
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
  } = useContext(LocalizationContext).translations;
  const [selectedWallet, setSelectedWallet] = useState<Wallet | Vault>(null);
  const isDarkMode = colorMode === 'dark';
  const HexagonIconColor = ThemedColor({ name: 'HexagonIcon' });
  const [amountToSend, setAmountToSend] = useState();
  console.log('🚀 ~ SendTip ~ amountToSend:', amountToSend);
  const sendPhaseOneState = useAppSelector((state) => state.sendAndReceive.sendPhaseOne);
  const [showTimeLockModal, setShowTimeLockModal] = useState(false);
  const [timeUntilTimeLockExpires, setTimeUntilTimeLockExpires] = useState<string | null>(null);
  const [currentBlockHeight, setCurrentBlockHeight] = useState<number | null>(null);
  const [currentMedianTimePast, setCurrentMedianTimePast] = useState<number | null>(null);
  const miniscriptPathSelectorRef = useRef<MiniscriptPathSelectorRef>(null);
  const miniscriptSelectedSatisfierRef = useRef(null);
  const { satsEnabled } = useAppSelector((state) => state.settings);
  const { wallets } = useWallets({});
  const { allVaults } = useVault({ includeArchived: false, getHiddenWallets: false });
  const { getUsdInSats } = useBalance();
  const [msg, setMsg] = useState('Thanks for Bitcoin Keeper.');
  const { conciergeUser, conciergeLoading } = useAppSelector((store) => store.concierge);
  const inputRef = useRef(null);

  const walletBalance = useMemo(() => {
    return (
      selectedWallet?.specs?.balances?.confirmed + selectedWallet?.specs?.balances?.unconfirmed || 0
    );
  }, [selectedWallet]);

  useEffect(() => {
    if (conciergeUser == null) dispatch(loadConciergeUser());
  }, []);

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

  useEffect(() => {
    if (allVaults.length) setSelectedWallet(allVaults[0]);
    else if (wallets.length) setSelectedWallet(wallets[0]);
  }, []);

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
    if (wallet) {
      setSelectedWallet(wallet);
      miniscriptSelectedSatisfierRef.current = null;
    }
  };

  const navigateToNext = () => {
    if (selectedWallet) {
      navigation.dispatch(
        CommonActions.navigate('SendConfirmation', {
          sender: selectedWallet,
          internalRecipients: [null],
          addresses: [tipAddress],
          amounts: [Math.round(getUsdInSats(amountToSend))],
          note: 'Tip to the developer',
          selectedUTXOs: [],
          parentScreen: undefined,
          date: new Date(),
          transactionPriority: 'low',
          customFeePerByte: 0,
          miniscriptSelectedSatisfier: miniscriptSelectedSatisfierRef.current,
          tipMessage: `${msg} \nAmount tipped: ${Math.round(getUsdInSats(amountToSend))} sats`,
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
      amount: Math.round(getUsdInSats(amountToSend)),
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
        <WalletHeader title={settings.sendTipTitle} />

        <ScrollView
          style={styles.scrollViewWrapper}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={isSmallDevice && { paddingBottom: hp(100) }}
        >
          <Box style={styles.container}>
            <Box
              style={styles.subTitle}
              backgroundColor={`${colorMode}.boxSecondaryBackground`}
              borderColor={`${colorMode}.separator`}
            >
              <Text fontSize={14} style={{ textAlign: 'center' }}>
                {settings.sendTipSubTitle}
              </Text>
              <Text
                color={`${colorMode}.primaryText`}
                fontSize={16}
                semiBold
                style={{ textAlign: 'center', marginTop: hp(10), fontFamily: Fonts.InterBold }}
              >
                Spending wallet
              </Text>
            </Box>
            <Box style={styles.sendToWalletContainer}>
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
                        <Text color={`${colorMode}.primaryText`} fontSize={16}>
                          {selectedWallet?.presentationData.name}
                        </Text>
                      </Box>
                      <Text color={`${colorMode}.greenText`} fontSize={16}>
                        Change Wallet
                      </Text>
                    </Box>
                  </Pressable>
                  <Box
                    backgroundColor={`${colorMode}.boxSecondaryBackground`}
                    borderColor={`${colorMode}.dashedButtonBorderColor`}
                    style={{ marginTop: hp(20) }}
                  >
                    <Box style={styles.optionsCtr}>
                      {PRESET.map((item) => (
                        <OptionItem
                          colorMode={colorMode}
                          onPress={(amount) => setAmountToSend(amount)}
                          dollars={item.dollars}
                          key={item.id}
                        />
                      ))}
                    </Box>
                    <Box>
                      <Text
                        fontSize={10}
                        style={{ alignSelf: 'center' }}
                        color={`${colorMode}.secondaryLightGrey`}
                        medium
                      >
                        Enter custom amount
                      </Text>
                      <Pressable
                        style={styles.inputWrapper}
                        onPress={() => inputRef.current.focus()}
                      >
                        <Text fontSize={25} color={`${colorMode}.primaryText`}>
                          $
                        </Text>
                        <TextInput
                          ref={inputRef}
                          placeholder="0"
                          style={{
                            fontSize: 32,
                            fontFamily: Fonts.InterRegular,
                            color: isDarkMode ? Colors.bodyText : Colors.SecondaryBlack,
                          }}
                          placeholderTextColor={
                            isDarkMode ? Colors.bodyText : Colors.SecondaryBlack
                          }
                          value={amountToSend ? amountToSend.toString() : ''}
                          keyboardType="numeric"
                          onChangeText={(text) => {
                            const numericValue = text.replace(/[^0-9/.]/g, '');
                            setAmountToSend(numericValue);
                          }}
                        />
                      </Pressable>
                    </Box>
                    <KeeperTextInput
                      placeholder={'Message to developer'}
                      inpuBackgroundColor={`${colorMode}.textInputBackground`}
                      inpuBorderColor={`${colorMode}.dullGreyBorder`}
                      height={50}
                      value={msg}
                      onChangeText={setMsg}
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
      <ActivityIndicatorView visible={conciergeLoading} />
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
  subTitle: {
    padding: wp(20),
    borderRadius: 12,
    borderWidth: 1.2,
  },
  inputWrapper: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
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
    marginTop: hp(20),
    paddingHorizontal: wp(0),
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
    paddingVertical: wp(10),
    paddingHorizontal: wp(15),
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: hp(3),
    borderRadius: 12,
    borderWidth: 1.2,
    marginBottom: hp(10),
    flex: 1,
  },
  optionsCtr: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    flexWrap: 'wrap',
  },
});

const OptionItem = ({ onPress, dollars, colorMode }) => {
  const isDarkMode = colorMode === 'dark';
  const { getUsdInSats } = useBalance();
  const minWidth = windowWidth / 4;
  return (
    <TouchableOpacity onPress={() => onPress(dollars)}>
      <Box
        style={[styles.optionCTR, { minWidth }]}
        backgroundColor={`${colorMode}.boxSecondaryBackground`}
        borderColor={`${colorMode}.separator`}
      >
        <Box>
          <Text fontSize={12}>{'$' + dollars}</Text>
        </Box>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: wp(2) }}>
          {isDarkMode ? (
            <EquivalentGrey height={10} width={10} />
          ) : (
            <EquivalentGreen height={10} width={10} />
          )}
          <Text color={Colors.secondaryLightGrey} fontSize={wp(11)} medium>
            {formatSatsCompact(getUsdInSats(dollars)) + ' sats'}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};
