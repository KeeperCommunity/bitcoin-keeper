import React, { useContext, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import Text from 'src/components/KeeperText';
import { VaultSigner } from 'src/services/wallets/interfaces/vault';
import { useDispatch } from 'react-redux';
import { useAppSelector } from 'src/store/hooks';
import { SerializedPSBTEnvelop } from 'src/services/wallets/interfaces';
import { updatePSBTEnvelops } from 'src/store/reducers/send_and_receive';
import { captureError } from 'src/services/sentry';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import {
  assertOneKeyFingerprint,
  ensureOneKeyBLEReady,
  getOneKeyDeviceInfo,
  searchOneKeyDevices,
  signPsbtWithOneKey,
  onekeyUIEmitter,
  ONEKEY_UI_EVENT,
  type OneKeyUIEvent,
} from 'src/services/onekeyBle';
import { UI_REQUEST } from '@onekeyfe/hd-core';
import useSignerFromKey from 'src/hooks/useSignerFromKey';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { validatePSBT } from 'src/utils/utilities';
import { NetworkType } from 'src/services/wallets/enums';

const UI_PROMPTS: Record<string, string> = {
  [UI_REQUEST.REQUEST_PIN]: 'Please enter PIN on your OneKey device',
  [UI_REQUEST.REQUEST_BUTTON]: 'Please confirm on your OneKey device',
};

type SignWithOneKeyBleParams = {
  vaultKey: VaultSigner;
  isRemoteKey?: boolean;
  serializedPSBTEnvelopFromProps?: SerializedPSBTEnvelop;
  signTransaction: (args: { signedSerializedPSBT: string }) => void;
};

function SignWithOneKeyBle() {
  const { colorMode } = useColorMode();
  const { params } = useRoute();
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const { common, error: errorText } = translations;

  const {
    vaultKey,
    isRemoteKey = false,
    serializedPSBTEnvelopFromProps,
    signTransaction,
  } = params as SignWithOneKeyBleParams;

  const { signer } = useSignerFromKey(vaultKey);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const serializedPSBTEnvelops: SerializedPSBTEnvelop[] = useAppSelector(
    (state) => state.sendAndReceive.sendPhaseTwo.serializedPSBTEnvelops
  );

  const serializedPSBTEnvelop = useMemo(() => {
    if (isRemoteKey) return serializedPSBTEnvelopFromProps;
    return serializedPSBTEnvelops?.find((envelop) => envelop.xfp === vaultKey.xfp);
  }, [isRemoteKey, serializedPSBTEnvelopFromProps, serializedPSBTEnvelops, vaultKey.xfp]);

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
    const timer = setTimeout(() => runAutoSign(), 300);
    return () => clearTimeout(timer);
  }, []);

  const runAutoSign = async () => {
    if (!serializedPSBTEnvelop?.serializedPSBT) {
      showToast('No PSBT found to sign', <ToastErrorIcon />);
      navigation.dispatch(CommonActions.goBack());
      return;
    }

    if (!signer) {
      showToast('Signer not found. Please try again.', <ToastErrorIcon />);
      navigation.dispatch(CommonActions.goBack());
      return;
    }

    try {
      setStatusMessage('Checking Bluetooth...');
      const bleReady = await ensureOneKeyBLEReady();
      if (!bleReady.ready) {
        showToast('Please turn on Bluetooth and try again', <ToastErrorIcon />);
        navigation.dispatch(CommonActions.goBack());
        return;
      }

      // Use stored connectId for direct connection
      const storedConnectId = signer?.extraData?.bleConnectId;
      if (!storedConnectId) {
        showToast('No stored connection info. Please re-add this device.', <ToastErrorIcon />);
        navigation.dispatch(CommonActions.goBack());
        return;
      }

      // BLE needs a brief scan to discover peripherals
      setStatusMessage('Connecting to device...');
      await searchOneKeyDevices();

      setSdkPrompt('');
      setStatusMessage('Reading device info...');
      const deviceInfo = await getOneKeyDeviceInfo(storedConnectId);
      assertOneKeyFingerprint(deviceInfo, signer);

      setSdkPrompt('');
      setStatusMessage('Signing transaction on device...');
      const signedSerializedPSBT = await signPsbtWithOneKey({
        connectId: storedConnectId,
        deviceId: deviceInfo.deviceId,
        networkType,
        serializedPSBT: serializedPSBTEnvelop.serializedPSBT,
      });

      setSdkPrompt('');
      validatePSBT(serializedPSBTEnvelop.serializedPSBT, signedSerializedPSBT, signer, errorText);

      dispatch(
        healthCheckStatusUpdate([
          { signerId: signer.masterFingerprint, status: hcStatusType.HEALTH_CHECK_SIGNING },
        ])
      );

      if (isRemoteKey) {
        signTransaction({ signedSerializedPSBT });
        navigation.dispatch(CommonActions.goBack());
        return;
      }

      dispatch(updatePSBTEnvelops({ signedSerializedPSBT, xfp: vaultKey.xfp }));
      navigation.dispatch(CommonActions.navigate({ name: 'SignTransactionScreen', merge: true }));
    } catch (error) {
      captureError(error);
      showToast(error?.message || common.somethingWrong, <ToastErrorIcon />);
      navigation.dispatch(CommonActions.goBack());
    }
  };

  const displayText = sdkPrompt || statusMessage;

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title="Sign Transaction" />
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

export default SignWithOneKeyBle;
