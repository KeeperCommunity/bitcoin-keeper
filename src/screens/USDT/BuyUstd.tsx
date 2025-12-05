import { Box, useColorMode } from 'native-base';
import React, { useContext, useState } from 'react';
import { Linking, StyleSheet } from 'react-native';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import RampNetwork from 'src/assets/images/ramp-network.svg';
import RampNetworkDark from 'src/assets/images/ramp-dark-logo.svg';
import { hp, wp } from 'src/constants/responsive';
import Text from 'src/components/KeeperText';
import HexagonIcon from 'src/components/HexagonIcon';
import MultiSendSvg from 'src/assets/images/@.svg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import Buttons from 'src/components/Buttons';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { useAppSelector } from 'src/store/hooks';
import { getCountry } from 'react-native-localize';
import { fetchBuyUsdtLink } from 'src/services/thirdparty/ramp';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import useToastMessage from 'src/hooks/useToastMessage';

const BuyUstd = ({ route }) => {
  const { usdtWallet } = route.params;
  const receiveAddress = usdtWallet?.accountStatus?.gasFreeAddress ?? '';
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const buyBitCoinHexagonBackgroundColor = ThemedColor({
    name: 'buyBitCoinHexagonBackgroundColor',
  });
  const { translations } = useContext(LocalizationContext);
  const { common, usdtWalletText } = translations;
  const { currencyCode } = useAppSelector((state) => state.settings);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToastMessage();

  const onProceed = async () => {
    setLoading(true);
    try {
      if (currencyCode === 'GBP' || getCountry() === 'UK') {
        Linking.openURL('https://rampnetwork.com/buy#');
      } else {
        const url = await fetchBuyUsdtLink(receiveAddress);
        Linking.openURL(url.toString());
      }
    } catch (error) {
      console.log(error);
      showToast('Error while fetching ramp url');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <Box style={styles.container}>
        <WalletHeader title={usdtWalletText.usdtRamp} />
        <Text fontSize={13} color={`${colorMode}.primaryText`} style={{ marginTop: hp(15) }}>
          {usdtWalletText.rampSub}
        </Text>
        <Box
          style={styles.cardWrapper}
          backgroundColor={`${colorMode}.thirdBackground`}
          borderColor={`${colorMode}.separator`}
        >
          {isDarkMode ? <RampNetworkDark /> : <RampNetwork />}
          <Text>{usdtWalletText.rampOffermultiple}</Text>
        </Box>
        <Text color={`${colorMode}.primaryText`} medium style={{ marginBottom: hp(10) }}>
          {usdtWalletText.adressTransaction}
        </Text>
        <Box
          style={styles.addressContainer}
          backgroundColor={`${colorMode}.thirdBackground`}
          borderColor={`${colorMode}.separator`}
        >
          <HexagonIcon
            width={wp(39)}
            height={hp(35)}
            backgroundColor={buyBitCoinHexagonBackgroundColor}
            icon={<MultiSendSvg />}
          />
          <Text color={`${colorMode}.primaryText`} fontSize={12} style={styles.addressText}>
            {receiveAddress}
          </Text>
        </Box>
      </Box>
      <Box style={styles.ButtonContainer}>
        <Text>{usdtWalletText.understandRampPayment}</Text>
        <Buttons primaryText={common.proceed} primaryCallback={onProceed} fullWidth />
      </Box>
      <ActivityIndicatorView visible={loading} />
    </ScreenWrapper>
  );
};

export default BuyUstd;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  cardWrapper: {
    paddingHorizontal: hp(20),
    paddingVertical: hp(20),
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: hp(20),
    gap: hp(10),
  },
  addressContainer: {
    paddingHorizontal: hp(20),
    paddingVertical: hp(20),
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: hp(20),
    gap: hp(10),
    flexDirection: 'row',
    alignItems: 'center',
  },
  addressText: {
    width: '80%',
  },
  ButtonContainer: {
    gap: hp(20),
    paddingVertical: hp(20),
  },
});
