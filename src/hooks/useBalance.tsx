import {
  getAmt,
  getConvertedAmt,
  getCurrencyImageByRegion,
  getCustomConvertedAmt,
  getFiatIcon,
  getUnit,
} from 'src/constants/Bitcoin';
import { useAppSelector } from 'src/store/hooks';
import useCurrencyCode from 'src/store/hooks/state-selectors/useCurrencyCode';
import useExchangeRates from './useExchangeRates';
import CurrencyKind from 'src/models/enums/CurrencyKind';

const useBalance = () => {
  const exchangeRates = useExchangeRates();
  const currencyCode = useCurrencyCode();
  const currentCurrency = useAppSelector((state) => state.settings.currencyKind);
  const { satsEnabled } = useAppSelector((state) => state.settings);

  const getBalance = (balance: number) =>
    getAmt(balance, exchangeRates, currencyCode, currentCurrency, satsEnabled);

  const getConvertedBalance = (balance: number) =>
    getConvertedAmt(balance, exchangeRates, currencyCode, currentCurrency, satsEnabled);

  const getCustomConvertedBalance = (
    balance: number,
    fromKind: CurrencyKind,
    toKind: CurrencyKind
  ) => getCustomConvertedAmt(balance, exchangeRates, fromKind, toKind, currencyCode, satsEnabled);

  const getSatUnit = () => getUnit(currentCurrency, satsEnabled);

  const getCurrencyIcon = (
    Icon: any,
    variation: 'light' | 'green' | 'dark' | 'grey' | 'slateGreen' | 'richBlack'
  ) => getCurrencyImageByRegion(currencyCode, variation, currentCurrency, Icon);

  const getFiatCurrencyIcon = (variation: 'light' | 'green' | 'dark' | 'grey') =>
    getFiatIcon(currencyCode, variation);

  const getUsdInSats = (usd: number) => getConvertedAmt(usd, exchangeRates, 'USD', 'BITCOIN', true);

  return {
    getBalance,
    getSatUnit,
    getCurrencyIcon,
    getFiatCurrencyIcon,
    getConvertedBalance,
    getCustomConvertedBalance,
    getUsdInSats,
  };
};

export default useBalance;
