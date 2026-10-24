import { Platform, StyleSheet, KeyboardAvoidingView, Keyboard } from 'react-native';
import React, { useCallback, useContext, useState } from 'react';
import { Box, Input, ScrollView, View, useColorMode } from '@gluestack-ui/themed-native-base';
import { hp, wp } from 'src/constants/responsive';
import ScreenWrapper from 'src/components/ScreenWrapper';
import Buttons from 'src/components/Buttons';
import useConfigRecovery from 'src/hooks/useConfigReocvery';
import ImportIcon from 'src/assets/images/import.svg';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import OptionCard from 'src/components/OptionCard';
import RNFS from 'react-native-fs';
import { getDocumentReadPath } from 'src/utils/documentReadPath';
import { pick, types } from '@react-native-documents/picker';
import Colors from 'src/theme/Colors';
import Text from 'src/components/KeeperText';
import KeeperModal from 'src/components/KeeperModal';
import { ConciergeTag } from 'src/models/enums/ConciergeTag';
import QRScanner from 'src/components/QRScanner';
import { CommonActions, useNavigation } from '@react-navigation/native';
import ConciergeNeedHelp from 'src/assets/images/conciergeNeedHelp.svg';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import WalletHeader from 'src/components/WalletHeader';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';

function WrappedImportIcon() {
  const { colorMode } = useColorMode();

  return (
    <View style={styles.iconWrapper} backgroundColor={`${colorMode}.pantoneGreen`}>
      <ImportIcon width={15} height={15} />
    </View>
  );
}

