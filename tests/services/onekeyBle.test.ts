import { BleManager } from 'react-native-ble-plx';
import HardwareBLESDK from '@onekeyfe/hd-ble-sdk';
import * as bitcoinMessage from 'bitcoinjs-message';
import { DeviceEventEmitter, PermissionsAndroid, Platform } from 'react-native';
import { UI_EVENT, UI_REQUEST, UI_RESPONSE } from '@onekeyfe/hd-core';
import { NetworkType } from 'src/services/wallets/enums';
import {
  assertOneKeyFingerprint,
  ensureOneKeyBLEReady,
  fetchOneKeySignerData,
  getOneKeyDeviceInfo,
  getOneKeySdk,
  ONEKEY_UI_EVENT,
  searchOneKeyDevices,
  signPsbtWithOneKey,
  signMessageWithOneKey,
} from 'src/services/onekeyBle';

jest.mock('@onekeyfe/hd-ble-sdk', () => ({
  init: jest.fn().mockResolvedValue(true),
  on: jest.fn(),
  searchDevices: jest.fn(),
  btcGetPublicKey: jest.fn(),
  btcSignPsbt: jest.fn(),
  btcSignMessage: jest.fn(),
  getFeatures: jest.fn(),
  getDeviceState: jest.fn(),
  openWalletSession: jest.fn(),
  uiResponse: jest.fn(),
  cancel: jest.fn(),
}));
jest.mock('@onekeyfe/hd-core', () => ({
  UI_EVENT: 'UI_EVENT',
  UI_REQUEST: {
    REQUEST_PIN: 'pin', REQUEST_BUTTON: 'button', REQUEST_PASSPHRASE: 'passphrase',
    CLOSE_UI_PIN_WINDOW: 'close-pin', CLOSE_UI_WINDOW: 'close',
  },
  UI_RESPONSE: { RECEIVE_PIN: 'pin', RECEIVE_PASSPHRASE: 'passphrase' },
}));
jest.mock('react-native-ble-plx', () => ({ BleManager: jest.fn() }));
jest.mock('src/services/wallets/operations/utils', () => ({ getNetworkByType: jest.fn() }));
jest.mock('src/services/wallets/operations/taproot-utils/noble_ecc', () => ({}));
jest.mock('bip32', () => ({ __esModule: true, default: () => ({}) }));

const sdk = HardwareBLESDK as unknown as Record<string, jest.Mock>;
const adapter = { onStateChange: jest.fn(), state: jest.fn(), stopDeviceScan: jest.fn() };
const remove = jest.fn();
let uiHandler: (message: any) => void;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  sdk.on.mockImplementation((event, handler) => {
    if (event === UI_EVENT) uiHandler = handler;
  });
  sdk.openWalletSession.mockResolvedValue({
    success: true,
    payload: { protocol: 'V2', walletType: 'standard', deviceId: 'test-id', passphraseState: null },
  });
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  Object.defineProperty(Platform, 'Version', { configurable: true, value: 31 });
  jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
    'android.permission.BLUETOOTH_SCAN': PermissionsAndroid.RESULTS.GRANTED,
    'android.permission.BLUETOOTH_CONNECT': PermissionsAndroid.RESULTS.GRANTED,
  } as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);
  (BleManager as unknown as jest.Mock).mockImplementation(() => adapter);
  adapter.state.mockResolvedValue('PoweredOn');
  adapter.stopDeviceScan.mockResolvedValue(undefined);
});

