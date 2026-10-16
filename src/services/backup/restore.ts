import { TronWeb } from 'tronweb';
import { BackupSnapshotValidationError, decodeImage } from './image';

export type BackupRecoverySource = 'protected' | 'legacy-older';
export type BackupRecoverySelection =
  | { source: 'protected' }
  | { source: 'legacy-older'; olderCopyConfirmed: true };

export type RecoveryProvenance = {
  source: BackupRecoverySource;
  keeperAppId: string;
  namespaceId?: string;
  legacyMayPredateDeletion: boolean;
  legacyCopiesMayRemain: true;
};

export type RecoveryDiscovery = {
  status:
    | 'idle'
    | 'checking'
    | 'protected-found'
    | 'protected-empty'
    | 'protected-absent'
    | 'protected-deleted'
    | 'legacy-selected'
    | 'read-error'
    | 'restored';
  source: BackupRecoverySource;
  keeperAppId?: string;
  namespaceId?: string;
  legacyMayPredateDeletion?: boolean;
  error?: string;
  provenance?: RecoveryProvenance;
};

export type ProtectedBackupState = {
  status: 'unknown' | 'neverEnrolled' | 'present' | 'deleted';
  namespaceId?: string;
  generation?: number;
  authEpoch?: number;
};

type RecoveryImageSource =
  | { source: 'protected'; namespaceId: string; response: any }
  | { source: 'legacy-older'; olderCopyConfirmed: true; response: any; legacyMayPredateDeletion?: boolean };

// The authenticated protected transport validates its raw namespace projection
// before this adapter runs. Keep that projection identity distinct from the
// original Keeper/provider identity written by recoverApp. This normalization
// grants no legacy ownership, billing entitlement or upload consent. The normal
// prepareRecoveryImage call in recoverApp remains the complete decrypt/validate
// barrier before its first Realm write; do not decrypt the whole image twice.
export function prepareRecoverySourceImage(keeperAppId: string, source: RecoveryImageSource) {
  const { response } = source;
  const projectionId = source.source === 'protected' ? source.namespaceId : keeperAppId;
  if (
    !keeperAppId || !response?.appImage || response.appImage.appId !== projectionId ||
    (response.unavailableVaultIds !== undefined &&
      (!Array.isArray(response.unavailableVaultIds) || response.unavailableVaultIds.length !== 0)) ||
    (response.unavailableLabelIds !== undefined &&
      (!Array.isArray(response.unavailableLabelIds) || response.unavailableLabelIds.length !== 0))
  ) throw new BackupSnapshotValidationError('Recovery data unavailable');
  if (source.source === 'protected' && (
    response.scope !== 'protected-backup' || response.exists !== true ||
    response.namespaceId !== source.namespaceId || response.deleted !== false ||
    typeof response.suppressLegacyFallback !== 'boolean' ||
    !Array.isArray(response.allVaultImages) || !Array.isArray(response.labels) ||
    response.allVaultImages.some((vault: any) => vault?.appId !== source.namespaceId)
  )) throw new BackupSnapshotValidationError('Invalid protected recovery source');
  if (source.source === 'legacy-older' && source.olderCopyConfirmed !== true)
    throw new BackupSnapshotValidationError('Older recovery copy was not selected');
  const allVaultImages = response.allVaultImages === undefined ? [] : response.allVaultImages;
  const labels = response.labels === undefined ? [] : response.labels;
  if (!Array.isArray(allVaultImages) || !Array.isArray(labels))
    throw new BackupSnapshotValidationError('Recovery data unavailable');
  const provenance: RecoveryProvenance = {
    source: source.source,
    keeperAppId,
    ...(source.source === 'protected' ? { namespaceId: source.namespaceId } : {}),
    legacyMayPredateDeletion: source.source === 'legacy-older' && !!source.legacyMayPredateDeletion,
    legacyCopiesMayRemain: true,
  };
  return {
    appImage: { ...response.appImage, appId: keeperAppId },
    allVaultImages: source.source === 'protected'
      ? allVaultImages.map((vault: any) => ({ ...vault, appId: keeperAppId }))
      : allVaultImages,
    labels,
    provenance,
  };
}

export const hasRecoveryRecords = (response: any): boolean => !!response?.appImage && (
  Object.keys(response.appImage.wallets || {}).length > 0 ||
  Object.keys(response.appImage.signers || {}).length > 0 ||
  (Array.isArray(response.appImage.nodes) && response.appImage.nodes.length > 0) ||
  (Array.isArray(response.appImage.vaults) && response.appImage.vaults.length > 0) ||
  (Array.isArray(response.appImage.labels) && response.appImage.labels.length > 0) ||
  (Array.isArray(response.allVaultImages) && response.allVaultImages.length > 0) ||
  (Array.isArray(response.labels) && response.labels.length > 0) ||
  (Array.isArray(response.vaultMaps) && response.vaultMaps.length > 0)
);

// Decode every record before changing Realm. Older backups may omit collections
// introduced later; an unreadable response or a missing referenced record is not
// an empty backup and must never trigger successful partial recovery.
export async function prepareRecoveryImage(
  encryptionKey: string,
  appId: string,
  appImage: any,
  allVaultImages: any[],
  labels: any[],
  verifyProtectedWalletKeys = false,
  checkpoint: () => void = () => {}
) {
  checkpoint();
  if (!appImage || appImage.appId !== appId) throw new Error('Recovery data unavailable');
  // Older Relay registrations and deletions stored empty maps as empty arrays.
  // Keep those recoverable, but let decodeImage reject nonempty malformed arrays.
  const legacyEmptyMap = (value: any) => (Array.isArray(value) && !value.length ? {} : value);
  const image = await decodeImage(
    encryptionKey,
    {
      appImage: {
        ...appImage,
        wallets: legacyEmptyMap(appImage.wallets),
        signers: legacyEmptyMap(appImage.signers === undefined ? {} : appImage.signers),
        nodes: appImage.nodes === undefined ? [] : appImage.nodes,
      },
      allVaultImages,
      labels,
    },
    appId,
    checkpoint,
    verifyProtectedWalletKeys
  );
  checkpoint();
  // Legacy USDT wallets cannot recover these addresses from the retired
  // provider. Reject an unusable image before the first Realm write.
  for (const wallet of Object.values(image.wallets) as any[]) {
    if (wallet.entityKind !== 'USDT_WALLET') continue;
    const status = wallet.accountStatus;
    if (
      typeof status?.address !== 'string' ||
      typeof status?.gasFreeAddress !== 'string' ||
      !TronWeb.isAddress(status.address) ||
      !TronWeb.isAddress(status.gasFreeAddress)
    )
      throw new BackupSnapshotValidationError('Invalid USDT wallet backup address');
  }
  return image;
}
