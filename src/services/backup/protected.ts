import './encoding';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import config from 'src/utils/service-utilities/config';
import { deriveBackupAuthority } from './authority';
import { canonical } from './image';
import { boundedBackupPost, currentBackupAccountSession } from './transport';

/** Remote generation is independent of the committed local Realm generation. */
export type ProtectedBackupBase = Readonly<{
  namespaceId: string;
  revision: string;
  generation: number;
  authEpoch: number;
}>;
export type ProtectedBackupState = {
  status: 'unknown' | 'neverEnrolled' | 'present' | 'deleted';
  namespaceId?: string;
  generation?: number;
  authEpoch?: number;
};
export type ProtectedRead =
  | { state: 'neverEnrolled'; namespaceId: string }
  | { state: 'present' | 'deleted'; namespaceId: string; snapshot: any };
type Operation = 'updateAppImage' | 'migrateXfps' | 'deleteAppImageEntity' | 'deleteVaults'
  | 'updateVaultImage' | 'modifyLabels' | 'deleteBackup' | 'repairAppBackup';
type Account = { id: string; primarySeed: string };
type Path = '/backup/v3/enroll' | '/backup/v3/snapshot' | '/backup/v3/mutate';

// This is a distinct gate from local consent. Explicit repair is not permission
// to write to a hosted backend whose readiness has not been established.
export const PROTECTED_BACKUP_HOSTED_READY = false;
function loopback() {
  return /^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(config.RELAY) &&
    ((typeof process !== 'undefined' && !!process.env?.KEEPER_PROTECTED_RELAY_CHECKOUT) ||
      (config.ENVIRONMENT === 'DEVELOPMENT' && config.isDevMode()));
}
export function assertProtectedBackupWriteReady() {
  if (!PROTECTED_BACKUP_HOSTED_READY && !loopback())
    throw new Error('Protected backup is not enabled on this server');
}
function endpoint(path: Path) {
  const base = new URL(config.RELAY);
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw new Error('Invalid protected backup endpoint');
  if (loopback()) return { url: `${base.origin}${path}`, audience: 'https://keeper-fixture.invalid' };
  if (base.protocol !== 'https:') throw new Error('Protected backup requires HTTPS');
  return { url: `${base.origin}${path}`, audience: base.origin };
}
let knownState: (appId: string) => ProtectedBackupState | undefined = () => undefined;
export function setProtectedBackupStateProvider(provider: typeof knownState) { knownState = provider; }
let onState: (appId: string, session: number, state: ProtectedBackupState) => void = () => {};
export function setProtectedBackupStateObserver(observer: typeof onState) { onState = observer; }
const uint = (n: any) => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0);
const object = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
const revision = (v: any) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const invalid = (): never => { throw new Error('Invalid protected backup response'); };

