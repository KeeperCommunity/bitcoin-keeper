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
  const containerbackgroundColor = unavailable
    ? Colors.lightindigoblue
    : status === GasFreeTransferStatus.SUCCEED
    ? Colors.PaleTropicalTeal
    : status === GasFreeTransferStatus.CONFIRMING
    ? Colors.lightOrange
    : Colors.lightindigoblue;

  const textColor = unavailable
    ? Colors.indigoblue
    : status === GasFreeTransferStatus.SUCCEED
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
        {unavailable
          ? translations.usdtWalletText.statusUnavailable
          : status === GasFreeTransferStatus.SUCCEED
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
