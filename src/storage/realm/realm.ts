import Realm from 'realm';
import { captureError } from 'src/services/sentry';
import { captureLocalRecovery } from 'src/services/backup/localSnapshot';
import { RealmSchema } from './enum';
import schema from './schema';
import { runRealmMigrations } from './migrations';

export const REALM_FILE = 'keeper.realm';
export type RecoveryCommitObserver = (appId: string, fingerprint: string) => void;
type TransactionState = { failed: boolean; error?: unknown };

function captureRecovery(database: Realm) {
  try {
    return captureLocalRecovery(database);
  } catch {
    // Initial account setup may not yet have a recoverable KeeperApp. An
    // unreadable/partial image cannot supply a committed generation proof.
    return undefined;
  }
}

export class RealmDatabase {
  private realm: Realm;

  private transactions = new WeakMap<Realm, TransactionState>();

  private recoveryCommitObserver: RecoveryCommitObserver | undefined;

  public setRecoveryCommitObserver = (observer: RecoveryCommitObserver) => {
    this.recoveryCommitObserver = observer;
  };

  private openGeneration = 0;

  private pendingOpenGeneration: number | null = null;

  private staleOpenedRealms = new Set<Realm>();

  public static file = REALM_FILE;

  public static schemaVersion = 109;

  private releaseStaleOpenResults = () => {
    // A later open of the same path may receive the same native Realm handle.
    // Wait for the latest open to settle before closing an older result.
    if (this.pendingOpenGeneration !== null) return;
    for (const opened of this.staleOpenedRealms) {
      if (opened !== this.realm && !opened.isClosed) opened.close();
    }
    this.staleOpenedRealms.clear();
  };

  /**
   * initializes/opens realm w/ appropriate configuration
   * @param  {ArrayBuffer|ArrayBufferView|Int8Array} key
   * @returns Promise
   */
  public initializeDatabase = async (
    key: ArrayBuffer | ArrayBufferView | Int8Array,
    path: string
  ): Promise<{ success: boolean; error?: string }> => {
    const generation = ++this.openGeneration;
    this.pendingOpenGeneration = generation;
    const requestedPath = path || RealmDatabase.file;
    const realmConfig: Realm.Configuration = {
      path: requestedPath,
      schema,
      schemaVersion: RealmDatabase.schemaVersion,
      encryptionKey: key,
      onMigration: (oldRealm, newRealm) => {
        runRealmMigrations({ oldRealm, newRealm });
      },
    };
    let opened: Realm;
    try {
      opened = await Realm.open(realmConfig);
    } catch (err) {
      if (generation !== this.openGeneration)
        return { success: false, error: 'Account changed during database initialization' };
      this.pendingOpenGeneration = null;
      this.releaseStaleOpenResults();
      console.log('🚀 ~ RealmDatabase ~ err:', err);
      captureError(err);
      return { success: false, error: err.toString() };
    }

    if (generation !== this.openGeneration) {
      this.staleOpenedRealms.add(opened);
      this.releaseStaleOpenResults();
      return { success: false, error: 'Account changed during database initialization' };
    }

    const previous = this.realm;
    this.realm = opened;
    RealmDatabase.file = requestedPath;
    this.pendingOpenGeneration = null;
    if (previous && previous !== opened && !previous.isClosed) previous.close();
    this.releaseStaleOpenResults();
    return { success: true };
  };

  /**
   * fetches the current instance of the database
   */
  public getDatabase = (): Realm => {
    if (this.realm) return this.realm;
    throw new Error('database not initialized');
  };

  /**
   * deletes instance of the database
   */
  public deleteDatabase = (key: ArrayBuffer | ArrayBufferView | Int8Array): boolean => {
    this.openGeneration += 1;
    this.pendingOpenGeneration = null;
    const existingSchemaVersion = this.realm
      ? this.realm.schemaVersion
      : RealmDatabase.schemaVersion;
    if (this.realm && !this.realm.isClosed) this.realm.close();
    this.realm = null;
    this.releaseStaleOpenResults();

    const realmConfig: Realm.Configuration = {
      path: RealmDatabase.file,
      schema,
      schemaVersion: existingSchemaVersion,
      encryptionKey: key,
    };
    Realm.deleteFile(realmConfig);
    return true;
  };

