import { StyleSheet, View } from 'react-native';
import Text from 'src/components/KeeperText';
import { Box, useColorMode } from 'native-base';
import React, { useContext } from 'react';
import { hp } from 'src/constants/responsive';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import KeeperModal from 'src/components/KeeperModal';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { ScrollView } from 'react-native-gesture-handler';
import { SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import { setSdIntroModal } from 'src/store/reducers/vaults';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import { VaultScheme, VaultSigner } from 'src/services/wallets/interfaces/vault';
import { useDispatch } from 'react-redux';
import { ConciergeTag } from 'src/models/enums/ConciergeTag';
import SDCategoryCard from './components/SDCategoryCard';
import { SignerCategory, SignerType, VaultType } from 'src/services/wallets/enums';
import { SDIcons } from './SigningDeviceIcons';
import ConciergeNeedHelp from 'src/assets/images/conciergeNeedHelp.svg';
import DashedCta from 'src/components/DashedCta';
import WalletHeader from 'src/components/WalletHeader';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';

function SignerCategoryList() {
  const route = useRoute();
  const {
    scheme,
    addSignerFlow = false,
    vaultId,
    vaultSigners,
    vaultType,
  }: {
    scheme: VaultScheme;
    addSignerFlow: boolean;
    vaultId: string;
    vaultSigners?: VaultSigner[];
    vaultType?: VaultType;
  } = route.params as any;
  const navigation = useNavigation();
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const dispatch = useAppDispatch();
  const reduxDispatch = useDispatch();
  const sdModal = useAppSelector((state) => state.vault.sdIntroModal);
  const { vault: vaultText, signer: signerText, common } = translations;

  const green_modal_text_color = ThemedColor({ name: 'green_modal_text_color' });
  const green_modal_background = ThemedColor({ name: 'green_modal_background' });
  const green_modal_button_background = ThemedColor({ name: 'green_modal_button_background' });
  const green_modal_button_text = ThemedColor({ name: 'green_modal_button_text' });
  const green_modal_sec_button_text = ThemedColor({ name: 'green_modal_sec_button_text' });

  const hardwareSigners = [
    { type: SignerType.COLDCARD, background: 'headerWhite', isTrue: false },
    { type: SignerType.TAPSIGNER, background: 'pantoneGreen', isTrue: true },
    { type: SignerType.SATOCHIP, background: 'pantoneGreen', isTrue: true },
    { type: SignerType.JADE, background: 'brownBackground', isTrue: true },
    { type: SignerType.PASSPORT, background: 'headerWhite', isTrue: false },
    { type: SignerType.SPECTER, background: 'pantoneGreen', isTrue: false },
    { type: SignerType.KEYSTONE, background: 'brownBackground', isTrue: false },
    { type: SignerType.LEDGER, background: 'headerWhite', isTrue: false },
    { type: SignerType.PORTAL, background: 'pantoneGreen', isTrue: false },
    { type: SignerType.TREZOR, background: 'brownBackground', isTrue: false },
    { type: SignerType.BITBOX02, background: 'headerWhite', isTrue: false },
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
    navigation.dispatch(
      CommonActions.navigate({
        name: 'SigningDeviceList',
        params: {
          scheme,
          vaultType,
          addSignerFlow,
          vaultId,
          vaultSigners,
          signerCategory: category.signerCategory,
          headerTitle: category.headerTitle,
          headerSubtitle: category.headerSubtitle,
        },
      })
    );
  };

  const signerCategories = signerCategoriesData.map((category) => ({
    ...category,
    onPress: () => handlePress(category),
  }));

  function LearnMoreModalContent() {
    return (
      <View>
        <Box style={styles.alignCenter}>
          <ThemedSvg name={'diversify_hardware'} />
        </Box>
        <Text color={green_modal_text_color} style={styles.modalText}>
          {`${signerText.subscriptionTierL1} ${SubscriptionTier.L1} ${signerText.subscriptionTierL2} ${SubscriptionTier.L2} ${signerText.subscriptionTierL3} ${SubscriptionTier.L3}.\n\n${signerText.notSupportedText}`}
        </Text>
      </View>
    );
  }

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={vaultText.Addsigner}
        subTitle={vaultText.SelectSignerSubtitle}
        learnMore
        learnMorePressed={() => {
          dispatch(setSdIntroModal(true));
        }}
      />
      <Box style={styles.scrollViewWrapper}>
        <ScrollView
          style={styles.scrollViewContainer}
          contentContainerStyle={styles.contentContainerStyle}
          showsVerticalScrollIndicator={false}
          testID={'Signer_Scroll'}
        >
          <Box style={styles.categoryContainer}>
            {signerCategories.map((item, index) => (
              <SDCategoryCard
                key={index}
                title={item.title}
                description={item.description}
                Icon={item.Icon}
                onPress={item.onPress}
                snippet={item.snippet}
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
              }}
            />
          </Box>
        </ScrollView>
      </Box>
      <KeeperModal
        visible={sdModal}
        close={() => {
          dispatch(setSdIntroModal(false));
        }}
        title={signerText.signers}
        subTitle={signerText.signerDescription}
        modalBackground={green_modal_background}
        textColor={green_modal_text_color}
        Content={LearnMoreModalContent}
        DarkCloseIcon
        buttonText={common.Okay}
        secondaryButtonText={common.needHelp}
        buttonTextColor={green_modal_button_text}
        buttonBackground={green_modal_button_background}
        secButtonTextColor={green_modal_sec_button_text}
        secondaryIcon={<ConciergeNeedHelp />}
        secondaryCallback={() => {
          dispatch(setSdIntroModal(false));
          navigation.dispatch(
            CommonActions.navigate({
              name: 'CreateTicket',
              params: {
                tags: [ConciergeTag.KEYS],
                screenName: 'signing-device-list',
              },
            })
          );
        }}
        buttonCallback={() => {
          dispatch(setSdIntroModal(false));
        }}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  modalText: {
    letterSpacing: 0.65,
    fontSize: 13,
    marginTop: 5,
    padding: 1,
  },
  scrollViewWrapper: {
    flex: 1,
    paddingHorizontal: '2.5%',
    paddingTop: '8%',
  },
  scrollViewContainer: {
    flex: 1,
  },
  contentContainerStyle: {
    flexGrow: 1,
  },
  categoryContainer: {
    gap: hp(10),
  },
  alignCenter: {
    alignSelf: 'center',
  },
  cardStyles: {
    minHeight: hp(60),
  },
});
export default SignerCategoryList;
