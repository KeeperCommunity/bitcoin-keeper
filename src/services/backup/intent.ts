import type { ProtectedBackupBase } from './protected';
/** The verified remote base and account session held by one originating write. */
export type BackupWriteIntent = Readonly<{
  appId: string;
  accountSession: number;
  baseRevision: string;
  protectedBase: ProtectedBackupBase;
  baselineEpoch: number;
  localGeneration?: number;
  localFingerprint?: string;
  operationId?: string;
  consentEpoch?: number;
}>;
