/* eslint-disable react/jsx-no-bind */
/* eslint-disable react/no-unstable-nested-components */
import { ActivityIndicator, StyleSheet, BackHandler } from 'react-native';
import Text from 'src/components/KeeperText';
import React, { useContext, useEffect, useState } from 'react';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import AppIcon from 'src/assets/images/new-app-icon.svg';
import ArrowIcon from 'src/assets/images/icon_arrow.svg';
import ArrowIconWhite from 'src/assets/images/icon_arrow_white.svg';
import KeeperModal from 'src/components/KeeperModal';
import Recover from 'src/assets/images/recover-app-icon.svg';
import ScreenWrapper from 'src/components/ScreenWrapper';
import messaging from '@react-native-firebase/messaging';
import { setupKeeperApp } from 'src/store/sagaActions/storage';
import useToastMessage from 'src/hooks/useToastMessage';
import { Box, Pressable, useColorMode } from 'native-base';
import LoadingAnimation from 'src/components/Loader';
import { updateFCMTokens } from 'src/store/sagaActions/notifications';
import BounceLoader from 'src/components/BounceLoader';
import openLink from 'src/utils/OpenLink';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { KEEPER_WEBSITE_BASE_URL } from 'src/utils/service-utilities/config';
import IconSettings from 'src/assets/images/settings.svg';
import IconGreySettings from 'src/assets/images/settings_grey.svg';
import { TouchableOpacity } from 'react-native-gesture-handler';
import Colors from 'src/theme/Colors';
import { useIsFocused } from '@react-navigation/native';
import Fonts from 'src/constants/Fonts';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';

