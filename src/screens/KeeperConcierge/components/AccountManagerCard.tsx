import { Box, useColorMode } from 'native-base';
import React from 'react';
import { Image, Linking, StyleSheet, TouchableOpacity } from 'react-native';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import { capitalizeEachWord } from 'src/utils/utilities';

//
import CalendlyIcon from 'src/assets/images/link_calendly.svg';
import WhatsappIcon from 'src/assets/images/link_whatsapp.svg';
import EmailIcon from 'src/assets/images/link_email.svg';
import PhoneIcon from 'src/assets/images/link_phone.svg';
import TelegramIcon from 'src/assets/images/link_telegram.svg';
//
import CalendlyIconDark from 'src/assets/images/link_calendly_dark.svg';
import WhatsappIconDark from 'src/assets/images/link_whatsapp_dark.svg';
import EmailIconDark from 'src/assets/images/link_email_dark.svg';
import PhoneIconDark from 'src/assets/images/link_phone_dark.svg';
import TelegramIconDark from 'src/assets/images/link_telegram_dark.svg';
import FastImage from 'react-native-fast-image';

const ICON_MAP = {
  dark: {
    calendly: <CalendlyIconDark />,
    whatsapp: <WhatsappIconDark />,
    email: <EmailIconDark />,
    phone: <PhoneIconDark />,
    telegram: <TelegramIconDark />,
  },
  light: {
    calendly: <CalendlyIcon />,
    whatsapp: <WhatsappIcon />,
    email: <EmailIcon />,
    phone: <PhoneIcon />,
    telegram: <TelegramIcon />,
  },
};

export const AccountManagerCard = ({ data }) => {
  const { colorMode } = useColorMode();

  return (
    <Box style={styles.container}>
      <Text medium fontSize={14}>
        Account Manager
      </Text>
      <Box
        style={styles.cardCtr}
        backgroundColor={`${colorMode}.seashellWhite`}
        borderColor={`${colorMode}.separator`}
      >
        <Box style={styles.profileCtr}>
          <FastImage
            style={styles.image}
            source={{
              uri: data.image,
            }}
          />
          <Text fontSize={15} semiBold>
            {data.fullName}
          </Text>
        </Box>
        <Box style={styles.linkCtr}>
          {Object.entries(data.links).map(([key, value]: [string, string]) => {
            return (
              <TouchableOpacity key={key} onPress={() => Linking.openURL(value)}>
                <Box
                  style={styles.linkBox}
                  borderColor={`${colorMode}.dullGreyBorder`}
                  backgroundColor={`${colorMode}.primaryBackground`}
                >
                  {ICON_MAP[colorMode][key]}
                  <Text fontSize={12}>{capitalizeEachWord(key)}</Text>
                </Box>
              </TouchableOpacity>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: hp(20),
  },
  linkBox: {
    flexDirection: 'column',
    borderWidth: 1,
    alignItems: 'center',
    borderRadius: 8,
    gap: hp(7),
    paddingVertical: hp(10),
    width: wp(90),
  },
  linkCtr: {
    flexDirection: 'row',
    marginTop: hp(20),
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: hp(10),
    columnGap: wp(10),
  },
  image: {
    height: wp(100),
    width: wp(100),
    borderRadius: 100,
  },
  profileCtr: { alignSelf: 'center', gap: hp(10), alignItems: 'center' },
  cardCtr: {
    marginTop: hp(12),
    padding: wp(15),
    borderRadius: wp(10),
    borderWidth: 1,
  },
});
