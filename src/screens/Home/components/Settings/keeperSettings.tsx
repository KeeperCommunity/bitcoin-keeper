import { Box, ScrollView, useColorMode } from 'native-base';
import React, { useContext, useEffect } from 'react';
import Colors from 'src/theme/Colors';
import PlebContainer from './Component/PlebContainer';
import InheritanceDocumentIcon from 'src/assets/images/inheritanceDocumentIcon.svg';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import InheritanceDocument from './Component/InheritanceDocument';
import SettingCard from './Component/SettingCard';
import NavButton from 'src/components/NavButton';
import { Pressable, StyleSheet } from 'react-native';
import openLink from 'src/utils/OpenLink';
import { KEEPER_WEBSITE_BASE_URL } from 'src/utils/service-utilities/config';
import Text from 'src/components/KeeperText';
import Twitter from 'src/assets/images/Twitter.svg';
import TwitterDark from 'src/assets/images/Twitter-white.svg';
import NosterIcon from 'src/assets/images/noster.svg';
import NosterDarkIcon from 'src/assets/images/noster-white.svg';
import Telegram from 'src/assets/images/Telegram.svg';
import TelegramDark from 'src/assets/images/Telegram-white.svg';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import { CommonActions, useNavigation } from '@react-navigation/native';
import SettingModal from './Component/SettingModal';
import { useSettingKeeper } from 'src/hooks/useSettingKeeper';
import usePlan from 'src/hooks/usePlan';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { useAppSelector } from 'src/store/hooks';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';

const KeeperSettings = ({ route }) => {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText, inheritancePlanning, settings, common } = translations;
  const {
    BackAndRecovery,
    General,
    keysAndwallet,
    Tips,
    confirmPass,
    setConfirmPass,
    planData,
    DeleteBackupModal,
  } = useSettingKeeper();

  const isUaiFlow: boolean = route.params?.isUaiFlow ?? false;

  useEffect(() => {
    return () => {
      if (isUaiFlow) {
        navigation.setParams({ isUaiFlow: false });
      }
    };
  }, []); // Empty dependency array means this runs once on mount

  const { plan } = usePlan();
  const currentPlan = planData.find((p) => p.plan === plan);
  const { backupAllLoading } = useAppSelector((state) => state.bhr);
  const InheritanceDocument_border = ThemedColor({ name: 'InheritanceDocument_border' });

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <PlebContainer
        title={currentPlan.title}
        subtitle={currentPlan.subtitle}
        description={currentPlan.description}
        titleColor={`${colorMode}.whiteSecButtonText`}
        subtitleColor={`${colorMode}.whiteSecButtonText`}
        backgroundColor={Colors.GreenishGrey}
        onPress={() => {
          navigation.dispatch(CommonActions.navigate('ChoosePlan'));
        }}
        icon={currentPlan.icon}
        showDot={false}
      />
      <InheritanceDocument
        title={signerText.inheritanceDocuments}
        borderColor={InheritanceDocument_border}
        description={signerText.bitcoinSecurity}
        subtitleColor={`${colorMode}.balanceText`}
        backgroundColor={`${colorMode}.textInputBackground`}
        icon={<InheritanceDocumentIcon width={14} height={14} />}
        onPress={() => navigation.dispatch(CommonActions.navigate('InheritanceDocumentScreen'))}
      />
      <SettingCard
        header={inheritancePlanning.backupRecovery}
        subtitleColor={`${colorMode}.balanceText`}
        backgroundColor={`${colorMode}.textInputBackground`}
        borderColor={`${colorMode}.separator`}
        items={BackAndRecovery}
      />
      <SettingCard
        header={settings.General}
        subtitleColor={`${colorMode}.balanceText`}
        backgroundColor={`${colorMode}.textInputBackground`}
        borderColor={`${colorMode}.separator`}
        items={General}
      />
      <SettingCard
        header={settings.KeysWallets}
        subtitleColor={`${colorMode}.balanceText`}
        backgroundColor={`${colorMode}.textInputBackground`}
        borderColor={`${colorMode}.separator`}
        items={keysAndwallet}
      />
      <SettingCard
        header={common.tips}
        subtitleColor={`${colorMode}.balanceText`}
        backgroundColor={`${colorMode}.textInputBackground`}
        borderColor={`${colorMode}.separator`}
        items={Tips}
      />
      <Box backgroundColor={`${colorMode}.primaryBackground`}>
        <Box style={styles.bottomNav}>
          <NavButton
            icon={colorMode === 'dark' ? <TelegramDark /> : <Telegram />}
            heading="Telegram"
            link="https://telegram.me/bitcoinkeeper"
          />
          <NavButton
            icon={colorMode === 'dark' ? <TwitterDark /> : <Twitter />}
            heading="Twitter"
            link="https://twitter.com/bitcoinKeeper_"
          />
          <NavButton
            icon={colorMode === 'dark' ? <NosterDarkIcon /> : <NosterIcon />}
            heading="Nostr"
            link="https://primal.net/p/npub1mlzukkwhuhl3y7wd6kw20fz6s99l8d0uqtj4sskhvaaud8rwcuuszt2t6p"
          />
        </Box>

        <Text style={styles.disclaimer} color={`${colorMode}.termsText`} testID="disclaimer">
          {common.disclaimer}
        </Text>

        <Box style={styles.bottomLinkWrapper} backgroundColor={`${colorMode}.primaryBackground`}>
          <Pressable
            onPress={() => openLink(`${KEEPER_WEBSITE_BASE_URL}/terms-of-service/`)}
            testID="btn_termsCondition"
          >
            <Text
              style={styles.bottomLinkText}
              color={`${colorMode}.termsText`}
              testID="text_termsCondition"
            >
              {common.TermsConditions}
            </Text>
          </Pressable>
          <Text color={`${colorMode}.termsText`}>|</Text>
          <Pressable
            onPress={() => openLink(`${KEEPER_WEBSITE_BASE_URL}/privacy-policy/`)}
            testID="btn_privacyPolicy"
          >
            <Text
              style={styles.bottomLinkText}
              color={`${colorMode}.termsText`}
              testID="text_privacyPolicy"
            >
              {common.PrivacyPolicy}
            </Text>
          </Pressable>
        </Box>
      </Box>
      <SettingModal
        isUaiFlow={isUaiFlow}
        confirmPass={confirmPass}
        setConfirmPass={setConfirmPass}
      />
      {DeleteBackupModal}
      <ActivityIndicatorView visible={backupAllLoading} showLoader />
    </ScrollView>
  );
};

export default KeeperSettings;

const styles = StyleSheet.create({
  bottomNav: {
    width: windowWidth * 0.88,
    flexDirection: 'row',
    gap: wp(10),
    justifyContent: 'center',
  },

  bottomLinkWrapper: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 15,
    marginBottom: hp(20),
  },
  bottomLinkText: {
    fontSize: 13,
    letterSpacing: 0.13,
  },
  disclaimer: {
    maxWidth: '99%',
    fontSize: 11,
    textAlign: 'center',
    marginVertical: hp(10),
  },
});
