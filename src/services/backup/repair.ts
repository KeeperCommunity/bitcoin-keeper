/* eslint-disable no-await-in-loop -- Serialize backup records to bound memory and yield to the UI. */
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import config from 'src/utils/service-utilities/config';
import { generateEncryptionKey, hash256 } from 'src/utils/service-utilities/encryption';
import {
  getKeyUID,
  sanitizeSeedKeyForBackup,
  sanitizeVaultSignersForSeedKeyBackup,
} from 'src/utils/utilities';
import {
  BACKUP_DEADLINE_MS,
  backupRevision,
  boundedBackupPost,
  withBackupSession,
} from './transport';
import {
  BackupImage,
  canonical,
  compareImages,
  decodeImage,
  encryptRecord,
  MAX_BACKUP_BYTES,
  MAX_RECORD_BYTES,
  pauseBackup,
  recoveryContent,
} from './image';

export type RepairPhase =
  | 'checking'
  | 'different'
  | 'preparing'
  | 'uploading'
  | 'verifying'
  | 'verified'
  | 'conflict'
  | 'unverified';
const inFlight = new Map<
  string,
  {
    repair: boolean;
    promise: Promise<RepairPhase>;
    listeners: Set<(phase: RepairPhase) => void>;
    phase?: RepairPhase;
  }
>();
const clone = (value: any) => JSON.parse(JSON.stringify(value));

export async function captureBackupImage(checkpoint = () => {}): Promise<BackupImage> {
  const image: BackupImage = { wallets: {}, signers: {}, vaults: {}, nodes: {}, labels: {} };
  const sources: [keyof BackupImage, RealmSchema][] = [
    ['wallets', RealmSchema.Wallet],
    ['wallets', RealmSchema.USDTWallet],
    ['signers', RealmSchema.Signer],
    ['vaults', RealmSchema.Vault],
    ['nodes', RealmSchema.NodeConnect],
    ['labels', RealmSchema.Tags],
  ];
  for (const [kind, schema] of sources) {
    const records = dbManager.getObjectByIndex(schema, null, true) as any;
    for (const value of records) {
      checkpoint();
      const text = JSON.stringify(value);
      if (text.length * 3 > MAX_RECORD_BYTES)
        throw new Error('Backup record exceeds supported size');
      const raw = JSON.parse(text);
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
      if (image[kind][id]) throw new Error('Duplicate local backup record');
      image[kind][id] = record;
      await pauseBackup();
    }
  }
  return image;
}

async function encodeImage(app: any, image: BackupImage, checkpoint = () => {}) {
  const key = generateEncryptionKey(app.primarySeed);
  const payload = {
    appId: app.id,
    publicId: app.publicId,
    subscription: JSON.stringify(app.subscription),
    networkType: app.networkType,
    version: app.version,
    walletObject: {},
    signersObject: {},
    vaultObject: {},
    nodes: [],
    labels: [],
  };
  let size = 0;
  for (const kind of Object.keys(image) as (keyof BackupImage)[]) {
    for (const [id, record] of Object.entries(image[kind])) {
      checkpoint();
      const encrypted = await encryptRecord(key, record);
      size += encrypted.length;
      if (size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds supported size');
      if (kind === 'wallets') payload.walletObject[id] = encrypted;
      if (kind === 'signers') payload.signersObject[id] = encrypted;
      if (kind === 'vaults')
        payload.vaultObject[id] = {
          vaultId: id,
          vault: encrypted,
          isArchived: !!record.archived,
          scheme: record.scheme,
          signersData: record.signers.map((signer) => ({
            signerId: getKeyUID(signer),
            xfpHash: hash256(signer.masterFingerprint),
          })),
        };
      if (kind === 'nodes') payload.nodes.push(encrypted);
      if (kind === 'labels')
        payload.labels.push({ id: hash256(hash256(key + id)), content: encrypted });
    }
  }
  return payload;
}

// Read-only checks never upload. A repair rechecks immediately before writing.
// Session ownership extends through readback; incremental writes wait, and their
// revision invalidates a concurrent repair's completion claim.
export function inspectBackup(
  appId: string,
  repair: boolean,
  onPhase: (phase: RepairPhase) => void
): Promise<RepairPhase> {
  const running = inFlight.get(appId);
  if (running) {
    if (repair && !running.repair)
      return running.promise.then(() => inspectBackup(appId, true, onPhase));
    running.listeners.add(onPhase);
    if (running.phase) onPhase(running.phase);
    return running.promise;
  }
  const listeners = new Set([onPhase]);
  const notify = (phase: RepairPhase) => {
    const active = inFlight.get(appId);
    if (active) active.phase = phase;
    listeners.forEach((listener) => listener(phase));
  };
  const result = withBackupSession(appId, async () => {
    const deadline = Date.now() + BACKUP_DEADLINE_MS;
    const revision = backupRevision(appId);
    const assertCurrent = () => {
      if (
        Date.now() >= deadline ||
        (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as any)?.id !== appId ||
        backupRevision(appId) !== revision
      )
        throw new Error('Backup changed during check');
    };
    try {
      notify('checking');
      const app = clone(dbManager.getObjectByIndex(RealmSchema.KeeperApp));
      assertCurrent();
      const key = generateEncryptionKey(app.primarySeed);
      const local = await captureBackupImage(assertCurrent);
      assertCurrent();
      let expectedRevision: string;
      const read = async () => {
        const response = await boundedBackupPost(
          `${config.RELAY}getBackupSnapshot`,
          { appId },
          deadline
        );
        assertCurrent();
        if (!/^[a-f0-9]{64}$/.test(response.data?.revision))
          throw new Error('Backup snapshot revision unavailable');
        expectedRevision = response.data.revision;
        return decodeImage(key, response.data, appId, assertCurrent);
      };
      const remote = await read();
      const comparison = await compareImages(local, remote, assertCurrent);
      assertCurrent();
      if (comparison === 'conflict') {
        notify('conflict');
        return 'conflict';
      }
      if (comparison === 'different' && !repair) {
        notify('different');
        return 'different';
      }
      if (comparison === 'different') {
        notify('preparing');
        const payload = await encodeImage(app, local, assertCurrent);
        assertCurrent();
        // Local Realm may change without a relay call (e.g. address generation).
        if (
          (await compareImages(local, await captureBackupImage(assertCurrent), assertCurrent)) !==
          'matched'
        )
          throw new Error('Local backup changed');
        assertCurrent();
        notify('uploading');
        try {
          const response = await boundedBackupPost(
            `${config.RELAY}repairAppBackup`,
            // This explicit action replaces the server snapshot with the
            // current local state, including intentional deletions. The relay
            // still checks the revision atomically before accepting it.
            { ...payload, expectedRevision, replaceCurrentState: true },
            deadline
          );
          if (response.data?.updated !== true) throw new Error('Backup rejected');
        } catch {
          // A lost response is not proof the upload failed. Always read back.
        }
        notify('verifying');
        if ((await compareImages(local, await read(), assertCurrent)) !== 'matched')
          throw new Error('Backup not verified');
      }
      if (
        (await compareImages(local, await captureBackupImage(assertCurrent), assertCurrent)) !==
        'matched'
      )
        throw new Error('Local backup changed');
      assertCurrent();
      notify('verified');
      return 'verified';
    } catch {
      notify('unverified');
      return 'unverified';
    }
  });
  inFlight.set(appId, { repair, promise: result, listeners });
  const clean = () => {
    if (inFlight.get(appId)?.promise === result) inFlight.delete(appId);
  };
  result.then(clean, clean);
  return result;
}
