import React from 'react';
import { Box, useColorMode } from 'native-base';
import { StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import Text from 'src/components/KeeperText';
import { hp, windowWidth, wp } from 'src/constants/responsive';

type SignerOptionCardProps = {
  name: string;
  icon: React.ReactElement;
  isSelected?: boolean;
  onCardSelect?: (selected: any) => void;
  showSelection?: boolean;
  customStyle?: ViewStyle;
  disabled?: boolean;
  backgroundColor?: string;
  borderColor?: string;
};

function SignerOptionCard({
  name,
  icon,
  isSelected,
  onCardSelect,
  customStyle,
  disabled = false,
  backgroundColor,
  borderColor,
}: SignerOptionCardProps) {
  const { colorMode } = useColorMode();
  const cardBackgroundColor = backgroundColor || `${colorMode}.seashellWhite`;
  const cardStyle = [styles.cardContainer, disabled ? { opacity: 0.5 } : null, customStyle];
  const cardBorderColor = borderColor || `${colorMode}.dullGreyBorder`;

  const handlePress = () => {
    if (!disabled && onCardSelect) {
      onCardSelect(isSelected);
    }
  };

  return (
    <TouchableOpacity onPress={handlePress} testID={`btn_${name}`} disabled={disabled}>
      <Box style={cardStyle} backgroundColor={cardBackgroundColor} borderColor={cardBorderColor}>
        {icon}
        <Box style={styles.textContainer}>
          <Text style={styles.name} color={`${colorMode}.modalWhiteContent`} medium>
            {name}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    width: windowWidth * 0.87,
    paddingVertical: hp(17),
    paddingHorizontal: wp(20),
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    gap: wp(15),
  },
  iconCheckboxContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  textContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    textAlign: 'left',
    flexWrap: 'wrap',
  },
  circle: {
    width: wp(19),
    height: wp(19),
    borderRadius: wp(19) / 2,
    borderWidth: 1,
  },
});

export default SignerOptionCard;
