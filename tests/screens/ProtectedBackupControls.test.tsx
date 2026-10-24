import React from 'react';
import renderer, { act } from 'react-test-renderer';
import fs from 'fs';
import path from 'path';

const mockDispatch = jest.fn();
const mockNavigate = jest.fn();
const mockToast = jest.fn();
const mockApp = { id: 'disposable-upgraded-account' };
let mockSession = 1;
let mockDiagnostic: any;
const mockState: any = { bhr: {}, storage: { appId: mockApp.id } };
const copy = require('../../src/context/Localization/language/en.json');
jest.mock('src/constants/responsive', () => ({ hp: (n) => n, wp: (n) => n, windowWidth: 320 }));
jest.mock('@gluestack-ui/themed-native-base', () => ({
  Box: 'Box',
  ScrollView: 'ScrollView',
  useColorMode: () => ({ colorMode: 'light', toggleColorMode: jest.fn() }),
}));
jest.mock('@realm/react', () => ({ useQuery: (name) => (name === 'KeeperApp' ? [mockApp] : []) }));
jest.mock('src/storage/realm/utils', () => ({ getJSONFromRealmObject: (value) => value }));
jest.mock('src/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (select) => select(mockState),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ dispatch: mockNavigate, navigate: mockNavigate, goBack: mockNavigate }),
  useIsFocused: () => true,
  CommonActions: { navigate: (route) => ({ route }) },
}));
jest.mock('src/hooks/usePlan', () => ({
  __esModule: true,
  default: () => ({ isOnL2Above: true }),
}));
jest.mock('src/hooks/useIndicatorHook', () => ({
  useIndicatorHook: () => ({ typeBasedIndicator: {} }),
}));
jest.mock('src/hooks/useToastMessage', () => ({
  __esModule: true,
  default: () => ({ showToast: mockToast }),
}));
jest.mock('src/services/backup/automatic', () => ({ isBackupVerificationCurrent: () => false }));
jest.mock('src/services/backup/transport', () => ({
  getBackupDiagnostic: () => mockDiagnostic,
  currentBackupAccountSession: () => mockSession,
}));
jest.mock('src/store/reducers/bhr', () => ({
  isAutomaticCloudBackupEnabled: (state, id) => state.automaticCloudBackupByAppId[id] === true,
  ...Object.fromEntries(
    [
      'setBackupAllFailure',
      'setBackupAllSuccess',
      'setAutomaticCloudBackup',
      'setDeleteBackupSuccess',
      'setDeleteBackupFailure',
    ].map((type) => [type, (payload) => ({ type, payload })])
  ),
}));
jest.mock('src/store/reducers/settings', () => ({
  setShowTipModal: (payload) => ({ type: 'setShowTipModal', payload }),
  setThemeMode: (payload) => ({ type: 'setThemeMode', payload }),
}));
jest.mock('src/store/reducers/login', () => ({ credsAuthenticated: jest.fn() }));
jest.mock('src/components/Switch/Switch', () => 'Switch');
jest.mock('src/components/KeeperText', () => 'Text');
jest.mock('src/components/ScreenWrapper', () => 'Screen');
jest.mock('src/components/WalletHeader', () => 'Header');
jest.mock('src/components/ThemedSvg.tsx/ThemedSvg', () => 'ThemedSvg');
jest.mock('src/utils/service-utilities/config', () => ({
  __esModule: true,
  default: { ADDRESS: {} },
}));
jest.mock(
  'src/components/KeeperModal',
  () =>
    ({ visible, Content, title }) =>
      visible ? require('react').createElement('Modal', { title }, Content && <Content />) : null
);
// The baseline uses shared Buttons; preserve their callback behavior so the
// before/after control checks exercise the screen rather than the test mock.
jest.mock(
  'src/components/Buttons',
  () =>
    ({ primaryText, primaryCallback, secondaryText, secondaryCallback }) =>
      (
        <>
          {primaryText &&
            require('react').createElement('Action', {
              label: primaryText,
              onPress: primaryCallback,
            })}
          {secondaryText &&
            require('react').createElement('Action', {
              label: secondaryText,
              onPress: secondaryCallback,
            })}
        </>
      )
);
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: require('../../src/context/Localization/language/en.json'),
  }),
}));

