import React from 'react';
import renderer, { act } from 'react-test-renderer';
jest.mock('src/constants/responsive', () => ({ hp: (v) => v, wp: (v) => v, windowWidth: 400 }));

// Render the real screen with the production signer-identity helper. Native,
// presentation, account storage and dispatch boundaries are replaced.
const mockDispatch = jest.fn();
const mockSigner: any = {
  masterFingerprint: 'abcd',
  type: 'COLDCARD',
  hidden: false,
  networkType: 'TESTNET',
  signerXpubs: { P2WSH: [{ derivationPath: "m/48'/1'/0'/2'", xpub: 'public-test-key' }] },
};
let mockSigners: any[] = [mockSigner];
let mockVaults: any[] = [];
// Realm Results stay live even inside a previously rendered callback.
const mockVaultQuery = { map: (callback) => mockVaults.map(callback) };
const mockFocus: { effect?: () => () => void; cleanup?: () => void } = {};
const mockState = { bhr: {}, storage: { appId: 'disposable-account-A' } };
let mockRealmAppId = 'disposable-account-A';
let mockRealmUnavailable = false;
jest.mock('src/store/store', () => ({ store: { getState: () => mockState } }));
jest.mock('src/services/rest/RestClient', () => ({ __esModule: true, default: {} }));
const {
  currentBackupAccountSession,
  observeBackupAccount,
} = require('../../src/services/backup/transport');
jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('@realm/react', () => ({ useQuery: () => mockVaultQuery }));
jest.mock('src/storage/realm/utils', () => ({ getJSONFromRealmObject: (v) => v }));
jest.mock('src/hooks/useSigners', () => ({
  __esModule: true,
  default: () => ({ signers: mockSigners }),
}));
jest.mock('src/store/hooks', () => ({ useAppSelector: (select) => select(mockState) }));
jest.mock('src/utils/utilities', () => ({
  getKeyUID: jest.requireActual('src/utils/utilities').getKeyUID,
}));
// These imports belong to unrelated utilities; identity uses their real enum
// constants and derivation/account logic without invoking storage or crypto.
jest.mock('src/utils/service-utilities/config', () => ({
  __esModule: true,
  default: {},
  APP_STAGE: {},
}));
jest.mock('src/constants/Bitcoin', () => ({ isTestnet: jest.fn() }));
jest.mock('src/services/qr/bbqr/split', () => ({}));
jest.mock('src/storage/realm/dbManager', () => ({
  __esModule: true,
  default: {
    getObjectByIndex: () => {
      if (mockRealmUnavailable) throw new Error('synthetic closed Realm');
      return mockRealmAppId ? { id: mockRealmAppId } : undefined;
    },
  },
}));
jest.mock('src/utils/service-utilities/encryption', () => ({}));
jest.mock('src/constants/defaultData', () => ({
  RECOVERY_KEY_SIGNER_NAME: 'RECOVERY_KEY_SIGNER_NAME',
}));
jest.mock('src/hooks/usePlan', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('src/hooks/useToastMessage', () => ({
  __esModule: true,
  default: () => ({ showToast: jest.fn() }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ dispatch: jest.fn() }),
  useFocusEffect: (effect) => {
    require('react').useEffect(() => {
      mockFocus.effect = effect;
      mockFocus.cleanup = effect();
      return () => mockFocus.cleanup?.();
    }, [effect]);
  },
  CommonActions: {},
}));
jest.mock('src/hardware', () => ({
  getSignerDescription: () => '',
  getSignerNameFromType: () => 'Key',
}));
jest.mock('src/screens/Vault/SigningDeviceIcons', () => ({ SDIcons: () => ({ Icon: null }) }));
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
function chooseDelete(index = 0) {
  act(() => screen.root.findAllByType('KeyCard')[index].props.primaryAction());
}
function passcodeCallbacks(index = 0) {
  const Content = screen.root
    .findAllByType('Modal')
    .filter((m) => m.props.title === 'enterPasscode')[index].props.Content;
  let content;
  act(() => {
    content = renderer.create(<Content />);
  });
  const callbacks = content.root.findByType('Passcode').props;
  act(() => content.unmount());
  return callbacks;
}
function verifyPasscode() {
  const { onSuccess } = passcodeCallbacks();
  act(() => onSuccess());
}
function expectedAction(type, signer) {
  return {
    type,
    payload: { signers: [signer] },
    originAppId: mockState.storage.appId,
    originBackupAccountSession: currentBackupAccountSession(),
  };
}
function switchAccount(appId) {
  mockState.storage.appId = appId;
  mockRealmAppId = appId;
  observeBackupAccount(appId);
}
function warningContent() {
  const warning = screen.root
    .findAllByType('Modal')
    .find((m) => m.props.visible && m.props.title.startsWith('delete'));
  const Content = warning.props.Content;
  let content;
  act(() => {
    content = renderer.create(<Content />);
  });
  const output = content.toJSON();
  act(() => content.unmount());
  return JSON.stringify(output);
}
beforeEach(() => {
  mockState.storage.appId = 'disposable-account-A';
  mockRealmAppId = mockState.storage.appId;
  mockRealmUnavailable = false;
  observeBackupAccount(undefined);
  observeBackupAccount(mockState.storage.appId);
  mockFocus.effect = undefined;
  mockFocus.cleanup = undefined;
  mockSigners = [mockSigner];
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
  expect(mockDispatch).toHaveBeenCalledWith(expectedAction('DELETE_SIGINING_DEVICE', mockSigner));
});

