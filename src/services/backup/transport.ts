import RestClient from '../rest/RestClient';
import type { BackupWriteIntent } from './intent';
import type { ProtectedBackupBase } from './protected';

// One queue per account covers repair, incremental writes, labels and deletion.
const queues = new Map<string, Promise<unknown>>();
const revisions = new Map<string, number>();
const queuedMutationRevisions = new Map<string, number>();
const verifiedRemoteRevisions = new Map<
  string,
  { revision: string; session: number; epoch: number; protectedBase?: ProtectedBackupBase; evidence?: LocalEvidence }
>();
const baselineEpochs = new Map<string, number>();
const capturedIntents = new WeakSet<BackupWriteIntent>();
const consentEpochs = new Map<string, number>();
const consentCompletions = new WeakMap<object, { appId: string; epoch: number }>();
const recoveryDisables = new WeakMap<object, { appId: string; session: number }>();
// Only a validated restore may revoke saved consent for a not-yet-selected
// target. The ordinary UI/account guard still rejects unbranded actions.
export function protectBackupRecoveryConsentDisable<T extends object>(action: T, appId: string, session: number): T {
  recoveryDisables.set(action, {appId, session});
  return action;
}
export function takeBackupRecoveryConsentDisable(action: any, appId: string): boolean {
  const scope = recoveryDisables.get(action);
  recoveryDisables.delete(action);
  return !!scope && scope.appId === appId && scope.session === currentBackupAccountSession() &&
    action.type === 'bhr/setAutomaticCloudBackup' && action.payload?.appId === appId &&
    action.payload.enabled === false;
}

export const backupConsentEpoch = (appId: string) => consentEpochs.get(appId) || 0;
export function protectBackupConsentCompletion<T extends object>(
  action: T,
  appId: string,
  epoch: number
): T {
  consentCompletions.set(action, { appId, epoch });
  return action;
}
export function observeBackupConsentAction(action: any, appId: string): boolean {
  const completion = consentCompletions.get(action);
  if (completion) {
    consentCompletions.delete(action);
    return completion.appId === appId && completion.epoch === backupConsentEpoch(appId);
  }
  consentEpochs.set(appId, backupConsentEpoch(appId) + 1);
  return true;
}
export const isCapturedBackupWriteIntent = (intent: BackupWriteIntent) =>
  capturedIntents.has(intent);
type LocalEvidence = { appId: string; generation: number; fingerprint: string };
let localEvidence: (() => LocalEvidence) | undefined;
let automaticPost:
  | ((
      path: string,
      body: any,
      explicitChoice: boolean,
      intent?: BackupWriteIntent
    ) => Promise<{ data: any }>)
  | undefined;
export const setBackupLocalEvidenceProvider = (provider: () => LocalEvidence) => {
  localEvidence = provider;
};
export const setAutomaticBackupPostHandler = (handler: typeof automaticPost) => {
  automaticPost = handler;
};
export const backupBaselineEpoch = (appId: string) => baselineEpochs.get(appId) || 0;
export const notifyBackupReconciliation = (appId: string) => onBackupReconciliationRequired(appId);
export const markBackupQueuedMutation = (id: string) => {
  markBackupMutation(id);
  queuedMutationRevisions.set(id, backupRevision(id));
};
let activeAccount: string | undefined;
let accountSession = 0;
let mayUploadForAccount: (appId: string, explicitChoice: boolean) => boolean = () => false;
let onBackupReconciliationRequired: (appId: string) => void = () => undefined;
export const setBackupUploadGuard = (
  guard: (appId: string, explicitChoice: boolean) => boolean
) => {
  mayUploadForAccount = guard;
};
// A failed or ambiguous write requires a fresh backup check. The encrypted
// payload must never be retried without re-reading local state.
export const setBackupReconciliationHandler = (handler: (appId: string) => void) => {
  onBackupReconciliationRequired = handler;
};
export const canAccessBackupAccount = (appId: string, explicitChoice = false) =>
  mayUploadForAccount(appId, explicitChoice);
// An A -> B -> A switch must invalidate work captured during the first A session.
// The Redux store observes every selected-account transition, including resets.
export function observeBackupAccount(appId?: string) {
  if (appId !== activeAccount) {
    for (const id of verifiedRemoteRevisions.keys()) clearVerifiedRemoteRevision(id);
    activeAccount = appId;
    accountSession += 1;
  }
}
export const currentBackupAccountSession = () => accountSession;
export const backupRevision = (id: string) => revisions.get(id) || 0;
export const backupQueuedRevision = (id: string) => queuedMutationRevisions.get(id) || 0;
export function clearVerifiedRemoteRevision(appId: string) {
  verifiedRemoteRevisions.delete(appId);
  baselineEpochs.set(appId, (baselineEpochs.get(appId) || 0) + 1);
}
export function recordVerifiedRemoteRevision(
  appId: string, revision: string, session: number, protectedBase?: ProtectedBackupBase
) {
  if (!/^[a-f0-9]{64}$/.test(revision) || session !== accountSession || appId !== activeAccount)
    return;
  clearVerifiedRemoteRevision(appId);
  verifiedRemoteRevisions.set(appId, {
    revision,
    session,
    epoch: baselineEpochs.get(appId) || 0,
    protectedBase: protectedBase ? Object.freeze({ ...protectedBase }) : undefined,
    evidence: localEvidence?.(),
  });
}
export function captureBackupWriteIntent(appId: string): BackupWriteIntent | undefined {
  const verified = verifiedRemoteRevisions.get(appId);
  if (!verified?.protectedBase || appId !== activeAccount || verified.session !== accountSession)
    return undefined;
  let evidence: LocalEvidence | undefined;
  try {
    evidence = localEvidence?.();
  } catch {
    return undefined;
  }
  if (localEvidence && evidence?.appId !== appId) return undefined;
  const intent = Object.freeze({
    appId,
    accountSession: verified.session,
    baseRevision: verified.revision,
    protectedBase: verified.protectedBase,
    baselineEpoch: verified.epoch,
    localGeneration: verified.evidence?.generation,
    localFingerprint: verified.evidence?.fingerprint,
    consentEpoch: backupConsentEpoch(appId),
  });
  capturedIntents.add(intent);
  return intent;
}
export const markBackupMutation = (id: string) => {
  revisions.set(id, backupRevision(id) + 1);
};
export const BACKUP_STALL_MS = 30_000;
export const BACKUP_DEADLINE_MS = 10 * 60_000;