export function Tile({ title, subTitle, onPress, Icon = null, loading = false }) {
  const { colorMode } = useColorMode();

  return (
    <Pressable
      onPress={onPress}
      backgroundColor={`${colorMode}.seashellWhite`}
      flexDirection="row"
      alignItems="center"
      width="100%"
      testID="btn_startNew"
      style={{ height: hp(80), borderRadius: hp(10) }}
      paddingX={2}
    >
      {Icon && <Box style={{ marginLeft: wp(20) }}>{Icon}</Box>}
      <Box
        style={{
          paddingVertical: hp(20),
          paddingLeft: wp(24),
          flex: 1,
        }}
      >
        <Text color={`${colorMode}.primaryText`} fontSize={14} style={{ marginBottom: hp(5) }}>
          {title}
        </Text>
        <Text color={`${colorMode}.placeHolderTextColor`} fontSize={12}>
          {subTitle}
        </Text>
      </Box>
      <Box style={styles.iconContainer}>
        {loading ? (
          <Box marginRight="10">
            <ActivityIndicator />
          </Box>
        ) : colorMode === 'light' ? (
          <ArrowIcon />
        ) : (
          <ArrowIconWhite />
        )}
      </Box>
    </Pressable>
  );
}
function StartNewModalContent() {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { login } = translations;
  const isMultiAccountFlow = !!useAppSelector((state) => state.account).allAccounts.length;
  return (
    <Box style={{ width: windowWidth * 0.8 }}>
      <Box>
        <Box>
          <Text color={`${colorMode}.secondaryText`} style={styles.startNewModalMessageText}>
            {login.NewSatrtWalet}
          </Text>
        </Box>
        {!isMultiAccountFlow && (
          <Box>
            <Text color={`${colorMode}.primaryText`} style={styles.startNewModalMessageText} bold>
              {login.RecoverApp}{' '}
            </Text>
            <Text color={`${colorMode}.secondaryText`} style={styles.startNewModalMessageText}>
              {login.RecoverExistingAppDesc}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

function NewKeeperApp({ navigation }: { navigation }) {
  const { colorMode } = useColorMode();
  const dispatch = useAppDispatch();
  const { appRecreated, appImageError } = useAppSelector((state) => state.bhr);
  const { appCreated } = useAppSelector((state) => state.storage);
  const { showToast } = useToastMessage();
  const [keeperInitiating, setInitiating] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [introModalVisible, setIntroModalVisible] = useState(false);
  const appCreationError = useAppSelector((state) => state.login.appCreationError);
  const { translations } = useContext(LocalizationContext);
  const { login, common, error: errorText, home } = translations;
  const isFocused = useIsFocused();
  const isMultiAccountFlow = !!useAppSelector((state) => state.account).allAccounts.length;

  useEffect(() => {
    if (appCreated) {
      setInitiating(false);
      updateFCM();
    }
    if (appCreationError) {
      setModalVisible(false);
      setInitiating(false);
    }
  }, [appCreated, appCreationError]);

  async function updateFCM() {
    try {
      const token = await messaging().getToken();
      dispatch(updateFCMTokens([token]));
    } catch (error) {
      //
    }
  }

  useEffect(() => {
    if (appImageError && isFocused) {
      showToast(errorText.failedToGetAppImage);
    }
  }, [appImageError]);

  useEffect(() => {
    if (appRecreated) {
      setTimeout(() => {
        navigation.replace('App', { screen: 'Home' });
      }, 3000);
    }
  }, [appRecreated]);

  useEffect(() => {
    const backAction = () => true;
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, []);

  useEffect(() => {
    if (keeperInitiating) {
      setModalVisible(true);
      createNewApp();
    }
  }, [keeperInitiating]);

  async function createNewApp() {
    try {
      const fcmToken = await messaging().getToken();
      dispatch(setupKeeperApp(fcmToken));
    } catch (error) {
      dispatch(setupKeeperApp());
    }
  }

  const getSignUpModalContent = () => ({
    title: home.settingUpYourApp,
    subTitle: home.createSingleAndMultisig,
    message: home.stackSats,
  });

  function SignUpModalContent() {
    return (
      <Box style={{ width: windowWidth * 0.8 }}>
        <Box style={{ width: windowWidth * 0.8, marginBottom: hp(20) }}>
          <LoadingAnimation />
        </Box>
        <Text color={`${colorMode}.secondaryText`} style={styles.contentText}>
          {getSignUpModalContent().message}
        </Text>
        {!appCreated ? (
          <Box style={styles.modalMessageWrapper}>
            <Box style={{ width: '80%' }}>
              <Text color={`${colorMode}.secondaryText`} style={styles.modalMessageText}>
                {login.Wait}
              </Text>
            </Box>
            <Box style={{ width: '20%' }}>
              <BounceLoader />
            </Box>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <ScreenWrapper barStyle="dark-content" backgroundcolor={`${colorMode}.primaryBackground`}>
      <Box flexDir={'row'} width="100%">
        <TouchableOpacity
          style={styles.settingIconWrapper}
          onPress={() => navigation.navigate('NodeSettings')}
          testID="btn_AppSettingsIcon"
        >
          {colorMode === 'light' ? <IconGreySettings /> : <IconSettings />}
          <Text
            style={styles.settingIconText}
            color={colorMode === 'light' ? Colors.secondaryLightGrey : Colors.bodyText}
            semiBold
          >
            {common.serverSettings}
          </Text>
        </TouchableOpacity>
        <Box flex={1}>
          <Pressable style={styles.learnMoreContainer} onPress={() => setIntroModalVisible(true)}>
            <ThemedSvg name={'info_icon'} width={20} height={20} />
          </Pressable>
        </Box>
      </Box>
      <Box style={styles.contentContainer}>
        <Box>
          <Box style={styles.headingContainer}>
            <Text color={`${colorMode}.textGreen`} style={styles.headingText} fontSize={18}>
              {login.welcomeToBitcoinKeeper}
            </Text>
            <Text fontSize={14} color={`${colorMode}.secondaryText`}>
              {isMultiAccountFlow ? login.CreateAppOnly : login.CreateApp}
            </Text>
          </Box>
          <Pressable
            backgroundColor={`${colorMode}.thirdBackground`}
            borderColor={`${colorMode}.separator`}
            style={styles.tileContainer}
            testID="view_startNewTile"
            onPress={() => {
              setInitiating(true);
            }}
          >
            <AppIcon />
            <Box>
              <Text fontSize={13} color={`${colorMode}.black`}>
                {common.startNew}
              </Text>
              <Text fontSize={12} color={`${colorMode}.GreyText`}>
                {login.newKeeperAppDesc}
              </Text>
            </Box>
          </Pressable>
          {!isMultiAccountFlow && (
            <>
              <Pressable
                backgroundColor={`${colorMode}.thirdBackground`}
                borderColor={`${colorMode}.separator`}
                style={[styles.tileContainer, { marginBottom: 0 }]}
                testID="view_recoverTile"
                onPress={() => {
                  navigation.navigate('LoginStack', { screen: 'EnterSeedScreen' });
                }}
              >
                <Recover />
                <Box>
                  <Text fontSize={13} color={`${colorMode}.black`}>
                    {login.RecoverApp}
                  </Text>
                  <Text fontSize={12} color={`${colorMode}.GreyText`}>
                    {login.Enter12WordsRecovery}
                  </Text>
                </Box>
              </Pressable>
              <Box style={styles.recoveryNoteCtr}>
                <Text medium style={styles.recoveryNote}>
                  *
                </Text>
                <Text color={`${colorMode}.GreyText`} medium style={styles.recoveryNote}>
                  {
                    'If Assisted Server Backup was not enabled, you will start with a blank app and will have to add the wallets back.'
                  }
                </Text>
              </Box>
            </>
          )}
        </Box>
        <Box style={styles.note} backgroundColor={`${colorMode}.primaryBackground`}>
          <Text color={`${colorMode}.textGreen`} medium fontSize={14}>
            {login.Note}
          </Text>
          <Text fontSize={12} color={`${colorMode}.GreyText`}>
            {login.Agreement}
            <Text
              color={`${colorMode}.textGreen`}
              italic
              bold
              onPress={() => openLink(`${KEEPER_WEBSITE_BASE_URL}/terms-of-service/`)}
            >
              {' '}
              {login.TermsOfService}{' '}
            </Text>
            {'and our'}
            <Text
              color={`${colorMode}.textGreen`}
              italic
              bold
              onPress={() => openLink(`${KEEPER_WEBSITE_BASE_URL}/privacy-policy/`)}
            >
              {' '}
              {login.PrivacyPolicy}
            </Text>
          </Text>
        </Box>
      </Box>
      <KeeperModal
        dismissible={false}
        close={() => {}}
        visible={appCreationError}
        title={common.somethingWrong}
        subTitle={login.checkinternetConnection}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={Box}
        buttonText={common.retry}
        buttonCallback={() => {
          setInitiating(true);
        }}
        subTitleWidth={wp(250)}
        showCloseIcon={false}
      />
      <KeeperModal
        dismissible={false}
        close={() => {}}
        visible={modalVisible}
        title={getSignUpModalContent().title}
        subTitle={getSignUpModalContent().subTitle}
        Content={SignUpModalContent}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={appCreated ? common.next : null}
        buttonCallback={() => {
          setModalVisible(false);
          setTimeout(() => {
            navigation.replace('App', { screen: 'Home' });
          }, 500);
        }}
        subTitleWidth={wp(300)}
        showCloseIcon={false}
      />
      <KeeperModal
        dismissible={false}
        close={() => {}}
        visible={appCreationError}
        title={common.somethingWrong}
        subTitle={login.checkinternetConnection}
        Content={Box}
        buttonText={common.retry}
        buttonCallback={() => {
          setInitiating(true);
        }}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        subTitleWidth={wp(210)}
        showCloseIcon={false}
      />
      <KeeperModal
        close={() => {
          setIntroModalVisible(false);
        }}
        visible={introModalVisible}
        title={`${common.startNew}:`}
        Content={StartNewModalContent}
        buttonText={common.continue}
        buttonCallback={() => {
          setIntroModalVisible(false);
        }}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonTextColor={`${colorMode}.buttonText`}
        subTitleWidth={wp(300)}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    marginRight: wp(25),
  },
  settingIconWrapper: {
    marginTop: hp(14),
    marginLeft: wp(20),
    flexDirection: 'row',
  },
  settingIconText: {
    marginLeft: wp(8),
    fontSize: 12,
  },
  tileContainer: {
    marginBottom: hp(40),
    width: '100%',
    height: hp(125),
    paddingTop: 20,
    paddingHorizontal: 30,
    gap: 10,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
  },
  title: {
    fontSize: 14,
    letterSpacing: 1.12,
  },
  subTitle: {
    fontSize: 12,
    letterSpacing: 0.6,
  },
  modalMessageWrapper: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'center',
  },
  modalMessageText: {
    fontSize: 13,
    letterSpacing: 0.13,
    paddingTop: 20,
  },
  startNewModalMessageText: {
    fontSize: 13,
    letterSpacing: 0.13,
    paddingTop: 5,
  },
  contentText: {
    fontSize: 13,
    letterSpacing: 0.13,
    width: '100%',
  },
  learnMoreContainer: {
    marginTop: hp(10),
    alignSelf: 'flex-end',
    paddingVertical: 2,
    paddingHorizontal: 5,
  },
  learnMoreText: {
    fontSize: 12,
    letterSpacing: 0.24,
  },
  contentContainer: {
    justifyContent: 'space-between',
    flex: 1,
    marginHorizontal: 10,
    marginBottom: 20,
  },
  headingContainer: {
    marginTop: 20,
    marginBottom: 30,
    marginLeft: 10,
  },
  note: {
    width: wp(280),
  },
  headingText: {
    fontFamily: Fonts.LoraMedium,
    marginBottom: 5,
  },
  recoveryNote: { fontSize: 12, maxWidth: '99%' },
  recoveryNoteCtr: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    marginTop: hp(10),
    gap: wp(5),
  },
});

export default NewKeeperApp;
