import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { call, put } from 'redux-saga/effects';
import Realm from 'realm';
import { BIP329Label, UTXOSpendability } from 'src/services/wallets/interfaces';
import { EntityKind, LabelRefType, NetworkType } from 'src/services/wallets/enums';
import { currentBackupAccountSession } from 'src/services/backup/transport';
import type { BackupWriteIntent } from 'src/services/backup/intent';
import {
  beginBackupLocalOperation,
  commitBackupLocalOperation,
  enqueueAutomaticBackupOperation,
} from 'src/services/backup/automatic';
import type { BackupLocalCommit, BackupLocalOperation } from 'src/services/backup/automatic';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { generateAbbreviatedOutputDescriptors } from 'src/utils/service-utilities/utils';
import { Vault } from 'src/services/wallets/interfaces/vault';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { createWatcher } from '../utilities';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { store } from '../store';

import {
  ADD_LABELS,
  BULK_UPDATE_LABELS,
  IMPORT_LABELS,
  MARK_UTXO_SPENDABILITY,
} from '../sagaActions/utxos';
import { resetState, setSyncingUTXOError, setSyncingUTXOs } from '../reducers/utxos';
import {
  setServerBackupFailed,
  updateAppImageWorker,
  updateVaultImageWorker,
} from './bhr';
import { encrypt, generateEncryptionKey, hash256 } from 'src/utils/service-utilities/encryption';

type LabelSyncScope = { appId: string; networkType: NetworkType };

function currentOriginApp(originAppId?: string): KeeperApp | null {
  if (!originAppId || store.getState().storage.appId !== originAppId) return null;
  try {
    const app = dbManager.getObjectByIndex(RealmSchema.KeeperApp) as unknown as KeeperApp;
    return app?.id === originAppId ? app : null;
  } catch {
    return null;
  }
}

// Keep the ownership check and local writes in one synchronous turn. An action
// created for A must never mutate B's Realm after a network or saga wait.
function persistTagsForOrigin(
  originAppId: string,
  added: BIP329Label[],
  deleted: string[] = [],
  scope?: LabelSyncScope,
  accountSession?: number,
  operation?: BackupLocalOperation
) {
  if (!operation || !currentOriginApp(originAppId)) return { committed: false };
  if (accountSession !== undefined && accountSession !== currentBackupAccountSession()) return { committed: false };
  if (
    scope &&
    (scope.appId !== originAppId || store.getState().settings.bitcoinNetworkType !== scope.networkType)
  )
    return { committed: false };
  // Additions and removals are one local transaction. A failed import or
  // deletion cannot leave a partial operation eligible for upload.
  return commitBackupLocalOperation(operation, (rawRealm) => {
    for (const tag of added) rawRealm.create(RealmSchema.Tags, tag, Realm.UpdateMode.All);
    for (const id of deleted) {
      const tag = rawRealm.objectForPrimaryKey(RealmSchema.Tags, id);
      if (tag) rawRealm.delete(tag);
    }
  });
}

function persistSpendabilityForOrigin(
  originAppId: string,
  schema: RealmSchema,
  id: string,
  specs: any,
  accountSession?: number,
  operation?: BackupLocalOperation
) {
  if (!operation || !currentOriginApp(originAppId)) return { committed: false };
  if (accountSession !== undefined && accountSession !== currentBackupAccountSession()) return { committed: false };
  return commitBackupLocalOperation(operation, (rawRealm) => {
    const wallet: any = rawRealm.objectForPrimaryKey(schema, id);
    if (!wallet) throw new Error('Wallet no longer exists');
    wallet.specs = specs;
  });
}

function* backupCommittedLabels(
  originAppId: string,
  requestSession: number,
  committedOperation: BackupLocalCommit,
  added: BIP329Label[],
  deleted: string[] = []
) {
  if (!committedOperation.committed) return;
  const app = currentOriginApp(originAppId);
  if (!app || requestSession !== currentBackupAccountSession()) return;
  const encryptionKey = generateEncryptionKey(app.primarySeed);
  const deletedIds = new Set(deleted);
  // Deletion wins when the same label occurs on both sides of an edit, as in
  // the local transaction. Read back each addition instead of encrypting the
  // action payload, and let the queue prove it again before network.
  const addedIds = [...new Set(added.map((tag) => tag.id))].filter((id) => !deletedIds.has(id));
  const addLabels = addedIds.map((id) => {
    const persisted = dbManager.getObjectById(RealmSchema.Tags, id);
    if (!persisted) throw new Error('Committed label no longer exists');
    const tag = getJSONFromRealmObject(persisted);
    return {
      id: hash256(hash256(encryptionKey + id)),
      content: encrypt(encryptionKey, JSON.stringify(tag)),
    };
  });
  const deleteLabels = [...deletedIds].map((id) => hash256(hash256(encryptionKey + id)));
  if (!addLabels.length && !deleteLabels.length) return;
  yield call(enqueueAutomaticBackupOperation, committedOperation, [{
    operation: 'modifyLabels',
    body: { appId: originAppId, addLabels, deleteLabels },
  }]);
}

