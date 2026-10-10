import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { SignMessageScreen } from 'src/screens/WalletDetails/SignMessageScreen';
import SignWithOneKeyBle from 'src/screens/SignTransaction/SignWithOneKeyBle';
import SignMessageOneKeyBle from 'src/screens/OneKey/SignMessageOneKeyBle';
import OneKeyBleModal from 'src/components/OneKeyBleModal';
import * as oneKey from 'src/services/onekeyBle';

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();
const mockShowToast = jest.fn();
const mockSigner = {
  type: 'ONEKEY',
  masterFingerprint: '1234ABCD',
  extraData: { bleConnectId: 'test-device' },
};
const mockRemoveListener = jest.fn();
let mockFocused = true;
let mockParams;
let mockVault;
let mockUIHandler: (event: string) => void;

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('src/store/hooks', () => ({
  useAppSelector: (selector) =>
    selector({
      settings: { bitcoinNetworkType: 'MAINNET' },
      sendAndReceive: {
        sendPhaseTwo: {
          serializedPSBTEnvelops: [{ xfp: '1234ABCD', serializedPSBT: 'fixture-psbt' }],
        },
      },
    }),
}));
jest.mock('src/hooks/useToastMessage', () => () => ({ showToast: mockShowToast }));
jest.mock('src/hooks/useSmallDevices', () => () => false);
jest.mock('src/hooks/useWallets', () => () => ({ wallets: [] }));
jest.mock('src/hooks/useVault', () => () => ({ activeVault: mockVault }));
jest.mock('src/hooks/useSigners', () => () => ({ vaultSigners: [mockSigner] }));
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: { common: { sign: 'Sign' }, wallet: {}, error: {} },
  }),
}));
jest.mock('@gluestack-ui/themed-native-base', () => ({
  Box: 'Box',
  Input: 'Input',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  ScrollView: 'ScrollView',
  useColorMode: () => ({ colorMode: 'light' }),
}));
jest.mock('@react-navigation/native', () => ({
  CommonActions: { navigate: (...args) => args, goBack: () => 'goBack' },
  useIsFocused: () => mockFocused,
  useNavigation: () => ({ dispatch: mockNavigate }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('@onekeyfe/hd-core', () => ({
  UI_REQUEST: { REQUEST_PIN: 'pin', REQUEST_BUTTON: 'button' },
}));
jest.mock('src/services/onekeyBle', () => ({
  assertOneKeyFingerprint: jest.fn(),
  ensureOneKeyBLEReady: jest.fn(),
  searchOneKeyDevices: jest.fn(),
  getOneKeyDeviceInfo: jest.fn(),
  fetchOneKeySignerData: jest.fn(),
  signPsbtWithOneKey: jest.fn(),
  signMessageWithOneKey: jest.fn(),
  verifyAddressOnOneKey: jest.fn(),
  ONEKEY_UI_EVENT: 'ui',
  onekeyUIEmitter: {
    addListener: (_event, handler) => {
      mockUIHandler = handler;
      return { remove: mockRemoveListener };
    },
  },
}));
jest.mock('src/hooks/useSignerFromKey', () => () => ({ signer: mockSigner }));
jest.mock('src/services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('src/utils/utilities', () => ({ validatePSBT: jest.fn() }));
jest.mock('src/store/reducers/send_and_receive', () => ({ updatePSBTEnvelops: jest.fn() }));
jest.mock('src/store/sagaActions/bhr', () => ({ healthCheckStatusUpdate: jest.fn() }));
jest.mock('src/store/sagaActions/vaults', () => ({ addSigningDevice: jest.fn() }));
jest.mock('src/services/onekeyBle/deviceConstants', () => ({
  getDeviceImage: () => null,
  getDeviceDisplayName: (device) => device.name,
  getDeviceTypeName: () => 'OneKey',
}));
jest.mock('src/hardware/signerSetup', () => ({
  setupUSBSigner: () => ({ signer: { ...mockSigner } }),
}));
jest.mock('src/components/Buttons', () => 'Buttons');
jest.mock('src/components/KeeperTextInput', () => 'KeeperTextInput');
jest.mock('src/components/ScreenWrapper', () => 'ScreenWrapper');
jest.mock('src/components/WalletHeader', () => () => null);
jest.mock('src/components/KeeperText', () => 'KeeperText');
jest.mock('src/components/CircleIconWrapper', () => () => null);
jest.mock('src/components/XPub/ShowXPub', () => () => null);
jest.mock('src/components/ThemedSvg.tsx/ThemedSvg', () => () => null);
jest.mock('src/components/KeeperModal', () => {
  const React = require('react');
  return ({ visible, Content, ...props }) =>
    visible ? React.createElement('KeeperModal', props, <Content />) : null;
});
jest.mock('src/screens/Vault/HardwareModalMap', () => ({ InteracationMode: {} }));
jest.mock('src/services/wallets/operations', () => ({}));
jest.mock('src/services/wallets/operations/utils', () => ({ isValidAddress: () => true }));
jest.mock('src/store/sagaActions/wallets', () => ({
  refreshWallets: jest.fn(),
  updateKeyDetails: jest.fn(),
}));
jest.mock('src/services/fs', () => ({ exportFile: jest.fn(), importFile: jest.fn() }));
jest.mock('src/assets/images/toast_error.svg', () => () => null);
jest.mock('src/assets/images/usb_white.svg', () => () => null);
jest.mock('src/assets/images/qr_comms.svg', () => () => null);
jest.mock('src/assets/images/import.svg', () => () => null);
jest.mock('src/assets/images/icon_tick.svg', () => () => null);

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockParams = {
    vaultKey: { xfp: '1234ABCD' },
    signer: mockSigner,
    message: 'fixture message',
    address: 'fixture-address',
    derivationPath: "m/84'/0'/0'/0/0",
    onSignatureReceived: jest.fn(),
  };
  (oneKey.ensureOneKeyBLEReady as jest.Mock).mockResolvedValue({ ready: true });
  (oneKey.searchOneKeyDevices as jest.Mock).mockResolvedValue([]);
  (oneKey.getOneKeyDeviceInfo as jest.Mock).mockResolvedValue({
    deviceId: 'test-id',
    connectId: 'test-device',
    masterFingerprint: '1234ABCD',
  });
  (oneKey.signPsbtWithOneKey as jest.Mock).mockResolvedValue('signed-psbt');
  (oneKey.signMessageWithOneKey as jest.Mock).mockResolvedValue({
    address: 'fixture-address',
    signature: 'fixture-signature',
  });
  mockVault = {
    isMultiSig: false,
    signers: [{ masterFingerprint: '1234ABCD', derivationPath: "m/84'/0'/0'" }],
    specs: { addresses: { external: { 0: 'fixture-address' } } },
  };
});

test.each([false, true])(
  'OneKey message signing is offered only for a single-signature vault (multisig=%s)',
  async (isMultiSig) => {
    mockVault.isMultiSig = isMultiSig;
    let view: ReactTestRenderer;
    await act(async () => {
      view = create(
        <SignMessageScreen
          route={{ params: { vaultId: 'fixture', type: 'VAULT' } }}
          navigation={{ dispatch: mockNavigate }}
        />
      );
    });
    await act(async () => {
      view.root.findAllByType('Input' as any)[0].props.onChangeText('fixture message');
    });
    await act(async () => {
      view.root
        .findAllByType('Buttons' as any)
        .find((node) => node.props.primaryText === 'Sign')
        .props.primaryCallback();
    });
    const options = view.root.findAllByProps({ testID: 'btn_OneKey (BLE)' });
    if (isMultiSig) {
      expect(options).toHaveLength(0);
      expect(mockNavigate).not.toHaveBeenCalled();
    } else {
      expect(options.length).toBeGreaterThan(0);
      await act(async () => options[0].props.onPress());
      expect(mockNavigate).toHaveBeenCalledWith([
        'SignMessageOneKeyBle',
        expect.objectContaining({ address: 'fixture-address', derivationPath: "m/84'/0'/0'/0/0" }),
      ]);
    }
    await act(async () => view.unmount());
  }
);

describe('OneKey flow cancellation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test.each([SignWithOneKeyBle, SignMessageOneKeyBle])(
    '%p clears the PIN hint when the SDK completes its interaction', async (Screen) => {
      let finishScan;
      (oneKey.searchOneKeyDevices as jest.Mock).mockReturnValueOnce(
        new Promise((resolve) => { finishScan = resolve; })
      );
      let view: ReactTestRenderer;
      await act(async () => { view = create(<Screen />); });
      await act(async () => jest.advanceTimersByTimeAsync(300));
      await act(async () => mockUIHandler('pin'));
      expect(JSON.stringify(view.toJSON())).toContain('Please enter PIN on your OneKey device');
      await act(async () => mockUIHandler('idle'));
      expect(JSON.stringify(view.toJSON())).not.toContain('Please enter PIN on your OneKey device');
      await act(async () => view.unmount());
      await act(async () => finishScan([]));
      expect(oneKey.getOneKeyDeviceInfo).not.toHaveBeenCalled();
    }
  );

  test.each([SignWithOneKeyBle, SignMessageOneKeyBle])(
    'leaving %p before startup prevents scanning',
    async (Screen) => {
      let view: ReactTestRenderer;
      await act(async () => {
        view = create(<Screen />);
      });
      await act(async () => view.unmount());
      await act(async () => jest.advanceTimersByTimeAsync(300));
      expect(oneKey.ensureOneKeyBLEReady).not.toHaveBeenCalled();
      expect(oneKey.searchOneKeyDevices).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  test.each([
    [SignWithOneKeyBle, 'scan', 'unmount'],
    [SignWithOneKeyBle, 'sign', 'blur'],
    [SignMessageOneKeyBle, 'scan', 'blur'],
    [SignMessageOneKeyBle, 'sign', 'unmount'],
  ])('leaving %p during %s by %s ignores a late result', async (Screen, stage, leave) => {
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const signing =
      Screen === SignWithOneKeyBle ? oneKey.signPsbtWithOneKey : oneKey.signMessageWithOneKey;
    ((stage === 'scan' ? oneKey.searchOneKeyDevices : signing) as jest.Mock).mockReturnValueOnce(
      pending
    );
    let view: ReactTestRenderer;
    await act(async () => {
      view = create(<Screen />);
    });
    await act(async () => jest.advanceTimersByTimeAsync(300));
    const signal = (oneKey.searchOneKeyDevices as jest.Mock).mock.calls[0][0] as AbortSignal;
    await act(async () => {
      if (leave === 'blur') {
        mockFocused = false;
        view.update(<Screen />);
      } else view.unmount();
    });
    expect(signal.aborted).toBe(true);
    expect(mockRemoveListener).toHaveBeenCalled();
    await act(async () =>
      finish(
        stage === 'scan'
          ? []
          : Screen === SignWithOneKeyBle
          ? 'signed-psbt'
          : { address: 'fixture-address', signature: 'fixture-signature' }
      )
    );
    if (stage === 'scan') {
      expect(oneKey.getOneKeyDeviceInfo).not.toHaveBeenCalled();
      expect(signing).not.toHaveBeenCalled();
    }
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockParams.onSignatureReceived).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    if (leave === 'blur') await act(async () => view.unmount());
  });

  test('closing a modal before startup removes its launch timer', async () => {
    let view: ReactTestRenderer;
    await act(async () => {
      view = create(<OneKeyBleModal visible close={jest.fn()} mode="setup" />);
    });
    await act(async () =>
      view.update(<OneKeyBleModal visible={false} close={jest.fn()} mode="setup" />)
    );
    await act(async () => jest.advanceTimersByTimeAsync(300));
    expect(oneKey.ensureOneKeyBLEReady).not.toHaveBeenCalled();
    expect(oneKey.searchOneKeyDevices).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  });

  test('reopening a modal ignores the previous scan result', async () => {
    let finishOldScan;
    (oneKey.searchOneKeyDevices as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        finishOldScan = resolve;
      })
    );
    const props = { close: jest.fn(), mode: 'setup' as const };
    let view: ReactTestRenderer;
    await act(async () => {
      view = create(<OneKeyBleModal {...props} visible />);
    });
    await act(async () => jest.advanceTimersByTimeAsync(300));
    const signal = (oneKey.searchOneKeyDevices as jest.Mock).mock.calls[0][0] as AbortSignal;
    await act(async () => view.update(<OneKeyBleModal {...props} visible={false} />));
    await act(async () => view.update(<OneKeyBleModal {...props} visible />));
    await act(async () => jest.advanceTimersByTimeAsync(300));
    expect(signal.aborted).toBe(true);
    await act(async () => finishOldScan([{ connectId: 'old-device', name: 'Old device' }]));
    const text = JSON.stringify(view.toJSON());
    expect(text).not.toContain('Old device');
    expect(text).toContain('No devices found');
    expect(mockDispatch).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  });

  test('closing address verification ignores its late response', async () => {
    let finishVerification;
    (oneKey.verifyAddressOnOneKey as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        finishVerification = resolve;
      })
    );
    const close = jest.fn();
    let view: ReactTestRenderer;
    await act(async () => {
      view = create(
        <OneKeyBleModal
          visible
          close={close}
          mode="verify-address"
          signer={mockSigner as any}
          vaultKey={{ derivationPath: "m/84'/0'/0'" } as any}
          receivingAddress="fixture-address"
          receiveAddressIndex={0}
        />
      );
    });
    await act(async () => jest.advanceTimersByTimeAsync(300));
    await act(async () => view.root.findByType('KeeperModal' as any).props.close());
    const signal = (oneKey.verifyAddressOnOneKey as jest.Mock).mock.calls[0][0]
      .signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => finishVerification('fixture-address'));
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => view.unmount());
  });
});
