import { useNavigation } from '@react-navigation/native';
import { Box, useColorMode } from 'native-base';
import React, { useContext } from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { wp } from 'src/constants/responsive';
import TechnicalSupport from '../KeeperConcierge/TechnicalSupport';
import WalletHeader from 'src/components/WalletHeader';
import { LocalizationContext } from 'src/context/Localization/LocContext';

const KeeperSupport = () => {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { concierge: conciergeText } = useContext(LocalizationContext).translations;

  return (
    <ScreenWrapper paddingHorizontal={0} backgroundcolor={`${colorMode}.primaryBackground`}>
      <StatusBar barStyle={colorMode === 'dark' ? 'light-content' : 'dark-content'} />
      <Box px={6}>
        <WalletHeader title={conciergeText.askQuestion} />
      </Box>
      <Box style={styles.container}>
        {/* adjust the route accordingly  */}
        <TechnicalSupport route={navigation} />
      </Box>
    </ScreenWrapper>
  );
};

export default KeeperSupport;
const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: wp(10),
  },
});
