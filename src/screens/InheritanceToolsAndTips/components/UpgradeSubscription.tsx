import React, { useContext } from 'react';
import { Box, HStack, useColorMode } from 'native-base';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Text from 'src/components/KeeperText';
import { useNavigation } from '@react-navigation/native';
import { hp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';

function UpgradeSubscription({
  type,
  customStyles,
  navigation = null,
  onPress = () => {},
  showText = true,
}) {
  if (!navigation) {
    navigation = useNavigation();
  }
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { common } = translations;

  return (
    <HStack
      style={StyleSheet.flatten([styles.container, customStyles?.container])}
      borderColor={`${colorMode}.lightSkin`}
      justifyContent={'space-around'}
    >
      {showText && (
        <Text style={StyleSheet.flatten([customStyles?.unlockAtText])}>Unlock at {type}</Text>
      )}
      <TouchableOpacity
        activeOpacity={0.6}
        onPress={() => {
          onPress();
          // navigation.navigate('ChoosePlan');
        }}
        testID="choosePlan"
      >
        <Box
          borderColor={`${colorMode}.brownBackground`}
          backgroundColor={`${colorMode}.brownBackground`}
          style={StyleSheet.flatten([styles.learnMoreContainer, customStyles?.learnMoreContainer])}
        >
          <Text
            color={`${colorMode}.buttonText`}
            medium
            style={StyleSheet.flatten([styles.learnMoreText, customStyles?.learnMoreText])}
          >
            {common.upgrade}
          </Text>
        </Box>
      </TouchableOpacity>
    </HStack>
  );
}

const styles = StyleSheet.create({
  learnMoreContainer: {
    flexDirection: 'row',
    gap: 3,
    borderWidth: 0.5,
    borderRadius: 5,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  learnMoreText: {
    fontSize: 12,
    letterSpacing: 0.24,
    alignSelf: 'center',
  },
  container: {
    borderTopWidth: 2,
    paddingTop: hp(10),
  },
});

export default UpgradeSubscription;
