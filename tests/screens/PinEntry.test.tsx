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
const mockState = {
  login: { hasCreds: false, authenticationFailed: false, isAuthenticated: false },
  settings: { loginMethod: 'PIN' },
  account: { allAccounts: [] },
  storage: { appId: 'disposable-test', failedAttempts: 0, lastLoginFailedAt: 0 },
  notifications: {},
  bhr: {},
};
jest.mock('src/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector) => selector(mockState),
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
jest.mock('src/services/backend/Relay', () => ({}));
jest.mock('react-native-biometrics', () => jest.fn(() => ({})));
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
});
afterEach(() => {
  act(() => screen?.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('PIN entry under batched rapid taps', () => {
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
