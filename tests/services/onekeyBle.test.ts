import { BleManager } from 'react-native-ble-plx';
import HardwareBLESDK from '@onekeyfe/hd-ble-sdk';
import { PermissionsAndroid, Platform } from 'react-native';
import { NetworkType } from 'src/services/wallets/enums';
import {
  assertOneKeyFingerprint,
  ensureOneKeyBLEReady,
  fetchOneKeySignerData,
  searchOneKeyDevices,
  signPsbtWithOneKey,
} from 'src/services/onekeyBle';

jest.mock('@onekeyfe/hd-ble-sdk', () => ({
  init: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  searchDevices: jest.fn(),
  btcGetPublicKey: jest.fn(),
  btcSignPsbt: jest.fn(),
}));
jest.mock('@onekeyfe/hd-core', () => ({
  UI_EVENT: 'UI_EVENT',
  UI_REQUEST: { REQUEST_PIN: 'pin', REQUEST_BUTTON: 'button', REQUEST_PASSPHRASE: 'passphrase' },
  UI_RESPONSE: { RECEIVE_PIN: 'pin', RECEIVE_PASSPHRASE: 'passphrase' },
}));
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn() }));
jest.mock('src/services/wallets/operations/utils', () => ({ getNetworkByType: jest.fn() }));
jest.mock('src/services/wallets/operations/taproot-utils/noble_ecc', () => ({}));
jest.mock('bip32', () => ({ __esModule: true, default: () => ({}) }));

const sdk = HardwareBLESDK as unknown as Record<string, jest.Mock>;
const adapter = { onStateChange: jest.fn(), state: jest.fn() };
const remove = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  Object.defineProperty(Platform, 'Version', { configurable: true, value: 31 });
  jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
    'android.permission.BLUETOOTH_SCAN': PermissionsAndroid.RESULTS.GRANTED,
    'android.permission.BLUETOOTH_CONNECT': PermissionsAndroid.RESULTS.GRANTED,
  } as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);
  (BleManager as unknown as jest.Mock).mockImplementation(() => adapter);
  adapter.state.mockResolvedValue('PoweredOn');
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('permission denial does not start adapter discovery', async () => {
  (PermissionsAndroid.requestMultiple as jest.Mock).mockResolvedValueOnce({
    'android.permission.BLUETOOTH_SCAN': PermissionsAndroid.RESULTS.DENIED,
  });
  await expect(ensureOneKeyBLEReady()).resolves.toEqual({
    ready: false,
    reason: 'MISSING_PERMISSION',
  });
  expect(adapter.onStateChange).not.toHaveBeenCalled();
});

