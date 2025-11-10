import { Box, ScrollView, useColorMode } from 'native-base';
import React, { useContext } from 'react';
import { StyleSheet } from 'react-native';
import { hp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import SDCategoryCard from 'src/screens/Vault/components/SDCategoryCard';
import { SDIcons } from 'src/screens/Vault/SigningDeviceIcons';
import { SignerCategory, SignerType } from 'src/services/wallets/enums';
import { CommonActions } from '@react-navigation/native';
import DashedCta from 'src/components/DashedCta';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';

const SignerContent = ({ navigation, handleModalClose }) => {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);

  const { signer: signerText } = translations;

  const hardwareSigners = [
    {
      type: SignerType.COLDCARD,
      background: 'headerWhite',
      isTrue: false,
    },
    { type: SignerType.TAPSIGNER, background: 'pantoneGreen', isTrue: true },
    { type: SignerType.SATOCHIP, background: 'pantoneGreen', isTrue: true },
    { type: SignerType.JADE, background: 'brownBackground', isTrue: true },
    {
      type: SignerType.PASSPORT,
      background: 'headerWhite',
      isTrue: false,
    },
    { type: SignerType.SPECTER, background: 'pantoneGreen', isTrue: false },
    { type: SignerType.KEYSTONE, background: 'brownBackground', isTrue: false },
    {
      type: SignerType.LEDGER,
      background: 'headerWhite',
      isTrue: false,
    },
    { type: SignerType.PORTAL, background: 'pantoneGreen', isTrue: false },
    { type: SignerType.TREZOR, background: 'brownBackground', isTrue: false },
    {
      type: SignerType.BITBOX02,
      background: 'headerWhite',
      isTrue: false,
    },
  ];

  const hardwareSnippet = hardwareSigners.map(({ type, background, isTrue }) => ({
    Icon: SDIcons({ type, light: isTrue, width: 9, height: 13 }).Icon,
    backgroundColor: `${colorMode}.${background}`,
  }));

  const signerCategoriesData = [
    {
      title: signerText.addKeyHardware,
      description: signerText.connectHardware,
      signerCategory: SignerCategory.HARDWARE,
      headerTitle: signerText.hardwareKeysHeader,
      headerSubtitle: signerText.connectHardwareDevices,
      Icon: <ThemedSvg name={'hardware_key_icon'} />,
      snippet: hardwareSnippet,
    },
    {
      title: signerText.addSoftwareKey,
      description: signerText.keysInApp,
      signerCategory: SignerCategory.SOFTWARE,
      headerTitle: signerText.softwareKeysHeader,
      headerSubtitle: signerText.keysNoHardwareNeeded,
      Icon: <ThemedSvg name={'software_key_icon'} />,
      snippet: [],
    },
  ];

  const handlePress = (category) => {
    if (handleModalClose) {
      handleModalClose();
    }
    navigation.dispatch(
      CommonActions.navigate({
        name: 'SigningDeviceList',
        params: {
          addSignerFlow: true,
          signerCategory: category.signerCategory,
          headerTitle: category.headerTitle,
          headerSubtitle: category.headerSubtitle,
        },
      })
    );
  };

  return (
    <Box style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollViewContent}>
        {signerCategoriesData.map((category, index) => (
          <SDCategoryCard
            key={index}
            title={category.title}
            description={category.description}
            Icon={category.Icon}
            snippet={category.snippet}
            onPress={() => handlePress(category)}
          />
        ))}
        <DashedCta
          backgroundColor={`${colorMode}.dullGreen`}
          borderColor={`${colorMode}.pantoneGreen`}
          textColor={`${colorMode}.greenWhiteText`}
          name={signerText.purchaseWallet}
          cardStyles={styles.cardStyles}
          callback={() => {
            navigation.navigate('HardwareWallet');
            handleModalClose();
          }}
        />
      </ScrollView>
    </Box>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollViewContent: {
    gap: hp(10),
  },
  cardStyles: {
    minHeight: hp(56),
  },
});

export default SignerContent;
