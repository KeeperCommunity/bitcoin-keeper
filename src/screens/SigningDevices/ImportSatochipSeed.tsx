import React, { useContext } from 'react';
import { Box, useColorMode } from 'native-base';
import { StyleSheet } from 'react-native';
import { CommonActions } from '@react-navigation/native';

import Text from 'src/components/KeeperText';
import ScreenWrapper from 'src/components/ScreenWrapper';
import Buttons from 'src/components/Buttons';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { hp, wp } from 'src/constants/responsive';
import WalletHeader from 'src/components/WalletHeader';
import HexagonIcon from 'src/components/HexagonIcon';
import SATOCHIPICONLIGHT from 'src/assets/images/satochip_light.svg';
import Colors from 'src/theme/Colors';
import {InteracationMode} from "../Vault/HardwareModalMap";

function ImportSatochipSeed({ route, navigation }) {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const {
    satochip: satochipTranslations,
    common,
  } = translations;

  const { pin, setupSatochipParams } = route.params || {};

  // DEBUG
  console.log(`ImportSatochipSeed pin: ${pin}`);

  const handleContinue = () => {
    console.log(`ImportSatochipSeed handleContinue START`);

    navigation.dispatch(
      CommonActions.navigate({
        name: 'EnterSeedScreen',
        params: {
          mode: InteracationMode.VAULT_IMPORT_SEED,
          isImport: true,
          isUSDTWallet: false,
          importSeedCta: async (mnemonic: string) => {
            // Navigate to NFC processing screen with the mnemonic
            navigation.dispatch(
              CommonActions.navigate({
                name: 'SatochipSeedImportModal',
                params: {
                  pin,
                  mnemonic,
                  setupSatochipParams,
                },
              })
            );
          },
        },
      })
    );
  };

  const handleCancel = () => {
    navigation.goBack();
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={satochipTranslations.importSeedTitle}
        subTitle={satochipTranslations.importSeedDescription}
        onPressHandler={handleCancel}
      />

      <Box style={styles.container}>
        <Box style={styles.iconContainer}>
          <HexagonIcon
            width={wp(80)}
            height={hp(80)}
            backgroundColor={colorMode === 'light' ? Colors.primaryGreen : Colors.GreenishGrey}
            icon={<SATOCHIPICONLIGHT />}
          />
        </Box>

        {/*<Box style={styles.descriptionContainer}>*/}
        {/*  <Text style={styles.descriptionText} color={`${colorMode}.secondaryText`}>*/}
        {/*    {satochipTranslations.importSeedDescription}*/}
        {/*  </Text>*/}
        {/*  */}
        {/*  /!*<Box style={[styles.warningContainer, { *!/*/}
        {/*  /!*  backgroundColor: colorMode === 'light' ? 'rgba(245, 142, 111, 0.1)' : 'rgba(245, 142, 111, 0.2)',*!/*/}
        {/*  /!*}]}>*!/*/}
        {/*  /!*  <Text style={styles.warningText} color={`${colorMode}.alertRed`}>*!/*/}
        {/*  /!*    {satochipTranslations.importSeedWarning}*!/*/}
        {/*  /!*  </Text>*!/*/}
        {/*  /!*</Box>*!/*/}
        {/*</Box>*/}
      </Box>

      <Box style={styles.buttonContainer}>
        <Buttons
          fullWidth
          primaryText={common.continue}
          primaryCallback={handleContinue}
          secondaryText={common.cancel}
          secondaryCallback={handleCancel}
        />
      </Box>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: wp(20),
    paddingTop: hp(40),
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: hp(40),
  },
  descriptionContainer: {
    marginBottom: hp(40),
  },
  descriptionText: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: hp(30),
  },
  warningContainer: {
    padding: hp(20),
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F58E6F',
  },
  warningText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    fontWeight: '500',
  },
  buttonContainer: {
    paddingHorizontal: wp(20),
    paddingBottom: hp(30),
  },
});

export default ImportSatochipSeed;