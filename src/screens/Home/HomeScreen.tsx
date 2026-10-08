import { AppState, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useContext, useEffect, useRef, useState } from 'react';
import useWallets from 'src/hooks/useWallets';
import { useAppSelector } from 'src/store/hooks';
import { NetworkType } from 'src/services/wallets/enums';
import useToastMessage from 'src/hooks/useToastMessage';
import { useDispatch } from 'react-redux';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { resetRealyWalletState, setHomeToastMessage } from 'src/store/reducers/bhr';
import InititalAppController from './InititalAppController';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { SentryErrorBoundary } from 'src/services/sentry';
import HomeScreenHeader from 'src/components/HomeScreenHeader';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import { hp, wp } from 'src/constants/responsive';
import MenuFooter from 'src/components/MenuFooter';
import HomeWallet from './components/Wallet/HomeWallet';
import ManageKeys from './components/Keys/ManageKeys';
import KeeperSettings from './components/Settings/keeperSettings';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import BuyBtc from './components/buyBtc/BuyBtc';
import KeeperModal from 'src/components/KeeperModal';
import Text from 'src/components/KeeperText';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import dbManager from 'src/storage/realm/dbManager';
import { setRecoveryKeyStatus } from 'src/store/reducers/account';
import RecoveryKeyIcon from 'src/assets/images/recover_white.svg';
import HelpAiEntry from '../HelpAi/HelpAiEntry';
import { autoSyncWallets } from 'src/store/sagaActions/wallets';

