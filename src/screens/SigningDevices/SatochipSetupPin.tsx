import { Platform, StyleSheet } from 'react-native';
import { Box, useColorMode } from 'native-base';
import { CommonActions } from '@react-navigation/native';
import { SatochipCard } from 'satochip-react-native';
import { setupCard, handleSatochipError } from 'src/hardware/satochip';
import Buttons from 'src/components/Buttons';
import NFC from 'src/services/nfc';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import React, { useContext, useEffect, useState } from 'react';
import useSatochipModal from 'src/hooks/useSatochipModal';
import ScreenWrapper from 'src/components/ScreenWrapper';
import Text from 'src/components/KeeperText';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import DeleteDarkIcon from 'src/assets/images/delete.svg';
import DeleteIcon from 'src/assets/images/deleteLight.svg';
import { ScrollView } from 'react-native-gesture-handler';
import KeeperModal from 'src/components/KeeperModal';
import SatochipSetupImage from 'src/assets/images/SatochipSetup.svg';
import SuccessIllustration from 'src/assets/images/illustration.svg';
import AlertIllustration from 'src/assets/images/alert_illustration.svg';
import { hp, wp } from 'src/constants/responsive';
import { KeeperPasswordInput } from 'src/components/KeeperPasswordInput';
import WalletHeader from 'src/components/WalletHeader';
import { LocalizationContext } from 'src/context/Localization/LocContext';

const INPUTS = {
  NEW_PIN: 'NEW_PIN',
  CONFIRM_PIN: 'CONFIRM_PIN',
};

function SatochipSetupPin({ route, navigation}) {
  const { colorMode } = useColorMode();
  const card = React.useRef(new SatochipCard()).current;
  const { withModal, nfcVisible, closeNfc } = useSatochipModal(card);
  const [newPIN, setNewPIN] = useState('');
  const [confPIN, setConfPIN] = useState('');
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [activeInput, setActiveInput] = useState(null);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [ctaDisabled, setCtaDisabled] = useState(true);
  const { translations } = useContext(LocalizationContext);
  const {
    error: errorTranslation,
    satochip: satochipTranslation,
    signer: signerTranslation,
    common,
  } = translations;

  const onPressHandler = (digit) => {
    const temp =
      (activeInput === INPUTS.NEW_PIN ? newPIN : confPIN) || '';
    const newTemp = digit === 'x' ? temp.slice(0, -1) : temp + digit;
    switch (activeInput) {
      case INPUTS.NEW_PIN:
        setNewPIN(newTemp);
        break;
      case INPUTS.CONFIRM_PIN:
        setConfPIN(newTemp);
        break;
      default:
        break;
    }
  };

  const onDeletePressed = () => {
    const currentInput = activeInput;
    if (currentInput) {
      const inputVal =
        currentInput === INPUTS.NEW_PIN ? newPIN : confPIN;
      const newInputVal = inputVal.slice(0, inputVal.length - 1);
      if (currentInput === INPUTS.NEW_PIN) setNewPIN(newInputVal);
      else setConfPIN(newInputVal);
    }
  };

  const setupPinAction = React.useCallback(async () => {
    try {
      await withModal(async () => setupCard(card, newPIN))();
      setSuccess(true);
      if (Platform.OS === 'ios') NFC.showiOSMessage(errorTranslation.pinChanged);
    } catch (error) {
      setSuccess(false);
      const errorMessage = handleSatochipError(error, navigation);
      if (errorMessage) {
        setErrorMsg(errorMessage);
      }
    } finally {
      setShowResultModal(true)
      closeNfc();
      card.endNfcSession();
    }
  }, [newPIN]);

  function ConfirmContent() {
    return (
      <>
        <Box style={styles.modalIllustration}>
          <SatochipSetupImage />
        </Box>
        <Box style={styles.modalTextCtr}>
          <Box style={styles.dot} backgroundColor={`${colorMode}.primaryText`} />
          <Text color={`${colorMode}.greenText`} style={styles.modalText}>
            {satochipTranslation.cardSetupConfirm}
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
        newPIN?.length > 3 &&
        newPIN?.length <=16 &&
        confPIN?.length > 3 &&
        confPIN?.length <=16 &&
        newPIN === confPIN
      )
    );
  }, [newPIN, confPIN]);

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={satochipTranslation.satochipSetupTitle}
        subTitle={satochipTranslation.changePinDescription}
      />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Box style={styles.btnContainer}>
          <FieldWithLabel
            label={signerTranslation.newPin}
            placeholder={signerTranslation.newPin}
            value={newPIN}
            onPress={() => setActiveInput(INPUTS.NEW_PIN)}
            isActive={activeInput === INPUTS.NEW_PIN}
          />
          <FieldWithLabel
            label={signerTranslation.confirmPin}
            placeholder={signerTranslation.confirmPin}
            value={confPIN}
            onPress={() => setActiveInput(INPUTS.CONFIRM_PIN)}
            isActive={activeInput === INPUTS.CONFIRM_PIN}
          />
        </Box>
      </ScrollView>

      <KeyPadView
        onPressNumber={onPressHandler}
        onDeletePressed={onDeletePressed}
        keyColor={colorMode === 'light' ? '#041513' : '#FFF'}
        ClearIcon={colorMode === 'dark' ? <DeleteIcon /> : <DeleteDarkIcon />}
      />
      <Box style={styles.ctaContainer}>
        <Buttons
          primaryText={common.continue}
          primaryCallback={() => setShowConfirmationModal(true)}
          primaryDisable={ctaDisabled}
          fullWidth
        />
      </Box>

      {/*action confirmation dialog*/}
      <KeeperModal
        visible={showConfirmationModal}
        close={() => setShowConfirmationModal(false)}
        showCloseIcon={false}
        title={satochipTranslation.changePinTitle}
        subTitle={satochipTranslation.SetupDescription}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.continue}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => setShowConfirmationModal(false)}
        buttonCallback={() => {
          setShowConfirmationModal(false);
          setupPinAction();
        }}
        Content={ConfirmContent}
      />

      {/*result modal */}
      <KeeperModal
        visible={showResultModal}
        close={() => setShowResultModal(false)}
        showCloseIcon={false}
        title={success? satochipTranslation.satochipSetupTitle : satochipTranslation.satochipSetupFail}
        subTitle={success? satochipTranslation.satochipSetupSuccess : errorMsg}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.Okay}
        buttonCallback={() => {
          console.log('Pressed pin activated btn');
          setShowResultModal(false);
          navigation.dispatch(CommonActions.goBack());
        }}
        Content={ResultContent}
      />

      <NfcPrompt visible={nfcVisible} close={closeNfc} />
    </ScreenWrapper>
  );
}

const FieldWithLabel = ({ label, value, onPress, isActive, placeholder }) => {
  return (
    <Box marginTop={4}>
      <Text>{label}</Text>
      <KeeperPasswordInput
        value={value}
        onPress={onPress}
        isActive={isActive}
        placeholder={placeholder}
      />
    </Box>
  );
};

export default SatochipSetupPin;

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