function VaultConfigurationCreation() {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const [inputText, setInputText] = useState('');
  const { recoveryLoading, initateRecovery, checkIfVaultExists } = useConfigRecovery();

  const { translations } = useContext(LocalizationContext);
  const { common, importWallet, signer: signerTranslation } = translations;
  const [showModal, setShowModal] = useState(false);

  const green_modal_text_color = ThemedColor({ name: 'green_modal_text_color' });
  const green_modal_background = ThemedColor({ name: 'green_modal_background' });
  const green_modal_button_background = ThemedColor({ name: 'green_modal_button_background' });
  const green_modal_button_text = ThemedColor({ name: 'green_modal_button_text' });
  const green_modal_sec_button_text = ThemedColor({ name: 'green_modal_sec_button_text' });

  const handleDocumentSelection = useCallback(async () => {
    try {
      const response = await pick({
        presentationStyle: 'fullScreen',
        type: [types.docx, types.allFiles],
        allowMultiSelection: false,
      });
      const readPath = getDocumentReadPath(response[0].uri, Platform.OS);
      const content = await RNFS.readFile(readPath, 'utf8');
      navigateToSetup(content);
    } catch (err) {
      console.log(err);
    }
  }, []);

  function ImportVaultContent() {
    return (
      <View marginY={5}>
        <Text style={styles.desc} color={green_modal_text_color}>
          {importWallet.importMultisigWallet}{' '}
        </Text>
        <Text style={styles.desc} color={green_modal_text_color}>
          {importWallet.bsmsFile}
        </Text>
        <Text style={styles.desc} color={green_modal_text_color}>
          {importWallet.importVaultforKeeper}
        </Text>
        <Text style={styles.descLast} color={green_modal_text_color}>
          {importWallet.importCompleteKeeper}
        </Text>
      </View>
    );
  }

  const navigateToSetup = (vaultConfig) => {
    const callback = (vaultConfig) => {
      if (!checkIfVaultExists(vaultConfig.vaultSigners, vaultConfig.scheme))
        navigation.replace('ImportedWalletSetup', { vaultConfig });
    };
    initateRecovery(vaultConfig, callback);
  };

  return (
    <ScreenWrapper barStyle="dark-content" backgroundcolor={`${colorMode}.primaryBackground`}>
      {recoveryLoading && <ActivityIndicatorView visible={recoveryLoading} />}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : null}
        enabled
        keyboardVerticalOffset={Platform.select({ ios: 8, android: 500 })}
        style={styles.scrollViewWrapper}
      >
        <WalletHeader
          title={importWallet.importAWallet}
          subTitle={importWallet.importExistingWallet}
          learnMore
          learnMorePressed={() => setShowModal(true)}
        />
        <ScrollView style={styles.scrollViewWrapper} showsVerticalScrollIndicator={false}>
          <Box marginTop={hp(10)}>
            <QRScanner
              onScanCompleted={(data) => {
                navigateToSetup(data);
              }}
            />
            <Box style={styles.optionsWrapper}>
              {/* <Box style={styles.separator} backgroundColor={`${colorMode}.lightSkin`}></Box> */}
              <Box style={{ marginLeft: wp(25) }}>
                <OptionCard
                  title={signerTranslation.uploadFile}
                  description={signerTranslation.uploadFileDesc}
                  LeftIcon={<WrappedImportIcon />}
                  callback={handleDocumentSelection}
                />

                {/* TODO: Re-enable this o */}
                {/* <OptionCard
                  title={'Import from ColdCard using NFC'}
                  description={'Recover your vault by exporting if from ColdCard using NFC'}
                  LeftIcon={<SignerImportIcon />}
                  callback={() =>
                    navigation.dispatch(
                      CommonActions.navigate({
                        name: 'AddColdCard',
                        params: { mode: InteracationMode.CONFIG_RECOVERY },
                      })
                    )
                  }
                /> */}
              </Box>
              <Box style={styles.inputWrapper} backgroundColor={`${colorMode}.seashellWhite`}>
                <Input
                  testID="input_walletConfigurationFile"
                  placeholder={signerTranslation.enterManualConfig}
                  placeholderTextColor={`${colorMode}.primaryText`}
                  style={styles.textInput}
                  variant="unstyled"
                  value={inputText}
                  onChangeText={(text) => {
                    setInputText(text);
                  }}
                  textAlignVertical="top"
                  textAlign="left"
                  multiline
                  _input={
                    colorMode === 'dark' && {
                      selectionColor: Colors.bodyText,
                      cursorColor: Colors.bodyText,
                    }
                  }
                />
              </Box>
            </Box>
          </Box>
        </ScrollView>
        <Box style={styles.buttonContainer}>
          <Buttons
            primaryCallback={() => {
              Keyboard.dismiss();
              navigateToSetup(inputText);
            }}
            primaryText={common.proceed}
            primaryLoading={recoveryLoading}
            fullWidth
          />
        </Box>
      </KeyboardAvoidingView>
      <KeeperModal
        visible={showModal}
        close={() => {
          setShowModal(false);
        }}
        title={`${importWallet.importAWallet}:`}
        modalBackground={green_modal_background}
        textColor={green_modal_text_color}
        Content={ImportVaultContent}
        DarkCloseIcon
        buttonText={common.Okay}
        // secondaryButtonText={common.needHelp}
        buttonTextColor={green_modal_button_text}
        buttonBackground={green_modal_button_background}
        // secButtonTextColor={green_modal_sec_button_text}
        // secondaryIcon={<ConciergeNeedHelp />}
        // secondaryCallback={() => {
        //   setShowModal(false);
        //   navigation.dispatch(
        //     CommonActions.navigate({
        //       name: 'CreateTicket',
        //       params: {
        //         tags: [ConciergeTag.WALLET],
        //         screenName: 'import-wallet-config-file',
        //       },
        //     })
        //   );
        // }}
        buttonCallback={() => setShowModal(false)}
      />
    </ScreenWrapper>
  );
}

export default VaultConfigurationCreation;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  inputWrapper: {
    flexDirection: 'column',
    marginTop: hp(20),
    marginHorizontal: hp(5),
    width: '100%',
    alignItems: 'center',
    borderRadius: 10,
  },
  textInput: {
    width: '100%',
    alignSelf: 'center',
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    padding: 20,
    opacity: 0.5,
    fontSize: 13,
    height: hp(80),
  },
  tileContainer: {
    position: 'absolute',
    bottom: -50,
    width: '100%',
  },
  tileWrapper: {
    marginBottom: 15,
  },
  noteWrapper: {
    width: '100%',
    bottom: 0,
    position: 'absolute',
    paddingHorizontal: 20,
  },
  separator: {
    width: '100%',
    height: 2,
    backgroundColor: Colors.secondaryCreamWhite,
    marginBottom: 10,
  },
  optionsWrapper: {
    marginHorizontal: wp(15),
    alignContent: 'center',
    alignItems: 'center',
  },
  buttonContainer: {
    marginHorizontal: wp(15),

    marginTop: hp(20),
  },
  qrStatus: {
    position: 'absolute',
    zIndex: 999,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    transform: [{ translateY: hp(235) }],
  },
  scrollViewWrapper: {
    flex: 1,
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
    marginTop: hp(60),
  },
  iconWrapper: {
    width: wp(35),
    height: wp(35),
    marginLeft: -7,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
