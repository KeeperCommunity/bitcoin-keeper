import { StyleSheet } from 'react-native';
import { Box, useColorMode } from 'native-base';
import React, { useContext, useEffect, useState } from 'react';
import useWallets from 'src/hooks/useWallets';
import { useAppSelector } from 'src/store/hooks';
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
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import BuyBtc from './components/buyBtc/BuyBtc';
import ConciergeComponent from './components/ConciergeComponent';
import KeeperModal from 'src/components/KeeperModal';
import Text from 'src/components/KeeperText';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import dbManager from 'src/storage/realm/dbManager';

function NewHomeScreen({ route }) {
  const { colorMode } = useColorMode();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const { addedSigner, selectedOption: selectedOptionFromRoute } = route.params || {};
  const { wallets } = useWallets({ getAll: true });
  const [electrumErrorVisible, setElectrumErrorVisible] = useState(false);
  const [backupModalVisible, setBackupModalVisible] = useState(true);
  const home_header_circle_background = ThemedColor({ name: 'home_header_circle_background' });

  const { relayWalletUpdate, relayWalletError, realyWalletErrorMessage, homeToastMessage } =
    useAppSelector((state) => state.bhr);
  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const { home: homeTranslation, wallet: walletText, buyBTC: buyBTCText, common } = translations;
  const [selectedOption, setSelectedOption] = useState(
    selectedOptionFromRoute || walletText.homeWallets
  );
  const backupHistory = useQuery(RealmSchema.BackupHistory);
  const { recoveryKeyBackedUpByAppId } = useAppSelector((state) => state.account);
  const { id } = dbManager.getObjectByIndex(RealmSchema.KeeperApp) as any;
  const shouldShowBackupModal = !(recoveryKeyBackedUpByAppId?.[id] ?? false);

  useEffect(() => {
    if (selectedOptionFromRoute && selectedOptionFromRoute !== selectedOption) {
      setSelectedOption(selectedOptionFromRoute);
    }
  }, [selectedOptionFromRoute]);

  useEffect(() => {
    if (shouldShowBackupModal) {
      setBackupModalVisible(true);
    }
  }, [shouldShowBackupModal]);

  useFocusEffect(
    React.useCallback(() => {
      if (shouldShowBackupModal && selectedOption !== walletText.more) {
        const timer = setTimeout(() => {
          setBackupModalVisible(true);
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [shouldShowBackupModal, selectedOption, walletText.more])
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
      case walletText.concierge:
        return {
          content: (
            <Box>
              <ConciergeComponent route={route} />
            </Box>
          ),
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

  const BackupModalContent = () => {
    return (
      <Box style={{ gap: hp(10) }}>
        <Text color={`${colorMode}.primaryText`} style={{ fontSize: 14, letterSpacing: 0.13 }}>
          {homeTranslation.backupModalDesc}
        </Text>
      </Box>
    );
  };

  return (
    <Box backgroundColor={`${colorMode}.primaryBackground`} style={styles.container}>
      <InititalAppController
        navigation={navigation}
        electrumErrorVisible={electrumErrorVisible}
        setElectrumErrorVisible={setElectrumErrorVisible}
      />

      <HomeScreenHeader colorMode={colorMode} title={selectedOption} circleIconWrapper={icon} />
      <Box style={styles.content}>{content}</Box>
      <MenuFooter
        selectedOption={selectedOption}
        onOptionChange={(option) => {
          navigation.navigate('Home', { selectedOption: option });
        }}
      />
      <KeeperModal
        visible={shouldShowBackupModal && backupModalVisible}
        close={() => {}}
        title={homeTranslation.backupModalTitle}
        subTitle={homeTranslation.backupModalSubTitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        showCloseIcon={false}
        buttonText={common.continue}
        buttonCallback={() => {
          setBackupModalVisible(false);
          setTimeout(() => {
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'ViewRecoveryKeyScreen' }],
              })
            );
          }, 300);
        }}
        buttonTextColor={`${colorMode}.buttonText`}
        Content={BackupModalContent}
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
