// Exercise the real credential-read boundary, without writing native storage.
const mockGetGenericPassword = jest.fn();
let mockAccounts = [];
let mockStateFailure;
jest.mock('react-native-keychain', () => ({
  getGenericPassword: (...args) => mockGetGenericPassword(...args),
}));
jest.mock('src/store/store', () => ({
  store: {
    getState: () => {
      if (mockStateFailure) throw mockStateFailure;
      return { account: { allAccounts: mockAccounts } };
    },
  },
}));
jest.mock('src/utils/service-utilities/config', () => ({ __esModule: true, default: {} }));
const { hasPin } = require('../../src/storage/secure-store');
beforeEach(() => {
  mockAccounts = [];
  mockStateFailure = undefined;
  mockGetGenericPassword.mockReset();
});

test('startup propagates a native read failure rather than treating it as no PIN', async () => {
  const error = new Error('synthetic native read failure');
  mockGetGenericPassword.mockRejectedValue(error);
  await expect(hasPin({ throwOnError: true })).rejects.toBe(error);
});
test('startup propagates invalid stored credential JSON', async () => {
  mockGetGenericPassword.mockResolvedValue({ password: 'invalid synthetic JSON' });
  await expect(hasPin({ throwOnError: true })).rejects.toThrow(SyntaxError);
});
test('legacy callers retain their existing false-on-error behavior', async () => {
  mockGetGenericPassword.mockRejectedValue(new Error('synthetic failure'));
  await expect(hasPin()).resolves.toBe(false);
});
test('a successfully read empty legacy store still means no PIN', async () => {
  mockGetGenericPassword.mockResolvedValue(false);
  await expect(hasPin({ throwOnError: true })).resolves.toBe(false);
  expect(mockGetGenericPassword).toHaveBeenCalledWith({ service: undefined });
});
test('reads the existing account service names without writing credentials', async () => {
  mockAccounts = [{ accountIdentifier: '' }, { accountIdentifier: 'synthetic-second-account' }];
  mockGetGenericPassword
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce({ password: '{"hash":"synthetic"}' });
  await expect(hasPin({ throwOnError: true })).resolves.toBe(true);
  expect(mockGetGenericPassword.mock.calls).toEqual([
    [{ service: undefined }],
    [{ service: 'synthetic-second-account' }],
  ]);
});

test.each(['STATE_READ', 'SERVICE_SELECT', 'KEYCHAIN_READ', 'CREDENTIAL_PARSE'])(
  'observes fixed %s facts while preserving the actual rejection',
  async (stage) => {
    const failure = new Error('PRIVATE_SENTINEL');
    const observe = jest.fn();
    if (stage === 'STATE_READ') mockStateFailure = failure;
    if (stage === 'SERVICE_SELECT')
      mockAccounts = [
        {
          get accountIdentifier() {
            throw failure;
          },
        },
      ];
    if (stage === 'KEYCHAIN_READ') mockGetGenericPassword.mockRejectedValue(failure);
    if (stage === 'CREDENTIAL_PARSE')
      mockGetGenericPassword.mockResolvedValue({ password: 'PRIVATE_SENTINEL' });
    if (stage === 'CREDENTIAL_PARSE') {
      await expect(hasPin({ throwOnError: true }, observe)).rejects.toBeInstanceOf(SyntaxError);
    } else {
      await expect(hasPin({ throwOnError: true }, observe)).rejects.toBe(failure);
    }
    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith({
      phase:
        stage === 'CREDENTIAL_PARSE'
          ? 'CREDENTIAL_JSON'
          : stage === 'KEYCHAIN_READ'
          ? 'NATIVE_CREDENTIAL_READ'
          : 'ACCOUNT_STATE',
      outcome: stage === 'KEYCHAIN_READ' ? 'REJECTED' : 'THREW',
      errorName: stage === 'CREDENTIAL_PARSE' ? 'SyntaxError' : 'Error',
      nativeCode: null,
    });
    expect(JSON.stringify(observe.mock.calls)).not.toContain('PRIVATE_SENTINEL');
  }
);

test.each([true, false])('observer failure preserves throwOnError=%s', async (throwOnError) => {
  const original = new Error('PRIVATE_SENTINEL');
  mockGetGenericPassword.mockRejectedValue(original);
  const action = hasPin({ throwOnError }, () => {
    throw new Error('OBSERVER_SENTINEL');
  });
  if (throwOnError) await expect(action).rejects.toBe(original);
  else await expect(action).resolves.toBe(false);
});

test('a successful empty native read supplies no failure observation', async () => {
  const observe = jest.fn();
  mockGetGenericPassword.mockResolvedValue(false);
  await expect(hasPin({ throwOnError: true }, observe)).resolves.toBe(false);
  expect(observe).not.toHaveBeenCalled();
});
