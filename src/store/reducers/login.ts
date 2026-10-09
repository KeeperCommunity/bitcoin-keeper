import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface ElectrumClientConnectionStatusPayload {
  successful: boolean;
  connectedTo?: string;
  error?: string;
}

export const initialState: {
  hasCreds: boolean;
  isAuthenticated: boolean;
  authenticationFailed: boolean;
  isInitialLogin: boolean;
  reLogin: boolean;
  loading: {
    initializing: boolean;
    storingCreds: boolean;
    authenticating: boolean;
  };
  credsChanged: string;
  credsAuthenticatedError: string;
  pinChangedFailed: boolean;
  key: string | null;
  appCreationError: boolean;
  recepitVerificationError: boolean;
  recepitVerificationFailed: boolean;
  isOffline: boolean;
  electrumClientConnectionStatus: {
    inProgress: boolean;
    success: boolean;
    connectedTo: string;
    failed: boolean;
    error: string;
    setElectrumNotConnectedErr: string;
  };
  hasDeepLink: string | null;
} = {
  hasCreds: false,
  isAuthenticated: false,
  authenticationFailed: false,
  isInitialLogin: false,
  reLogin: false,
  loading: {
    initializing: false,
    storingCreds: false,
    authenticating: false,
  },
  credsChanged: '',
  credsAuthenticatedError: '',
  pinChangedFailed: false,
  key: null,
  appCreationError: false,
  recepitVerificationError: false,
  recepitVerificationFailed: false,
  isOffline: false,
  electrumClientConnectionStatus: {
    inProgress: false,
    success: false,
    connectedTo: null,
    failed: false,
    error: null,
    setElectrumNotConnectedErr: '',
  },
  hasDeepLink: null,
};

const loginSlice = createSlice({
  name: 'login',
  initialState,
  reducers: {
    setCredStored: (state) => {
      state.hasCreds = true;
      state.loading = {
        initializing: false,
        storingCreds: false,
        authenticating: false,
      };
    },
    credsAuthenticated: (state, action: PayloadAction<boolean>) => {
      (state.isAuthenticated = action.payload),
        (state.authenticationFailed = !action.payload),
        (state.loading = {
          initializing: false,
          storingCreds: false,
          authenticating: false,
        });
    },
    credsAuthenticatedError: (state, action: PayloadAction<string>) => {
      state.credsAuthenticatedError = action.payload;
    },
    credsChanged: (state, action: PayloadAction<string>) => {
      state.credsChanged = action.payload;
    },
    resetCredsChanged: (state) => {
      state.credsChanged = '';
    },
    pinChangedFailed: (state, action: PayloadAction<boolean>) => {
      state.pinChangedFailed = action.payload;
    },
    setupLoading: (state, action: PayloadAction<string>) => {
      const isFailed =
        action.payload === 'authenticating' && !state.loading[action.payload] === true
          ? false
          : state.authenticationFailed;
      state.authenticationFailed = isFailed;
    },
    setKey: (state, action: PayloadAction<string>) => {
      state.key = action.payload;
    },
    setAppCreationError: (state, action: PayloadAction<boolean>) => {
      state.appCreationError = action.payload;
    },
    setRecepitVerificationError: (state, action: PayloadAction<boolean>) => {
      state.recepitVerificationError = action.payload;
    },
    setRecepitVerificationFailed: (state, action: PayloadAction<boolean>) => {
      state.recepitVerificationFailed = action.payload;
    },

    electrumClientConnectionInitiated: (state) => {
      state.electrumClientConnectionStatus = {
        ...initialState.electrumClientConnectionStatus,
        inProgress: true,
      };
    },
    electrumClientConnectionExecuted: (
      state,
      action: PayloadAction<ElectrumClientConnectionStatusPayload>
    ) => {
      state.electrumClientConnectionStatus = {
        inProgress: false,
        success: action.payload.successful,
        connectedTo: action.payload.connectedTo,
        failed: !action.payload.successful,
        error: action.payload.error,
        setElectrumNotConnectedErr: '',
      };
    },
    setElectrumNotConnectedErr: (state, action: PayloadAction<string>) => {
      state.electrumClientConnectionStatus.setElectrumNotConnectedErr = action.payload;
    },
    resetElectrumNotConnectedErr: (state) => {
      state.electrumClientConnectionStatus.setElectrumNotConnectedErr =
        initialState.electrumClientConnectionStatus.setElectrumNotConnectedErr;
    },
    setIsInitialLogin: (state, action: PayloadAction<boolean>) => {
      state.isInitialLogin = action.payload;
    },
    setOfflineStatus: (state, action: PayloadAction<boolean>) => {
      state.isOffline = action.payload;
    },
    setHasDeepLink: (state, action: PayloadAction<string | null>) => {
      state.hasDeepLink = action.payload;
    },
    clearHasCreds: (state) => {
      state.hasCreds = false;
    },
  },
});

export const {
  credsAuthenticated,
  credsAuthenticatedError,
  credsChanged,
  resetCredsChanged,
  pinChangedFailed,
  setCredStored,
  setupLoading,
  setKey,
  setAppCreationError,
  setRecepitVerificationError,
  setRecepitVerificationFailed,
  setOfflineStatus,
  electrumClientConnectionInitiated,
  electrumClientConnectionExecuted,
  setElectrumNotConnectedErr,
  resetElectrumNotConnectedErr,
  setIsInitialLogin,
  setHasDeepLink,
  clearHasCreds,
} = loginSlice.actions;
export default loginSlice.reducer;
