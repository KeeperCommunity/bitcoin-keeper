import React from 'react';
import { Box } from 'native-base';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import Fonts from 'src/constants/Fonts';
import ThemedSvg from './ThemedSvg.tsx/ThemedSvg';

type Props = {
  title?: string;
  enableBack?: boolean;
  onPressHandler?: () => void;
  titleColor?: string;
  data?: any;
  rightComponent?: any;
  subTitle?: string;
  subtitleColor?: string;
  learnMore?: boolean;
  learnMorePressed?: () => void;
};

const WalletHeader: React.FC<Props> = ({
  title = '',
  enableBack = true,
  onPressHandler,
  titleColor,
  rightComponent,
  subTitle,
  subtitleColor,
  learnMore,
  learnMorePressed,
}) => {
  const navigation = useNavigation();

  const styles = StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
    },
    leftContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    backButton: {
      height: hp(44),
      width: wp(28),
      justifyContent: 'center',
    },
    title: {
      fontSize: 18,
      fontFamily: Fonts.LoraMedium,
      flexGrow: 1,
    },
    subTitle: {
      fontSize: 14,
      marginTop: 10,
      width: '90%',
    },

    settingBtn: {
      paddingHorizontal: 22,
      paddingVertical: 22,
    },

    infoIcon: {
      width: wp(40),
      height: wp(40),
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: wp(5),
    },
  });

  return (
    <Box width={'100%'}>
      <Box style={styles.container}>
        <Box style={styles.leftContainer}>
          {enableBack && (
            <TouchableOpacity
              testID="btn_back"
              onPress={onPressHandler || navigation.goBack}
              style={styles.backButton}
            >
              <ThemedSvg name={'back_Button'} />
            </TouchableOpacity>
          )}
          {title && (
            <Text color={titleColor} style={styles.title} medium numberOfLines={1}>
              {title}
            </Text>
          )}
        </Box>
        {learnMore && (
          <TouchableOpacity style={styles.infoIcon} onPress={learnMorePressed}>
            <ThemedSvg name={'info_icon'} />
          </TouchableOpacity>
        )}
        {rightComponent && <Box>{rightComponent}</Box>}
      </Box>
      {subTitle && (
        <Text color={subtitleColor} style={styles.subTitle}>
          {subTitle}
        </Text>
      )}
    </Box>
  );
};

export default WalletHeader;
