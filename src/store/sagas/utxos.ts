import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { call, delay, fork, put, takeLatest } from 'redux-saga/effects';
import { BIP329Label, UTXO, UTXOSpendability } from 'src/services/wallets/interfaces';
import { EntityKind, LabelRefType } from 'src/services/wallets/enums';
import Relay from 'src/services/backend/Relay';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { generateAbbreviatedOutputDescriptors } from 'src/utils/service-utilities/utils';
import { Vault } from 'src/services/wallets/interfaces/vault';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { createWatcher } from '../utilities';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';

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

export function* addLabelsWorker({
  payload,
}: {
  payload: {
    txId: string;
    vout?: number;
    wallet: Wallet | Vault;
    labels: { name: string; isSystem: boolean }[];
    type;
  };
}) {
  try {
    yield put(setSyncingUTXOs(true));
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
    const { id, primarySeed }: KeeperApp = yield call(
      dbManager.getObjectByIndex,
      RealmSchema.KeeperApp
    );
    yield call(dbManager.createObjectBulk, RealmSchema.Tags, tags);
    try {
      const backupResponse = yield call(checkBackupCondition);
      if (!backupResponse) {
        const encryptionKey = generateEncryptionKey(primarySeed);
        const tagsToBackup = tags.map((tag) => ({
          id: hash256(hash256(encryptionKey + tag.id)),
          content: encrypt(encryptionKey, JSON.stringify(tag)),
        }));
        yield call(Relay.modifyLabels, id, tagsToBackup, []);
      } else yield delay(100);
    } catch (error) {
      console.log('🚀 ~ addLabelsWorker error:', error);
      yield call(setServerBackupFailed);
    }
    yield put(resetState());
  } catch (e) {
    yield put(setSyncingUTXOError(e));
  } finally {
    yield put(setSyncingUTXOs(false));
  }
}

export function* bulkUpdateLabelsWorker({
  payload,
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
}) {
  try {
    yield put(setSyncingUTXOs(true));
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
    const { primarySeed, id }: KeeperApp = yield call(
      dbManager.getObjectByIndex,
      RealmSchema.KeeperApp
    );
    yield call(dbManager.createObjectBulk, RealmSchema.Tags, addedTags);
    for (const element of deletedTagIds) {
      yield call(dbManager.deleteObjectById, RealmSchema.Tags, element);
    }
    try {
      const backupResponse = yield call(checkBackupCondition);
      if (!backupResponse) {
        const encryptionKey = generateEncryptionKey(primarySeed);
        const tagsToBackup = addedTags.map((tag) => ({
          id: hash256(hash256(encryptionKey + tag.id)),
          content: encrypt(encryptionKey, JSON.stringify(tag)),
        }));
        const tagsToDelete = deletedTagIds.map((tag) => hash256(hash256(encryptionKey + tag)));
        yield fork(
          Relay.modifyLabels,
          id,
          tagsToBackup.length ? tagsToBackup : [],
          tagsToDelete.length ? tagsToDelete : []
        );
      } else yield delay(100);
    } catch (error) {
      yield call(setServerBackupFailed);
    }
    yield put(resetState());
  } catch (e) {
    yield put(setSyncingUTXOError(e));
  } finally {
    yield put(setSyncingUTXOs(false));
  }
}

export function* importLabelsWorker({
  payload,
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
}) {
  try {
    yield put(setSyncingUTXOs(true));
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

    const { primarySeed, id }: KeeperApp = yield call(
      dbManager.getObjectByIndex,
      RealmSchema.KeeperApp
    );
    yield call(dbManager.createObjectBulk, RealmSchema.Tags, addedTags);

    try {
      const backupResponse = yield call(checkBackupCondition);
      if (!backupResponse) {
        const encryptionKey = generateEncryptionKey(primarySeed);
        const tagsToBackup = addedTags.map((tag) => ({
          id: hash256(hash256(encryptionKey + tag.id)),
          content: encrypt(encryptionKey, JSON.stringify(tag)),
        }));
        yield fork(Relay.modifyLabels, id, tagsToBackup.length ? tagsToBackup : [], []);
      } else yield delay(100);
    } catch (error) {
      yield call(setServerBackupFailed);
    }
    yield put(resetState());
  } catch (e) {
    yield put(setSyncingUTXOError(e));
  } finally {
    yield put(setSyncingUTXOs(false));
  }
}

export const addLabelsWatcher = createWatcher(addLabelsWorker, ADD_LABELS);
export const bulkUpdateLabelWatcher = createWatcher(bulkUpdateLabelsWorker, BULK_UPDATE_LABELS);
export const importLabelsWatcher = createWatcher(importLabelsWorker, IMPORT_LABELS);

export function* markUTXOSpendabilityWorker({
  payload,
}: {
  payload: {
    wallet: any;
    txId: string;
    vout: number;
    spendability: UTXOSpendability;
  };
}) {
  try {
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
    const persisted = yield call(dbManager.updateObjectById, schema, wallet.id, { specs });
    if (persisted !== true) return;
    // Persist the user's choice first, then invalidate/refresh Assisted Server
    // Backup through its normal opt-in/offline-aware incremental path.
    try {
      const response =
        schema === RealmSchema.Vault
          ? yield call(updateVaultImageWorker, {
              payload: { vault: walletJSON as Vault, isUpdate: true },
            })
          : yield call(updateAppImageWorker, { payload: { wallets: [walletJSON as Wallet] } });
      if (!response?.updated) yield call(setServerBackupFailed);
    } catch {
      yield call(setServerBackupFailed);
    }
  } catch (e) {
    console.log('markUTXOSpendabilityWorker error:', e);
  }
}

export const markUTXOSpendabilityWatcher = createWatcher(
  markUTXOSpendabilityWorker,
  MARK_UTXO_SPENDABILITY
);
