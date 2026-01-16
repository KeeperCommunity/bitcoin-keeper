import { Box, ScrollView, useColorMode } from 'native-base';
import React, { useContext, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import Colors from 'src/theme/Colors';
import MapPin from 'src/assets/images/MapPinIcon.svg';
import Buttons from 'src/components/Buttons';
import ViewProfile from 'src/assets/images/view-profile.svg';
import { useNavigation } from '@react-navigation/native';
import sha256 from 'crypto-js/sha256';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import FastImage from 'react-native-fast-image';

type Props = {
  advisor?: any;
};

const getColorForLabel = (label: string, colorsArray: string[]) => {
  const hash = sha256(label).toString();
  const hashNum = parseInt(hash.slice(0, 8), 16);
  return colorsArray[hashNum % colorsArray.length];
};

const AdvisorCard = ({ advisor }: Props) => {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { translations } = useContext(LocalizationContext);
  const { concierge } = translations;

  const tagColors = useMemo(() => {
    return Object.entries(Colors)
      .filter(([key]) => key.startsWith('TagLight'))
      .map(([, value]) => value);
  }, []);

  function ExpertiesPill({ name }: { name: string }) {
    const backgroundColor = getColorForLabel(name, tagColors);
    return (
      <Box style={styles.pill} backgroundColor={backgroundColor}>
        <Text color={Colors.WarmIvory} fontSize={11}>
          {name}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      style={styles.container}
      backgroundColor={`${colorMode}.textInputBackground`}
      borderColor={`${colorMode}.separator`}
    >
      <Box style={styles.header}>
        <Box
          style={styles.circle}
          borderColor={`${colorMode}.pantoneGreen`}
          backgroundColor={Colors.headerWhite}
        >
          <FastImage source={{ uri: advisor.image }} style={styles.image} />
        </Box>

        <Box>
          <Box>
            <Text fontSize={14} semiBold>
              {advisor.title}
            </Text>
            <Box style={styles.pinContainer}>
              <MapPin width={wp(14)} height={hp(14)} />
              <Text fontSize={13} color={Colors.lightGrayBeige}>
                {advisor.country}
              </Text>
            </Box>
          </Box>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Box style={styles.pillsScrollWrapper}>
              <Box style={styles.PillsContainer}>
                {advisor?.expertise?.map((item) => (
                  <ExpertiesPill key={item} name={item} />
                ))}
              </Box>
            </Box>
          </ScrollView>

          <Box style={styles.timeContainer}>
            <Text fontSize={12} medium color={`${colorMode}.black`}>
              {concierge.timeZone}:
            </Text>
            <Text color={`${colorMode}.textGreen`} fontSize={12}>
              {advisor.timezone}
            </Text>
          </Box>

          <Box style={styles.timeContainer}>
            <Text fontSize={12} medium color={`${colorMode}.black`}>
              {concierge.language}:
            </Text>
            <Text
              style={styles.languageContainer}
              color={`${colorMode}.textGreen`}
              fontSize={12}
              numberOfLines={2}
            >
              {advisor.languages.join(', ')}
            </Text>
          </Box>
        </Box>
      </Box>

      <Box style={styles.ButtonContainer}>
        <Buttons
          primaryText={concierge.ViewProfile}
          fullWidth
          RightIcon={ViewProfile}
          primaryCallback={() => navigation.navigate('AdvisorDetail', { advisor })}
        />
      </Box>
    </Box>
  );
};

export default AdvisorCard;

const styles = StyleSheet.create({
  container: {
    padding: wp(20),
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: wp(15),
    top: wp(25),
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    gap: wp(10),
    marginBottom: wp(10),
  },
  circle: {
    width: wp(60),
    height: wp(60),
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  pinContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: wp(5),
    marginBottom: wp(10),
    gap: wp(5),
  },
  PillsContainer: {
    flexDirection: 'row',
    gap: wp(5),
    paddingRight: wp(20),
    marginRight: wp(30),
  },
  pillsScrollWrapper: {
    height: wp(30),
    marginBottom: wp(8),
  },
  pill: {
    paddingHorizontal: wp(10),
    height: wp(22),
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: wp(30),
  },
  timeContainer: {
    flexDirection: 'row',
    gap: wp(5),
    marginBottom: wp(10),
  },
  ButtonContainer: {
    marginTop: wp(5),
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 100,
  },
  languageContainer: {
    width: wp(160),
  },
});
