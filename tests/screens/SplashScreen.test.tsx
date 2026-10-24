import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockHasPin = jest.fn();
const mockDispatch = jest.fn();
const mockSetUseTor = jest.fn();
const mockToggleColorMode = jest.fn();
const mockEvents: string[] = [];
let mockSettings;
let mockColorMode = 'light';
let mockDev = false;

jest.mock('src/store/hooks', () => ({
  useAppSelector: (select) => select({ settings: mockSettings }),
}));
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('src/storage/secure-store', () => ({ hasPin: (...args) => mockHasPin(...args) }));
jest.mock('src/services/rest/RestClient', () => ({
  __esModule: true,
  default: { setUseTor: (...args) => mockSetUseTor(...args) },
}));
jest.mock('@gluestack-ui/themed-native-base', () => ({
  useColorMode: () => ({ colorMode: mockColorMode, toggleColorMode: mockToggleColorMode }),
}));
jest.mock('src/utils/service-utilities/config', () => ({
  __esModule: true,
  default: { isDevMode: () => mockDev },
}));
jest.mock('src/store/sagaActions/settings', () => ({
  changeBitcoinNetwork: (networkType) => ({ type: 'NETWORK', networkType }),
}));
jest.mock('src/store/reducers/storage', () => ({
  setDefaultWalletCreated: (payload) => ({ type: 'DEFAULT_WALLET', payload }),
}));
jest.mock('src/constants/responsive', () => ({ windowHeight: 800, windowWidth: 400 }));
jest.mock('src/components/ThemedSvg.tsx/ThemedSvg', () => 'Logo');
jest.mock('src/components/KeeperModal', () => 'Modal');
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: require('../../src/context/Localization/language/en.json'),
  }),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  cancelAnimation: jest.fn(),
  interpolate: () => 1,
  runOnJS: (fn) => fn,
  useAnimatedStyle: (fn) => fn(),
  useSharedValue: (value) => require('react').useRef({ value }).current,
  withSpring: (value) => value,
  withTiming: (value, { duration }, callback) => {
    if (callback) setTimeout(() => callback(true), duration);
    return value;
  },
}));
const SplashScreen = require('../../src/screens/Splash/SplashScreen').default;
let screen;
let navigation;
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function mount() {
  navigation = { replace: jest.fn() };
  await act(async () => {
    screen = renderer.create(<SplashScreen navigation={navigation} />);
  });
}
function visibleDialogs() {
  return screen.root.findAllByType('Modal').filter((modal) => modal.props.visible);
}
beforeEach(() => {
  jest.useFakeTimers();
  mockSettings = { torEnbled: false, themeMode: 'LIGHT', bitcoinNetworkType: 'MAINNET' };
  mockColorMode = 'light';
  mockDev = false;
  mockEvents.length = 0;
  mockDispatch.mockReset().mockImplementation(() => mockEvents.push('dispatch'));
  mockSetUseTor.mockReset().mockImplementation(() => mockEvents.push('tor'));
  mockToggleColorMode.mockReset().mockImplementation(() => mockEvents.push('theme'));
  mockHasPin.mockReset().mockImplementation(async () => {
    mockEvents.push('credentials');
    return true;
  });
});
afterEach(() => {
  if (screen) act(() => screen.unmount());
  screen = null;
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('starts the credential read without waiting for the splash animation', async () => {
  const pin = deferred();
  mockHasPin.mockReturnValue(pin.promise);
  await mount();
  expect(mockHasPin).toHaveBeenCalledTimes(1);
  expect(mockHasPin).toHaveBeenCalledWith({ throwOnError: true });
  expect(navigation.replace).not.toHaveBeenCalled();
  await act(async () => pin.resolve(true));
  expect(navigation.replace).toHaveBeenCalledWith('Login', { relogin: false });
  await act(async () => jest.advanceTimersByTime(10000));
  expect(navigation.replace).toHaveBeenCalledTimes(1);
});

test('only a completed false credential read selects CreatePin', async () => {
  mockHasPin.mockResolvedValue(false);
  await mount();
  expect(navigation.replace).toHaveBeenCalledWith('CreatePin');
  expect(navigation.replace).toHaveBeenCalledTimes(1);
});

test('animation completion cannot bypass a slow credential read', async () => {
  const pin = deferred();
  mockHasPin.mockReturnValue(pin.promise);
  await mount();
  await act(async () => jest.advanceTimersByTime(10000));
  expect(navigation.replace).not.toHaveBeenCalled();
  await act(async () => pin.resolve(true));
  expect(navigation.replace).toHaveBeenCalledWith('Login', { relogin: false });
});

test.each(['resolve', 'reject'])('unmount ignores a late credential %s', async (completion) => {
  const pin = deferred();
  mockHasPin.mockReturnValue(pin.promise);
  await mount();
  expect(mockHasPin).toHaveBeenCalledTimes(1);
  act(() => screen.unmount());
  screen = null;
  await act(async () => {
    if (completion === 'resolve') pin.resolve(true);
    else pin.reject(new Error('private credential detail'));
  });
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('an old mount cannot navigate over the current startup decision', async () => {
  const oldPin = deferred();
  const newPin = deferred();
  mockHasPin.mockReturnValueOnce(oldPin.promise).mockReturnValueOnce(newPin.promise);
  await mount();
  const oldNavigation = navigation;
  act(() => screen.unmount());
  screen = null;
  await mount();
  await act(async () => newPin.resolve(true));
  await act(async () => oldPin.resolve(false));
  expect(oldNavigation.replace).not.toHaveBeenCalled();
  expect(navigation.replace).toHaveBeenCalledWith('Login', { relogin: false });
});

test('credential rejection stays on Splash with one retry and no duplicate read', async () => {
  const retry = deferred();
  mockHasPin
    .mockRejectedValueOnce(new Error('private credential detail'))
    .mockReturnValueOnce(retry.promise);
  await mount();
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(visibleDialogs()).toHaveLength(1);
  expect(JSON.stringify(visibleDialogs()[0].props)).not.toContain('private credential detail');
  const retryAction = visibleDialogs()[0].props.buttonCallback;
  await act(async () => {
    retryAction();
    retryAction();
  });
  await act(async () => retryAction());
  expect(mockHasPin).toHaveBeenCalledTimes(2);
  expect(visibleDialogs()).toHaveLength(0);
  await act(async () => retry.resolve(true));
  expect(navigation.replace).toHaveBeenCalledWith('Login', { relogin: false });
});

test.each([false, true])(
  'initializes default network before credentials (development=%s)',
  async (dev) => {
    mockDev = dev;
    mockSettings.bitcoinNetworkType = null;
    mockSettings.themeMode = 'DARK';
    mockSettings.torEnbled = true;
    await mount();
    const networkType = dev ? 'TESTNET' : 'MAINNET';
    expect(mockDispatch.mock.calls).toEqual([
      [{ type: 'DEFAULT_WALLET', payload: { networkType, created: true } }],
      [{ type: 'NETWORK', networkType }],
    ]);
    expect(mockEvents).toEqual(['dispatch', 'dispatch', 'theme', 'tor', 'credentials']);
    expect(mockSetUseTor).toHaveBeenCalledWith(true);
  }
);

test('rerendering preserves the selected network and does not read credentials again', async () => {
  mockSettings.bitcoinNetworkType = 'TESTNET';
  await mount();
  await act(async () => screen.update(<SplashScreen navigation={navigation} />));
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockHasPin).toHaveBeenCalledTimes(1);
});
