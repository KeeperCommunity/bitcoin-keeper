'use strict';
// Render real HomeScreen/KeeperModal state with synthetic native hosts.
// Switching recovery guidance must keep one native presentation alive.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const renderer = require('react-test-renderer');
const ts = require('typescript');
global.IS_REACT_ACT_ENVIRONMENT = true;
const root = process.env.KEEPER_MODAL_HANDOFF_SOURCE_ROOT || path.resolve(__dirname, '../..');

function fixture() {
  const calls = [];
  const state = { bhr: {}, settings: { bitcoinNetworkType: 'TESTNET' }, account: {} };
  const context = React.createContext({ translations: {
    home: { educationSheetTitle: 'Protect Your Recovery Key', skipWarningTitle: 'Continue Without Backup?',
      skipForNow: 'Skip for Now', continueWithoutBackup: 'Skip Backup', backUpNow: 'Back Up Now',
      backUpRecoveryKey: 'Back Up Recovery Key', skipWarningBody: 'Recovery backup is still required' },
    wallet: { homeWallets: 'Wallets', keys: 'Keys', more: 'More' },
    buyBTC: { acquire: 'Acquire' }, askAi: { ask: 'Ask' },
  } });
  const nativeBase = { Box: 'Box', Modal: { Header: 'Header', Body: 'Body' },
    useColorMode: () => ({ colorMode: 'light' }) };
  let KeeperModal;
  function load(relative) {
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.React },
    }).outputText;
    vm.runInNewContext(compiled, { exports,
      setTimeout() { throw Error('The modal handoff must wait for native hide, not a timer'); },
      require(name) {
        if (name === 'react') return { ...React, default: React };
        if (name === 'react-native') return { StyleSheet: { create: x => x },
          TouchableOpacity: 'TouchableOpacity', View: 'View', ScrollView: 'ScrollView',
          useWindowDimensions: () => ({ height: 800 }) };
        if (name === '@gluestack-ui/themed-native-base') return nativeBase;
        if (name === 'react-native-modal') return { default: 'NativeModal' };
        if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
        if (name === 'src/hooks/useKeyboard') return { useKeyboard: () => false };
        if (name === 'src/constants/responsive') return { hp: x => x, wp: x => x, windowWidth: 400 };
        if (name === 'src/context/Localization/LocContext') return { LocalizationContext: context };
        if (name === 'src/store/hooks') return { useAppSelector: select => select(state) };
        if (name === 'react-redux') return { useDispatch: () => action => calls.push(action) };
        if (name === 'src/store/reducers/account') return { setRecoveryKeyStatus: payload => ({ type: 'fixture/recovery-status', payload }) };
        if (name === 'src/hooks/useWallets') return { default: () => ({ wallets: [] }) };
        if (name === 'src/hooks/useToastMessage') return { default: () => ({ showToast() {} }) };
        if (name === '@react-navigation/native') return { useFocusEffect() {}, useNavigation: () => ({ navigate() {} }) };
        if (name === '@realm/react') return { useQuery: () => [] };
        if (name === 'src/storage/realm/enum') return { RealmSchema: {} };
        if (name === 'src/storage/realm/dbManager') return { default: { getObjectByIndex: () => ({ id: 'disposable' }) } };
        if (name === 'src/services/wallets/enums') return { NetworkType: { TESTNET: 'TESTNET' } };
        if (name === 'src/services/sentry') return { SentryErrorBoundary: x => x };
        if (name === 'src/components/KeeperModal') return { default: KeeperModal };
        if (name === 'src/components/ThemedColor/ThemedColor') return { default: () => '' };
        return { default: () => null };
      },
    });
    return exports.default;
  }
  KeeperModal = load('src/components/KeeperModal.tsx');
  const Home = load('src/screens/Home/HomeScreen.tsx');
  let view;
  return {
    calls,
    shown() { return view.root.findAllByType(KeeperModal).find(node => node.props.visible); },
    native() { return view.root.findAllByType('NativeModal').find(node => node.props.isVisible); },
    async mount() { await renderer.act(async () => { view = renderer.create(React.createElement(Home, { route: {} })); }); },
    async unmount() { await renderer.act(async () => view.unmount()); },
  };
}

test('Skip for Now changes the recovery sheet within the same native presentation', async () => {
  const f = fixture(); await f.mount();
  try {
    const before = f.native();
    assert.equal(f.shown().props.title, 'Protect Your Recovery Key');
    assert.equal(f.shown().props.buttonText, 'Back Up Now');
    await renderer.act(async () => f.shown().props.secondaryCallback());
    assert.equal(f.shown().props.title, 'Continue Without Backup?');
    assert.equal(f.shown().props.buttonText, 'Back Up Recovery Key');
    assert.equal(f.shown().props.secondaryButtonText, 'Skip Backup');
    assert.equal(f.shown().props.subTitle, 'Recovery backup is still required');
    assert.ok(f.native() === before, 'do not replace the native presentation before its hide completes');
    assert.equal(f.calls.length, 0, 'viewing the warning must not mark the recovery key skipped');
  } finally { await f.unmount(); }
});

test('Back from the warning preserves the native presentation and does not skip recovery', async () => {
  const f = fixture(); await f.mount();
  try {
    const before = f.native();
    await renderer.act(async () => f.shown().props.secondaryCallback());
    await renderer.act(async () => f.shown().props.close());
    assert.equal(f.shown().props.title, 'Protect Your Recovery Key');
    assert.ok(f.native() === before, 'return to education within the existing native presentation');
    assert.equal(f.calls.length, 0);
  } finally { await f.unmount(); }
});

test('Only the separate Skip Backup action persists skipped recovery status and closes the sheet', async () => {
  const f = fixture(); await f.mount();
  try {
    await renderer.act(async () => f.shown().props.secondaryCallback());
    assert.equal(f.calls.length, 0);
    await renderer.act(async () => f.shown().props.secondaryCallback());
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),
      [{ type: 'fixture/recovery-status', payload: { appId: 'disposable', status: 'skipped' } }]);
    assert.equal(f.shown(), undefined);
    assert.equal(f.native(), undefined);
  } finally { await f.unmount(); }
});
