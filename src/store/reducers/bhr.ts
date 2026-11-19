import { RepairPhase } from 'src/services/backup/repair';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { BackupType, homeToastMessageType } from 'src/models/enums/BHR';
import _ from 'lodash';
import { reduxStorage } from 'src/storage';
import { persistReducer } from 'redux-persist';
import { VaultSigner } from 'src/services/wallets/interfaces/vault';
import { seedWordItem } from 'src/screens/Recovery/constants';

const initialState: {
  backupMethod: BackupType | null;
  isBackupError: boolean;
  backupError: string;
  seedConfirmed: boolean;
  loading: boolean;
  appImageError: string;
  appImagerecoveryRetry: boolean;
  signingDevices: VaultSigner[];

  relayWalletUpdateLoading: boolean;
  relayWalletUpdate: boolean;
  relayWalletError: boolean;
  realyWalletErrorMessage: string;

  relaySignersUpdateLoading: boolean;
  relaySignersUpdate: boolean;
  relaySignerUpdateError: boolean;
  realySignersUpdateErrorMessage: string;
  realySignersAdded: boolean;

  relayVaultUpdateLoading: boolean;
  relayVaultUpdate: boolean;
  relayVaultError: boolean;
  realyVaultErrorMessage: string;
  isCloudBsmsBackupRequired: boolean;

  deletingKeyModalVisible: boolean;
  keyDeletedSuccessModalVisible: boolean;

  seedWords: Array<seedWordItem>;

  backupAllLoading: boolean;
  backupAllSuccess: boolean;
  backupAllFailure: boolean;

  pendingAllBackup: boolean;
  backupRepairCompletedByAppId: Record<string, boolean>;
  backupRepairStateByAppId: Record<string, RepairPhase>;
  backupRepairRunningByAppId: Record<string, boolean>;

  automaticCloudBackup: boolean;

  deleteBackupSuccess: boolean;
  deleteBackupFailure: boolean;
  homeToastMessage: homeToastMessageType;
} = {
  backupMethod: null,
  isBackupError: false,
  backupError: '',
  seedConfirmed: false,
  loading: false,

  appImageError: '',

  appImagerecoveryRetry: false,
  signingDevices: [],
  relayWalletUpdateLoading: false,
  relayWalletUpdate: false,
  relayWalletError: false,
  realyWalletErrorMessage: null,
  relayVaultUpdateLoading: false,
  relayVaultUpdate: false,
  relayVaultError: false,
  realyVaultErrorMessage: null,
  relaySignersUpdateLoading: false,
  relaySignersUpdate: false,
  relaySignerUpdateError: false,
  realySignersUpdateErrorMessage: null,
  realySignersAdded: false,

  isCloudBsmsBackupRequired: false,
  deletingKeyModalVisible: false,
  keyDeletedSuccessModalVisible: false,
  seedWords: [],

  backupAllLoading: false,
  backupAllFailure: false,
  backupAllSuccess: false,

  pendingAllBackup: false,
  backupRepairCompletedByAppId: {},
  backupRepairStateByAppId: {},
  backupRepairRunningByAppId: {},

  automaticCloudBackup: false,

  deleteBackupSuccess: false,
  deleteBackupFailure: false,

  homeToastMessage: { message: null, isError: false },
};

