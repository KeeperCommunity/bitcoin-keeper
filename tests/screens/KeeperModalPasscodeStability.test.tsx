import React from 'react';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Dimensions } from 'react-native';
import KeeperModal from 'src/components/KeeperModal';
import PasscodeVerifyModal from 'src/components/Modal/PasscodeVerify';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import PinInputsView from 'src/components/AppPinInput/PinInputsView';
import Buttons from 'src/components/Buttons';

const mockDispatch = jest.fn();
const mockState = {
  login: { isAuthenticated: false, authenticationFailed: false },
  settings: { loginMethod: 'PIN' },
  storage: { appId: 'disposable-test', failedAttempts: 0, lastLoginFailedAt: 0 },
};

jest.mock('src/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (select) => select(mockState),
}));
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: { common: { proceed: 'Proceed' }, login: { Incorrect: 'Incorrect PIN' }, error: {} },
  }),
}));
jest.mock('@gluestack-ui/themed-native-base', () => ({
  Box: require('react-native').View,
  View: require('react-native').View,
  Modal: { Header: require('react-native').View, Body: require('react-native').View },
  useColorMode: () => ({ colorMode: 'light' }),
}));
jest.mock('react-native-modal', () => (props) =>
  require('react').createElement('NativeModal', props, props.children)
);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('src/hooks/useKeyboard', () => ({ useKeyboard: () => false }));
jest.mock('src/constants/responsive', () => ({ hp: (n) => n, wp: (n) => n, windowWidth: 414 }));
jest.mock('src/components/KeeperText', () => require('react-native').Text);
jest.mock('src/components/AppNumPad/KeyPadView', () => jest.fn(() => null));
jest.mock('src/components/AppPinInput/PinInputsView', () => jest.fn(() => null));
jest.mock('src/components/Buttons', () => jest.fn(() => null));
jest.mock('src/components/Switch/CurrencyTypeSwitch', () => () => null);
jest.mock('src/components/ThemedSvg.tsx/ThemedSvg', () => () => null);
jest.mock('react-native-biometrics', () => jest.fn(() => ({ createSignature: jest.fn() })));
jest.mock('src/assets/images/dark-close-icon.svg', () => () => null);
jest.mock('src/assets/images/info_icon.svg', () => () => null);
jest.mock('src/assets/images/info-Dark-icon.svg', () => () => null);

function PasscodeSheet({ toastRevision }: { toastRevision: number }) {
  return (
    <KeeperModal
      visible
      close={() => {}}
      title="Enter passcode"
      Content={PasscodeVerifyModal}
      contentProps={{
        useBiometrics: false,
        close: () => {},
        onSuccess: () => {},
        primaryText: 'Verify',
      }}
    />
  );
}

test('passcode retains two entered digits across a parent toast rerender', () => {
  jest.useFakeTimers();
  jest.spyOn(Dimensions, 'addEventListener').mockReturnValue({ remove: jest.fn() } as any);
  let screen!: ReactTestRenderer;
  act(() => { screen = create(<PasscodeSheet toastRevision={0} />); });
  const tap = () => act(() => screen.root.findByType(KeyPadView).props.onPressNumber('1'));
  tap();
  tap();
  expect(screen.root.findByType(PinInputsView).props.passCode).toBe('11');
  act(() => { screen.update(<PasscodeSheet toastRevision={1} />); });
  expect(screen.root.findByType(PinInputsView).props.passCode).toBe('11');
  tap();
  tap();
  expect(screen.root.findByType(PinInputsView).props.passCode).toBe('1111');
  expect(screen.root.findByType(Buttons).props.primaryText).toBe('Verify');
  expect(screen.root.findByType(Buttons).props.primaryDisable).toBe(false);
  act(() => screen.unmount());
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('ManageWallets uses a stable passcode component for both native sheets', () => {
  const filename = path.join(__dirname, '../../src/screens/AppSettings/ManageWallets.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const passcodeSheets: ts.JsxSelfClosingElement[] = [];
  const walk = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'KeeperModal') {
      const props = node.attributes.properties.filter(ts.isJsxAttribute);
      const content = props.find((prop) => prop.name.getText(source) === 'Content');
      const args = props.find((prop) => prop.name.getText(source) === 'contentProps');
      if (content && content.initializer && ts.isJsxExpression(content.initializer) &&
          content.initializer.expression?.getText(source) === 'PasscodeVerifyModal') {
        expect(args).toBeDefined();
        passcodeSheets.push(node);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  expect(passcodeSheets).toHaveLength(2);
});
