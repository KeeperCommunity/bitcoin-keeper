import { Box, ScrollView, useColorMode, View } from '@gluestack-ui/themed-native-base';
import React, { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet } from 'react-native';
import KeeperModal from 'src/components/KeeperModal';
import Text from 'src/components/KeeperText';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useExchangeRates from 'src/hooks/useExchangeRates';
import { useAppSelector } from 'src/store/hooks';
import Colors from 'src/theme/Colors';
import BuyBtcModalContent from './BuyBtcModalContent';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { manipulateBitcoinPrices } from 'src/utils/utilities';
import BtcGraph from './BtcGraph';
import Relay from 'src/services/backend/Relay';
import useWallets from 'src/hooks/useWallets';
import useVault from 'src/hooks/useVault';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import AcquireCard from './AcquireCard';
import BtcAcquireIcon from 'src/assets/images/bitcoin-acquire-icon.svg';
import { fetchSellBtcLink } from 'src/services/thirdparty/ramp';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { SwapHistory } from './Swap/SwapHistory';

const BuyBtc = () => {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const exchangeRates = useExchangeRates();
  const { currencyCode } = useAppSelector((state) => state.settings);
  const BtcPrice = exchangeRates?.[currencyCode];
  const { translations } = useContext(LocalizationContext);
  const { buyBTC: buyBTCText, common } = translations;
  const [visibleBuyBtc, setVisibleBuyBtc] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const navigation = useNavigation();
  const [graphData, setGraphData] = useState([]);
  const [error, setError] = useState(false);
  const [stats, setStats] = useState(null);
  const [visibleSellBtc, setVisibleSellBtc] = useState(false);

  const { wallets } = useWallets();
  const { allVaults } = useVault({ getHiddenWallets: false });
  const { showToast } = useToastMessage();
  const allWallets = [...wallets, ...allVaults];
  const previousSwaps = useQuery(RealmSchema.SwapHistory);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBtcPrice();
  }, []);

  const loadBtcPrice = async () => {
    try {
      const btcPrice = await Relay.getBtcPrice(currencyCode);
      const { dailyPrice, high24h, latestPrice, low24h, percentChange, valueChange } =
        manipulateBitcoinPrices(btcPrice?.prices);
      setGraphData(dailyPrice);
      setStats({ high24h, low24h, latestPrice, percentChange, valueChange });
    } catch (error) {
      console.log('🚀 ~ loadBtcPrice ~ error:', error);
      setError(true);
    }
  };

  if (error) {
    return (
      <View flex={1} backgroundColor={`${colorMode}.primaryBackground`}>
        <Text>{common.somethingWrong}</Text>
      </View>
    );
  }

  return (
    <View flex={1} backgroundColor={`${colorMode}.primaryBackground`}>
      {graphData.length > 0 ? (
        <>
          <ScrollView style={styles.container} backgroundColor={`${colorMode}.primaryBackground`}>
            <AcquireCard
              name={buyBTCText.bitCoin}
              analysis={`${BtcPrice?.symbol}${stats?.valueChange} (${stats?.percentChange}%) 24 hours`}
              analysisColor={stats?.valueChange < 0 ? Colors.CrimsonRed : Colors.PersianGreen}
              circleBackground={Colors.BrightOrange}
              icon={<BtcAcquireIcon />}
              amount={`${BtcPrice?.symbol} ${new Intl.NumberFormat('en-US', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              }).format(stats?.latestPrice)}`}
              buyCallback={() => {
                if (allWallets.length) setVisibleBuyBtc(true);
                else showToast('Please create a wallet to proceed.', <ToastErrorIcon />);
              }}
              sellCallback={() => {
                if (allWallets.length > 0) setVisibleSellBtc(true);
                else showToast("You don't have BTC yet.", <ToastErrorIcon />);
              }}
              graphContent={<BtcGraph dataSet={graphData} spacing={50} />}
            />
            {previousSwaps.length > 0 && <SwapHistory navigation={navigation} />}
          </ScrollView>
          <Box style={{ marginBottom: hp(12), paddingHorizontal: wp(12) }}>
            <Text fontSize={13}>{buyBTCText.transactionOnRamp}</Text>
          </Box>
        </>
      ) : (
        <Box alignItems={'center'} justifyContent={'center'}>
          <ActivityIndicator />
        </Box>
      )}
      <KeeperModal
        visible={visibleBuyBtc}
        close={() => setVisibleBuyBtc(false)}
        title={buyBTCText.selectWallet}
        subTitle={buyBTCText.selectWalletDesc}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <BuyBtcModalContent
            allWallets={allWallets}
            setSelectedWallet={setSelectedWallet}
            selectedWallet={selectedWallet}
          />
        )}
        buttonText={selectedWallet ? common.proceed : null}
        buttonCallback={() => {
          if (!selectedWallet) return;
          setVisibleBuyBtc(false);
          navigation.dispatch(
            CommonActions.navigate({ name: 'BuyBitcoin', params: { wallet: selectedWallet } })
          );
        }}
      />
      <KeeperModal
        visible={visibleSellBtc}
        close={() => setVisibleSellBtc(false)}
        title={buyBTCText.proceedToRamp}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <Text
            color={isDarkMode ? `${colorMode}.buttonText` : `${colorMode}.BrownNeedHelp`}
            fontSize={14}
            style={styles.sellBtcText}
          >
            {buyBTCText.rediredctToRampPage}
          </Text>
        )}
        buttonText={common.confirm}
        buttonCallback={async () => {
          try {
            setLoading(true);
            setVisibleSellBtc(false);
            const url = await fetchSellBtcLink();
            Linking.openURL(url.toString());
          } catch (error) {
            showToast('Error while fetching ramp url');
          } finally {
            setLoading(false);
          }
        }}
      />
      <ActivityIndicatorView visible={loading} />
    </View>
  );
};

export default BuyBtc;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: wp(20),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: windowWidth,
    paddingHorizontal: wp(12),
  },
  btc_container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  logo_container: {
    width: wp(56),
    height: hp(56),
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  graph_container: {
    width: windowWidth,
    marginVertical: hp(16),
  },
  cards_container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginVertical: hp(16),
  },
  card: {
    paddingVertical: hp(16),
    paddingHorizontal: wp(16),
    borderWidth: 1,
    width: wp(160),
    borderRadius: 8,
  },
  info_container: {
    maxWidth: windowWidth,
    paddingHorizontal: wp(12),
  },
  sellBtcText: {
    marginTop: hp(-10),
    marginBottom: hp(5),
  },
});
