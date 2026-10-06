import RestClient from '../rest/RestClient';

// One queue per account covers repair, incremental writes, labels and deletion.
const queues = new Map<string, Promise<unknown>>();
const revisions = new Map<string, number>();
const queuedMutationRevisions = new Map<string, number>();
export const backupRevision = (id: string) => revisions.get(id) || 0;
export const backupQueuedRevision = (id: string) => queuedMutationRevisions.get(id) || 0;
export const markBackupMutation = (id: string) => revisions.set(id, backupRevision(id) + 1);
export const BACKUP_STALL_MS = 30_000;
export const BACKUP_DEADLINE_MS = 10 * 60_000;

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
  body: object,
  deadline = Date.now() + BACKUP_DEADLINE_MS
) {
  const controller = new AbortController();
  let idle: ReturnType<typeof setTimeout>;
  let uploaded = 0;
  let downloaded = 0;
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(), BACKUP_STALL_MS);
  };
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Backup deadline exceeded');
  const total = setTimeout(() => controller.abort(), remaining);
  resetIdle();
  try {
    return await RestClient.post(path, body, undefined, {
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
  } catch {
    // Do not propagate Axios errors: they can contain request bodies and headers.
    throw new Error('Backup request could not be completed');
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
  }
}

export function backupPost(path: string, body: any) {
  const appId = body.appId || body.appID;
  if (!appId) return Promise.reject(new Error('Missing backup account'));
  markBackupMutation(appId);
  const result = withBackupSession(appId, () => boundedBackupPost(path, body));
  queuedMutationRevisions.set(appId, backupRevision(appId));
  return result;
}
