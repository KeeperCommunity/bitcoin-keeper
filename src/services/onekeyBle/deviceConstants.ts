import { ImageSourcePropType } from 'react-native';
import type { SearchDevice } from '@onekeyfe/hd-core';

// ─── Device images ───────────────────────────────────────────────────────────

export const DEVICE_IMAGES: Record<string, ImageSourcePropType> = {
  classic: require('src/assets/images/onekey-devices/classic.png'),
  classic1s: require('src/assets/images/onekey-devices/classic.png'),
  classicpure: require('src/assets/images/onekey-devices/classic-pure.png'),
  touch: require('src/assets/images/onekey-devices/touch.png'),
  pro: require('src/assets/images/onekey-devices/pro-black.png'),
};

// ─── Device type names ───────────────────────────────────────────────────────

export const DEVICE_TYPE_NAMES: Record<string, string> = {
  classic: 'OneKey Classic',
  classic1s: 'OneKey Classic 1S',
  classicpure: 'OneKey Classic 1S Pure',
  touch: 'OneKey Touch',
  pro: 'OneKey Pro',
};

// ─── Helper functions ────────────────────────────────────────────────────────

export const getDeviceImage = (deviceOrType?: SearchDevice | string): ImageSourcePropType | null => {
  const dt = typeof deviceOrType === 'string' ? deviceOrType : deviceOrType?.deviceType;
  return dt ? DEVICE_IMAGES[dt] || null : null;
};

export const getDeviceDisplayName = (device: SearchDevice): string => {
  if (device?.name && device.name !== 'Unknown') return device.name;
  return DEVICE_TYPE_NAMES[device?.deviceType] || 'OneKey Device';
};

export const getDeviceTypeName = (device: SearchDevice): string =>
  DEVICE_TYPE_NAMES[device?.deviceType] || 'OneKey';
