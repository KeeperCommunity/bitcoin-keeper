import React, { useContext } from 'react';
import { Box, useColorMode } from 'native-base';
import Text from 'src/components/KeeperText';
import { Linking, StyleSheet, TouchableOpacity } from 'react-native';
import { windowWidth, wp } from 'src/constants/responsive';
import Colors from 'src/theme/Colors';
import { SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import KeeperPrivateIconWhite from 'src/assets/images/KeeperPrivateIconWhite.svg';
import { LocalizationContext } from 'src/context/Localization/LocContext';

const SIZE = 40;
const KeeperPrivateCard = ({
}) => {
  const { colorMode } = useColorMode();
  const {choosePlan} = useContext(LocalizationContext).translations;
  return (
      <TouchableOpacity onPress={()=>Linking.openURL(`https://bitcoinkeeper.app/private`)}>
        <Box backgroundColor={Colors.GreenishGrey} style={styles.Container}>
          <Box style={{
          }}><KeeperPrivateIconWhite width={SIZE} height={SIZE} /></Box>
          <Box>
            <Text color={`${colorMode}.whiteSecButtonText`} fontSize={14} semiBold style={styles.title}>
              {SubscriptionTier.L4}
            </Text>
            <Text fontSize={12} color={`${colorMode}.whiteSecButtonText`} style={{maxWidth:'99%'}}>
              {choosePlan.keeperPrivateSubTitle}
            </Text>
          </Box>
        </Box>
      </TouchableOpacity>
  );
};

export default KeeperPrivateCard;

const styles = StyleSheet.create({
  Container: {
    width: windowWidth * 0.89,
    marginBottom: wp(18),
    borderRadius: 15,
    padding: wp(10),
    flexDirection: 'row',
    gap:wp(10),
    alignItems:"center",
  },
  title: {
    marginBottom: 2,
  },
});
