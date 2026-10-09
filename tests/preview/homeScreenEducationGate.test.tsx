import React from 'react';
import { render } from '@testing-library/react-native';
import DeviceInfo from 'react-native-device-info';
import { useAppSelector } from 'src/store/hooks';
import useWallets from 'src/hooks/useWallets';
import { NetworkType, VisibilityType } from 'src/services/wallets/enums';
import HomeScreen from 'src/screens/Home/HomeScreen';

const mockStoreState = {
  bhr: {
    relayWalletUpdate: null,
    relayWalletError: null,
    realyWalletErrorMessage: null,
    homeToastMessage: null,
  },
  account: { recoveryKeyStatusByAppId: {} },
  settings: { bitcoinNetworkType: NetworkType.TESTNET },
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
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('@gluestack-ui/themed-native-base', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useColorMode: () => ({ colorMode: 'light' }),
    Box: ({ children, ...props }) => <View {...props}>{children}</View>,
  };
});
jest.mock('src/store/hooks', () => ({ useAppSelector: jest.fn() }));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('src/hooks/useWallets', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('src/hooks/useVault', () => ({
  __esModule: true,
  default: () => ({ allVaults: [] }),
}));
jest.mock('src/hooks/useUSDTWallets', () => ({
  useUSDTWallets: () => ({ usdtWallets: [] }),
}));
jest.mock('src/hooks/useToastMessage', () => ({
  __esModule: true,
  default: () => ({ showToast: jest.fn() }),
}));
jest.mock('@realm/react', () => ({ useQuery: () => [] }));
jest.mock('src/storage/realm/dbManager', () => ({
  __esModule: true,
  default: { getObjectByIndex: () => ({ id: 'app-id' }) },
}));
jest.mock('src/context/Localization/LocContext', () => {
  const React = require('react');
  return {
    LocalizationContext: React.createContext({
      translations: {
        home: { educationSheetTitle: 'Recovery Key education' },
        wallet: { homeWallets: 'Wallets', keys: 'Keys', more: 'More' },
        buyBTC: { acquire: 'Buy' },
        askAi: { ask: 'Ask' },
      },
    }),
  };
});
jest.mock('src/services/sentry', () => ({ SentryErrorBoundary: (Component) => Component }));
jest.mock('src/components/KeeperModal', () => {
  const { Text, View } = require('react-native');
  return ({ visible, title }) =>
    visible ? (
      <View testID="visible-home-modal">
        <Text>{title}</Text>
      </View>
    ) : null;
});
jest.mock('src/components/KeeperText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ children, ...props }) => <Text {...props}>{children}</Text>;
});
jest.mock('src/screens/Home/InititalAppController', () => () => null);
jest.mock('src/screens/Home/components/Wallet/HomeWallet', () => () => null);
jest.mock('src/screens/Home/components/Keys/ManageKeys', () => () => null);
jest.mock('src/screens/Home/components/Settings/keeperSettings', () => () => null);
jest.mock('src/screens/Home/components/buyBtc/BuyBtc', () => () => null);
jest.mock('src/screens/HelpAi/HelpAiEntry', () => () => null);
jest.mock('src/components/HomeScreenHeader', () => () => null);
jest.mock('src/components/MenuFooter', () => () => null);
jest.mock('src/components/CircleIconWrapper', () => () => null);
jest.mock('src/components/ThemedColor/ThemedColor', () => () => 'green');

describe('first-run Recovery Key education sheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAppSelector as jest.Mock).mockImplementation((selector) => selector(mockStoreState));
    (useWallets as jest.Mock).mockReturnValue({ wallets: [] });
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(
      'io.hexawallet.keeper.recoverablepreview'
    );
    mockStoreState.settings.bitcoinNetworkType = NetworkType.TESTNET;
  });

  it('leaves the empty preview Wallets landing unobscured', () => {
    const screen = render(<HomeScreen route={{ params: { selectedOption: 'Wallets' } }} />);
    expect(screen.queryByText('Recovery Key education')).toBeNull();
  });

  it('preserves education when a wallet exists or the app is production', () => {
    (useWallets as jest.Mock).mockReturnValue({
      wallets: [{ presentationData: { visibility: VisibilityType.DEFAULT } }],
    });
    const withWallet = render(<HomeScreen route={{ params: { selectedOption: 'Wallets' } }} />);
    expect(withWallet.getByText('Recovery Key education')).toBeTruthy();
    withWallet.unmount();

    (useWallets as jest.Mock).mockReturnValue({ wallets: [] });
    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue('io.hexawallet.keeper');
    const production = render(<HomeScreen route={{ params: { selectedOption: 'Wallets' } }} />);
    expect(production.getByText('Recovery Key education')).toBeTruthy();
    production.unmount();

    (DeviceInfo.getBundleId as jest.Mock).mockReturnValue(
      'io.hexawallet.keeper.recoverablepreview'
    );
    mockStoreState.settings.bitcoinNetworkType = NetworkType.MAINNET;
    const mainnet = render(<HomeScreen route={{ params: { selectedOption: 'Wallets' } }} />);
    expect(mainnet.getByText('Recovery Key education')).toBeTruthy();
  });
});
