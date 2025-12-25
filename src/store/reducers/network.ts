import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { AverageTxFeesByNetwork, ExchangeRates } from 'src/services/wallets/interfaces';

const initialState: {
  exchangeRates: ExchangeRates;
  averageTxFees: AverageTxFeesByNetwork;
  initialNodesSaved: Boolean;
} = {
  exchangeRates: null,
  averageTxFees: null,
  initialNodesSaved: false,
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
  },
});

export const { setExchangeRates, setAverageTxFee, setInitialNodesSaved } = networkSlice.actions;

export default networkSlice.reducer;