const hookFile = path.join(__dirname, '../../src/hooks/useSettingKeeper.tsx');
const icons = fs.readFileSync(hookFile, 'utf8').matchAll(/from '(src\/assets\/[^']+\.svg)'/g);
for (const [, filename] of icons)
  jest.doMock(require.resolve(`../../${filename}`), () => () => null);
const { useSettingKeeper } = require('../../src/hooks/useSettingKeeper');
const Status = require('../../src/screens/AppSettings/AssistedBackupStatus').default;
let settings;
function SettingsHarness() {
  settings = useSettingKeeper();
  return (
    <>
      {settings.DeleteBackupModal}
      {settings.BackupFeedback}
    </>
  );
}
let screen;
function mount(Component = Status) {
  act(() => {
    screen = renderer.create(<Component />);
  });
  mockDispatch.mockClear();
}
function press(label: string) {
  const action = screen.root.findAll(
    (node) => node.props.label === label && typeof node.props.onPress === 'function'
  )[0];
  expect(action).toBeDefined();
  act(() => action.props.onPress());
}
function openBackupChoices() {
  act(() => {
    settings.BackAndRecovery.find(
      (item) => item.title === copy.settings.assistedServerBackup
    ).onRightPress();
    jest.runOnlyPendingTimers();
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  mockApp.id = 'disposable-upgraded-account';
  mockSession = 1;
  mockState.bhr = {
    automaticCloudBackupByAppId: { [mockApp.id]: true },
    backupRepairStateByAppId: { [mockApp.id]: 'unverified' },
    backupRepairRunningByAppId: {},
    protectedBackupStateByAppId: {},
  };
  mockDiagnostic = undefined;
  mockToast.mockClear();
  mockDispatch.mockClear();
});
afterEach(() => {
  act(() => screen?.unmount());
  jest.useRealTimers();
});

test('enabled unverified backup offers explicit backup while Check Again remains read-only', () => {
  mount();
  press(copy.recoveryBackup.check);
  expect(mockDispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: 'CHECK_BACKUP_FRESHNESS', appId: mockApp.id },
  ]);
  mockDispatch.mockClear();
  press(copy.recoveryBackup.backUp);
  expect(mockDispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: 'REPAIR_BACKUP', appId: mockApp.id },
  ]);
});

test.each(['deleted', 'conflict'])(
  '%s status never offers an update that might replace recovery data',
  (phase) => {
    mockState.bhr.backupRepairStateByAppId[mockApp.id] = phase;
    mount();
    expect(
      screen.root.findAll((node) => node.props.label === copy.recoveryBackup.backUp)
    ).toHaveLength(0);
    press(copy.recoveryBackup.check);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'CHECK_BACKUP_FRESHNESS',
      appId: mockApp.id,
    });
  }
);

test('turning off automatic backup dispatches consent-off only and leaves persistent readable feedback', () => {
  mount(SettingsHarness);
  openBackupChoices();
  press(copy.settings.assistedServerDeleteBackupModalSecondaryCTA);
  expect(mockDispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: 'setAutomaticCloudBackup', payload: { appId: mockApp.id, enabled: false } },
  ]);
  expect(JSON.stringify(screen.toJSON())).toContain(copy.settings.assistedServerBackupDisabled);
  expect(mockToast).not.toHaveBeenCalled();
  press(copy.recoveryBackup.dismiss);
  expect(JSON.stringify(screen.toJSON())).not.toContain(copy.settings.assistedServerBackupDisabled);
});

test('Delete protected backup requests deletion without falsely reporting completion or turning off consent', () => {
  mount(SettingsHarness);
  openBackupChoices();
  press(copy.settings.assistedServerDeleteBackupModalCTA);
  expect(mockDispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: 'DELETE_BACKUP', appId: mockApp.id },
  ]);
  expect(JSON.stringify(screen.toJSON())).not.toContain(
    copy.settings.assistedServerDeleteBackupConfirmed
  );
});

