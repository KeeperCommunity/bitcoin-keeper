import Text from 'src/components/KeeperText';
import { Box, Pressable, ScrollView, useColorMode } from 'native-base';
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet } from 'react-native';
import RestClient, { TorStatus } from 'src/services/rest/RestClient';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { setTorEnabled } from 'src/store/reducers/settings';
import { TorContext } from 'src/context/TorContext';
import { useDispatch } from 'react-redux';
import useToastMessage from 'src/hooks/useToastMessage';
import KeeperModal from 'src/components/KeeperModal';
import Note from 'src/components/Note/Note';
import OptionCard from 'src/components/OptionCard';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import IconRefreshLight from 'src/assets/images/iconRefreshLight.svg';
import IconRefreshDark from 'src/assets/images/iconRefreshDark.svg';
import OrbotImage from 'src/assets/images/orbotImage.svg';
import TorImage from 'src/assets/images/torImage.svg';

import TorModalMap from './TorModalMap';
import Instruction from 'src/components/Instruction';
import { hp, wp } from 'src/constants/responsive';
import WalletHeader from 'src/components/WalletHeader';

function TorSettings() {
  const { colorMode } = useColorMode();
  const {
    torStatus,
    setTorStatus,
    orbotTorStatus,
    inAppTor,
    openOrbotApp,
    checkTorConnection,
    globalTorStatus,
  } = useContext(TorContext);
  const { translations } = useContext(LocalizationContext);
  const { settings, common, error: errorText, wallet } = translations;
  const dispatch = useDispatch();
  const [showTorModal, setShowTorModal] = useState(false);
  const [showOrbotTorModal, setShowOrbotTorModal] = useState(false);
  const { showToast } = useToastMessage();
  const isDarkMode = colorMode === 'dark';
  const appState = useRef(AppState.currentState);

  const handleAppStateChange = (nextAppState) => {
    if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
      checkTorConnection();
    }
    appState.current = nextAppState;
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    checkTorConnection();
  }, []);

  useEffect(() => {
    if (inAppTor === TorStatus.CONNECTED || inAppTor === TorStatus.ERROR) {
      setShowTorModal(false);
    }
    checkTorConnection();
  }, [inAppTor]);

  const getTorStatusText = useMemo(() => {
    switch (torStatus) {
      case TorStatus.OFF:
        return settings.torDisabled;
      case TorStatus.CONNECTING:
        return settings.connectingToTor;
      case TorStatus.CONNECTED:
        return settings.torEnabled;
      case TorStatus.ERROR:
        return settings.torError;
      case TorStatus.CHECKING:
        return settings.Checking;
      case TorStatus.CHECK_STATUS:
        return settings.CheckingStatus;
      default:
        return torStatus;
    }
  }, [torStatus]);

  const handleInAppTor = () => {
    showToast(wallet.connectionErrorDesc);
    return;
  };

  const handleOrbotTor = () => {
    setShowOrbotTorModal(false);
    if (inAppTor === TorStatus.CONNECTED || inAppTor === TorStatus.CONNECTING) {
      RestClient.setUseTor(false);
      setShowTorModal(false);
    }
    openOrbotApp();
    setTorStatus(TorStatus.CHECK_STATUS);
  };

  const getTorConnectionType = React.useMemo(() => {
    return inAppTor === TorStatus.CONNECTED
      ? `in-app${settings.torConnectionString}`
      : globalTorStatus === TorStatus.CONNECTED
      ? `Orbot${settings.torConnectionString}`
      : '';
  }, [inAppTor, globalTorStatus]);

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={settings.torSettingTitle} subTitle={settings.torHeaderSubTitle} />
      <ScrollView contentContainerStyle={{ paddingTop: 30, alignItems: 'center' }}>
        <Box style={styles.torStatusContainer} backgroundColor={`${colorMode}.seashellWhite`}>
          {inAppTor === TorStatus.CONNECTED || globalTorStatus === TorStatus.CONNECTED ? (
            <Box style={styles.torConnectionTypeCtr}>
              {inAppTor === TorStatus.CONNECTED ? <TorImage /> : <OrbotImage />}
              <Text style={styles.torConnectionType} color={`${colorMode}.primaryText`}>
                {getTorConnectionType}
              </Text>
            </Box>
          ) : (
            <>
              <Box style={styles.torStatusInfo}>
                <Text style={styles.torStatusTitle} semiBold color={`${colorMode}.primaryText`}>
                  {settings.CurrentStatus}
                </Text>
                <Text style={styles.torStatusText} color={`${colorMode}.GreyText`}>
                  {getTorStatusText}
                </Text>
              </Box>
              <Pressable style={styles.torStatusButton} onPress={() => checkTorConnection()}>
                {isDarkMode ? <IconRefreshDark /> : <IconRefreshLight />}
              </Pressable>
            </>
          )}
        </Box>

        <OptionCard
          title={settings.torViaOrbot}
          description={settings.torViaOrbotSubTitle}
          callback={() => setShowOrbotTorModal(true)}
        />
        <OptionCard
          title={
            inAppTor === TorStatus.CONNECTED
              ? settings.deactivateInAppTor
              : settings.activateInAppTor
          }
          description={
            inAppTor === TorStatus.CONNECTED
              ? settings.inAppTorSubTitle2
              : settings.inAppTorSubTitle
          }
          callback={() => handleInAppTor()}
        />
      </ScrollView>
      <Box style={styles.note}>
        <Note
          title={common.note}
          subtitle={settings.torSettingsNoteSubTitle}
          subtitleColor="GreyText"
        />
      </Box>
      <TorModalMap visible={showTorModal} close={() => setShowTorModal(false)} />
      <KeeperModal
        visible={showOrbotTorModal}
        close={() => {
          setShowOrbotTorModal(false);
        }}
        closeOnOverlayClick={true}
        dismissible={true}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        title={settings.orbotConnection}
        subTitle={settings.orbotConnectionSubTitle}
        showCloseIcon={false}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        secButtonTextColor={`${colorMode}.pantoneGreen`}
        secondaryButtonText={common.Later}
        secondaryCallback={() => setShowOrbotTorModal(false)}
        buttonText={common.connect}
        buttonCallback={handleOrbotTor}
        Content={() => (
          <Box style={styles.orbotContent}>
            <Instruction text={settings.torDescription} textWidth={wp(275)} />
          </Box>
        )}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  note: {
    marginHorizontal: '2%',
  },
  torStatusContainer: {
    flexDirection: 'row',
    padding: 15,
    width: '95%',
    margin: 15,
    borderRadius: 10,
    justifyContent: 'space-between',
    height: hp(70),
    alignItems: 'center',
  },
  torStatusInfo: {
    width: '60%',
  },
  torStatusTitle: {
    fontSize: 14,
  },
  torStatusText: {
    fontSize: 12,
  },
  torStatusButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkStatusBtnTitle: {
    fontSize: 12,
  },
  orbotContent: {
    alignItems: 'flex-start',
    marginBottom: hp(10),
  },
  torConnectionType: {
    fontSize: 14,
  },
  torConnectionTypeCtr: {
    flexDirection: 'row',
    gap: wp(10),
    alignItems: 'center',
  },
});

export default TorSettings;
