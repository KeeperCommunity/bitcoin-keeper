import { CommonActions } from '@react-navigation/native';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { StyleSheet, ActivityIndicator, Keyboard, Pressable, ScrollView } from 'react-native';
import { useDispatch } from 'react-redux';
import Buttons from 'src/components/Buttons';
import Text from 'src/components/KeeperText';
import KeeperTextInput from 'src/components/KeeperTextInput';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import { windowWidth, wp } from 'src/constants/responsive';
import useToastMessage from 'src/hooks/useToastMessage';
import { useAppSelector } from 'src/store/hooks';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import Checked from 'src/assets/images/tick_icon.svg';
import { createSwapTnx, getSwapQuote, loadCoinDetails } from 'src/store/sagaActions/swap';
import Colors from 'src/theme/Colors';
import { useUSDTWallets } from 'src/hooks/useUSDTWallets';
import useVault from 'src/hooks/useVault';
import useWallets from 'src/hooks/useWallets';
import KeeperModal from 'src/components/KeeperModal';
import BuyBtcModalContent from '../BuyBtcModalContent';
import { SwapHistory } from './SwapHistory';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { EntityKind } from 'src/services/wallets/enums';
import { CoinLogo } from './component/CoinLogo';

export const SwitchButton = ({ onPress, coinData }) => {
  const { colorMode } = useColorMode();

  return (
    <Pressable onPress={onPress}>
      <Box style={styles.switchButton} backgroundColor={`${colorMode}.separator`}>
        <CoinLogo code={coinData.code} logoWidth={wp(6)} logoHeight={wp(8)} CircleWidth={wp(12)} />
        <Text color={`${colorMode}.primaryText`} fontSize={10}>
          {coinData?.code === 'BTC' ? 'BTC' : 'USDT'}
        </Text>
        <ThemedSvg name={'switch_logo'} />
      </Box>
    </Pressable>
  );
};

