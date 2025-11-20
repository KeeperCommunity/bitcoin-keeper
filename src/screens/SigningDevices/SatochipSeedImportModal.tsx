import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
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
import useToastMessage from 'src/hooks/useToastMessage';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import NFC from 'src/services/nfc';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import Breadcrumbs from "../../components/Breadcrumbs";
import Buttons from "../../components/Buttons";
import {ConciergeTag} from "../../models/enums/ConciergeTag";
import {hp, wp} from "../../constants/responsive";
import Colors from "../../theme/Colors";
import WalletHeader from "../../components/WalletHeader";

function SatochipSeedImportModal({ route, navigation }) {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const {
    satochip: satochipTranslations,
    common,
  } = translations;

  const { pin, mnemonic, setupSatochipParams } = route.params || {};
  console.log(`SatochipSeedImportModal pin: ${pin}`);
  console.log(`SatochipSeedImportModal mnemonic: ${mnemonic}`);
  
  const card = useRef(new SatochipCard()).current;
  const { withModal, nfcVisible, closeNfc } = useSatochipModal(card);
  const { showToast } = useToastMessage();

  const [isProcessing, setIsProcessing] = useState(true);
  const [resultModal, setResultModal] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const performSeedImport = useCallback(async () => {
    console.log(`SatochipSeedImportModal performSeedImport START`);
    try {
      if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
        console.log(`SatochipSeedImportModal performSeedImport Wrong mnemonic!!`);
        throw new Error('Invalid mnemonic phrase');
      }

      const seedBytes = bip39.mnemonicToSeedSync(mnemonic);
      console.log(`SatochipSeedImportModal performSeedImport seedBytes: ${seedBytes.toString('hex')}`);
      
      await withModal(async () => importSeed(card, pin, seedBytes))();

      setImportSuccess(true);
      if (Platform.OS === 'ios') {
        NFC.showiOSMessage(satochipTranslations.importSeedSuccess);
      }
      
    } catch (error) {
      console.error('SatochipSeedImportModal performSeedImport error:', error);
      const errorMsg = handleSatochipError(error, navigation);
      setErrorMessage(errorMsg || satochipTranslations.importSeedFailed);
      setImportSuccess(false);
      
      if (Platform.OS === 'ios') {
        NFC.showiOSErrorMessage(errorMsg || satochipTranslations.importSeedFailed);
      }
      
    } finally {
      console.error('SatochipSeedImportModal performSeedImport finally');
      setIsProcessing(false);
      setResultModal(true);
      closeNfc();
      card.endNfcSession();
    }
  }, [pin, mnemonic]);
  // }, [pin, mnemonic, withModal, closeNfc]);

  // useEffect(() => {
  //   // Start the import process immediately when component mounts
  //   performSeedImport();
  // }, [performSeedImport]);

  const handleResultClose = () => {
    console.log(`SatochipSeedImportModal handleResultClose START`);
    console.log('Navigation state:', navigation.getState());
    console.log('Available routes:', navigation.getParent()?.getState());

    setResultModal(false);
    
    // if (importSuccess) {
    //   showToast(satochipTranslations.importSeedSuccess, <TickIcon />);
    // }


    // Before passing, ensure params are serializable
    // const safeParams = {
    //   // Only include primitive values and plain objects
    //   id: setupSatochipParams?.id,
    //   name: setupSatochipParams?.name,
    //   // Avoid passing functions, class instances, etc.
    // };

    // Navigate back to the SetupSatochip screen using reset navigation
    // to remove all intermediate screens from the stack
    // navigation.dispatch(
    //   CommonActions.reset({
    //     index: 0,
    //     routes: [
    //       //{ name: 'Home' },
    //       {
    //         name: 'SetupSatochip',
    //         params: safeParams, //setupSatochipParams || {},
    //       },
    //     ],
    //   })
    // );

    // Simply navigate back to SetupSatochip
    // navigation.navigate('SetupSatochip', setupSatochipParams || {});
    navigation.navigate('SatochipAction', {});
    //navigation.navigate('Home', {});

    // Or if you need to go back multiple screens:
    // navigation.pop(2); // Go back 2 screens
    // navigation.navigate('SetupSatochip', setupSatochipParams || {});

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

      <WalletHeader
        title={satochipTranslations.importSeedTitle}
        subTitle={satochipTranslations.importSeedDescription}
        onPressHandler={handleCancel}
      />


      {/* NFC Processing UI */}
      <NfcPrompt visible={nfcVisible} close={closeNfc} />
      
      {/* Loading Indicator */}
      {/*<ActivityIndicatorView */}
      {/*  showLoader={true} */}
      {/*  visible={isProcessing} */}
      {/*  title={satochipTranslations.importSeedInProgress}*/}
      {/*  subTitle={common.pleaseWait}*/}
      {/*/>*/}

      <Box style={styles.bottomContainerView}>
        {/* import button */}
        <Buttons
          primaryCallback={performSeedImport}
          primaryText={'Import Seed'}
          secondaryText={'Cancel?'}
          fullWidth={true}
          secondaryCallback={handleResultClose}
          primaryLoading={false} // todo?
        />
      </Box>

      {/* Result Modal */}
      <KeeperModal
        visible={resultModal}
        close={handleResultClose}
        title={importSuccess ? satochipTranslations.importSeedSuccess : satochipTranslations.importSeedFailed}
        subTitle={importSuccess 
          ? satochipTranslations.importSeedSuccess 
          : satochipTranslations.importSeedFailed}
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
    justifyContent: 'space-between',
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