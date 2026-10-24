import { NetworkType } from '../../enums';
import * as bip39 from 'bip39';
import BIP32Factory from 'bip32';
import ecc from '../taproot-utils/noble_ecc';
import * as bitcoinJS from 'bitcoinjs-lib';
import { TronWeb } from 'tronweb';
const bip32 = BIP32Factory(ecc);

// TRON network configurations
const TRON_NETWORKS = {
  [NetworkType.MAINNET]: {
    fullHost: 'https://api.trongrid.io',
    solidityNode: 'https://api.trongrid.io',
    eventServer: 'https://api.trongrid.io',
  },
  [NetworkType.TESTNET]: {
    fullHost: 'https://nile.trongrid.io',
    solidityNode: 'https://nile.trongrid.io',
    eventServer: 'https://nile.trongrid.io',
  },
};

// TRON derivation path: m/44'/195'/account'/0/0
// 195 is TRON's coin type from SLIP-0044
export const DEFAULT_TRON_DERIVATION_PATH = `m/44'/195'/0'/0/0`;

/**
 * TRC20 Transaction interface
 */
export interface TRC20Transaction {
  transactionId: string;
  blockNumber: number;
  blockTimestamp: number;
  from: string;
  to: string;
  value: string; // Raw value in smallest unit
  formattedValue: number; // Human readable value
  contractAddress: string;
  confirmed: boolean;
  tokenInfo?: {
    symbol: string;
    name: string;
    decimals: number;
  };
}

/**
 * Create TronWeb instance for specified network
 */
export function createTronWeb(networkType: NetworkType): any {
  return new TronWeb(TRON_NETWORKS[networkType]);
}
/**
 * Generate a new TRON wallet with private key
 */
export const generateTronWallet = (networkType: NetworkType = NetworkType.MAINNET) => {
  try {
    const tronWeb = createTronWeb(networkType);
    const account = tronWeb.createAccount();

    return {
      address: account.address.base58,
      privateKey: account.privateKey,
      publicKey: account.publicKey,
    };
  } catch (error) {
    throw new Error('Failed to generate TRON wallet');
  }
};

/**
 * Create TRON wallet from private key
 */
export const createTronWalletFromPrivateKey = (
  privateKey: string,
  networkType: NetworkType = NetworkType.MAINNET
) => {
  try {
    const tronWeb = createTronWeb(networkType);
    const cleanPrivateKey = privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey;
    // Ensure it's exactly 64 hex characters (32 bytes)
    if (!/^[a-fA-F0-9]{64}$/.test(cleanPrivateKey)) {
      throw new Error('Invalid private key format. Must be 64 hex characters.');
    }

    let address: string = tronWeb.address.fromPrivateKey(cleanPrivateKey);
    return {
      address,
      privateKey: cleanPrivateKey,
      isValid: true,
    };
  } catch (error) {
    throw new Error(`Failed to create TRON wallet from private key: ${error.message}`);
  }
};

/**
 * Create TRON wallet from mnemonic using SLIP-0044 derivation path
 * TRON coin type: 195 (m/44'/195'/0'/0/0)
 */
export const createTronWalletFromMnemonic = (mnemonic: string, networkType: NetworkType) => {
  try {
    // Validate mnemonic
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }

    // Generate seed from mnemonic
    const network =
      networkType === NetworkType.MAINNET ? bitcoinJS.networks.bitcoin : bitcoinJS.networks.testnet;
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed, network);

    const child = root.derivePath(DEFAULT_TRON_DERIVATION_PATH);

    // Get private key from derived child
    const privateKey = child.privateKey.toString('hex');
    return createTronWalletFromPrivateKey(privateKey, networkType);
  } catch (error) {
    throw new Error(`Failed to create TRON wallet from mnemonic: ${error.message}`);
  }
};

/**
 * Validate TRON address format using TronWeb
 */
export function isValidTronAddress(address: string, networkType: NetworkType): boolean {
  try {
    const tronWeb = createTronWeb(networkType);
    return tronWeb.isAddress(address);
  } catch {
    return false;
  }
}

/**
 * Get TRC20 token balance from TRON blockchain
 */