const bhrSlice = createSlice({
  name: 'bhr',
  initialState,
  reducers: {
    setBackupType: (state, action: PayloadAction<BackupType>) => {
      state.backupMethod = action.payload;
    },
    setSeedConfirmed: (state, action: PayloadAction<boolean>) => {
      state.seedConfirmed = action.payload;
    },
    setBackupLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setBackupError: (state, action: PayloadAction<{ isError: boolean; error: string }>) => {
      state.backupError = action.payload.error;
      state.isBackupError = action.payload.isError;
    },
    setAppImageError: (state, action: PayloadAction<string>) => {
      state.appImageError = action.payload;
    },
    appImagerecoveryRetry: (state) => {
      state.appImagerecoveryRetry = !state.appImagerecoveryRetry;
    },
    setSigningDevices: (state, action: PayloadAction<any>) => {
      state.signingDevices = _.uniqBy([...state.signingDevices, action.payload], 'signerId');
    },
    setRelayWalletUpdateLoading: (state, action: PayloadAction<boolean>) => {
      state.relayWalletUpdateLoading = action.payload;
    },
    relayWalletUpdateSuccess: (state) => {
      state.relayWalletUpdate = true;
      state.relayWalletError = false;
      state.relayWalletUpdateLoading = false;
      state.realyWalletErrorMessage = null;
    },
    relayWalletUpdateFail: (state, action: PayloadAction<string>) => {
      state.relayWalletError = true;
      state.realyWalletErrorMessage = action.payload;
      state.relayWalletUpdateLoading = false;
    },
    resetRealyWalletState: (state) => {
      state.relayWalletError = false;
      state.relayWalletUpdate = false;
      state.relayWalletUpdateLoading = false;
      state.realyWalletErrorMessage = null;
    },

    setRelaySignersUpdateLoading: (state, action: PayloadAction<boolean>) => {
      state.relaySignersUpdateLoading = action.payload;
    },

    // Action payload is whether a new signer has been added
    relaySignersUpdateSuccess: (state, action: PayloadAction<boolean>) => {
      state.relaySignersUpdate = true;
      state.relaySignerUpdateError = false;
      state.relaySignersUpdateLoading = false;
      state.realySignersUpdateErrorMessage = null;
      state.realySignersAdded = action.payload;
    },
    relaySignersUpdateFail: (state, action: PayloadAction<string>) => {
      state.relaySignerUpdateError = true;
      state.relaySignersUpdateLoading = false;
      state.realySignersUpdateErrorMessage = action.payload;
      state.realySignersAdded = false;
    },
    resetSignersUpdateState: (state) => {
      state.relaySignersUpdate = false;
      state.relaySignerUpdateError = false;
      state.relaySignersUpdateLoading = false;
      state.realySignersUpdateErrorMessage = null;
      state.realySignersAdded = false;
    },

    setRelayVaultUpdateLoading: (state, action: PayloadAction<boolean>) => {
      state.relayVaultUpdateLoading = action.payload;
    },
    relayVaultUpdateSuccess: (state) => {
      state.relayVaultUpdate = true;
      state.relayVaultUpdateLoading = false;
    },
    relayVaultUpdateFail: (state, action: PayloadAction<string>) => {
      state.relayVaultError = true;
      state.realyVaultErrorMessage = action.payload;
      state.relayVaultUpdateLoading = false;
    },
    resetRealyVaultState: (state) => {
      state.relayVaultError = false;
      state.relayVaultUpdate = false;
      state.relayVaultUpdateLoading = false;
      state.realyVaultErrorMessage = null;
    },
    setIsCloudBsmsBackupRequired: (state, action: PayloadAction<boolean>) => {
      state.isCloudBsmsBackupRequired = action.payload;
    },
    showDeletingKeyModal: (state) => {
      state.deletingKeyModalVisible = true;
    },
    hideDeletingKeyModal: (state) => {
      state.deletingKeyModalVisible = false;
    },
    showKeyDeletedSuccessModal: (state) => {
      state.keyDeletedSuccessModalVisible = true;
    },
    hideKeyDeletedSuccessModal: (state) => {
      state.keyDeletedSuccessModalVisible = false;
    },
    setSeedWord: (state, action: PayloadAction<{ index: number; wordItem: seedWordItem }>) => {
      const { index, wordItem } = action.payload;
      state.seedWords[index] = wordItem;
    },

    setSeedWords: (state, action: PayloadAction<seedWordItem[]>) => {
      state.seedWords = action.payload;
    },

    resetSeedWords: (state) => {
      state.seedWords = [];
    },
    setBackupAllLoading: (state, action: PayloadAction<boolean>) => {
      state.backupAllLoading = action.payload;
    },
    setBackupAllSuccess: (state, action: PayloadAction<boolean>) => {
      state.backupAllSuccess = action.payload;
      state.backupAllLoading = false;
    },
    setBackupAllFailure: (state, action: PayloadAction<boolean>) => {
      state.backupAllFailure = action.payload;
      state.backupAllLoading = false;
    },
    setPendingAllBackup: (state, action: PayloadAction<boolean>) => {
      state.pendingAllBackup = action.payload;
    },

    setBackupRepairState: (state, action: PayloadAction<{ appId: string; phase: RepairPhase }>) => {
      const { appId, phase } = action.payload;
      (state.backupRepairStateByAppId ??= {})[appId] = phase;
      (state.backupRepairCompletedByAppId ??= {})[appId] = phase === 'verified';
    },
    setBackupRepairRunning: (state, action: PayloadAction<{ appId: string; running: boolean }>) => {
      (state.backupRepairRunningByAppId ??= {})[action.payload.appId] = action.payload.running;
    },
    invalidateBackupRepair: (state, action: PayloadAction<string>) => {
      (state.backupRepairCompletedByAppId ??= {})[action.payload] = false;
      if (state.backupRepairStateByAppId?.[action.payload] === 'verified')
        state.backupRepairStateByAppId[action.payload] = 'unverified';
    },
    setAutomaticCloudBackup: (state, action: PayloadAction<boolean>) => {
      state.automaticCloudBackup = action.payload;
    },
    setDeleteBackupSuccess: (state, action: PayloadAction<boolean>) => {
      state.deleteBackupSuccess = action.payload;
    },
    setDeleteBackupFailure: (state, action: PayloadAction<boolean>) => {
      state.deleteBackupFailure = action.payload;
    },
    setHomeToastMessage: (state, action: PayloadAction<homeToastMessageType>) => {
      state.homeToastMessage = action.payload;
    },
  },
});

