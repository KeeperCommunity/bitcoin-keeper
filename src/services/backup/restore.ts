import { decodeImage } from './image';

// Decode every record before changing Realm. Older backups may omit collections
// introduced later; an unreadable response or a missing referenced record is not
// an empty backup and must never trigger successful partial recovery.
export async function prepareRecoveryImage(
  encryptionKey: string,
  appId: string,
  appImage: any,
  allVaultImages: any[],
  labels: any[]
) {
  if (!appImage || appImage.appId !== appId) throw new Error('Recovery data unavailable');
  return decodeImage(
    encryptionKey,
    {
      appImage: {
        ...appImage,
        signers: appImage.signers === undefined ? {} : appImage.signers,
        nodes: appImage.nodes === undefined ? [] : appImage.nodes,
      },
      allVaultImages,
      labels,
    },
    appId
  );
}
