import React, { useCallback, useContext, useRef, useState } from 'react';
import {Platform, StyleSheet} from 'react-native';
import { Box, useColorMode } from 'native-base';
import { CommonActions } from '@react-navigation/native';
import { SatochipCard } from 'satochip-react-native';
import * as bip39 from 'bip39';
import ScreenWrapper from 'src/components/ScreenWrapper';
import KeeperModal from 'src/components/KeeperModal';
import Text from 'src/components/KeeperText';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { importSeed, handleSatochipError } from 'src/hardware/satochip';
import useSatochipModal from 'src/hooks/useSatochipModal';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import NFC from 'src/services/nfc';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import Buttons from "../../components/Buttons";
import {hp, wp} from "../../constants/responsive";
import Colors from "../../theme/Colors";
import WalletHeader from "../../components/WalletHeader";
import {InteracationMode} from "../Vault/HardwareModalMap";

function SatochipSeedImportModal({ route, navigation }) {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const {
    satochip: satochipTranslations,
    common,
  } = translations;

  const { pin, mnemonic } = route.params || {};
  const card = useRef(new SatochipCard()).current;
  const { withModal, nfcVisible, closeNfc } = useSatochipModal(card);
  const [showResultModal, setShowResultModal] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const performSeedImport = useCallback(async () => {
    try {
      if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic phrase');
      }

      const seedBytes = bip39.mnemonicToSeedSync(mnemonic);
      await withModal(async () => importSeed(card, pin, seedBytes))();

      setImportSuccess(true);
      if (Platform.OS === 'ios') {
        NFC.showiOSMessage(satochipTranslations.importSeedSuccess);
      }
      
    } catch (error) {
      const errorMsg = handleSatochipError(error, navigation);
      setErrorMessage(errorMsg || satochipTranslations.importSeedFailed);
      setImportSuccess(false);
      
      if (Platform.OS === 'ios') {
        NFC.showiOSErrorMessage(errorMsg || satochipTranslations.importSeedFailed);
      }
      
    } finally {
      setShowResultModal(true);
      closeNfc();
      card.endNfcSession();
    }
  }, [pin, mnemonic]);

  const handleResultClose = () => {
    setShowResultModal(false);

    // Navigate back to the Add Satochip Key
    navigation.dispatch(
      CommonActions.navigate({
        name: 'SatochipAction',
        params: {
          mode: InteracationMode.VAULT_ADDITION,
        },
      })
    );

  };

  const ResultModalContent = () => (
    <Box>
      <Box style={{ alignItems: 'center', marginBottom: 20 }}>
        {importSuccess ? (
          <TickIcon width={60} height={60} />
        ) : (
          <ToastErrorIcon width={60} height={60} />
        )}
      </Box>
      
      <Text 
        style={{ 
          fontSize: 16, 
          textAlign: 'center', 
          marginBottom: 10 
        }}
        color={`${colorMode}.secondaryText`}
      >
        {importSuccess 
          ? satochipTranslations.importSeedSuccess 
          : satochipTranslations.importSeedFailed}
      </Text>
      
      {!importSuccess && errorMessage && (
        <Text 
          style={{ 
            fontSize: 14, 
            textAlign: 'center',
            marginTop: 10,
          }}
          color={`${colorMode}.alertRed`}
        >
          {errorMessage}
        </Text>
      )}
    </Box>
  );

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>

      <Box style={{ flex: 1 }}>
        <WalletHeader
          title={satochipTranslations.importSeedTitle}
          subTitle={satochipTranslations.importSeedDescription}
          onPressHandler={handleResultClose}
        />

        {/* Add a spacer that takes up remaining space */}
        <Box style={{ flex: 1 }} />

        {/* import button in the bottom */}
        <Box style={styles.bottomContainerView}>
          <Buttons
            primaryCallback={performSeedImport}
            primaryText={satochipTranslations.importSeedButton}
            secondaryText={common.cancel}
            fullWidth={false}
            secondaryCallback={handleResultClose}
            primaryLoading={false}
          />
        </Box>
      </Box>

      {/* NFC Processing UI */}
      <NfcPrompt visible={nfcVisible} close={closeNfc} />

      {/* Result Modal */}
      <KeeperModal
        visible={showResultModal}
        close={handleResultClose}
        title={importSuccess ? satochipTranslations.importSeedTitle : satochipTranslations.importSeedFailed}
        subTitle={importSuccess ? satochipTranslations.importSeedSuccess : errorMessage}
        buttonText={common.Okay}
        buttonCallback={handleResultClose}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={ResultModalContent}
        showCloseIcon={false}
        dismissible={false}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  input: {
    borderRadius: 10,
    fontSize: 13,
    letterSpacing: 0.39,
    height: hp(50),
    width: wp(150),
    zIndex: 1,
  },
  inputListWrapper: {
    width: '48%',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: Colors.separator,
    borderRadius: 10,
  },
  bottomContainerView: {
    marginHorizontal: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  suggestionScrollView: {
    zIndex: 99999,
    position: 'absolute',
    maxHeight: hp(100),
    width: '100%',
    alignSelf: 'center',
  },
  suggestionWrapper: {
    backgroundColor: 'white',
    flexDirection: 'row',
    padding: 10,
    borderRadius: 10,
    flexWrap: 'wrap',
    overflow: 'hidden',
  },
  suggestionTouchView: {
    backgroundColor: '#f2c693',
    padding: 5,
    borderRadius: 5,
    margin: 5,
  },
  dropdownContainer: {
    zIndex: 9999,
    borderWidth: 1,
    borderColor: Colors.separator,
    borderRadius: 10,
  },
  invalidSeedsIllustration: {
    alignSelf: 'center',
    marginBottom: hp(30),
  },
  illustrationCTR: {
    alignItems: 'center',
    marginBottom: hp(30),
  },
  desc: {
    fontSize: 14,
    letterSpacing: 0.65,
    padding: 5,
    marginBottom: hp(5),
  },
  descLast: {
    fontSize: 14,
    letterSpacing: 0.65,
    padding: 5,
    paddingBottom: 0,
    marginTop: hp(40),
  },
});

export default SatochipSeedImportModal;