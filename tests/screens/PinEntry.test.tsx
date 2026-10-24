import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import LoginScreen from 'src/screens/LoginScreen/Login';
import CreatePin from 'src/screens/LoginScreen/CreatePin';
import PasscodeVerify from 'src/components/Modal/PasscodeVerify';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import PinDotView from 'src/components/AppPinInput/PinDotView';
import PinInputsView from 'src/components/AppPinInput/PinInputsView';
import Buttons from 'src/components/Buttons';

const mockDispatch = jest.fn();
const mockCreateSignature = jest.fn();
let mockBackupSession = 0;
const mockState = {
  login: {
    hasCreds: false,
    authenticationFailed: false,
    isAuthenticated: false,
    credsAuthenticatedError: '',
  },
  settings: { loginMethod: 'PIN' },
  account: { allAccounts: [], biometricEnabledAppId: null as string | null },
  storage: { appId: 'disposable-test', failedAttempts: 0, lastLoginFailedAt: 0 },
  notifications: {},
  bhr: {},
};
jest.mock('src/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector) => selector(mockState),
}));
jest.mock('src/services/backup/transport', () => ({
  currentBackupAccountSession: () => mockBackupSession,
}));
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: {
      common: { proceed: 'Proceed', create: 'Create' },
      login: { Incorrect: 'Incorrect PIN' },
      error: {},
    },
  }),
}));
jest.mock('@gluestack-ui/themed-native-base', () => ({
  Box: require('react-native').View,
  View: require('react-native').View,
  StatusBar: () => null,
  useColorMode: () => ({ colorMode: 'light' }),
}));
jest.mock('src/components/KeeperText', () => require('react-native').Text);
jest.mock('src/components/AppNumPad/KeyPadView', () => jest.fn(() => null));
jest.mock('src/components/AppPinInput/PinDotView', () => jest.fn(() => null));
jest.mock('src/components/AppPinInput/PinInputsView', () => jest.fn(() => null));
jest.mock('src/components/KeeperModal', () => () => null);
jest.mock('src/components/ThemedColor/ThemedColor', () => () => '#000');
jest.mock('src/components/ThemedSvg.tsx/ThemedSvg', () => () => null);
jest.mock('src/components/Loader', () => () => null);
jest.mock('src/components/BounceLoader', () => () => null);
jest.mock('src/components/TestnetIndicator', () => () => null);
jest.mock('src/hooks/useToastMessage', () => () => ({ showToast: jest.fn() }));
jest.mock('src/constants/defaultData', () => ({ getSecurityTip: () => ({}) }));
jest.mock('src/constants/Bitcoin', () => ({ isTestnet: () => false }));
jest.mock('src/services/rest/RestClient', () => ({
  __esModule: true,
  default: { getTorStatus: () => 0, subToTorStatus: jest.fn(), unsubscribe: jest.fn() },
  TorStatus: {},
}));
jest.mock('src/storage/realm/dbManager', () => ({}));
jest.mock('src/services/backend/Relay', () => ({
  __esModule: true,
  default: { getAccountManagerDetails: jest.fn(async () => null) },
}));
jest.mock('react-native-biometrics', () =>
  jest.fn(() => ({ createSignature: (...args: unknown[]) => mockCreateSignature(...args) }))
);
jest.mock('@react-native-firebase/app', () => ({ getApp: jest.fn() }));
jest.mock('@react-native-firebase/messaging', () => ({
  AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2 },
  getMessaging: jest.fn(),
  getToken: jest.fn(),
  requestPermission: jest.fn(async () => 0),
}));

