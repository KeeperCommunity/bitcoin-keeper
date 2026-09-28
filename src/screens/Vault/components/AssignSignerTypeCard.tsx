import React, { useCallback, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { SignerType, XpubTypes } from 'src/services/wallets/enums';
import { Signer, Vault } from 'src/services/wallets/interfaces/vault';
import { hp, windowHeight, windowWidth, wp } from 'src/constants/responsive';
import RightArrow from 'src/assets/images/icon_arrow.svg';
import RightArrowWhite from 'src/assets/images/icon_arrow_white.svg';
import { useDispatch } from 'react-redux';
import { updateSignerDetails } from 'src/store/sagaActions/wallets';
import KeeperModal from 'src/components/KeeperModal';
import { getSignerNameFromType } from 'src/hardware';
import Clipboard from '@react-native-clipboard/clipboard';
import CVVInputsView from 'src/components/HealthCheck/CVVInputsView';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import Buttons from 'src/components/Buttons';
import useToastMessage from 'src/hooks/useToastMessage';
import { translations } from 'src/context/Localization/LocContext';
import SigningServer from 'src/services/backend/SigningServer';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { getKeyUID } from 'src/utils/utilities';
import { useNavigation } from '@react-navigation/native';
import { SDIcons } from '../SigningDeviceIcons';
import WalletUtilities from 'src/services/wallets/operations/utils';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import OneKeyBleModal from 'src/components/OneKeyBleModal';
import { getDeviceTypeName } from 'src/services/onekeyBle/deviceConstants';
import type { SearchDevice } from '@onekeyfe/hd-core';
import type { OneKeyDeviceInfo } from 'src/services/onekeyBle';

type AssignSignerTypeCardProps = {
  type: SignerType;
  disabled: boolean;
  first?: boolean;
  last?: boolean;
  vault: Vault;
  primaryMnemonic: string;
  signer?: Signer;
  isImportFlow?: boolean;
  onTypeSelection?: (type: SignerType, signerUpdates?: Partial<Signer>) => void;
};

function AssignSignerTypeCard({
  type,
  disabled,
  first = false,
  last = false,
  signer,
  vault,
  isImportFlow,
  onTypeSelection,
}: AssignSignerTypeCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [validationModal, showValidationModal] = useState(false);
  const [oneKeyIdentifyVisible, setOneKeyIdentifyVisible] = useState(false);
  const [otp, setOtp] = useState('');
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();
  const { common, vault: vaultText, error: errorText } = translations;
  const navigation = useNavigation();

  const persistSignerType = (signerType: SignerType, signerUpdates: Partial<Signer> = {}) => {
    const signerName =
      signerUpdates.signerName || getSignerNameFromType(signerType, signer?.isMock);

    if (isImportFlow) {
      navigation.goBack();
      onTypeSelection(signerType, { ...signerUpdates, signerName });
    } else {
      dispatch(updateSignerDetails(signer, 'type', signerType));
      dispatch(updateSignerDetails(signer, 'signerName', signerName));
      Object.entries(signerUpdates).forEach(([key, value]) => {
        if (key !== 'signerName') dispatch(updateSignerDetails(signer, key, value));
      });
    }
  };

  const changeSignerType = () => {
    setShowConfirm(false);
    if (type === SignerType.POLICY_SERVER) {
      showValidationModal(true);
    } else if (type === SignerType.ONEKEY) {
      setOneKeyIdentifyVisible(true);
    } else {
      persistSignerType(type);
    }
  };

  const onOneKeyIdentified = ({
    device,
    deviceInfo,
  }: {
    device: SearchDevice;
    deviceInfo: OneKeyDeviceInfo;
  }) => {
    const bleName = device?.name;
    const signerUpdates: Partial<Signer> = {
      signerName: getDeviceTypeName(device),
      extraData: { ...signer?.extraData, bleConnectId: deviceInfo.connectId },
    };

    if (bleName && bleName !== 'Unknown') {
      signerUpdates.signerDescription = bleName;
    }

    persistSignerType(SignerType.ONEKEY, signerUpdates);
  };

  const validateServerKey = async () => {
    const verificationToken = Number(otp);
    let signerId;
    for (const { masterFingerprint, xfp } of vault.signers) {
      if (masterFingerprint === signer.masterFingerprint) {
        signerId = xfp;
        break;
      }
    }

    if (!signerId) {
      showToast(vaultText.unableToFindServerKeyId);
      return;
    }

    try {
      // for (const { masterFingerprint, xfp } of vault.signers) {
      //   if (masterFingerprint === signer.masterFingerprint) {
      //     signerId = xfp;
      //     break;
      //   }
      // } // Note: vault object can be undefined for certain flows, ex: Keys flow

      const signerId = WalletUtilities.getFingerprintFromExtendedKey(
        signer.signerXpubs[XpubTypes.P2WSH][0].xpub,
        WalletUtilities.getNetworkByType(signer.networkType)
      );

      if (!signerId) {
        showToast('Unable to find server key instance id', <ToastErrorIcon />);
        return;
      }

      const { valid, id, masterFingerprint, policy, linkedViaSecondary } =
        await SigningServer.fetchSignerSetup(signerId, verificationToken);

      if (valid) {
        if (id === signerId && masterFingerprint === signer.masterFingerprint) {
          const signerKeyUID = getKeyUID(signer);
          dbManager.updateObjectByQuery(
            RealmSchema.Signer,
            (realmSigner) => getKeyUID(realmSigner) === signerKeyUID,
            {
              type,
              isExternal: true,
              linkedViaSecondary,
              signerPolicy: policy,
              signerName: vaultText.externalServerKey,
            }
          );
          showToast('Server Key successfully assigned', <TickIcon />);
          setTimeout(() => {
            navigation.goBack();
          }, 1000);
        } else throw new Error('Server Key mismatch');
      } else throw new Error('Server Key validation failed');
    } catch (err) {
      showToast(err?.message || vaultText.serverKayValidationFailed);
    }

    setOtp('');
    showValidationModal(false);
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
                showToast(errorText.invalidOtpshort);
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
              primaryCallback={validateServerKey}
              fullWidth
              primaryText={common.confirm}
              primaryDisable={otp.length !== 6}
            />
          </Box>
        </Box>
      </Box>
    );
  }, [otp]);

  return (
    <>
      <TouchableOpacity
        disabled={disabled}
        activeOpacity={0.7}
        onPress={() => setShowConfirm(true)}
        testID={`btn_identify_${type}`}
      >
        <Box
          backgroundColor={`${colorMode}.textInputBackground`}
          borderTopRadius={first ? 10 : 0}
          borderBottomRadius={last ? 10 : 0}
          borderWidth={isDarkMode ? 1 : 0}
          borderTopWidth={first && isDarkMode ? 1 : 0}
          borderBottomWidth={isDarkMode || !last ? 1 : 0}
          borderColor={`${colorMode}.dullGreyBorder`}
          style={[styles.container]}
        >
          <Box
            style={[
              styles.walletMapContainer,
              {
                opacity: disabled ? 0.4 : 1,
              },
            ]}
          >
            <Box style={styles.walletMapWrapper}>
              {SDIcons({ type, light: colorMode === 'dark' }).Icon}
            </Box>
            <Box backgroundColor={`${colorMode}.dullGreyBorder`} style={styles.divider} />
            <Box style={styles.walletMapLogoWrapper}>{SDIcons({ type }).Logo}</Box>
            <Box style={styles.arrowIconWrapper}>
              {isDarkMode ? <RightArrowWhite /> : <RightArrow />}
            </Box>
          </Box>
        </Box>
      </TouchableOpacity>

      <KeeperModal
        visible={showConfirm}
        close={() => setShowConfirm(false)}
        title={vaultText.changeDeviceType}
        subTitle={`${vaultText.sureWantTOChangeDeviceType} ${getSignerNameFromType(type)}?`}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.continue}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => setShowConfirm(false)}
        buttonCallback={changeSignerType}
        Content={() => (
          <Box style={styles.illustrationContainer}>
            <ThemedSvg name={'change_device_type_illustration'} />
          </Box>
        )}
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

      <OneKeyBleModal
        visible={oneKeyIdentifyVisible}
        close={() => setOneKeyIdentifyVisible(false)}
        mode="identify"
        signer={signer}
        onDeviceIdentified={onOneKeyIdentified}
      />
    </>
  );
}

const styles = StyleSheet.create({
  walletMapContainer: {
    alignItems: 'center',
    minHeight: windowHeight * 0.075,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  walletMapWrapper: {
    marginRight: wp(13.2),
    alignItems: 'center',
  },
  walletMapLogoWrapper: {
    marginLeft: wp(20),
    justifyContent: 'flex-end',
    marginVertical: hp(20),
    width: windowWidth * 0.53,
  },
  divider: {
    height: hp(25),
    width: 1,
  },
  container: {
    alignItems: 'center',
  },
  arrowIconWrapper: {
    marginLeft: wp(10),
    justifyContent: 'center',
    alignItems: 'center',
  },
  warningIllustration: {
    alignSelf: 'center',
    marginBottom: hp(20),
    marginRight: wp(40),
  },
  warningText: {
    fontSize: 14,
    padding: 1,
    letterSpacing: 0.65,
  },
  illustrationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpContainer: {
    width: '100%',
  },
  CVVInputsView: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default AssignSignerTypeCard;
