import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import NativeConfig from 'react-native-config';
import DeviceInfo from 'react-native-device-info';
import { useAppSelector } from 'src/store/hooks';
import useWallets from 'src/hooks/useWallets';
import { NetworkType } from 'src/services/wallets/enums';
import HomeWallet from 'src/screens/Home/components/Wallet/HomeWallet';

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
const mockCommonNavigate = jest.fn(({ name, params }) => ({ type: 'NAVIGATE', name, params }));
const mockStoreState = {
  vault: { collaborativeSession: { signers: {} } },
  settings: { bitcoinNetworkType: NetworkType.TESTNET },
  wallet: { walletSyncing: {} },
  utxos: { pendingDustToast: null },
};

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
  default: {
    getBundleId: jest.fn(),
    getVersion: jest.fn(() => '2.5.13'),
    getBuildNumber: jest.fn(() => '1'),
  },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, dispatch: mockDispatch }),
  CommonActions: { navigate: (route) => mockCommonNavigate(route) },
  useFocusEffect: jest.fn(),
}));
jest.mock('@gluestack-ui/themed-native-base', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useColorMode: () => ({ colorMode: 'light' }),
    Box: ({ children, ...props }) => <View {...props}>{children}</View>,
    View: ({ children, ...props }) => <View {...props}>{children}</View>,
  };
});
jest.mock('src/store/hooks', () => ({ useAppSelector: jest.fn() }));
jest.mock('src/store/reducers/vaults', () => ({ resetCollaborativeSession: jest.fn() }));
jest.mock('src/store/reducers/utxos', () => ({ clearDustToast: jest.fn() }));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('src/hooks/useWallets', () => ({
  __esModule: true,
  default: jest.fn(() => ({ wallets: [] })),
}));
jest.mock('src/hooks/useVault', () => ({ __esModule: true, default: () => ({ allVaults: [] }) }));
jest.mock('src/hooks/useUSDTWallets', () => ({
  useUSDTWallets: () => ({ usdtWallets: [], createWallet: jest.fn() }),
}));
jest.mock('src/hooks/useWalletAsset', () => ({
  __esModule: true,
  default: () => ({ getWalletCardGradient: jest.fn(), getWalletTags: jest.fn() }),
}));
jest.mock('src/hooks/useUTXOSpendability', () => ({
  useUTXOSpendability: () => ({ hasDoNotSpendUTXOs: false }),
}));
jest.mock('src/hooks/useToastMessage', () => ({
  __esModule: true,
  default: () => ({ showToast: jest.fn() }),
}));
jest.mock('src/services/electrum/client', () => ({
  ELECTRUM_CLIENT: { isClientConnected: false },
}));
jest.mock('src/services/wallets/factories/USDTWalletFactory', () => ({
  USDTWalletSupportedNetwork: 'MAINNET',
  USDTWalletType: { IMPORTED: 'IMPORTED' },
  getAvailableBalanceUSDTWallet: jest.fn(),
}));
jest.mock('src/components/KeeperModal', () => () => null);
jest.mock('src/components/AppActivityIndicator/ActivityIndicatorView', () => () => null);
jest.mock('src/components/Fab', () => () => null);
jest.mock('src/screens/Home/components/Wallet/WalletCard', () => () => null);
jest.mock('src/components/ThemedColor/ThemedColor', () => () => 'green');
jest.mock('src/context/Localization/LocContext', () => {
  const React = require('react');
  return {
    LocalizationContext: React.createContext({
      translations: { wallet: {}, home: {}, common: {}, usdtWalletText: {} },
    }),
  };
});
jest.mock('src/components/KeeperText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ children, ...props }) => <Text {...props}>{children}</Text>;
});

describe('first-run Wallets landing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(
      'io.hexawallet.keeper.recoverablepreview'
    );
    (useAppSelector as jest.Mock).mockImplementation((selector) => selector(mockStoreState));
    (useWallets as jest.Mock).mockReturnValue({ wallets: [] });
    NativeConfig.KEEPER_EMPTY_WALLET_ONBOARDING = 'true';
    mockStoreState.settings.bitcoinNetworkType = NetworkType.TESTNET;
  });

  it('shows the three choices directly and routes the selected choice', () => {
    const screen = render(<HomeWallet />);
    expect(screen.getByTestId('wallets-empty-state')).toBeTruthy();
    expect(screen.getByTestId('wallet-choice-simple')).toBeTruthy();
    expect(screen.getByTestId('wallet-choice-seedless')).toBeTruthy();
    expect(screen.getByTestId('wallet-choice-advanced')).toBeTruthy();

    fireEvent.press(screen.getByTestId('wallet-choice-simple'));
    expect(mockCommonNavigate).toHaveBeenCalledWith({
      name: 'WalletChoice',
      params: { initialStage: 'simple' },
    });
    fireEvent.press(screen.getByTestId('wallet-choice-seedless'));
    expect(mockCommonNavigate).toHaveBeenCalledWith({
      name: 'WalletChoice',
      params: { initialStage: 'seedless' },
    });
    fireEvent.press(screen.getByTestId('wallet-choice-advanced'));
    expect(mockCommonNavigate).toHaveBeenCalledWith({ name: 'AddNewWallet' });
    fireEvent.press(screen.getByTestId('wallet-choice-import'));
    expect(mockCommonNavigate).toHaveBeenCalledWith({ name: 'VaultConfigurationCreation' });
  });

  it('keeps the production and mainnet landing unchanged', () => {
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue('io.hexawallet.keeper');
    const production = render(<HomeWallet />);
    expect(production.queryByTestId('wallet-creation-chooser')).toBeNull();
    production.unmount();

    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(
      'io.hexawallet.keeper.recoverablepreview'
    );
    mockStoreState.settings.bitcoinNetworkType = NetworkType.MAINNET;
    const mainnet = render(<HomeWallet />);
    expect(mainnet.queryByTestId('wallet-creation-chooser')).toBeNull();
  });
});
