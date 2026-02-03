import * as CryptoJS from 'crypto-js';
import { NetworkType, EntityKind, VisibilityType, WalletType } from '../enums';
import {
  createTronWalletFromMnemonic,
  DEFAULT_TRON_DERIVATION_PATH,
} from '../operations/dollars/Tron';
import USDT, { USDTAccountStatus, USDTTransaction } from '../operations/dollars/USDT';
import BIP85 from '../operations/BIP85';
import { BIP85Config } from '../interfaces';
import { GasFreeTransferStatus } from '../operations/dollars/GasFree';
import config from 'src/utils/service-utilities/config';

export const USDTWalletSupportedNetwork = config.isDevMode()
  ? NetworkType.TESTNET
  : NetworkType.MAINNET; // NOTE: Only MAINNET supported for USDT wallets on Keeper Live(GasFree testnet API is restricted for development purposes)

export enum USDTWalletType {
  DEFAULT = 'DEFAULT',
  IMPORTED = 'IMPORTED',
}

export interface USDTWalletSpecs {
  address: string; // TRON address (TR...)
  privateKey: string; // Private key
  balance: number; // Available USDT balance
  transactions: USDTTransaction[];
  hasNewUpdates: boolean;
  lastSynched: number; // Last sync timestamp
}

export interface USDTWalletPresentationData {
  name: string; // Custom wallet name
  description: string; // Custom description
  visibility: VisibilityType; // Visibility setting
}

export interface USDTWalletDerivationDetails {
  instanceNum?: number; // instance number of this particular walletType
  mnemonic?: string; // mnemonic of the wallet
  bip85Config?: BIP85Config; // bip85 configuration leading to the derivation path for the corresponding entropy
  xDerivationPath: string; // derivation path of the extended keys belonging to this wallet
}

export interface USDTWalletAccountStatus extends USDTAccountStatus {}

export interface USDTWallet {
  id: string;
  entityKind: EntityKind.USDT_WALLET;
  type: USDTWalletType;
  networkType: NetworkType;
  derivationDetails: USDTWalletDerivationDetails;
  presentationData: USDTWalletPresentationData;
  specs: USDTWalletSpecs;
  accountStatus: USDTWalletAccountStatus;
  createdAt: number;
}

export interface USDTWalletImportDetails {
  mnemonic: string; // Mnemonic for the imported wallet
}

export interface USDTWalletCreationParams {
  usdtWalletType: USDTWalletType;
  walletName: string;
  walletDescription: string;
  networkType: NetworkType;
  primaryMnemonic?: string;
  instanceNum?: number;
  importDetails?: USDTWalletImportDetails;
}

/**
 * Generate wallet ID from address
 */
export const generateWalletId = (address: string): string => {
  return CryptoJS.SHA256(address).toString();
};

/**
 * Main factory function to generate USDT wallets
 */
