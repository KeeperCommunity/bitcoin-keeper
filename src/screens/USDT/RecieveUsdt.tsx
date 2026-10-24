import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useContext } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import KeeperQRCode from 'src/components/KeeperQRCode';
import Text from 'src/components/KeeperText';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletCopiableData from 'src/components/WalletCopiableData';
import WalletHeader from 'src/components/WalletHeader';
import { hp, windowWidth } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { USDTWallet } from 'src/services/wallets/factories/USDTWalletFactory';

const RecieveUsdt = ({ route }) => {
  const { usdtWallet }: { usdtWallet: USDTWallet } = route.params;
  const details = usdtWallet.accountStatus.gasFreeAddress;
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { usdtWalletText, common } = translations;

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <WalletHeader title={usdtWalletText.receive} />

        <Box
          style={styles.warning}
          backgroundColor={`${colorMode}.thirdBackground`}
          borderColor={`${colorMode}.separator`}
        >
          <Text medium color={`${colorMode}.primaryText`}>
            {usdtWalletText.sendingPausedTitle}
          </Text>
          <Text color={`${colorMode}.primaryText`} style={styles.warningBody}>
            {usdtWalletText.receivePausedWarning}
          </Text>
        </Box>

        <Box
          style={styles.container}
          backgroundColor={`${colorMode}.thirdBackground`}
          borderColor={`${colorMode}.separator`}
        >
          <Box borderWidth={15} borderColor={`${colorMode}.buttonText`}>
            {details && <KeeperQRCode qrData={details} size={windowWidth * 0.7} showLogo />}
          </Box>
          <Box>
            <WalletCopiableData
              data={details}
              width={windowWidth * 0.8}
              height={hp(65)}
              dataType="address"
            />
          </Box>
        </Box>

        <Box mt="auto" p={4}>
          <Text bold mb={2} color={`${colorMode}.dashedButtonBorderColor`}>
            {common.note}
          </Text>
          <Text color={`${colorMode}.primaryText`}>{usdtWalletText.sendOnlyUsdt}</Text>
        </Box>
      </ScrollView>
    </ScreenWrapper>
  );
};

export default RecieveUsdt;

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  warning: {
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: hp(12),
    paddingHorizontal: 16,
    paddingVertical: hp(12),
  },
  warningBody: {
    marginTop: hp(6),
  },
  container: {
    alignItems: 'center',
    marginTop: hp(20),
    borderWidth: 1,
    paddingTop: 20,
    borderRadius: 10,
  },
});
