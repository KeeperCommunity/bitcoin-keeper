import React from 'react';
import { render } from '@testing-library/react-native';
import NativeConfig from 'react-native-config';
import DeviceInfo from 'react-native-device-info';
import App from '../../App';

jest.mock('react-native-config', () => ({
  KEEPER_PREVIEW: 'true',
  KEEPER_PREVIEW_TESTNET_ONLY: 'true',
}));

jest.mock('react-native-device-info', () => ({
  getBundleId: jest.fn(() => 'io.hexawallet.keeper.recoverablepreview'),
}));

jest.mock('../../src/preview/recoverable-wallet/RecoverableWalletPreviewApp', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return () => <Text testID="isolated-preview">Preview only</Text>;
});

jest.mock('../../ProductionApp', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text testID="regular-app">Regular Keeper</Text> };
});

describe('App startup boundary', () => {
  afterEach(() => {
    (NativeConfig as any).KEEPER_PREVIEW = 'true';
    (NativeConfig as any).KEEPER_PREVIEW_TESTNET_ONLY = 'true';
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(
      'io.hexawallet.keeper.recoverablepreview'
    );
  });

  test('preview identity starts the isolated client shell', () => {
    const screen = render(<App />);
    expect(screen.getByTestId('isolated-preview')).toBeTruthy();
    expect(screen.queryByTestId('regular-app')).toBeNull();
  });

  test('a preview identity without the testnet flag fails closed', () => {
    (NativeConfig as any).KEEPER_PREVIEW_TESTNET_ONLY = undefined;
    const screen = render(<App />);
    expect(screen.getByText(/misconfigured/)).toBeTruthy();
    expect(screen.queryByTestId('regular-app')).toBeNull();
  });

  test('normal Keeper identity keeps the normal app path', () => {
    (NativeConfig as any).KEEPER_PREVIEW = undefined;
    (NativeConfig as any).KEEPER_PREVIEW_TESTNET_ONLY = undefined;
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue('io.hexawallet.keeper');
    const screen = render(<App />);
    expect(screen.getByTestId('regular-app')).toBeTruthy();
    expect(screen.queryByTestId('isolated-preview')).toBeNull();
  });
});
