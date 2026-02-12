import HardwareBLESDK from '@onekeyfe/hd-ble-sdk';
import {
  type CoreApi,
  type Features,
  type SearchDevice,
  UI_EVENT,
  UI_REQUEST,
  UI_RESPONSE,
} from '@onekeyfe/hd-core';
import { BleManager } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { NetworkType } from 'src/services/wallets/enums';

type SDKResult<T> = {
  success: boolean;
  payload: T & { error?: string };
};

export type OneKeySignerData = {
  multiSigPath: string;
  multiSigXpub: string;
  singleSigPath: string;
  singleSigXpub: string;
  taprootPath: string;
  taprootXpub: string;
  mfp: string;
};

let sdkInstance: CoreApi | null = null;
let sdkInitPromise: Promise<CoreApi> | null = null;
let bleManager: BleManager | null = null;
let uiListenerBound = false;

const getCoreSdk = () => HardwareBLESDK as unknown as CoreApi;

const handleUIEvent = (message: any) => {
  if (!sdkInstance) {
    return;
  }

  if (message?.type === UI_REQUEST.REQUEST_PIN) {
    sdkInstance.uiResponse({
      type: UI_RESPONSE.RECEIVE_PIN,
      payload: '@@ONEKEY_INPUT_PIN_IN_DEVICE',
    });
    return;
  }

  if (message?.type === UI_REQUEST.REQUEST_PASSPHRASE) {
    sdkInstance.uiResponse({
      type: UI_RESPONSE.RECEIVE_PASSPHRASE,
      payload: {
        value: '',
        passphraseOnDevice: false,
        save: false,
      },
    });
  }
};

const bindUIListener = (sdk: CoreApi) => {
  if (uiListenerBound) {
    return;
  }
  sdk.on(UI_EVENT, handleUIEvent);
  uiListenerBound = true;
};

const getErrorMessage = (result: any) =>
  result?.payload?.error || result?.payload?.message || 'OneKey 设备操作失败';

export const getOneKeySdk = async () => {
  if (sdkInstance) {
    return sdkInstance;
  }

  if (sdkInitPromise) {
    return sdkInitPromise;
  }

  sdkInitPromise = (async () => {
    const sdk = getCoreSdk();
    await sdk.init({
      debug: false,
      fetchConfig: true,
    });
    sdkInstance = sdk;
    bindUIListener(sdk);
    return sdk;
  })();

  try {
    return await sdkInitPromise;
  } finally {
    sdkInitPromise = null;
  }
};

const ensureAndroidBLEPermissions = async () => {
  if (Platform.OS !== 'android') {
    return true;
  }

  const permissions = [];
  if (Number(Platform.Version) >= 31) {
    permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
    permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
  }
  permissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  permissions.push(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);

  const result = await PermissionsAndroid.requestMultiple(permissions);
  return Object.values(result).every((value) => value === PermissionsAndroid.RESULTS.GRANTED);
};

export const ensureOneKeyBLEReady = async () => {
  const hasPermission = await ensureAndroidBLEPermissions();
  if (!hasPermission) {
    return { ready: false, reason: 'MISSING_PERMISSION' as const };
  }

  if (!bleManager) {
    bleManager = new BleManager();
  }

  const bleState = await bleManager.state();
  if (bleState !== 'PoweredOn') {
    return { ready: false, reason: 'BLE_OFF' as const };
  }

  return { ready: true as const, reason: null };
};

export const searchOneKeyDevices = async () => {
  const sdk = await getOneKeySdk();
  const result = (await sdk.searchDevices()) as SDKResult<SearchDevice[]>;
  if (!result?.success) {
    throw new Error(getErrorMessage(result));
  }
  return result.payload || [];
};

export const getOneKeyDeviceId = async (connectId: string) => {
  const sdk = await getOneKeySdk();
  const result = (await sdk.getFeatures(connectId)) as SDKResult<Features>;
  if (!result?.success) {
    throw new Error(getErrorMessage(result));
  }
  const deviceId = result?.payload?.device_id;
  if (!deviceId) {
    throw new Error('未获取到 OneKey device_id');
  }
  return deviceId;
};

