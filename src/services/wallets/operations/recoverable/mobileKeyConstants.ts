/**
 * BIP85 indexes 0–99 belong to Keeper hot wallets/MY_KEEPER signers, and
 * 100–199 belong to USDT wallets. Keep this range exclusive to testnet
 * Recoverable Wallet Mobile Keys, even when earlier wallets are deleted.
 * A future mainnet scheme must receive its own namespace and version.
 */
export const RECOVERABLE_MOBILE_KEY_INDEX_START = 1_000_000;
export const RECOVERABLE_MOBILE_KEY_MAX_ORDINAL = 99_999;
export const RECOVERABLE_MOBILE_KEY_VERSION = 1 as const;
export const RECOVERABLE_MOBILE_KEY_SIGNER_PATH = "m/48'/1'/0'/2'";