export const {
  setBackupType,
  setSeedConfirmed,
  setBackupError,
  setBackupLoading,
  setAppImageError,
  appImagerecoveryRetry,

  setSigningDevices,

  setRelayWalletUpdateLoading,
  relayWalletUpdateSuccess,
  relayWalletUpdateFail,
  resetRealyWalletState,

  setRelaySignersUpdateLoading,
  relaySignersUpdateSuccess,
  relaySignersUpdateFail,
  resetSignersUpdateState,

  setRelayVaultUpdateLoading,
  relayVaultUpdateSuccess,
  relayVaultUpdateFail,
  resetRealyVaultState,

  setIsCloudBsmsBackupRequired,

  showDeletingKeyModal,
  hideDeletingKeyModal,
  showKeyDeletedSuccessModal,
  hideKeyDeletedSuccessModal,

  setSeedWord,
  resetSeedWords,

  setBackupAllLoading,
  setBackupAllSuccess,
  setBackupAllFailure,

  setPendingAllBackup,
  setBackupRepairState,
  setBackupRepairRunning,
  invalidateBackupRepair,

  setAutomaticCloudBackup,

  setDeleteBackupSuccess,
  setDeleteBackupFailure,

  setHomeToastMessage,
} = bhrSlice.actions;

const bhrPersistConfig = {
  key: 'bhr',
  storage: reduxStorage,
  blacklist: [
    'backupRepairRunningByAppId',
    'isBackupError',
    'backupError',
    'seedConfirmed',
    'loading',
    'appImageError',
    'appImagerecoveryRetry',

    'relayWalletUpdateLoading',
    'relayWalletUpdate',
    'relayWalletError',
    'realyWalletErrorMessage',

    'relayVaultUpdateLoading',
    'relayVaultUpdate',
    'relayVaultError',
    'realyVaultErrorMessage',

    'relaySignersUpdateLoading',
    'relaySignersUpdate',
    'relaySignerUpdateError',
    'realySignersUpdateErrorMessage',
    'cloudBsmsBackupError',

    'seedWords',

    'backupAllLoading',
    'backupAllFailure',
    'backupAllSuccess',

    'deleteBackupSuccess',
    'deleteBackupFailure',

    'homeToastMessage',
  ],
};

export default persistReducer(bhrPersistConfig, bhrSlice.reducer);
