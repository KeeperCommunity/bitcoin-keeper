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

const previewBundleId = 'io.hexawallet.keeper.recoverablepreview';
const service = `${previewBundleId}.mobile-key.v1`;
const seed = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');

type Stored = false | { service: string; username: string; password: string; storage?: string };

function fixture(platform: DeviceMobileKeyAdapters['platform'] = 'ios') {
  let stored: Stored = false;
  const adapters: DeviceMobileKeyAdapters = {
    platform,
    entropy: { getRandomBase64: jest.fn(() => seed.toString('base64')) },
    keychain: {
      getGenericPassword: jest.fn(async () => stored),
      setGenericPassword: jest.fn(async (username, password, options) => {
        stored = { service: options.service, username, password, storage: options.storage };
        return { service: options.service, storage: options.storage };
      }),
    },
  };
  return { adapters, getStored: () => stored, setStored: (value: Stored) => (stored = value) };
}

describe('preview device-generated Mobile Key', () => {
  beforeEach(() => {
    NativeConfig.KEEPER_PREVIEW = 'true';
    NativeConfig.KEEPER_PREVIEW_TESTNET_ONLY = 'true';
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(previewBundleId);
  });

  it('derives a stable testnet BIP48 account tpub and exposes no seed', () => {
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
    if (signer.origin.kind !== 'device-generated') throw new Error('Unexpected Mobile Key origin');
    expect(signer.origin.sourceId).toBe(`device-generated:${signer.xpub}`);
    expect(JSON.stringify(signer)).not.toContain(seed.toString('hex'));
    expect(Object.keys(signer)).toEqual([
      'role',
      'signerType',
      'masterFingerprint',
      'xpub',
      'derivationPath',
      'origin',
    ]);
  });

  it.each([Buffer.alloc(0), Buffer.alloc(16), Buffer.alloc(64)])(
    'rejects seeds other than 32 bytes',
    (invalid) => {
      expect(() => deriveDeviceMobileKeyPublic(invalid)).toThrow('32 bytes');
    }
  );

  it.each([
    { previewFlag: undefined, bundleId: previewBundleId, testnetOnlyFlag: 'true' },
    { previewFlag: 'true', bundleId: 'io.hexawallet.keeper', testnetOnlyFlag: 'true' },
    { previewFlag: 'true', bundleId: previewBundleId, testnetOnlyFlag: undefined },
  ])(
    'rejects any non-preview installed identity before touching adapters',
    async (wrongRuntime) => {
      NativeConfig.KEEPER_PREVIEW = wrongRuntime.previewFlag;
      NativeConfig.KEEPER_PREVIEW_TESTNET_ONLY = wrongRuntime.testnetOnlyFlag;
      (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(wrongRuntime.bundleId);
      const { adapters } = fixture();
      await expect(getOrCreatePreviewDeviceMobileKey(adapters)).rejects.toMatchObject({
        code: 'PREVIEW_ONLY',
      });
      expect(adapters.entropy.getRandomBase64).not.toHaveBeenCalled();
      expect(adapters.keychain.getGenericPassword).not.toHaveBeenCalled();
    }
  );

  it('fails closed if native package identity cannot be read', async () => {
    (DeviceInfo.getBundleId as jest.Mock).mockImplementationOnce(() => {
      throw new Error('native identity unavailable');
    });
    const { adapters } = fixture();
    await expect(getOrCreatePreviewDeviceMobileKey(adapters)).rejects.toMatchObject({
      code: 'PREVIEW_ONLY',
    });
    expect(adapters.entropy.getRandomBase64).not.toHaveBeenCalled();
    expect(adapters.keychain.getGenericPassword).not.toHaveBeenCalled();
  });

  it('stores once under the exact preview service, reads back, and returns public details only', async () => {
    const { adapters, getStored } = fixture();
    const result = await getOrCreatePreviewDeviceMobileKey(adapters);
    expect(result.xpub).toMatch(/^tpub/);
    expect(JSON.stringify(result)).not.toContain(seed.toString('hex'));
    expect(adapters.entropy.getRandomBase64).toHaveBeenCalledWith(32);
    expect(adapters.keychain.getGenericPassword).toHaveBeenCalledWith({
      service,
      cloudSync: false,
    });
    expect(adapters.keychain.setGenericPassword).toHaveBeenCalledWith(
      'recoverable-mobile-key-v1',
      expect.any(String),
      {
        service,
        accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
        cloudSync: false,
      }
    );
    expect(JSON.parse((getStored() as Exclude<Stored, false>).password)).toMatchObject({
      version: 1,
      network: 'testnet',
      signerPath: "m/48'/1'/0'/2'",
      seedHex: seed.toString('hex'),
      xpub: result.xpub,
    });
    expect(await getOrCreatePreviewDeviceMobileKey(adapters)).toEqual(result);
    expect(adapters.keychain.setGenericPassword).toHaveBeenCalledTimes(1);
    expect(adapters.entropy.getRandomBase64).toHaveBeenCalledTimes(1);
  });

  it('requires Android Keystore-backed software security and AES-GCM storage', async () => {
    const { adapters, getStored, setStored } = fixture('android');
    await getOrCreatePreviewDeviceMobileKey(adapters);
    expect(adapters.keychain.setGenericPassword).toHaveBeenCalledWith(
      'recoverable-mobile-key-v1',
      expect.any(String),
      {
        service,
        accessible: 'AccessibleWhenUnlockedThisDeviceOnly',
        cloudSync: false,
        securityLevel: 'SECURE_SOFTWARE',
        storage: 'KeystoreAESGCM_NoAuth',
      }
    );
    const stored = getStored() as Exclude<Stored, false>;
    setStored({ ...stored, storage: 'KeystoreAESCBC' });
    await expect(getOrCreatePreviewDeviceMobileKey(adapters)).rejects.toMatchObject({
      code: 'INVALID_STORAGE',
    });
    expect(adapters.keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  });

  it('never generates or overwrites a corrupt existing record', async () => {
    const { adapters, setStored } = fixture();
    setStored({ service, username: 'recoverable-mobile-key-v1', password: '{' });
    await expect(getOrCreatePreviewDeviceMobileKey(adapters)).rejects.toMatchObject({
      code: 'INVALID_STORAGE',
    });
    expect(adapters.entropy.getRandomBase64).not.toHaveBeenCalled();
    expect(adapters.keychain.setGenericPassword).not.toHaveBeenCalled();
  });

  it('does not replace a stored key whose public data disagrees with the seed', async () => {
    const { adapters, getStored, setStored } = fixture();
    await getOrCreatePreviewDeviceMobileKey(adapters);
    const existing = getStored() as Exclude<Stored, false>;
    const record = JSON.parse(existing.password);
    record.xpub = 'tpubcorrupted';
    setStored({ ...existing, password: JSON.stringify(record) });
    await expect(getOrCreatePreviewDeviceMobileKey(adapters)).rejects.toMatchObject({
      code: 'INVALID_STORAGE',
    });
    expect(adapters.keychain.setGenericPassword).toHaveBeenCalledTimes(1);
    expect(adapters.entropy.getRandomBase64).toHaveBeenCalledTimes(1);
  });

  it('does not generate when the keychain read throws', async () => {
    const { adapters } = fixture();
    adapters.keychain.getGenericPassword = jest.fn(async () => {
      throw new Error('locked');
    });
    await expect(getOrCreatePreviewDeviceMobileKey(adapters)).rejects.toThrow('locked');
    expect(adapters.entropy.getRandomBase64).not.toHaveBeenCalled();
    expect(adapters.keychain.setGenericPassword).not.toHaveBeenCalled();
  });

  it('fails closed when the native entropy call fails or returns malformed data', async () => {
    const { adapters } = fixture();
    adapters.entropy.getRandomBase64 = jest.fn(() => {
      throw new Error('native unavailable');
    });
    await expect(getOrCreatePreviewDeviceMobileKey(adapters)).rejects.toThrow('native unavailable');
    expect(adapters.keychain.setGenericPassword).not.toHaveBeenCalled();

    adapters.entropy.getRandomBase64 = jest.fn(() => 'not base64');
    await expect(getOrCreatePreviewDeviceMobileKey(adapters)).rejects.toMatchObject({
      code: 'INVALID_ENTROPY',
    });
    expect(adapters.keychain.setGenericPassword).not.toHaveBeenCalled();
  });

  it('does not report success on failed write or failed readback', async () => {
    const { adapters } = fixture();
    adapters.keychain.setGenericPassword = jest.fn(async () => false);
    await expect(getOrCreatePreviewDeviceMobileKey(adapters)).rejects.toMatchObject({
      code: 'WRITE_FAILED',
    });

    let reads = 0;
    adapters.keychain.getGenericPassword = jest.fn(async () => {
      reads += 1;
      return false;
    });
    adapters.keychain.setGenericPassword = jest.fn(async () => ({ service }));
    await expect(getOrCreatePreviewDeviceMobileKey(adapters)).rejects.toMatchObject({
      code: 'READBACK_FAILED',
    });
    expect(reads).toBe(2);
  });

  it('rejects a different key returned by secure-storage readback', async () => {
    const { adapters } = fixture();
    let reads = 0;
    adapters.keychain.getGenericPassword = jest.fn(async () => {
      reads += 1;
      return reads === 1
        ? false
        : {
            service,
            username: 'recoverable-mobile-key-v1',
            password: JSON.stringify({
              version: 1,
              network: 'testnet',
              signerPath: "m/48'/1'/0'/2'",
              seedHex: Buffer.alloc(32, 1).toString('hex'),
              masterFingerprint: deriveDeviceMobileKeyPublic(Buffer.alloc(32, 1)).masterFingerprint,
              xpub: deriveDeviceMobileKeyPublic(Buffer.alloc(32, 1)).xpub,
            }),
          };
    });
    await expect(getOrCreatePreviewDeviceMobileKey(adapters)).rejects.toMatchObject({
      code: 'READBACK_MISMATCH',
    });
  });

  it('shares one in-process creation across concurrent callers', async () => {
    const { adapters, getStored } = fixture();
    let releaseRead: (value: Stored) => void = () => undefined;
    adapters.keychain.getGenericPassword = jest
      .fn()
      .mockImplementationOnce(() => new Promise<Stored>((resolve) => (releaseRead = resolve)))
      .mockImplementation(async () => getStored());

    const first = getOrCreatePreviewDeviceMobileKey(adapters);
    const second = getOrCreatePreviewDeviceMobileKey(adapters);
    expect(first).toBe(second);
    expect(adapters.keychain.getGenericPassword).toHaveBeenCalledTimes(1);
    releaseRead(false);
    expect(await first).toEqual(await second);
    expect(adapters.entropy.getRandomBase64).toHaveBeenCalledTimes(1);
    expect(adapters.keychain.setGenericPassword).toHaveBeenCalledTimes(1);
  });
});
