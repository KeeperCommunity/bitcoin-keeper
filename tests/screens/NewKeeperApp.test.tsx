import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import loginReducer, { setAppCreationError } from '../../src/store/reducers/login';

const mockGetToken = jest.fn();
jest.mock('src/services/rest/RestClient', () => ({ __esModule: true, default: {} }));
const { observeBackupAccount } = require('../../src/services/backup/transport');
jest.mock('src/constants/responsive', () => ({ hp: (v) => v, wp: (v) => v, windowWidth: 400 }));
jest.mock('@gluestack-ui/themed-native-base', () => ({
  Box: 'Box',
  Pressable: 'Pressable',
  useColorMode: () => ({ colorMode: 'light' }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('@react-native-firebase/app', () => ({ getApp: jest.fn() }));
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(),
  getToken: (...args) => mockGetToken(...args),
}));
jest.mock('src/hooks/useToastMessage', () => ({
  __esModule: true,
  default: () => ({ showToast: jest.fn() }),
}));
jest.mock('src/store/sagaActions/notifications', () => ({
  updateFCMTokens: (tokens) => ({ type: 'UPDATE_FCM', tokens }),
}));
jest.mock('src/utils/service-utilities/config', () => ({
  KEEPER_WEBSITE_BASE_URL: 'https://example.invalid',
}));
jest.mock('src/utils/OpenLink', () => jest.fn());
jest.mock('src/context/Localization/LocContext', () => ({
  LocalizationContext: require('react').createContext({
    translations: require('../../src/context/Localization/language/en.json'),
  }),
}));
[
  'new-app-icon',
  'icon_arrow',
  'icon_arrow_white',
  'recover-app-icon',
  'settings',
  'settings_grey',
].forEach((name) =>
  jest.doMock(require.resolve(`../../src/assets/images/${name}.svg`), () => () => null)
);
Object.entries({
  'src/components/KeeperModal': 'Modal',
  'src/components/KeeperText': 'Text',
  'src/components/ScreenWrapper': 'Screen',
  'src/components/Loader': 'Loader',
  'src/components/BounceLoader': 'BounceLoader',
  'src/components/ThemedSvg.tsx/ThemedSvg': 'Svg',
}).forEach(([path, name]) => jest.doMock(require.resolve(`../../${path}`), () => name));
const NewKeeperApp = require('../../src/screens/NewKeeperAppScreen/NewKeeperAppScreen').default;

let screen;
let store;
let actions;
let view;
let navigation;

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function mount({ error = false, created = false, recreated = false } = {}) {
  actions = [];
  const loginState = {
    ...loginReducer(undefined, { type: '@@test/init' }),
    appCreationError: error,
  };
  store = configureStore({
    reducer: {
      login: (state = loginState, action) => loginReducer(state, action),
      storage: (state = { appCreated: created, appId: 'disposable-account-A' }, action) => {
        if (action.type === 'TEST_APP_CREATED') return { ...state, appCreated: true };
        if (action.type === 'TEST_SWITCH_ACCOUNT') return { ...state, appId: action.appId };
        return state;
      },
      bhr: (state = { appRecreated: recreated }) => state,
      account: (state = { allAccounts: [] }) => state,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(() => (next) => (action) => {
        actions.push(action);
        const result = next(action);
        observeBackupAccount(store.getState().storage.appId);
        return result;
      }),
  });
  navigation = { replace: jest.fn(), navigate: jest.fn() };
  view = () => (
    <Provider store={store}>
      <NewKeeperApp navigation={navigation} />
    </Provider>
  );
  await act(async () => {
    screen = renderer.create(view());
  });
}

function visibleDialogs() {
  return screen.root.findAllByType('Modal').filter((modal) => modal.props.visible);
}

function setupActions() {
  return actions.filter((action) => action.type === 'SETUP_KEEPER_APP');
}

async function start() {
  await act(async () => {
    screen.root.findByProps({ testID: 'view_startNewTile' }).props.onPress();
  });
}

beforeEach(() => {
  mockGetToken.mockReset().mockResolvedValue('test-token');
  observeBackupAccount(undefined);
  observeBackupAccount('disposable-account-A');
});

afterEach(() => {
  if (screen) {
    act(() => screen.unmount());
    screen = null;
  }
  jest.useRealTimers();
});

test('setup failure presents one retry dialog, clears its error and starts one retry', async () => {
  await mount({ error: true });
  expect(visibleDialogs()).toHaveLength(1);
  const retry = visibleDialogs()[0];
  expect(retry.props.buttonText).toBe('Retry');
  await act(async () => {
    retry.props.buttonCallback();
    retry.props.buttonCallback();
  });
  expect(store.getState().login.appCreationError).toBe(false);
  expect(visibleDialogs()).toHaveLength(1);
  expect(visibleDialogs()[0].props.buttonText).toBeNull();
  expect(setupActions()).toEqual([
    { type: 'SETUP_KEEPER_APP', payload: { appName: '', fcmToken: 'test-token' } },
  ]);
});

test('repeated failures each allow one retry and a later success does not replay setup', async () => {
  await mount();
  await start();
  expect(setupActions()).toHaveLength(1);

  for (const attempts of [2, 3]) {
    await act(async () => {
      store.dispatch(setAppCreationError(true));
    });
    expect(visibleDialogs()).toHaveLength(1);
    expect(visibleDialogs()[0].props.buttonText).toBe('Retry');
    await act(async () => {
      visibleDialogs()[0].props.buttonCallback();
    });
    expect(store.getState().login.appCreationError).toBe(false);
    expect(visibleDialogs()).toHaveLength(1);
    expect(visibleDialogs()[0].props.buttonText).toBeNull();
    expect(setupActions()).toHaveLength(attempts);
  }

  await act(async () => {
    store.dispatch({ type: 'TEST_APP_CREATED' });
  });
  expect(visibleDialogs()).toHaveLength(1);
  expect(visibleDialogs()[0].props.buttonText).toBe('Next');
  expect(actions.filter((action) => action.type === 'UPDATE_FCM')).toEqual([
    { type: 'UPDATE_FCM', tokens: ['test-token'] },
  ]);
  await act(async () => screen.update(view()));
  expect(setupActions()).toHaveLength(3);
});

test('rapid Start presses and rerenders keep one pending token lookup and one setup attempt', async () => {
  const token = deferred();
  mockGetToken.mockReturnValue(token.promise);
  await mount();
  const pressStart = screen.root.findByProps({ testID: 'view_startNewTile' }).props.onPress;
  await act(async () => {
    pressStart();
    pressStart();
  });
  await act(async () => {
    screen.update(view());
    pressStart();
  });
  expect(mockGetToken).toHaveBeenCalledTimes(1);
  expect(setupActions()).toHaveLength(0);
  expect(visibleDialogs()).toHaveLength(1);
  await act(async () => token.resolve('delayed-token'));
  expect(setupActions()).toEqual([
    { type: 'SETUP_KEEPER_APP', payload: { appName: '', fcmToken: 'delayed-token' } },
  ]);
});

test('token retrieval failure starts one setup attempt without a token', async () => {
  mockGetToken.mockRejectedValue(new Error('offline token retrieval'));
  await mount();
  await start();
  expect(setupActions()).toEqual([
    { type: 'SETUP_KEEPER_APP', payload: { appName: '', fcmToken: '' } },
  ]);
  expect(visibleDialogs()).toHaveLength(1);
  expect(visibleDialogs()[0].props.buttonText).toBeNull();
});

test.each(['resolve', 'reject'])(
  'unmounting before token %s prevents a stale setup attempt',
  async (completion) => {
    const token = deferred();
    mockGetToken.mockReturnValue(token.promise);
    await mount();
    await start();
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(setupActions()).toHaveLength(0);
    act(() => screen.unmount());
    screen = null;
    await act(async () => {
      if (completion === 'resolve') token.resolve('late-token');
      else token.reject(new Error('late offline failure'));
    });
    expect(setupActions()).toHaveLength(0);
  }
);

test.each(['resolve', 'reject'])(
  'unmounting before the successful app token %s prevents a stale token update',
  async (completion) => {
    const token = deferred();
    mockGetToken.mockReturnValue(token.promise);
    await mount({ created: true });
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(actions.filter((action) => action.type === 'UPDATE_FCM')).toHaveLength(0);
    act(() => screen.unmount());
    screen = null;
    await act(async () => {
      if (completion === 'resolve') token.resolve('late-success-token');
      else token.reject(new Error('late token refresh failure'));
    });
    expect(actions.filter((action) => action.type === 'UPDATE_FCM')).toHaveLength(0);
    expect(setupActions()).toHaveLength(0);
  }
);

test('a successfully created app remount does not automatically create another app', async () => {
  await mount({ created: true });
  expect(visibleDialogs()).toHaveLength(0);
  expect(setupActions()).toHaveLength(0);
  await act(async () => {
    screen.unmount();
    screen = renderer.create(view());
  });
  expect(visibleDialogs()).toHaveLength(0);
  expect(setupActions()).toHaveLength(0);
});

test('recreated-app navigation is cancelled when its screen unmounts', async () => {
  jest.useFakeTimers();
  await mount({ recreated: true });
  act(() => screen.unmount());
  screen = null;
  await act(async () => jest.advanceTimersByTime(4000));
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('Next navigation is cancelled when its screen unmounts', async () => {
  jest.useFakeTimers();
  await mount();
  await start();
  await act(async () => store.dispatch({ type: 'TEST_APP_CREATED' }));
  const next = visibleDialogs()[0].props.buttonCallback;
  act(() => next());
  act(() => screen.unmount());
  screen = null;
  await act(async () => jest.advanceTimersByTime(1000));
  expect(navigation.replace).not.toHaveBeenCalled();
});

test('rapid Next taps schedule only one navigation', async () => {
  jest.useFakeTimers();
  await mount();
  await start();
  await act(async () => store.dispatch({ type: 'TEST_APP_CREATED' }));
  const next = visibleDialogs()[0].props.buttonCallback;
  act(() => {
    next();
    next();
  });
  await act(async () => jest.advanceTimersByTime(1000));
  expect(navigation.replace).toHaveBeenCalledTimes(1);
  expect(navigation.replace).toHaveBeenCalledWith('App', { screen: 'Home' });
});

test('a retained Next callback cannot schedule navigation after unmount', async () => {
  jest.useFakeTimers();
  await mount();
  await start();
  await act(async () => store.dispatch({ type: 'TEST_APP_CREATED' }));
  const next = visibleDialogs()[0].props.buttonCallback;
  act(() => screen.unmount());
  screen = null;
  act(() => next());
  await act(async () => jest.advanceTimersByTime(1000));
  expect(navigation.replace).not.toHaveBeenCalled();
});

async function switchAwayAndBack() {
  for (const appId of ['disposable-account-B', 'disposable-account-A']) {
    await act(async () => store.dispatch({ type: 'TEST_SWITCH_ACCOUNT', appId }));
  }
}

test.each(['resolve', 'reject'])(
  'an account round trip before token %s prevents setup in the replacement session',
  async (completion) => {
    const token = deferred();
    mockGetToken.mockReturnValue(token.promise);
    await mount();
    await start();
    await switchAwayAndBack();
    await act(async () => {
      if (completion === 'resolve') token.resolve('earlier-session-token');
      else token.reject(new Error('earlier-session token failure'));
    });
    expect(setupActions()).toHaveLength(0);
  }
);

test('an account round trip prevents an earlier successful-app token update', async () => {
  const token = deferred();
  mockGetToken.mockReturnValue(token.promise);
  await mount({ created: true });
  await switchAwayAndBack();
  await act(async () => token.resolve('earlier-session-token'));
  expect(actions.filter((action) => action.type === 'UPDATE_FCM')).toHaveLength(0);
});

test('recreated-app navigation runs once in its original session', async () => {
  jest.useFakeTimers();
  await mount({ recreated: true });
  await act(async () => jest.advanceTimersByTime(4000));
  expect(navigation.replace).toHaveBeenCalledTimes(1);
  expect(navigation.replace).toHaveBeenCalledWith('App', { screen: 'Home' });
});

test('an account round trip cancels pending recreated-app navigation', async () => {
  jest.useFakeTimers();
  await mount({ recreated: true });
  await switchAwayAndBack();
  await act(async () => jest.advanceTimersByTime(4000));
  expect(navigation.replace).not.toHaveBeenCalled();
});

test.each(['before', 'after'])(
  'an account round trip %s tapping a retained Next cannot navigate the replacement session',
  async (when) => {
    jest.useFakeTimers();
    await mount();
    await start();
    await act(async () => store.dispatch({ type: 'TEST_APP_CREATED' }));
    const next = visibleDialogs()[0].props.buttonCallback;
    if (when === 'before') await switchAwayAndBack();
    act(() => next());
    if (when === 'after') await switchAwayAndBack();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(navigation.replace).not.toHaveBeenCalled();
  }
);
