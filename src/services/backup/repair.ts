/* eslint-disable no-await-in-loop -- Serialize backup records to bound memory and yield to the UI. */
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import realmDatabase from 'src/storage/realm/realm';
import { generateEncryptionKey, hash256 } from 'src/utils/service-utilities/encryption';
import {
  getKeyUID,
  sanitizeSeedKeyForBackup,
  sanitizeVaultSignersForSeedKeyBackup,
} from 'src/utils/utilities';
import { captureLocalRecovery, backupMetadataMatches } from './localSnapshot';
import { readProtectedBackup, enrollProtectedBackup, protectedBackupMutation,
  protectedBackupBase, sameProtectedBackupBase, assertProtectedBackupWriteReady,
  ProtectedBackupBase } from './protected';
import {
  BACKUP_DEADLINE_MS,
  BackupRequestError,
  backupQueuedRevision,
  backupConsentEpoch,
  backupRevision,
  canAccessBackupAccount,
  clearVerifiedRemoteRevision,
  currentBackupAccountSession,
  recordVerifiedRemoteRevision,
  withBackupSession,
} from './transport';
import {
  BackupImage,
  BackupSnapshotValidationError,
  canonical,
  compareImages,
  validateProtectedRecoveryMetadata,
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
  | 'unverified'
  | 'never-enrolled'
  | 'deleted';
type InspectionStage =
  | 'local-capture'
  | 'snapshot-request'
  | 'snapshot-validation'
  | 'snapshot-decryption'
  | 'comparison'
  | 'repair-preparation'
  | 'repair-upload'
  | 'repair-readback'
  | 'local-recheck';
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

// Replacing the whole Relay image is safe without separate replacement consent
// only when it adds records to the remote image. A remote-only record or a
// changed recovery payload could contain the user's sole recoverable copy.
function replacementWouldDiscardRecovery(local: BackupImage, remote: BackupImage) {
  for (const kind of Object.keys(remote) as (keyof BackupImage)[]) {
    for (const [id, stored] of Object.entries(remote[kind])) {
      const current = local[kind][id];
      if (
        !current ||
        canonical(recoveryContent(kind, current)) !== canonical(recoveryContent(kind, stored))
      )
        return true;
    }
  }
  return false;
}

export async function captureBackupImage(checkpoint = () => {}): Promise<BackupImage> {
  const image: BackupImage = { wallets: {}, signers: {}, vaults: {}, nodes: {}, labels: {} };
  // A VaultSigner is shared across the vaults that use its xpub. Read the
  // persisted registration value, including a value whose incremental upload
  // failed, and carry it into every affected encrypted vault record.
  const registrations = new Map<string, any>();
  const vaultSigners = dbManager.getObjectByIndex(RealmSchema.VaultSigner, null, true) as any;
  for (const value of vaultSigners) {
    checkpoint();
    registrations.set(value.xpub, clone(value.registeredVaults));
  }
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
      if (kind === 'vaults')
        raw.signers = raw.signers.map((signer) =>
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
  onPhase: (phase: RepairPhase) => void,
  explicitChoice = false,
  expectedSession = currentBackupAccountSession()
): Promise<RepairPhase> {
  // A prior A session may still be queued or in flight after A -> B -> A.
  // Do not join that inspection or let it write on behalf of the new session.
  const operationKey = `${appId}:${expectedSession}`;
  const sessionIsCurrent = () => currentBackupAccountSession() === expectedSession;
  if (!sessionIsCurrent()) {
    onPhase('unverified');
    return Promise.resolve('unverified');
  }
  const running = inFlight.get(operationKey);
  if (running) {
    if (repair && !running.repair)
      return running.promise.then(() =>
        inspectBackup(appId, true, onPhase, explicitChoice, expectedSession)
      );
    running.listeners.add(onPhase);
    if (running.phase) onPhase(running.phase);
    return running.promise;
  }
  const listeners = new Set([onPhase]);
  const notify = (phase: RepairPhase) => {
    const active = inFlight.get(operationKey);
    if (active) active.phase = phase;
    listeners.forEach((listener) => listener(phase));
  };
  let deadline: number;
  const inspectOnce = async (allowRetry: boolean): Promise<RepairPhase | 'retry'> => {
    let stage: InspectionStage = 'local-capture';
    let changedRevision = 0;
    // One deadline covers both read-only attempts; a retry must not double it.
    deadline ??= Date.now() + BACKUP_DEADLINE_MS;
    const revision = backupRevision(appId);
    const consentEpoch = backupConsentEpoch(appId);
    const assertCurrent = () => {
      if (
        !sessionIsCurrent() ||
        consentEpoch !== backupConsentEpoch(appId) ||
        Date.now() >= deadline ||
        (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as any)?.id !== appId ||
        !canAccessBackupAccount(appId, explicitChoice)
      )
        throw new Error('Backup changed during check');
      const currentRevision = backupRevision(appId);
      if (currentRevision !== revision) {
        changedRevision = currentRevision;
        throw new Error('Backup changed during check');
      }
    };
    // The snapshot reader updates this stage inside an async closure.
    const stageAtFailure = (): InspectionStage => stage;
    try {
      notify('checking');
      const app = clone(dbManager.getObjectByIndex(RealmSchema.KeeperApp));
      const database = realmDatabase.getDatabase();
      const localEvidence = captureLocalRecovery(database);
      const assertSource = () => {
        assertCurrent();
        if (realmDatabase.getDatabase() !== database ||
          captureLocalRecovery(database).fingerprint !== localEvidence.fingerprint)
          throw new Error('Committed recovery changed before backup write');
      };
      assertCurrent();
      const key = generateEncryptionKey(app.primarySeed);
      const local = await captureBackupImage(assertCurrent);
      assertCurrent();
      let expectedBase: ProtectedBackupBase;
      let discovery: 'never-enrolled' | 'deleted' | undefined;
      let needsVaultRepair = false;
      let needsLabelRepair = false;
      let needsMetadataRepair = false;
      let unavailableVaultIds: string[] = [];
      let unavailableLabelIds: string[] = [];
      const read = async (readback = false) => {
        stage = readback ? 'repair-readback' : 'snapshot-request';
        let found = await readProtectedBackup(app.primaryMnemonic, deadline, appId, assertCurrent, app);
        assertCurrent();
        if (found.state === 'neverEnrolled') {
          if (!repair || readback) { discovery = 'never-enrolled'; return undefined; }
          // Enrollment is a remote write: only the explicitly requested repair
          // owns this captured local/session/consent scope, and it stays gated.
          assertProtectedBackupWriteReady();
          found = await enrollProtectedBackup(app.primaryMnemonic, deadline, appId, assertSource, app);
          if (found.state === 'neverEnrolled') throw new Error('Enrollment not confirmed');
        }
        if (found.state === 'deleted' && !repair) { discovery = 'deleted'; return undefined; }
        const response = {data: found.snapshot};
        if (!readback) stage = 'snapshot-validation';
        assertCurrent();
        expectedBase = protectedBackupBase(response.data);
        needsMetadataRepair = !backupMetadataMatches(app, response.data.appImage, expectedBase.namespaceId);
        const unavailable = response.data.unavailableVaultIds ?? [];
        if (!Array.isArray(unavailable) || new Set(unavailable).size !== unavailable.length)
          throw new Error('Invalid unavailable backup records');
        const references = response.data.appImage?.vaults;
        if (
          unavailable.length &&
          (!Array.isArray(references) ||
            new Set(references).size !== references.length ||
            unavailable.some(
              (id) =>
                typeof id !== 'string' ||
                !id ||
                !references.includes(id) ||
                response.data.allVaultImages?.some((record) => record.vaultId === id)
            ))
        )
          throw new Error('Invalid unavailable backup references');
        unavailableVaultIds = unavailable;
        const unavailableLabels = response.data.unavailableLabelIds ?? [];
        const labelReferences = response.data.appImage?.labels;
        if (
          !Array.isArray(unavailableLabels) ||
          new Set(unavailableLabels).size !== unavailableLabels.length ||
          (unavailableLabels.length &&
            (!Array.isArray(labelReferences) ||
              new Set(labelReferences).size !== labelReferences.length ||
              unavailableLabels.some(
                (id) =>
                  typeof id !== 'string' ||
                  !id ||
                  !labelReferences.includes(id) ||
                  response.data.labels?.some((record) => record.id === id)
              )))
        )
          throw new Error('Invalid unavailable backup labels');
        unavailableLabelIds = unavailableLabels;
        // A legacy shared-wallet image may have been overwritten by another
        // participant. The relay withholds that participant's ciphertext. Only
        // this explicit backup check may compare the remaining records; clean
        // restore still rejects the incomplete reference list.
        const availableResponse =
          unavailable.length || unavailableLabels.length
            ? {
                ...response.data,
                appImage: {
                  ...response.data.appImage,
                  vaults: unavailable.length
                    ? references.filter((id) => !unavailable.includes(id))
                    : response.data.appImage.vaults,
                  labels: unavailableLabels.length
                    ? labelReferences.filter((id) => !unavailableLabels.includes(id))
                    : response.data.appImage.labels,
                },
              }
            : response.data;
        if (!readback) stage = 'snapshot-decryption';
        // Restore can salvage legacy map aliases. Inspection requires the
        // stored key to match the ID inside each encrypted wallet record.
        const decoded = await decodeImage(key, availableResponse, expectedBase.namespaceId, assertCurrent, true);
        validateProtectedRecoveryMetadata(response.data, decoded, getKeyUID, hash256, key);
        needsVaultRepair =
          unavailable.length > 0 ||
          response.data.allVaultImages.some(
            (record) =>
              typeof record.isArchived === 'boolean' &&
              record.isArchived !== !!decoded.vaults[record.vaultId]?.archived
          );
        needsLabelRepair = unavailableLabels.length > 0;
        return decoded;
      };
      const remote = await read();
      if (!remote) {
        const phase = discovery || 'unverified';
        notify(phase);
        return phase;
      }
      stage = 'comparison';
      const contentComparison = await compareImages(local, remote, assertCurrent);
      const comparison =
        contentComparison === 'matched' &&
        (needsVaultRepair || needsLabelRepair || needsMetadataRepair)
          ? 'different'
          : contentComparison;
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
        if (
          replacementWouldDiscardRecovery(local, remote) ||
          unavailableVaultIds.some((id) => !local.vaults[id]) ||
          unavailableLabelIds.some(
            (id) =>
              !Object.keys(local.labels).some((localId) => hash256(hash256(key + localId)) === id)
          )
        ) {
          notify('conflict');
          return 'conflict';
        }
        stage = 'repair-preparation';
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
        stage = 'repair-upload';
        assertProtectedBackupWriteReady();
        let acknowledgedBase: ProtectedBackupBase | undefined;
        try {
          const reply = await protectedBackupMutation(app.primaryMnemonic, expectedBase,
            'repairAppBackup', {...payload, replaceCurrentState: true}, deadline, assertSource, app);
          acknowledgedBase = reply.base;
        } catch {
          // An unknown outcome permits a fresh read, never a retry or a new
          // base for this ciphertext. A matching read alone is not its ACK.
        }
        notify('verifying');
        stage = 'repair-readback';
        const verifiedRemote = await read(true);
        stage = 'repair-readback';
        if (
          !acknowledgedBase ||
          !sameProtectedBackupBase(expectedBase, acknowledgedBase) ||
          !verifiedRemote ||
          needsVaultRepair ||
          needsLabelRepair ||
          needsMetadataRepair ||
          (await compareImages(local, verifiedRemote, assertCurrent)) !== 'matched'
        )
          throw new Error('Backup not verified');
      }
      stage = 'local-recheck';
      if (
        (await compareImages(local, await captureBackupImage(assertCurrent), assertCurrent)) !==
        'matched'
      )
        throw new Error('Local backup changed');
      assertCurrent();
      if (
        captureLocalRecovery(realmDatabase.getDatabase()).fingerprint !== localEvidence.fingerprint
      )
        throw new Error('Committed recovery changed during final verification');
      recordVerifiedRemoteRevision(appId, expectedBase.revision, expectedSession, expectedBase);
      notify('verified');
      return 'verified';
    } catch (error) {
      const failedStage = stageAtFailure();
      // A routine incremental write can be queued while a read-only check is
      // running. A transient snapshot request can also fail while the backup is
      // healthy. Retry either case once behind queued writes, within the same
      // deadline. Never retry a repair, invalid response, or account switch.
      let accountIsCurrent = false;
      try {
        accountIsCurrent =
          sessionIsCurrent() &&
          (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as any)?.id === appId;
      } catch {
        // Realm may already be closed during an account switch.
      }
      const queuedWriteChanged = changedRevision && backupQueuedRevision(appId) >= changedRevision;
      const transientSnapshotFailure =
        failedStage === 'snapshot-request' &&
        error instanceof BackupRequestError &&
        ['http-5xx', 'network', 'timeout'].includes(error.category);
      if (
        allowRetry &&
        !repair &&
        accountIsCurrent &&
        Date.now() < deadline &&
        (queuedWriteChanged || transientSnapshotFailure)
      )
        return 'retry';
      // Only log fixed categories. Errors and responses can contain encrypted
      // backup data, account identifiers, headers, or request bodies.
      const category = error instanceof BackupRequestError ? error.category : 'non-transport';
      const diagnosticStage =
        failedStage === 'snapshot-decryption' && error instanceof BackupSnapshotValidationError
          ? 'snapshot-validation'
          : failedStage;
      globalThis.console.warn(
        'Assisted Server Backup check failed at stage:',
        diagnosticStage,
        category
      );
      notify('unverified');
      return 'unverified';
    }
  };
  const runOnce = (allowRetry: boolean) =>
    withBackupSession(appId, () => {
      if (!sessionIsCurrent()) {
        notify('unverified');
        return Promise.resolve('unverified' as RepairPhase);
      }
      // Invalidate only after admission, so a later inspection cannot cancel
      // an earlier writer. Each admitted retry must expire its own baseline.
      clearVerifiedRemoteRevision(appId);
      return inspectOnce(allowRetry);
    });
  const result: Promise<RepairPhase> = runOnce(true).then(async (phase) =>
    phase === 'retry' ? ((await runOnce(false)) as RepairPhase) : phase
  );
  inFlight.set(operationKey, { repair, promise: result, listeners });
  const clean = () => {
    if (inFlight.get(operationKey)?.promise === result) inFlight.delete(operationKey);
  };
  result.then(clean, clean);
  return result;
}