let screen: ReactTestRenderer;
const keypad = () => screen.root.findByType(KeyPadView).props;
const input = () => screen.root.findByType(PinDotView).props.passCode;
function enter(value: string) {
  // Deliberately retain one render's handler and queue taps in one batch.
  const press = keypad().onPressNumber;
  act(() => [...value].forEach(press));
}
function erase(count: number) {
  const press = keypad().onDeletePressed;
  act(() => {
    for (let i = 0; i < count; i++) press();
  });
}
function mount(component: React.ReactElement) {
  act(() => {
    screen = create(component);
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  mockDispatch.mockClear();
  mockCreateSignature.mockReset();
  mockState.login.isAuthenticated = false;
  mockState.login.authenticationFailed = false;
  mockState.login.credsAuthenticatedError = '';
  mockState.storage.failedAttempts = 0;
  mockState.storage.lastLoginFailedAt = 0;
  mockBackupSession = 0;
  mockState.settings.loginMethod = 'PIN';
  mockState.storage.appId = 'disposable-test';
  mockState.account.biometricEnabledAppId = null;
});
afterEach(() => {
  act(() => screen?.unmount());
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('biometric login callback lifetime', () => {
  let timers: jest.SpyInstance;
  const navigation = { replace: jest.fn() };
  const route = { params: {} };
  const authCalls = () =>
    mockDispatch.mock.calls.filter(([action]) => action.type === 'CREDS_AUTH');
  const startPrompt = () => {
    // Invoke the actual delayed production callback so its promise is observable.
    // Timer APIs otherwise discard asynchronous callback rejections.
    const callbacks = timers.mock.calls.filter(([, delay]) => delay === 200);
    expect(callbacks.length).toBeGreaterThan(0);
    return callbacks[callbacks.length - 1][0]();
  };
  beforeEach(() => {
    timers = jest.spyOn(global, 'setTimeout');
    mockCreateSignature.mockResolvedValue({ success: false });
    mockState.settings.loginMethod = 'BIOMETRIC';
    mount(<LoginScreen navigation={navigation} route={route} />);
  });

  test('native rejection is handled and leaves PIN login available', async () => {
    mockCreateSignature.mockRejectedValue(new Error('synthetic native cancellation'));
    await act(async () => {
      await expect(startPrompt()).resolves.toBeUndefined();
    });
    expect(authCalls()).toHaveLength(0);
    enter('1111');
    expect(input()).toBe('1111');
    expect(screen.root.findByType(Buttons).props.primaryDisable).toBe(false);
  });

  test('a successful current prompt authenticates its originating account once', async () => {
    mockCreateSignature.mockResolvedValue({ success: true, signature: 'synthetic-signature' });
    await act(async () => {
      await startPrompt();
    });
    expect(authCalls()).toHaveLength(1);
    expect(authCalls()[0][0].payload).toEqual({
      passcode: 'synthetic-signature',
      method: 'BIOMETRIC',
      reLogin: false,
      appId: 'disposable-test',
    });
  });

  test('failed biometric authentication keeps PIN fallback without another automatic prompt', async () => {
    mockCreateSignature.mockResolvedValue({ success: true, signature: 'synthetic-signature' });
    await act(async () => jest.advanceTimersByTime(200));
    expect(mockCreateSignature).toHaveBeenCalledTimes(1);
    act(() => {
      mockState.login.authenticationFailed = true;
      (mockState.login as any).credsAuthenticatedError = 'Biometric Auth Failed';
      screen.update(<LoginScreen navigation={navigation} route={route} />);
    });
    await act(async () => jest.advanceTimersByTime(200));
    mockState.login.authenticationFailed = false;
    (mockState.login as any).credsAuthenticatedError = '';
    expect(mockCreateSignature).toHaveBeenCalledTimes(1);
  });

  test('cancelled native prompt preserves PIN fallback after an incorrect PIN', async () => {
    await act(async () => jest.advanceTimersByTime(200));
    expect(mockCreateSignature).toHaveBeenCalledTimes(1);
    enter('1111');
    act(() => screen.root.findByType(Buttons).props.primaryCallback());
    expect(authCalls()).toHaveLength(1);
    expect(authCalls()[0][0].payload.method).toBe('PIN');
    act(() => {
      mockState.login.authenticationFailed = true;
      mockState.login.credsAuthenticatedError = 'Incorrect Passcode';
      screen.update(<LoginScreen navigation={navigation} route={route} />);
    });
    await act(async () => jest.advanceTimersByTime(200));
    expect(mockCreateSignature).toHaveBeenCalledTimes(1);
    expect(screen.root.findByType(Buttons).props.primaryDisable).toBe(true);
  });

  test('a batched A to B to A session change invalidates a pending native result', async () => {
    let complete = (_result: { success: boolean; signature: string }) => {};
    mockCreateSignature.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    await act(async () => jest.advanceTimersByTime(200));
    expect(mockCreateSignature).toHaveBeenCalledTimes(1);
    // Redux observes both transitions even if React only renders the final A.
    mockBackupSession += 2;
    await act(async () => complete({ success: true, signature: 'stale-synthetic-signature' }));
    expect(authCalls()).toHaveLength(0);
  });

  test('a batched session change cancels the queued prompt before invoking native biometrics', async () => {
    mockBackupSession += 2;
    await act(async () => jest.advanceTimersByTime(200));
    expect(mockCreateSignature).not.toHaveBeenCalled();
    expect(authCalls()).toHaveLength(0);
  });

  test('a real principal change permits one new automatic prompt', async () => {
    await act(async () => jest.advanceTimersByTime(200));
    act(() => {
      mockBackupSession += 1;
      mockState.storage.appId = 'other-disposable-account';
      screen.update(<LoginScreen navigation={navigation} route={route} />);
    });
    await act(async () => jest.advanceTimersByTime(200));
    expect(mockCreateSignature).toHaveBeenCalledTimes(2);
    expect(mockCreateSignature.mock.calls[1][0].payload).toBe('other-disposable-account');
  });

  test('a completed cooldown permits one new automatic prompt', async () => {
    await act(async () => jest.advanceTimersByTime(200));
    act(() => {
      mockState.storage.failedAttempts = 1;
      mockState.storage.lastLoginFailedAt = Date.now();
      screen.update(<LoginScreen navigation={navigation} route={route} />);
    });
    await act(async () => jest.advanceTimersByTime(1000));
    expect(mockCreateSignature).toHaveBeenCalledTimes(1);
    act(() => {
      mockState.storage.lastLoginFailedAt = Date.now() - 301000;
      screen.update(<LoginScreen navigation={navigation} route={route} />);
    });
    await act(async () => jest.advanceTimersByTime(200));
    expect(mockCreateSignature).toHaveBeenCalledTimes(2);
  });

  test('unmount cancels a queued prompt', async () => {
    act(() => screen.unmount());
    await act(async () => jest.runOnlyPendingTimers());
    expect(mockCreateSignature).not.toHaveBeenCalled();
    expect(authCalls()).toHaveLength(0);
  });

  test.each(['unmount', 'account change', 'PIN authentication'])(
    'late native success after %s cannot authenticate',
    async (transition) => {
      let complete = (_result: { success: boolean; signature: string }) => {};
      mockCreateSignature.mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      );
      let pending: Promise<void> = Promise.resolve();
      act(() => {
        pending = startPrompt();
      });
      expect(mockCreateSignature).toHaveBeenCalledTimes(1);
      act(() => {
        if (transition === 'unmount') screen.unmount();
        else {
          if (transition === 'account change') mockState.storage.appId = 'other-disposable-account';
          else mockState.login.isAuthenticated = true;
          screen.update(<LoginScreen navigation={navigation} route={route} />);
        }
      });
      await act(async () => {
        complete({ success: true, signature: 'stale-synthetic-signature' });
        await pending;
      });
      expect(authCalls()).toHaveLength(0);
    }
  );
});

describe('PIN entry under batched rapid taps', () => {
  test('successful local authentication enters the app without a second tap', async () => {
    const navigation = { replace: jest.fn() };
    const route = { params: {} };
    mount(<LoginScreen navigation={navigation} route={route} />);
    await act(async () => {
      mockState.login.isAuthenticated = true;
      screen.update(<LoginScreen navigation={navigation} route={route} />);
    });
    expect(navigation.replace).toHaveBeenCalledWith('App');
    await act(async () => {
      screen.update(<LoginScreen navigation={navigation} route={route} />);
    });
    expect(navigation.replace).toHaveBeenCalledTimes(1);
  });

  test('login keeps every digit, caps at four and deletes in order', () => {
    mount(<LoginScreen navigation={{}} route={{ params: {} }} />);
    enter('123456');
    expect(input()).toBe('1234');
    erase(2);
    expect(input()).toBe('12');
    enter('98');
    expect(input()).toBe('1298');
    erase(6);
    expect(input()).toBe('');
  });

  test('creation accepts rapid confirmation and repeated digits without throttling', () => {
    mount(<CreatePin navigation={{}} route={{ params: {} }} />);
    enter('11111111');
    const dots = screen.root.findAllByType(PinDotView);
    expect(dots.map((dot) => dot.props.passCode)).toEqual(['1111', '1111']);
    expect(screen.root.findByType(Buttons).props.primaryDisable).toBe(false);
    enter('9');
    expect(screen.root.findAllByType(PinDotView)[1].props.passCode).toBe('1111');
    erase(5);
    expect(input()).toBe('111');
    expect(screen.root.findByType(Buttons).props.primaryDisable).toBe(true);
  });

  test('creation mismatch stays disabled and can be corrected by rapid deletion', () => {
    mount(<CreatePin navigation={{}} route={{ params: {} }} />);
    enter('12345678');
    expect(screen.root.findByType(Buttons).props.primaryDisable).toBe(true);
    erase(4);
    enter('1234');
    expect(screen.root.findByType(Buttons).props.primaryDisable).toBe(false);
  });

  test('confirmation keeps Proceed mounted, blocks partial PINs and submits exactly four digits', () => {
    mount(<PasscodeVerify useBiometrics={false} />);
    const button = screen.root.findByType(Buttons);
    const nativeButton = () => screen.root.findByType(TouchableOpacity);
    expect(button.props.primaryText).toBe('Proceed');
    expect(nativeButton().props.disabled).toBe(true);
    act(() => nativeButton().props.onPress());
    expect(mockDispatch).not.toHaveBeenCalled();
    enter('123');
    expect(screen.root.findByType(Buttons)).toBe(button);
    expect(nativeButton().props.disabled).toBe(true);
    enter('45');
    expect(screen.root.findByType(PinInputsView).props.passCode).toBe('1234');
    expect(screen.root.findByType(Buttons)).toBe(button);
    expect(nativeButton().props.disabled).toBe(false);
    act(() => nativeButton().props.onPress());
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch.mock.calls[0][0].payload.passcode).toBe('1234');
    expect(nativeButton().props.disabled).toBe(true);
    erase(2);
    expect(screen.root.findByType(PinInputsView).props.passCode).toBe('12');
  });
});
