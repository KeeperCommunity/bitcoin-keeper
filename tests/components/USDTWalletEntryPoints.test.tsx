import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { useQuery } from '@realm/react';
import { CommonActions } from '@react-navigation/native';
import { NetworkType, EntityKind, VisibilityType } from 'src/services/wallets/enums';
import KeeperSettings from 'src/screens/Home/components/Settings/keeperSettings';
import USDTWalletCreationModal from 'src/screens/Home/components/Settings/USDTWalletCreationModal';
import HomeWallet from 'src/screens/Home/components/Wallet/HomeWallet';
import AddUsdtWallet from 'src/screens/USDT/UsdtAddWallet';
import UsdtDetails from 'src/screens/USDT/UsdtDetails';
import RecieveUsdt from 'src/screens/USDT/RecieveUsdt';
import translations from 'src/context/Localization/language/en.json';

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();
const mockCreateWallet = jest.fn();
const mockShowToast = jest.fn();
let mockNetwork = NetworkType.TESTNET;
const mockWallet = {
  id: 'disposable-usdt-wallet',
  entityKind: EntityKind.USDT_WALLET,
  networkType: NetworkType.TESTNET,
  presentationData: {
    name: 'Existing USDT',
    description: 'Preserved wallet',
    visibility: VisibilityType.DEFAULT,
  },
  specs: { balance: 0, transactions: [] },
  accountStatus: { gasFreeAddress: 'disposable-gasfree-address', frozen: 0 },
};

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ dispatch: mockDispatch, navigate: mockNavigate, setParams: jest.fn() }),
}));
jest.mock('@gluestack-ui/themed-native-base', () => {
  const { View, ScrollView } = require('react-native');
  return {
    Box: View,
    View,
    HStack: View,
    VStack: View,
    ScrollView,
    useColorMode: () => ({ colorMode: 'light' }),
  };
});
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: require('src/context/Localization/language/en.json'),
  }),
}));
jest.mock('src/hooks/useUSDTWallets', () => ({
  useUSDTWallets: () => ({
    createWallet: mockCreateWallet,
    usdtWallets: [mockWallet],
    getWalletById: (id) => (id === mockWallet.id ? mockWallet : null),
  }),
}));
jest.mock('src/services/wallets/factories/USDTWalletFactory', () => ({
  USDTWalletSupportedNetwork: 'TESTNET',
  USDTWalletType: { DEFAULT: 'DEFAULT', IMPORTED: 'IMPORTED' },
  getAvailableBalanceUSDTWallet: (wallet) => wallet.specs.balance - wallet.accountStatus.frozen,
}));
jest.mock('src/store/hooks', () => ({
  useAppSelector: (select) =>
    select({
      settings: { bitcoinNetworkType: mockNetwork },
      bhr: { backupAllLoading: false },
      vault: { collaborativeSession: { signers: {} } },
      wallet: { walletSyncing: {} },
      utxos: { pendingDustToast: null },
    }),
}));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('src/hooks/useToastMessage', () => ({
  __esModule: true,
  default: () => ({ showToast: mockShowToast }),
}));
jest.mock('src/hooks/useSettingKeeper', () => ({
  useSettingKeeper: () => ({
    BackAndRecovery: [],
    General: [],
    keysAndwallet: [],
    Tips: [],
    setConfirmPass: jest.fn(),
  }),
}));
jest.mock('src/hooks/useWallets', () => ({ __esModule: true, default: () => ({ wallets: [] }) }));
jest.mock('src/hooks/useVault', () => ({ __esModule: true, default: () => ({ allVaults: [] }) }));
jest.mock('src/hooks/useWalletAsset', () => ({
  __esModule: true,
  default: () => ({ getWalletCardGradient: () => [], getWalletTags: () => [] }),
}));
jest.mock('src/hooks/useUTXOSpendability', () => ({
  useUTXOSpendability: () => ({ hasDoNotSpendUTXOs: false }),
}));
jest.mock('src/store/reducers/settings', () => ({ setShowTipModal: jest.fn() }));
jest.mock('src/store/reducers/vaults', () => ({ resetCollaborativeSession: jest.fn() }));
jest.mock('src/store/reducers/utxos', () => ({ clearDustToast: jest.fn() }));
jest.mock('src/store/sagaActions/wallets', () => ({ autoSyncWallets: jest.fn() }));
jest.mock('src/services/electrum/client', () => ({
  ELECTRUM_CLIENT: { isClientConnected: false },
}));
jest.mock('src/utils/service-utilities/config', () => ({
  __esModule: true,
  default: { ADDRESS: { settings: '' } },
  KEEPER_WEBSITE_BASE_URL: '',
}));
jest.mock('src/utils/OpenLink', () => jest.fn());
jest.mock(
  'src/components/KeeperText',
  () =>
    ({ children, ...props }) =>
      require('react').createElement(require('react-native').Text, props, children)
);
jest.mock(
  'src/components/KeeperTextInput',
  () => (props) => require('react').createElement(require('react-native').TextInput, props)
);
jest.mock('src/components/ScreenWrapper', () => ({ children }) => <>{children}</>);
jest.mock('src/components/CircleIconWrapper', () => () => null);
jest.mock(
  'src/components/WalletHeader',
  () =>
    ({ title }) =>
      require('react').createElement(require('react-native').Text, null, title)
);
jest.mock('src/components/ThemedSvg.tsx/ThemedSvg', () => () => null);
jest.mock('src/components/ThemedColor/ThemedColor', () => () => '#000');
jest.mock('src/components/NavButton', () => () => null);
jest.mock('src/components/AppActivityIndicator/ActivityIndicatorView', () => () => null);
jest.mock(
  'src/components/KeeperModal',
  () =>
    ({ visible, title, Content }) =>
      visible ? (
        <>
          {require('react').createElement(require('react-native').Text, null, title)}
          {Content && <Content />}
        </>
      ) : null
);
jest.mock(
  'src/components/Buttons',
  () =>
    ({ primaryText, primaryCallback, primaryDisable }) =>
      require('react').createElement(
        require('react-native').Pressable,
        { onPress: primaryCallback, disabled: primaryDisable },
        require('react').createElement(require('react-native').Text, null, primaryText)
      )
);
jest.mock(
  'src/components/Fab',
  () =>
    ({ onPress }) =>
      require('react').createElement(require('react-native').Pressable, {
        onPress,
        testID: 'add_wallet',
      })
);
jest.mock('src/screens/Home/components/Settings/Component/PlebContainer', () => () => null);
jest.mock('src/screens/Home/components/Settings/Component/SettingModal', () => () => null);
jest.mock('src/screens/Home/components/Settings/Component/SettingCard', () => ({ items }) => (
  <>
    {items.map((item) =>
      require('react').createElement(
        require('react-native').Pressable,
        { key: item.title, onPress: item.onPress },
        require('react').createElement(require('react-native').Text, null, item.title)
      )
    )}
  </>
));
jest.mock(
  'src/screens/Home/components/Wallet/WalletCard',
  () =>
    ({ title }) =>
      require('react').createElement(require('react-native').Text, null, title)
);
jest.mock(
  'src/screens/WalletDetails/components/WalletDetailHeader',
  () =>
    ({ title }) =>
      require('react').createElement(require('react-native').Text, null, title)
);
jest.mock(
  'src/screens/WalletDetails/components/DetailCards',
  () =>
    ({ sendCallback, receiveCallback }) =>
      (
        <>
          {require('react').createElement(
            require('react-native').Pressable,
            { onPress: sendCallback },
            require('react').createElement(require('react-native').Text, null, 'Send USDT')
          )}
          {require('react').createElement(
            require('react-native').Pressable,
            { onPress: receiveCallback },
            require('react').createElement(require('react-native').Text, null, 'Receive USDT')
          )}
        </>
      )
);
jest.mock('src/screens/WalletDetails/components/Transactions', () => () => null);
jest.mock('src/screens/WalletDetails/components/MoreCard', () => () => null);
jest.mock(
  'src/components/KeeperQRCode',
  () =>
    ({ qrData }) =>
      require('react').createElement(require('react-native').Text, { testID: 'receive_qr' }, qrData)
);
jest.mock(
  'src/components/WalletCopiableData',
  () =>
    ({ data }) =>
      require('react').createElement(
        require('react-native').Text,
        { testID: 'receive_address' },
        data
      )
);