const getCoinTypeByNetwork = (networkType: NetworkType) =>
  networkType === NetworkType.TESTNET ? 1 : 0;

const getCoinNameByNetwork = (networkType: NetworkType) =>
  networkType === NetworkType.TESTNET ? 'TEST' : 'Bitcoin';

const toMasterFingerprint = (rootFingerprint?: number) => {
  if (rootFingerprint === undefined || rootFingerprint === null) {
    throw new Error('未获取到 OneKey root_fingerprint');
  }
  return Number(rootFingerprint).toString(16).padStart(8, '0').toUpperCase();
};

const extractXpub = (payload: any) => {
  if (!payload?.xpub) {
    throw new Error('OneKey 返回的 xpub 无效');
  }
  return payload.xpub;
};

export const fetchOneKeySignerData = async ({
  connectId,
  deviceId,
  networkType,
  accountNumber = 0,
}: {
  connectId: string;
  deviceId: string;
  networkType: NetworkType;
  accountNumber?: number;
}) => {
  const sdk = await getOneKeySdk();
  const coinType = getCoinTypeByNetwork(networkType);

  const singleSigPath = `m/84'/${coinType}'/${accountNumber}'`;
  const multiSigPath = `m/48'/${coinType}'/${accountNumber}'/2'`;
  const taprootPath = `m/86'/${coinType}'/${accountNumber}'`;

  const singleSigResult = (await sdk.btcGetPublicKey(connectId, deviceId, {
    path: singleSigPath,
    showOnOneKey: false,
  })) as SDKResult<any>;
  if (!singleSigResult?.success) {
    throw new Error(getErrorMessage(singleSigResult));
  }

  const multiSigResult = (await sdk.btcGetPublicKey(connectId, deviceId, {
    path: multiSigPath,
    showOnOneKey: false,
  })) as SDKResult<any>;
  if (!multiSigResult?.success) {
    throw new Error(getErrorMessage(multiSigResult));
  }

  const taprootResult = (await sdk.btcGetPublicKey(connectId, deviceId, {
    path: taprootPath,
    showOnOneKey: false,
  })) as SDKResult<any>;
  if (!taprootResult?.success) {
    throw new Error(getErrorMessage(taprootResult));
  }

  const mfp = toMasterFingerprint(
    singleSigResult?.payload?.root_fingerprint ??
      multiSigResult?.payload?.root_fingerprint ??
      taprootResult?.payload?.root_fingerprint
  );

  return {
    multiSigPath,
    multiSigXpub: extractXpub(multiSigResult.payload),
    singleSigPath,
    singleSigXpub: extractXpub(singleSigResult.payload),
    taprootPath,
    taprootXpub: extractXpub(taprootResult.payload),
    mfp,
  } as OneKeySignerData;
};

const convertSignedPsbtToBase64 = (psbt: string) => {
  const sanitized = psbt?.startsWith('0x') ? psbt.slice(2) : psbt;
  if (sanitized && /^[a-fA-F0-9]+$/.test(sanitized)) {
    return Buffer.from(sanitized, 'hex').toString('base64');
  }
  return psbt;
};

export const signPsbtWithOneKey = async ({
  connectId,
  deviceId,
  networkType,
  serializedPSBT,
}: {
  connectId: string;
  deviceId: string;
  networkType: NetworkType;
  serializedPSBT: string;
}) => {
  const sdk = await getOneKeySdk();
  const psbtHex = Buffer.from(serializedPSBT, 'base64').toString('hex');
  const coin = getCoinNameByNetwork(networkType);
  const result = (await sdk.btcSignPsbt(connectId, deviceId, {
    psbt: psbtHex,
    coin,
  })) as SDKResult<{ psbt: string }>;

  if (!result?.success) {
    throw new Error(getErrorMessage(result));
  }

  const signedPsbt = result?.payload?.psbt;
  if (!signedPsbt) {
    throw new Error('OneKey 未返回签名后的 PSBT');
  }

  return convertSignedPsbtToBase64(signedPsbt);
};