function originUiAction<T extends { type: string }>(action: T, originAppId: string): T & { originAppId: string } {
  return { ...action, originAppId };
}

export function* addLabelsWorker({
  payload,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  payload: {
    txId: string;
    vout?: number;
    wallet: Wallet | Vault;
    labels: { name: string; isSystem: boolean }[];
    type;
  };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  try {
    if (!originAppId) return;
    const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
    if (requestSession !== currentBackupAccountSession()) return;
    const app = currentOriginApp(originAppId);
    if (!app) return;
    const operation = beginBackupLocalOperation(originAppId, originBackupWriteIntent, requestSession);
    yield put(originUiAction(setSyncingUTXOs(true), originAppId));
    const { txId, vout, wallet, labels, type } = payload;
    const origin = generateAbbreviatedOutputDescriptors(wallet);
    const tags = [];
    labels.forEach((label) => {
      const ref = vout !== undefined ? `${txId}:${vout}` : txId;
      const tag = {
        id: `${ref}${label.name}`,
        label: label.name,
        isSystem: label.isSystem,
        ref,
        type,
        origin,
      };
      tags.push(tag);
    });
    const committedOperation: BackupLocalCommit = yield call(
      persistTagsForOrigin, originAppId, tags, [], undefined, requestSession, operation
    );
    if (!committedOperation.committed) return;
    try {
      yield call(backupCommittedLabels, originAppId, requestSession, committedOperation, tags);
    } catch {
      if (currentOriginApp(originAppId) && requestSession === currentBackupAccountSession())
        yield call(setServerBackupFailed, originAppId);
    }
    yield put(originUiAction(resetState(), originAppId));
  } catch (e) {
    if (originAppId) yield put(originUiAction(setSyncingUTXOError(e), originAppId));
  } finally {
    if (originAppId) yield put(originUiAction(setSyncingUTXOs(false), originAppId));
  }
}

export function* bulkUpdateLabelsWorker({
  payload,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  payload: {
    labelChanges: {
      added: { isSystem: boolean; name: string }[];
      deleted: { isSystem: boolean; name: string }[];
    };
    UTXO?: { txId: string; vout: number };
    txId?: string;
    address?: string;
    wallet: Wallet;
    scope?: LabelSyncScope;
  };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  try {
    if (!originAppId) return;
    const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
    if (requestSession !== currentBackupAccountSession()) return;
    const app = currentOriginApp(originAppId);
    if (!app) return;
    const operation = beginBackupLocalOperation(originAppId, originBackupWriteIntent, requestSession);
    yield put(originUiAction(setSyncingUTXOs(true), originAppId));
    const { labelChanges, wallet, UTXO, txId, address, scope } = payload;
    if (
      scope &&
      (scope.appId !== originAppId ||
        store.getState().settings.bitcoinNetworkType !== scope.networkType ||
        wallet.networkType !== scope.networkType)
    )
      return;
    const origin = generateAbbreviatedOutputDescriptors(wallet);
    let addedTags: BIP329Label[] = [];
    let deletedTagIds: string[] = [];
    const ref = txId || address || `${UTXO.txId}:${UTXO.vout}`;

    if (labelChanges.added) {
      const type = txId ? LabelRefType.TXN : address ? LabelRefType.ADDR : LabelRefType.OUTPUT;
      addedTags = labelChanges.added.map((label) => ({
        id: `${ref}${label.name}`,
        ref,
        type,
        label: label.name,
        origin,
        isSystem: label.isSystem,
      }));
    }
    if (labelChanges.deleted) {
      deletedTagIds = labelChanges.deleted.map((label) => `${ref}${label.name}`);
    }
    const committedOperation: BackupLocalCommit = yield call(
      persistTagsForOrigin, originAppId, addedTags, deletedTagIds, scope, requestSession, operation
    );
    if (!committedOperation.committed) return;
    try {
      yield call(backupCommittedLabels, originAppId, requestSession, committedOperation, addedTags, deletedTagIds);
    } catch {
      if (currentOriginApp(originAppId) && requestSession === currentBackupAccountSession())
        yield call(setServerBackupFailed, originAppId);
    }
    yield put(originUiAction(resetState(), originAppId));
  } catch (e) {
    if (originAppId) yield put(originUiAction(setSyncingUTXOError(e), originAppId));
  } finally {
    if (originAppId) yield put(originUiAction(setSyncingUTXOs(false), originAppId));
  }
}

export function* importLabelsWorker({
  payload,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  payload: {
    labels: [
      {
        type: string;
        ref: string;
        label: string;
        origin: string;
      }
    ];
  };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  try {
    if (!originAppId) return;
    const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
    if (requestSession !== currentBackupAccountSession()) return;
    const app = currentOriginApp(originAppId);
    if (!app) return;
    const operation = beginBackupLocalOperation(originAppId, originBackupWriteIntent, requestSession);
    yield put(originUiAction(setSyncingUTXOs(true), originAppId));
    const { labels } = payload;
    let addedTags: BIP329Label[] = [];
    if (labels) {
      addedTags = labels.map((label) => ({
        id: `${label.ref}${label.label}`,
        ref: label.ref,
        type: (label.type.toUpperCase() === 'TX'
          ? 'TXN' // TODO: Need to fix txn to be tx and make all lowercase
          : label.type.toUpperCase()) as LabelRefType,
        label: label.label,
        origin: label.origin,
        isSystem: false,
      }));
    }

    const committedOperation: BackupLocalCommit = yield call(
      persistTagsForOrigin, originAppId, addedTags, [], undefined, requestSession, operation
    );
    if (!committedOperation.committed) return;
    try {
      yield call(backupCommittedLabels, originAppId, requestSession, committedOperation, addedTags);
    } catch {
      if (currentOriginApp(originAppId) && requestSession === currentBackupAccountSession())
        yield call(setServerBackupFailed, originAppId);
    }
    yield put(originUiAction(resetState(), originAppId));
  } catch (e) {
    if (originAppId) yield put(originUiAction(setSyncingUTXOError(e), originAppId));
  } finally {
    if (originAppId) yield put(originUiAction(setSyncingUTXOs(false), originAppId));
  }
}

// A send may create a transaction note and several labels on its change
// output. They share one local commit and one remote mutation, so failure
// cannot authorize a later child with the original remote revision.
export function* transactionLabelsWorker({
  payload,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  payload: {
    txId: string;
    wallet: Wallet | Vault;
    note?: string;
    finalOutputs?: { address: string }[];
    inputs?: { txId: string; vout: number }[];
  };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  try {
    if (!originAppId) return;
    const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
    if (requestSession !== currentBackupAccountSession() || !currentOriginApp(originAppId)) return;
    const operation = beginBackupLocalOperation(originAppId, originBackupWriteIntent, requestSession);
    const { txId, wallet, note, finalOutputs = [], inputs = [] } = payload;
    const origin = generateAbbreviatedOutputDescriptors(wallet);
    const tags: BIP329Label[] = [];
    if (note) tags.push({
      id: `${txId}${note}`, ref: txId, type: LabelRefType.TXN,
      label: note, origin, isSystem: false,
    });
    const changeOutputIndex = finalOutputs.findIndex((output) =>
      Object.values(wallet.specs.addresses.internal).includes(output.address)
    );
    if (changeOutputIndex !== -1) {
      const inputRefs = new Set(inputs.map((input) => `${input.txId}:${input.vout}`));
      const inherited = (dbManager.getCollection(RealmSchema.Tags) as unknown as BIP329Label[])
        .filter((tag) => inputRefs.has(tag.ref));
      const ref = `${txId}:${changeOutputIndex}`;
      const changeLabels = [{ label: 'Change', isSystem: false }, ...inherited];
      for (const label of changeLabels) tags.push({
        id: `${ref}${label.label}`, ref, type: LabelRefType.OUTPUT,
        label: label.label, isSystem: label.isSystem, origin,
      });
    }
    if (!tags.length) return;
    yield put(originUiAction(setSyncingUTXOs(true), originAppId));
    const committedOperation: BackupLocalCommit = yield call(
      persistTagsForOrigin, originAppId, tags, [], undefined, requestSession, operation
    );
    if (!committedOperation.committed) return;
    try {
      yield call(backupCommittedLabels, originAppId, requestSession, committedOperation, tags);
    } catch {
      if (currentOriginApp(originAppId) && requestSession === currentBackupAccountSession())
        yield call(setServerBackupFailed, originAppId);
    }
    yield put(originUiAction(resetState(), originAppId));
  } catch (error) {
    if (originAppId) yield put(originUiAction(setSyncingUTXOError(error), originAppId));
  } finally {
    if (originAppId) yield put(originUiAction(setSyncingUTXOs(false), originAppId));
  }
}

export const addLabelsWatcher = createWatcher(addLabelsWorker, ADD_LABELS);
export const bulkUpdateLabelWatcher = createWatcher(bulkUpdateLabelsWorker, BULK_UPDATE_LABELS);
export const importLabelsWatcher = createWatcher(importLabelsWorker, IMPORT_LABELS);

export function* markUTXOSpendabilityWorker({
  payload,
  originAppId,
  originBackupAccountSession,
  originBackupWriteIntent,
}: {
  payload: {
    wallet: any;
    txId: string;
    vout: number;
    spendability: UTXOSpendability;
  };
  originAppId?: string;
  originBackupAccountSession?: number;
  originBackupWriteIntent?: BackupWriteIntent;
}) {
  try {
    if (!originAppId) return;
    const requestSession = originBackupAccountSession ?? currentBackupAccountSession();
    if (requestSession !== currentBackupAccountSession()) return;
    if (!currentOriginApp(originAppId)) return;
    const operation = beginBackupLocalOperation(originAppId, originBackupWriteIntent, requestSession);
    const { wallet, txId, vout, spendability } = payload;

    const schema = wallet.entityKind === EntityKind.VAULT ? RealmSchema.Vault : RealmSchema.Wallet;

    const storedWallet: any = yield call(dbManager.getObjectById, schema, wallet.id);
    if (!storedWallet) return;

    // Deep plain-JS copy so Realm embedded lists are proper arrays
    const walletJSON = getJSONFromRealmObject(storedWallet) as unknown as Wallet | Vault;
    const specs = walletJSON.specs;
    const allUTXOArrays: Array<'confirmedUTXOs' | 'unconfirmedUTXOs'> = [
      'confirmedUTXOs',
      'unconfirmedUTXOs',
    ];
    let changed = false;

    for (const arrayKey of allUTXOArrays) {
      const utxoArray: any[] = specs[arrayKey] || [];
      const idx = utxoArray.findIndex((u: any) => u.txId === txId && u.vout === vout);
      if (idx !== -1) {
        if (utxoArray[idx].isManualOverride && utxoArray[idx].spendability === spendability) return;
        utxoArray[idx] = { ...utxoArray[idx], spendability, isManualOverride: true };
        changed = true;
        break;
      }
    }

    if (!changed) return;
    const committedOperation: BackupLocalCommit = yield call(
      persistSpendabilityForOrigin, originAppId, schema, wallet.id, specs, requestSession, operation
    );
    if (!committedOperation.committed) return;
    const committedWallet = dbManager.getObjectById(schema, wallet.id);
    if (!committedWallet) return;
    const freshWallet = getJSONFromRealmObject(committedWallet) as unknown as Wallet | Vault;
    // Persist the user's choice first, then invalidate/refresh Assisted Server
    // Backup through its normal opt-in/offline-aware incremental path.
    try {
      const response =
        schema === RealmSchema.Vault
          ? yield call(updateVaultImageWorker, {
              payload: { vault: freshWallet as Vault, isUpdate: true },
              originAppId,
              originBackupAccountSession: requestSession,
              originBackupWriteIntent,
              committedOperation,
            })
          : yield call(updateAppImageWorker, {
              payload: { wallets: [freshWallet as Wallet] },
              originAppId,
              originBackupAccountSession: requestSession,
              originBackupWriteIntent,
              committedOperation,
            });
      if (!response?.updated) yield call(setServerBackupFailed, originAppId);
    } catch {
      yield call(setServerBackupFailed, originAppId);
    }
  } catch (e) {
    console.log('markUTXOSpendabilityWorker error:', e);
  }
}

export const markUTXOSpendabilityWatcher = createWatcher(
  markUTXOSpendabilityWorker,
  MARK_UTXO_SPENDABILITY
);
