import React, { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { useDispatch } from 'react-redux';
import KeeperModal from 'src/components/KeeperModal';
import Text from 'src/components/KeeperText';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import TickIcon from 'src/assets/images/icon_tick.svg';
import { useAppSelector } from 'src/store/hooks';
import { MultisigScriptType, NetworkType, SignerType } from 'src/services/wallets/enums';
import { UI_REQUEST } from '@onekeyfe/hd-core';
import {
  assertOneKeyFingerprint,
  ensureOneKeyBLEReady,
  fetchOneKeySignerData,
  getOneKeyDeviceInfo,
  onekeyUIEmitter,
  ONEKEY_UI_EVENT,
  searchOneKeyDevices,
  verifyAddressOnOneKey,
  type OneKeyDeviceInfo,
  type OneKeyUIEvent,
} from 'src/services/onekeyBle';
import {
  getDeviceImage,
  getDeviceDisplayName,
  getDeviceTypeName,
} from 'src/services/onekeyBle/deviceConstants';
import { setupUSBSigner } from 'src/hardware/signerSetup';
import { addSigningDevice } from 'src/store/sagaActions/vaults';
import { updateKeyDetails } from 'src/store/sagaActions/wallets';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import type { Vault, VaultSigner } from 'src/services/wallets/interfaces/vault';
import { captureError } from 'src/services/sentry';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import type { Signer } from 'src/services/wallets/interfaces/vault';
import type { SearchDevice } from '@onekeyfe/hd-core';
import WalletUtilities from 'src/services/wallets/operations/utils';

// ─── SDK UI event descriptions ──────────────────────────────────────────────

const UI_PROMPTS: Record<string, string> = {
  [UI_REQUEST.REQUEST_PIN]: 'Please enter PIN on your OneKey device',
  [UI_REQUEST.REQUEST_BUTTON]: 'Please confirm on your OneKey device',
  idle: '',
};

// ─── Types ──────────────────────────────────────────────────────────────────

type ModalMode = 'setup' | 'identify' | 'recovery' | 'health-check' | 'verify-address';
type ModalPhase = 'scan' | 'connecting' | 'sdk-prompt' | 'done';

type Props = {
  visible: boolean;
  close: () => void;
  mode: ModalMode;
  signer?: Signer;
  isMultisig?: boolean;
  addSignerFlow?: boolean;
  accountNumber?: number;
  onSignerAdded?: (signer: Signer) => void;
  onDeviceIdentified?: (result: { device: SearchDevice; deviceInfo: OneKeyDeviceInfo }) => void;
  // verify-address mode props
  vaultKey?: VaultSigner;
  vault?: Vault;
  vaultId?: string;
  receiveAddressIndex?: number;
  receivingAddress?: string;
};

// ─── Component ──────────────────────────────────────────────────────────────

function OneKeyBleModal({
  visible,
  close,
  mode,
  signer,
  isMultisig = true,
  accountNumber = 0,
  onSignerAdded,
  onDeviceIdentified,
  vaultKey,
  vault,
  vaultId,
  receiveAddressIndex,
  receivingAddress,
}: Props) {
  const { colorMode } = useColorMode();
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const { common } = translations;

  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const networkType =
    bitcoinNetworkType === NetworkType.TESTNET ? NetworkType.TESTNET : NetworkType.MAINNET;

  const [phase, setPhase] = useState<ModalPhase>('scan');
  const [devices, setDevices] = useState<SearchDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [sdkPrompt, setSdkPrompt] = useState<OneKeyUIEvent>('idle');

  // Listen to SDK UI events
  useEffect(() => {
    const handler = (event: OneKeyUIEvent) => {
      if (event === 'idle') {
        setSdkPrompt('idle');
        if (phase === 'sdk-prompt') setPhase('connecting');
      } else {
        setSdkPrompt(event);
        setPhase('sdk-prompt');
      }
    };
    const subscription = onekeyUIEmitter.addListener(ONEKEY_UI_EVENT, handler);
    return () => { subscription.remove(); };
  }, [phase]);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setDevices([]);
      setScanning(false);
      setStatusMessage('');
      setErrorMessage('');
      setSdkPrompt('idle');

      if (mode === 'health-check' || mode === 'verify-address') {
        // Direct connect modes: skip scan
        setPhase('connecting');
        setTimeout(() => mode === 'verify-address' ? runVerifyAddress() : runHealthCheck(), 300);
      } else {
        // Setup, identify, and recovery show scan UI so the user can choose among nearby devices.
        setPhase('scan');
        setTimeout(() => scanDevices(), 300);
      }
    }
  }, [visible]);

  // ─── Scan ──────────────────────────────────────────────────────────────────

  const scanDevices = async () => {
    if (scanning) return;
    try {
      setScanning(true);
      setErrorMessage('');
      setDevices([]);
      const bleReady = await ensureOneKeyBLEReady();
      if (!bleReady.ready) {
        const message =
          bleReady.reason === 'MISSING_PERMISSION'
            ? 'Please grant Bluetooth permissions'
            : 'Please turn on Bluetooth and try again';
        setErrorMessage(message);
        showToast(message, <ToastErrorIcon />);
        return;
      }
      const found = await searchOneKeyDevices();
      setDevices(found || []);
    } catch (error) {
      captureError(error);
      const message = error?.message || common.somethingWrong;
      setErrorMessage(message);
      showToast(message, <ToastErrorIcon />);
    } finally {
      setScanning(false);
    }
  };

  // ─── Setup: tap device → connect → import keys ─────────────────────────────

  const handleSetupTap = async (device: SearchDevice) => {
    if (!device?.connectId) return;
    try {
      setErrorMessage('');
      setPhase('connecting');
      setStatusMessage('Connecting to device...');

      const deviceInfo = await getOneKeyDeviceInfo(device.connectId);

      // Clear any SDK prompt after device info is fetched
      setPhase('connecting');
      setStatusMessage('Importing keys...');
      const signerData = await fetchOneKeySignerData({
        connectId: device.connectId,
        deviceId: deviceInfo.deviceId,
        networkType,
        accountNumber,
      });

      // Clear any SDK prompt after keys imported
      setPhase('connecting');
      setStatusMessage('Finalizing...');

      const { signer: newSigner } = setupUSBSigner(SignerType.ONEKEY, signerData, isMultisig);

      // Title: "OneKey Pro" / "OneKey Classic", Subtitle: BLE name (e.g. "Pro 04DD")
      newSigner.signerName = getDeviceTypeName(device);
      const bleName = device?.name;
      if (bleName && bleName !== 'Unknown') {
        newSigner.signerDescription = bleName;
      }
      newSigner.extraData = { ...newSigner.extraData, bleConnectId: deviceInfo.connectId };

      if (mode === 'setup') {
        dispatch(addSigningDevice([newSigner]));
      }
      setPhase('done');
      showToast(
        mode === 'recovery' ? 'OneKey connected successfully' : 'OneKey added successfully',
        <TickIcon />
      );
      onSignerAdded?.(newSigner);
      close();
    } catch (error) {
      captureError(error);
      const message = error?.message || common.somethingWrong;
      setErrorMessage(message);
      showToast(message, <ToastErrorIcon />);
      setPhase('scan'); // Back to scan so user can retry
    }
  };

  // ─── Identify: tap device → connect → match fingerprint ───────────────────

  const handleIdentifyTap = async (device: SearchDevice) => {
    if (!device?.connectId || !signer) return;
    try {
      setErrorMessage('');
      setPhase('connecting');
      setStatusMessage('Connecting to device...');

      const deviceInfo = await getOneKeyDeviceInfo(device.connectId);

      try {
        assertOneKeyFingerprint(deviceInfo, signer);
      } catch (_) {
        const message = 'Fingerprint mismatch. Please select the correct OneKey device.';
        setErrorMessage(message);
        showToast(message, <ToastErrorIcon />);
        setPhase('scan');
        return;
      }

      setPhase('done');
      showToast('OneKey verified successfully', <TickIcon />);
      onDeviceIdentified?.({ device, deviceInfo });
      close();
    } catch (error) {
      captureError(error);
      const message = error?.message || common.somethingWrong;
      setErrorMessage(message);
      showToast(message, <ToastErrorIcon />);
      setPhase('scan');
    }
  };

  // ─── Health Check: direct connect via stored connectId ─────────────────────

  const runHealthCheck = async () => {
    if (!signer) return;
    try {
      setPhase('connecting');

      const bleReady = await ensureOneKeyBLEReady();
      if (!bleReady.ready) {
        showToast('Please turn on Bluetooth and try again', <ToastErrorIcon />);
        close();
        return;
      }

      const storedConnectId = signer?.extraData?.bleConnectId;
      if (!storedConnectId) {
        showToast('No stored connection info. Please re-add this device.', <ToastErrorIcon />);
        close();
        return;
      }

      // BLE needs a brief scan to discover peripherals before connecting
      setStatusMessage('Connecting to device...');
      await searchOneKeyDevices();

      setStatusMessage('Verifying device...');
      const deviceInfo = await getOneKeyDeviceInfo(storedConnectId);
      assertOneKeyFingerprint(deviceInfo, signer);

      // Clear any SDK prompt after verification
      setPhase('connecting');
      setStatusMessage('Checking result...');

      dispatch(
        healthCheckStatusUpdate([
          { signerId: signer.masterFingerprint, status: hcStatusType.HEALTH_CHECK_SUCCESSFULL },
        ])
      );
      setPhase('done');
      showToast('OneKey verification successful', <TickIcon />);
      close();
    } catch (error) {
      captureError(error);
      showToast(error?.message || common.somethingWrong, <ToastErrorIcon />);
      close();
    }
  };

  // ─── Verify Address: direct connect → show address on device ─────────────

  const runVerifyAddress = async () => {
    if (!signer || !vaultKey || !receivingAddress || receiveAddressIndex === undefined) {
      showToast('Missing address verification details. Please try again.', <ToastErrorIcon />);
      close();
      return;
    }
    try {
      setPhase('connecting');

      const bleReady = await ensureOneKeyBLEReady();
      if (!bleReady.ready) {
        showToast('Please turn on Bluetooth and try again', <ToastErrorIcon />);
        close();
        return;
      }

      const storedConnectId = signer?.extraData?.bleConnectId;
      if (!storedConnectId) {
        showToast('No stored connection info. Please re-add this device.', <ToastErrorIcon />);
        close();
        return;
      }

      setStatusMessage('Connecting to device...');
      await searchOneKeyDevices();

      setStatusMessage('Reading device info...');
      const deviceInfo = await getOneKeyDeviceInfo(storedConnectId);
      assertOneKeyFingerprint(deviceInfo, signer);

      setPhase('connecting');
      setStatusMessage('Verifying address on device...');
      const addressPath = `${vaultKey.derivationPath}/0/${receiveAddressIndex}`;
      let multisigConfig;
      if (vault?.isMultiSig) {
        const multisigScriptType =
          vault.scheme.multisigScriptType || MultisigScriptType.DEFAULT_MULTISIG;
        if (multisigScriptType !== MultisigScriptType.DEFAULT_MULTISIG) {
          throw new Error('OneKey address verification supports standard multisig vaults only.');
        }
        const multisigAddress = WalletUtilities.createMultiSig(vault, receiveAddressIndex, false);
        const sortedXpubs = [...vault.specs.xpubs].sort((a, b) => {
          const pubA = multisigAddress.signerPubkeyMap.get(a)?.toString('hex') || '';
          const pubB = multisigAddress.signerPubkeyMap.get(b)?.toString('hex') || '';
          return pubA.localeCompare(pubB);
        });
        multisigConfig = {
          m: vault.scheme.m,
          xpubs: sortedXpubs,
          addressIndex: receiveAddressIndex,
        };
      }
      const deviceAddress = await verifyAddressOnOneKey({
        connectId: storedConnectId,
        deviceId: deviceInfo.deviceId,
        path: addressPath,
        networkType,
        multisigConfig,
      });

      setPhase('connecting');

      if (deviceAddress === receivingAddress) {
        dispatch(updateKeyDetails(vaultKey, 'registered', { registered: true, vaultId }));
        dispatch(
          healthCheckStatusUpdate([
            { signerId: signer.masterFingerprint, status: hcStatusType.HEALTH_CHECK_VERIFICATION },
          ])
        );
        showToast('Address verified successfully on OneKey', <TickIcon />);
      } else {
        showToast('Address mismatch! The address on device does not match.', <ToastErrorIcon />);
      }
      close();
    } catch (error) {
      captureError(error);
      showToast(error?.message || common.somethingWrong, <ToastErrorIcon />);
      close();
    }
  };

  const handleDeviceTap = mode === 'identify' ? handleIdentifyTap : handleSetupTap;

  // ─── Render helpers ────────────────────────────────────────────────────────

  const renderDevice = ({ item: device }: { item: SearchDevice }) => {
    const img = getDeviceImage(device?.deviceType);
    return (
      <TouchableOpacity
        style={[styles.deviceItem, { borderColor: colorMode === 'light' ? '#E0E0E0' : '#444' }]}
        onPress={() => handleDeviceTap(device)}
        activeOpacity={0.7}
      >
        <Box style={styles.deviceRow}>
          {img ? (
            <Image source={img} style={styles.deviceImage} resizeMode="contain" />
          ) : (
            <Box style={styles.fallbackIcon}>
              <Text style={styles.fallbackText}>OK</Text>
            </Box>
          )}
          <Box style={{ flex: 1 }}>
            <Text style={styles.deviceName} color={`${colorMode}.primaryText`}>
              {getDeviceDisplayName(device)}
            </Text>
          </Box>
          <Text color={`${colorMode}.secondaryText`} style={styles.arrow}>›</Text>
        </Box>
      </TouchableOpacity>
    );
  };

  const ModalContent = () => {
    const ErrorMessage = () =>
      errorMessage ? (
        <Box style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
        </Box>
      ) : null;

    // SDK prompt phase — show device interaction prompt
    if (phase === 'sdk-prompt' && sdkPrompt !== 'idle') {
      return (
        <Box style={styles.centerContent}>
          <ActivityIndicator size="large" />
          <Text color={`${colorMode}.primaryText`} style={styles.promptText}>
            {UI_PROMPTS[sdkPrompt]}
          </Text>
        </Box>
      );
    }

    // Connecting phase
    if (phase === 'connecting') {
      return (
        <Box style={styles.centerContent}>
          <ActivityIndicator size="large" />
          <Text color={`${colorMode}.secondaryText`} style={styles.statusText}>
            {statusMessage || 'Connecting...'}
          </Text>
        </Box>
      );
    }

    // Scan phase — show device list or loading
    if (scanning && devices.length === 0) {
      return (
        <Box style={styles.centerContent}>
          <ActivityIndicator size="large" />
          <Text color={`${colorMode}.secondaryText`} style={styles.statusText}>
            Looking for devices...
          </Text>
        </Box>
      );
    }

    if (!scanning && devices.length === 0) {
      return (
        <Box style={styles.centerContent}>
          <ErrorMessage />
          <Text color={`${colorMode}.secondaryText`} style={styles.statusText}>
            No devices found. Make sure your OneKey is unlocked and nearby.
          </Text>
          <TouchableOpacity onPress={scanDevices}>
            <Text color={`${colorMode}.pantoneGreen`} style={styles.rescanText}>
              Rescan
            </Text>
          </TouchableOpacity>
        </Box>
      );
    }

    // Devices found
    return (
      <Box>
        <Box style={styles.listHeader}>
          <Text color={`${colorMode}.secondaryText`} style={styles.listHeaderText}>
            Select your device
          </Text>
          <TouchableOpacity onPress={scanDevices}>
            <Text color={`${colorMode}.pantoneGreen`} style={styles.rescanText}>
              Rescan
            </Text>
          </TouchableOpacity>
        </Box>
        <ErrorMessage />
        <FlatList
          data={devices}
          renderItem={renderDevice}
          keyExtractor={(d) => `${d?.uuid || ''}-${d?.connectId || ''}`}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          style={styles.list}
        />
      </Box>
    );
  };

  if (!visible) return null;

  const title =
    mode === 'setup' ? 'Setting up OneKey'
    : mode === 'identify' ? 'Identify OneKey'
    : mode === 'recovery' ? 'Recover with OneKey'
    : mode === 'verify-address' ? 'Verify Address'
    : 'Verify OneKey';
  const subTitle =
    mode === 'setup' ? 'Connect OneKey hardware wallet via Bluetooth'
    : mode === 'identify' ? 'Select your OneKey and confirm it matches this key'
    : mode === 'recovery' ? 'Select your OneKey to continue wallet recovery'
    : mode === 'verify-address' ? 'Confirm the address matches on your OneKey device'
    : 'Verify your OneKey device is accessible';

  return (
    <KeeperModal
      visible={visible}
      close={close}
      title={title}
      subTitle={subTitle}
      showCloseIcon
      modalBackground={`${colorMode}.modalWhiteBackground`}
      textColor={`${colorMode}.textGreen`}
      subTitleColor={`${colorMode}.modalSubtitleBlack`}
      Content={ModalContent}
    />
  );
}

const styles = StyleSheet.create({
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 16,
  },
  promptText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  statusText: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  rescanText: {
    fontSize: 14,
    fontWeight: '600',
  },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  listHeaderText: {
    fontSize: 13,
  },
  list: {
    maxHeight: 300,
  },
  listContent: {
    gap: 8,
  },
  errorBanner: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    backgroundColor: '#FCEAEA',
  },
  errorText: {
    color: '#B42318',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  deviceItem: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceImage: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 12,
  },
  fallbackIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#44D62C',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  fallbackText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '500',
  },
  arrow: {
    fontSize: 22,
    fontWeight: '300',
    marginLeft: 8,
  },
});

export default OneKeyBleModal;