/** Validate the RAW namespace before any adapter supplies the original App ID. */
function validateRead(value: any, namespaceId: string, enrollment = false): ProtectedRead {
  if (!object(value) || value.scope !== 'protected-backup' || value.namespaceId !== namespaceId)
    return invalid();
  if (value.exists === false) {
    if (enrollment || value.neverEnrolled !== true ||
      Object.keys(value).some(k => !['scope', 'exists', 'namespaceId', 'neverEnrolled'].includes(k)))
      return invalid();
    return { state: 'neverEnrolled', namespaceId };
  }
  const app = value.appImage;
  if (value.exists !== true || !revision(value.revision) || !uint(value.generation) ||
    !uint(value.authEpoch) || value.backupRevisionRequired !== true ||
    value.incrementalRevisionRequired !== true || typeof value.deleted !== 'boolean' ||
    typeof value.suppressLegacyFallback !== 'boolean' || (value.deleted && !value.suppressLegacyFallback) ||
    !object(app) || app.appId !== namespaceId || !object(app.wallets) || !object(app.signers) ||
    !Array.isArray(app.nodes) || !Array.isArray(app.vaults) || !Array.isArray(app.labels) ||
    !Array.isArray(value.allVaultImages) || !Array.isArray(value.labels) || !Array.isArray(value.vaultMaps) ||
    !Array.isArray(value.unavailableVaultIds) || value.unavailableVaultIds.length ||
    !Array.isArray(value.unavailableLabelIds) || value.unavailableLabelIds.length ||
    value.allVaultImages.some((v: any) => !object(v) || v.appId !== namespaceId)) return invalid();
  if (value.deleted && (Object.keys(app.wallets).length || Object.keys(app.signers).length ||
    app.nodes.length || app.vaults.length || app.labels.length || value.allVaultImages.length ||
    value.labels.length || value.vaultMaps.length ||
    Object.keys(app).some(k => !['appId', 'wallets', 'signers', 'nodes', 'vaults', 'labels'].includes(k))))
    return invalid();
  const maps: any[] = [];
  for (const vault of value.allVaultImages) {
    if (typeof vault.isArchived !== 'boolean' || !Array.isArray(vault.signersData) ||
      !Array.isArray(vault.signerIds) || vault.signersData.some((s: any) =>
        !object(s) || typeof s.signerId !== 'string' || typeof s.xfpHash !== 'string') ||
      canonical(vault.signerIds) !== canonical(vault.signersData.map((s: any) => s.signerId)))
      return invalid();
    if (!vault.isArchived) for (const signer of vault.signersData)
      maps.push({...signer, vaultId: vault.vaultId});
  }
  const sorted = (rows: any[]) => rows.map(row => canonical(row)).sort();
  if (canonical(sorted(value.vaultMaps)) !== canonical(sorted(maps))) return invalid();
  // Check the complete RAW projection, including maps and reference metadata,
  // before any adapter rewrites its namespace into the original Keeper App ID.
  const projected = {namespaceId, generation: value.generation, authEpoch: value.authEpoch,
    deleted: value.deleted, suppressLegacyFallback: value.suppressLegacyFallback,
    appImage: app, allVaultImages: value.allVaultImages, labels: value.labels, vaultMaps: value.vaultMaps};
  if (bytesToHex(sha256(utf8ToBytes(canonical(projected)))) !== value.revision) return invalid();
  return { state: value.deleted ? 'deleted' : 'present', namespaceId, snapshot: value };
}
export function protectedBackupBase(snapshot: any): ProtectedBackupBase {
  if (!revision(snapshot?.revision) || !uint(snapshot?.generation) || !uint(snapshot?.authEpoch) ||
    typeof snapshot.namespaceId !== 'string') return invalid();
  return Object.freeze({ namespaceId: snapshot.namespaceId, revision: snapshot.revision,
    generation: snapshot.generation, authEpoch: snapshot.authEpoch });
}
export function sameProtectedBackupBase(a: ProtectedBackupBase, b: ProtectedBackupBase) {
  return !!a && !!b && a.namespaceId === b.namespaceId && a.revision === b.revision &&
    a.generation === b.generation && a.authEpoch === b.authEpoch;
}
async function request(mnemonic: string, path: Path, data: object, deadline?: number,
  checkpoint?: () => void, expectedNamespace?: string, account?: Account) {
  const check = checkpoint || (() => {});
  check();
  const authority = deriveBackupAuthority(mnemonic, account);
  const { namespaceId } = authority;
  let target: ReturnType<typeof endpoint>;
  let raw: string;
  let token: string;
  try {
    if (expectedNamespace && expectedNamespace !== namespaceId) return invalid();
    target = endpoint(path);
    const body = { namespaceId, publicJwk: authority.publicJwk, ...data };
    raw = JSON.stringify(body);
    if (utf8ToBytes(raw).length > 32 * 1024 * 1024)
      throw new Error('Backup exceeds supported size');
    token = authority.signRawBody(utf8ToBytes(raw), path, target.audience);
  } finally { authority.dispose(); }
  check();
  const response = await boundedBackupPost(target.url, raw, deadline,
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  check();
  return { value: response.data, namespaceId };
}
async function read(mnemonic: string, enroll: boolean, deadline?: number, keeperAppId?: string,
  checkpoint?: () => void, account?: Account): Promise<ProtectedRead> {
  if (enroll) assertProtectedBackupWriteReady();
  const session = currentBackupAccountSession();
  const { value, namespaceId } = await request(mnemonic,
    enroll ? '/backup/v3/enroll' : '/backup/v3/snapshot', {}, deadline, checkpoint, undefined, account);
  const result = validateRead(value, namespaceId, enroll);
  const known = keeperAppId ? knownState(keeperAppId) : undefined;
  if (known?.namespaceId && (known.namespaceId !== namespaceId ||
    (result.state === 'neverEnrolled' && known.status !== 'neverEnrolled' && known.status !== 'unknown') ||
    (result.state !== 'neverEnrolled' &&
      ((known.generation !== undefined && result.snapshot.generation < known.generation) ||
       (known.authEpoch !== undefined && result.snapshot.authEpoch < known.authEpoch)))))
    throw new Error('Protected backup history conflicts with this device');
  if (keeperAppId) onState(keeperAppId, session, { status: result.state,
    namespaceId, ...(result.state === 'neverEnrolled' ? {} :
      {generation: result.snapshot.generation, authEpoch: result.snapshot.authEpoch}) });
  return result;
}
export const readProtectedBackup = (mnemonic: string, deadline?: number, keeperAppId?: string,
  checkpoint?: () => void, account?: Account) => read(mnemonic, false, deadline, keeperAppId, checkpoint, account);
export const enrollProtectedBackup = (mnemonic: string, deadline?: number, keeperAppId?: string,
  checkpoint?: () => void, account?: Account) => read(mnemonic, true, deadline, keeperAppId, checkpoint, account);

/** The allowlist never signs appId/appID, billing identity or unknown aliases. */
export function protectedMutationData(operation: Operation, body: any) {
  if (!object(body)) return invalid();
  const pick = (names: string[]) => Object.fromEntries(names.filter(k => body[k] !== undefined)
    .map(k => [k, body[k]]));
  switch (operation) {
    case 'updateAppImage':
      if ((body.walletObject !== undefined && body.walletsObject !== undefined) ||
        (body.signersObjects !== undefined && body.signersObject !== undefined)) return invalid();
      return { ...pick(['nodes', 'replaceNodes', 'publicId', 'version', 'subscription']),
        ...((body.walletsObject ?? body.walletObject) !== undefined
          ? {walletsObject: body.walletsObject ?? body.walletObject} : {}),
        ...((body.signersObject ?? body.signersObjects) !== undefined
          ? {signersObject: body.signersObject ?? body.signersObjects} : {}) };
    case 'migrateXfps': return pick(['signerChanges']);
    case 'deleteAppImageEntity': return pick(['walletIds', 'signers']);
    case 'deleteVaults': return pick(['vaults']);
    case 'updateVaultImage': return pick(['vaultId', 'vault', 'signersData', 'isUpdate',
      'isArchived', 'archiveVaultId', 'vaultShellId', 'scheme']);
    case 'modifyLabels': return pick(['addLabels', 'deleteLabels']);
    case 'deleteBackup': return {};
    case 'repairAppBackup': return pick(['walletObject', 'signersObject', 'vaultObject',
      'nodes', 'labels', 'publicId', 'version', 'subscription', 'replaceCurrentState']);
    default: return invalid();
  }
}
export async function protectedBackupMutation(mnemonic: string, base: ProtectedBackupBase,
  operation: Operation, body: any, deadline?: number, checkpoint?: () => void, account?: Account) {
  assertProtectedBackupWriteReady();
  if (typeof base?.namespaceId !== 'string' || !revision(base?.revision) ||
    !uint(base?.generation) || !uint(base?.authEpoch)) return invalid();
  const data = protectedMutationData(operation, body);
  const { value } = await request(mnemonic, '/backup/v3/mutate', {operation,
    expectedRevision: base.revision, expectedGeneration: base.generation, authEpoch: base.authEpoch,
    data}, deadline, checkpoint, base.namespaceId, account);
  const deleting = operation === 'deleteBackup';
  if (value?.updated !== true || value.preconditionApplied !== true ||
    !revision(value.newRevision) || value.newRevision === base.revision ||
    value.newGeneration !== base.generation + 1 || value.authEpoch !== base.authEpoch + (deleting ? 1 : 0) ||
    value.deleted !== deleting || typeof value.suppressLegacyFallback !== 'boolean' ||
    (deleting && (value.suppressLegacyFallback !== true || value.deletionScope !== 'protected-backup-only' ||
      value.legacyCopiesMayRemain !== true))) return invalid();
  return Object.freeze({...value, base: Object.freeze({namespaceId: base.namespaceId,
    revision: value.newRevision, generation: value.newGeneration, authEpoch: value.authEpoch})});
}
