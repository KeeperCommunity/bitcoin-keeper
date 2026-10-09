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
const KEYCHAIN_USERNAME = 'recoverable-mobile-key-v1';
const IOS_ACCESSIBLE = 'AccessibleWhenUnlockedThisDeviceOnly' as const;
const ANDROID_SECURITY_LEVEL = 'SECURE_SOFTWARE' as const;
const ANDROID_STORAGE = 'KeystoreAESGCM_NoAuth' as const;

interface StoredCredentials {
  service: string;
  username: string;
  password: string;
  storage?: string;
}

/** Narrow seams allow fail-closed native calls to be tested without a device. */
export interface DeviceMobileKeyAdapters {
  platform: 'ios' | 'android';
  entropy: {
    getRandomBase64(byteLength: number): string;
  };
  keychain: {
    getGenericPassword(options: {
      service: string;
      cloudSync: false;
    }): Promise<false | StoredCredentials>;
    setGenericPassword(
      username: string,
      password: string,
      options: {
        service: string;
        accessible: typeof IOS_ACCESSIBLE;
        cloudSync: false;
        securityLevel?: typeof ANDROID_SECURITY_LEVEL;
        storage?: typeof ANDROID_STORAGE;
      }
    ): Promise<false | { service: string; storage?: string }>;
  };
}

interface StoredDeviceMobileKey {
  version: typeof RECORD_VERSION;
  network: 'testnet';
  signerPath: typeof RECOVERABLE_MOBILE_KEY_SIGNER_PATH;
  seedHex: string;
  masterFingerprint: string;
  xpub: string;
}

export class DeviceMobileKeyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DeviceMobileKeyError';
  }
}

/** Pure public derivation. The caller retains the seed; this function never returns it. */
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
      // The tpub is public and already returned. It is a stable, unique source reference.
      sourceId: `device-generated:${xpub}`,
    },
  };
}

function decodeNativeEntropy(base64: string): Buffer {
  if (typeof base64 !== 'string') {
    throw new DeviceMobileKeyError(
      'ENTROPY_UNAVAILABLE',
      'Native secure random bytes are unavailable'
    );
  }
  const seed = Buffer.from(base64, 'base64');
  if (seed.length !== 32 || seed.toString('base64') !== base64) {
    seed.fill(0);
    throw new DeviceMobileKeyError('INVALID_ENTROPY', 'Native secure random bytes were invalid');
  }
  return seed;
}

function parseStoredKey(
  credentials: StoredCredentials,
  service: string,
  platform: DeviceMobileKeyAdapters['platform']
): RecoverableMobileSigner {
  if (credentials.service !== service || credentials.username !== KEYCHAIN_USERNAME) {
    throw new DeviceMobileKeyError('INVALID_STORAGE', 'Stored Mobile Key identity is invalid');
  }
  if (platform === 'android' && credentials.storage !== ANDROID_STORAGE) {
    throw new DeviceMobileKeyError('INVALID_STORAGE', 'Stored Mobile Key security is insufficient');
  }

  let record: StoredDeviceMobileKey;
  try {
    record = JSON.parse(credentials.password);
  } catch (_) {
    throw new DeviceMobileKeyError('INVALID_STORAGE', 'Stored Mobile Key record is invalid');
  }
  if (
    !record ||
    typeof record !== 'object' ||
    Object.keys(record).sort().join(',') !==
      'masterFingerprint,network,seedHex,signerPath,version,xpub' ||
    record.version !== RECORD_VERSION ||
    record.network !== 'testnet' ||
    record.signerPath !== RECOVERABLE_MOBILE_KEY_SIGNER_PATH ||
    typeof record.seedHex !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.seedHex)
  ) {
    throw new DeviceMobileKeyError('INVALID_STORAGE', 'Stored Mobile Key record is invalid');
  }

  const signer = deriveDeviceMobileKeyPublic(Buffer.from(record.seedHex, 'hex'));
  if (record.masterFingerprint !== signer.masterFingerprint || record.xpub !== signer.xpub) {
    throw new DeviceMobileKeyError(
      'INVALID_STORAGE',
      'Stored Mobile Key public data does not match'
    );
  }
  return signer;
}