test.each(['normal', 'hidden', 'canary', 'other-network'])(
  'blocks key referenced by %s wallet',
  (kind) => {
    mockVaults = [{ id: 'reference', kind, signers: [mockSigner], archived: false }];
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
  mockVaults = [{ id: 'new-active-reference', signers: [mockSigner], archived: false }];
  act(() => screen.update(<DeleteKeys route={{ params: {} }} />));
  verifyPasscode();
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(modal('deleteVaultWarning').props.visible).toBe(true);
});

test('retains a key used by an archived wallet instead of deleting it', () => {
  mockVaults = [{ id: 'archived-reference', signers: [mockSigner], archived: true }];
  mount();
  chooseDelete();
  verifyPasscode();
  expect(mockDispatch).toHaveBeenCalledWith(expectedAction('ARCHIVE_SIGINING_DEVICE', mockSigner));
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

test('cancelling hidden-key authentication leaves the key concealed', () => {
  mockSigner.hidden = true;
  mount();
  act(() => find('Pressable').props.onPress());
  const callbacks = passcodeCallbacks(1);
  act(() => callbacks.close());
  expect(screen.root.findAllByType('KeyCard')).toHaveLength(0);
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('an authenticated hidden key still needs its own deletion confirmation', () => {
  mockSigner.hidden = true;
  mount();
  act(() => find('Pressable').props.onPress());
  const callbacks = passcodeCallbacks(1);
  act(() => {
    callbacks.onSuccess();
    callbacks.close();
  });
  expect(find('KeyCard').props.primaryText).toBe('delete');
  expect(mockDispatch).not.toHaveBeenCalled();
  chooseDelete();
  expect(modal('enterPasscode').props.visible).toBe(true);
  expect(mockDispatch).not.toHaveBeenCalled();
  verifyPasscode();
  expect(mockDispatch).toHaveBeenCalledWith(expectedAction('DELETE_SIGINING_DEVICE', mockSigner));
});

test('repeated confirmation does not dispatch a second deletion', () => {
  mount();
  chooseDelete();
  verifyPasscode();
  verifyPasscode();
  expect(mockDispatch).toHaveBeenCalledTimes(1);
});

test('the same passcode success callback can consume a deletion only once', () => {
  mount();
  chooseDelete();
  const { onSuccess } = passcodeCallbacks();
  act(() => {
    onSuccess();
    onSuccess();
  });
  expect(mockDispatch).toHaveBeenCalledTimes(1);
});

test.each(['modal', 'passcode'])(
  'cancel through %s invalidates a captured success callback',
  (via) => {
    mount();
    chooseDelete();
    const callbacks = passcodeCallbacks();
    act(() => {
      if (via === 'modal') modal('enterPasscode').props.close();
      else callbacks.close();
    });
    act(() => callbacks.onSuccess());
    expect(mockDispatch).not.toHaveBeenCalled();
  }
);

test('success from a previous key cannot authorize or cancel the next key selection', () => {
  const secondSigner = { ...mockSigner, masterFingerprint: 'ef01' };
  mockSigners = [mockSigner, secondSigner];
  mount();
  chooseDelete();
  const first = passcodeCallbacks();
  act(() => first.close());
  chooseDelete(1);
  const second = passcodeCallbacks();
  act(() => {
    first.onSuccess();
    first.close();
  });
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(modal('enterPasscode').props.visible).toBe(true);
  act(() => second.onSuccess());
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch).toHaveBeenCalledWith(expectedAction('DELETE_SIGINING_DEVICE', secondSigner));
});

test('success from a cancelled request cannot authorize a new request for the same key', () => {
  mount();
  chooseDelete();
  const first = passcodeCallbacks();
  act(() => first.close());
  chooseDelete();
  const second = passcodeCallbacks();
  act(() => first.onSuccess());
  expect(mockDispatch).not.toHaveBeenCalled();
  act(() => second.onSuccess());
  expect(mockDispatch).toHaveBeenCalledTimes(1);
});

test('leaving the screen invalidates an outstanding deletion callback', () => {
  mount();
  chooseDelete();
  const { onSuccess } = passcodeCallbacks();
  act(() => {
    screen.unmount();
    screen = undefined;
  });
  act(() => onSuccess());
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('blur and return require a new deletion intent and ignore the old callback', () => {
  mount();
  chooseDelete();
  const first = passcodeCallbacks();
  act(() => {
    mockFocus.cleanup?.();
    mockFocus.cleanup = undefined;
  });
  expect(modal('enterPasscode').props.visible).toBe(false);
  act(() => {
    mockFocus.cleanup = mockFocus.effect?.();
  });
  chooseDelete();
  const second = passcodeCallbacks();
  act(() => first.onSuccess());
  expect(mockDispatch).not.toHaveBeenCalled();
  act(() => second.onSuccess());
  expect(mockDispatch).toHaveBeenCalledTimes(1);
});

test('a captured success callback rechecks references added after it was rendered', () => {
  mount();
  chooseDelete();
  const { onSuccess } = passcodeCallbacks();
  mockVaults = [{ id: 'new-active-reference', signers: [mockSigner], archived: false }];
  act(() => screen.update(<DeleteKeys route={{ params: {} }} />));
  act(() => onSuccess());
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(modal('deleteVaultWarning').props.visible).toBe(true);
});

test('reads live references at confirmation even before a query notification rerenders the screen', () => {
  mount();
  chooseDelete();
  const { onSuccess } = passcodeCallbacks();
  mockVaults = [{ id: 'new-active-reference', signers: [mockSigner], archived: false }];
  act(() => onSuccess());
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(modal('deleteVaultWarning').props.visible).toBe(true);
});

test('a captured success callback retains a reference archived while authentication was open', () => {
  mount();
  chooseDelete();
  const { onSuccess } = passcodeCallbacks();
  mockVaults = [{ id: 'new-archived-reference', signers: [mockSigner], archived: true }];
  act(() => screen.update(<DeleteKeys route={{ params: {} }} />));
  act(() => onSuccess());
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch).toHaveBeenCalledWith(expectedAction('ARCHIVE_SIGINING_DEVICE', mockSigner));
});

test.each([
  ['hidden', 'DEFAULT', 'HIDDEN'],
  ['canary', 'CANARY', 'DEFAULT'],
  ['unknown visibility', 'DEFAULT', undefined],
])(
  'blocks a %s reference without revealing its wallet name or description',
  (_, type, visibility) => {
    mockVaults = [
      {
        id: 'concealed-reference',
        signers: [mockSigner],
        archived: false,
        type,
        presentationData: {
          name: 'PRIVATE_WALLET_NAME',
          description: 'PRIVATE_WALLET_DESCRIPTION',
          visibility,
        },
      },
    ];
    mount();
    chooseDelete();
    expect(modal('deleteVaultWarning').props.visible).toBe(true);
    expect(modal('enterPasscode').props.visible).toBe(false);
    expect(warningContent()).not.toContain('PRIVATE_WALLET');
    expect(mockDispatch).not.toHaveBeenCalled();
  }
);

test('a mix of visible and concealed references uses a generic warning without wallet details', () => {
  mockVaults = ['DEFAULT', 'HIDDEN'].map((visibility, index) => ({
    id: `reference-${index}`,
    signers: [mockSigner],
    archived: false,
    type: 'DEFAULT',
    presentationData: {
      name: 'PRIVATE_WALLET_NAME',
      description: 'PRIVATE_WALLET_DESCRIPTION',
      visibility,
    },
  }));
  mount();
  chooseDelete();
  expect(modal('deleteVaultWarning').props.visible).toBe(true);
  expect(modal('deleteVaultWarning').props.subTitle).toBe('deleteVaultInstruction');
  expect(warningContent()).not.toContain('PRIVATE_WALLET');
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('ordinary visible references still show the wallet that blocks deletion', () => {
  mockVaults = [
    {
      id: 'visible-vault',
      signers: [mockSigner],
      archived: false,
      type: 'DEFAULT',
      presentationData: {
        name: 'Visible wallet',
        description: 'Visible description',
        visibility: 'DEFAULT',
      },
    },
  ];
  mount();
  chooseDelete();
  expect(warningContent()).toContain('Visible wallet');
  expect(warningContent()).toContain('Visible description');
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('production identity matches a vault key with the selected signer account and network', () => {
  mockVaults = [
    {
      id: 'identity-reference',
      archived: false,
      signers: [
        { masterFingerprint: mockSigner.masterFingerprint, derivationPath: "m/48'/1'/0'/2'" },
      ],
    },
  ];
  mount();
  chooseDelete();
  expect(modal('deleteVaultWarning').props.visible).toBe(true);
  expect(mockDispatch).not.toHaveBeenCalled();
});

test.each([
  ['account', "m/48'/1'/1'/2'"],
  ['network', "m/48'/0'/0'/2'"],
])(
  'a shared fingerprint with another %s is not the selected signer identity',
  (_, derivationPath) => {
    mockVaults = [
      {
        id: 'other-identity-reference',
        archived: false,
        signers: [{ masterFingerprint: mockSigner.masterFingerprint, derivationPath }],
      },
    ];
    mount();
    chooseDelete();
    expect(modal('enterPasscode').props.visible).toBe(true);
    verifyPasscode();
    expect(mockDispatch).toHaveBeenCalledWith(expectedAction('DELETE_SIGINING_DEVICE', mockSigner));
  }
);

test.each([
  ['hidden', 'DEFAULT', 'HIDDEN'],
  ['canary', 'CANARY', 'DEFAULT'],
])(
  'a wallet becoming %s while the warning is open immediately conceals its details',
  (_, type, visibility) => {
    mockVaults = [
      {
        id: 'live-reference',
        signers: [mockSigner],
        archived: false,
        type: 'DEFAULT',
        presentationData: {
          name: 'BECAME_PRIVATE_NAME',
          description: 'BECAME_PRIVATE_DESCRIPTION',
          visibility: 'DEFAULT',
        },
      },
    ];
    mount();
    chooseDelete();
    expect(warningContent()).toContain('BECAME_PRIVATE_NAME');
    mockVaults = [
      {
        ...mockVaults[0],
        type,
        presentationData: { ...mockVaults[0].presentationData, visibility },
      },
    ];
    act(() => screen.update(<DeleteKeys route={{ params: {} }} />));
    expect(modal('deleteVaultWarning').props.visible).toBe(true);
    expect(modal('deleteVaultWarning').props.subTitle).toBe('deleteVaultInstruction');
    expect(warningContent()).not.toContain('BECAME_PRIVATE');
    expect(mockDispatch).not.toHaveBeenCalled();
  }
);

test('warning cards use current wallet metadata rather than an old snapshot', () => {
  mockVaults = [
    {
      id: 'renamed-reference',
      signers: [mockSigner],
      archived: false,
      type: 'DEFAULT',
      presentationData: {
        name: 'Old wallet name',
        description: 'Old description',
        visibility: 'DEFAULT',
      },
    },
  ];
  mount();
  chooseDelete();
  mockVaults = [
    {
      ...mockVaults[0],
      presentationData: {
        ...mockVaults[0].presentationData,
        name: 'Current wallet name',
        description: 'Current description',
      },
    },
  ];
  act(() => screen.update(<DeleteKeys route={{ params: {} }} />));
  const output = warningContent();
  expect(output).toContain('Current wallet name');
  expect(output).toContain('Current description');
  expect(output).not.toContain('Old wallet name');
  expect(output).not.toContain('Old description');
});

test.each([undefined, ''])(
  'a missing or empty reference ID (%s) suppresses wallet details',
  (id) => {
    mockVaults = [
      {
        id,
        signers: [mockSigner],
        archived: false,
        type: 'DEFAULT',
        presentationData: {
          name: 'UNRESOLVED_PRIVATE_NAME',
          description: 'UNRESOLVED_PRIVATE_DESCRIPTION',
          visibility: 'DEFAULT',
        },
      },
    ];
    mount();
    chooseDelete();
    expect(modal('deleteVaultWarning').props.visible).toBe(true);
    expect(warningContent()).not.toContain('UNRESOLVED_PRIVATE');
    expect(mockDispatch).not.toHaveBeenCalled();
  }
);

test('a missing live reference keeps a generic block until a new Delete selection', () => {
  mockVaults = [
    {
      id: 'removed-reference',
      signers: [mockSigner],
      archived: false,
      type: 'DEFAULT',
      presentationData: {
        name: 'REMOVED_PRIVATE_NAME',
        description: 'REMOVED_PRIVATE_DESCRIPTION',
        visibility: 'DEFAULT',
      },
    },
  ];
  mount();
  chooseDelete();
  mockVaults = [];
  act(() => screen.update(<DeleteKeys route={{ params: {} }} />));
  expect(modal('deleteVaultWarning').props.visible).toBe(true);
  expect(warningContent()).not.toContain('REMOVED_PRIVATE');
  expect(mockDispatch).not.toHaveBeenCalled();
  act(() => modal('deleteVaultWarning').props.close());
  chooseDelete();
  expect(modal('enterPasscode').props.visible).toBe(true);
  expect(mockDispatch).not.toHaveBeenCalled();
});

test('blur and return do not restore a previous wallet-reference warning', () => {
  mockVaults = [{ id: 'blur-reference', signers: [mockSigner], archived: false }];
  mount();
  chooseDelete();
  expect(modal('deleteVaultWarning').props.visible).toBe(true);
  act(() => {
    mockFocus.cleanup?.();
    mockFocus.cleanup = undefined;
  });
  expect(modal('deleteVaultWarning').props.visible).toBe(false);
  act(() => {
    mockFocus.cleanup = mockFocus.effect?.();
  });
  expect(modal('deleteVaultWarning').props.visible).toBe(false);
  expect(mockDispatch).not.toHaveBeenCalled();
});

test.each([
  ['hidden', 'DEFAULT', 'HIDDEN'],
  ['canary', 'CANARY', 'DEFAULT'],
])(
  'a new %s reference switches an open warning to generic without exposing counts',
  (_, type, visibility) => {
    mockVaults = [
      {
        id: 'initial-visible-reference',
        signers: [mockSigner],
        archived: false,
        type: 'DEFAULT',
        presentationData: { name: 'Visible wallet', visibility: 'DEFAULT' },
      },
    ];
    mount();
    chooseDelete();
    mockVaults = [
      ...mockVaults,
      {
        id: 'new-concealed-reference',
        signers: [mockSigner],
        archived: false,
        type,
        presentationData: {
          name: 'NEW_PRIVATE_NAME',
          description: 'NEW_PRIVATE_DESCRIPTION',
          visibility,
        },
      },
    ];
    act(() => screen.update(<DeleteKeys route={{ params: {} }} />));
    expect(modal('deleteVaultWarning').props.visible).toBe(true);
    expect(modal('deleteVaultWarning').props.subTitle).toBe('deleteVaultInstruction');
    expect(warningContent()).toBe('null');
    expect(mockDispatch).not.toHaveBeenCalled();
  }
);

test('a reference ID reassigned to an unrelated key does not reveal the unrelated wallet', () => {
  mockVaults = [
    {
      id: 'same-id',
      signers: [mockSigner],
      archived: false,
      type: 'DEFAULT',
      presentationData: { name: 'PREVIOUS_NAME', visibility: 'DEFAULT' },
    },
  ];
  mount();
  chooseDelete();
  mockVaults = [
    {
      ...mockVaults[0],
      signers: [{ ...mockSigner, masterFingerprint: 'ef01' }],
      presentationData: { name: 'UNRELATED_NAME', visibility: 'DEFAULT' },
    },
  ];
  act(() => screen.update(<DeleteKeys route={{ params: {} }} />));
  expect(modal('deleteVaultWarning').props.visible).toBe(true);
  expect(warningContent()).toBe('null');
  expect(mockDispatch).not.toHaveBeenCalled();
});

test.each(['delete', 'archive'])(
  'account switch before confirmation cannot dispatch %s',
  (kind) => {
    if (kind === 'archive') mockVaults = [{ signers: [mockSigner], archived: true }];
    mount();
    chooseDelete();
    const old = passcodeCallbacks();
    switchAccount('disposable-account-B');
    act(() => old.onSuccess());
    expect(mockDispatch).not.toHaveBeenCalled();
  }
);

test.each(['delete', 'archive'])(
  'account round trip before confirmation cannot dispatch %s',
  (kind) => {
    if (kind === 'archive') mockVaults = [{ signers: [mockSigner], archived: true }];
    mount();
    chooseDelete();
    const old = passcodeCallbacks();
    switchAccount('disposable-account-B');
    switchAccount('disposable-account-A');
    act(() => old.onSuccess());
    expect(mockDispatch).not.toHaveBeenCalled();
  }
);

test.each(['different', 'missing', 'unavailable'])(
  'confirmation fails closed with %s Realm owner',
  (kind) => {
    mount();
    chooseDelete();
    const old = passcodeCallbacks();
    mockRealmAppId = kind === 'different' ? 'disposable-account-B' : '';
    mockRealmUnavailable = kind === 'unavailable';
    act(() => old.onSuccess());
    expect(mockDispatch).not.toHaveBeenCalled();
  }
);

test.each(['different', 'missing', 'unavailable'])(
  'selection fails closed with %s Realm owner',
  (kind) => {
    mount();
    mockRealmAppId = kind === 'different' ? 'disposable-account-B' : '';
    mockRealmUnavailable = kind === 'unavailable';
    chooseDelete();
    expect(modal('enterPasscode').props.visible).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();
  }
);

test('retained selection callback cannot authorize after an account round trip', () => {
  mount();
  const oldSelect = find('KeyCard').props.primaryAction;
  switchAccount('disposable-account-B');
  switchAccount('disposable-account-A');
  act(() => oldSelect());
  expect(modal('enterPasscode').props.visible).toBe(false);
  expect(mockDispatch).not.toHaveBeenCalled();
});
