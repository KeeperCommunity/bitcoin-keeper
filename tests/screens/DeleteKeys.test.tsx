import React from 'react';
import renderer, { act } from 'react-test-renderer';
jest.mock('src/constants/responsive', () => ({ hp: (v) => v, wp: (v) => v, windowWidth: 400 }));

// Render the real screen and exercise its actions. Only native/presentation,
// account storage and dispatch boundaries are replaced.
const mockDispatch = jest.fn();
const mockSigner: any = { masterFingerprint: 'abcd', type: 'COLDCARD', hidden: false };
let mockVaults: any[] = [];
const mockState = { bhr: {} };
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('@realm/react', () => ({ useQuery: () => mockVaults }));
jest.mock('src/storage/realm/utils', () => ({ getJSONFromRealmObject: (v) => v }));
jest.mock('src/hooks/useSigners', () => ({
  __esModule: true,
  default: () => ({ signers: [mockSigner] }),
}));
jest.mock('src/hooks/useArchivedVaults', () => ({
  __esModule: true,
  default: () => ({ archivedVaults: mockVaults.filter((v) => v.archived) }),
}));
jest.mock('src/store/hooks', () => ({ useAppSelector: (select) => select(mockState) }));
jest.mock('src/utils/utilities', () => ({ getKeyUID: (s) => s.masterFingerprint }));
jest.mock('src/hooks/usePlan', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('src/hooks/useToastMessage', () => ({
  __esModule: true,
  default: () => ({ showToast: jest.fn() }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ dispatch: jest.fn() }),
  CommonActions: {},
}));
jest.mock('src/hardware', () => ({
  getSignerDescription: () => '',
  getSignerNameFromType: () => 'Key',
}));
jest.mock('src/screens/Vault/SigningDeviceIcons', () => ({ SDIcons: () => ({ Icon: null }) }));
jest.mock('src/store/sagaActions/vaults', () => ({
  deleteSigningDevice: (signers) => ({ type: 'DELETE', signers }),
  archiveSigningDevice: (signers) => ({ type: 'ARCHIVE', signers }),
}));
jest.mock('src/store/sagaActions/wallets', () => ({ updateSignerDetails: jest.fn() }));
jest.mock('src/store/reducers/bhr', () => ({
  hideDeletingKeyModal: jest.fn(),
  hideKeyDeletedSuccessModal: jest.fn(),
}));
jest.mock('@gluestack-ui/themed-native-base', () => ({
  Box: 'Box',
  Pressable: 'Pressable',
  useColorMode: () => ({ colorMode: 'light' }),
}));
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: {
      signer: new Proxy({}, { get: (_, key) => key }),
      error: {},
    },
  }),
}));

const presentation = {
  'src/components/ScreenWrapper': 'Screen',
  'src/components/Modal/PasscodeVerify': 'Passcode',
  'src/components/KeeperModal': 'Modal',
  'src/components/KeeperText': 'Text',
  'src/components/ActionCard': 'ActionCard',
  'src/components/SigningDevices/KeyCard': 'KeyCard',
  'src/components/HexagonIcon': 'Hexagon',
  'src/components/BounceLoader': 'Loader',
  'src/components/Loader': 'Tor',
  'src/components/WalletHeader': 'Header',
};
Object.entries(presentation).forEach(([path, name]) =>
  jest.doMock(require.resolve(`../../${path}`), () => name)
);
['delete_bin', 'show', 'wallet_vault', 'show_wallet', 'hide_wallet', 'icon_tick'].forEach((name) =>
  jest.doMock(require.resolve(`../../src/assets/images/${name}.svg`), () => () => null)
);
const DeleteKeys = require('../../src/screens/SigningDevices/DeleteKeys').default;

let screen;
const find = (name) => screen.root.findByType(name);
const modal = (title) => screen.root.findAllByType('Modal').find((m) => m.props.title === title);
function mount() {
  act(() => {
    screen = renderer.create(<DeleteKeys route={{ params: {} }} />);
  });
}
function chooseDelete() {
  act(() => find('KeyCard').props.primaryAction());
}
function verifyPasscode() {
  const Content = modal('enterPasscode').props.Content;
  let content;
  act(() => {
    content = renderer.create(<Content />);
  });
  act(() => content.root.findByType('Passcode').props.onSuccess());
  act(() => content.unmount());
}
beforeEach(() => {
  mockVaults = [];
  mockSigner.type = 'COLDCARD';
  mockSigner.hidden = false;
  delete mockSigner.signerName;
  mockDispatch.mockClear();
});
afterEach(() => {
  act(() => screen?.unmount());
});

test('visible keys offer Delete without first hiding; passcode is required', () => {
  mount();
  expect(find('KeyCard').props.primaryText).toBe('delete');
  chooseDelete();
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(modal('enterPasscode').props.visible).toBe(true);
  verifyPasscode();
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'DELETE', signers: [mockSigner] });
});

test.each(['normal', 'hidden', 'canary', 'other-network'])(
  'blocks key referenced by %s wallet',
  (kind) => {
    mockVaults = [{ kind, signers: [mockSigner], archived: false }];
    mount();
    chooseDelete();
    expect(modal('deleteVaultWarning').props.visible).toBe(true);
    expect(modal('enterPasscode').props.visible).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();
  }
);

test('rechecks a wallet reference added while passcode was open', () => {
  mount();
  chooseDelete();
  mockVaults = [{ signers: [mockSigner], archived: false }];
  act(() => screen.update(<DeleteKeys route={{ params: {} }} />));
  verifyPasscode();
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(modal('deleteVaultWarning').props.visible).toBe(true);
});

test('retains a key used by an archived wallet instead of deleting it', () => {
  mockVaults = [{ signers: [mockSigner], archived: true }];
  mount();
  chooseDelete();
  verifyPasscode();
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'ARCHIVE', signers: [mockSigner] });
});

test('cancel clears deletion intent', () => {
  mount();
  chooseDelete();
  act(() => modal('enterPasscode').props.close());
  expect(modal('enterPasscode').props.visible).toBe(false);
  verifyPasscode();
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('Policy Server has no delete action', () => {
  mockSigner.type = 'POLICY_SERVER';
  mount();
  expect(find('KeyCard').props.primaryAction).toBeNull();
  expect(find('KeyCard').props.primaryText).toBeNull();
});

test('Recovery Key is excluded from key deletion', () => {
  mockSigner.signerName = 'RECOVERY_KEY_SIGNER_NAME';
  mount();
  expect(screen.root.findAllByType('KeyCard')).toHaveLength(0);
});

test('hidden keys remain concealed before authentication', () => {
  mockSigner.hidden = true;
  mount();
  expect(screen.root.findAllByType('KeyCard')).toHaveLength(0);
});

test('repeated confirmation does not dispatch a second deletion', () => {
  mount();
  chooseDelete();
  verifyPasscode();
  verifyPasscode();
  expect(mockDispatch).toHaveBeenCalledTimes(1);
});
