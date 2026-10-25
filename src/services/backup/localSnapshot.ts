import { RealmSchema } from 'src/storage/realm/enum';
import { hash256 } from 'src/utils/service-utilities/encryption';
import {
  getKeyUID,
  sanitizeSeedKeyForBackup,
  sanitizeVaultSignersForSeedKeyBackup,
} from 'src/utils/utilities';
import { BackupImage, canonical, recoveryContent } from './image';

export function backupMetadataMatches(local: any, remote: any, namespaceId = local.id) {
  try {
    const subscription =
      typeof remote?.subscription === 'string'
        ? JSON.parse(remote.subscription)
        : remote?.subscription;
    return (
      !!remote &&
      remote.appId === namespaceId &&
      remote.publicId === local.publicId &&
      remote.version === local.version &&
      canonical(subscription) === canonical(local.subscription)
    );
  } catch {
    return false;
  }
}

// Synchronous so no Realm mutation can interleave the final evidence check and
// Redux commit. Only a hash is retained; recovery material is never logged.
export function captureLocalRecovery(database: any) {
  const plain = (value: any) => JSON.parse(JSON.stringify(value));
  const app = plain(database.objects(RealmSchema.KeeperApp)[0]);
  if (!app?.id || !app.primarySeed) throw new Error('Recovery account unavailable');
  const image: BackupImage = { wallets: {}, signers: {}, vaults: {}, nodes: {}, labels: {} };
  const registrations = new Map<string, any>();
  for (const record of database.objects(RealmSchema.VaultSigner))
    registrations.set(record.xpub, plain(record.registeredVaults));
  const sources: [keyof BackupImage, RealmSchema][] = [
    ['wallets', RealmSchema.Wallet],
    ['wallets', RealmSchema.USDTWallet],
    ['signers', RealmSchema.Signer],
    ['vaults', RealmSchema.Vault],
    ['nodes', RealmSchema.NodeConnect],
    ['labels', RealmSchema.Tags],
  ];
  for (const [kind, schema] of sources) {
    for (const value of database.objects(schema)) {
      const raw = plain(value);
      if (kind === 'vaults')
        raw.signers = raw.signers.map((signer: any) =>
          registrations.has(signer.xpub)
            ? { ...signer, registeredVaults: registrations.get(signer.xpub) }
            : signer
        );
      const record =
        kind === 'signers'
          ? sanitizeSeedKeyForBackup(raw)
          : kind === 'vaults'
          ? sanitizeVaultSignersForSeedKeyBackup(raw)
          : kind === 'nodes'
          ? { ...raw, isConnected: false }
          : raw;
      const id =
        kind === 'signers'
          ? getKeyUID(record)
          : record.id || canonical(recoveryContent(kind, record));
      if (image[kind][id]) throw new Error('Duplicate local recovery record');
      image[kind][id] = record;
    }
  }
  const normalized = Object.fromEntries(
    Object.entries(image).map(([kind, records]) => [
      kind,
      Object.fromEntries(
        Object.entries(records).map(([id, record]) => [
          id,
          recoveryContent(kind as keyof BackupImage, record),
        ])
      ),
    ])
  );
  const metadata = {
    id: app.id,
    publicId: app.publicId,
    primarySeed: app.primarySeed,
    primaryMnemonic: app.primaryMnemonic,
    version: app.version,
    networkType: app.networkType,
    subscription: app.subscription,
  };
  return { app, image, fingerprint: hash256(canonical({ metadata, image: normalized })) };
}
