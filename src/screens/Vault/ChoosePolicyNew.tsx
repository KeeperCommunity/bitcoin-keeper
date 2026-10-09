import Text from 'src/components/KeeperText';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { StyleSheet, TouchableOpacity } from 'react-native';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  DelayedPolicyUpdate,
  SignerPolicy,
  SignerRestriction,
  VerificationType,
} from 'src/models/interfaces/AssistedKeys';
import { hp, windowHeight, wp } from 'src/constants/responsive';
import Buttons from 'src/components/Buttons';
import { CommonActions } from '@react-navigation/native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useDispatch, useSelector } from 'react-redux';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import KeeperModal from 'src/components/KeeperModal';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import CVVInputsView from 'src/components/HealthCheck/CVVInputsView';
import useToastMessage from 'src/hooks/useToastMessage';
import DeleteIcon from 'src/assets/images/deleteBlack.svg';
import { useAppSelector } from 'src/store/hooks';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { setSignerPolicyError } from 'src/store/reducers/wallets';
import WalletHeader from 'src/components/WalletHeader';
import { updateSignerPolicy } from 'src/store/sagaActions/wallets';
import { fetchDelayedPolicyUpdate } from 'src/store/sagaActions/storage';
import { NetworkType } from 'src/services/wallets/enums';
import { formatRemainingTime } from 'src/utils/utilities';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import {
  MONTHS_3,
  MONTHS_6,
  MONTHS_12,
  MONTH_1,
  WEEK_1,
  WEEKS_2,
  DAY_1,
  DAY_3,
  DAY_5,
  OFF,
} from './constants';
import ServerKeyPolicyCard from './components/ServerKeyPolicyCard';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';

