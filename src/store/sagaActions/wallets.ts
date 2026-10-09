import { Signer, Vault, VaultSigner } from 'src/services/wallets/interfaces/vault';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { SignerRestriction } from 'src/models/interfaces/AssistedKeys';
import { NewWalletInfo } from '../sagas/wallets';

// types and action creators: dispatched by components and sagas
export const GET_TESTCOINS = 'GET_TESTCOINS';
export const AUTO_SYNC_WALLETS = 'AUTO_SYNC_WALLETS';
export const UPDATE_SIGNER_POLICY = 'UPDATE_SIGNER_POLICY';
export const ADD_NEW_WALLETS = 'ADD_NEW_WALLETS';
export const REFRESH_WALLETS = 'REFRESH_WALLETS';
export const TEST_SATS_RECIEVE = 'TEST_SATS_RECIEVE';
export const UPDATE_WALLET_DETAILS = 'UPDATE_WALLET_DETAILS';
export const UPDATE_VAULT_DETAILS = 'UPDATE_VAULT_DETAILS';
export const UPDATE_SIGNER_DETAILS = 'UPDATE_SIGNER_DETAILS';
export const UPDATE_KEY_DETAILS = 'UPDATE_KEY_DETAILS';
export const GENERATE_NEW_ADDRESS = 'GENERATE_NEW_ADDRESS';
export const TESTCOINS_RECEIVED = 'TESTCOINS_RECEIVED';
export const WALLETS_SYNCHED = 'WALLETS_SYNCHED';
export const UPDATED_VAULT_SIGNERS_XPRIV = 'UPDATED_VAULT_SIGNERS_XPRIV';

export const getTestcoins = (testWallet: Wallet) => ({
  type: GET_TESTCOINS,
  payload: testWallet,
});

// This is called once per login to automatically sync balances and
// transactions of all shells
export const autoSyncWallets = (
  syncAll?: boolean,
  hardRefresh?: boolean,
  addNotifications?: boolean,
  originAppId?: string
) => ({
  type: AUTO_SYNC_WALLETS,
  ...(originAppId ? { originAppId } : {}),
  payload: {
    syncAll,
    hardRefresh,
    addNotifications,
    backupCheckAppId: originAppId,
  },
});

export const updateSignerPolicy = (
  signer: Signer,
  signingKey: VaultSigner,
  updates: {
    restrictions: SignerRestriction;
    signingDelay: number;
  },
  verificationToken,
  originAppId?: string
) => ({
  type: UPDATE_SIGNER_POLICY,
  originAppId,
  payload: {
    signer,
    signingKey,
    updates,
    verificationToken,
  },
});

export const refreshWallets = (
  wallets: (Wallet | Vault)[],
  options: { hardRefresh?: boolean, dustScan?: boolean }
) => ({
  type: REFRESH_WALLETS,
  payload: {
    wallets,
    options,
  },
});

export const addNewWallets = (payload: NewWalletInfo[]) => ({
  type: ADD_NEW_WALLETS,
  payload,
});

export const testcoinsReceived = () => ({
  type: TESTCOINS_RECEIVED,
});

export const walletsSynched = (synched) => ({
  type: WALLETS_SYNCHED,
  payload: {
    synched,
  },
});

export const testSatsRecieve = (wallet: Wallet | Vault) => ({
  type: TEST_SATS_RECIEVE,
  payload: {
    wallet,
  },
});

export const updateWalletDetails = (
  wallet: Wallet,
  details: {
    name: string;
    description: string;
  }
) => ({
  type: UPDATE_WALLET_DETAILS,
  payload: {
    wallet,
    details,
  },
});

export const updateVaultDetails = (
  vault: Vault,
  details: {
    name: string;
    description: string;
  }
) => ({
  type: UPDATE_VAULT_DETAILS,
  payload: {
    vault,
    details,
  },
});

export const updateSignerDetails = (signer: Signer, key: string, value: any) => ({
  type: UPDATE_SIGNER_DETAILS,
  payload: {
    signer,
    key,
    value,
  },
});

export const updateKeyDetails = (signer: VaultSigner, key: string, value: any) => ({
  type: UPDATE_KEY_DETAILS,
  payload: {
    signer,
    key,
    value,
  },
});

export const generateNewAddress = (wallet: Wallet | Vault, originAppId?: string) => ({
  type: GENERATE_NEW_ADDRESS,
  originAppId,
  payload: { wallet },
});

export const updateVaultSignersXpriv = (signers: Signer[]) => ({
  type: UPDATED_VAULT_SIGNERS_XPRIV,
  signers,
});
