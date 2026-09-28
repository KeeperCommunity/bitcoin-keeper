import HardwareBLESDK from '@onekeyfe/hd-ble-sdk';
import {
  type CoreApi,
  type Features,
  type SearchDevice,
  UI_EVENT,
  UI_REQUEST,
  UI_RESPONSE,
} from '@onekeyfe/hd-core';
import type {
  HDNodeType,
  InputScriptType,
  MultisigRedeemScriptType,
} from '@onekeyfe/hd-transport';
import BIP32Factory from 'bip32';
import { BleManager } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { DeviceEventEmitter } from 'react-native';
import { NetworkType } from 'src/services/wallets/enums';
import WalletUtilities from 'src/services/wallets/operations/utils';
import ecc from 'src/services/wallets/operations/taproot-utils/noble_ecc';

// ─── UI Event Emitter ────────────────────────────────────────────────────────
// Components can listen to these events to show appropriate UI prompts.

export const onekeyUIEmitter = DeviceEventEmitter;
export const ONEKEY_UI_EVENT = 'onekey-ui-event';

// Use SDK's own constants as event values
export type OneKeyUIEvent = typeof UI_REQUEST.REQUEST_PIN | typeof UI_REQUEST.REQUEST_BUTTON | 'idle';

// ─── Types ────────────────────────────────────────────────────────────────────

