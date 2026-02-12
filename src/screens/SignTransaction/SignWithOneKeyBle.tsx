import React, { useContext, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { Box, useColorMode } from 'native-base';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import Text from 'src/components/KeeperText';
import Buttons from 'src/components/Buttons';
import { VaultSigner } from 'src/services/wallets/interfaces/vault';
import { useDispatch } from 'react-redux';
import { useAppSelector } from 'src/store/hooks';
import { SerializedPSBTEnvelop } from 'src/services/wallets/interfaces';
import { updatePSBTEnvelops } from 'src/store/reducers/send_and_receive';
import { captureError } from 'src/services/sentry';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { ensureOneKeyBLEReady, getOneKeyDeviceId, searchOneKeyDevices, signPsbtWithOneKey } from 'src/services/onekeyBle';
import useSignerFromKey from 'src/hooks/useSignerFromKey';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { validatePSBT } from 'src/utils/utilities';
import { NetworkType } from 'src/services/wallets/enums';

function SignWithOneKeyBle() {
  const { colorMode } = useColorMode();
  const { params } = useRoute();
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const { common, error: errorText, walletTransactions } = translations;

  const {
    vaultKey,
    isRemoteKey = false,
    serializedPSBTEnvelopFromProps,
    signTransaction,
  } = params as {
    vaultKey: VaultSigner;
    isRemoteKey?: boolean;
    serializedPSBTEnvelopFromProps?: SerializedPSBTEnvelop;
    signTransaction: ({ signedSerializedPSBT }: { signedSerializedPSBT: string }) => void;
  };

  const { signer } = useSignerFromKey(vaultKey);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const serializedPSBTEnvelops: SerializedPSBTEnvelop[] = useAppSelector(
    (state) => state.sendAndReceive.sendPhaseTwo.serializedPSBTEnvelops
  );

  const serializedPSBTEnvelop = useMemo(() => {
    if (isRemoteKey) {
      return serializedPSBTEnvelopFromProps;
    }
    return serializedPSBTEnvelops?.find((envelop) => envelop.xfp === vaultKey.xfp);
  }, [isRemoteKey, serializedPSBTEnvelopFromProps, serializedPSBTEnvelops, vaultKey.xfp]);

  const [devices, setDevices] = useState<any[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [signing, setSigning] = useState(false);

  const networkType =
    bitcoinNetworkType === NetworkType.TESTNET ? NetworkType.TESTNET : NetworkType.MAINNET;

  const handleReadyCheck = async () => {
    const bleReady = await ensureOneKeyBLEReady();
    if (!bleReady.ready) {
      if (bleReady.reason === 'MISSING_PERMISSION') {
        showToast('请先授予蓝牙与定位权限', <ToastErrorIcon />);
      } else {
        showToast('请先打开手机蓝牙后重试', <ToastErrorIcon />);
      }
      return false;
    }
    return true;
  };

  const scanDevices = async () => {
    try {
      setScanning(true);
      const isReady = await handleReadyCheck();
      if (!isReady) {
        return;
      }
      const foundDevices = await searchOneKeyDevices();
      setDevices(foundDevices || []);
      if (!foundDevices?.length) {
        showToast('未扫描到 OneKey 设备，请确认设备蓝牙已开启', <ToastErrorIcon />);
      }
    } catch (error) {
      captureError(error);
      showToast(error?.message || common.somethingWrong, <ToastErrorIcon />);
    } finally {
      setScanning(false);
    }
  };

  const signWithOneKey = async () => {
    if (!selectedDevice?.connectId) {
      showToast('请先选择 OneKey 设备', <ToastErrorIcon />);
      return;
    }

    if (!serializedPSBTEnvelop?.serializedPSBT) {
      showToast('未找到待签名 PSBT', <ToastErrorIcon />);
      return;
    }

    try {
      setSigning(true);
      const isReady = await handleReadyCheck();
      if (!isReady) {
        return;
      }

      const connectId = selectedDevice.connectId;
      const deviceId = await getOneKeyDeviceId(connectId);
      const signedSerializedPSBT = await signPsbtWithOneKey({
        connectId,
        deviceId,
        networkType,
        serializedPSBT: serializedPSBTEnvelop.serializedPSBT,
      });

      validatePSBT(serializedPSBTEnvelop.serializedPSBT, signedSerializedPSBT, signer, errorText);

      dispatch(
        healthCheckStatusUpdate([
          {
            signerId: signer.masterFingerprint,
            status: hcStatusType.HEALTH_CHECK_SIGNING,
          },
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
    } finally {
      setSigning(false);
    }
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={'OneKey 蓝牙签名'}
        subTitle={walletTransactions.signTransactionWithKey}
      />
      <Box style={styles.container}>
        <Buttons
          primaryText={scanning ? '扫描中...' : '扫描设备'}
          primaryCallback={scanDevices}
          primaryLoading={scanning}
          fullWidth
        />

        <Box style={styles.deviceList}>
          {devices.map((device) => {
            const isSelected = selectedDevice?.connectId === device?.connectId;
            return (
              <TouchableOpacity
                key={`${device?.uuid || 'unknown'}-${device?.connectId || ''}`}
                style={[
                  styles.deviceItem,
                  {
                    borderColor: isSelected
                      ? colorMode === 'dark'
                        ? '#99f6e4'
                        : '#065f46'
                      : colorMode === 'dark'
                      ? '#3f3f46'
                      : '#d4d4d8',
                  },
                ]}
                onPress={() => setSelectedDevice(device)}
              >
                <Text>{device?.name || 'OneKey Device'}</Text>
                <Text color={`${colorMode}.secondaryText`} style={styles.connectIdText}>
                  {device?.connectId || ''}
                </Text>
              </TouchableOpacity>
            );
          })}
          {scanning && (
            <Box style={styles.loaderWrapper}>
              <ActivityIndicator />
            </Box>
          )}
        </Box>

        <Buttons
          primaryText={'开始签名'}
          primaryCallback={signWithOneKey}
          primaryLoading={signing}
          primaryDisable={!selectedDevice || scanning}
          fullWidth
        />
      </Box>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  deviceList: {
    minHeight: 220,
    gap: 8,
  },
  deviceItem: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  connectIdText: {
    fontSize: 11,
    marginTop: 3,
  },
  loaderWrapper: {
    paddingTop: 16,
    alignItems: 'center',
  },
});

export default SignWithOneKeyBle;
