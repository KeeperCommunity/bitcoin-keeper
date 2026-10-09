import { GasFreeTransferStatus } from './GasFree';
import { NetworkType } from 'src/services/wallets/enums';
import { isValidTronAddress, getTrc20Balance, getTrc20Transactions } from './Tron';
import { USDTWallet } from '../../factories/USDTWalletFactory';

// Keep these addresses for existing wallets' balance and history reads.
const USDT_ADDRESSES = {
  [NetworkType.MAINNET]: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  [NetworkType.TESTNET]: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
};

export const USDT_GASFREE_FEE_ADDRESSES = {
  [NetworkType.MAINNET]: 'TLntW9Z59LYY5KEi9cmwk3PKjQga828ird',
  [NetworkType.TESTNET]: 'TCETRh3aED4kdkaYQY7CcxeTJtrQvwBpNT',
};

export const DEFAULT_DEADLINE_SECONDS = 300;
export const USDT_ACTIVITY_PAUSED = 'USDT activity is paused';

export interface USDTTransferOptions {
  source: USDTWallet;
  toAddress: string;
  amount: number;
  serviceProviderAddress?: string;
  maxFeeInUSDT?: number;
  deadlineInSeconds?: number;
  networkType?: NetworkType;
}

export interface USDTTransferResult {
  success: boolean;
  traceId?: string;
  transactionHash?: string;
  error?: string;
  transaction?: USDTTransaction;
}

// Stored account fields are retained for Realm and encrypted backup compatibility.
export interface USDTAccountStatus {
  address: string;
  gasFreeAddress: string;
  isActive: boolean;
  frozen: number;
  canTransfer: boolean;
  nextNonce: number;
  fees: { transferFee: number; activateFee: number };
}

export interface USDTTransaction {
  txId?: string;
  traceId?: string;
  from: string;
  to: string;
  amount: string;
  transferFee?: number;
  activateFee?: number;
  fee?: string;
  status: GasFreeTransferStatus;
  timestamp: number;
  blockNumber?: number;
  isGasFree: boolean;
}

export const isHistoricalUnverifiedUSDTRequest = (
  transaction: Pick<USDTTransaction, 'traceId' | 'txId'>
): boolean => Boolean(transaction.traceId && !transaction.txId);

export default class USDT {
  private static getUSDTAddress(networkType?: NetworkType): string {
    return USDT_ADDRESSES[networkType || NetworkType.MAINNET];
  }

  public static getUSDTGasFreeFeeAddress(networkType?: NetworkType): string {
    return USDT_GASFREE_FEE_ADDRESSES[networkType || NetworkType.MAINNET];
  }

  // Retired provider operations fail closed, including calls from stale routes.
  public static async isGasFreeSupported(_networkType?: NetworkType): Promise<boolean> {
    return false;
  }

  public static async getServiceProviders(_networkType?: NetworkType): Promise<never[]> {
    return [];
  }

  public static async getAccountStatus(
    _address: string,
    _networkType?: NetworkType
  ): Promise<USDTAccountStatus> {
    throw new Error(USDT_ACTIVITY_PAUSED);
  }

  public static async prepareTransfer(_options: USDTTransferOptions): Promise<{
    isValid: boolean;
    error?: string;
    signaturePayload?: unknown;
    fees?: { transferFee: number; activateFee: number; totalFee: number };
  }> {
    return { isValid: false, error: USDT_ACTIVITY_PAUSED };
  }

  public static async submitTransfer(
    _source: USDTWallet,
    _signaturePayload: unknown
  ): Promise<USDTTransferResult> {
    return { success: false, error: USDT_ACTIVITY_PAUSED };
  }

  public static async getTransferStatus(
    _traceId: string,
    _networkType?: NetworkType
  ): Promise<never> {
    throw new Error(USDT_ACTIVITY_PAUSED);
  }

  public static async monitorTransfer(
    traceId: string,
    _onStatusUpdate?: (status: any) => void,
    _networkType?: NetworkType
  ): Promise<USDTTransferResult> {
    return { success: false, traceId, error: USDT_ACTIVITY_PAUSED };
  }

  // Retain old fee information for historical transaction screens.
  public static evaluateTransferFee(accountStatus: USDTAccountStatus): {
    transferFee: number;
    activateFee: number;
    totalFee: number;
  } {
    const { activateFee, transferFee } = accountStatus.fees;
    return {
      transferFee,
      activateFee,
      totalFee: transferFee + (accountStatus.isActive ? 0 : activateFee),
    };
  }

  public static isValidAddress(address: string, networkType: NetworkType): boolean {
    return isValidTronAddress(address, networkType);
  }

  public static formatUSDTAmount(amount: number, decimals: number = 2): string {
    return amount.toFixed(decimals);
  }

  public static parseUSDTAmount(amountString: string): number {
    const parsed = parseFloat(amountString);
    if (isNaN(parsed) || parsed <= 0) throw new Error('Invalid USDT amount');
    return parsed;
  }

  public static async getUSDTBalance(
    address: string,
    networkType: NetworkType = NetworkType.MAINNET
  ): Promise<number> {
    try {
      const result = await getTrc20Balance(address, USDT.getUSDTAddress(networkType), networkType);
      return result.balance;
    } catch (error) {
      throw new Error(`Failed to fetch USDT balance: ${error.message || error}`);
    }
  }

  public static async getUSDTTransactions(
    address: string,
    networkType: NetworkType,
    limit: number = 100,
    fingerprint?: string
  ): Promise<{
    transactions: USDTTransaction[];
    meta: { fingerprint: string; hasMore: boolean };
  }> {
    const contract = USDT.getUSDTAddress(networkType);
    const result = await getTrc20Transactions(address, contract, networkType, limit, fingerprint);
    const transactions = result.transactions.map((txn) => {
      // TronGrid can return a timestamp for an unconfirmed transfer. Require
      // both fields so the stored status and pending indicator agree.
      const confirmed = Boolean(txn.confirmed && txn.blockNumber);
      return {
        txId: txn.transactionId,
        from: txn.from,
        to: txn.to,
        amount: txn.formattedValue.toString(),
        status: confirmed ? GasFreeTransferStatus.SUCCEED : GasFreeTransferStatus.CONFIRMING,
        timestamp: txn.blockTimestamp,
        blockNumber: confirmed ? txn.blockNumber : 0,
        isGasFree: txn.to !== address,
      };
    });
    return { transactions, meta: result.meta };
  }
}
