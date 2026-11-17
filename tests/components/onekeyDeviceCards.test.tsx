import React from 'react';
import { act, create } from 'react-test-renderer';
import SignerList from 'src/screens/Home/components/Keys/SignerList';
import AddSigningDevice from 'src/screens/Vault/AddSigningDevice';
import { XpubTypes } from 'src/services/wallets/enums';

const mockSigner = {
  id: 'shared-key',
  type: 'ONEKEY',
  masterFingerprint: '1234ABCD',
  signerName: 'OneKey',
  signerXpubs: {
    [XpubTypes.AMF]: [],
    [XpubTypes.P2WPKH]: [{ xpub: 'single-xpub' }],
    [XpubTypes.P2WSH]: [{ xpub: 'multi-xpub' }],
  },
  extraData: {
    bleConnectId: 'pro-address',
    oneKeyDevices: [
      { serialNo: 'PRO-SERIAL', bleConnectId: 'pro-address', name: 'Pro' },
      { serialNo: 'PRO2-SERIAL', bleConnectId: 'pro2-address', name: 'Pro 2' },
    ],
  },
};
const mockOtherSigner = {
  ...mockSigner,
  id: 'different-key',
  masterFingerprint: '5678EFAB',
  extraData: {
    oneKeyDevices: [{ serialNo: 'CLASSIC-SERIAL', bleConnectId: 'classic-address', name: 'Classic' }],
  },
};
const mockSigners = [mockSigner, mockOtherSigner];
const mockNavigate = jest.fn();
let mockScheme = { m: 2, n: 3 };
jest.mock('src/hooks/useSigners', () => () => ({ signers: mockSigners }));
jest.mock('src/hooks/useIndicatorHook', () => ({ useIndicatorHook: () => ({}) }));
jest.mock('@realm/react', () => ({ useQuery: () => [{}] }));
jest.mock('src/storage/realm/utils', () => ({ getJSONFromRealmObject: (value) => value }));
jest.mock('src/utils/utilities', () => ({ getKeyUID: (signer) => signer.id }));
jest.mock('src/hardware', () => ({ getSignerDescription: () => '', getSignerNameFromType: () => 'OneKey' }));
jest.mock('src/screens/Vault/SigningDeviceIcons', () => ({ SDIcons: () => ({ Icon: null }) }));
jest.mock('src/screens/Vault/HardwareModalMap', () => ({ __esModule: true, default: () => null, InteracationMode: {} }));
jest.mock('src/screens/AddSigner/SignerCard', () => 'SignerCard');
jest.mock('@gluestack-ui/themed-native-base', () => ({ Box: 'Box', useColorMode: () => ({ colorMode: 'light' }) }));
jest.mock('@react-navigation/native', () => ({
  CommonActions: { navigate: (name, params) => ({ name, params }) },
  useRoute: () => ({ params: { scheme: mockScheme } }),
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));
jest.mock('src/store/hooks', () => ({ useAppSelector: (selector) => selector({ bhr: {} }) }));
jest.mock('src/store/reducers/bhr', () => ({ resetSignersUpdateState: jest.fn() }));
jest.mock('src/hooks/useSignerMap', () => () => ({
  signerMap: Object.fromEntries(mockSigners.map((signer) => [signer.id, signer])),
}));
jest.mock('src/hooks/useSignerIntel', () => () => ({ areSignersValid: true, amfSigners: [] }));
jest.mock('src/hooks/useVault', () => () => ({ activeVault: null, allVaults: [] }));
jest.mock('src/hooks/useToastMessage', () => ({
  __esModule: true,
  default: () => ({ showToast: jest.fn() }),
  IToastCategory: {},
}));
jest.mock('src/services/wallets/operations/utils', () => ({
  getKeyForScheme: (multisig, signer, msXpub, ssXpub) => ({
    id: signer.id,
    masterFingerprint: signer.masterFingerprint,
    ...(multisig ? msXpub : ssXpub),
  }),
}));
jest.mock('src/services/wallets/operations/miniscript/default/EnhancedVault', () => ({}));
jest.mock('src/services/sentry', () => ({ SentryErrorBoundary: (component) => component }));
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: { common: { proceed: 'Proceed' }, vault: {}, wallet: {} },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('src/screens/Vault/VaultMigrationController', () => () => null);
jest.mock('src/components/Buttons', () => 'Buttons');
jest.mock('src/components/Note/Note', () => () => null);
jest.mock('src/components/HexagonIcon', () => () => null);
jest.mock('src/components/KeeperText', () => 'KeeperText');
jest.mock('src/components/KeeperModal', () => () => null);
jest.mock('src/components/CardPill', () => () => null);
jest.mock('src/components/KeyAddedModal', () => () => null);
jest.mock('src/components/AppActivityIndicator/ActivityIndicatorView', () => () => null);
jest.mock('src/components/WalletHeader', () => () => null);
jest.mock('src/screens/SigningDevices/components/AddKeyButton', () => () => null);
jest.mock('src/components/EmptyListIllustration', () => () => null);

test('same-key devices have separate cards and navigate with the selected serial', () => {
  const dispatch = jest.fn();
  let view;
  act(() => { view = create(<SignerList navigation={{ dispatch }} />); });
  const cards = view.root.findAllByType('SignerCard');
  expect(cards.map((card) => card.props.name)).toEqual(['Pro', 'Pro 2', 'Classic']);
  expect(cards.map((card) => card.props.subtitle)).toEqual(['Serial: PRO-SERIAL', 'Serial: PRO2-SERIAL', 'Serial: CLASSIC-SERIAL']);
  act(() => cards[0].props.onCardSelect());
  act(() => cards[1].props.onCardSelect());
  expect(dispatch.mock.calls.map(([action]) => action.params)).toEqual([
    { signerId: 'shared-key', oneKeyDeviceId: 'PRO-SERIAL' },
    { signerId: 'shared-key', oneKeyDeviceId: 'PRO2-SERIAL' },
  ]);
  act(() => view.unmount());
});

test.each([1, 3])(
  'wallet selection shows every device and allows only distinct keys (n=%i)',
  (n) => {
    mockScheme = { m: n === 1 ? 1 : 2, n };
    mockNavigate.mockClear();
    let view;
    act(() => {
      view = create(<AddSigningDevice />);
    });
    const cards = () => view.root.findAllByType('SignerCard');
    const press = (index) =>
      act(() => cards()[index].props.onCardSelect(cards()[index].props.isSelected));
    expect(cards().map((card) => card.props.name)).toEqual(['Pro', 'Pro 2', 'Classic']);
    expect(cards().every((card) => !card.props.disabled && !card.props.isSelected)).toBe(true);
    expect(
      cards()
        .map((card) => card.props.description)
        .join(' ')
    ).not.toMatch(/same key/i);

  act(() => {
    const initialCards = cards();
    initialCards[1].props.onCardSelect(false);
    initialCards[0].props.onCardSelect(false); // Also guard taps before React renders the disabled state.
  });
    expect(cards().map((card) => card.props.isSelected)).toEqual([false, true, false]);
    expect(cards()[0].props.disabled).toBe(true);
    expect(cards()[2].props.disabled).toBeFalsy();
    press(0); // A duplicate cannot deselect the selected device or add a second wallet key.
    expect(cards().map((card) => card.props.isSelected)).toEqual([false, true, false]);

    if (n > 1) {
      press(2);
      expect(cards().map((card) => card.props.isSelected)).toEqual([false, true, true]);
    }
    act(() => view.root.findByType('Buttons').props.primaryCallback());
    expect(mockNavigate.mock.calls[0][1].vaultKeys.map((key) => key.id)).toEqual(
      n === 1 ? ['shared-key'] : ['shared-key', 'different-key']
    );

    press(1);
    expect(cards()[0].props.disabled).toBeFalsy();
    press(0);
    expect(cards()[0].props.isSelected).toBe(true);
    expect(cards()[1].props.isSelected).toBe(false);
    expect(cards()[1].props.disabled).toBe(true);
    act(() => view.unmount());
  }
);