export const generateUSDTWallet = async (params: USDTWalletCreationParams): Promise<USDTWallet> => {
  const {
    usdtWalletType,
    primaryMnemonic,
    walletName,
    walletDescription,
    instanceNum,
    networkType,
    importDetails,
  } = params;

  let address: string;
  let privateKey: string;
  let derivationDetails: USDTWalletDerivationDetails;
  // Generate or import wallet based on type
  switch (usdtWalletType) {
    case USDTWalletType.DEFAULT: {
      if (!primaryMnemonic)
        throw new Error('Primary Mnemonic required for default USDT wallet type');
      // BIP85 derivation: primary mnemonic to bip85-child mnemonic
      const bip85Config = BIP85.generateBIP85Configuration(EntityKind.USDT_WALLET, instanceNum);
      const entropy = await BIP85.bip39MnemonicToEntropy(
        bip85Config.derivationPath,
        primaryMnemonic
      );
      const mnemonic = BIP85.entropyToBIP39(entropy, bip85Config.words);
      const newWallet = createTronWalletFromMnemonic(mnemonic, networkType);
      address = newWallet.address;
      privateKey = newWallet.privateKey;
      derivationDetails = {
        instanceNum,
        mnemonic,
        bip85Config,
        xDerivationPath: DEFAULT_TRON_DERIVATION_PATH,
      };
      break;
    }

    case USDTWalletType.IMPORTED: {
      if (!importDetails) {
        throw new Error('Import details required for imported wallet');
      }

      // Create wallet from imported mnemonic
      const importedWallet = createTronWalletFromMnemonic(importDetails.mnemonic, networkType);
      if (!importedWallet.isValid) throw new Error(`Failed to import USDT wallet using mnemonic`);

      address = importedWallet.address;
      privateKey = importedWallet.privateKey;
      derivationDetails = {
        instanceNum: null,
        mnemonic: importDetails.mnemonic,
        bip85Config: null,
        xDerivationPath: DEFAULT_TRON_DERIVATION_PATH,
      };
      break;
    }

    default:
      throw new Error(`Unsupported wallet type: ${usdtWalletType}`);
  }

  // Create presentation data with the provided name and description
  const presentationData: USDTWalletPresentationData = {
    name: walletName,
    description: walletDescription,
    visibility: VisibilityType.DEFAULT,
  };

  // Generate wallet specs
  const specs: USDTWalletSpecs = {
    address: address,
    privateKey,
    balance: 0,
    transactions: [],
    hasNewUpdates: true,
    lastSynched: Date.now(),
  };

  const accountStatus = await USDT.getAccountStatus(address, networkType);
  if (!accountStatus?.gasFreeAddress)
    throw new Error(`Failed to initiate specs for USDT wallet, missing gasFreeAddress`);

  // Create the USDT wallet
  const usdtWallet: USDTWallet = {
    id: generateWalletId(address),
    entityKind: EntityKind.USDT_WALLET,
    type: usdtWalletType,
    networkType,
    presentationData,
    derivationDetails,
    specs,
    accountStatus,
    createdAt: Date.now(),
  };

  return usdtWallet;
};

/**
 * Check if USDT wallet already exists
 */
export const checkUSDTWalletExists = (address: string, existingWallets: USDTWallet[]): boolean => {
  const walletId = generateWalletId(address);
  return existingWallets.some((wallet) => wallet.id === walletId);
};

/**
 * Update USDT wallet specs with latest account status
 */
export const updateUSDTWalletAccountStatus = async (
  wallet: USDTWallet
): Promise<USDTAccountStatus> => {
  try {
    return USDT.getAccountStatus(wallet.specs.address, wallet.networkType);
  } catch (error) {
    return wallet.accountStatus;
  }
};

/**
 * Syncs USDT wallet w/ latest balance
 */
export const syncUSDTWalletBalance = async (wallet: USDTWallet) => {
  const balance = await USDT.getUSDTBalance(
    wallet.accountStatus.gasFreeAddress,
    wallet.networkType
  );

  return balance;
};

/**
 * Evaluates USDT wallet's available balance
 */
export const getAvailableBalanceUSDTWallet = (wallet: USDTWallet): number => {
  return wallet.specs.balance - wallet.accountStatus.frozen; // frozen amount is currently under process w/ the GasFree service provider(in-process permit transfers)
};

/**
 * Syncs USDT wallet specs with latest state of transactions.
 */