export type BackupRequestFailure =
  | 'conflict'
  | 'protocol'
  | 'http-4xx'
  | 'http-5xx'
  | 'timeout'
  | 'network'
  | 'other';

export class BackupRequestError extends Error {
  constructor(public readonly category: BackupRequestFailure) {
    super('Backup request could not be completed');
  }
}

function requestFailureCategory(error: unknown, aborted: boolean): BackupRequestFailure {
  if (aborted) return 'timeout';
  if (!error || typeof error !== 'object') return 'other';
  const failure = error as {
    response?: { status?: unknown };
    status?: unknown;
    code?: unknown;
    name?: unknown;
    message?: unknown;
  };
  const status = failure.response?.status ?? failure.status;
  if (typeof status === 'number') {
    if (status === 409) return 'conflict';
    if (status >= 400 && status < 500) return 'http-4xx';
    if (status >= 500 && status < 600) return 'http-5xx';
    return 'other';
  }
  if (
    failure.code === 'ECONNABORTED' ||
    failure.code === 'ETIMEDOUT' ||
    failure.name === 'AbortError'
  )
    return 'timeout';
  if (failure.code === 'ERR_NETWORK' || failure.message === 'Network Error') return 'network';
  return 'other';
}

export function withBackupSession<T>(id: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(id) || Promise.resolve();
  const result = previous.catch(() => undefined).then(work);
  queues.set(id, result);
  const clean = () => {
    if (queues.get(id) === result) queues.delete(id);
  };
  result.then(clean, clean);
  return result;
}

// Abort the actual transport, not just the saga waiting on it. A stalled upload
// has an unknown outcome; callers must read back before deciding to upload again.
export async function boundedBackupPost(
  path: string,
  body: object | string,
  deadline?: number,
  signedHeaders?: Record<string, string>
) {
  const controller = new AbortController();
  let idle: ReturnType<typeof setTimeout>;
  let uploaded = 0;
  let downloaded = 0;
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), BACKUP_STALL_MS);
  };
  const remaining = (deadline ?? Date.now() + BACKUP_DEADLINE_MS) - Date.now();
  if (remaining <= 0) throw new BackupRequestError('timeout');
  const total = setTimeout(() => controller.abort(), remaining);
  resetIdle();
  try {
    return await RestClient.post(path, body as object, signedHeaders, {
      ...(typeof body === 'string' ? { transformRequest: [(data: string) => data], maxRedirects: 0 } : {}),
      signal: controller.signal,
      onUploadProgress: ({ loaded }) => {
        if (loaded > uploaded) {
          uploaded = loaded;
          resetIdle();
        }
      },
      onDownloadProgress: ({ loaded }) => {
        if (loaded > downloaded) {
          downloaded = loaded;
          resetIdle();
        }
      },
    });
  } catch (error) {
    // Do not propagate Axios errors: they can contain request bodies and headers.
    throw new BackupRequestError(requestFailureCategory(error, controller.signal.aborted));
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
  }
}

export function backupPost(
  _path: string,
  body: any,
  explicitChoice?: boolean,
  intent?: BackupWriteIntent
): Promise<{ data: any; json?: any }> {
  const appId = body.appId || body.appID;
  if (!appId) return Promise.reject(new Error('Missing backup account'));
  if (automaticPost) return automaticPost(_path, body, explicitChoice === true, intent);
  // Every attempted incremental write invalidates an outstanding inspection
  // and leaves a visible pending state, including pre-send session/guard
  // failures from direct hooks and upgrade workers.
  markBackupMutation(appId);
  clearVerifiedRemoteRevision(appId);
  onBackupReconciliationRequired(appId);
  if (intent && (intent.appId !== appId || intent.accountSession !== currentBackupAccountSession()))
    return Promise.reject(new Error('Backup account session changed'));
  if (!canAccessBackupAccount(appId, explicitChoice))
    return Promise.reject(new Error('Backup account is not active or opted in'));
  // The encrypted payload may have been prepared before a newer local change
  // or an explicit repair. No revision captured here can prove that payload's
  // freshness. Keep local data and require a new read-only check or explicit
  // repair until the source intent is versioned end to end.
  return Promise.reject(new BackupRequestError('protocol'));
}
