import { ImageSourcePropType } from 'react-native';
import type { SearchDevice } from '@onekeyfe/hd-core';
import type { OneKeyDeviceBinding, Signer } from 'src/services/wallets/interfaces/vault';
import type { OneKeyDeviceInfo } from './index';

// ─── Device images ───────────────────────────────────────────────────────────

export const DEVICE_IMAGES: Record<string, ImageSourcePropType> = {
  classic: require('src/assets/images/onekey-devices/classic.png'),
  classic1s: require('src/assets/images/onekey-devices/classic.png'),
  classicpure: require('src/assets/images/onekey-devices/classic-pure.png'),
  touch: require('src/assets/images/onekey-devices/touch.png'),
  pro: require('src/assets/images/onekey-devices/pro-black.png'),
  pro2: require('src/assets/images/onekey-devices/pro2-black.png'),
};

// ─── Device type names ───────────────────────────────────────────────────────

export const DEVICE_TYPE_NAMES: Record<string, string> = {
  classic: 'OneKey Classic',
  classic1s: 'OneKey Classic 1S',
  classicpure: 'OneKey Classic 1S Pure',
  touch: 'OneKey Touch',
  pro: 'OneKey Pro',
  pro2: 'OneKey Pro 2',
  neo: 'OneKey Neo',
};

// ─── Helper functions ────────────────────────────────────────────────────────

export const getDeviceImage = (deviceOrType?: SearchDevice | string): ImageSourcePropType => {
  const dt = typeof deviceOrType === 'string' ? deviceOrType : deviceOrType?.deviceType;
  return (dt && DEVICE_IMAGES[dt]) || DEVICE_IMAGES.pro2;
};

export const getDeviceDisplayName = (device: SearchDevice): string => {
  if (device?.name && device.name !== 'Unknown') return device.name;
  return DEVICE_TYPE_NAMES[device?.deviceType] || 'OneKey Device';
};

export const getDeviceTypeName = (device: SearchDevice): string =>
  DEVICE_TYPE_NAMES[device?.deviceType] || 'OneKey';

export const getOneKeyDeviceBindings = (
  signer: Pick<Signer, 'extraData' | 'signerName' | 'signerDescription'>
): OneKeyDeviceBinding[] => {
  const devices = (signer.extraData?.oneKeyDevices || []).map((device) => ({ ...device }));
  const legacyId = signer.extraData?.bleConnectId;
  if (legacyId && !devices.some((device) => device.bleConnectId === legacyId)) {
    devices.push({
      bleConnectId: legacyId,
      name: signer.signerDescription || signer.signerName || 'OneKey',
    });
  }
  return devices;
};

export const mergeOneKeyDeviceBindings = (
  signer: Pick<Signer, 'extraData' | 'signerName' | 'signerDescription'>,
  incoming: OneKeyDeviceBinding[]
): OneKeyDeviceBinding[] => {
  const devices = getOneKeyDeviceBindings(signer);
  for (const device of incoming) {
    // A serial identifies hardware. An address can only upgrade an unverified legacy binding.
    const index = devices.findIndex((existing) =>
      device.serialNo && existing.serialNo
        ? existing.serialNo === device.serialNo
        : existing.bleConnectId === device.bleConnectId
    );
    if (index < 0) devices.push({ ...device });
    else devices[index] = { ...devices[index], ...device };
  }
  return devices;
};

export const toOneKeyDeviceBinding = (device: OneKeyDeviceInfo): OneKeyDeviceBinding => {
  if (!device.serialNo?.trim())
    throw new Error('Missing OneKey serial number. Please reconnect your device.');
  return {
    serialNo: device.serialNo.trim(),
    bleConnectId: device.connectId,
    name: device.bleName || device.deviceLabel,
    deviceType: device.deviceType,
  };
};

