import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useContext } from 'react';
import { StyleSheet } from 'react-native';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import { GasFreeTransferStatus } from 'src/services/wallets/operations/dollars/GasFree';
import Colors from 'src/theme/Colors';
import { LocalizationContext } from 'src/context/Localization/LocContext';

const StatusContent = ({ status, unavailable = false }) => {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  // A legacy SUCCEED value is not proof of a confirmed chain transaction.
  const statusUnavailable =
    unavailable ||
    status === GasFreeTransferStatus.SUCCEED ||
    status === GasFreeTransferStatus.UNVERIFIED;
  const chainConfirmed = status === GasFreeTransferStatus.CHAIN_CONFIRMED;
  const containerbackgroundColor = statusUnavailable
    ? Colors.lightindigoblue
    : chainConfirmed
    ? Colors.PaleTropicalTeal
    : status === GasFreeTransferStatus.CONFIRMING
    ? Colors.lightOrange
    : Colors.lightindigoblue;

  const textColor = statusUnavailable
    ? Colors.indigoblue
    : chainConfirmed
    ? Colors.TropicalTeal
    : status === GasFreeTransferStatus.CONFIRMING
    ? Colors.darkOrange
    : Colors.indigoblue;
  return (
    <Box
      backgroundColor={containerbackgroundColor}
      borderColor={`${colorMode}.separator`}
      style={styles.container}
    >
      <Text fontSize={12} color={textColor}>
        {statusUnavailable
          ? translations.usdtWalletText.statusUnavailable
          : chainConfirmed
          ? 'SUCCESS'
          : status}
      </Text>
    </Box>
  );
};

export default StatusContent;

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 30,
    minWidth: wp(80),
    paddingHorizontal: wp(8),
    height: hp(20),
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: hp(10),
  },
});
