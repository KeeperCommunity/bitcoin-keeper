import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockDispatch = jest.fn();
const mockState = {
  bhr: {},
  storage: { appCreated: false },
  login: { appCreationError: true },
  account: { allAccounts: [] },
};
jest.mock('src/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (select) => select(mockState),
}));
jest.mock('src/constants/responsive', () => ({ hp: (v) => v, wp: (v) => v, windowWidth: 400 }));
jest.mock('@gluestack-ui/themed-native-base', () => ({
  Box: 'Box',
  Pressable: 'Pressable',
  useColorMode: () => ({ colorMode: 'light' }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('@react-native-firebase/app', () => ({ getApp: jest.fn() }));
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(),
  getToken: async () => 'test-token',
}));
jest.mock('src/hooks/useToastMessage', () => ({
  __esModule: true,
  default: () => ({ showToast: jest.fn() }),
}));
jest.mock('src/store/reducers/login', () => ({
  setAppCreationError: (value) => ({ type: 'ERROR', value }),
}));
jest.mock('src/store/sagaActions/storage', () => ({
  setupKeeperApp: (token) => ({ type: 'SETUP', token }),
}));
jest.mock('src/store/sagaActions/notifications', () => ({ updateFCMTokens: jest.fn() }));
jest.mock('src/utils/service-utilities/config', () => ({
  KEEPER_WEBSITE_BASE_URL: 'https://example.invalid',
}));
jest.mock('src/utils/OpenLink', () => jest.fn());
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: require('../../src/context/Localization/language/en.json'),
  }),
}));
[
  'new-app-icon',
  'icon_arrow',
  'icon_arrow_white',
  'recover-app-icon',
  'settings',
  'settings_grey',
].forEach((name) =>
  jest.doMock(require.resolve(`../../src/assets/images/${name}.svg`), () => () => null)
);
Object.entries({
  'src/components/KeeperModal': 'Modal',
  'src/components/KeeperText': 'Text',
  'src/components/ScreenWrapper': 'Screen',
  'src/components/Loader': 'Loader',
  'src/components/BounceLoader': 'BounceLoader',
  'src/components/ThemedSvg.tsx/ThemedSvg': 'Svg',
}).forEach(([path, name]) => jest.doMock(require.resolve(`../../${path}`), () => name));
const NewKeeperApp = require('../../src/screens/NewKeeperAppScreen/NewKeeperAppScreen').default;

test('setup failure presents one actionable retry dialog and starts one retry', async () => {
  let screen;
  await act(async () => {
    screen = renderer.create(<NewKeeperApp navigation={{ replace: jest.fn() }} />);
  });
  const visible = screen.root.findAllByType('Modal').filter((m) => m.props.visible);
  expect(visible).toHaveLength(1);
  expect(visible[0].props.buttonText).toBe('Retry');
  await act(async () => {
    visible[0].props.buttonCallback();
    visible[0].props.buttonCallback();
  });
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'ERROR', value: false });
  expect(mockDispatch.mock.calls.filter(([a]) => a.type === 'SETUP')).toEqual([
    [{ type: 'SETUP', token: 'test-token' }],
  ]);
  act(() => screen.unmount());
});
