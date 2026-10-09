import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import NativeConfig from 'react-native-config';
import DeviceInfo from 'react-native-device-info';
import { useAppSelector } from '../../src/store/hooks';
import { NetworkType } from '../../src/services/wallets/enums';
import WalletChoiceScreen from '../../src/screens/AddWalletScreen/WalletChoiceScreen';

const mockNavigation = { navigate: jest.fn(), goBack: jest.fn() };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
}));

jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    KEEPER_EMPTY_WALLET_ONBOARDING: 'true',
    KEEPER_PREVIEW: 'true',
    KEEPER_PREVIEW_TESTNET_ONLY: 'true',
  },
}));

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: { getBundleId: jest.fn() },
}));

jest.mock('src/store/hooks', () => ({ useAppSelector: jest.fn() }));
jest.mock('@gluestack-ui/themed-native-base', () => ({
  useColorMode: () => ({ colorMode: 'light' }),
}));
jest.mock('src/components/ScreenWrapper', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children }) => <View>{children}</View>;
});
jest.mock('src/components/WalletHeader', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return ({ title, onPressHandler }) => (
    <Pressable testID="wallet-choice-back" onPress={onPressHandler}>
      <Text>{title}</Text>
    </Pressable>
  );
});
jest.mock('src/components/KeeperText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ children, ...props }) => <Text {...props}>{children}</Text>;
});

describe('guarded Wallets chooser route', () => {
  beforeEach(() => {
    mockNavigation.navigate.mockClear();
    mockNavigation.goBack.mockClear();
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(
      'io.hexawallet.keeper.recoverablepreview'
    );
    (useAppSelector as jest.Mock).mockReturnValue(NetworkType.TESTNET);
    NativeConfig.KEEPER_EMPTY_WALLET_ONBOARDING = 'true';
  });

  test('fails closed for a normal Keeper app identity and missing flag', () => {
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue('io.hexawallet.keeper');
    const normal = render(<WalletChoiceScreen />);
    expect(normal.queryByTestId('wallet-creation-chooser')).toBeNull();
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    normal.unmount();

    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(
      'io.hexawallet.keeper.recoverablepreview'
    );
    (NativeConfig as any).KEEPER_EMPTY_WALLET_ONBOARDING = undefined;
    const unflagged = render(<WalletChoiceScreen />);
    expect(unflagged.queryByTestId('wallet-creation-chooser')).toBeNull();
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(2);
  });

  test('fails closed if the active network is not testnet', () => {
    (useAppSelector as jest.Mock).mockReturnValue(NetworkType.MAINNET);
    const screen = render(<WalletChoiceScreen route={{ params: { initialStage: 'seedless' } }} />);
    expect(screen.queryByTestId('wallet-creation-chooser')).toBeNull();
    expect(screen.queryByTestId('wallet-choice-seedless-unavailable')).toBeNull();
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });

  test('opens a direct empty-state choice and returns to Wallets on Back', () => {
    const simple = render(<WalletChoiceScreen route={{ params: { initialStage: 'simple' } }} />);
    expect(simple.getByTestId('wallet-choice-simple-options')).toHaveTextContent('Hot Wallet');
    expect(simple.queryByTestId('wallet-creation-chooser')).toBeNull();
    fireEvent.press(simple.getByTestId('wallet-choice-back'));
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    simple.unmount();

    const seedless = render(
      <WalletChoiceScreen route={{ params: { initialStage: 'seedless' } }} />
    );
    expect(seedless.getByTestId('wallet-choice-seedless-unavailable')).toHaveTextContent(
      'separate Keeper Preview app'
    );
    fireEvent.press(seedless.getByTestId('wallet-choice-back'));
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(2);
  });

  test('offers guarded choices without opening an unverified Seedless or Simple flow', () => {
    const screen = render(<WalletChoiceScreen />);
    expect(screen.getByTestId('wallet-creation-chooser')).toHaveTextContent('Seedless Wallet');
    fireEvent.press(screen.getByTestId('wallet-choice-simple'));
    fireEvent.press(screen.getByTestId('wallet-choice-hot'));
    expect(screen.getByTestId('wallet-choice-hot-unavailable')).toHaveTextContent(
      'No wallet or key has been created'
    );
    fireEvent.press(screen.getByTestId('wallet-choice-back'));
    fireEvent.press(screen.getByTestId('wallet-choice-cold'));
    expect(screen.getByTestId('wallet-choice-cold-unavailable')).toHaveTextContent(
      'verified setup flow'
    );
    fireEvent.press(screen.getByTestId('wallet-choice-back'));
    fireEvent.press(screen.getByTestId('wallet-choice-back'));
    fireEvent.press(screen.getByTestId('wallet-choice-seedless'));
    expect(screen.getByTestId('wallet-choice-seedless-unavailable')).toHaveTextContent(
      'No Mobile Key, Server Key, hardware connection, or wallet is created'
    );
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('wallet-choice-back'));
    fireEvent.press(screen.getByTestId('wallet-choice-advanced'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('AddNewWallet');
    fireEvent.press(screen.getByTestId('wallet-choice-import'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('VaultConfigurationCreation');
  });
});
