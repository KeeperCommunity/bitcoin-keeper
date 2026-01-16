import { UTXO } from 'src/services/wallets/interfaces';

import { Action } from 'redux';
import { TxPriority } from 'src/services/wallets/enums';
import { MiniscriptTxSelectedSatisfier, Vault } from 'src/services/wallets/interfaces/vault';
import { Wallet } from 'src/services/wallets/interfaces/wallet';

export const FETCH_EXCHANGE_RATES = 'FETCH_EXCHANGE_RATES';
export const FETCH_FEE_RATES = 'FETCH_FEE_RATES';
export const AVERAGE_TX_FEE = 'AVERAGE_TX_FEE';
export const EXCHANGE_RATE_CALCULATED = 'EXCHANGE_RATE_CALCULATED';
export const SEND_PHASE_ONE = 'SEND_PHASE_ONE';
export const SEND_PHASE_TWO = 'SEND_PHASE_TWO';
export const SEND_PHASE_THREE = 'SEND_PHASE_THREE';
export const CALCULATE_SEND_MAX_FEE = 'CALCULATE_SEND_MAX_FEE';
export const SEND_MAX_FEE_CALCULATED = 'SEND_MAX_FEE_CALCULATED';
export const CALCULATE_CUSTOM_FEE = 'CALCULATE_CUSTOM_FEE';
export const DISCARD_BROADCASTED_TNX = 'DISCARD_BROADCASTED_TNX';

export const fetchExchangeRates = () => ({
  type: FETCH_EXCHANGE_RATES,
});


export const fetchFeeRates = () => ({
  type: FETCH_FEE_RATES,
});

export interface SendPhaseOneAction extends Action {
  type: typeof SEND_PHASE_ONE;
  payload: {
    wallet: Wallet | Vault;
    recipients: {
      address: string;
      amount: number;
    }[];
    selectedUTXOs?: UTXO[];
    miniscriptSelectedSatisfier?: MiniscriptTxSelectedSatisfier;
  };
}

export const sendPhaseOne = (payload: {
  wallet: Wallet | Vault;
  recipients: {
    address: string;
    amount: number;
  }[];
  selectedUTXOs?: UTXO[];
  miniscriptSelectedSatisfier?: MiniscriptTxSelectedSatisfier;
}): SendPhaseOneAction => ({
  type: SEND_PHASE_ONE,
  payload,
});

export interface SendPhaseTwoAction extends Action {
  type: typeof SEND_PHASE_TWO;
  payload: {
    wallet: Wallet | Vault;
    currentBlockHeight: number;
    txnPriority: TxPriority;
    note?: string;
    miniscriptTxElements?: {
      selectedPhase: number;
      selectedPaths: number[];
    };
  };
}

export const sendPhaseTwo = (payload: {
  wallet: Wallet | Vault;
  currentBlockHeight: number;
  txnPriority: TxPriority;
  note?: string;
  miniscriptTxElements?: {
    selectedPhase: number;
    selectedPaths: number[];
  };
}): SendPhaseTwoAction => ({
  type: SEND_PHASE_TWO,
  payload,
});

export interface SendPhaseThreeAction extends Action {
  type: typeof SEND_PHASE_THREE;
  payload: {
    wallet: Wallet | Vault;
    txnPriority: TxPriority;
    note?: string;
    miniscriptTxElements?: {
      selectedPhase: number;
      selectedPaths: number[];
    };
  };
}

export const sendPhaseThree = (payload: {
  wallet: Wallet | Vault;
  txnPriority: TxPriority;
  note?: string;
  miniscriptTxElements?: {
    selectedPhase: number;
    selectedPaths: number[];
  };
}): SendPhaseThreeAction => ({
  type: SEND_PHASE_THREE,
  payload,
});

export interface CalculateSendMaxFeeAction extends Action {
  type: typeof CALCULATE_SEND_MAX_FEE;
  payload: {
    recipients: {
      address: string;
      amount: number;
    }[];
    wallet: Wallet | Vault;
    selectedUTXOs?: UTXO[];
    feePerByte?: number;
    miniscriptSelectedSatisfier?: MiniscriptTxSelectedSatisfier;
  };
}

export const calculateSendMaxFee = (payload: {
  recipients: {
    address: string;
    amount: number;
  }[];
  wallet: Wallet | Vault;
  selectedUTXOs?: UTXO[];
  feePerByte?: number;
  miniscriptSelectedSatisfier?: MiniscriptTxSelectedSatisfier;
}): CalculateSendMaxFeeAction => ({
  type: CALCULATE_SEND_MAX_FEE,
  payload,
});

export interface CalculateCustomFeeAction extends Action {
  type: typeof CALCULATE_CUSTOM_FEE;
  payload: {
    wallet: Wallet | Vault;
    recipients: {
      address: string;
      amount: number;
    }[];
    feePerByte: string;
    customEstimatedBlocks: string;
    selectedUTXOs?: UTXO[];
    miniscriptSelectedSatisfier?: MiniscriptTxSelectedSatisfier;
  };
}

export const calculateCustomFee = (payload: {
  wallet: Wallet | Vault;
  recipients: {
    address: string;
    amount: number;
  }[];
  feePerByte: string;
  customEstimatedBlocks: string;
  selectedUTXOs?: UTXO[];
  miniscriptSelectedSatisfier?: MiniscriptTxSelectedSatisfier;
}): CalculateCustomFeeAction => ({
  type: CALCULATE_CUSTOM_FEE,
  payload,
});

export const discardBroadcastedTnx = ({ cachedTxid, vault }) => ({
  type: DISCARD_BROADCASTED_TNX,
  payload: { cachedTxid, vault },
});
