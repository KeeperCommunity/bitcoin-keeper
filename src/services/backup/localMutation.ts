import { RealmSchema } from 'src/storage/realm/enum';
import { canonical, recoveryContent } from './image';

const backedUpSchemas = new Set<RealmSchema>([
  RealmSchema.KeeperApp,
  RealmSchema.Wallet,
  RealmSchema.USDTWallet,
  RealmSchema.Vault,
  RealmSchema.Signer,
  RealmSchema.VaultSigner,
  RealmSchema.Tags,
  RealmSchema.NodeConnect,
]);

export function isBackedUpSchema(schema: RealmSchema) {
  return backedUpSchemas.has(schema);
}

function plain(record: any) {
  return record?.toJSON ? record.toJSON() : record;
}

function recoveryView(schema: RealmSchema, record: any) {
  if (schema === RealmSchema.KeeperApp) return {
    id: record.id, publicId: record.publicId, primarySeed: record.primarySeed, primaryMnemonic: record.primaryMnemonic,
    version: record.version, networkType: record.networkType, subscription: record.subscription,
  };
  if (schema === RealmSchema.Wallet || schema === RealmSchema.USDTWallet)
    return recoveryContent('wallets', record);
  if (schema === RealmSchema.Vault) return recoveryContent('vaults', record);
  if (schema === RealmSchema.NodeConnect) return recoveryContent('nodes', record);
  // A VaultSigner is folded into each backed-up vault image. Conservatively
  // invalidate on any change to it or to a signer/label record.
  return record;
}

// Run before the Realm write to conservatively invalidate UI verification,
// including writes that later fail. Generation proof comes only from the
// separate successful post-commit observer. Cache-only wallet refreshes and
// active-node rotation cannot change the encrypted recovery image.
export function changesBackedUpRecovery(schema: RealmSchema, previous: any, patch: any) {
  if (!isBackedUpSchema(schema) || !previous || !patch || typeof patch !== 'object') return false;
  try {
    const before = plain(previous);
    const after = { ...before, ...patch };
    return canonical(recoveryView(schema, before)) !== canonical(recoveryView(schema, after));
  } catch {
    // If Realm cannot be normalized, an uncertain write must invalidate trust.
    return true;
  }
}