function ChoosePolicyNew({ navigation, route }) {
  const selectedAppId = useAppSelector((state) => state.storage.appId);
  const originAppId = useRef(selectedAppId).current;
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const { signingServer, common, error: errorText } = translations;
  const [validationModal, showValidationModal] = useState(false);
  const [otp, setOtp] = useState('');
  const needHelpModalBackground = ThemedColor({ name: 'needHelpModalBackground' });
  const { maxTransaction, timelimit, delayTime, addSignerFlow } = route.params;

  const [spendingLimit, setSpendingLimit] = useState(null);
  const [timeLimit, setTimeLimit] = useState(null);
  const [signingDelay, setSigningDelay] = useState(null);
  const [signer, setSigner] = useState(route?.params?.signer);
  const [delayModal, setDelayModal] = useState(false);
  const [configureSuccessModal, setConfigureSuccessModal] = useState(false);
  const [policyDelayedUntil, setPolicyDelayedUntil] = useState(null);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const [needHelpModal, setNeedHelpModal] = useState(false);

  useEffect(() => {
    if (maxTransaction !== undefined) {
      setSpendingLimit(maxTransaction);
      setTimeLimit(timelimit);
    }
    if (delayTime !== undefined) {
      setSigningDelay(delayTime);
    }
  }, [route.params]);
  const isMainNet = bitcoinNetworkType === NetworkType.MAINNET;

  const MAINNET_SERVER_POLICY_DURATIONS = [
    { label: OFF, value: 0 },
    { label: DAY_1, value: 1 * 24 * 60 * 60 * 1000 },
    { label: DAY_3, value: 3 * 24 * 60 * 60 * 1000 },
    { label: DAY_5, value: 5 * 24 * 60 * 60 * 1000 },
    { label: WEEK_1, value: 7 * 24 * 60 * 60 * 1000 },
    { label: WEEKS_2, value: 14 * 24 * 60 * 60 * 1000 },
    { label: MONTH_1, value: 30 * 24 * 60 * 60 * 1000 },
    { label: MONTHS_3, value: 3 * 30 * 24 * 60 * 60 * 1000 },
    { label: MONTHS_6, value: 6 * 30 * 24 * 60 * 60 * 1000 },
    { label: MONTHS_12, value: 12 * 30 * 24 * 60 * 60 * 1000 },
  ];

  const TESTNET_SERVER_POLICY_DURATIONS = [
    { label: OFF, value: 0 },
    { label: DAY_1, value: 5 * 60 * 1000 }, // 5 minutes
    { label: DAY_3, value: 10 * 60 * 1000 }, // 10 minutes
    { label: DAY_5, value: 15 * 60 * 1000 }, // 15 minutes
    { label: WEEK_1, value: 30 * 60 * 1000 }, // 30 minutes
    { label: WEEKS_2, value: 1 * 60 * 1000 }, //  1 hour
    { label: MONTH_1, value: 2 * 60 * 1000 }, //  2 hours
    { label: MONTHS_3, value: 3 * 60 * 60 * 1000 }, //  3 hours
    { label: MONTHS_6, value: 4 * 60 * 60 * 1000 }, //  4 hours
    { label: MONTHS_12, value: 5 * 60 * 60 * 1000 }, //  5 hours
  ];

  const SERVER_POLICY_DURATIONS = isMainNet
    ? MAINNET_SERVER_POLICY_DURATIONS
    : TESTNET_SERVER_POLICY_DURATIONS;

  useEffect(() => {
    if (signer && signer.signerPolicy) {
      setSpendingLimit(`${signer.signerPolicy?.restrictions?.maxTransactionAmount}`);
      const matchedTimeLimit = SERVER_POLICY_DURATIONS.find(
        (option) => option.value === signer.signerPolicy?.restrictions?.timeWindow
      );
      setTimeLimit(matchedTimeLimit);
      const matchedSigningDelay = SERVER_POLICY_DURATIONS.find(
        (option) => option.value === signer.signerPolicy?.signingDelay
      );
      setSigningDelay(matchedSigningDelay);
    }
  }, [signer]);

  const dispatch = useDispatch();
  const policyError = useAppSelector((state) => state.wallet?.signerPolicyError);
  const delayedPolicyUpdate = useAppSelector((state) => state.storage.delayedPolicyUpdate);

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // check for delayed policy updates
    if (delayedPolicyUpdate && Object.keys(delayedPolicyUpdate).length > 0) {
      dispatch(fetchDelayedPolicyUpdate());
    }
  }, []);

  useEffect(() => {
    if (delayedPolicyUpdate && Object.keys(delayedPolicyUpdate).length > 0) {
      const [delayedPolicy] = Object.values(delayedPolicyUpdate) as DelayedPolicyUpdate[];

      const cronBuffer = 30 * 60 * 1000; // 30 minutes additional buffer(cron runs every 30 minutes)
      setPolicyDelayedUntil(delayedPolicy.delayUntil + cronBuffer);
    }
  }, [delayedPolicyUpdate]);

  const parseAmount = (amountString: string): number => Number(amountString.replace(/,/g, ''));

  const preparePolicy = () => {
    const maxAmount = spendingLimit ? parseAmount(spendingLimit) : 0;
    const restrictions: SignerRestriction = {
      none: maxAmount === 0,
      maxTransactionAmount: maxAmount === 0 ? null : maxAmount,
      timeWindow: maxAmount === 0 ? null : timeLimit?.value,
    };

    const policy: SignerPolicy = {
      verification: {
        method: VerificationType.TWO_FA,
      },
      restrictions,
      signingDelay: signingDelay?.value || null,
    };

    return policy;
  };

  const onConfirm = () => {
    if (signer) {
      // case: policy update
      if (delayedPolicyUpdate && Object.keys(delayedPolicyUpdate).length > 0) {
        showToast(errorText.waitForPolicyUpdate);
        return;
      }

      showValidationModal(true);
    } else {
      // case: new signer policy registration
      const policy = preparePolicy();
      navigation.dispatch(
        CommonActions.navigate({ name: 'SetupSigningServer', params: { policy, addSignerFlow } })
      );
    }
  };

  const onConfirmUpdatePolicy = () => {
    const verificationToken = Number(otp);
    setIsLoading(true);
    const newPolicy = preparePolicy();
    const policyUpdates: {
      restrictions: SignerRestriction;
      signingDelay: number;
    } = {
      restrictions: newPolicy.restrictions,
      signingDelay: newPolicy.signingDelay,
    };
    dispatch(updateSignerPolicy(signer, route.params.vaultKey, policyUpdates, verificationToken, originAppId));
  };

  useEffect(() => {
    if (validationModal) {
      if (policyError !== 'failure' && policyError !== 'idle') {
        setIsLoading(false);

        if (delayedPolicyUpdate && Object.keys(delayedPolicyUpdate).length > 0) {
          // less restrictive policy update - delayed
          setTimeout(() => {
            setDelayModal(true);
            dispatch(setSignerPolicyError('idle'));
            showValidationModal(false);
            setOtp('');
          }, 100);
        } else {
          // more restrictive policy update - immediate
          setTimeout(() => {
            setConfigureSuccessModal(true);
            dispatch(setSignerPolicyError('idle'));
            showValidationModal(false);
            setOtp('');
          }, 100);
        }
      } else {
        setTimeout(() => {
          setIsLoading(false);
          dispatch(setSignerPolicyError('idle'));
          showValidationModal(false);
          setOtp('');
          if (policyError !== 'idle') {
            showToast(errorText.verificationFailed2fa, <ToastErrorIcon />);
          }
        }, 100);
      }
    }
  }, [policyError]);

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
      <Box width="100%">
        <Box>
          <TouchableOpacity
            onPress={async () => {
              const clipBoardData = await Clipboard.getString();
              if (clipBoardData.match(/^\d{6}$/)) {
                setOtp(clipBoardData);
              } else {
                showToast(errorText.invalidOtpshort);
                setOtp('');
              }
            }}
          >
            <CVVInputsView
              passCode={otp}
              passcodeFlag={false}
              backgroundColor
              textColor
              height={hp(46)}
              width={hp(46)}
              marginTop={hp(0)}
              marginBottom={hp(20)}
              inputGap={2}
              customStyle={styles.CVVInputsView}
            />
          </TouchableOpacity>
        </Box>
        <KeyPadView
          onPressNumber={onPressNumber}
          onDeletePressed={onDeletePressed}
          keyColor={`${colorMode}.primaryText`}
          ClearIcon={<DeleteIcon />}
        />
        <Box mt={5} alignSelf="flex-end">
          <Box>
            <Buttons
              primaryCallback={() => {
                onConfirmUpdatePolicy();
              }}
              fullWidth
              primaryText={common.confirm}
              primaryDisable={otp.length !== 6}
            />
          </Box>
        </Box>
      </Box>
    );
  }, [otp]);

  const showDelayModal = useCallback(() => {
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
          <Text fontSize={13}>{formatRemainingTime(policyDelayedUntil - Date.now())}</Text>
        </Box>
        <Box style={styles.buttonContainer}>
          <Buttons
            primaryCallback={() => {
              setDelayModal(false);
            }}
            fullWidth
            primaryText={common.continue}
          />
        </Box>
      </Box>
    );
  }, [policyDelayedUntil]);
  const showConfirmationModal = useCallback(() => {
    return (
      <Box style={styles.delayModalContainer}>
        <Box style={styles.iconContainer}>
          <ThemedSvg name={'DelaycompleteIcon'} />
        </Box>

        <Box style={styles.buttonContainer}>
          <Buttons
            primaryCallback={() => {
              setConfigureSuccessModal(false);
            }}
            fullWidth
            primaryText={common.finish}
          />
        </Box>
      </Box>
    );
  }, []);
  // const resetFields = () => {
  //   setMaxTransaction(
  //     existingMaxTransactionRestriction ? `${existingMaxTransactionRestriction}` : '10000000'
  //   );
  //   setMinTransaction(
  //     existingMaxTransactionException ? `${existingMaxTransactionException}` : '1000000'
  //   );
  //   setOtp('');
  // };

  function modalContent() {
    return (
      <Box>
        <Box style={styles.illustration}>
          <ThemedSvg name={'UpdatePolicyIllustration'} />
        </Box>
        <Text style={styles.modalDesc}>{signingServer.UpdatePolicyInfoModalContent}</Text>
      </Box>
    );
  }

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <ActivityIndicatorView visible={isLoading} />
      <WalletHeader
        title={signingServer.choosePolicy}
        rightComponent={
          <TouchableOpacity onPress={() => setNeedHelpModal(true)}>
            <ThemedSvg name={'info_icon'} />
          </TouchableOpacity>
        }
      />
      <Text style={styles.desc}>{signingServer.choosePolicySubTitle}</Text>
      <Box style={styles.fieldContainer}>
        <ServerKeyPolicyCard
          signingServer={signingServer}
          navigation={navigation}
          maxTransaction={spendingLimit}
          timelimit={timeLimit}
          delayTime={signingDelay}
          addSignerFlow={addSignerFlow}
        />
      </Box>

      <Box style={styles.btnWrapper}>
        {delayedPolicyUpdate && Object.keys(delayedPolicyUpdate).length > 0 ? (
          <Box
            style={styles.timeContainerBtn}
            backgroundColor={
              isDarkMode ? `${colorMode}.textInputBackground` : `${colorMode}.secondaryCreamWhite`
            }
            borderColor={
              isDarkMode ? `${colorMode}.primaryBackground` : `${colorMode}.BrownNeedHelp`
            }
          >
            <Text fontSize={13}>{common.RemainingTime}:</Text>
            <Text fontSize={13}>{formatRemainingTime(policyDelayedUntil - Date.now())}</Text>
          </Box>
        ) : (
          <Buttons primaryText={common.confirm} primaryCallback={() => onConfirm()} fullWidth />
        )}
      </Box>
      <KeeperModal
        visible={validationModal}
        close={() => {
          showValidationModal(false);
          setOtp('');
          // resetFields();
        }}
        title={common.confirm2FACodeTitle}
        subTitle={common.confirm2FACodeSubtitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={otpContent}
      />
      <KeeperModal
        visible={delayModal}
        close={() => {
          setDelayModal(false);
        }}
        title={common.configurationSettingDelay}
        subTitle={common.configurationSettingDelaySub}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={showDelayModal}
      />
      <KeeperModal
        visible={configureSuccessModal}
        close={() => {
          setConfigureSuccessModal(false);
        }}
        title={common.configurationSettingDelay}
        subTitle={common.configurationSettingSub}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={showConfirmationModal}
      />
      <KeeperModal
        visible={needHelpModal}
        close={() => setNeedHelpModal(false)}
        title={signingServer.UpdatePolicyInfoModalTitle}
        subTitle={signingServer.UpdatePolicyInfoModalSubTitle}
        modalBackground={needHelpModalBackground}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={modalContent}
        subTitleWidth={wp(280)}
        DarkCloseIcon
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  btnWrapper: {
    paddingTop: hp(windowHeight > 700 ? 18 : 0),
    paddingHorizontal: '3%',
    paddingBottom: hp(20),
  },
  cvvInputInfoText: {
    fontSize: 14,
    width: '100%',
    marginTop: 2,
  },
  fieldContainer: {
    paddingVertical: wp(10),
    flex: 1,
  },
  desc: {
    marginVertical: hp(15),
  },
  CVVInputsView: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  delayModalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  iconContainer: {
    marginVertical: hp(12),
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
  timeContainerBtn: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: wp(15),
    paddingVertical: hp(21),
    borderRadius: 10,
    borderWidth: 1,
  },
  modalDesc: {
    fontSize: 14,
    padding: 1,
    marginBottom: 15,
    width: wp(295),
  },
  illustration: {
    marginTop: 20,
    alignSelf: 'center',
    marginBottom: 40,
  },
});

export default ChoosePolicyNew;
