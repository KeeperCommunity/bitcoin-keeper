'use strict';
// Render the production screen and KeeperModal together. Only native hosts are
// synthetic; callbacks, state, refs, hide retention and unmount effects are real.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const renderer = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const root = process.env.KEEPER_MODAL_HANDOFF_SOURCE_ROOT || path.resolve(__dirname, '../..');

function fixture() {
  const calls = [], state = { login: { hasCreds: true }, settings: { loginMethod: 'PIN' }, account: { allAccounts: [] } };
  const translations = { common: { cancel: 'Cancel', continue: 'Continue' }, login: {}, error: {} };
  const context = React.createContext({ translations });
  const nativeBase = { Box: 'Box', StatusBar: 'StatusBar',
    Modal: { Header: 'Modal.Header', Body: 'Modal.Body' }, useColorMode: () => ({ colorMode: 'light' }) };
  const native = { StyleSheet: { create: value => value }, ScrollView: 'ScrollView',
    TouchableOpacity: 'TouchableOpacity', useWindowDimensions: () => ({ height: 800 }) };
  let KeeperModal;
  function load(name) {
    const exports = {};
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React,
    } }).outputText;
    vm.runInNewContext(compiled, { exports,
      setTimeout() { throw Error('The Cancel handoff must not use a timer'); },
      require(name) {
        if (name === 'react') return { ...React, default: React };
        if (name === 'react-native') return native;
        if (name === '@gluestack-ui/themed-native-base') return nativeBase;
        if (name === 'src/context/Localization/LocContext') return { LocalizationContext: context };
        if (name === 'src/store/hooks') return { useAppSelector: selector => selector(state), useAppDispatch: () => () => {} };
        if (name === 'react-native-responsive-screen') return { heightPercentageToDP: value => value, widthPercentageToDP: value => value };
        if (name === 'src/constants/responsive') return { hp: value => value, wp: value => value, windowWidth: 400 };
        if (name === 'src/components/KeeperModal') return { default: KeeperModal };
        if (name === 'react-native-modal') return { default: 'RNModal' };
        if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
        if (name === 'src/hooks/useKeyboard') return { useKeyboard: () => false };
        if (name === 'src/hooks/useToastMessage') return { default: () => ({ showToast() {} }) };
        if (name === 'src/components/ThemedColor/ThemedColor') return { default: () => '' };
        if (name === 'react-native-biometrics') return { default: class {} };
        if (name === 'src/utils/startup-boundary-observer') return { observeStartupBoundary() {} };
        if (name === 'src/constants/Fonts' || name === 'src/models/enums/LoginMethod') return { default: {} };
        return { default: name };
      } });
    return exports.default;
  }
  KeeperModal = load('src/components/KeeperModal.tsx');
  const CreatePin = load('src/screens/LoginScreen/CreatePin.tsx');
  let view;
  return { calls,
    async mount() {
      await renderer.act(async () => { view = renderer.create(React.createElement(CreatePin,
        { route: { params: {} }, navigation: { replace: (...args) => calls.push(args) } })); });
    },
    biometric() { return view.root.findAllByType(KeeperModal).find(node => node.props.secondaryButtonText === 'Cancel'); },
    native() { return view.root.findByType('RNModal'); },
    async unmount() { await renderer.act(async () => view.unmount()); },
  };
}

test('Cancel closes the production native modal before replacing the route, exactly once', async () => {
  const f = fixture(); await f.mount();
  try {
    const shown = f.native().props;
    assert.equal(shown.isVisible, true);
    await renderer.act(async () => { f.biometric().props.secondaryCallback(); f.biometric().props.secondaryCallback(); });
    assert.equal(f.biometric().props.visible, false);
    assert.equal(f.native().props.isVisible, false, 'KeeperModal remains mounted to finish native hide');
    assert.deepEqual(f.calls, []);
    await renderer.act(async () => shown.onModalHide());
    assert.deepEqual(f.calls, [], 'stale visible callback cannot navigate');
    const hidden = f.native().props.onModalHide;
    await renderer.act(async () => hidden());
    assert.deepEqual(f.calls, [['OnBoardingSlides']]);
    await renderer.act(async () => hidden());
    assert.deepEqual(f.calls, [['OnBoardingSlides']], 'duplicate native callback cannot replace twice');
  } finally { await f.unmount(); }
});

test('Unmount while native hide is pending invalidates the deferred route', async () => {
  const f = fixture(); await f.mount();
  await renderer.act(async () => f.biometric().props.secondaryCallback());
  const hidden = f.native().props.onModalHide;
  await f.unmount();
  await renderer.act(async () => hidden());
  assert.deepEqual(f.calls, []);
});

test('An unrelated native hide callback cannot select onboarding without Cancel intent', async () => {
  const f = fixture(); await f.mount();
  try {
    await renderer.act(async () => f.biometric().props.onModalHide());
    assert.deepEqual(f.calls, []);
    assert.equal(f.native().props.isVisible, true);
  } finally { await f.unmount(); }
});
