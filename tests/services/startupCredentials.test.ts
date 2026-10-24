// Exercise the real credential-read boundary, without writing native storage.
const mockGetGenericPassword = jest.fn();
let mockAccounts = [];
jest.mock('react-native-keychain', () => ({
  getGenericPassword: (...args) => mockGetGenericPassword(...args),
}));
jest.mock('src/store/store', () => ({
  store: { getState: () => ({ account: { allAccounts: mockAccounts } }) },
}));
jest.mock('src/utils/service-utilities/config', () => ({ __esModule: true, default: {} }));
const { hasPin } = require('../../src/storage/secure-store');
beforeEach(() => {
  mockAccounts = [];
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
