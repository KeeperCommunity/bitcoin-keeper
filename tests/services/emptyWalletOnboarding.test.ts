import {
  isEmptyWalletOnboardingEnabled,
  shouldAutomaticallyCreateMobileWallet,
  shouldDeferRecoveryKeyEducation,
  shouldRestoreFallbackMobileWallet,
} from 'src/services/wallets/operations/recoverable/emptyWalletOnboarding';
import { NetworkType } from 'src/services/wallets/enums';

const previewGate = {
  emptyWalletFlag: 'true',
  previewFlag: 'true',
  testnetOnlyFlag: 'true',
  bundleId: 'io.hexawallet.keeper.recoverablepreview',
};

describe('empty Wallet onboarding gate', () => {
  it('preserves automatic Mobile Wallet creation by default', () => {
    expect(
      shouldAutomaticallyCreateMobileWallet({ ...previewGate, emptyWalletFlag: undefined })
    ).toBe(true);
    expect(
      shouldAutomaticallyCreateMobileWallet({ ...previewGate, emptyWalletFlag: 'false' })
    ).toBe(true);
  });

  it('is active only for the exact testnet preview identity and flags', () => {
    expect(isEmptyWalletOnboardingEnabled(previewGate)).toBe(true);
    expect(
      isEmptyWalletOnboardingEnabled({
        ...previewGate,
        bundleId: 'io.hexawallet.hexakeeper.recoverablepreview',
      })
    ).toBe(true);
    expect(shouldAutomaticallyCreateMobileWallet(previewGate)).toBe(false);
    expect(
      shouldAutomaticallyCreateMobileWallet({
        ...previewGate,
        bundleId: 'io.hexawallet.keeper',
      })
    ).toBe(true);
    expect(
      shouldAutomaticallyCreateMobileWallet({ ...previewGate, testnetOnlyFlag: undefined })
    ).toBe(true);
    expect(shouldAutomaticallyCreateMobileWallet({ ...previewGate, previewFlag: undefined })).toBe(
      true
    );
  });

  it('keeps an intentionally empty restored preview empty while preserving legacy fallback', () => {
    expect(shouldRestoreFallbackMobileWallet(previewGate, false, false)).toBe(false);
    expect(
      shouldRestoreFallbackMobileWallet(
        { ...previewGate, emptyWalletFlag: undefined },
        false,
        false
      )
    ).toBe(true);
    expect(
      shouldRestoreFallbackMobileWallet({ ...previewGate, emptyWalletFlag: undefined }, true, false)
    ).toBe(false);
    expect(
      shouldRestoreFallbackMobileWallet({ ...previewGate, emptyWalletFlag: undefined }, false, true)
    ).toBe(false);
  });

  it('defers the Recovery Key sheet only on the empty testnet preview landing', () => {
    expect(shouldDeferRecoveryKeyEducation(previewGate, NetworkType.TESTNET, false)).toBe(true);
    expect(shouldDeferRecoveryKeyEducation(previewGate, NetworkType.TESTNET, true)).toBe(false);
    expect(shouldDeferRecoveryKeyEducation(previewGate, NetworkType.MAINNET, false)).toBe(false);
    expect(
      shouldDeferRecoveryKeyEducation(
        { ...previewGate, bundleId: 'io.hexawallet.keeper' },
        NetworkType.TESTNET,
        false
      )
    ).toBe(false);
    expect(
      shouldDeferRecoveryKeyEducation(
        { ...previewGate, emptyWalletFlag: undefined },
        NetworkType.TESTNET,
        false
      )
    ).toBe(false);
  });
});