export const Swaps = ({ navigation }) => {
  const { colorMode } = useColorMode();
  const { coinDetails } = useAppSelector((state) => state.swap);
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();

  const [fromValue, setFromValue] = useState<any>(0.0);
  const [toValue, setToValue] = useState<any>(0.0);
  const [loading, setLoading] = useState(false);
  const [isFixedRate, setIsFixedRate] = useState(false);
  const [coinFrom, setCoinFrom] = useState(null);
  const [walletFrom, setWalletFrom] = useState(null);
  const [coinTo, setCoinTo] = useState(null);
  const [walletTo, setWalletTo] = useState(null);
  const rateIdRef = useRef(null);
  const [inputError, setInputError] = useState(null);

  const { wallets } = useWallets({ getAll: true });
  const { allVaults } = useVault({
    includeArchived: false,
    getFirst: true,
    getHiddenWallets: false,
  });
  const { usdtWallets } = useUSDTWallets();
  const btcWallets = [...wallets, ...allVaults];
  const [showWalletSelection, setShowWalletSelection] = useState(false);
  const walletModeRef = useRef(null);

  const { translations } = useContext(LocalizationContext);
  const { buyBTC: buyBTCText, common } = translations;

  useEffect(() => {
    if (!coinDetails) {
      setLoading(true);
      dispatch(
        loadCoinDetails(({ status, error }) => {
          setLoading(false);
          if (!status) {
            navigation.goBack();
            showToast(error, <ToastErrorIcon />);
          }
        })
      );
    }
  }, []);

  useEffect(() => {
    if (coinDetails && !coinFrom && !coinTo) {
      setCoinFrom(coinDetails.btc);
      setCoinTo(coinDetails.usdt);
    }
  }, [coinDetails]);

  useEffect(() => {
    getSwapAmount();
  }, [isFixedRate, coinTo]);

  const getSwapAmount = async () => {
    if (fromValue) {
      setLoading(true);
      dispatch(
        getSwapQuote({
          coinFrom,
          coinTo,
          amount: fromValue,
          float: !isFixedRate,
          callback: ({ status, amount, rateId, error }) => {
            setLoading(false);
            if (status) {
              setToValue(amount);
              rateIdRef.current = rateId;
            } else {
              showToast(error, <ToastErrorIcon />);
            }
          },
        })
      );
    }
  };

  const createTnx = async () => {
    if (!walletFrom || !walletTo) {
      showToast('Please select wallets before proceeding', <ToastErrorIcon />);
      return;
    }
    setLoading(true);
    dispatch(
      createSwapTnx({
        float: !isFixedRate,
        coinFrom,
        coinTo,
        depositAmount: fromValue,
        withdrawal:
          walletTo.entityKind === EntityKind.USDT_WALLET
            ? walletTo.accountStatus.gasFreeAddress
            : walletTo.specs.receivingAddress,
        refund:
          walletFrom.entityKind === EntityKind.USDT_WALLET
            ? walletFrom.accountStatus.gasFreeAddress
            : walletFrom.specs.receivingAddress,
        rateId: rateIdRef.current,
        callback: ({ status, tnx, error }) => {
          setLoading(false);
          if (status)
            navigation.dispatch(
              CommonActions.navigate('SwapDetails', {
                data: tnx,
                wallet: walletFrom,
                recievedWallet: walletTo,
              })
            );
          else {
            showToast(error, <ToastErrorIcon />);
          }
        },
      })
    );
  };

  const createWalletSelection = (mode) => {
    if (mode === 'from') {
      if (coinFrom.code === 'BTC') return btcWallets;
      else return usdtWallets;
    } else {
      if (coinTo.code === 'BTC') return btcWallets;
      else return usdtWallets;
    }
  };

  return (
    <ScreenWrapper
      paddingHorizontal={0}
      barStyle="dark-content"
      backgroundcolor={`${colorMode}.primaryBackground`}
    >
      <Box paddingX={6}>
        <WalletHeader title={buyBTCText.swap} />
      </Box>
      {!coinTo && !coinFrom ? (
        <ActivityIndicator style={{ height: '70%' }} size="large" />
      ) : (
        <ScrollView style={styles.container}>
          <Box paddingX={6}>
            <Box>
              <Text semiBold>{buyBTCText.convertFrom}</Text>

              <KeeperTextInput
                placeholder={'0.00'}
                value={fromValue}
                onChangeText={(value) => {
                  const sanitized = value.replace(/[^0-9.]/g, '');
                  setFromValue(sanitized);
                }}
                keyboardType="numeric"
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                isError={inputError}
                onBlur={() => {
                  setInputError(false);
                  if (fromValue < coinFrom.min_amount || fromValue > coinFrom.max_amount) {
                    setInputError(
                      'Amount should be between ' +
                        coinFrom.min_amount +
                        ' and ' +
                        coinFrom.max_amount
                    );
                    return;
                  }
                  if (fromValue) getSwapAmount();
                }}
                InputRightComponent={
                  <SwitchButton
                    onPress={() => {
                      const fromTmp = coinFrom;
                      setCoinFrom(coinTo);
                      setCoinTo(fromTmp);
                      // unselect wallets
                      setWalletFrom(null);
                      setWalletTo(null);
                    }}
                    coinData={coinFrom}
                  />
                }
                inputBackgroundColor={`${colorMode}.textInputBackground`}
                inpuBorderColor={`${colorMode}.separator`}
              />
              {inputError && <Text color={Colors.AlertRedDark}>{inputError}</Text>}

              <Pressable
                onPress={() => {
                  walletModeRef.current = 'from';
                  if (coinFrom.code !== 'BTC' && usdtWallets.length === 0) {
                    showToast('Please create a USDT wallet to send USDT', <ToastErrorIcon />);
                  } else {
                    setShowWalletSelection(true);
                  }
                }}
              >
                <Box
                  backgroundColor={`${colorMode}.textInputBackground`}
                  style={styles.selectingWallet}
                  borderColor={`${colorMode}.separator`}
                >
                  <Text>
                    {walletFrom?.presentationData?.name
                      ? walletFrom?.presentationData?.name
                      : buyBTCText.selectSendingWallet}
                  </Text>
                  <ThemedSvg name={'swap_down_icon'} />
                </Box>
              </Pressable>
            </Box>

            <Box mt={2}>
              <Text semiBold>{buyBTCText.convertTo}</Text>
              <KeeperTextInput
                placeholder={'0.00'}
                value={toValue}
                onChangeText={(value) => setToValue(value)}
                editable={false}
                InputRightComponent={
                  <SwitchButton
                    onPress={() => {
                      const fromTmp = coinFrom;
                      setCoinFrom(coinTo);
                      setCoinTo(fromTmp);
                      // unselect wallets
                      setWalletFrom(null);
                      setWalletTo(null);
                    }}
                    coinData={coinTo}
                  />
                }
                inputBackgroundColor={`${colorMode}.textInputBackground`}
                inpuBorderColor={`${colorMode}.separator`}
              />
              <Pressable
                onPress={() => {
                  walletModeRef.current = 'to';
                  if (coinTo.code !== 'BTC' && usdtWallets.length === 0) {
                    showToast('Please create a USDT wallet to receive USDT', <ToastErrorIcon />);
                  } else {
                    setShowWalletSelection(true);
                  }
                }}
              >
                <Box
                  backgroundColor={`${colorMode}.textInputBackground`}
                  style={styles.selectingWallet}
                  borderColor={`${colorMode}.separator`}
                >
                  <Text>
                    {walletTo?.presentationData?.name
                      ? walletTo?.presentationData?.name
                      : buyBTCText.selectRecievingWallet}
                  </Text>
                  <ThemedSvg name={'swap_down_icon'} />
                </Box>
              </Pressable>
            </Box>

            <Pressable onPress={() => setIsFixedRate(!isFixedRate)}>
              <Box flexDir={'row'} marginY={4} alignItems={'center'}>
                {isFixedRate ? (
                  <Checked width={wp(19)} height={wp(19)} />
                ) : (
                  <Box style={styles.circle} borderColor={`${colorMode}.brownBackground`} />
                )}{' '}
                <Text fontSize={12} medium>
                  {buyBTCText.fixedRate}
                </Text>
              </Box>
            </Pressable>

            <Buttons
              primaryText={buyBTCText.swap}
              primaryCallback={createTnx}
              primaryLoading={loading}
              fullWidth
              primaryDisable={toValue <= 0}
            />
          </Box>

          <Box style={styles.historyContainer} borderColor={`${colorMode}.separator`}>
            <SwapHistory navigation={navigation} />
          </Box>
        </ScrollView>
      )}

      <KeeperModal
        visible={showWalletSelection}
        close={() => setShowWalletSelection(false)}
        title={walletModeRef.current === 'from' ? 'Select From Wallet' : 'Select to Wallet'}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <BuyBtcModalContent
            allWallets={createWalletSelection(walletModeRef.current)}
            setSelectedWallet={walletModeRef.current === 'from' ? setWalletFrom : setWalletTo}
            selectedWallet={walletModeRef.current === 'from' ? walletFrom : walletTo}
          />
        )}
        buttonText={common.confirm}
        buttonCallback={() => {
          if (walletModeRef.current === 'from' ? !walletFrom : !walletTo) return;
          setShowWalletSelection(false);
        }}
        disable={walletModeRef.current === 'from' ? !walletFrom : !walletTo}
      />
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  circle: {
    width: wp(18),
    height: wp(18),
    borderRadius: wp(18),
    borderWidth: 1,
  },
  container: {
    paddingVertical: wp(15),
    marginBottom: wp(20),
  },
  switchButton: {
    width: wp(66),
    height: wp(18),
    borderRadius: wp(50),
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: wp(10),
    flexDirection: 'row',
    gap: wp(2.5),
  },
  selectingWallet: {
    minHeight: wp(45),
    borderRadius: wp(10),
    paddingHorizontal: wp(16),
    paddingVertical: wp(18),
    borderWidth: 1,
    marginBottom: wp(10),
    marginTop: wp(5),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyContainer: {
    marginTop: wp(20),
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: wp(30),
    borderTopRightRadius: wp(30),
    paddingVertical: wp(20),
  },
});