test('an immediate adapter callback is safe and leaves no timer or subscription', async () => {
  adapter.onStateChange.mockImplementationOnce((callback) => {
    callback('PoweredOn');
    return { remove };
  });
  await expect(ensureOneKeyBLEReady()).resolves.toEqual({ ready: true, reason: null });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('settled Bluetooth-off state cleans up the readiness timer', async () => {
  adapter.onStateChange.mockImplementationOnce((callback) => {
    setTimeout(() => callback('PoweredOff'), 1);
    return { remove };
  });
  const result = ensureOneKeyBLEReady();
  await jest.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toEqual({ ready: false, reason: 'BLE_OFF' });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('unknown adapter state falls back once and removes the subscription', async () => {
  adapter.onStateChange.mockImplementationOnce((callback) => {
    callback('Unknown');
    return { remove };
  });
  const result = ensureOneKeyBLEReady();
  await jest.advanceTimersByTimeAsync(3000);
  await expect(result).resolves.toEqual({ ready: true, reason: null });
  expect(remove).toHaveBeenCalledTimes(1);
});

test('fallback adapter errors reject instead of leaving readiness pending', async () => {
  adapter.onStateChange.mockReturnValueOnce({ remove });
  adapter.state.mockRejectedValueOnce(new Error('adapter unavailable'));
  const result = expect(ensureOneKeyBLEReady()).rejects.toThrow('adapter unavailable');
  await jest.advanceTimersByTimeAsync(3000);
  await result;
  expect(remove).toHaveBeenCalledTimes(1);
});

test('successful scans clear their timeout', async () => {
  sdk.searchDevices.mockResolvedValueOnce({
    success: true,
    payload: [{ connectId: 'test-device' }],
  });
  await expect(searchOneKeyDevices()).resolves.toEqual([{ connectId: 'test-device' }]);
  expect(jest.getTimerCount()).toBe(0);
});

test('a stalled scan fails after fifteen seconds', async () => {
  sdk.searchDevices.mockReturnValueOnce(new Promise(() => {}));
  const result = expect(searchOneKeyDevices()).rejects.toThrow('BLE scan timed out');
  await jest.advanceTimersByTimeAsync(15000);
  await result;
});

test('a failed scan clears its timeout and surfaces the SDK error', async () => {
  sdk.searchDevices.mockResolvedValueOnce({
    success: false,
    payload: { error: 'Bluetooth disconnected' },
  });
  await expect(searchOneKeyDevices()).rejects.toThrow('Bluetooth disconnected');
  expect(jest.getTimerCount()).toBe(0);
});

test('a subscription setup error clears its timer and rejects', async () => {
  adapter.onStateChange.mockImplementationOnce(() => {
    throw new Error('subscription unavailable');
  });
  await expect(ensureOneKeyBLEReady()).rejects.toThrow('subscription unavailable');
  expect(jest.getTimerCount()).toBe(0);
});

test('fingerprint checks reject missing or mismatched devices', () => {
  expect(() =>
    assertOneKeyFingerprint({ masterFingerprint: '1234ABCD' }, { masterFingerprint: '1234abcd' })
  ).not.toThrow();
  expect(() => assertOneKeyFingerprint({ masterFingerprint: '1234ABCD' }, {})).toThrow('Missing');
  expect(() =>
    assertOneKeyFingerprint({ masterFingerprint: '1234ABCD' }, { masterFingerprint: 'DEADBEEF' })
  ).toThrow('mismatch');
});

test.each([NetworkType.MAINNET, NetworkType.TESTNET])(
  'imports the correct account paths on %s with an empty passphrase',
  async (networkType) => {
    sdk.btcGetPublicKey.mockResolvedValue({
      success: true,
      payload: { xpub: 'fixture-xpub', root_fingerprint: 0x1234abcd },
    });
    const result = await fetchOneKeySignerData({
      connectId: 'test-device',
      deviceId: 'test-id',
      networkType,
      accountNumber: 2,
    });
    const coin = networkType === NetworkType.TESTNET ? 1 : 0;
    expect(result.singleSigPath).toBe(`m/84'/${coin}'/2'`);
    expect(result.multiSigPath).toBe(`m/48'/${coin}'/2'/2'`);
    expect(result.taprootPath).toBe(`m/86'/${coin}'/2'`);
    expect(result.mfp).toBe('1234ABCD');
    expect(
      sdk.btcGetPublicKey.mock.calls.every((call) => call[2].useEmptyPassphrase === true)
    ).toBe(true);
  }
);

test('PSBT transport uses testnet and converts the response back to base64', async () => {
  // Transport fixture only; this is not a signed transaction or a hardware test.
  sdk.btcSignPsbt.mockResolvedValueOnce({ success: true, payload: { psbt: '70736274ff' } });
  const result = await signPsbtWithOneKey({
    connectId: 'test-device',
    deviceId: 'test-id',
    networkType: NetworkType.TESTNET,
    serializedPSBT: 'cHNidP8=',
  });
  expect(result).toBe('cHNidP8=');
  expect(sdk.btcSignPsbt).toHaveBeenCalledWith('test-device', 'test-id', {
    psbt: '70736274ff',
    coin: 'TEST',
    useEmptyPassphrase: true,
  });
});

test.each([
  [{ success: false, payload: { code: 802 } }, 'PIN entry was cancelled'],
  [{ success: true, payload: {} }, 'empty signed PSBT'],
])('failed/empty signing results reject: %j', async (response, message) => {
  sdk.btcSignPsbt.mockResolvedValueOnce(response);
  await expect(
    signPsbtWithOneKey({
      connectId: 'test-device',
      deviceId: 'test-id',
      networkType: NetworkType.TESTNET,
      serializedPSBT: 'cHNidP8=',
    })
  ).rejects.toThrow(message);
});
