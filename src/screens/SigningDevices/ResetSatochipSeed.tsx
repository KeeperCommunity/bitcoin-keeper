import { Platform, StyleSheet } from 'react-native';
import { Box, useColorMode } from 'native-base';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { SatochipCard } from 'satochip-react-native';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { handleSatochipError, resetSeed } from 'src/hardware/satochip';
import Buttons from 'src/components/Buttons';
import NFC from 'src/services/nfc';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import React, { useContext, useEffect, useState } from 'react';
import useSatochipModal from 'src/hooks/useSatochipModal';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/icon_tick.svg';
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

const INPUTS = {
  PIN: 'PIN',
};

function ResetSatochipSeed() {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const card = React.useRef(new SatochipCard()).current;
  const { withModal, nfcVisible, closeNfc } = useSatochipModal(card);
  const [PIN, setPIN] = useState('');
  const [showPinModal, setShowPinModal] = useState(false);
  const [showActivatedModal, setShowActivatedModal] = useState(false);
  const [activeInput, setActiveInput] = useState(null);

  const [ctaDisabled, setCtaDisabled] = useState(true);

  const { showToast } = useToastMessage();
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

  const activateSeedResetAction = React.useCallback(async () => {
    try {
      await withModal(async () => resetSeed(card, PIN))();
      navigation.dispatch(CommonActions.goBack());
      if (Platform.OS === 'ios') NFC.showiOSMessage(satochipTranslation.saochipSeedReset);
      showToast(satochipTranslation.saochipSeedReset, <TickIcon />);


    } catch (error) {
      const errorMessage = handleSatochipError(error, navigation);
      if (errorMessage) {
        showToast(errorMessage, <ToastErrorIcon />, IToastCategory.DEFAULT, 3000, true);
      }
    } finally {
      closeNfc();
      card.endNfcSession();
    }
  }, [PIN]);

  function ActivatePinContent() {
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
  function PinActivatedContent() {
    return (
      <Box style={styles.modalIllustration}>
        <SuccessIllustration />
      </Box>
    );
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
        title={signerTranslation.resetSeed}
        subTitle={signerTranslation.resetSeedWarning}
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
        secondaryCallback={() => setShowPinModal(false)}
        buttonCallback={() => {
          setShowPinModal(false);
          activateSeedResetAction();
          //   setShowActivatedModal(true);
        }}
        Content={ActivatePinContent}
      />
      <KeeperModal
        visible={showActivatedModal}
        close={() => setShowActivatedModal(false)}
        showCloseIcon={false}
        title={signerTranslation.pinActivated}
        subTitle={satochipTranslation.satochipPinActivated}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.Okay}
        buttonCallback={() => {
          console.log('Pressed pin activated btn');
          setShowActivatedModal(false);
          navigation.dispatch(CommonActions.goBack());
        }}
        Content={PinActivatedContent}
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
