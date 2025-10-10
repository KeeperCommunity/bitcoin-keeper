import '@testing-library/jest-native/extend-expect';
import 'react-native-gesture-handler/jestSetup';
import { Dimensions } from 'react-native';
import mockRNDeviceInfo from 'react-native-device-info/jest/react-native-device-info-mock';

global.net = require('net'); // needed by Electrum client. For RN it is proviced in shim.js
global.tls = require('tls'); // needed by Electrum client. For RN it is proviced in shim.js

jest.mock('react-native-device-info', () => mockRNDeviceInfo);

jest.mock('react-native/Libraries/Utilities/Dimensions');

jest.spyOn(Dimensions, 'get').mockReturnValue({
  width: 414,
  height: 818,
});

global.crypto = {
  getRandomValues: (arr) => require('crypto').randomBytes(arr.length),
};

jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  // The mock for `call` immediately calls the callback which is incorrect
  // So we override it with a no-op
  Reanimated.default.call = () => {};
  return Reanimated;
});

jest.mock('@react-native-firebase/messaging', () =>
  jest.fn().mockImplementation(() => ({
    hasPermission: jest.fn(() => Promise.resolve(true)),
    subscribeToTopic: jest.fn(),
    unsubscribeFromTopic: jest.fn(),
    requestPermission: jest.fn(() => Promise.resolve(true)),
    getToken: jest.fn(() => Promise.resolve('myMockToken')),
  }))
);

jest.mock('redux-persist', () => {
  const real = jest.requireActual('redux-persist');
  return {
    ...real,
    persistReducer: jest.fn().mockImplementation((config, reducers) => reducers),
  };
});

jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  ReactNavigationInstrumentation: jest.fn(),
  ReactNativeTracing: jest.fn(),
}));

jest.mock('native-base', () => ({
  useToast: () => ({ show: jest.fn() }),
  useColorMode: () => ({ colorMode: 'light', toggleColorMode: jest.fn() }),
  extendTheme: jest.fn(() => ({})),

  Box: ({ children }) => <div>{children}</div>,
  View: ({ children }) => <div>{children}</div>,
  Pressable: ({ children, ...props }) => <button {...props}>{children}</button>,
  Text: ({ children }) => <span>{children}</span>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  Badge: ({ children }) => <span>{children}</span>,
  Spinner: () => <div>Loading...</div>,

  HStack: ({ children }) => <div style={{ display: 'flex', flexDirection: 'row' }}>{children}</div>,

  NativeBaseProvider: ({ children }) => <>{children}</>,
}));
