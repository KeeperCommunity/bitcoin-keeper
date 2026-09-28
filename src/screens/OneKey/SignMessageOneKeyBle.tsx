import React, { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import Text from 'src/components/KeeperText';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import TickIcon from 'src/assets/images/icon_tick.svg';
import { useAppSelector } from 'src/store/hooks';
import { NetworkType } from 'src/services/wallets/enums';
import {
  assertOneKeyFingerprint,
  ensureOneKeyBLEReady,
  getOneKeyDeviceInfo,
  searchOneKeyDevices,
  signMessageWithOneKey,
  onekeyUIEmitter,
  ONEKEY_UI_EVENT,
  type OneKeyUIEvent,
} from 'src/services/onekeyBle';
import { UI_REQUEST } from '@onekeyfe/hd-core';
import { captureError } from 'src/services/sentry';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import type { Signer } from 'src/services/wallets/interfaces/vault';

const UI_PROMPTS: Record<string, string> = {
  [UI_REQUEST.REQUEST_PIN]: 'Please enter PIN on your OneKey device',
  [UI_REQUEST.REQUEST_BUTTON]: 'Please confirm on your OneKey device',
};

type Params = {
  message: string;
  address: string;
  derivationPath: string;
  signer: Signer;
  onSignatureReceived: (signature: string, address: string) => void;
};

function SignMessageOneKeyBle() {
  const { colorMode } = useColorMode();
  const { params } = useRoute();
  const navigation = useNavigation();
  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const { common } = translations;

  const { message, address, derivationPath, signer, onSignatureReceived } = params as Params;

  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const networkType =
    bitcoinNetworkType === NetworkType.TESTNET ? NetworkType.TESTNET : NetworkType.MAINNET;

  const [statusMessage, setStatusMessage] = useState('Preparing...');
  const [sdkPrompt, setSdkPrompt] = useState('');

  // Listen to SDK UI events
  useEffect(() => {
    const sub = onekeyUIEmitter.addListener(ONEKEY_UI_EVENT, (event: OneKeyUIEvent) => {
      if (UI_PROMPTS[event]) {
        setSdkPrompt(UI_PROMPTS[event]);
      }
    });
    return () => sub.remove();
  }, []);

  // Auto-run on mount
  useEffect(() => {
    const timer = setTimeout(() => runSignMessage(), 300);
    return () => clearTimeout(timer);
  }, []);

  const runSignMessage = async () => {
    try {
      if (!signer || !derivationPath) {
        showToast('Signer not found. Please try again.', <ToastErrorIcon />);
        navigation.dispatch(CommonActions.goBack());
        return;
      }

      const bleReady = await ensureOneKeyBLEReady();
      if (!bleReady.ready) {
        showToast('Please turn on Bluetooth and try again', <ToastErrorIcon />);
        navigation.dispatch(CommonActions.goBack());
        return;
      }

      const storedConnectId = signer?.extraData?.bleConnectId;
      if (!storedConnectId) {
        showToast('No stored connection info. Please re-add this device.', <ToastErrorIcon />);
        navigation.dispatch(CommonActions.goBack());
        return;
      }

      // BLE needs a brief scan to discover peripherals
      setStatusMessage('Connecting to device...');
      await searchOneKeyDevices();

      setStatusMessage('Reading device info...');
      setSdkPrompt('');
      const deviceInfo = await getOneKeyDeviceInfo(storedConnectId);
      assertOneKeyFingerprint(deviceInfo, signer);

      setStatusMessage('Signing message...');
      setSdkPrompt('');
      const result = await signMessageWithOneKey({
        connectId: storedConnectId,
        deviceId: deviceInfo.deviceId,
        path: derivationPath,
        message,
        networkType,
      });

      setSdkPrompt('');
      if (address && result.address !== address) {
        showToast('Address mismatch! The signed address does not match.', <ToastErrorIcon />);
        navigation.dispatch(CommonActions.goBack());
        return;
      }

      showToast('Message signed successfully', <TickIcon />);
      onSignatureReceived?.(result.signature, result.address);
      navigation.dispatch(CommonActions.goBack());
    } catch (error) {
      captureError(error);
      showToast(error?.message || common.somethingWrong, <ToastErrorIcon />);
      navigation.dispatch(CommonActions.goBack());
    }
  };

  const displayText = sdkPrompt || statusMessage;

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title="Sign Message" />
      <Box style={styles.container}>
        <ActivityIndicator size="large" />
        <Text color={`${colorMode}.primaryText`} style={styles.statusText}>
          {displayText}
        </Text>
      </Box>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 20,
  },
  statusText: {
    fontSize: 15,
    textAlign: 'center',
  },
});

export default SignMessageOneKeyBle;
