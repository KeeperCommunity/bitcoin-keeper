import React from 'react';
import { Box, useColorMode } from 'native-base';
import { TouchableOpacity } from 'react-native-gesture-handler';
import Text from 'src/components/KeeperText';
import { StyleSheet } from 'react-native';
import { windowWidth, wp } from 'src/constants/responsive';

interface PlebContainerProps {
  backgroundColor?: string;
  title?: any;
  subtitle?: string;
  titleColor?: string;
  subtitleColor?: string;
  description?: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  showDot?: boolean;
}

const PlebContainer: React.FC<PlebContainerProps> = ({
  backgroundColor = 'transparent',
  title,
  titleColor,
  subtitleColor,
  subtitle,
  icon,
  description,
  onPress,
  showDot = false,
}) => {
  const { colorMode } = useColorMode();
  return (
    <>
      {showDot && <Box style={styles.alertContainer} backgroundColor={`${colorMode}.alertRed`} />}
      <TouchableOpacity onPress={onPress} testID={`btn_pleb_${title}`}>
        <Box backgroundColor={backgroundColor} style={styles.Container}>
          <Box>
            <Text color={titleColor} fontSize={14} semiBold style={styles.title}>
              {title}{' '}
              {subtitle && (
                <Text color={subtitleColor} fontSize={12} medium>
                  ({subtitle})
                </Text>
              )}
            </Text>
            {description && (
              <Text fontSize={12} color={subtitleColor} style={{ maxWidth: '99%' }}>
                {description}
              </Text>
            )}
          </Box>

          <Box>{icon}</Box>
        </Box>
      </TouchableOpacity>
    </>
  );
};

export default PlebContainer;

const styles = StyleSheet.create({
  Container: {
    width: windowWidth * 0.89,
    height: wp(84),
    marginBottom: wp(18),
    borderRadius: 15,
    padding: 21,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    marginBottom: 2,
  },
  alertContainer: {
    height: wp(10),
    width: wp(10),
    borderRadius: 10,
    position: 'absolute',
    zIndex: 10,
  },
});
