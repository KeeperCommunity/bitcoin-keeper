import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import React from 'react';
import { StyleSheet } from 'react-native';
import Buttons from 'src/components/Buttons';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import openLink from 'src/utils/OpenLink';

type Props = {
  title?: string;
  title2?: string;
  title2Sub?: string;
  image?: Element;
  flagIcon?: Element;
  country?: string;
  plan?: any;
  subscribeText?: string;
  unSubscribeText?: string;
  link?: string;
  madeText?: string;
  buttonText?: string;
  onPress?: () => void;
};

const DeviceCard = (props: Props) => {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';

  return (
    <Box
      style={styles.container}
      backgroundColor={`${colorMode}.textInputBackground`}
      borderColor={`${colorMode}.separator`}
      borderWidth={1}
    >
      <Box style={styles.imageContainer} backgroundColor={`${colorMode}.hardWareImageBackGround`}>
        {props.image}
      </Box>
      <Box style={styles.secondoryContainer}>
        {props.title && (
          <Box style={styles.titleContainer}>
            <Text medium fontSize={15} color={`${colorMode}.primaryText`} style={styles.title}>
              {props.title}
            </Text>

            <Box style={styles.rowContainer}>
              <Text
                color={
                  isDarkMode ? `${colorMode}.secondaryCreamWhite` : `${colorMode}.GreenishGrey`
                }
              >
                {props.madeText}{' '}
              </Text>
              <Box style={styles.flagContainer}>
                <Text
                  color={
                    isDarkMode ? `${colorMode}.secondaryCreamWhite` : `${colorMode}.GreenishGrey`
                  }
                >
                  {props.country}
                </Text>
                {props.flagIcon}
              </Box>
            </Box>
          </Box>
        )}
        {props.title2 && (
          <Box style={styles.title2Conntainer}>
            <Text medium fontSize={15} color={`${colorMode}.primaryText`} style={styles.title}>
              {props.title2}
            </Text>
            <Text
              medium
              fontSize={12}
              color={isDarkMode ? `${colorMode}.secondaryCreamWhite` : `${colorMode}.GreenishGrey`}
              style={styles.title}
            >
              {props.title2Sub}
            </Text>
          </Box>
        )}
        <Box>
          <Buttons
            fullWidth
            primaryFontWeight="400"
            primaryText={props.buttonText}
            paddingVertical={hp(8)}
            primaryCallback={() => {
              if (props.onPress) {
                props.onPress();
              } else {
                openLink(props.link);
              }
            }}
            borderRadius={6}
          />
          {props.plan ? (
            <Text style={styles.subText} semiBold fontSize={11} color={`${colorMode}.primaryText`}>
              {props.unSubscribeText}
            </Text>
          ) : (
            <Text
              semiBold
              fontSize={11}
              color={isDarkMode ? `${colorMode}.secondaryCreamWhite` : `${colorMode}.BrownNeedHelp`}
              style={styles.subText}
            >
              {props.subscribeText}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default DeviceCard;

const styles = StyleSheet.create({
  container: {
    borderRadius: wp(10),
    paddingVertical: hp(12),
    paddingHorizontal: wp(10),
    flexDirection: 'row',
  },
  imageContainer: {
    width: wp(90),
    borderRadius: wp(8),
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondoryContainer: {
    gap: wp(10),
    flex: 1,
    justifyContent: 'space-between',
    paddingLeft: wp(20),
    paddingRight: wp(15),
  },
  title: {
    marginBottom: hp(4),
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  flagContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(4),
    flexWrap: 'wrap',
    flex: 1,
  },
  subText: {
    marginTop: hp(10),
  },
  titleContainer: {
    marginBottom: hp(10),
  },
  title2Conntainer: {
    marginTop: hp(20),
    flexDirection: 'row',
    alignItems: 'center',
  },
});
