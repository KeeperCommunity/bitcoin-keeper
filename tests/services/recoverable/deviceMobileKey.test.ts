import {
  deriveDeviceMobileKeyPublic,
  getOrCreatePreviewDeviceMobileKey,
  type DeviceMobileKeyAdapters,
} from 'src/services/wallets/recoverable/deviceMobileKey';
import NativeConfig from 'react-native-config';
import DeviceInfo from 'react-native-device-info';

jest.mock('react-native-config', () => ({
  __esModule: true,
  default: { KEEPER_PREVIEW: 'true', KEEPER_PREVIEW_TESTNET_ONLY: 'true' },
}));
jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: { getBundleId: jest.fn(() => 'io.hexawallet.keeper.recoverablepreview') },
}));

const seed = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const androidPreviewId = 'io.hexawallet.keeper.recoverablepreview';
const iosPreviewId = 'io.hexawallet.hexakeeper.recoverablepreview';

function adapter(value = seed.toString('base64')): DeviceMobileKeyAdapters {
  return { getOrCreateSeedBase64: jest.fn(async () => value) };
}

describe('preview device-generated Mobile Key', () => {
  beforeEach(() => {
    NativeConfig.KEEPER_PREVIEW = 'true';
    NativeConfig.KEEPER_PREVIEW_TESTNET_ONLY = 'true';
    (DeviceInfo.getBundleId as jest.Mock).mockReset().mockReturnValue(androidPreviewId);
  });

  it('derives a stable testnet BIP48 public signer without returning the seed', () => {
    const signer = deriveDeviceMobileKeyPublic(seed);
    expect(signer).toMatchObject({
      role: 'mobile',
      masterFingerprint: '5A3469B6',
      derivationPath: "m/48'/1'/0'/2'",
      origin: { kind: 'device-generated', version: 1 },
    });
    expect(signer.xpub).toBe(
      'tpubDEhFJsryccF9b2PaR3mgUBVfoYbpVaXsmpK6sonC8cysYcpJzYsZfiwkR9JaoiNWCT9o1HN2bFccb2wMnAXGdKpW6nYQukZMZXfF32RnS6y'
    );
    expect(JSON.stringify(signer)).not.toContain(seed.toString('hex'));
  });

  it.each([Buffer.alloc(0), Buffer.alloc(16), Buffer.alloc(64)])(
    'rejects seeds other than 32 bytes',
    (invalid) => expect(() => deriveDeviceMobileKeyPublic(invalid)).toThrow('32 bytes')
  );

  it.each([
    { bundleId: 'io.hexawallet.keeper', preview: 'true', testnet: 'true' },
    { bundleId: androidPreviewId, preview: undefined, testnet: 'true' },
    { bundleId: androidPreviewId, preview: 'true', testnet: undefined },
  ])('rejects non-preview installed identity before native key access', async (runtime) => {
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(runtime.bundleId);
    NativeConfig.KEEPER_PREVIEW = runtime.preview;
    NativeConfig.KEEPER_PREVIEW_TESTNET_ONLY = runtime.testnet;
    const native = adapter();
    await expect(getOrCreatePreviewDeviceMobileKey(native)).rejects.toMatchObject({
      code: 'PREVIEW_ONLY',
    });
    expect(native.getOrCreateSeedBase64).not.toHaveBeenCalled();
  });

  it('fails closed when installed package identity cannot be read', async () => {
    (DeviceInfo.getBundleId as jest.Mock).mockImplementation(() => {
      throw new Error('native identity unavailable');
    });
    const native = adapter();
    await expect(getOrCreatePreviewDeviceMobileKey(native)).rejects.toMatchObject({
      code: 'PREVIEW_ONLY',
    });
    expect(native.getOrCreateSeedBase64).not.toHaveBeenCalled();
  });

  it('fails closed without the preview native key module', async () => {
    await expect(getOrCreatePreviewDeviceMobileKey()).rejects.toMatchObject({
      code: 'NATIVE_KEY_UNAVAILABLE',
    });
  });

  it.each([androidPreviewId, iosPreviewId])(
    'accepts an exact preview app identity: %s',
    async (bundleId) => {
      (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(bundleId);
      const native = adapter();
      const signer = await getOrCreatePreviewDeviceMobileKey(native);
      expect(native.getOrCreateSeedBase64).toHaveBeenCalledTimes(1);
      expect(signer.xpub).toMatch(/^tpub/);
      expect(JSON.stringify(signer)).not.toContain(seed.toString('hex'));
      expect(Object.keys(signer)).toEqual([
        'role',
        'signerType',
        'masterFingerprint',
        'xpub',
        'derivationPath',
        'origin',
      ]);
    }
  );

  it.each(['not base64', Buffer.alloc(16).toString('base64'), ''])(
    'rejects malformed native seed output',
    async (value) => {
      await expect(getOrCreatePreviewDeviceMobileKey(adapter(value))).rejects.toMatchObject({
        code: 'INVALID_NATIVE_SEED',
      });
    }
  );

  it('propagates native storage failure instead of reporting a ready key', async () => {
    const native: DeviceMobileKeyAdapters = {
      getOrCreateSeedBase64: jest.fn(async () => {
        throw new Error('secure storage unavailable');
      }),
    };
    await expect(getOrCreatePreviewDeviceMobileKey(native)).rejects.toThrow(
      'secure storage unavailable'
    );
  });

  it('propagates a synchronous native bridge failure instead of reporting a ready key', async () => {
    const native: DeviceMobileKeyAdapters = {
      getOrCreateSeedBase64: jest.fn(() => {
        throw new Error('native bridge unavailable');
      }),
    };
    await expect(getOrCreatePreviewDeviceMobileKey(native)).rejects.toThrow(
      'native bridge unavailable'
    );
  });

  it('shares one in-process native request across concurrent callers', async () => {
    let release: (value: string) => void = () => undefined;
    const native: DeviceMobileKeyAdapters = {
      getOrCreateSeedBase64: jest.fn(() => new Promise<string>((resolve) => (release = resolve))),
    };
    const first = getOrCreatePreviewDeviceMobileKey(native);
    const second = getOrCreatePreviewDeviceMobileKey(native);
    expect(first).toBe(second);
    expect(native.getOrCreateSeedBase64).toHaveBeenCalledTimes(1);
    release(seed.toString('base64'));
    expect(await first).toEqual(await second);
  });
});