type SDKResult<T> = {
  success: boolean;
  payload: T & { error?: string; message?: string };
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

export type OneKeyDeviceInfo = {
  connectId: string;
  deviceId: string;
  masterFingerprint: string;
  deviceLabel: string; // Device name shown on device (e.g. "My OneKey")
  serialNo: string; // Hardware serial number (e.g. "PRA471B")
};

type OneKeyMultisigAddressConfig = {
  m: number;
  xpubs: string[];
  addressIndex: number;
  isInternal?: boolean;
};

// ─── Singleton state ──────────────────────────────────────────────────────────

let sdkInstance: CoreApi | null = null;
let sdkInitPromise: Promise<CoreApi> | null = null;
let bleManager: BleManager | null = null;
let uiListenerBound = false;

const SCAN_TIMEOUT_MS = 15_000;
const bip32 = BIP32Factory(ecc);
const HD_HARDENED = 0x80000000;

// ─── SDK core ─────────────────────────────────────────────────────────────────

const getCoreSdk = () => HardwareBLESDK as unknown as CoreApi;

const handleUIEvent = (message: any) => {
  if (!sdkInstance) return;

  if (message?.type === UI_REQUEST.REQUEST_PIN) {
    onekeyUIEmitter.emit(ONEKEY_UI_EVENT, UI_REQUEST.REQUEST_PIN);
    sdkInstance.uiResponse({
      type: UI_RESPONSE.RECEIVE_PIN,
      payload: '@@ONEKEY_INPUT_PIN_IN_DEVICE',
    });
    return;
  }

  if (message?.type === UI_REQUEST.REQUEST_BUTTON) {
    onekeyUIEmitter.emit(ONEKEY_UI_EVENT, UI_REQUEST.REQUEST_BUTTON);
    return;
  }

  if (message?.type === UI_REQUEST.REQUEST_PASSPHRASE) {
    // Keeper does not support OneKey hidden-wallet passphrases. Keep all
    // operations on the main wallet even if a call accidentally asks.
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
  if (uiListenerBound) return;
  sdk.on(UI_EVENT, handleUIEvent);
  uiListenerBound = true;
};

const getErrorMessage = (result: any): string => {
  const code = result?.payload?.code;
  const error = result?.payload?.error || result?.payload?.message || '';

  // Friendly messages for known error codes
  if (code === 801 || error.includes('Pin invalid')) {
    return 'PIN is incorrect. Please try again on your device.';
  }
  if (code === 802 || error.includes('Pin cancelled')) {
    return 'PIN entry was cancelled.';
  }
  if (error.includes('Failure_ActionCancelled')) {
    return 'Action was cancelled on the device.';
  }

  return error || 'OneKey operation failed';
};

export const getOneKeySdk = async (): Promise<CoreApi> => {
  if (sdkInstance) return sdkInstance;
  if (sdkInitPromise) return sdkInitPromise;

  sdkInitPromise = (async () => {
    const sdk = getCoreSdk();
    await sdk.init({ debug: false, fetchConfig: true });
    sdkInstance = sdk;
    bindUIListener(sdk);
    return sdk;
  })();

  try {
    return await sdkInitPromise;
  } catch (e) {
    // Only clear on failure so successful init is cached
    sdkInitPromise = null;
    throw e;
  }
};

// ─── BLE readiness ────────────────────────────────────────────────────────────

const ensureAndroidBLEPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return true;

  const permissions: Parameters<typeof PermissionsAndroid.requestMultiple>[0] =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const result = await PermissionsAndroid.requestMultiple(permissions);
  return Object.values(result).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
};

/**
 * Wait for BLE adapter to reach a definitive state (PoweredOn / PoweredOff / Unauthorized).
 * BleManager may report 'Unknown' or 'Resetting' transiently after construction; we listen
 * for the settled state via onStateChange (with emitCurrentState=true) and resolve as soon
 * as we get something actionable, or after a 3 s timeout.
 */
const waitForBleState = (mgr: BleManager): Promise<string> =>
  new Promise((resolve) => {
    const sub = mgr.onStateChange((state) => {
      if (state !== 'Unknown' && state !== 'Resetting') {
        sub.remove();
        resolve(state);
      }
    }, true); // emitCurrentState = true
    setTimeout(() => {
      sub.remove();
      mgr.state().then(resolve);
    }, 3000);
  });

export const ensureOneKeyBLEReady = async () => {
  const hasPermission = await ensureAndroidBLEPermissions();
  if (!hasPermission) {
    return { ready: false as const, reason: 'MISSING_PERMISSION' as const };
  }

  if (!bleManager) bleManager = new BleManager();

  const bleState = await waitForBleState(bleManager);
  if (bleState !== 'PoweredOn') {
    return { ready: false as const, reason: 'BLE_OFF' as const };
  }

  return { ready: true as const, reason: null };
};

// ─── Device discovery ─────────────────────────────────────────────────────────

export const searchOneKeyDevices = async (): Promise<SearchDevice[]> => {
  const sdk = await getOneKeySdk();

  const result = await Promise.race([
    sdk.searchDevices() as Promise<SDKResult<SearchDevice[]>>,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('BLE scan timed out')), SCAN_TIMEOUT_MS)
    ),
  ]);

  if (!result?.success) throw new Error(getErrorMessage(result));
  return result.payload || [];
};

/**
 * Resolve device_id and master fingerprint from a connected device.
 * Returns both so callers can verify device identity.
 */
