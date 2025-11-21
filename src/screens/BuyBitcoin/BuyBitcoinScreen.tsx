import React, { useContext, useState } from 'react';
import { Linking, StyleSheet } from 'react-native';
import { Box, useColorMode } from 'native-base';
import Text from 'src/components/KeeperText';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { useAppSelector } from 'src/store/hooks';
import Buttons from 'src/components/Buttons';
import { getCountry } from 'react-native-localize';
import { fetchRampReservation } from 'src/services/thirdparty/ramp';
import { hp, wp } from 'src/constants/responsive';
import HexagonIcon from 'src/components/HexagonIcon';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import WalletHeader from 'src/components/WalletHeader';
import RampNetwork from 'src/assets/images/ramp-network.svg';
import RampNetworkDark from 'src/assets/images/ramp-dark-logo.svg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import MultiSendSvg from 'src/assets/images/@.svg';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import useToastMessage from 'src/hooks/useToastMessage';

function BuyBitcoinScreen({ route }) {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const { currencyCode } = useAppSelector((state) => state.settings);
  const { translations } = useContext(LocalizationContext);
  const { common, ramp: rampTranslations, buyBTC: buyBTCText } = translations;

  const { wallet } = route.params;
  const receivingAddress = wallet.specs.receivingAddress;
  const [loading, setLoading] = useState(false);
  const { showToast } = useToastMessage();

  const buyBitCoinHexagonBackgroundColor = ThemedColor({
    name: 'buyBitCoinHexagonBackgroundColor',
  });
  const buyWithRamp = async (address: string) => {
    setLoading(true);
    try {
      if (currencyCode === 'GBP' || getCountry() === 'UK') {
        Linking.openURL('https://rampnetwork.com/buy#');
      } else {
        const url = await fetchRampReservation(address);
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
    <ScreenWrapper barStyle="dark-content" backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={rampTranslations.buyBitcoinWithRamp}
        subTitle={rampTranslations.buyBitcoinWithRampSubTitle}
        // To-Do-Learn-More
      />

      <Box
        style={styles.cardWrapper}
        backgroundColor={`${colorMode}.primaryBackground`}
        borderColor={`${colorMode}.separator`}
      >
        {isDarkMode ? <RampNetworkDark /> : <RampNetwork />}
        <Text>{buyBTCText.buyBTCWithoutExchange}</Text>
      </Box>
      <Text color={`${colorMode}.primaryText`} semiBold>
        {buyBTCText.addressForTransaction}
      </Text>
      <Box
        style={styles.addressContainer}
        backgroundColor={`${colorMode}.primaryBackground`}
        borderColor={`${colorMode}.separator`}
      >
        <HexagonIcon
          width={wp(39)}
          height={hp(35)}
          backgroundColor={buyBitCoinHexagonBackgroundColor}
          icon={<MultiSendSvg />}
        />
        <Text color={`${colorMode}.primaryText`} fontSize={12} style={styles.addressText}>
          {receivingAddress}
        </Text>
      </Box>
      <Box style={styles.flexSpacer} />

      <Text color={`${colorMode}.black`} style={styles.buyBtcContent}>
        {rampTranslations.byProceedRampParagraph}
      </Text>

      <Box style={styles.footer}>
        <Buttons
          primaryText={common.proceed}
          primaryCallback={() => buyWithRamp(receivingAddress)}
          fullWidth
        />
      </Box>
      <ActivityIndicatorView visible={loading} />
    </ScreenWrapper>
  );
}

export default BuyBitcoinScreen;

const styles = StyleSheet.create({
  container: {
    marginTop: hp(50),
    marginHorizontal: wp(10),
    justifyContent: 'center',
  },
  iconContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  footer: {
    flexDirection: 'row',
    marginHorizontal: '3%',
    marginVertical: hp(10),
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  buyBtcContent: {
    fontSize: 13,
    letterSpacing: 0.13,
    lineHeight: 20,
    width: wp(290),
    marginHorizontal: wp(10),
    marginVertical: hp(10),
  },
  toWalletWrapper: {
    height: hp(110),
    marginTop: hp(20),
    paddingHorizontal: wp(20),
    borderRadius: 10,
    justifyContent: 'center',
    gap: 12,
  },
  presentationName: {
    fontSize: 14,
    letterSpacing: 0.14,
  },
  addressTextView: {
    width: wp(200),
    fontSize: 14,
    letterSpacing: 0.14,
    lineHeight: 20,
  },
  flexSpacer: {
    flex: 1,
  },
  cardWrapper: {
    paddingHorizontal: hp(20),
    paddingVertical: hp(20),
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: hp(20),
    marginTop: hp(30),
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
});
