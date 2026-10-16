import networkReducer, { setTestnetFallbackNodeAdded } from '../../src/store/reducers/network';

describe('Testnet fallback migration', () => {
  it('tracks each account separately so a second Realm receives its own fallback', () => {
    const firstAccount = networkReducer(undefined, setTestnetFallbackNodeAdded('account-a'));
    expect(firstAccount.testnetFallbackNodeAddedByAppId['account-a']).toBe(true);
    expect(firstAccount.testnetFallbackNodeAddedByAppId['account-b']).toBeUndefined();

    const secondAccount = networkReducer(firstAccount, setTestnetFallbackNodeAdded('account-b'));
    expect(secondAccount.testnetFallbackNodeAddedByAppId).toEqual({
      'account-a': true,
      'account-b': true,
    });
  });
});
