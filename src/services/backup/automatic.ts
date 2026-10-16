/* eslint-disable no-await-in-loop -- CAS fanout must use each acknowledged revision in order. */
import realmDatabase from 'src/storage/realm/realm';
import config from 'src/utils/service-utilities/config';
import { RealmSchema } from 'src/storage/realm/enum';
import { generateEncryptionKey, hash256 } from 'src/utils/service-utilities/encryption';
import { getKeyUID } from 'src/utils/utilities';
import type { BackupWriteIntent } from './intent';
import { readProtectedBackup, protectedBackupMutation, protectedBackupBase,
  sameProtectedBackupBase, assertProtectedBackupWriteReady } from './protected';
import {
  BackupImage,
  canonical,
  recoveryContent,
  decodeImage,
  decryptRecord,
  compareImages,
  validateProtectedRecoveryMetadata,
} from './image';
import { captureLocalRecovery, backupMetadataMatches } from './localSnapshot';
import {
  BACKUP_DEADLINE_MS,
  backupBaselineEpoch,
  backupConsentEpoch,
  canAccessBackupAccount,
  clearVerifiedRemoteRevision,
  currentBackupAccountSession,
  markBackupQueuedMutation,
  notifyBackupReconciliation,
  recordVerifiedRemoteRevision,
  setAutomaticBackupPostHandler,
  setBackupLocalEvidenceProvider,
  captureBackupWriteIntent,
  isCapturedBackupWriteIntent,
  withBackupSession,
} from './transport';

export type AutomaticBackupMutation = {
  operation:
    | 'updateAppImage'
    | 'migrateXfps'
    | 'deleteAppImageEntity'
    | 'deleteVaults'
    | 'updateVaultImage'
    | 'modifyLabels'
    | 'deleteBackup';
  body: any;
};
type Capture = ReturnType<typeof captureLocalRecovery>;
export type BackupLocalOperation = Readonly<{
  appId: string;
  accountSession: number;
  consentEpoch: number;
  database: any;
  generation: number;
  before: Capture;
  origin?: BackupWriteIntent;
  fresh: boolean;
}>;
export type BackupLocalCommit = Readonly<{ committed: boolean; intent?: BackupWriteIntent }>;
type Proof = {
  operation: BackupLocalOperation;
  after: Capture;
  generation: number;
  deletion?: boolean;
  deadline?: number;
};
const proofs = new WeakMap<BackupWriteIntent, Proof>();
const operations = new WeakSet<BackupLocalOperation>();
const managedCommits = new WeakSet<BackupLocalOperation>();
const results = new WeakMap<object, { proof: Proof; session: number; appId: string }>();
const generations = new Map<string, { generation: number; fingerprint: string }>();
let sequence = 0;
// The genuine Realm/transactional Relay matrix permits development loopback
// validation. Hosted writes remain fenced until the separate fleet rollout,
// old-writer drainage and operator evidence have been reviewed and approved.
export const AUTOMATIC_BACKUP_SOURCE_READY = true;
export const AUTOMATIC_BACKUP_RELAY_ROLLOUT_READY = false;
let commitVerification: (appId: string, deleted: boolean, consentEpoch: number) => boolean = () =>
  false;
export const setAutomaticBackupVerificationCommit = (commit: typeof commitVerification) => {
  commitVerification = commit;
};
const clone = (value: any) => JSON.parse(JSON.stringify(value));
function frozenCopy<T>(value: T): T {
  const copy = clone(value);
  const freeze = (item: any) => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}
