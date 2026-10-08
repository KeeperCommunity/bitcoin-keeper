import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { AverageTxFeesByNetwork, ExchangeRates } from 'src/services/wallets/interfaces';

const initialState: {
  exchangeRates: ExchangeRates;
  averageTxFees: AverageTxFeesByNetwork;
  initialNodesSaved: Boolean;
  testnetFallbackNodeAdded: boolean;
} = {
  exchangeRates: null,
  averageTxFees: null,
  initialNodesSaved: false,
  testnetFallbackNodeAdded: false,
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

    setTestnetFallbackNodeAdded: (state) => {
      state.testnetFallbackNodeAdded = true;
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