test('last bounded check detail is shown only after an explicit request', () => {
  mockDiagnostic = {
    operation: 'check',
    stage: 'snapshot-request',
    category: 'http-4xx',
    httpStatus: 401,
    elapsedMs: 250,
  };
  mount();
  expect(JSON.stringify(screen.toJSON())).not.toContain('snapshot-request');
  press(copy.recoveryBackup.showDetails);
  expect(JSON.stringify(screen.toJSON())).toContain('check / snapshot-request / http-4xx');
  expect(JSON.stringify(screen.toJSON())).toContain('401');
  press(copy.recoveryBackup.hideDetails);
  expect(JSON.stringify(screen.toJSON())).not.toContain('snapshot-request');
});

test('View status preserves deletion failure detail until a read-only recheck is requested', () => {
  mockDiagnostic = {
    operation: 'delete',
    stage: 'snapshot-request',
    category: 'http-4xx',
    httpStatus: 401,
    elapsedMs: 75,
  };
  act(() => {
    screen = renderer.create(<Status />);
  });
  expect(mockDispatch).not.toHaveBeenCalled();
  press(copy.recoveryBackup.showDetails);
  expect(JSON.stringify(screen.toJSON())).toContain('delete / snapshot-request / http-4xx');
  press(copy.recoveryBackup.check);
  expect(mockDispatch).toHaveBeenCalledWith({ type: 'CHECK_BACKUP_FRESHNESS', appId: mockApp.id });
});

test('old feedback is discarded after an account session changes, including returning to the same account', () => {
  mount(SettingsHarness);
  openBackupChoices();
  press(copy.settings.assistedServerDeleteBackupModalSecondaryCTA);
  expect(JSON.stringify(screen.toJSON())).toContain(copy.settings.assistedServerBackupDisabled);
  mockApp.id = 'disposable-other-account';
  mockSession += 1;
  act(() => screen.update(<SettingsHarness />));
  mockApp.id = 'disposable-upgraded-account';
  mockSession += 1;
  act(() => screen.update(<SettingsHarness />));
  expect(JSON.stringify(screen.toJSON())).not.toContain(copy.settings.assistedServerBackupDisabled);
});

test('authenticated never-enrolled deletion feedback never claims deletion and directs explicit backup', () => {
  mockState.bhr.deleteBackupFailureByAppId = { [mockApp.id]: true };
  mockDiagnostic = {
    operation: 'delete',
    stage: 'snapshot-request',
    category: 'never-enrolled',
    elapsedMs: 20,
  };
  mount(SettingsHarness);
  expect(JSON.stringify(screen.toJSON())).toContain(copy.recoveryBackup.deleteNotEnrolled);
  expect(JSON.stringify(screen.toJSON())).not.toContain(
    copy.settings.assistedServerDeleteBackupConfirmed
  );
});

test('consent-off status offers only a read-only recheck', () => {
  mockState.bhr.automaticCloudBackupByAppId[mockApp.id] = false;
  mount();
  expect(
    screen.root.findAll((node) => node.props.label === copy.recoveryBackup.backUp)
  ).toHaveLength(0);
  press(copy.recoveryBackup.check);
  expect(mockDispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: 'CHECK_BACKUP_FRESHNESS', appId: mockApp.id },
  ]);
});

test('enabled never-enrolled status offers explicit backup without creating anything on mount', () => {
  mockState.bhr.backupRepairStateByAppId[mockApp.id] = 'never-enrolled';
  mount();
  press(copy.recoveryBackup.backUp);
  expect(mockDispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: 'REPAIR_BACKUP', appId: mockApp.id },
  ]);
});

test('a retained deletion record blocks backup retry after an uncertain recheck even while automatic remains on', () => {
  mockState.bhr.protectedBackupStateByAppId[mockApp.id] = { status: 'deleted' };
  mount();
  expect(
    screen.root.findAll((node) => node.props.label === copy.recoveryBackup.backUp)
  ).toHaveLength(0);
  press(copy.recoveryBackup.check);
  expect(mockDispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: 'CHECK_BACKUP_FRESHNESS', appId: mockApp.id },
  ]);
});
