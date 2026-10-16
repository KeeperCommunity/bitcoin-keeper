import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Dimensions, TouchableOpacity, Text } from 'react-native';
import HomeWallet from 'src/screens/Home/components/Wallet/HomeWallet';
import KeeperModal from 'src/components/KeeperModal';

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate };
const mockDispatch = jest.fn();
const emptySession = () => ({ signers: {}, isComplete: false, lastSynced: null });
const existingSession = () => ({
  signers: { disposable: { keyDescriptor: 'fixture', keyAES: 'fixture' } },
  isComplete: true,
  lastSynced: 123,
});
let mockState: any;

jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('src/store/hooks', () => ({ useAppSelector: (selector) => selector(mockState) }));
jest.mock('src/store/reducers/vaults', () => ({
  resetCollaborativeSession: () => ({ type: 'vault/resetCollaborativeSession' }),
}));
jest.mock('src/store/reducers/utxos', () => ({ clearDustToast: jest.fn() }));
jest.mock('src/hooks/useWallets', () => () => ({ wallets: [] }));
jest.mock('src/hooks/useVault', () => () => ({ allVaults: [] }));
jest.mock('src/hooks/useUSDTWallets', () => ({ useUSDTWallets: () => ({ usdtWallets: [] }) }));
jest.mock('src/hooks/useWalletAsset', () => () => ({
  getWalletCardGradient: jest.fn(),
  getWalletTags: jest.fn(),
}));
jest.mock('src/hooks/useWalletRefresh', () => ({
  useWalletRefresh: () => ({ refreshing: false, autoRefresh: jest.fn() }),
}));
jest.mock('src/hooks/useUTXOSpendability', () => ({ useUTXOSpendability: () => ({}) }));
jest.mock('src/hooks/useToastMessage', () => () => ({ showToast: jest.fn() }));
jest.mock('src/services/electrum/client', () => ({ ELECTRUM_CLIENT: {} }));
jest.mock('src/services/wallets/factories/USDTWalletFactory', () => ({}));
jest.mock('src/screens/Home/components/Wallet/WalletCard', () => () => null);
jest.mock('src/components/AppActivityIndicator/ActivityIndicatorView', () => () => null);
jest.mock('src/components/CircleIconWrapper', () => () => null);
jest.mock('src/components/Fab', () => (props) => require('react').createElement('Fab', props));
jest.mock('src/components/KeeperText', () => require('react-native').Text);
jest.mock('src/components/Buttons', () => (props) => require('react').createElement('Buttons', props));
jest.mock('src/components/Switch/CurrencyTypeSwitch', () => () => null);
jest.mock('src/components/ThemedSvg.tsx/ThemedSvg', () => () => null);
jest.mock('src/hooks/useKeyboard', () => ({ useKeyboard: () => false }));
jest.mock('src/constants/responsive', () => ({ hp: (n) => n, wp: (n) => n, windowWidth: 414 }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('react-native-modal', () => (props) =>
  require('react').createElement('NativeModal', props, props.children)
);
jest.mock('@gluestack-ui/themed-native-base', () => ({
  Box: require('react-native').View,
  View: require('react-native').View,
  Modal: { Header: require('react-native').View, Body: require('react-native').View },
  useColorMode: () => ({ colorMode: 'light' }),
}));
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: {
      wallet: {
        addNewWallet: 'Add wallet',
        collaborativeSessionExists: 'Existing session',
        createWallet: 'New wallet',
      },
      home: { ImportWallet: 'Import wallet' },
      common: { collaborativeWallet: 'Collaborative', continueSession: 'Continue', startNew: 'New' },
    },
  }),
}));
jest.mock('src/assets/images/wallet-white-small.svg', () => () => null);
jest.mock('src/assets/images/import.svg', () => () => null);
jest.mock('src/assets/images/collaborative_vault_white.svg', () => () => null);
jest.mock('src/assets/images/add_white.svg', () => () => null);
jest.mock('src/assets/images/dark-close-icon.svg', () => () => null);
jest.mock('src/assets/images/info_icon.svg', () => () => null);
jest.mock('src/assets/images/info-Dark-icon.svg', () => () => null);

let screen: ReactTestRenderer;
const addModal = () => screen.root.findAllByType(KeeperModal)[0];
const sessionModal = () => screen.root.findAllByType(KeeperModal)[1];
const update = () => act(() => screen.update(<HomeWallet />));

function mount(session = emptySession()) {
  mockState.vault.collaborativeSession = session;
  act(() => {
    screen = create(<HomeWallet />);
  });
}

function selectCollaborative() {
  act(() => screen.root.findByType('Fab' as any).props.onPress());
  const option = addModal().findAllByType(TouchableOpacity).find((press) =>
    press.findAllByType(Text).some((text) => text.props.children === 'Collaborative')
  );
  act(() => option!.props.onPress());
}

function hide(modal: ReturnType<typeof addModal>) {
  const onHide = modal.findByType('NativeModal' as any).props.onModalHide;
  act(() => onHide());
  return onHide;
}