export function noteCommittedBackupRecovery(appId: string, fingerprint: string) {
  const prior = generations.get(appId);
  if (prior?.fingerprint === fingerprint) return;
  generations.set(appId, { generation: (prior?.generation || 0) + 1, fingerprint });
}
function local() {
  const database = realmDatabase.getDatabase();
  if (database.isInTransaction)
    throw new Error('Uncommitted Realm state cannot provide backup proof');
  const capture = captureLocalRecovery(database);
  // Covers raw writes and another Realm handle as well as the commit observer.
  noteCommittedBackupRecovery(capture.app.id, capture.fingerprint);
  return { database, capture, generation: generations.get(capture.app.id)!.generation };
}
export function currentCommittedBackupGeneration(appId: string) {
  let state: ReturnType<typeof local>;
  try {
    state = local();
  } catch {
    clearVerifiedRemoteRevision(appId);
    notifyBackupReconciliation(appId);
    throw new Error('Committed recovery account unavailable');
  }
  if (state.capture.app.id !== appId) throw new Error('Backup account changed');
  return state.generation;
}
setBackupLocalEvidenceProvider(() => {
  const state = local();
  return {
    appId: state.capture.app.id,
    generation: state.generation,
    fingerprint: state.capture.fingerprint,
  };
});
export function beginBackupLocalOperation(
  appId: string,
  origin?: BackupWriteIntent,
  originSession = currentBackupAccountSession()
): BackupLocalOperation {
  let state: ReturnType<typeof local>;
  try {
    state = local();
  } catch {
    clearVerifiedRemoteRevision(appId);
    notifyBackupReconciliation(appId);
    throw new Error('Committed recovery account unavailable');
  }
  if (
    state.capture.app.id !== appId ||
    originSession !== currentBackupAccountSession() ||
    !canAccessBackupAccount(appId, true)
  ) {
    clearVerifiedRemoteRevision(appId);
    notifyBackupReconciliation(appId);
    throw new Error('Backup account session changed');
  }
  const operation = Object.freeze({
    appId,
    accountSession: originSession,
    consentEpoch: backupConsentEpoch(appId),
    database: state.database,
    generation: state.generation,
    before: frozenCopy(state.capture),
    origin: origin ? Object.freeze({ ...origin }) : undefined,
    fresh:
      !!origin &&
      isCapturedBackupWriteIntent(origin) &&
      origin.appId === appId &&
      origin.accountSession === originSession &&
      origin.consentEpoch === backupConsentEpoch(appId) &&
      origin.localGeneration === state.generation &&
      origin.localFingerprint === state.capture.fingerprint &&
      origin.baselineEpoch === backupBaselineEpoch(appId),
  });
  operations.add(operation);
  return operation;
}
export function completeBackupLocalOperation(
  op: BackupLocalOperation,
  succeeded: boolean
): BackupLocalCommit {
  operations.delete(op);
  if (!succeeded || !managedCommits.has(op)) {
    clearVerifiedRemoteRevision(op.appId);
    notifyBackupReconciliation(op.appId);
    return Object.freeze({ committed: false });
  }
  const state = local();
  if (
    state.database !== op.database ||
    state.capture.app.id !== op.appId ||
    op.accountSession !== currentBackupAccountSession() ||
    op.consentEpoch !== backupConsentEpoch(op.appId)
  ) {
    clearVerifiedRemoteRevision(op.appId);
    notifyBackupReconciliation(op.appId);
    return Object.freeze({ committed: false });
  }
  const valid =
    managedCommits.has(op) &&
    op.fresh &&
    op.origin?.baselineEpoch === backupBaselineEpoch(op.appId);
  managedCommits.delete(op);
  const intent: BackupWriteIntent | undefined = valid
    ? Object.freeze({
        ...op.origin!,
        localGeneration: state.generation,
        localFingerprint: state.capture.fingerprint,
        operationId: `${op.accountSession}:${++sequence}`,
      })
    : undefined;
  if (intent)
    proofs.set(intent, {
      operation: op,
      after: frozenCopy(state.capture),
      generation: state.generation,
    });
  notifyBackupReconciliation(op.appId);
  return Object.freeze({ committed: true, intent });
}
export function commitBackupLocalOperation(
  op: BackupLocalOperation,
  write: (database: any) => void
): BackupLocalCommit {
  try {
    if (!operations.has(op)) throw new Error('Missing originating recovery operation');
    operations.delete(op);
    if (Object.prototype.toString.call(write) === '[object AsyncFunction]')
      throw new Error('Recovery commit must be synchronous');
    const before = local();
    if (
      before.database !== op.database ||
      before.capture.app.id !== op.appId ||
      op.accountSession !== currentBackupAccountSession() ||
      op.consentEpoch !== backupConsentEpoch(op.appId) ||
      !canAccessBackupAccount(op.appId, true)
    ) {
      clearVerifiedRemoteRevision(op.appId);
      notifyBackupReconciliation(op.appId);
      return Object.freeze({ committed: false });
    }
    // An intervening local change can still be followed by a local-first save;
    // it cannot grant upload authority to this older operation.
    const current =
      before.generation === op.generation && before.capture.fingerprint === op.before.fingerprint;
    realmDatabase.writeTransaction(op.database, () => {
      const result: any = write(op.database);
      if (result?.then) throw new Error('Realm recovery commits must be synchronous');
      if (
        op.accountSession !== currentBackupAccountSession() ||
        op.consentEpoch !== backupConsentEpoch(op.appId) ||
        realmDatabase.getDatabase() !== op.database ||
        op.database.objects(RealmSchema.KeeperApp)[0]?.id !== op.appId ||
        !canAccessBackupAccount(op.appId, true)
      )
        throw new Error('Recovery account changed before local commit');
    });
    const completed = current ? op : Object.freeze({ ...op, fresh: false });
    managedCommits.add(completed);
    return completeBackupLocalOperation(completed, true);
  } catch {
    clearVerifiedRemoteRevision(op.appId);
    notifyBackupReconciliation(op.appId);
    return Object.freeze({ committed: false });
  }
}
function assertProof(intent: BackupWriteIntent, proof: Proof, explicit = false) {
  const state = local();
  if (
    intent.accountSession !== currentBackupAccountSession() ||
    intent.consentEpoch !== backupConsentEpoch(intent.appId) ||
    state.database !== proof.operation.database ||
    state.capture.app.id !== intent.appId ||
    !canAccessBackupAccount(intent.appId, explicit) ||
    state.generation !== proof.generation ||
    state.capture.fingerprint !== proof.after.fingerprint ||
    backupBaselineEpoch(intent.appId) !== intent.baselineEpoch
  )
    throw new Error('Committed backup source changed');
  return state;
}
export function isBackupVerificationCurrent(appId: string) {
  try {
    const intent = captureBackupWriteIntent(appId);
    const state = local();
    return (
      !!intent &&
      intent.accountSession === currentBackupAccountSession() &&
      intent.localGeneration === state.generation &&
      intent.localFingerprint === state.capture.fingerprint
    );
  } catch {
    return false;
  }
}
export function isAutomaticBackupResultCurrent(result: object, appId: string) {
  const evidence = results.get(result);
  if (!evidence || evidence.appId !== appId || evidence.session !== currentBackupAccountSession())
    return false;
  try {
    const state = local();
    return (
      state.database === evidence.proof.operation.database &&
      evidence.proof.operation.consentEpoch === backupConsentEpoch(appId) &&
      state.capture.app.id === appId &&
      state.generation === evidence.proof.generation &&
      state.capture.fingerprint === evidence.proof.after.fingerprint
    );
  } catch {
    return false;
  }
}
async function snapshot(appId: string, app: any, deadline?: number, checkpoint = () => {}) {
  const result = await readProtectedBackup(app.primaryMnemonic, deadline, appId, checkpoint, app);
  if (result.state === 'neverEnrolled') throw new Error('Protected backup is not enrolled');
  return result.snapshot;
}