function nativeAdapters(): DeviceMobileKeyAdapters {
  // Keep these imports after the preview identity gate. In particular, the
  // package's global getRandomValues polyfill can fall back to Math.random in
  // Chrome debugging; this service calls its native TurboModule directly.
  const { TurboModuleRegistry, Platform } =
    require('react-native') as typeof import('react-native');
  const Keychain = require('react-native-keychain') as typeof import('react-native-keychain');
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new DeviceMobileKeyError('UNSUPPORTED_PLATFORM', 'Mobile Key requires iOS or Android');
  }
  if (
    Platform.OS === 'android' &&
    (String(Keychain.SECURITY_LEVEL.SECURE_SOFTWARE) !== ANDROID_SECURITY_LEVEL ||
      Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH !== ANDROID_STORAGE)
  ) {
    throw new DeviceMobileKeyError('STORAGE_UNAVAILABLE', 'Android secure storage is unavailable');
  }
  return {
    platform: Platform.OS,
    entropy: TurboModuleRegistry.getEnforcing(
      'RNGetRandomValues'
    ) as DeviceMobileKeyAdapters['entropy'],
    keychain: {
      getGenericPassword: (options) => Keychain.getGenericPassword(options),
      setGenericPassword: (username, password, options) => {
        const nativeOptions = {
          service: options.service,
          cloudSync: options.cloudSync,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          ...(Platform.OS === 'android'
            ? {
                securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
                storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
              }
            : {}),
        };
        return Keychain.setGenericPassword(username, password, nativeOptions);
      },
    },
  };
}

function keychainWriteOptions(service: string, platform: DeviceMobileKeyAdapters['platform']) {
  return {
    service,
    accessible: IOS_ACCESSIBLE,
    cloudSync: false as const,
    ...(platform === 'android'
      ? { securityLevel: ANDROID_SECURITY_LEVEL, storage: ANDROID_STORAGE }
      : {}),
  };
}

async function loadOrCreate(
  service: string,
  { platform, entropy, keychain }: DeviceMobileKeyAdapters
): Promise<RecoverableMobileSigner> {
  // A thrown read is never interpreted as absence. A record observed here is
  // never reset or replaced. Single-flight only serializes this JS runtime.
  const stored = await keychain.getGenericPassword({ service, cloudSync: false });
  if (stored) return parseStoredKey(stored, service, platform);

  const seed = decodeNativeEntropy(entropy.getRandomBase64(32));
  let record: StoredDeviceMobileKey;
  try {
    const signer = deriveDeviceMobileKeyPublic(seed);
    record = {
      version: RECORD_VERSION,
      network: 'testnet',
      signerPath: RECOVERABLE_MOBILE_KEY_SIGNER_PATH,
      seedHex: seed.toString('hex'),
      masterFingerprint: signer.masterFingerprint,
      xpub: signer.xpub,
    };
  } finally {
    seed.fill(0);
  }

  const written = await keychain.setGenericPassword(
    KEYCHAIN_USERNAME,
    JSON.stringify(record),
    keychainWriteOptions(service, platform)
  );
  if (
    !written ||
    written.service !== service ||
    (platform === 'android' && written.storage !== ANDROID_STORAGE)
  ) {
    throw new DeviceMobileKeyError('WRITE_FAILED', 'Mobile Key secure storage failed');
  }

  const readback = await keychain.getGenericPassword({ service, cloudSync: false });
  if (!readback) {
    throw new DeviceMobileKeyError('READBACK_FAILED', 'Mobile Key secure storage readback failed');
  }
  const signer = parseStoredKey(readback, service, platform);
  if (
    readback.password !== JSON.stringify(record) ||
    signer.masterFingerprint !== record.masterFingerprint ||
    signer.xpub !== record.xpub
  ) {
    throw new DeviceMobileKeyError(
      'READBACK_MISMATCH',
      'Mobile Key secure storage readback differs'
    );
  }
  return signer;
}

const inFlight = new Map<string, Promise<RecoverableMobileSigner>>();

/**
 * Preview-only, testnet-only device key preparation. It does not create a
 * wallet, register a Server Key, sign, or expose private material to callers.
 */
export function getOrCreatePreviewDeviceMobileKey(
  adapters?: DeviceMobileKeyAdapters
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
      new DeviceMobileKeyError(
        'PREVIEW_ONLY',
        'Mobile Key service requires the testnet preview app'
      )
    );
  }

  const service = `${bundleId}.mobile-key.v1`;
  const pending = inFlight.get(service);
  if (pending) return pending;

  let chosenAdapters: DeviceMobileKeyAdapters;
  try {
    chosenAdapters = adapters ?? nativeAdapters();
  } catch (error) {
    return Promise.reject(
      error instanceof DeviceMobileKeyError
        ? error
        : new DeviceMobileKeyError(
            'ENTROPY_UNAVAILABLE',
            'Native Mobile Key services are unavailable'
          )
    );
  }
  const task = loadOrCreate(service, chosenAdapters);
  inFlight.set(service, task);
  const clear = () => {
    if (inFlight.get(service) === task) inFlight.delete(service);
  };
  void task.then(clear, clear);
  return task;
}
