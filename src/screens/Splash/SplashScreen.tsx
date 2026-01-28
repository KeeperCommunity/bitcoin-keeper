import React, { useContext, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Box, useColorMode } from 'native-base';
import RestClient from 'src/services/rest/RestClient';
import { useAppSelector } from 'src/store/hooks';
import * as SecureStore from 'src/storage/secure-store';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { hp, windowHeight, windowWidth } from 'src/constants/responsive';
import { useDispatch } from 'react-redux';
import config from 'src/utils/service-utilities/config';
import { NetworkType } from 'src/services/wallets/enums';
import { changeBitcoinNetwork } from 'src/store/sagaActions/settings';
import { setAppCreated, setDefaultWalletCreated } from 'src/store/reducers/storage';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import { restoreBackupKey } from 'src/services/backupfile';
import KeeperModal from 'src/components/KeeperModal';
import Text from 'src/components/KeeperText';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { clearHasCreds } from 'src/store/reducers/login';
import { setInitialNodesSaved } from 'src/store/reducers/network';
import { saveBackupMethodByAppId } from 'src/store/sagaActions/account';
import { setBackupType } from 'src/store/reducers/bhr';

function SplashScreen({ navigation }) {
  const { torEnbled, themeMode, bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const { appId } = useAppSelector((state) => state.storage);
  const dispatch = useDispatch();
  const { toggleColorMode, colorMode } = useColorMode();
  const { common, home } = useContext(LocalizationContext).translations;
  const [backupFailureModal, setBackupFailureModal] = useState(false);

  const animate = () => {
    progress.value = withTiming(4, { duration: 3000 }, (finished) => {
      if (finished) {
        runOnJS(navigateToApp)();
      }
    });
  };

  useEffect(() => {
    if (!bitcoinNetworkType) {
      dispatch(
        setDefaultWalletCreated({
          networkType: config.isDevMode() ? NetworkType.TESTNET : NetworkType.MAINNET,
          created: true,
        })
      );
      dispatch(
        changeBitcoinNetwork(config.isDevMode() ? NetworkType.TESTNET : NetworkType.MAINNET)
      );
    }
  }, []);

  useEffect(() => {
    animate();
    if (themeMode === 'DARK' || themeMode === 'PRIVATE') {
      toggleColorMode();
    }
    RestClient.setUseTor(torEnbled);
  }, []);

  const navigateToApp = async () => {
    try {
      const hasCreds = await SecureStore.hasPin();
      if (hasCreds) {
        navigation.replace('Login', { relogin: false });
      } else if (!hasCreds && appId) {
        const res = await restoreBackupKey();
        if (res) navigation.replace('Login', { relogin: false });
        else setBackupFailureModal(true);
      } else {
        navigation.replace('CreatePin');
      }
    } catch (err) {
      console.log(err);
    }
  };

  const progress = useSharedValue(0);
  const inputRange = [0, 1, 2, 3, 4];
  const heightRange = [0, windowHeight * 2, windowHeight * 2, windowHeight, windowHeight];
  const widthRange = [0, windowHeight * 2, windowHeight * 2, windowHeight, windowWidth];
  const radiusRange = [0, windowHeight, windowHeight * 2, 0, 0];
  const scaleRange = [4, 3, 1, 1, 1];
  const logoOpacityRange = [0, 0, 1, 1, 1];

  const SCALE_CONFIG = {
    overshootClamping: false,
    restSpeedThreshold: 1,
    stiffness: 100,
    restDisplacementThreshold: 0.1,
  };

  const animatedBackground = useAnimatedStyle(() => {
    const height = interpolate(progress.value, inputRange, heightRange);
    const width = interpolate(progress.value, inputRange, widthRange);
    const borderRadius = interpolate(progress.value, inputRange, radiusRange);
    return {
      position: 'absolute',
      height,
      width,
      borderRadius,
      backgroundColor:
        themeMode === 'PRIVATE' ? '#272421' : themeMode === 'PRIVATE_LIGHT' ? '#F6F2ED' : '#2F4F4F',
    };
  });

  const animatedLogo = useAnimatedStyle(() => {
    const scale = withSpring(interpolate(progress.value, inputRange, scaleRange), SCALE_CONFIG);
    const opacity = withSpring(
      interpolate(progress.value, inputRange, logoOpacityRange),
      SCALE_CONFIG
    );
    return {
      transform: [{ scale }],
      opacity,
    };
  });

  return (
    <>
      <Animated.View style={styles.center}>
        <Animated.View style={animatedBackground} />
        <Animated.View style={animatedLogo}>
          <ThemedSvg name={'keeperLogo'} />
        </Animated.View>
      </Animated.View>
      <KeeperModal
        visible={backupFailureModal}
        close={() => setBackupFailureModal(false)}
        title={home.backupFileFailTitle}
        subTitle={home.backupFileFailSubTitle}
        showCloseIcon={false}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        subTitleColor={`${colorMode}.secondaryText`}
        textColor={`${colorMode}.modalGreenTitle`}
        buttonText={common.continue}
        buttonCallback={() => {
          dispatch(clearHasCreds());
          dispatch(setAppCreated(false));
          dispatch(setInitialNodesSaved(false));
          dispatch(saveBackupMethodByAppId());
          dispatch(setBackupType(null));
          navigation.replace('LoginStack', {
            screen: 'CreatePin',
            params: {
              isForgot: true,
            },
          });
        }}
        Content={() => {
          return (
            <Box style={{ gap: hp(20) }}>
              <Text color={`${colorMode}.primaryText`} style={styles.modalMessageText}>
                {home.backupFileFailDesc1}
              </Text>
              <Text color={`${colorMode}.primaryText`} style={styles.modalMessageText}>
                {home.backupFileFailDesc2}
              </Text>
            </Box>
          );
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalMessageText: {
    fontSize: 14,
    letterSpacing: 0.13,
  },
});

export default SplashScreen;
