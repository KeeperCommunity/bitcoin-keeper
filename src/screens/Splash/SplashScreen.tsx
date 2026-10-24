import React, { useContext, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useColorMode } from '@gluestack-ui/themed-native-base';
import RestClient from 'src/services/rest/RestClient';
import { useAppSelector } from 'src/store/hooks';
import * as SecureStore from 'src/storage/secure-store';
import Animated, {
  interpolate,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { windowHeight, windowWidth } from 'src/constants/responsive';
import { useDispatch } from 'react-redux';
import config from 'src/utils/service-utilities/config';
import { NetworkType } from 'src/services/wallets/enums';
import { changeBitcoinNetwork } from 'src/store/sagaActions/settings';
import { setDefaultWalletCreated } from 'src/store/reducers/storage';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import KeeperModal from 'src/components/KeeperModal';
import { LocalizationContext } from 'src/context/Localization/LocContext';

function SplashScreen({ navigation }) {
  const { torEnbled, themeMode, bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const dispatch = useDispatch();
  const { toggleColorMode, colorMode } = useColorMode();

  const { translations } = useContext(LocalizationContext);
  const [startupError, setStartupError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const readPending = useRef(true);
  const mounted = useRef(false);
  const progress = useSharedValue(0);

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
    mounted.current = true;
    // The animation is decorative. Credential availability, rather than its
    // duration, determines when startup can advance.
    progress.value = withTiming(4, { duration: 3000 });
    if (themeMode === 'DARK' || themeMode === 'PRIVATE') {
      toggleColorMode();
    }
    RestClient.setUseTor(torEnbled);
    return () => {
      mounted.current = false;
      cancelAnimation(progress);
    };
  }, []);

  useEffect(() => {
    let current = true;
    readPending.current = true;
    const navigateToApp = async () => {
      try {
        const hasCreds = await SecureStore.hasPin({ throwOnError: true });
        if (!current) return;
        if (hasCreds) {
          navigation.replace('Login', { relogin: false });
        } else {
          navigation.replace('CreatePin');
        }
      } catch {
        if (current) {
          readPending.current = false;
          setStartupError(true);
        }
      }
    };
    navigateToApp();
    return () => {
      current = false;
    };
  }, [attempt, navigation]);

  const retryStartup = () => {
    if (!mounted.current || readPending.current) return;
    readPending.current = true;
    setStartupError(false);
    setAttempt((previous) => previous + 1);
  };

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
    <Animated.View style={styles.center}>
      <Animated.View style={animatedBackground} />
      <Animated.View style={animatedLogo}>
        <ThemedSvg name={'keeperLogo'} />
      </Animated.View>
      <KeeperModal
        visible={startupError}
        close={() => {}}
        showCloseIcon={false}
        dismissible={false}
        title={translations.common.somethingWrong}
        subTitle={translations.login.startupCredentialError}
        buttonText={translations.common.retry}
        buttonCallback={retryStartup}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SplashScreen;
