import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import persistReducer from 'redux-persist/es/persistReducer';
import { Vault } from 'src/services/wallets/interfaces/vault';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { reduxStorage } from 'src/storage';
import { ADD_NEW_WALLETS } from '../sagaActions/wallets';

export type WalletsState = {
  walletsSynched: boolean;

  isGeneratingNewWallet: boolean;
  hasNewWalletsGenerationSucceeded: boolean;
  hasNewWalletsGenerationFailed: boolean;

  isUpdatingWalletSettings: boolean;
  hasWalletSettingsUpdateSucceeded: boolean;

  testCoinsReceived: boolean;
  testCoinsFailed: boolean;
  testCoinsQuotaReached: boolean;

  introModal: boolean;
  err: string;
  walletSyncing: {};
  refreshRequests: Record<string, 'pending' | 'success' | 'failure'>;
  signerPolicyError?: string;
};

const initialState: WalletsState = {
  walletsSynched: false,
  signerPolicyError: 'idle',
  isGeneratingNewWallet: false,
  hasNewWalletsGenerationSucceeded: false,
  hasNewWalletsGenerationFailed: false,

  isUpdatingWalletSettings: false,
  hasWalletSettingsUpdateSucceeded: false,

  testCoinsReceived: false,
  testCoinsFailed: false,
  testCoinsQuotaReached: false,

  introModal: true,

  err: '',
  walletSyncing: {},
  refreshRequests: {},
};

export type syncingPayload = {
  wallets: (Wallet | Vault)[];
  isSyncing: boolean;
};

const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    walletsSynched: (state, action: PayloadAction<boolean>) => {
      state.walletsSynched = action.payload;
    },
    setTestCoinsReceived: (state, action: PayloadAction<boolean>) => {
      state.testCoinsReceived = action.payload;
    },
    setTestCoinsFailed: (state, action: PayloadAction<boolean>) => {
      state.testCoinsFailed = action.payload;
    },
    setTestCoinsQuotaReached: (state, action: PayloadAction<boolean>) => {
      state.testCoinsQuotaReached = action.payload;
    },
    setIntroModal: (state, action: PayloadAction<boolean>) => {
      state.introModal = action.payload;
    },
    walletGenerationFailed: (state, action: PayloadAction<string>) => {
      state.hasNewWalletsGenerationFailed = true;
      state.isGeneratingNewWallet = false;
      state.err = action.payload;
    },
    newWalletCreated: (state) => {
      state.isGeneratingNewWallet = false;
      state.hasNewWalletsGenerationSucceeded = true;
      state.hasNewWalletsGenerationFailed = false;
      state.err = '';
    },
    resetWalletStateFlags: (state) => {
      state.isGeneratingNewWallet = false;
      state.hasNewWalletsGenerationSucceeded = false;
      state.hasNewWalletsGenerationFailed = false;
      state.err = '';
    },
    setSyncing: (state, action: PayloadAction<syncingPayload>) => {
      const { wallets, isSyncing } = action.payload;
      wallets.forEach((wallet) => {
        state.walletSyncing = { ...state.walletSyncing, [wallet.id]: isSyncing };
      });
    },
    resetSyncing: (state) => {
      state.walletSyncing = {};
      state.refreshRequests = {};
    },
    startRefreshRequest: (state, action: PayloadAction<string>) => {
      state.refreshRequests[action.payload] = 'pending';
    },
    finishRefreshRequest: (
      state,
      action: PayloadAction<{ requestId: string; succeeded: boolean }>
    ) => {
      if (state.refreshRequests[action.payload.requestId] === 'pending') {
        state.refreshRequests[action.payload.requestId] = action.payload.succeeded
          ? 'success'
          : 'failure';
      }
    },
    clearRefreshRequest: (state, action: PayloadAction<string>) => {
      delete state.refreshRequests[action.payload];
    },
    setSignerPolicyError: (state, action: PayloadAction<string>) => {
      state.signerPolicyError = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(ADD_NEW_WALLETS, (state) => {
      state.isGeneratingNewWallet = true;
      state.hasNewWalletsGenerationSucceeded = false;
      state.hasNewWalletsGenerationFailed = false;
      state.err = '';
    });
  },
});

export const {
  walletsSynched,
  setTestCoinsReceived,
  setTestCoinsFailed,
  setTestCoinsQuotaReached,
  setIntroModal,
  walletGenerationFailed,
  newWalletCreated,
  resetWalletStateFlags,
  resetSyncing,
  setSyncing,
  startRefreshRequest,
  finishRefreshRequest,
  clearRefreshRequest,
  setSignerPolicyError,
} = walletSlice.actions;

const walletPersistConfig = {
  key: 'wallet',
  storage: reduxStorage,
  blacklist: [
    'testCoinsReceived',
    'testCoinsFailed',
    'testCoinsQuotaReached',
    'hasNewWalletsGenerationFailed',
    'hasNewWalletsGenerationSucceeded',
    'isGeneratingNewWallet',
    'walletSyncing',
    'refreshRequests',
    'setSignerPolicyError',
  ],
};
export default persistReducer(walletPersistConfig, walletSlice.reducer);