  /**
   * function that modifies objects in a realm(aka write transaction)
   * Write transactions let you create, modify, or delete Realm objects.
   * It handles operations in a single, idempotent update. A write transaction is all or nothing
   * @param  {} callback
   */
  public writeTransaction = <T>(database: Realm, callback: () => T): T => {
    const execute = () => {
      // Reject native async callbacks before their first side effect. Other
      // thenable-returning callbacks are rejected inside the transaction.
      if (Object.prototype.toString.call(callback) === '[object AsyncFunction]')
        throw new Error('Realm transaction callbacks must be synchronous');
      const result = callback();
      if (
        result !== null &&
        (typeof result === 'object' || typeof result === 'function') &&
        typeof (result as { then?: unknown }).then === 'function'
      ) throw new Error('Realm transaction callbacks must be synchronous');
      return result;
    };
    const outer = this.transactions.get(database);
    if (outer) {
      try {
        return execute();
      } catch (error) {
        // Even if a nested helper converts this exception to false, the outer
        // transaction must roll back every preceding write in the group.
        outer.failed = true;
        outer.error = error;
        throw error;
      }
    }
    if (database.isInTransaction)
      throw new Error('Recovery writes require a managed outer Realm transaction');

    const before = captureRecovery(database);
    const transaction: TransactionState = { failed: false };
    this.transactions.set(database, transaction);
    let result: T;
    try {
      result = database.write(() => {
        const value = execute();
        if (transaction.failed) throw transaction.error;
        return value;
      });
    } finally {
      this.transactions.delete(database);
    }

    // Realm.write has returned: the native transaction successfully committed.
    // Cache/history-only changes compare equal and do not advance generation.
    const after = captureRecovery(database);
    if (after && before?.fingerprint !== after.fingerprint) {
      try {
        this.recoveryCommitObserver?.(after.app.id, after.fingerprint);
      } catch {
        // A notification failure cannot turn a successful local save into a
        // reported failed transaction. No private snapshot is sent to Sentry.
        captureError(new Error('Recovery commit observer unavailable'));
      }
    }
    return result;
  };

  /**
   * close the database when done with a realm instance to avoid memory leaks.
   */
  public closeDatabase = () => {
    this.openGeneration += 1;
    this.pendingOpenGeneration = null;
    if (this.realm && !this.realm.isClosed) this.realm.close();
    this.realm = null;
    this.releaseStaleOpenResults();
  };

  /**
   * creates an object corresponding to the provided schema
   * @param  {RealmSchema} schema
   * @param  {any} object
   * @param  {Realm.UpdateMode} updateMode
   */
  public create = (schema: RealmSchema, object: any, updateMode) => {
    const realm = this.getDatabase();
    try {
      this.writeTransaction(realm, () => {
        realm.create(schema, object, updateMode);
      });
      return true;
    } catch (err) {
      console.log({ err });
      return false;
    }
  };

  /**
   * creates an object corresponding to the provided schema
   * @param  {RealmSchema} schema
   * @param  {any[]} object
   * @param  {Realm.UpdateMode} updateMode
   */
  public createBulk = (schema: RealmSchema, objects: any[], updateMode) => {
    const realm = this.getDatabase();
    try {
      this.writeTransaction(realm, () => {
        for (const object of objects) {
          realm.create(schema, object, updateMode);
        }
      });

      return true;
    } catch (err) {
      console.log({ err });
      return false;
    }
  };

  /**
   * fetches objects corresponding to supplied schema
   * @param  {RealmSchema} schema
   */
  public get = (schema: RealmSchema) => {
    const realm = this.getDatabase();
    try {
      return realm.objects(schema);
    } catch (err) {
      console.log({ err });
      return undefined;
    }
  };

  /**
   * generic write mechanism, modifies the database as per the callback
   * @param  {} callback
   */
  public write = (callback) => {
    const realm = this.getDatabase();
    this.writeTransaction(realm, callback);
    return true;
  };

  /**
   * removes the object from the database
   * @param  {any} object
   */
  public delete = (object: any) => {
    const realm = this.getDatabase();
    this.writeTransaction(realm, () => {
      realm.delete(object);
    });
    return true;
  };
}

const realmDatabase = new RealmDatabase();
export const setRecoveryCommitObserver = (observer: RecoveryCommitObserver) =>
  realmDatabase.setRecoveryCommitObserver(observer);
export default realmDatabase;