jest.mock('src/assets/images/import.svg', () => () => null);
jest.mock('src/assets/images/wallet-white-small.svg', () => () => null);
jest.mock('src/assets/images/icon_tick.svg', () => () => null);
jest.mock('src/assets/images/toast_error.svg', () => () => null);
jest.mock('src/assets/images/Twitter.svg', () => () => null);
jest.mock('src/assets/images/Twitter-white.svg', () => () => null);
jest.mock('src/assets/images/noster.svg', () => () => null);
jest.mock('src/assets/images/noster-white.svg', () => () => null);
jest.mock('src/assets/images/Telegram.svg', () => () => null);
jest.mock('src/assets/images/Telegram-white.svg', () => () => null);
jest.mock('src/assets/images/supportDeveloper.svg', () => () => null);
jest.mock('src/assets/images/usdt-wallet-logo.svg', () => () => null);
jest.mock('src/assets/images/collaborative_vault_white.svg', () => () => null);
jest.mock('src/assets/images/add_white.svg', () => () => null);
jest.mock('src/assets/images/addWallet_illustration.svg', () => () => null);
jest.mock('src/assets/images/swap.svg', () => () => null);

describe('USDT Settings entry and existing wallets', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockNetwork = NetworkType.TESTNET;
    (useQuery as jest.Mock).mockReturnValue([{ primaryMnemonic: 'disposable-test-fixture' }]);
  });
  afterEach(() => jest.useRealTimers());

  it('opens create/import from Settings on the supported network', () => {
    const screen = render(<KeeperSettings route={{ params: {} }} />);
    fireEvent.press(screen.getByText(translations.wallet.AddUSDTWallet));
    expect(screen.getByText('Create a new USDT wallet')).toBeTruthy();
    expect(screen.getByText(translations.home.ImportWallet)).toBeTruthy();
  });

  it('hides the Settings entry on the unsupported network', () => {
    mockNetwork = NetworkType.MAINNET;
    const screen = render(<KeeperSettings route={{ params: {} }} />);
    expect(screen.queryByText(translations.wallet.AddUSDTWallet)).toBeNull();
  });

  it('Home keeps existing USDT wallets accessible while Add Wallet has only Bitcoin choices', () => {
    const screen = render(<HomeWallet />);
    fireEvent.press(screen.getByTestId(`wallet_item_${mockWallet.id}`));
    expect(mockNavigate).toHaveBeenCalledWith('usdtDetails', { usdtWalletId: mockWallet.id });
    fireEvent.press(screen.getByTestId('add_wallet'));
    expect(screen.getByText(translations.wallet.createWalletDesc)).toBeTruthy();
    expect(screen.getByText(translations.common.collaborativeWallet)).toBeTruthy();
    expect(screen.queryByText(translations.wallet.AddUSDTWallet)).toBeNull();
    expect(screen.queryByText('Create a new USDT wallet')).toBeNull();
  });

  it('Create dismisses the choice modal and dispatches the registered creation route', () => {
    const close = jest.fn();
    const screen = render(<USDTWalletCreationModal visible close={close} />);
    fireEvent.press(screen.getByText(translations.wallet.createWallet));
    expect(close).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(CommonActions.navigate('addUsdtWallet'));
    expect(mockCreateWallet).not.toHaveBeenCalled();
  });

  it('the creation form renders from a valid KeeperApp fixture and creates using its mnemonic', async () => {
    mockCreateWallet.mockResolvedValueOnce({ newWallet: mockWallet });
    const screen = render(<AddUsdtWallet />);
    expect(screen.getByText(translations.usdtWalletText.addWalletDetails)).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('input_wallet_name'), '  New USDT  ');
    await act(async () => fireEvent.press(screen.getByText(translations.wallet.createYourWallet)));
    expect(mockCreateWallet).toHaveBeenCalledWith({
      type: 'DEFAULT',
      name: 'New USDT',
      description: 'USDT wallet',
      primaryMnemonic: 'disposable-test-fixture',
    });
    act(() => jest.advanceTimersByTime(900));
    expect(mockDispatch).toHaveBeenCalledWith(
      CommonActions.navigate({ name: 'Home', params: { selectedOption: 'Wallets' } })
    );
  });

  it('creation failure remains on the form and shows an error', async () => {
    mockCreateWallet.mockResolvedValueOnce({ error: 'Disposable backend unavailable' });
    const screen = render(<AddUsdtWallet />);
    fireEvent.changeText(screen.getByTestId('input_wallet_name'), 'New USDT');
    await act(async () => fireEvent.press(screen.getByText(translations.wallet.createYourWallet)));
    expect(mockShowToast).toHaveBeenCalledWith(
      'Failed to create wallet: Disposable backend unavailable',
      expect.anything()
    );
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(screen.getByText(translations.wallet.createYourWallet)).toBeTruthy();
  });

  it('Import keeps the USDT seed flow and returns to wallets after success', async () => {
    const close = jest.fn();
    mockCreateWallet.mockResolvedValueOnce({ newWallet: mockWallet });
    const screen = render(<USDTWalletCreationModal visible close={close} />);
    fireEvent.press(screen.getByText(translations.home.ImportWallet));
    const action = mockDispatch.mock.calls[0][0];
    expect(close).toHaveBeenCalledTimes(1);
    expect(action.payload.name).toBe('EnterSeedScreen');
    expect(action.payload.params).toMatchObject({ isImport: true, isUSDTWallet: true });
    await act(async () => action.payload.params.importSeedCta('disposable-import-fixture'));
    expect(mockCreateWallet).toHaveBeenCalledWith({
      type: 'IMPORTED',
      name: 'USDT Wallet',
      description: 'Imported USDT Wallet',
      importDetails: { mnemonic: 'disposable-import-fixture' },
    });
    act(() => jest.advanceTimersByTime(900));
    expect(mockDispatch).toHaveBeenLastCalledWith(
      CommonActions.navigate({ name: 'Home', params: { selectedOption: 'Wallets' } })
    );
  });

  it('failed import shows an error and does not navigate to Home', async () => {
    mockCreateWallet.mockResolvedValueOnce({
      error: 'USDT wallet already exists with the same ID',
    });
    const screen = render(<USDTWalletCreationModal visible close={jest.fn()} />);
    fireEvent.press(screen.getByText(translations.home.ImportWallet));
    await act(async () =>
      mockDispatch.mock.calls[0][0].payload.params.importSeedCta('disposable-import-fixture')
    );
    act(() => jest.advanceTimersByTime(900));
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Failed to import USDT wallet: USDT wallet already exists with the same ID',
      expect.anything()
    );
  });

  it('existing wallet details retain send/receive routes and pass the existing wallet', () => {
    const screen = render(<UsdtDetails route={{ params: { usdtWalletId: mockWallet.id } }} />);
    fireEvent.press(screen.getByText('Send USDT'));
    fireEvent.press(screen.getByText('Receive USDT'));
    expect(mockDispatch).toHaveBeenCalledWith(
      CommonActions.navigate('sendUsdt', { usdtWallet: mockWallet })
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      CommonActions.navigate('usdtReceive', { usdtWallet: mockWallet })
    );
  });

  it('receive still uses the GasFree address for the displayed address and QR', () => {
    const screen = render(<RecieveUsdt route={{ params: { usdtWallet: mockWallet } }} />);
    expect(screen.getByTestId('receive_qr').props.children).toBe(
      mockWallet.accountStatus.gasFreeAddress
    );
    expect(screen.getByTestId('receive_address').props.children).toBe(
      mockWallet.accountStatus.gasFreeAddress
    );
    expect(screen.getByText(translations.usdtWalletText.sendOnlyUsdt)).toBeTruthy();
    expect(mockCreateWallet).not.toHaveBeenCalled();
  });
});
