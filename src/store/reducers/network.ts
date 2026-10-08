import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { AverageTxFeesByNetwork, ExchangeRates } from 'src/services/wallets/interfaces';

const initialState: {
  exchangeRates: ExchangeRates;
  averageTxFees: AverageTxFeesByNetwork;
  initialNodesSaved: Boolean;
  testnetFallbackNodeAddedByAppId: { [appId: string]: boolean };
} = {
  exchangeRates: null,
  averageTxFees: null,
  initialNodesSaved: false,
  testnetFallbackNodeAddedByAppId: {},
};

const networkSlice = createSlice({
  name: 'network',
  initialState,
  reducers: {
    setExchangeRates: (state, action) => {
      state.exchangeRates = action.payload;
    },

    setAverageTxFee: (state, action: PayloadAction<AverageTxFeesByNetwork>) => {
      state.averageTxFees = action.payload;
    },

    setInitialNodesSaved: (state, action: PayloadAction<Boolean>) => {
      state.initialNodesSaved = action.payload;
    },

    setTestnetFallbackNodeAdded: (state, action: PayloadAction<string>) => {
      // Older persisted network state may not have the per-account map yet.
      if (!state.testnetFallbackNodeAddedByAppId) state.testnetFallbackNodeAddedByAppId = {};
      state.testnetFallbackNodeAddedByAppId[action.payload] = true;
    },
  },
});

export const {
  setExchangeRates,
  setAverageTxFee,
  setInitialNodesSaved,
  setTestnetFallbackNodeAdded,
} = networkSlice.actions;

export default networkSlice.reducer;
