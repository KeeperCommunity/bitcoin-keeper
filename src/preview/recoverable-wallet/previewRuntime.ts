export type PreviewRuntime = 'preview' | 'production' | 'misconfigured';

export const PREVIEW_BUNDLE_IDS = [
  'io.hexawallet.keeper.recoverablepreview',
  'io.hexawallet.hexakeeper.recoverablepreview',
];

export function getPreviewRuntime(
  flag: string | undefined,
  bundleId: string,
  testnetOnlyFlag: string | undefined
): PreviewRuntime {
  const hasPreviewFlag = flag === 'true';
  const hasPreviewIdentity = PREVIEW_BUNDLE_IDS.includes(bundleId);
  const hasPreviewSignal =
    hasPreviewFlag || testnetOnlyFlag === 'true' || bundleId.endsWith('.recoverablepreview');

  if (!hasPreviewSignal) return 'production';
  if (!hasPreviewIdentity || !hasPreviewFlag || testnetOnlyFlag !== 'true') return 'misconfigured';
  return 'preview';
}
