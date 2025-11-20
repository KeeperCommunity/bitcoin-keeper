import { Platform, StyleSheet } from 'react-native';
import { Box, useColorMode } from 'native-base';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { SatochipCard } from 'satochip-react-native';
import { changePin, handleSatochipError } from 'src/hardware/satochip';
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
  PIN: 'PIN',
  NEW_PIN: 'NEW_PIN',
  CONFIRM_PIN: 'CONFIRM_PIN',
};

function ChangeSatochipPin() {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const card = React.useRef(new SatochipCard()).current;
  const { withModal, nfcVisible, closeNfc } = useSatochipModal(card);
  const [PIN, setPIN] = useState('');
  const [newPIN, setNewPIN] = useState('');
  const [confPIN, setConfPIN] = useState('');
  const [showConfirmationModal, setshowConfirmationModal] = useState(false);
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
      (activeInput === INPUTS.PIN ? PIN : activeInput === INPUTS.NEW_PIN ? newPIN : confPIN) || '';
    const newTemp = digit === 'x' ? temp.slice(0, -1) : temp + digit;
    switch (activeInput) {
      case INPUTS.PIN:
        setPIN(newTemp);
        break;
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
        currentInput === INPUTS.PIN ? PIN : currentInput === INPUTS.NEW_PIN ? newPIN : confPIN;
      const newInputVal = inputVal.slice(0, inputVal.length - 1);
      if (currentInput === INPUTS.PIN) setPIN(newInputVal);
      else if (currentInput === INPUTS.NEW_PIN) setNewPIN(newInputVal);
      else setConfPIN(newInputVal);
    }
  };

  const changePinAction = React.useCallback(async () => {
    try {
      await withModal(async () => changePin(card, PIN, newPIN))();
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
  }, [PIN, newPIN]);

  function confirmationContent() {
    return (
      <>
        <Box style={styles.modalIllustration}>
          <SatochipSetupImage />
        </Box>
        <Box style={styles.modalTextCtr}>
          <Box style={styles.dot} backgroundColor={`${colorMode}.primaryText`} />
          <Text color={`${colorMode}.greenText`} style={styles.modalText}>
            {satochipTranslation.clickToContinueTap}
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
        PIN?.length > 3 &&
        newPIN?.length > 3 &&
        confPIN?.length > 3 &&
        newPIN !== PIN &&
        newPIN === confPIN
      )
    );
  }, [PIN, newPIN, confPIN]);

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={satochipTranslation.changePinTitle}
        subTitle={satochipTranslation.changePinDescription}
      />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Box style={styles.btnContainer}>
          <FieldWithLabel
            label={signerTranslation.existingPin}
            placeholder={signerTranslation.existingPin}
            value={PIN}
            onPress={() => setActiveInput(INPUTS.PIN)}
            isActive={activeInput === INPUTS.PIN}
          />
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
          primaryCallback={() => setshowConfirmationModal(true)}
          primaryDisable={ctaDisabled}
          fullWidth
        />
      </Box>

      {/*action confirmation dialog*/}
      <KeeperModal
        visible={showConfirmationModal}
        close={() => setshowConfirmationModal(false)}
        showCloseIcon={false}
        title={satochipTranslation.changePinTitle}
        subTitle={satochipTranslation.SetupDescription}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.continue}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => setshowConfirmationModal(false)}
        buttonCallback={() => {
          setshowConfirmationModal(false);
          changePinAction();
        }}
        Content={confirmationContent}
      />

      {/* operation result */}
      <KeeperModal
        visible={showResultModal}
        close={() => setShowResultModal(false)}
        showCloseIcon={false}
        title= {success ? satochipTranslation.pinChangedTitle : satochipTranslation.pinChangedFail}
        subTitle= {success ? satochipTranslation.pinChangedSuccess : errorMsg}
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

export default ChangeSatochipPin;

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