export const syncUSDTWalletTransactions = async (wallet: USDTWallet) => {
  const existingTransactions = wallet.specs.transactions || [];

  // Step 1: Update existing transactions that have traceId but no txId
  const updatedExistingTransactions = await Promise.all(
    existingTransactions.map(async (existingTx) => {
      // If transaction has traceId but no txId, try to fetch the txId
      if (existingTx.traceId && !existingTx.txId) {
        try {
          const transferStatus = await USDT.getTransferStatus(
            existingTx.traceId,
            wallet.networkType
          );
          // Update transaction with new information if available
          if (transferStatus.transactionHash) {
            const blockNumber = transferStatus.blockInfo?.blockNumber || existingTx.blockNumber;
            const status = blockNumber
              ? GasFreeTransferStatus.SUCCEED
              : transferStatus.status || existingTx.status;
            return {
              ...existingTx,
              txId: transferStatus.transactionHash || existingTx.txId,
              status,
              blockNumber: blockNumber,
              // Update timestamp if we got block timestamp
              timestamp: transferStatus.blockInfo?.blockTimestamp
                ? transferStatus.blockInfo.blockTimestamp
                : existingTx.timestamp,
            };
          }
        } catch (error) {
          // If fetch fails, keep the original transaction
          console.warn(`Failed to update transaction with traceId ${existingTx.traceId}:`, error);
        }
      }

      // Return original transaction if no update needed or failed
      return existingTx;
    })
  );

  const existingTransactionsCache: { [txid: string]: number } = {}; // Cache for existing transactions by txId, helps to search by txId quickly
  updatedExistingTransactions.forEach((existingTx, idx) => {
    if (existingTx.txId) {
      existingTransactionsCache[existingTx.txId] = idx;
    }
  });

  // Step 2: Fetch new transactions from USDT service
  const { transactions: latestTransactions } = await USDT.getUSDTTransactions(
    wallet.accountStatus.gasFreeAddress,
    wallet.networkType
  );

  // Step 3: Filter out gas-free fee transactions
  // We will keep these transactions separately to avoid duplicates
  const newGasFreeFeeTransactions: { [key: string]: USDTTransaction } = {};
  const newTransactions: USDTTransaction[] = []; // contains new transactions that are not gas-free fee transfers
  for (let newTx of latestTransactions) {
    if (
      newTx.from === wallet.accountStatus.gasFreeAddress &&
      newTx.to === USDT.getUSDTGasFreeFeeAddress(wallet.networkType)
    ) {
      // Skip transactions that are just gas-free fees transfer to service provider(duplicate)
      newGasFreeFeeTransactions[newTx.txId] = newTx;
    } else {
      newTransactions.push(newTx);
    }
  }

  // Step 4: Merge transactions using updated existing transactions
  const mergedTransactions = [...updatedExistingTransactions];
  // Process each new transaction and create a unified transaction list
  newTransactions.forEach((newTx) => {
    const existingIndex = existingTransactionsCache[newTx.txId];
    if (existingIndex >= 0) {
      // Transaction exists - update it if the new one has more complete info
      const existingTx = updatedExistingTransactions[existingIndex];

      if (existingTx.amount === newTx.amount) {
        // there are two transactions for every gas-free transfer, one for the actual transfer and one for paying the fee(both of them have the same txid, skipping the fee transfer)

        const shouldUpdate =
          // Update if new transaction has blockNumber but existing doesn't (confirmed)
          newTx.blockNumber && !existingTx.blockNumber;

        if (shouldUpdate) {
          mergedTransactions[existingIndex] = {
            ...existingTx,
            txId: newTx.txId,
            from: newTx.from,
            to: newTx.to,
            timestamp: newTx.timestamp,
            blockNumber: newTx.blockNumber,
            status: newTx.blockNumber
              ? GasFreeTransferStatus.SUCCEED
              : GasFreeTransferStatus.CONFIRMING,
          };
        }
      }
    } else {
      // New transaction - add it to the list
      if (newGasFreeFeeTransactions[newTx.txId]) {
        // If there's a corresponding gas-free fee transaction, we should derive the fee from it(case: syncing TRC-20 transactions during USDT wallet import)
        const totalFee = parseFloat(newGasFreeFeeTransactions[newTx.txId].amount);
        let transferFee = 0;
        let activateFee = 0;

        if (totalFee > 1) {
          activateFee = 1;
          transferFee = totalFee - activateFee;
        } else transferFee = totalFee;

        newTx.fee = totalFee.toFixed(3);
        newTx.transferFee = parseFloat(transferFee.toFixed(3));
        newTx.activateFee = activateFee;
      }
      mergedTransactions.push(newTx);
    }
  });

  // Sort transactions by timestamp (newest first)
  mergedTransactions.sort((a, b) => b.timestamp - a.timestamp);
  return mergedTransactions;
};

/**
 * Syncs USDT wallet specs with latest balance and transactions.
 */
export const updateUSDTWalletBalanceTxs = async (wallet: USDTWallet): Promise<USDTWalletSpecs> => {
  try {
    const balance = await syncUSDTWalletBalance(wallet);
    const transactions = await syncUSDTWalletTransactions(wallet);

    const updatedSpecs: USDTWalletSpecs = {
      ...wallet.specs,
      balance,
      transactions,
      lastSynched: Date.now(),
    };

    return updatedSpecs;
  } catch (error) {
    return wallet.specs;
  }
};

/**
 * Get private key for signing (if available)
 */
export const getPrivateKeyForSigning = (wallet: USDTWallet): string => {
  return wallet.specs.privateKey;
};
