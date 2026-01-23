import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { BackupType } from 'src/models/enums/BHR';
import { NetworkType } from 'src/services/wallets/enums';

export type AccountWithoutHash = {
  isDefault: boolean;
  appId: string;
};

export type Account = AccountWithoutHash & tempDetails;

export type tempDetails = {
  hash: string;
  realmId: string;
  accountIdentifier: string;
};

export type ConciergeUsers = {
  [appId: string]: string;
};

export type BackupMethodByAppId = {
  [appId: string]: BackupType;
};
export type OneTimeBackupStatusByAppId = {
  [appId: string]: Boolean;
};
export type recoveryKeyBackedUpByAppId = {
  [appId: string]: Boolean;
};

export type DefaultWalletCreatedByAppId = {
  [appId: string]: {
    [NetworkType.MAINNET]: boolean;
    [NetworkType.TESTNET]: boolean;
  };
};

export type personalBackupPasswordByAppId = {
  [appId: string]: string;
};
export type backupFileByAppId = {
  [appId: string]: boolean;
};

const initialState: {
  allAccounts: Account[];
  tempDetails: tempDetails;
  conciergeUsers: ConciergeUsers;
  biometricEnabledAppId: string;
  backupMethodByAppId: BackupMethodByAppId;
  oneTimeBackupStatusByAppId: OneTimeBackupStatusByAppId;
  defaultWalletCreatedByAppId: DefaultWalletCreatedByAppId;
  personalBackupPasswordByAppId: personalBackupPasswordByAppId;
  recoveryKeyBackedUpByAppId: recoveryKeyBackedUpByAppId;
  backupFileByAppId: backupFileByAppId;
} = {
  allAccounts: [],
  tempDetails: null,
  conciergeUsers: {},
  biometricEnabledAppId: null,
  backupMethodByAppId: {},
  oneTimeBackupStatusByAppId: {}, // for signing server backup
  defaultWalletCreatedByAppId: {},
  personalBackupPasswordByAppId: {},
  recoveryKeyBackedUpByAppId: {},
  backupFileByAppId: {},
};

const accountSlice = createSlice({
  name: 'account',
  initialState,
  reducers: {
    addAccount: (state, action: PayloadAction<string>) => {
      const existing = state.allAccounts.find((acc) => acc.appId == action.payload);
      const index = state.allAccounts.findIndex((acc) => acc.appId == action.payload);
      if (existing && index != -1) {
        // appId already exists, user is recovering existing account, overwrite existing with new credentials
        state.allAccounts[index] = {
          ...state.allAccounts[index],
          hash: state.tempDetails.hash,
          realmId: state.tempDetails.realmId,
          accountIdentifier: state.tempDetails.accountIdentifier,
          isDefault: state.allAccounts.length === 0,
        };
      } else {
        const account = {
          appId: action.payload,
          hash: state.tempDetails.hash,
          realmId: state.tempDetails.realmId,
          accountIdentifier: state.tempDetails.accountIdentifier,
          isDefault: state.allAccounts.length === 0,
        };
        state.allAccounts.push(account);
      }
      state.tempDetails = null;
    },
    setTempDetails: (state, action: PayloadAction<tempDetails>) => {
      state.tempDetails = action.payload;
    },
    resetTempDetails: (state) => {
      state.tempDetails = null;
    },
    updatePasscodeHash: (state, action: PayloadAction<{ newHash: string; appId: string }>) => {
      state.allAccounts.forEach((account) => {
        if (account.appId === action.payload.appId) {
          account.hash = action.payload.newHash;
        }
      });
    },
    addConciergeUserToAccount: (
      state,
      action: PayloadAction<{ appId: string; conciergeUser: string }>
    ) => {
      state.conciergeUsers[action.payload.appId] = action.payload.conciergeUser;
    },
    setBiometricEnabledAppId: (state, action: PayloadAction<string>) => {
      state.biometricEnabledAppId = action.payload;
    },
    updateBackupMethodByAppId: (
      state,
      action: PayloadAction<{ appId: string; backupMethod: BackupType }>
    ) => {
      (state.backupMethodByAppId ??= {})[action.payload.appId] = action.payload.backupMethod;
    },
    updateOneTimeBackupStatus: (
      state,
      action: PayloadAction<{ appId: string; status: boolean }>
    ) => {
      (state.oneTimeBackupStatusByAppId ??= {})[action.payload.appId] = action.payload.status;
    },

    updateDefaultWalletCreatedByAppId: (
      state,
      action: PayloadAction<{ appId: string; networkType: NetworkType; updateBoth?: boolean }>
    ) => {
      if (state.defaultWalletCreatedByAppId[action.payload.appId] === undefined) {
        state.defaultWalletCreatedByAppId[action.payload.appId] = {
          [NetworkType.MAINNET]: false,
          [NetworkType.TESTNET]: false,
        };
      }
      if (action.payload.updateBoth) {
        state.defaultWalletCreatedByAppId[action.payload.appId][NetworkType.MAINNET] = true;
        state.defaultWalletCreatedByAppId[action.payload.appId][NetworkType.TESTNET] = true;
      }

      state.defaultWalletCreatedByAppId[action.payload.appId] = {
        ...state.defaultWalletCreatedByAppId[action.payload.appId],
        [action.payload.networkType]: true,
      };
    },

    saveDefaultWalletState: (
      state,
      action: PayloadAction<{
        appId: string;
        data: { [NetworkType.MAINNET]: boolean; [NetworkType.TESTNET]: boolean };
      }>
    ) => {
      state.defaultWalletCreatedByAppId[action.payload.appId] = action.payload.data;
    },

    setPersonalBackupPassword: (
      state,
      action: PayloadAction<{ appId: string; password: string }>
    ) => {
      (state.personalBackupPasswordByAppId ??= {})[action.payload.appId] = action.payload.password;
    },

    setRecoveryKeyBackedUp: (state, action: PayloadAction<{ appId: string; status: boolean }>) => {
      (state.recoveryKeyBackedUpByAppId ??= {})[action.payload.appId] = action.payload.status;
    },

    setBackupFileByAppId: (state, action: PayloadAction<{ appId: string; status: boolean }>) => {
      (state.backupFileByAppId ??= {})[action.payload.appId] = action.payload.status;
    },
  },
});

export const {
  addAccount,
  setTempDetails,
  resetTempDetails,
  updatePasscodeHash,
  addConciergeUserToAccount,
  setBiometricEnabledAppId,
  updateBackupMethodByAppId,
  updateOneTimeBackupStatus,
  updateDefaultWalletCreatedByAppId,
  saveDefaultWalletState,
  setPersonalBackupPassword,
  setRecoveryKeyBackedUp,
  setBackupFileByAppId,
} = accountSlice.actions;
export default accountSlice.reducer;
