import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { call, delay, put } from 'redux-saga/effects';
import { BIP329Label, UTXOSpendability } from 'src/services/wallets/interfaces';
import { EntityKind, LabelRefType } from 'src/services/wallets/enums';
import Relay from 'src/services/backend/Relay';
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
  checkBackupCondition,
  setServerBackupFailed,
  updateAppImageWorker,
  updateVaultImageWorker,
} from './bhr';
import { encrypt, generateEncryptionKey, hash256 } from 'src/utils/service-utilities/encryption';

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
function persistTagsForOrigin(originAppId: string, added: BIP329Label[], deleted: string[] = []) {
  if (!currentOriginApp(originAppId)) return false;
  if (added.length && dbManager.createObjectBulk(RealmSchema.Tags, added) !== true) return false;
  for (const id of deleted) {
    if (dbManager.deleteObjectById(RealmSchema.Tags, id) !== true) return false;
  }
  return true;
}

function persistSpendabilityForOrigin(originAppId: string, schema: RealmSchema, id: string, specs: any) {
  if (!currentOriginApp(originAppId)) return false;
  return dbManager.updateObjectById(schema, id, { specs }) === true;
}

function originUiAction<T extends { type: string }>(action: T, originAppId: string): T & { originAppId: string } {
  return { ...action, originAppId };
}

export function* addLabelsWorker({
  payload,
  originAppId,
}: {
  payload: {
    txId: string;
    vout?: number;
    wallet: Wallet | Vault;
    labels: { name: string; isSystem: boolean }[];
    type;
  };
  originAppId?: string;
}) {
  try {
    if (!originAppId) return;
    const app = currentOriginApp(originAppId);
    if (!app) return;
    const primarySeed = app.primarySeed;
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
    if (!(yield call(persistTagsForOrigin, originAppId, tags))) return;
    try {
      const backupResponse = yield call(checkBackupCondition, originAppId);
      if (!backupResponse && currentOriginApp(originAppId)) {
        const encryptionKey = generateEncryptionKey(primarySeed);
        const tagsToBackup = tags.map((tag) => ({
          id: hash256(hash256(encryptionKey + tag.id)),
          content: encrypt(encryptionKey, JSON.stringify(tag)),
        }));
        yield call(Relay.modifyLabels, originAppId, tagsToBackup, []);
      } else yield delay(100);
    } catch (error) {
      console.log('🚀 ~ addLabelsWorker error:', error);
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
  };
  originAppId?: string;
}) {
  try {
    if (!originAppId) return;
    const app = currentOriginApp(originAppId);
    if (!app) return;
    const primarySeed = app.primarySeed;
    yield put(originUiAction(setSyncingUTXOs(true), originAppId));
    const { labelChanges, wallet, UTXO, txId, address } = payload;
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
    if (!(yield call(persistTagsForOrigin, originAppId, addedTags, deletedTagIds))) return;
    try {
      const backupResponse = yield call(checkBackupCondition, originAppId);
      if (!backupResponse && currentOriginApp(originAppId)) {
        const encryptionKey = generateEncryptionKey(primarySeed);
        const tagsToBackup = addedTags.map((tag) => ({
          id: hash256(hash256(encryptionKey + tag.id)),
          content: encrypt(encryptionKey, JSON.stringify(tag)),
        }));
        const tagsToDelete = deletedTagIds.map((tag) => hash256(hash256(encryptionKey + tag)));
        yield call(
          Relay.modifyLabels,
          originAppId,
          tagsToBackup.length ? tagsToBackup : [],
          tagsToDelete.length ? tagsToDelete : []
        );
      } else yield delay(100);
    } catch (error) {
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
}) {
  try {
    if (!originAppId) return;
    const app = currentOriginApp(originAppId);
    if (!app) return;
    const primarySeed = app.primarySeed;
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

    if (!(yield call(persistTagsForOrigin, originAppId, addedTags))) return;

    try {
      const backupResponse = yield call(checkBackupCondition, originAppId);
      if (!backupResponse && currentOriginApp(originAppId)) {
        const encryptionKey = generateEncryptionKey(primarySeed);
        const tagsToBackup = addedTags.map((tag) => ({
          id: hash256(hash256(encryptionKey + tag.id)),
          content: encrypt(encryptionKey, JSON.stringify(tag)),
        }));
        yield call(Relay.modifyLabels, originAppId, tagsToBackup.length ? tagsToBackup : [], []);
      } else yield delay(100);
    } catch (error) {
      yield call(setServerBackupFailed, originAppId);
    }
    yield put(originUiAction(resetState(), originAppId));
  } catch (e) {
    if (originAppId) yield put(originUiAction(setSyncingUTXOError(e), originAppId));
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
}: {
  payload: {
    wallet: any;
    txId: string;
    vout: number;
    spendability: UTXOSpendability;
  };
  originAppId?: string;
}) {
  try {
    if (!originAppId) return;
    if (!currentOriginApp(originAppId)) return;
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
    const persisted = yield call(persistSpendabilityForOrigin, originAppId, schema, wallet.id, specs);
    if (persisted !== true) return;
    // Persist the user's choice first, then invalidate/refresh Assisted Server
    // Backup through its normal opt-in/offline-aware incremental path.
    try {
      const response =
        schema === RealmSchema.Vault
          ? yield call(updateVaultImageWorker, {
              payload: { vault: walletJSON as Vault, isUpdate: true },
              originAppId,
            })
          : yield call(updateAppImageWorker, {
              payload: { wallets: [walletJSON as Wallet] },
              originAppId,
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
