import { Platform, StyleSheet } from 'react-native';
import { Box, useColorMode } from 'native-base';
import { CommonActions } from '@react-navigation/native';
import { SatochipCard } from 'satochip-react-native';
import { handleSatochipError, resetSeed } from 'src/hardware/satochip';
import Buttons from 'src/components/Buttons';
import NFC from 'src/services/nfc';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import React, { useContext, useEffect, useState } from 'react';
import useSatochipModal from 'src/hooks/useSatochipModal';
import ScreenWrapper from 'src/components/ScreenWrapper';
import Text from 'src/components/KeeperText';
import KeeperModal from 'src/components/KeeperModal';
import SatochipSetupImage from 'src/assets/images/SatochipSetup.svg';
import SuccessIllustration from 'src/assets/images/illustration.svg';
import { hp, wp } from 'src/constants/responsive';
import WalletHeader from 'src/components/WalletHeader';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import AlertIllustration from "../../assets/images/alert_illustration.svg";

function ResetSatochipSeed({ route, navigation }) {
  const { colorMode } = useColorMode();
  const card = React.useRef(new SatochipCard()).current;
  const { withModal, nfcVisible, closeNfc } = useSatochipModal(card);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [ctaDisabled, setCtaDisabled] = useState(true);
  const { translations } = useContext(LocalizationContext);
  const {
    satochip: satochipTranslation,
    signer: signerTranslation,
    common,
  } = translations;

  const { pin } = route.params || {};

  const handleCancel = () => {
    navigation.goBack();
  };

  const activateSeedResetAction = React.useCallback(async () => {
    try {
      await withModal(async () => resetSeed(card, pin))();
      setSuccess(true);
      if (Platform.OS === 'ios') NFC.showiOSMessage(satochipTranslation.satochipSeedResetSuccess);
    } catch (error) {
      setSuccess(false);
      const errorMessage = handleSatochipError(error, navigation);
      if (errorMessage) {
        setErrorMsg(errorMessage);
      }
    } finally {
      setShowResultModal(true);
      closeNfc();
      card.endNfcSession();
    }
  }, [pin]);

  function confirmationContent() {
    return (
      <>
        <Box style={styles.modalIllustration}>
          <SatochipSetupImage />
        </Box>
        <Box style={styles.modalTextCtr}>
          <Box style={styles.dot} backgroundColor={`${colorMode}.primaryText`} />
          <Text color={`${colorMode}.alertRed`} style={styles.modalText}>
            {satochipTranslation.clickToContinueReset}
          </Text>
        </Box>
      </>
    );
  }

  function ResultContent() {
    if (success) {
      return (
        <Box style={styles.modalIllustration}>
          <SuccessIllustration/>
        </Box>
      );
    } else {
      return (
        <Box style={styles.modalIllustration}>
          <AlertIllustration/>
        </Box>
      );
    }
  }

  useEffect(() => {
    setCtaDisabled(
      !(
        pin?.length > 3 &&
        pin?.length <= 16
      )
    );
  }, [pin]);

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={satochipTranslation.resetSeed}
        subTitle={satochipTranslation.resetSeedWarning}
        onPressHandler={handleCancel}
      />

      <Box style={styles.ctaContainer}>
        <Buttons
          primaryText={common.continue}
          primaryCallback={() => setShowPinModal(true)}
          primaryDisable={ctaDisabled}
          fullWidth
        />
      </Box>

      <KeeperModal
        visible={showPinModal}
        close={() => setShowPinModal(false)}
        showCloseIcon={false}
        title={signerTranslation.resetSeed}
        subTitle={satochipTranslation.SetupDescription}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.continue}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => {
          setShowPinModal(false);
          handleCancel();
        }}
        buttonCallback={() => {
          setShowPinModal(false);
          activateSeedResetAction();
        }}
        Content={confirmationContent}
      />

      {/* result dialog */}
      <KeeperModal
        visible={showResultModal} // TODO: update translation + activate on success/fail?
        close={() => setShowResultModal(false)}
        showCloseIcon={false}
        title={success? satochipTranslation.satochipSeedResetTitle : satochipTranslation.satochipSeedResetFail}
        subTitle={success ? satochipTranslation.satochipSeedResetSuccess : errorMsg}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.Okay}
        buttonCallback={() => {
          setShowResultModal(false);
          navigation.dispatch(CommonActions.goBack());
        }}
        Content={ResultContent}
      />
      <NfcPrompt visible={nfcVisible} close={closeNfc} />
    </ScreenWrapper>
  );
}

export default ResetSatochipSeed;

const styles = StyleSheet.create({
  btnContainer: {
    marginHorizontal: 15,
    marginTop: 6,
  },
  modalIllustration: {
    alignSelf: 'center',
    marginBottom: hp(20),
    marginRight: wp(40),
  },
  modalTextCtr: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 12,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 5 / 2,
    alignSelf: 'center',
  },
  modalText: {
    fontSize: 13,
    padding: 1,
    letterSpacing: 0.65,
  },
  ctaContainer: {
    marginHorizontal: 15,
    marginTop: '3%',
  },
});