beforeEach(() => {
  jest.useFakeTimers();
  // The global mock lacks a subscription. This native-boundary fake models only
  // remove(), the API that useWindowDimensions calls during component teardown.
  jest.spyOn(Dimensions, 'addEventListener').mockReturnValue({
    remove: jest.fn(),
  } as unknown as ReturnType<typeof Dimensions.addEventListener>);
  mockNavigate.mockClear();
  mockDispatch.mockClear();
  mockState = {
    storage: { appId: 'disposable-account-a' },
    settings: { bitcoinNetworkType: 'TESTNET' },
    vault: { collaborativeSession: emptySession() },
    wallet: { walletSyncing: {} },
    utxos: {},
  };
});
afterEach(() => {
  act(() => screen?.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('Home collaborative wallet native modal handoff', () => {
  test.each([0, 60000])('waits for actual add-modal hide after %i ms, then navigates once', (delay) => {
    mount();
    selectCollaborative();
    expect(addModal().props.visible).toBe(false);
    expect(addModal().findByType('NativeModal' as any).props.isVisible).toBe(false);
    act(() => jest.advanceTimersByTime(delay));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(sessionModal().props.visible).toBe(false);
    const duplicateHide = hide(addModal());
    act(() => duplicateHide());
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('SetupCollaborativeWallet');
  });

  test('opens existing-session choices only after add-modal hide and continues after the second hide', () => {
    mount(existingSession());
    selectCollaborative();
    expect(sessionModal().props.visible).toBe(false);
    const duplicateAddHide = hide(addModal());
    expect(sessionModal().props.visible).toBe(true);
    expect(addModal().findAllByType('NativeModal' as any)).toHaveLength(0);
    act(() => duplicateAddHide());
    act(() => sessionModal().props.buttonCallback());
    act(() => jest.advanceTimersByTime(60000));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    const duplicateSessionHide = hide(sessionModal());
    act(() => duplicateSessionHide());
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockState.vault.collaborativeSession.signers).toHaveProperty('disposable');
  });

  test('new session waits for both native hide and fully observed reset readiness', () => {
    mount(existingSession());
    selectCollaborative();
    hide(addModal());
    act(() => sessionModal().props.secondaryCallback());
    expect(mockDispatch).not.toHaveBeenCalled();
    hide(sessionModal());
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'vault/resetCollaborativeSession' });
    expect(mockNavigate).not.toHaveBeenCalled();
    // A partially cleared session is not readiness to start a new one.
    mockState.vault.collaborativeSession = { ...existingSession(), signers: {} };
    update();
    expect(mockNavigate).not.toHaveBeenCalled();
    mockState.vault.collaborativeSession = emptySession();
    update();
    update();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  test.each(['account', 'network'])('cancels add-modal handoff on %s switch', (switchType) => {
    mount(existingSession());
    selectCollaborative();
    const lateHide = addModal().findByType('NativeModal' as any).props.onModalHide;
    if (switchType === 'account') mockState.storage.appId = 'disposable-account-b';
    else mockState.settings.bitcoinNetworkType = 'MAINNET';
    update();
    act(() => lateHide());
    expect(sessionModal().props.visible).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test.each(['account', 'network'])('cancels pending reset on %s switch before reset settles', (switchType) => {
    mount(existingSession());
    selectCollaborative();
    hide(addModal());
    act(() => sessionModal().props.secondaryCallback());
    hide(sessionModal());
    if (switchType === 'account') mockState.storage.appId = 'disposable-account-b';
    else mockState.settings.bitcoinNetworkType = 'MAINNET';
    mockState.vault.collaborativeSession = emptySession();
    update();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('cancels continuation if account changes while its modal is closing', () => {
    mount(existingSession());
    selectCollaborative();
    hide(addModal());
    act(() => sessionModal().props.buttonCallback());
    const lateHide = sessionModal().findByType('NativeModal' as any).props.onModalHide;
    mockState.storage.appId = 'disposable-account-b';
    update();
    act(() => lateHide());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test('does not continue a session that was reset while its modal was closing', () => {
    mount(existingSession());
    selectCollaborative();
    hide(addModal());
    act(() => sessionModal().props.buttonCallback());
    mockState.vault.collaborativeSession = emptySession();
    update();
    hide(sessionModal());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test('dismissed session choices and a late unmounted close cannot navigate', () => {
    mount(existingSession());
    selectCollaborative();
    hide(addModal());
    act(() => sessionModal().props.close());
    expect(sessionModal().findAllByType('NativeModal' as any)).toHaveLength(0);
    expect(mockNavigate).not.toHaveBeenCalled();
    selectCollaborative();
    const lateHide = addModal().findByType('NativeModal' as any).props.onModalHide;
    act(() => screen.unmount());
    act(() => lateHide());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test.each([
    ['New wallet', 'AddNewWallet'],
    ['Import wallet', 'VaultConfigurationCreation'],
  ])('preserves immediate unrelated %s navigation and modal unmount', (title, destination) => {
    mount();
    act(() => screen.root.findByType('Fab' as any).props.onPress());
    const option = addModal().findAllByType(TouchableOpacity).find((press) =>
      press.findAllByType(Text).some((text) => text.props.children === title)
    );
    act(() => option!.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith(destination);
    expect(addModal().findAllByType('NativeModal' as any)).toHaveLength(0);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test('callers without a hide callback retain immediate unmount behavior', () => {
    act(() => {
      screen = create(<KeeperModal visible close={jest.fn()} />);
    });
    expect(screen.root.findAllByType('NativeModal' as any)).toHaveLength(1);
    act(() => screen.update(<KeeperModal visible={false} close={jest.fn()} />));
    expect(screen.root.findAllByType('NativeModal' as any)).toHaveLength(0);
  });
});
