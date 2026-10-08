import { getPreviewRuntime } from 'src/preview/recoverable-wallet/previewRuntime';

export interface EmptyWalletOnboardingGate {
  emptyWalletFlag?: string;
  previewFlag?: string;
  testnetOnlyFlag?: string;
  bundleId: string;
}

/**
 * An absent flag preserves Keeper's existing default Mobile Wallet behavior.
 * This branch can suppress that wallet only inside the separately installed,
 * testnet-only preview identity. A later production rollout needs review.
 */
export const isEmptyWalletOnboardingEnabled = ({
  emptyWalletFlag,
  previewFlag,
  testnetOnlyFlag,
  bundleId,
}: EmptyWalletOnboardingGate): boolean =>
  emptyWalletFlag === 'true' &&
  getPreviewRuntime(previewFlag, bundleId, testnetOnlyFlag) === 'preview';

export const shouldAutomaticallyCreateMobileWallet = (gate: EmptyWalletOnboardingGate): boolean =>
  !isEmptyWalletOnboardingEnabled(gate);

export const shouldRestoreFallbackMobileWallet = (
  gate: EmptyWalletOnboardingGate,
  hasWalletImages: boolean,
  hasVaultImages: boolean
): boolean => shouldAutomaticallyCreateMobileWallet(gate) && !hasWalletImages && !hasVaultImages;