function NewHomeScreen({ route }) {
  const { colorMode } = useColorMode();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const { addedSigner, selectedOption: selectedOptionFromRoute } = route.params || {};
  const { wallets } = useWallets({ getAll: true });
  const [electrumErrorVisible, setElectrumErrorVisible] = useState(false);
  const home_header_circle_background = ThemedColor({ name: 'home_header_circle_background' });

  const { relayWalletUpdate, relayWalletError, realyWalletErrorMessage, homeToastMessage } =
    useAppSelector((state) => state.bhr);
  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const { home: homeTranslation, wallet: walletText, buyBTC: buyBTCText, askAi } = translations;
  const [selectedOption, setSelectedOption] = useState(
    selectedOptionFromRoute || walletText.homeWallets
  );
  const backupHistory = useQuery(RealmSchema.BackupHistory);
  const { recoveryKeyStatusByAppId } = useAppSelector((state) => state.account);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const isAuthenticated = useAppSelector((state) => state.login.isAuthenticated);
  const appState = useRef(AppState.currentState);
  const { id } = dbManager.getObjectByIndex(RealmSchema.KeeperApp) as any;

  // 'idle' | 'education' | 'skipWarning'
  const [recoveryKeyFlowState, setRecoveryKeyFlowState] = useState<
    'idle' | 'education' | 'skipWarning'
  >('idle');
  // Session flag: prevent re-showing the education sheet after the user dismisses it
  const hasShownEducationSheetRef = useRef(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appState.current?.match(/inactive|background/) && nextState === 'active' && isAuthenticated) {
        dispatch(autoSyncWallets(false, false, false, undefined, true));
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, [dispatch, isAuthenticated]);

  const recoveryKeyStatus = recoveryKeyStatusByAppId?.[id];
  const isConfirmed = recoveryKeyStatus === 'confirmed';

  const openEducationSheet = () => {
    setRecoveryKeyFlowState('education');
    hasShownEducationSheetRef.current = true;
  };

  useEffect(() => {
    if (selectedOptionFromRoute && selectedOptionFromRoute !== selectedOption) {
      setSelectedOption(selectedOptionFromRoute);
    }
  }, [selectedOptionFromRoute]);

  // Show education sheet once per session when Recovery Key is not confirmed
  useEffect(() => {
    if (!isConfirmed && !hasShownEducationSheetRef.current) {
      openEducationSheet();
    }
  }, [isConfirmed]);

  useFocusEffect(
    React.useCallback(() => {
      if (
        !isConfirmed &&
        !hasShownEducationSheetRef.current &&
        selectedOption !== walletText.more
      ) {
        const timer = setTimeout(() => {
          openEducationSheet();
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [isConfirmed, selectedOption, walletText.more])
  );

  const getContent = () => {
    switch (selectedOption) {
      case walletText.homeWallets:
        return {
          content: (
            <Box>
              <HomeWallet />
            </Box>
          ),
          icon: (
            <CircleIconWrapper
              width={wp(39)}
              icon={<ThemedSvg name={'header_Wallet'} />}
              backgroundColor={home_header_circle_background}
            />
          ),
        };
      case walletText.keys:
        return {
          content: (
            <Box>
              <ManageKeys addedSigner={addedSigner} />
            </Box>
          ),
          icon: (
            <CircleIconWrapper
              width={wp(39)}
              icon={<ThemedSvg name={'header_key'} />}
              backgroundColor={home_header_circle_background}
            />
          ),
        };
      case buyBTCText.acquire:
        return {
          content: (
            <Box>
              <BuyBtc />
            </Box>
          ),
          icon: (
            <CircleIconWrapper
              width={wp(39)}
              icon={<ThemedSvg name={'header_buy_btc'} width={wp(22)} height={hp(22)} />}
              backgroundColor={home_header_circle_background}
            />
          ),
        };
      case askAi.ask:
        return {
          content: <HelpAiEntry route={route} />,
          icon: (
            <CircleIconWrapper
              width={wp(39)}
              icon={
                <ThemedSvg
                  name={'header_concierge'}
                  width={wp(20)}
                  height={hp(20)}
                  style={{ marginRight: wp(1), marginBottom: hp(1) }}
                />
              }
              backgroundColor={home_header_circle_background}
            />
          ),
        };
      case walletText.more:
        return {
          content: (
            <Box>
              <KeeperSettings route={route} />
            </Box>
          ),
          icon: (
            <CircleIconWrapper
              width={wp(39)}
              icon={<ThemedSvg name={'header_more'} />}
              backgroundColor={home_header_circle_background}
            />
          ),
        };
      default:
        return { content: null, icon: null };
    }
  };

  const { content, icon } = getContent();

  useEffect(() => {
    if (relayWalletError) {
      showToast(
        realyWalletErrorMessage || homeTranslation.RelayWalletErrorMessage,
        <ToastErrorIcon />
      );
      dispatch(resetRealyWalletState());
    }
  }, [relayWalletUpdate, relayWalletError, wallets]);

  useEffect(() => {
    if (homeToastMessage?.message) {
      showToast(
        homeToastMessage.message,
        homeToastMessage?.isError ? <ToastErrorIcon /> : <TickIcon />
      );
      dispatch(setHomeToastMessage({ message: null, isError: false }));
    }
  }, [homeToastMessage]);

  const EducationSheetContent = () => (
    <Box style={{ gap: hp(10) }}>
      <Text color={`${colorMode}.primaryText`} style={{ fontSize: 14, letterSpacing: 0.13 }}>
        {homeTranslation.educationSheetBody}
      </Text>
    </Box>
  );

  const SkipWarningContent = () => (
    <Box style={{ gap: hp(10) }}>
      <Box backgroundColor={`${colorMode}.greyBorder`} style={{ padding: hp(12), borderRadius: 8 }}>
        <Text color={`${colorMode}.primaryText`} style={{ fontSize: 13 }}>
          {homeTranslation.skipWarningBox}
        </Text>
      </Box>
      <Box backgroundColor={`${colorMode}.greyBorder`} style={{ padding: hp(12), borderRadius: 8 }}>
        <Text color={`${colorMode}.primaryText`} style={{ fontSize: 13 }}>
          {homeTranslation.skipWarningInfoBox}
        </Text>
      </Box>
    </Box>
  );

  return (
    <Box backgroundColor={`${colorMode}.primaryBackground`} style={styles.container}>
      <InititalAppController
        navigation={navigation}
        electrumErrorVisible={electrumErrorVisible}
        setElectrumErrorVisible={setElectrumErrorVisible}
      />

      <HomeScreenHeader
        colorMode={colorMode}
        title={selectedOption}
        titleSuffix={
          [walletText.homeWallets, walletText.keys].includes(selectedOption) &&
          bitcoinNetworkType === NetworkType.TESTNET
            ? ' (Testnet)'
            : undefined
        }
        circleIconWrapper={icon}
      />
      {recoveryKeyStatus === 'skipped' && (
        <TouchableOpacity onPress={openEducationSheet}>
          <Box
            backgroundColor={`${colorMode}.DarkSlateGray`}
            width={'100%'}
            style={{ paddingHorizontal: wp(22), paddingVertical: hp(10) }}
            flexDir={'row'}
            justifyContent={'center'}
            alignItems={'center'}
          >
            <RecoveryKeyIcon />
            <Box flex={1} marginLeft={wp(15)}>
              <Text semiBold fontSize={14} color={`${colorMode}.buttonText`}>
                {homeTranslation.recoveryKeyNotBackedUp}
              </Text>
              <Text medium fontSize={12} color={`${colorMode}.buttonText`}>
                {homeTranslation.backUpNow}
              </Text>
            </Box>
          </Box>
        </TouchableOpacity>
      )}
      {/* Keep tab descendants (including elevated FABs) out of the footer's native parent. */}
      <View key={selectedOption} collapsable={false} style={styles.content}>
        {content}
      </View>
      <MenuFooter
        selectedOption={selectedOption}
        onOptionChange={(option) => {
          navigation.navigate('Home', { selectedOption: option });
        }}
      />

      {/* Education Sheet */}
      <KeeperModal
        visible={recoveryKeyFlowState === 'education'}
        close={() => setRecoveryKeyFlowState('idle')}
        title={homeTranslation.educationSheetTitle}
        subTitle={''}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        showCloseIcon={false}
        buttonText={homeTranslation.backUpNow}
        buttonCallback={() => {
          setRecoveryKeyFlowState('idle');
          dispatch(setRecoveryKeyStatus({ appId: id, status: 'viewed' }));
          navigation.navigate('ViewRecoveryKeyScreen');
        }}
        buttonTextColor={`${colorMode}.buttonText`}
        secondaryButtonText={homeTranslation.skipForNow}
        secondaryCallback={() => setRecoveryKeyFlowState('skipWarning')}
        Content={EducationSheetContent}
      />

      {/* Skip Warning Sheet */}
      <KeeperModal
        visible={recoveryKeyFlowState === 'skipWarning'}
        close={() => setRecoveryKeyFlowState('education')}
        title={homeTranslation.skipWarningTitle}
        subTitle={homeTranslation.skipWarningBody}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        showCloseIcon={false}
        buttonBackground={`${colorMode}.pantoneGreen`}
        buttonText={homeTranslation.backUpRecoveryKey}
        buttonCallback={() => {
          setRecoveryKeyFlowState('idle');
          dispatch(setRecoveryKeyStatus({ appId: id, status: 'viewed' }));
          navigation.navigate('ViewRecoveryKeyScreen');
        }}
        buttonTextColor={`${colorMode}.buttonText`}
        secondaryButtonText={homeTranslation.continueWithoutBackup}
        secondaryCallback={() => {
          dispatch(setRecoveryKeyStatus({ appId: id, status: 'skipped' }));
          setRecoveryKeyFlowState('idle');
        }}
        Content={SkipWarningContent}
        subTitleWidth={wp(270)}
      />
    </Box>
  );
}

export default SentryErrorBoundary(NewHomeScreen);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingTop: hp(22),
  },
});