export const getOneKeyDeviceInfo = async (connectId: string): Promise<OneKeyDeviceInfo> => {
  const sdk = await getOneKeySdk();
  const result = (await sdk.getFeatures(connectId)) as SDKResult<Features>;
  if (!result?.success) throw new Error(getErrorMessage(result));

  const deviceId = result?.payload?.device_id;
  if (!deviceId) throw new Error('Failed to get OneKey device_id');

  const serialNo =
    (result.payload as any)?.onekey_serial_no ||
    (result.payload as any)?.onekey_serial ||
    (result.payload as any)?.serial_no ||
    '';
  const deviceLabel =
    result?.payload?.label || result?.payload?.ble_name || `OneKey ${deviceId.slice(-4)}`;

  // Fetch root fingerprint via a lightweight key derivation
  const fpResult = (await sdk.btcGetPublicKey(connectId, deviceId, {
    path: "m/84'/0'/0'",
    showOnOneKey: false,
    useEmptyPassphrase: true,
  })) as SDKResult<any>;

  if (!fpResult?.success) throw new Error(getErrorMessage(fpResult));

  const mfp = toMasterFingerprint(fpResult?.payload?.root_fingerprint);
  return { connectId, deviceId, masterFingerprint: mfp, deviceLabel, serialNo };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getCoinTypeByNetwork = (networkType: NetworkType) =>
  networkType === NetworkType.TESTNET ? 1 : 0;

const getCoinNameByNetwork = (networkType: NetworkType) =>
  networkType === NetworkType.TESTNET ? 'TEST' : 'Bitcoin';

const toMasterFingerprint = (rootFingerprint?: number): string => {
  if (rootFingerprint === undefined || rootFingerprint === null) {
    throw new Error('Missing OneKey root_fingerprint');
  }
  const fp = rootFingerprint >>> 0; // Force unsigned 32-bit
  return fp.toString(16).padStart(8, '0').toUpperCase();
};

export const normalizeOneKeyFingerprint = (fingerprint?: string | null): string =>
  (fingerprint || '').toUpperCase();

export const assertOneKeyFingerprint = (
  deviceInfo: Pick<OneKeyDeviceInfo, 'masterFingerprint'>,
  signer?: { masterFingerprint?: string }
) => {
  const expectedFingerprint = normalizeOneKeyFingerprint(signer?.masterFingerprint);
  const actualFingerprint = normalizeOneKeyFingerprint(deviceInfo?.masterFingerprint);

  if (!expectedFingerprint || !actualFingerprint) {
    throw new Error('Missing OneKey fingerprint. Please re-add this device.');
  }
  if (expectedFingerprint !== actualFingerprint) {
    throw new Error('Fingerprint mismatch. Wrong OneKey device connected.');
  }
};

const extractXpub = (payload: any): string => {
  if (!payload?.xpub) throw new Error('Invalid xpub from OneKey');
  return payload.xpub;
};

const getHDPathArray = (path: string): number[] =>
  path
    .split('/')
    .filter((part) => part && part !== 'm')
    .map((part) => {
      const hardened = part.slice(part.length - 1) === "'";
      const index = Number(part.replace("'", ''));
      if (isNaN(index) || index < 0) throw new Error(`Invalid derivation path: ${path}`);
      return hardened ? (index | HD_HARDENED) >>> 0 : index;
    });

const toHex = (value: Buffer | Uint8Array): string => Buffer.from(value).toString('hex');

const buildMultisigRedeemScript = ({
  m,
  xpubs,
  addressIndex,
  networkType,
  isInternal = false,
}: OneKeyMultisigAddressConfig & { networkType: NetworkType }): MultisigRedeemScriptType => {
  const network = WalletUtilities.getNetworkByType(networkType);
  const toHDNode = (xpub: string): HDNodeType => {
    const node = bip32.fromBase58(xpub, network);
    return {
      depth: node.depth,
      fingerprint: node.parentFingerprint,
      child_num: node.index,
      chain_code: toHex(node.chainCode),
      public_key: toHex(node.publicKey),
    };
  };

  return {
    pubkeys: xpubs.map((xpub) => ({
      node: toHDNode(xpub),
      address_n: [isInternal ? 1 : 0, addressIndex],
    })),
    signatures: xpubs.map(() => ''),
    m,
  };
};

const getMultisigAddressScriptType = (path: string): InputScriptType => {
  const segments = getHDPathArray(path);
  const bip48ScriptType = (segments[3] ?? 0) & ~HD_HARDENED;

  if (bip48ScriptType === 2) return 'SPENDWITNESS';
  if (bip48ScriptType === 1) return 'SPENDP2SHWITNESS';

  return 'SPENDMULTISIG';
};

// ─── Signer data (xpub fetch) ─────────────────────────────────────────────────

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
}): Promise<OneKeySignerData> => {
  const sdk = await getOneKeySdk();
  const coinType = getCoinTypeByNetwork(networkType);

  const singleSigPath = `m/84'/${coinType}'/${accountNumber}'`;
  const multiSigPath = `m/48'/${coinType}'/${accountNumber}'/2'`;
  const taprootPath = `m/86'/${coinType}'/${accountNumber}'`;

  const singleSigResult = (await sdk.btcGetPublicKey(connectId, deviceId, {
    path: singleSigPath,
    showOnOneKey: false,
    useEmptyPassphrase: true,
  })) as SDKResult<any>;
  if (!singleSigResult?.success) throw new Error(getErrorMessage(singleSigResult));

  const multiSigResult = (await sdk.btcGetPublicKey(connectId, deviceId, {
    path: multiSigPath,
    showOnOneKey: false,
    useEmptyPassphrase: true,
  })) as SDKResult<any>;
  if (!multiSigResult?.success) throw new Error(getErrorMessage(multiSigResult));

  const taprootResult = (await sdk.btcGetPublicKey(connectId, deviceId, {
    path: taprootPath,
    showOnOneKey: false,
    useEmptyPassphrase: true,
  })) as SDKResult<any>;
  if (!taprootResult?.success) throw new Error(getErrorMessage(taprootResult));

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
  };
};

