import { Platform, StyleSheet } from 'react-native';
import { Box, useColorMode } from 'native-base';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { SatochipCard } from 'satochip-react-native';
import {getCardInfo, handleSatochipError} from 'src/hardware/satochip';
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
import { hp, wp } from 'src/constants/responsive';
import { KeeperPasswordInput } from 'src/components/KeeperPasswordInput';
import WalletHeader from 'src/components/WalletHeader';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import AlertIllustration from "../../assets/images/alert_illustration.svg";

const INPUTS = {
  PIN: 'PIN',
};

function SatochipVerifyAuthenticity() {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const card = React.useRef(new SatochipCard()).current;
  const { withModal, nfcVisible, closeNfc } = useSatochipModal(card);
  const [PIN, setPIN] = useState('');
  const [showPinModal, setShowPinModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [activeInput, setActiveInput] = useState(null);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [ctaDisabled, setCtaDisabled] = useState(true);
  const { translations } = useContext(LocalizationContext);
  const {
    satochip: satochipTranslation,
    signer: signerTranslation,
    common,
  } = translations;

  const onPressHandler = (digit) => {
    const temp = PIN;
    const newTemp = digit === 'x' ? temp.slice(0, -1) : temp + digit;
    setPIN(newTemp);
  };

  const onDeletePressed = () => {
    const inputVal = PIN;
    const newInputVal = inputVal.slice(0, inputVal.length - 1);
    setPIN(newInputVal);
  };

  const activateVerifyAuthenticityAction = React.useCallback(async () => {
    try {

      const { isAuthentic, authenticityMsg } = await withModal(async () => getCardInfo(card, PIN))();
      if (isAuthentic){
        setSuccess(true);
      } else {
        setSuccess(false);
        setErrorMsg(authenticityMsg);
      }
      if (Platform.OS === 'ios') NFC.showiOSMessage(satochipTranslation.satochipVerified);
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
  }, [PIN]);

  function ConfirmContent() {
    return (
      <>
        <Box style={styles.modalIllustration}>
          <SatochipSetupImage />
        </Box>
        <Box style={styles.modalTextCtr}>
          <Box style={styles.dot} backgroundColor={`${colorMode}.primaryText`} />
          <Text color={`${colorMode}.textGreen`} style={styles.modalText}>
            {satochipTranslation.clickToContinueVerify}
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
        PIN?.length <= 16
      )
    );
  }, [PIN]);

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={satochipTranslation.verifyAuthenticity}
        subTitle={satochipTranslation.verifyAuthenticityDescription}
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
          primaryCallback={() => setShowPinModal(true)}
          primaryDisable={ctaDisabled}
          fullWidth
        />
      </Box>

      {/* confirm modal*/}
      <KeeperModal
        visible={showPinModal}
        close={() => setShowPinModal(false)}
        showCloseIcon={false}
        title={satochipTranslation.verifyAuthenticity}
        subTitle={satochipTranslation.SetupDescription}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.continue}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => setShowPinModal(false)}
        buttonCallback={() => {
          setShowPinModal(false);
          activateVerifyAuthenticityAction();
        }}
        Content={ConfirmContent}
      />

      {/* result modal*/}
      <KeeperModal
        visible={showResultModal}
        close={() => setShowResultModal(false)}
        showCloseIcon={false}
        title={success ? satochipTranslation.satochipVerified : satochipTranslation.verificationFail}
        subTitle={success ? satochipTranslation.satochipIsAuthentic : errorMsg}
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

export default SatochipVerifyAuthenticity;

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
