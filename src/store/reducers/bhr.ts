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
  backupAllLoadingByAppId: Record<string, boolean>;
  backupAllSuccessByAppId: Record<string, boolean>;
  backupAllFailureByAppId: Record<string, boolean>;

  pendingAllBackup: boolean;
  pendingAllBackupByAppId: Record<string, boolean>;
  backupRepairCompletedByAppId: Record<string, boolean>;
  backupRepairStateByAppId: Record<string, RepairPhase>;
  backupRepairRunningByAppId: Record<string, boolean>;

  // The legacy flag is retained only until the first authenticated migration.
  automaticCloudBackup: boolean;
  automaticCloudBackupByAppId: Record<string, boolean>;

  deleteBackupSuccess: boolean;
  deleteBackupFailure: boolean;
  deleteBackupSuccessByAppId: Record<string, boolean>;
  deleteBackupFailureByAppId: Record<string, boolean>;
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
  backupAllLoadingByAppId: {},
  backupAllSuccessByAppId: {},
  backupAllFailureByAppId: {},

  pendingAllBackup: false,
  pendingAllBackupByAppId: {},
  backupRepairCompletedByAppId: {},
  backupRepairStateByAppId: {},
  backupRepairRunningByAppId: {},

  automaticCloudBackup: false,
  automaticCloudBackupByAppId: {},

  deleteBackupSuccess: false,
  deleteBackupFailure: false,
  deleteBackupSuccessByAppId: {},
  deleteBackupFailureByAppId: {},

  homeToastMessage: { message: null, isError: false },
};

export const isAutomaticCloudBackupEnabled = (
  backup: { automaticCloudBackupByAppId?: Record<string, boolean> },
  appId?: string
): boolean => !!appId && backup.automaticCloudBackupByAppId?.[appId] === true;

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
    setBackupAllLoading: (
      state,
      action: PayloadAction<{ appId: string; status: boolean }>
    ) => {
      const { appId, status } = action.payload;
      if (!appId) return;
      (state.backupAllLoadingByAppId ??= {})[appId] = status;
    },
    setBackupAllSuccess: (
      state,
      action: PayloadAction<{ appId: string; status: boolean }>
    ) => {
      const { appId, status } = action.payload;
      if (!appId) return;
      (state.backupAllSuccessByAppId ??= {})[appId] = status;
      (state.backupAllLoadingByAppId ??= {})[appId] = false;
    },
    setBackupAllFailure: (
      state,
      action: PayloadAction<{ appId: string; status: boolean }>
    ) => {
      const { appId, status } = action.payload;
      if (!appId) return;
      (state.backupAllFailureByAppId ??= {})[appId] = status;
      (state.backupAllLoadingByAppId ??= {})[appId] = false;
    },
    setPendingAllBackup: (
      state,
      action: PayloadAction<{ appId: string; pending: boolean }>
    ) => {
      const { appId, pending } = action.payload;
      if (!appId) return;
      (state.pendingAllBackupByAppId ??= {})[appId] = pending;
      state.pendingAllBackup = false;
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
    setAutomaticCloudBackup: (
      state,
      action: PayloadAction<{ appId: string; enabled: boolean }>
    ) => {
      const { appId, enabled } = action.payload;
      if (!appId) return;
      (state.automaticCloudBackupByAppId ??= {})[appId] = enabled;
      if (!enabled) (state.backupAllSuccessByAppId ??= {})[appId] = false;
      state.automaticCloudBackup = false;
    },
    migrateLegacyAutomaticCloudBackup: (
      state,
      action: PayloadAction<{ appId: string; canAttributeConsent: boolean }>
    ) => {
      const { appId, canAttributeConsent } = action.payload;
      if (state.automaticCloudBackup && appId && canAttributeConsent) {
        const byAppId = (state.automaticCloudBackupByAppId ??= {});
        if (byAppId[appId] === undefined) byAppId[appId] = true;
        (state.pendingAllBackupByAppId ??= {})[appId] = true;
      }
      // An unbound legacy flag must never authorize uploads for another account.
      state.automaticCloudBackup = false;
      state.pendingAllBackup = false;
    },
    setDeleteBackupSuccess: (
      state,
      action: PayloadAction<{ appId: string; status: boolean }>
    ) => {
      const { appId, status } = action.payload;
      if (!appId) return;
      (state.deleteBackupSuccessByAppId ??= {})[appId] = status;
    },
    setDeleteBackupFailure: (
      state,
      action: PayloadAction<{ appId: string; status: boolean }>
    ) => {
      const { appId, status } = action.payload;
      if (!appId) return;
      (state.deleteBackupFailureByAppId ??= {})[appId] = status;
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
  migrateLegacyAutomaticCloudBackup,

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
    'backupAllLoadingByAppId',
    'backupAllFailureByAppId',
    'backupAllSuccessByAppId',

    'deleteBackupSuccess',
    'deleteBackupFailure',
    'deleteBackupSuccessByAppId',
    'deleteBackupFailureByAppId',

    'homeToastMessage',
  ],
};

export default persistReducer(bhrPersistConfig, bhrSlice.reducer);