const same = (kind: keyof BackupImage, a: any, b: any) =>
  !!a && !!b && canonical(recoveryContent(kind, a)) === canonical(recoveryContent(kind, b));
async function project(
  mutations: AutomaticBackupMutation[],
  proof: Proof,
  response: any
): Promise<BackupImage> {
  const { appId } = proof.operation;
  const key = generateEncryptionKey(proof.after.app.primarySeed);
  const remote = await decodeImage(key, response, response.namespaceId, () => {}, true);
  validateProtectedRecoveryMetadata(response, remote, getKeyUID, hash256, key);
  const projected = clone(remote) as BackupImage;
  const touched = new Set<string>();
  const before = proof.operation.before.image;
  const after = proof.after.image;
  const rekeys = mutations
    .filter((mutation) => mutation.operation === 'migrateXfps')
    .flatMap((mutation) => mutation.body.signerChanges || [])
    .map((change) => ({
      old: before.signers[change.oldSignerId]?.masterFingerprint,
      next: after.signers[change.newSignerId]?.masterFingerprint,
    }));
  const beforeRekey = (value: any, field = ''): any => {
    if (Array.isArray(value)) return value.map((entry) => beforeRekey(entry, field));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [
          name,
          beforeRekey(
            item,
            field === 'signerFingerprints'
              ? 'masterFingerprint'
              : field === 'keyInfoMap'
              ? 'descriptor'
              : name
          ),
        ])
      );
    if (typeof value !== 'string') return value;
    return rekeys.reduce((text, pair) => {
      if (!/^[a-f0-9]{8}$/i.test(pair.old || '') || !/^[a-f0-9]{8}$/i.test(pair.next || ''))
        return text;
      if (field === 'masterFingerprint' && text.toUpperCase() === pair.next.toUpperCase())
        return pair.old;
      // Only the fingerprint component of a bracketed descriptor origin may
      // change. Public/private keys, compiled policy, scripts and object keys
      // remain byte-for-byte immutable even during a fingerprint correction.
      if (/descriptor/i.test(field))
        return text.replace(new RegExp(`\\[${pair.next}(?=/|\\])`, 'gi'), `[${pair.old}`);
      return text;
    }, value);
  };
  const put = async (kind: keyof BackupImage, id: string, encrypted: any) => {
    const record = await decryptRecord(key, encrypted);
    if (!same(kind, record, after[kind][id]))
      throw new Error('Ciphertext does not match committed recovery');
    if (['wallets', 'signers', 'vaults'].includes(kind) && projected[kind][id]) {
      const empty = () =>
        ({ wallets: {}, signers: {}, vaults: {}, nodes: {}, labels: {} } as BackupImage);
      const incoming = empty();
      const existing = empty();
      incoming[kind][id] = kind === 'vaults' ? beforeRekey(record) : record;
      existing[kind][id] = projected[kind][id];
      if ((await compareImages(incoming, existing)) === 'conflict')
        throw new Error('Immutable recovery identity or counters changed');
    }
    if (
      !touched.has(`${kind}:${id}`) &&
      projected[kind][id] &&
      !same(kind, projected[kind][id], before[kind][id])
    )
      throw new Error('Remote recovery changed');
    touched.add(`${kind}:${id}`);
    projected[kind][id] = record;
    return record;
  };
  const remove = (kind: keyof BackupImage, id: string) => {
    if (
      after[kind][id] ||
      !projected[kind][id] ||
      (!touched.has(`${kind}:${id}`) && !same(kind, projected[kind][id], before[kind][id]))
    )
      throw new Error('Deletion does not match committed recovery');
    touched.add(`${kind}:${id}`);
    delete projected[kind][id];
  };
  for (const { operation, body } of mutations) {
    if ((body.appId || body.appID) !== appId || (body.appID && body.appID !== appId))
      throw new Error('Backup account changed');
    if (operation === 'updateAppImage') {
      if ((body.walletObject && body.walletsObject) || (body.signersObjects && body.signersObject))
        throw new Error('Ambiguous backup fields');
      for (const [id, value] of Object.entries(body.walletsObject || body.walletObject || {}))
        await put('wallets', id, value);
      for (const [id, value] of Object.entries(body.signersObject || body.signersObjects || {}))
        await put('signers', id, value);
      for (const field of ['publicId', 'version', 'subscription', 'networkType'])
        if (
          body[field] !== undefined &&
          canonical(field === 'subscription' ? JSON.parse(body[field]) : body[field]) !==
            canonical(proof.after.app[field])
        )
          throw new Error('Backup metadata is stale');
      if (body.nodes?.length || body.replaceNodes) {
        if (!Array.isArray(body.nodes) || !sameNodes(remote.nodes, before.nodes))
          throw new Error('Remote nodes changed');
        projected.nodes = {};
        for (const value of body.nodes) {
          const record = await decryptRecord(key, value);
          const id = record.id || canonical(recoveryContent('nodes', record));
          if (projected.nodes[id] || !same('nodes', record, after.nodes[id]))
            throw new Error('Stale node ciphertext');
          projected.nodes[id] = record;
        }
        if (!sameNodes(projected.nodes, after.nodes)) throw new Error('Incomplete nodes');
      }
    } else if (operation === 'migrateXfps') {
      for (const change of body.signerChanges || []) {
        const old = projected.signers[change.oldSignerId];
        const record = await put('signers', change.newSignerId, change.newSignerDetails);
        if (!old || getKeyUID(record) !== change.newSignerId)
          throw new Error('Invalid signer migration');
        const xpubs = (signer: any) =>
          canonical(
            Object.values(signer.signerXpubs || {})
              .flat()
              .map((item: any) => item.xpub)
              .sort()
          );
        if (xpubs(old) !== xpubs(record)) throw new Error('Signer migration changes keys');
        const prior = clone(old);
        prior.masterFingerprint = record.masterFingerprint;
        const oldImage: BackupImage = {
          wallets: {},
          signers: { [change.newSignerId]: prior },
          vaults: {},
          nodes: {},
          labels: {},
        };
        const newImage: BackupImage = { ...oldImage, signers: { [change.newSignerId]: record } };
        if ((await compareImages(newImage, oldImage)) === 'conflict')
          throw new Error('Signer migration changes recovery identity');
        if (
          Object.values(projected.vaults).some((vault: any) =>
            vault.signers?.some((signer: any) => getKeyUID(signer) === change.oldSignerId)
          )
        )
          throw new Error('Signer migration would strand a vault');
        remove('signers', change.oldSignerId);
      }
    } else if (operation === 'deleteAppImageEntity') {
      for (const id of body.walletIds || []) remove('wallets', id);
      for (const id of body.signers || []) {
        if (
          Object.values(projected.vaults).some((vault: any) =>
            vault.signers?.some((signer: any) => getKeyUID(signer) === id)
          )
        )
          throw new Error('Signer deletion would strand a vault');
        remove('signers', id);
      }
    } else if (operation === 'deleteVaults') {
      for (const id of body.vaults || []) remove('vaults', id);
    } else if (operation === 'updateVaultImage') {
      const vault = await put('vaults', body.vaultId, body.vault);
      if (
        !!body.isArchived !== !!vault.archived ||
        (body.scheme && canonical(body.scheme) !== canonical(vault.scheme)) ||
        canonical(body.signersData) !==
          canonical(
            vault.signers.map((signer: any) => ({
              signerId: getKeyUID(signer),
              xfpHash: hash256(signer.masterFingerprint),
            }))
          )
      )
        throw new Error('Vault references differ from committed recovery');
      if (
        body.archiveVaultId &&
        (!after.vaults[body.archiveVaultId]?.archived ||
          !same('vaults', projected.vaults[body.archiveVaultId], after.vaults[body.archiveVaultId]))
      )
        throw new Error('Archive ciphertext must be committed and updated before replacement');
    } else if (operation === 'modifyLabels') {
      const hash = (id: string) => hash256(hash256(key + id));
      const added = new Set<string>();
      for (const value of body.addLabels || []) {
        const record = await decryptRecord(key, value.content);
        if (hash(record.id) !== value.id || added.has(value.id))
          throw new Error('Invalid label identity');
        added.add(value.id);
        await put('labels', record.id, value.content);
      }
      for (const id of body.deleteLabels || []) {
        if (added.has(id)) throw new Error('Overlapping label mutation');
        const plainId = Object.keys(projected.labels).find((candidate) => hash(candidate) === id);
        if (!plainId) throw new Error('Unknown label deletion');
        remove('labels', plainId);
      }
    } else throw new Error('Explicit deletion proof required');
  }
  // Each touched ciphertext is local-current. Unaffected remote-only material
  // is retained and makes the complete final check pending rather than Verified.
  return projected;
}
function sameNodes(a: any, b: any) {
  return (
    canonical(
      Object.fromEntries(
        Object.entries(a).map(([id, record]) => [id, recoveryContent('nodes', record)])
      )
    ) ===
    canonical(
      Object.fromEntries(
        Object.entries(b).map(([id, record]) => [id, recoveryContent('nodes', record)])
      )
    )
  );
}
const pending = (committed: boolean, updated = false) => ({
  updated,
  backupConfirmed: false,
  backupPending: true,
  localCommitted: committed,
});
export function enqueueAutomaticBackupOperation(
  receipt: BackupLocalCommit | BackupWriteIntent | undefined,
  input: AutomaticBackupMutation[]
) {
  const intent = receipt && ('committed' in receipt ? receipt.intent : receipt);
  const committed = !!receipt && (!('committed' in receipt) || receipt.committed);
  const proof = intent && proofs.get(intent);
  let mutations: AutomaticBackupMutation[];
  try {
    mutations = frozenCopy(input);
  } catch {
    if (intent?.appId) {
      clearVerifiedRemoteRevision(intent.appId);
      notifyBackupReconciliation(intent.appId);
    }
    return Promise.resolve(pending(committed));
  }
  const appId = intent?.appId || input[0]?.body?.appId || input[0]?.body?.appID;
  if (!appId) return Promise.resolve(pending(committed));
  markBackupQueuedMutation(appId);
  notifyBackupReconciliation(appId);
  return withBackupSession(appId, async () => {
    let acknowledged = 0;
    const deadline = proof?.deadline ?? Date.now() + BACKUP_DEADLINE_MS;
    const assertOwned = () => {
      if (!intent || !proof || Date.now() >= deadline)
        throw new Error('Backup proof deadline expired');
      return assertProof(intent, proof, !!proof.deletion);
    };
    try {
      if (!intent || !proof || !mutations.length || proofs.get(intent) !== proof)
        throw new Error('Missing committed operation proof');
      if (
        mutations.some(
          ({ body }) =>
            !body ||
            (body.appId || body.appID) !== appId ||
            (body.appId !== undefined && body.appId !== appId) ||
            (body.appID !== undefined && body.appID !== appId)
        )
      )
        throw new Error('Backup mutation account does not match originating proof');
      const loopbackFixture = typeof process !== 'undefined' &&
        (process.env?.KEEPER_RELAY_FIXTURE_MODULE || process.env?.KEEPER_PROTECTED_RELAY_CHECKOUT) &&
        /^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(config.RELAY);
      const nativeLoopback = config.ENVIRONMENT === 'DEVELOPMENT' && config.isDevMode() &&
        /^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/.test(config.RELAY);
      if ((!AUTOMATIC_BACKUP_SOURCE_READY && !loopbackFixture) ||
        (!AUTOMATIC_BACKUP_RELAY_ROLLOUT_READY && !loopbackFixture &&
          !(AUTOMATIC_BACKUP_SOURCE_READY && nativeLoopback)))
        throw new Error('Automatic backup source or rollout is not enabled');
      assertProtectedBackupWriteReady();
      assertOwned();
      const baseline = await snapshot(appId, proof.after.app, deadline, assertOwned);
      assertOwned();
      if (intent.baseRevision !== intent.protectedBase?.revision ||
        !sameProtectedBackupBase(protectedBackupBase(baseline), intent.protectedBase))
        throw new Error('Remote authority changed');
      if (proof.deletion) {
        if (mutations.length !== 1 || mutations[0].operation !== 'deleteBackup')
          throw new Error('Invalid explicit deletion');
        await decodeImage(
          generateEncryptionKey(proof.after.app.primarySeed),
          baseline,
          intent.protectedBase.namespaceId,
          () => {},
          true
        );
      } else await project(mutations, proof, baseline);
      assertOwned();
      // One immutable receipt is single-use even if the response is lost.
      proofs.delete(intent);
      let expectedBase = intent.protectedBase;
      for (const mutation of mutations) {
        assertOwned();
        const reply = await protectedBackupMutation(proof.after.app.primaryMnemonic,
          expectedBase, mutation.operation, mutation.body, deadline, assertOwned, proof.after.app);
        expectedBase = reply.base;
        acknowledged += 1;
      }
      assertOwned();
      const readback = await snapshot(appId, proof.after.app, deadline, assertOwned);
      assertOwned();
      if (!sameProtectedBackupBase(protectedBackupBase(readback), expectedBase))
        throw new Error('Final backup authority changed');
      if (proof.deletion) {
        const remaining = await decodeImage(
          generateEncryptionKey(proof.after.app.primarySeed),
          readback,
          expectedBase.namespaceId,
          () => {},
          true
        );
        if (!readback.deleted || !readback.suppressLegacyFallback ||
          Object.values(remaining).some((records) => Object.keys(records).length))
          throw new Error('Backup deletion is incomplete');
      } else {
        if (!backupMetadataMatches(proof.after.app, readback.appImage, expectedBase.namespaceId))
          throw new Error('Backup metadata readback differs');
        const remote = await decodeImage(
          generateEncryptionKey(proof.after.app.primarySeed),
          readback,
          expectedBase.namespaceId,
          assertOwned,
          true
        );
        validateProtectedRecoveryMetadata(readback, remote, getKeyUID, hash256, generateEncryptionKey(proof.after.app.primarySeed));
        if ((await compareImages(proof.after.image, remote, assertOwned)) !== 'matched')
          throw new Error('Complete backup readback differs');
      }
      assertOwned();
      recordVerifiedRemoteRevision(appId, expectedBase.revision, intent.accountSession, expectedBase);
      if (!commitVerification(appId, !!proof.deletion, proof.operation.consentEpoch))
        throw new Error('Backup changed during final commit');
      const result = Object.freeze({
        updated: true,
        backupConfirmed: true,
        backupPending: false,
        localCommitted: committed,
      });
      results.set(result, { proof, session: intent.accountSession, appId });
      if (proof.deletion) clearVerifiedRemoteRevision(appId);
      return result;
    } catch {
      clearVerifiedRemoteRevision(appId);
      notifyBackupReconciliation(appId);
      return pending(committed, acknowledged === mutations.length && acknowledged > 0);
    }
  });
}
export async function beginBackupDeleteOperation(
  appId: string,
  originSession = currentBackupAccountSession()
): Promise<BackupLocalCommit> {
  try {
    const op = beginBackupLocalOperation(appId, undefined, originSession);
    assertProtectedBackupWriteReady();
    const deadline = Date.now() + BACKUP_DEADLINE_MS;
    const assertOrigin = () => {
      const state = local();
      if (Date.now() >= deadline || originSession !== currentBackupAccountSession() ||
        op.consentEpoch !== backupConsentEpoch(appId) || state.database !== op.database ||
        state.generation !== op.generation || state.capture.fingerprint !== op.before.fingerprint ||
        !canAccessBackupAccount(appId, true)) throw new Error('Deletion source changed');
    };
    const remote = await withBackupSession(appId, () =>
      snapshot(appId, op.before.app, deadline, assertOrigin));
    const state = local();
    if (
      op.accountSession !== currentBackupAccountSession() ||
      op.consentEpoch !== backupConsentEpoch(appId) ||
      state.database !== op.database ||
      state.generation !== op.generation ||
      state.capture.fingerprint !== op.before.fingerprint ||
      !canAccessBackupAccount(appId, true)
    )
      throw new Error('Deletion scope changed');
    await decodeImage(
      generateEncryptionKey(op.before.app.primarySeed),
      remote,
      remote.namespaceId,
      () => {},
      true
    );
    const current = local();
    if (
      originSession !== currentBackupAccountSession() ||
      op.consentEpoch !== backupConsentEpoch(appId) ||
      current.database !== op.database ||
      current.generation !== state.generation ||
      current.capture.fingerprint !== state.capture.fingerprint
    )
      throw new Error('Deletion scope changed during snapshot validation');
    const intent: BackupWriteIntent = Object.freeze({
      appId,
      accountSession: op.accountSession,
      baseRevision: remote.revision,
      protectedBase: protectedBackupBase(remote),
      baselineEpoch: backupBaselineEpoch(appId),
      localGeneration: state.generation,
      localFingerprint: state.capture.fingerprint,
      operationId: `${op.accountSession}:delete:${++sequence}`,
      consentEpoch: op.consentEpoch,
    });
    proofs.set(intent, {
      operation: op,
      after: frozenCopy(state.capture),
      generation: state.generation,
      deletion: true,
      deadline,
    });
    return Object.freeze({ committed: true, intent });
  } catch {
    clearVerifiedRemoteRevision(appId);
    notifyBackupReconciliation(appId);
    return Object.freeze({ committed: false });
  }
}
setAutomaticBackupPostHandler(async (path, body, _explicit, intent) => {
  const operation = path.split('/').pop() as AutomaticBackupMutation['operation'];
  if (!['updateAppImage', 'migrateXfps', 'deleteAppImageEntity', 'deleteVaults',
    'updateVaultImage', 'modifyLabels', 'deleteBackup'].includes(operation))
    throw new Error('Unsupported backup writer');
  const data = await enqueueAutomaticBackupOperation(intent, [{ operation, body }]);
  return { data };
});
