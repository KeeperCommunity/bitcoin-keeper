import { UTXO, UTXOSpendability } from 'src/services/wallets/interfaces';
import { Vault } from 'src/services/wallets/interfaces/vault';
import { Wallet } from 'src/services/wallets/interfaces/wallet';

// types and action creators: dispatched by components and sagas
export const ADD_LABELS = 'ADD_LABELS';
export const BULK_UPDATE_LABELS = 'BULK_UPDATE_LABELS';
export const IMPORT_LABELS = 'IMPORT_LABELS';
export const MARK_UTXO_SPENDABILITY = 'MARK_UTXO_SPENDABILITY';

export const addLabels = (payload: {
  txId: string;
  vout?: number;
  wallet: Wallet | Vault;
  labels: { name: string; isSystem: boolean }[];
  type;
}, originAppId?: string) => ({
  type: ADD_LABELS,
  payload,
  originAppId,
});

export const bulkUpdateLabels = (payload: {
  labelChanges: {
    added: { isSystem: boolean; name: string }[];
    deleted: { isSystem: boolean; name: string }[];
  };
  UTXO?: UTXO;
  txId?: string;
  address?: string;
  wallet: Wallet;
}, originAppId?: string) => ({
  type: BULK_UPDATE_LABELS,
  payload,
  originAppId,
});

export const importLabels = (payload: {
  labels: [
    {
      type: string;
      ref: string;
      label: string;
      origin: string;
    }
  ];
}, originAppId?: string) => ({
  type: IMPORT_LABELS,
  payload,
  originAppId,
});

export const markUTXOSpendability = (payload: {
  wallet: Wallet | Vault;
  txId: string;
  vout: number;
  spendability: UTXOSpendability;
}, originAppId?: string) => ({
  type: MARK_UTXO_SPENDABILITY,
  payload,
  originAppId,
});
