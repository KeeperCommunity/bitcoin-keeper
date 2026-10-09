import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import { Buffer } from 'buffer';
import NativeConfig from 'react-native-config';
import DeviceInfo from 'react-native-device-info';
import { getPreviewRuntime } from 'src/preview/recoverable-wallet/previewRuntime';
import { SignerType } from '../enums';
import ecc from '../operations/taproot-utils/noble_ecc';
import { RECOVERABLE_MOBILE_KEY_SIGNER_PATH } from '../operations/recoverable/mobileKeyConstants';
import type { RecoverableMobileSigner } from './policyDraft';

const bip32 = BIP32Factory(ecc);
const RECORD_VERSION = 1 as const;

/** A narrow seam for native preview key creation; tests never touch a real key store. */
export interface DeviceMobileKeyAdapters {
  getOrCreateSeedBase64(): Promise<string>;
}

export class DeviceMobileKeyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DeviceMobileKeyError';
  }
}

/** Return only public policy input. Private seed bytes are not part of the result. */
export function deriveDeviceMobileKeyPublic(seed: Uint8Array): RecoverableMobileSigner {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) {
    throw new DeviceMobileKeyError('INVALID_SEED', 'Mobile Key seed must be 32 bytes');
  }
  const root = bip32.fromSeed(Buffer.from(seed), bitcoin.networks.testnet);
  const xpub = root.derivePath(RECOVERABLE_MOBILE_KEY_SIGNER_PATH).neutered().toBase58();
  return {
    role: 'mobile',
    signerType: SignerType.MOBILE_KEY,
    masterFingerprint: Buffer.from(root.fingerprint).toString('hex').toUpperCase(),
    xpub,
    derivationPath: RECOVERABLE_MOBILE_KEY_SIGNER_PATH,
    origin: {
      kind: 'device-generated',
      version: RECORD_VERSION,
      sourceId: `device-generated:${xpub}`,
    },
  };
}

function decodeNativeSeed(base64: string): Buffer {
  if (typeof base64 !== 'string') {
    throw new DeviceMobileKeyError('INVALID_NATIVE_SEED', 'Native Mobile Key is invalid');
  }
  const seed = Buffer.from(base64, 'base64');
  if (seed.length !== 32 || seed.toString('base64') !== base64) {
    seed.fill(0);
    throw new DeviceMobileKeyError('INVALID_NATIVE_SEED', 'Native Mobile Key is invalid');
  }
  return seed;
}

function nativeAdapter(): DeviceMobileKeyAdapters {
  // The native module itself checks the compiled preview flavor and installed
  // app ID, and atomically creates or loads a device-only seed. There is no JS
  // random-values or read-then-overwrite Keychain fallback.
  const { NativeModules, Platform } = require('react-native') as typeof import('react-native');
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new DeviceMobileKeyError('UNSUPPORTED_PLATFORM', 'Mobile Key requires iOS or Android');
  }
  const module = NativeModules.KeeperPreviewMobileKey as DeviceMobileKeyAdapters | undefined;
  if (!module || typeof module.getOrCreateSeedBase64 !== 'function') {
    throw new DeviceMobileKeyError(
      'NATIVE_KEY_UNAVAILABLE',
      'Native Mobile Key store is unavailable'
    );
  }
  return module;
}

const inFlight = new Map<string, Promise<RecoverableMobileSigner>>();

/**
 * Preview-only, testnet-only key preparation. This is intentionally not wired
 * to wallet creation, signing, backup, or the simulated "Added" status.
 */
export function getOrCreatePreviewDeviceMobileKey(
  adapter?: DeviceMobileKeyAdapters
): Promise<RecoverableMobileSigner> {
  let bundleId: string;
  try {
    bundleId = DeviceInfo.getBundleId();
  } catch (_) {
    bundleId = '';
  }
  if (
    typeof bundleId !== 'string' ||
    getPreviewRuntime(
      NativeConfig.KEEPER_PREVIEW,
      bundleId,
      NativeConfig.KEEPER_PREVIEW_TESTNET_ONLY
    ) !== 'preview'
  ) {
    return Promise.reject(
      new DeviceMobileKeyError('PREVIEW_ONLY', 'Mobile Key requires the testnet preview app')
    );
  }

  const pending = inFlight.get(bundleId);
  if (pending) return pending;

  let chosen: DeviceMobileKeyAdapters;
  try {
    chosen = adapter ?? nativeAdapter();
  } catch (error) {
    return Promise.reject(error);
  }
  let nativeSeed: Promise<string>;
  try {
    nativeSeed = chosen.getOrCreateSeedBase64();
  } catch (error) {
    return Promise.reject(error);
  }
  const task = nativeSeed.then((base64) => {
    const seed = decodeNativeSeed(base64);
    try {
      return deriveDeviceMobileKeyPublic(seed);
    } finally {
      seed.fill(0);
    }
  });
  inFlight.set(bundleId, task);
  const clear = () => {
    if (inFlight.get(bundleId) === task) inFlight.delete(bundleId);
  };
  void task.then(clear, clear);
  return task;
}