// ─── PSBT signing ─────────────────────────────────────────────────────────────

const convertSignedPsbtToBase64 = (psbt: string): string => {
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
}): Promise<string> => {
  const sdk = await getOneKeySdk();
  const psbtHex = Buffer.from(serializedPSBT, 'base64').toString('hex');
  const coin = getCoinNameByNetwork(networkType);

  const result = (await sdk.btcSignPsbt(connectId, deviceId, {
    psbt: psbtHex,
    coin,
    useEmptyPassphrase: true,
  })) as SDKResult<{ psbt: string }>;

  if (!result?.success) throw new Error(getErrorMessage(result));

  const signedPsbt = result?.payload?.psbt;
  if (!signedPsbt) throw new Error('OneKey returned empty signed PSBT');

  return convertSignedPsbtToBase64(signedPsbt);
};

// ─── Address verification ─────────────────────────────────────────────────────

export const verifyAddressOnOneKey = async ({
  connectId,
  deviceId,
  path,
  networkType,
  multisigConfig,
}: {
  connectId: string;
  deviceId: string;
  path: string;
  networkType: NetworkType;
  multisigConfig?: OneKeyMultisigAddressConfig;
}): Promise<string> => {
  const sdk = await getOneKeySdk();
  const coin = getCoinNameByNetwork(networkType);
  const multisig = multisigConfig
    ? buildMultisigRedeemScript({ ...multisigConfig, networkType })
    : undefined;

  const result = (await sdk.btcGetAddress(connectId, deviceId, {
    path: multisig ? getHDPathArray(path) : path,
    coin,
    showOnOneKey: true,
    multisig,
    scriptType: multisig ? getMultisigAddressScriptType(path) : undefined,
    useEmptyPassphrase: true,
  })) as SDKResult<{ address: string }>;

  if (!result?.success) throw new Error(getErrorMessage(result));
  if (!result?.payload?.address) throw new Error('OneKey returned empty address');

  return result.payload.address;
};

// ─── Message signing ──────────────────────────────────────────────────────────

export const signMessageWithOneKey = async ({
  connectId,
  deviceId,
  path,
  message,
  networkType,
}: {
  connectId: string;
  deviceId: string;
  path: string;
  message: string;
  networkType: NetworkType;
}): Promise<{ address: string; signature: string }> => {
  const sdk = await getOneKeySdk();
  const coin = getCoinNameByNetwork(networkType);
  const messageHex = Buffer.from(message, 'utf8').toString('hex');

  const result = (await sdk.btcSignMessage(connectId, deviceId, {
    path,
    messageHex,
    coin,
    useEmptyPassphrase: true,
  })) as SDKResult<{ address: string; signature: string }>;

  if (!result?.success) throw new Error(getErrorMessage(result));
  if (!result?.payload?.signature) throw new Error('OneKey returned empty signature');

  return {
    address: result.payload.address,
    signature: result.payload.signature,
  };
};
