import {
  observeStartupFailure,
  reportStartupFailure,
} from '../../src/storage/startup-failure-observer';

const previousDev = __DEV__;
const previousHook = Object.getOwnPropertyDescriptor(global, 'nativeLoggingHook');
afterEach(() => {
  (global as any).__DEV__ = previousDev;
  if (previousHook) Object.defineProperty(global, 'nativeLoggingHook', previousHook);
  else delete (global as any).nativeLoggingHook;
  jest.restoreAllMocks();
});

function installHook(value) {
  Object.defineProperty(global, 'nativeLoggingHook', { configurable: true, writable: true, value });
}

test('only canonical native rejection codes supply a bounded code without coercion', () => {
  for (const [code, expected] of [
    ['-34018', -34018],
    ['-25308', -25308],
    ['0', 0],
    ['2147483647', 2147483647],
    ['-2147483648', -2147483648],
    [-25308, null],
    ['+1', null],
    ['01', null],
    ['-0', null],
    [' 1', null],
    ['1e3', null],
    ['-34018\n', null],
    ['2147483648', null],
    [
      {
        toString() {
          throw Error('PRIVATE_SENTINEL');
        },
      },
      null,
    ],
  ]) {
    const observer = jest.fn();
    reportStartupFailure(observer, 'NATIVE_CREDENTIAL_READ', 'REJECTED', {
      code,
      name: 'Error',
      message: 'PRIVATE_SENTINEL',
    });
    expect(observer).toHaveBeenCalledWith({
      phase: 'NATIVE_CREDENTIAL_READ',
      outcome: 'REJECTED',
      errorName: 'Error',
      nativeCode: expected,
    });
    expect(JSON.stringify(observer.mock.calls)).not.toContain('PRIVATE_SENTINEL');
  }
  const observer = jest.fn();
  let codeReads = 0;
  reportStartupFailure(observer, 'CREDENTIAL_JSON', 'THREW', {
    name: 'SyntaxError',
    get code() {
      codeReads++;
      return '-34018';
    },
  });
  expect(codeReads).toBe(0);
  expect(observer).toHaveBeenCalledWith({
    phase: 'CREDENTIAL_JSON',
    outcome: 'THREW',
    errorName: 'SyntaxError',
    nativeCode: null,
  });
});

test('unknown private fields and hostile error accessors cannot escape or replace a failure', () => {
  const values = [
    null,
    'PRIVATE_SENTINEL',
    { code: 'PRIVATE_SENTINEL', name: '__proto__' },
    {
      get code() {
        throw Error('PRIVATE_SENTINEL');
      },
    },
    {
      get name() {
        throw Error('PRIVATE_SENTINEL');
      },
    },
    {
      code: {
        toString() {
          throw Error('PRIVATE_SENTINEL');
        },
      },
    },
  ];
  for (const value of values) {
    const observer = jest.fn();
    expect(() =>
      reportStartupFailure(observer, 'NATIVE_CREDENTIAL_READ', 'REJECTED', value)
    ).not.toThrow();
    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer.mock.calls[0][0].nativeCode).toBeNull();
    expect(['UNKNOWN', 'OTHER']).toContain(observer.mock.calls[0][0].errorName);
    expect(JSON.stringify(observer.mock.calls)).not.toContain('PRIVATE_SENTINEL');
  }
  const observer = jest.fn();
  reportStartupFailure(observer, 'PRIVATE_SENTINEL' as any, 'THREW', new Error('PRIVATE_SENTINEL'));
  expect(observer).not.toHaveBeenCalled();
});

test('development output is one direct Error-level marker without console or LogBox calls', () => {
  (global as any).__DEV__ = true;
  const hook = jest.fn();
  installHook(hook);
  jest.spyOn(Date, 'now').mockReturnValue(1500);
  const info = jest.spyOn(console, 'info').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  reportStartupFailure(observeStartupFailure, 'NATIVE_CREDENTIAL_READ', 'REJECTED', {
    code: '-34018',
    name: 'Error',
    message: 'PRIVATE_SENTINEL',
  });
  expect(hook.mock.calls).toEqual([
    ['KEEPER_STARTUP_FAILURE_V1|1500|NATIVE_CREDENTIAL_READ|REJECTED|Error|-34018', 3],
  ]);
  expect(info).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  expect(JSON.stringify(hook.mock.calls)).not.toContain('PRIVATE_SENTINEL');
});

test('production and missing observers inspect nothing, and failing hooks stay harmless', () => {
  let hookReads = 0,
    errorReads = 0;
  Object.defineProperty(global, 'nativeLoggingHook', {
    configurable: true,
    get() {
      hookReads++;
      throw Error('PRIVATE_SENTINEL');
    },
  });
  const fact = {
    get phase() {
      throw Error('PRIVATE_SENTINEL');
    },
  } as any;
  (global as any).__DEV__ = false;
  expect(() => observeStartupFailure(fact)).not.toThrow();
  expect(hookReads).toBe(0);
  reportStartupFailure(undefined, 'NAVIGATION', 'THREW', {
    get name() {
      errorReads++;
      throw Error('PRIVATE_SENTINEL');
    },
  });
  expect(errorReads).toBe(0);
  (global as any).__DEV__ = true;
  expect(() => observeStartupFailure(fact)).not.toThrow();
  installHook(() => {
    throw Error('PRIVATE_SENTINEL');
  });
  expect(() =>
    observeStartupFailure({
      phase: 'ACCOUNT_STATE',
      outcome: 'THREW',
      errorName: 'Error',
      nativeCode: null,
    })
  ).not.toThrow();
});

test('a changing fact accessor is read once before validating and forming the fixed marker', () => {
  (global as any).__DEV__ = true;
  const hook = jest.fn();
  installHook(hook);
  jest.spyOn(Date, 'now').mockReturnValue(1500);
  let reads = 0;
  observeStartupFailure({
    get phase() {
      return ++reads === 1 ? 'ACCOUNT_STATE' : 'PRIVATE_SENTINEL';
    },
    outcome: 'THREW',
    errorName: 'UNKNOWN',
    nativeCode: null,
  } as any);
  expect(reads).toBe(1);
  expect(hook).toHaveBeenCalledWith(
    'KEEPER_STARTUP_FAILURE_V1|1500|ACCOUNT_STATE|THREW|UNKNOWN|NONE',
    3
  );
});