export async function getTrc20Balance(
  address: string,
  tokenContract: string,
  networkType: NetworkType = NetworkType.MAINNET
): Promise<{ balance: number; decimals: number }> {
  try {
    // Get the network-aware TronWeb instance
    const tronWebInstance = createTronWeb(networkType);

    // Validate addresses first
    if (!tronWebInstance.isAddress(address)) {
      throw new Error('Invalid user address');
    }
    if (!tronWebInstance.isAddress(tokenContract)) {
      throw new Error('Invalid token contract address');
    }

    // Convert addresses to the proper format for contract calls
    const ownerAddressHex = tronWebInstance.address.toHex(address).substring(2); // Remove 0x prefix
    const contractAddressHex = tronWebInstance.address.toHex(tokenContract);

    // Get balance using proper parameter formatting
    let balance = 0;
    let decimals = 6; // Default to 6 for USDT

    // Try to get balance with proper parameter encoding
    const balanceResult = await tronWebInstance.transactionBuilder.triggerSmartContract(
      contractAddressHex,
      'balanceOf(address)',
      {},
      [{ type: 'address', value: ownerAddressHex }],
      address
    );

    if (balanceResult && balanceResult.constant_result && balanceResult.constant_result[0]) {
      balance = parseInt(balanceResult.constant_result[0], 16);
    }

    // Convert balance from raw units to human-readable units
    const formattedBalance = balance / Math.pow(10, decimals);

    return {
      balance: formattedBalance,
      decimals,
    };
  } catch (error) {
    throw new Error(`Failed to get TRC20 balance: ${error.message}`);
  }
}

/**
 * Get TRC20 token transactions for an address
 */
export async function getTrc20Transactions(
  address: string,
  tokenContract: string,
  networkType: NetworkType = NetworkType.MAINNET,
  limit: number = 100,
  fingerprint?: string // For pagination
): Promise<{
  transactions: TRC20Transaction[];
  meta: {
    fingerprint: string;
    hasMore: boolean;
  };
}> {
  try {
    const tronWebInstance = createTronWeb(networkType);

    // Validate addresses
    if (!tronWebInstance.isAddress(address)) {
      throw new Error('Invalid user address');
    }
    if (!tronWebInstance.isAddress(tokenContract)) {
      throw new Error('Invalid token contract address');
    }

    // Use TronGrid API to get TRC20 transfers
    const baseUrl =
      networkType === NetworkType.TESTNET ? 'https://nile.trongrid.io' : 'https://api.trongrid.io';

    // Build query parameters
    const params = new URLSearchParams({
      limit: limit.toString(),
      contract_address: tokenContract,
      only_confirmed: 'true',
    });

    if (fingerprint) {
      params.append('fingerprint', fingerprint);
    }

    // Get transactions where address is either sender or receiver
    const url = `${baseUrl}/v1/accounts/${address}/transactions/trc20?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`TronGrid API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(`TronGrid API error: ${data.error || 'Unknown error'}`);
    }

    // Process transactions
    const transactions: TRC20Transaction[] = (data.data || []).map((tx: any) => {
      const decimals = tx.token_info?.decimals || 6;
      const rawValue = tx.value || '0';
      const formattedValue = parseInt(rawValue) / Math.pow(10, decimals);

      return {
        transactionId: tx.transaction_id,
        blockNumber: tx.block_timestamp ? Math.floor(tx.block_timestamp / 1000) : 0,
        blockTimestamp: tx.block_timestamp,
        from: tx.from,
        to: tx.to,
        value: rawValue,
        formattedValue,
        contractAddress: tx.token_info?.address || tokenContract,
        // The TRC20 response row need not carry a confirmation flag. The
        // request filter establishes it unless a row explicitly contradicts it.
        confirmed: tx.confirmed !== false,
        tokenInfo: tx.token_info
          ? {
              symbol: tx.token_info.symbol,
              name: tx.token_info.name,
              decimals: tx.token_info.decimals,
            }
          : undefined,
      };
    });

    return {
      transactions,
      meta: {
        fingerprint: data.meta?.fingerprint || '',
        hasMore: (data.meta?.page_size || 0) === limit,
      },
    };
  } catch (error) {
    throw new Error(`Failed to get TRC20 transactions: ${error.message}`);
  }
}