afterEach(() => {
  // Finish the simulated prompt without leaking the SDK singleton's UI state.
  uiHandler?.({
    type: UI_REQUEST.REQUEST_BUTTON,
    payload: { device: { connectId: 'test-reset', connectProtocol: 'V1' } },
  });
  uiHandler?.({ type: UI_REQUEST.CLOSE_UI_WINDOW });
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('failed SDK initialization is not cached and can be retried', async () => {
  sdk.init.mockResolvedValueOnce(false);
  await expect(getOneKeySdk()).rejects.toThrow('Failed to initialize OneKey SDK');
  expect(sdk.on).not.toHaveBeenCalled();
  await expect(getOneKeySdk()).resolves.toBe(sdk);
  expect(sdk.init).toHaveBeenCalledTimes(2);
  expect(sdk.on).toHaveBeenCalledTimes(1);
});

test.each([
  ['pro', 'V1'],
  ['pro2', 'V2'],
  ['neo', 'V2'],
])(
  'reads %s identity and custom name after opening the standard wallet',
  async (deviceType, protocol) => {
    sdk.openWalletSession.mockResolvedValueOnce({
      success: true,
      payload: { protocol, walletType: 'standard', deviceId: 'test-id', passphraseState: null },
    });
    sdk.getDeviceState.mockResolvedValueOnce({
      success: true,
      payload: {
        identity: {
          deviceId: 'test-id',
          deviceType,
          serialNo: 'fixture-serial',
          label: 'My Keeper',
          bleName: 'fixture-ble',
        },
      },
    });
    sdk.btcGetPublicKey.mockResolvedValueOnce({
      success: true,
      payload: { root_fingerprint: 0x1234abcd },
    });

    await expect(getOneKeyDeviceInfo('test-device')).resolves.toEqual({
      connectId: 'test-device',
      deviceId: 'test-id',
      deviceType,
      serialNo: 'fixture-serial',
      deviceLabel: 'My Keeper',
      bleName: 'fixture-ble',
      masterFingerprint: '1234ABCD',
    });
    expect(sdk.openWalletSession).toHaveBeenCalledWith('test-device', { mode: 'standard' });
    expect(sdk.getDeviceState).toHaveBeenCalledWith('test-device', { scope: 'settings' });
    expect(sdk.openWalletSession.mock.invocationCallOrder[0]).toBeLessThan(
      sdk.btcGetPublicKey.mock.invocationCallOrder[0]
    );
    expect(sdk.getFeatures).not.toHaveBeenCalled();
  }
);

test('wallet-open failures stop device identification before key derivation', async () => {
  sdk.openWalletSession.mockResolvedValueOnce({
    success: false,
    payload: { error: 'Device disconnected' },
  });
  await expect(getOneKeyDeviceInfo('test-device')).rejects.toThrow('Device disconnected');
  expect(sdk.getDeviceState).not.toHaveBeenCalled();
  expect(sdk.btcGetPublicKey).not.toHaveBeenCalled();
});

test('a different device identity cannot continue the opened wallet flow', async () => {
  sdk.getDeviceState.mockResolvedValueOnce({
    success: true,
    payload: { identity: { deviceId: 'different-id' } },
  });
  await expect(getOneKeyDeviceInfo('test-device')).rejects.toThrow('device changed');
  expect(sdk.btcGetPublicKey).not.toHaveBeenCalled();
});

test.each([
  [{ device: { connectProtocol: 'V1' } }, true],
  [{ device: { connectProtocol: 'V2' } }, false],
  [{ interaction: { protocol: 'V2' } }, false],
])(
  'PIN hints preserve V1 responses and leave V2 on-device prompts non-blocking: %j',
  async (payload, responds) => {
    await getOneKeySdk();
    const emit = jest.spyOn(DeviceEventEmitter, 'emit');
    uiHandler({ type: UI_REQUEST.REQUEST_PIN, payload });
    expect(emit).toHaveBeenCalledWith(ONEKEY_UI_EVENT, UI_REQUEST.REQUEST_PIN);
    if (responds) {
      expect(sdk.uiResponse).toHaveBeenCalledWith({
        type: UI_RESPONSE.RECEIVE_PIN,
        payload: '@@ONEKEY_INPUT_PIN_IN_DEVICE',
      });
    } else {
      expect(sdk.uiResponse).not.toHaveBeenCalled();
    }
  }
);

test.each([UI_REQUEST.CLOSE_UI_PIN_WINDOW, UI_REQUEST.CLOSE_UI_WINDOW])(
  'legacy close event %s clears its prompt without issuing another cancel',
  async (type) => {
    await getOneKeySdk();
    const emit = jest.spyOn(DeviceEventEmitter, 'emit');
    uiHandler({ type: UI_REQUEST.REQUEST_PIN });
    emit.mockClear();
    uiHandler({ type });
    expect(emit).toHaveBeenCalledWith(ONEKEY_UI_EVENT, 'idle');
    expect(sdk.cancel).not.toHaveBeenCalled();
  }
);

const uiInteraction = (overrides: Record<string, unknown> = {}) => ({
  protocol: 'V2',
  interactionId: 'interaction-1',
  phaseId: 'pin-1',
  sequence: 1,
  phase: 'pin',
  transition: 'start',
  ...overrides,
});

test.each([
  ['pro2', UI_REQUEST.CLOSE_UI_PIN_WINDOW],
  ['neo', UI_REQUEST.CLOSE_UI_PIN_WINDOW],
  ['pro2', UI_REQUEST.CLOSE_UI_WINDOW],
  ['neo', UI_REQUEST.CLOSE_UI_WINDOW],
])('a matching %s close event %s clears the prompt once', async (deviceType, type) => {
  await getOneKeySdk();
  const emit = jest.spyOn(DeviceEventEmitter, 'emit');
  const device = { connectId: 'test-device', connectProtocol: 'V2', deviceType };
  uiHandler({ type: UI_REQUEST.REQUEST_PIN, payload: { device, interaction: uiInteraction() } });
  emit.mockClear();
  const close = {
    type,
    payload: { ...uiInteraction({ sequence: 2, transition: 'complete' }), device },
  };
  uiHandler(close);
  uiHandler(close);
  expect(emit).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith(ONEKEY_UI_EVENT, 'idle');
  expect(sdk.uiResponse).not.toHaveBeenCalled();
  expect(sdk.cancel).not.toHaveBeenCalled();
});

test.each([
  ['late PIN completion', UI_REQUEST.CLOSE_UI_PIN_WINDOW, uiInteraction({ sequence: 4 })],
  ['old interaction', UI_REQUEST.CLOSE_UI_WINDOW, uiInteraction({ interactionId: 'older', sequence: 4 })],
  ['older sequence', UI_REQUEST.CLOSE_UI_WINDOW, uiInteraction({ sequence: 2 })],
  ['duplicate sequence', UI_REQUEST.CLOSE_UI_WINDOW, uiInteraction({ sequence: 3 })],
  ['another device', UI_REQUEST.CLOSE_UI_WINDOW, {
    ...uiInteraction({ sequence: 4 }), device: { connectId: 'other-device' },
  }],
  ['metadata-less close', UI_REQUEST.CLOSE_UI_WINDOW, undefined],
  ['metadata-less PIN close', UI_REQUEST.CLOSE_UI_PIN_WINDOW, undefined],
])('%s cannot dismiss the current V2 button prompt', async (_name, type, payload) => {
  await getOneKeySdk();
  const emit = jest.spyOn(DeviceEventEmitter, 'emit');
  const device = { connectId: 'test-device', connectProtocol: 'V2' };
  uiHandler({ type: UI_REQUEST.REQUEST_PIN, payload: { device, interaction: uiInteraction() } });
  uiHandler({
    type: UI_REQUEST.REQUEST_BUTTON,
    payload: { device, interaction: uiInteraction({ phase: 'button', phaseId: 'button-1', sequence: 3 }) },
  });
  emit.mockClear();
  uiHandler({ type, payload });
  expect(emit).not.toHaveBeenCalled();
  expect(sdk.cancel).not.toHaveBeenCalled();
  uiHandler({
    type: UI_REQUEST.CLOSE_UI_WINDOW,
    payload: { ...uiInteraction({ phase: 'button', phaseId: 'button-1', sequence: 5 }), device },
  });
  expect(emit).toHaveBeenCalledWith(ONEKEY_UI_EVENT, 'idle');
});

test('a PIN close from another phase cannot dismiss the current V2 PIN prompt', async () => {
  await getOneKeySdk();
  const emit = jest.spyOn(DeviceEventEmitter, 'emit');
  const device = { connectId: 'test-device', connectProtocol: 'V2' };
  uiHandler({ type: UI_REQUEST.REQUEST_PIN, payload: { device, interaction: uiInteraction() } });
  emit.mockClear();
  uiHandler({
    type: UI_REQUEST.CLOSE_UI_PIN_WINDOW,
    payload: { ...uiInteraction({ phaseId: 'older-pin', sequence: 2 }), device },
  });
  expect(emit).not.toHaveBeenCalled();
  uiHandler({
    type: UI_REQUEST.CLOSE_UI_PIN_WINDOW,
    payload: { ...uiInteraction({ sequence: 3 }), device },
  });
  expect(emit).toHaveBeenCalledWith(ONEKEY_UI_EVENT, 'idle');
});

test('an older V2 request cannot replace the current button prompt', async () => {
  await getOneKeySdk();
  const emit = jest.spyOn(DeviceEventEmitter, 'emit');
  const device = { connectId: 'test-device', connectProtocol: 'V2' };
  uiHandler({
    type: UI_REQUEST.REQUEST_BUTTON,
    payload: { device, interaction: uiInteraction({ phase: 'button', phaseId: 'button-1', sequence: 3 }) },
  });
  emit.mockClear();
  uiHandler({ type: UI_REQUEST.REQUEST_PIN, payload: { device, interaction: uiInteraction() } });
  uiHandler({
    type: UI_REQUEST.CLOSE_UI_PIN_WINDOW,
    payload: { ...uiInteraction({ sequence: 4 }), device },
  });
  expect(emit).not.toHaveBeenCalled();
});

test('switching from a V2 device to a legacy device preserves PIN responses and close handling', async () => {
  await getOneKeySdk();
  const emit = jest.spyOn(DeviceEventEmitter, 'emit');
  uiHandler({
    type: UI_REQUEST.REQUEST_BUTTON,
    payload: {
      device: { connectId: 'pro2-device', connectProtocol: 'V2' },
      interaction: uiInteraction({ phase: 'button' }),
    },
  });
  uiHandler({
    type: UI_REQUEST.REQUEST_PIN,
    payload: { device: { connectId: 'legacy-device', connectProtocol: 'V1' } },
  });
  expect(sdk.uiResponse).toHaveBeenCalledWith({
    type: UI_RESPONSE.RECEIVE_PIN,
    payload: '@@ONEKEY_INPUT_PIN_IN_DEVICE',
  });
  emit.mockClear();
  uiHandler({ type: UI_REQUEST.CLOSE_UI_PIN_WINDOW });
  expect(emit).toHaveBeenCalledWith(ONEKEY_UI_EVENT, 'idle');
});

test('an unexpected V2 hidden-wallet selection is cancelled instead of sending an empty passphrase', async () => {
  await getOneKeySdk();
  uiHandler({
    type: UI_REQUEST.REQUEST_PASSPHRASE,
    payload: { device: { connectProtocol: 'V2', connectId: 'test-device' } },
  });
  expect(sdk.cancel).toHaveBeenCalledWith('test-device');
  expect(sdk.uiResponse).not.toHaveBeenCalled();
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
  let finishScan;
  sdk.searchDevices.mockReturnValueOnce(new Promise((resolve) => { finishScan = resolve; }));
  const result = expect(searchOneKeyDevices()).rejects.toThrow('BLE scan timed out');
  await jest.advanceTimersByTimeAsync(15000);
  await result;
  finishScan({ success: true, payload: [] });
  await jest.advanceTimersByTimeAsync(1);
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

test('message signatures are returned as Base64 and pass Bitcoin message verification', async () => {
  const message = 'review fixture';
  const address = 'bc1q0xcqpzrky6eff2g52qdye53xkk9jxkvrh6yhyw';
  const signature = bitcoinMessage.sign(message, Buffer.alloc(32, 1), true, undefined, {
    segwitType: 'p2wpkh',
  });
  sdk.btcSignMessage.mockResolvedValueOnce({
    success: true,
    payload: { address, signature: signature.toString('hex') },
  });

  const result = await signMessageWithOneKey({
    connectId: 'test-device',
    deviceId: 'test-id',
    path: "m/84'/0'/0'/0/0",
    message,
    networkType: NetworkType.MAINNET,
  });
  expect(bitcoinMessage.verify(message, result.address, result.signature, undefined, true)).toBe(true);
});

test('an already-cancelled flow does not request permissions or start scanning', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(ensureOneKeyBLEReady(controller.signal)).rejects.toThrow('cancelled');
  await expect(searchOneKeyDevices(controller.signal)).rejects.toThrow('cancelled');
  expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
  expect(sdk.searchDevices).not.toHaveBeenCalled();
});

test('cancelling Bluetooth readiness removes its timer and subscription', async () => {
  adapter.onStateChange.mockReturnValueOnce({ remove });
  const controller = new AbortController();
  const result = expect(ensureOneKeyBLEReady(controller.signal)).rejects.toThrow('cancelled');
  await jest.advanceTimersByTimeAsync(1);
  controller.abort();
  await result;
  expect(remove).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('cancelling a pending scan stops native scanning and removes the timeout', async () => {
  let finishScan;
  sdk.searchDevices.mockReturnValueOnce(new Promise((resolve) => { finishScan = resolve; }));
  const controller = new AbortController();
  const result = expect(searchOneKeyDevices(controller.signal)).rejects.toThrow('cancelled');
  await jest.advanceTimersByTimeAsync(1);
  controller.abort();
  await result;
  expect(sdk.cancel).toHaveBeenCalledTimes(1);
  expect(adapter.stopDeviceScan).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  finishScan({ success: true, payload: [] });
  await jest.advanceTimersByTimeAsync(1);
});

test('a scan timeout removes its cancellation listener and stops scanning', async () => {
  let finishScan;
  sdk.searchDevices.mockReturnValueOnce(new Promise((resolve) => { finishScan = resolve; }));
  const controller = new AbortController();
  const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
  const result = expect(searchOneKeyDevices(controller.signal)).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(15000);
  await result;
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(adapter.stopDeviceScan).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  finishScan({ success: true, payload: [] });
  await jest.advanceTimersByTimeAsync(1);
});

test('a retry waits for the cancelled SDK scan to finish before starting a new scan', async () => {
  let finishOldScan;
  sdk.searchDevices.mockReturnValueOnce(new Promise((resolve) => { finishOldScan = resolve; }));
  sdk.searchDevices.mockResolvedValueOnce({ success: true, payload: [{ connectId: 'new-device' }] });
  const controller = new AbortController();
  const cancelled = expect(searchOneKeyDevices(controller.signal)).rejects.toThrow('cancelled');
  await jest.advanceTimersByTimeAsync(1);
  controller.abort();
  await cancelled;
  const nextScan = searchOneKeyDevices(new AbortController().signal);
  await jest.advanceTimersByTimeAsync(1);
  expect(sdk.searchDevices).toHaveBeenCalledTimes(1);
  // Simulate the SDK's delayed native scan cleanup after cancellation.
  await adapter.stopDeviceScan();
  finishOldScan({ success: true, payload: [] });
  await expect(nextScan).resolves.toEqual([{ connectId: 'new-device' }]);
  expect(sdk.searchDevices).toHaveBeenCalledTimes(2);
});

test.each(['openWalletSession', 'getDeviceState'])('cancelling identification during %s prevents a later fingerprint request', async (method) => {
  let finishState;
  sdk[method].mockReturnValueOnce(new Promise((resolve) => { finishState = resolve; }));
  const controller = new AbortController();
  const result = expect(getOneKeyDeviceInfo('test-device', controller.signal)).rejects.toThrow('cancelled');
  await jest.advanceTimersByTimeAsync(1);
  controller.abort();
  await result;
  finishState({ success: true, payload: { identity: { deviceId: 'test-id' } } });
  await jest.advanceTimersByTimeAsync(1);
  expect(sdk.cancel).toHaveBeenCalledWith('test-device');
  expect(sdk.btcGetPublicKey).not.toHaveBeenCalled();
});

test('cancelling key import prevents the remaining public-key requests', async () => {
  let finishKey;
  sdk.btcGetPublicKey.mockReturnValueOnce(new Promise((resolve) => { finishKey = resolve; }));
  const controller = new AbortController();
  const result = expect(fetchOneKeySignerData({
    connectId: 'test-device', deviceId: 'test-id', networkType: NetworkType.MAINNET,
    signal: controller.signal,
  })).rejects.toThrow('cancelled');
  await jest.advanceTimersByTimeAsync(1);
  controller.abort();
  await result;
  finishKey({ success: true, payload: { xpub: 'fixture-xpub', root_fingerprint: 0x1234abcd } });
  await jest.advanceTimersByTimeAsync(1);
  expect(sdk.btcGetPublicKey).toHaveBeenCalledTimes(1);
  expect(sdk.cancel).toHaveBeenCalledWith('test-device');
});

test('cancelling a pending PSBT signature rejects and ignores the later result', async () => {
  let finishSigning;
  sdk.btcSignPsbt.mockReturnValueOnce(new Promise((resolve) => { finishSigning = resolve; }));
  const controller = new AbortController();
  const result = expect(signPsbtWithOneKey({
    connectId: 'test-device', deviceId: 'test-id', networkType: NetworkType.MAINNET,
    serializedPSBT: 'cHNidP8=', signal: controller.signal,
  })).rejects.toThrow('cancelled');
  await jest.advanceTimersByTimeAsync(1);
  controller.abort();
  await result;
  finishSigning({ success: true, payload: { psbt: '70736274ff' } });
  await jest.advanceTimersByTimeAsync(1);
  expect(sdk.cancel).toHaveBeenCalledWith('test-device');
});
