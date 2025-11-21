import React from 'react';
import { Box, Pressable, useColorMode } from 'native-base';
import Text from 'src/components/KeeperText';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import RightArrowLight from 'src/assets/images/icon_arrow.svg';
import RightArrowDark from 'src/assets/images/icon_arrow_white.svg';
import { wp, hp } from 'src/constants/responsive';
import { StyleSheet } from 'react-native';

interface MenuOptionProps {
  Icon: Element;
  title: string;
  callback: () => void;
  showArrow?: boolean;
}

const MenuOption: React.FC<MenuOptionProps> = ({ Icon, title, callback, showArrow = true }) => {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';

  return (
    <Pressable onPress={callback}>
      <Box
        style={styles.buttonContainer}
        backgroundColor={`${colorMode}.boxSecondaryBackground`}
        borderColor={`${colorMode}.dullGreyBorder`}
      >
        <Box style={styles.buttonLeftContainer}>
          <CircleIconWrapper
            width={wp(39)}
            icon={Icon}
            backgroundColor={`${colorMode}.pantoneGreen`}
          />
          <Text
            color={`${colorMode}.primaryText`}
            medium
            numberOfLines={1}
            style={styles.buttonText}
          >
            {title}
          </Text>
        </Box>
        {showArrow && <Box>{isDarkMode ? <RightArrowDark /> : <RightArrowLight />}</Box>}
      </Box>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  buttonContainer: {
    width: '100%',
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: hp(16),
    paddingBottom: hp(15),
    paddingRight: wp(26),
    paddingLeft: wp(20),
  },
  buttonLeftContainer: {
    width: '75%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(12),
  },
  buttonRightContainer: {
    width: '25%',
    alignItems: 'center',
  },
  buttonText: {
    width: '95%',
  },
});

export default MenuOption;
