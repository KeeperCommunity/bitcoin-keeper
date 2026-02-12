import React, { useContext, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { Box, useColorMode } from 'native-base';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import { useDispatch } from 'react-redux';
import ScreenWrapper from 'src/components/ScreenWrapper';
import Text from 'src/components/KeeperText';
import Buttons from 'src/components/Buttons';
import WalletHeader from 'src/components/WalletHeader';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import TickIcon from 'src/assets/images/icon_tick.svg';
import { addSigningDevice } from 'src/store/sagaActions/vaults';
import { setSigningDevices } from 'src/store/reducers/bhr';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { setShowTipModal } from 'src/store/reducers/settings';
import config from 'src/utils/service-utilities/config';
import { useAppSelector } from 'src/store/hooks';
import { NetworkType, SignerType } from 'src/services/wallets/enums';
import {
  ensureOneKeyBLEReady,
  fetchOneKeySignerData,
  getOneKeyDeviceId,
  searchOneKeyDevices,
} from 'src/services/onekeyBle';
import { setupUSBSigner } from 'src/hardware/signerSetup';
import useUnkownSigners from 'src/hooks/useUnkownSigners';
import { InteracationMode } from '../Vault/HardwareModalMap';
import useCanaryWalletSetup from 'src/hooks/UseCanaryWalletSetup';
import { captureError } from 'src/services/sentry';
import { LocalizationContext } from 'src/context/Localization/LocContext';

function ConnectOneKeyBle() {
  const { colorMode } = useColorMode();
  const route = useRoute();
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();
  const { mapUnknownSigner } = useUnkownSigners();
  const { createCreateCanaryWallet } = useCanaryWalletSetup({});
  const { translations } = useContext(LocalizationContext);
  const { common, error: errorText } = translations;

  const {
    title = '连接 OneKey',
    subtitle = '通过蓝牙连接 OneKey 并导入密钥信息',
    signer,
    mode = InteracationMode.VAULT_ADDITION,
    isMultisig = true,
    addSignerFlow = false,
    accountNumber = 0,
  } = route.params as any;

  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const networkType =
    bitcoinNetworkType === NetworkType.TESTNET ? NetworkType.TESTNET : NetworkType.MAINNET;

  const [devices, setDevices] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  const [inProgress, setInProgress] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<any>(null);

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

  const navigateAfterAdd = (addedSigner) => {
    const navigationState = addSignerFlow
      ? {
          name: 'Home',
          params: { selectedOption: 'Keys', addedSigner },
        }
      : {
          name: 'AddSigningDevice',
          merge: true,
          params: { addedSigner },
        };
    navigation.dispatch(CommonActions.navigate(navigationState));
  };

  const handleHealthCheck = (verifiedSigner) => {
    const handleSuccess = () => {
      dispatch(
        healthCheckStatusUpdate([
          {
            signerId: verifiedSigner.masterFingerprint,
            status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
          },
        ])
      );
      navigation.dispatch(CommonActions.goBack());
      showToast('OneKey 验证成功', <TickIcon />);
      dispatch(setShowTipModal({ status: true, address: config.ADDRESS.health }));
    };

    const handleFailure = () => {
      dispatch(
        healthCheckStatusUpdate([
          {
            signerId: signer?.masterFingerprint || verifiedSigner.masterFingerprint,
            status: hcStatusType.HEALTH_CHECK_FAILED,
          },
        ])
      );
      navigation.dispatch(CommonActions.goBack());
      showToast(errorText.verificationFailed, <ToastErrorIcon />);
    };

    if (mode === InteracationMode.IDENTIFICATION) {
      const mapped = mapUnknownSigner({
        masterFingerprint: verifiedSigner.masterFingerprint,
        type: SignerType.ONEKEY,
      });
      if (mapped) {
        handleSuccess();
      } else {
        handleFailure();
      }
      return;
    }

    if (signer?.masterFingerprint === verifiedSigner.masterFingerprint) {
      handleSuccess();
    } else {
      handleFailure();
    }
  };

  const handleConnectAndSetup = async () => {
    if (!selectedDevice?.connectId) {
      showToast('请先选择 OneKey 设备', <ToastErrorIcon />);
      return;
    }

    try {
      setInProgress(true);
      const isReady = await handleReadyCheck();
      if (!isReady) {
        return;
      }

      const connectId = selectedDevice.connectId;
      const deviceId = await getOneKeyDeviceId(connectId);
      const signerData = await fetchOneKeySignerData({
        connectId,
        deviceId,
        networkType,
        accountNumber,
      });
      const { signer: oneKeySigner } = setupUSBSigner(SignerType.ONEKEY, signerData, isMultisig);

      if (mode === InteracationMode.RECOVERY) {
        dispatch(setSigningDevices(oneKeySigner));
        navigation.dispatch(CommonActions.navigate('LoginStack', { screen: 'VaultRecoveryAddSigner' }));
        return;
      }

      if (mode === InteracationMode.HEALTH_CHECK || mode === InteracationMode.IDENTIFICATION) {
        handleHealthCheck(oneKeySigner);
        return;
      }

      if (mode === InteracationMode.CANARY_ADDITION) {
        dispatch(addSigningDevice([oneKeySigner]));
        createCreateCanaryWallet(oneKeySigner);
        return;
      }

      dispatch(addSigningDevice([oneKeySigner]));
      navigateAfterAdd(oneKeySigner);
    } catch (error) {
      captureError(error);
      showToast(error?.message || common.somethingWrong, <ToastErrorIcon />);
    } finally {
      setInProgress(false);
    }
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={title} subTitle={subtitle} />

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
          primaryText={
            mode === InteracationMode.HEALTH_CHECK || mode === InteracationMode.IDENTIFICATION
              ? common.verify
              : common.proceed
          }
          primaryCallback={handleConnectAndSetup}
          primaryLoading={inProgress}
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

export default ConnectOneKeyBle;
