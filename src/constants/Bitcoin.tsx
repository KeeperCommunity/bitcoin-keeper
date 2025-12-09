import { NetworkType } from 'src/services/wallets/enums';
import { Box } from 'native-base';
import Text from 'src/components/KeeperText';
import React from 'react';
import Colors from 'src/theme/Colors';
import CurrencyKind from '../models/enums/CurrencyKind';
import FiatCurrencies from './FiatCurrencies';
import { store } from 'src/store/store';

export const SATOSHIS_IN_BTC = 1e8;

export const BtcToSats = (amountInBtc: number) => {
  if (amountInBtc !== 0) {
    return (amountInBtc * SATOSHIS_IN_BTC).toFixed(0);
  }
  return amountInBtc;
};

export const SatsToBtc = (amountInSats: number) => {
  if (amountInSats !== 0) {
    if (amountInSats > 99) {
      return amountInSats / SATOSHIS_IN_BTC;
    }
    return (amountInSats / SATOSHIS_IN_BTC).toFixed(6);
  }
  return amountInSats;
};

export const getAmount = (amountInSats: number, satsEnabled = false) => {
  if (satsEnabled === false && amountInSats !== 0) {
    if (amountInSats > 99) {
      return amountInSats / SATOSHIS_IN_BTC;
    }
    return (amountInSats / SATOSHIS_IN_BTC).toFixed(6);
  }
  return numberWithCommas(amountInSats);
};

const numberWithCommas = (x) => (x ? x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : 0);

export const getAmt = (
  amountInSats: number,
  exchangeRates,
  currencyCode,
  currentCurrency,
  satsEnabled = false
) => {
  if (currentCurrency === CurrencyKind.BITCOIN) {
    return getAmount(amountInSats, satsEnabled);
  }
  if (exchangeRates && exchangeRates[currencyCode]) {
    return numberWithCommas(
      ((exchangeRates[currencyCode].last / SATOSHIS_IN_BTC) * amountInSats).toFixed(2)
    );
  }
  return numberWithCommas(amountInSats);
};

export const getConvertedAmt = (
  amount: number,
  exchangeRates,
  currencyCode,
  currentCurrency,
  satsEnabled = false
) => {
  if (amount) {
    if (currentCurrency === CurrencyKind.BITCOIN) {
      if (satsEnabled) {
        return ((SATOSHIS_IN_BTC / exchangeRates[currencyCode].last) * amount).toFixed(2);
      }
      return (amount / exchangeRates[currencyCode].last).toFixed(5);
    }
    if (exchangeRates && exchangeRates[currencyCode]) {
      if (satsEnabled) {
        return numberWithCommas(
          ((amount / SATOSHIS_IN_BTC) * exchangeRates[currencyCode].last).toFixed(2)
        );
      }
      return numberWithCommas((exchangeRates[currencyCode].last * amount).toFixed(2));
    }
    return numberWithCommas(amount);
  }
  return null;
};

export const getCustomConvertedAmt = (
  amount: number,
  exchangeRates,
  fromKind,
  toKind,
  currencyCode,
  satsEnabled = false
) => {
  if (amount == null || exchangeRates == null || !exchangeRates[currencyCode]) {
    return null;
  }
  const rate = exchangeRates[currencyCode].last;
  if (fromKind === CurrencyKind.BITCOIN) {
    if (toKind === CurrencyKind.BITCOIN) {
      return amount;
    } else if (toKind === CurrencyKind.FIAT) {
      const convertedAmount = satsEnabled
        ? parseFloat(((amount / SATOSHIS_IN_BTC) * rate).toFixed(2)).toString()
        : parseFloat((amount * rate).toFixed(2)).toString();
      return convertedAmount;
    }
  } else if (fromKind === CurrencyKind.FIAT) {
    if (toKind === CurrencyKind.BITCOIN) {
      const bitcoinAmount = amount / rate;
      const convertedAmount = satsEnabled
        ? (bitcoinAmount * SATOSHIS_IN_BTC).toFixed(0)
        : parseFloat(bitcoinAmount.toFixed(8)).toString();
      return convertedAmount;
    } else if (toKind === CurrencyKind.FIAT) {
      return parseFloat(amount.toFixed(2)).toString();
    }
  }
  return null;
};

export const getUnit = (currentCurrency, satsEnabled = false) => {
  const isBitcoin = currentCurrency === CurrencyKind.BITCOIN;
  // disable sats mode
  if (isBitcoin && satsEnabled) {
    return 'sats';
  }
  return '';
};

export const isTestnet = () => {
  const { bitcoinNetworkType } = store.getState().settings;
  if (bitcoinNetworkType === NetworkType.TESTNET) {
    return true;
  }
  return false;
};

export function CurrencyIcon({ symbol, styles = {} }) {
  return (
    <Box style={{ alignItems: 'center' }}>
      <Text
        style={{
          ...styles,
          fontSize: 14,
          fontWeight: 500,
          lineHeight: 20,
        }}
        bold
      >
        {symbol}
      </Text>
    </Box>
  );
}

export const getCurrencyImageByRegion = (
  currencyCode: string,
  type: 'light' | 'green' | 'dark' | 'grey' | 'slateGreen' | 'richBlack',
  currentCurrency: CurrencyKind,
  BTCIcon: any
) => {
  const styles = {} as any;
  switch (type) {
    case 'light':
      styles.color = Colors.headerWhite;
      break;
    case 'green':
      styles.color = Colors.TagLight2;
      break;
    case 'dark':
      styles.color = Colors.TagDark3;
      break;
    case 'grey':
      styles.color = Colors.headerWhite;
      styles.opacity = 0.7;
      break;
    case 'slateGreen':
      styles.color = Colors.SlateGreen;
      break;
    case 'richBlack':
      styles.color = Colors.SecondaryBlack;
      break;
    default:
      styles.color = Colors.headerWhite;
  }
  if (currentCurrency !== CurrencyKind.BITCOIN) {
    const currency = FiatCurrencies.find((c) => c.code === currencyCode);
    if (currency) {
      return <CurrencyIcon styles={styles} symbol={currency.symbol} />;
    }
    return null;
  }
  return <BTCIcon style={{ color: styles.color }} />;
};

export const getFiatIcon = (currencyCode: string, type: 'light' | 'green' | 'dark' | 'grey') => {
  const currency = FiatCurrencies.find((c) => c.code === currencyCode);
  const styles = {} as any;
  switch (type) {
    case 'light':
      styles.color = Colors.headerWhite;
      break;
    case 'green':
      styles.color = Colors.TagLight2;
      break;
    case 'dark':
      styles.color = Colors.TagDark3;
      break;
    case 'grey':
      styles.color = Colors.secondaryLightGrey;
      styles.opacity = 0.7;
      break;
    default:
      styles.color = Colors.headerWhite;
  }
  if (currency) {
    return <CurrencyIcon styles={styles} symbol={currency.symbol} />;
  }
  return null;
};
