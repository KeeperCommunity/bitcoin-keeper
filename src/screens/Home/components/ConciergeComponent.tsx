import { Box, useColorMode } from 'native-base';
import React, { useContext } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import Buttons from 'src/components/Buttons';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import Text from 'src/components/KeeperText';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import AskQuestionIcon from 'src/assets/images/ask-question.svg';
import HireAdvisorIcon from 'src/assets/images/hire-advisor.svg';
import TakeMeThereIcon from 'src/assets/images/take-me-there.svg';
import ConnectAdvisor from 'src/assets/images/connect-advisor.svg';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { useNavigation } from '@react-navigation/native';
import ConciergeWhiteIcon from 'src/assets/images/concierge-white-icon.svg';
import AdvisorWhiteIcon from 'src/assets/images/advisor-white-icon.svg';
import { AccountManagerCard } from 'src/screens/KeeperConcierge/components/AccountManagerCard';
import { useAppSelector } from 'src/store/hooks';

type ConciergeItem = {
  title: string;
  subtitle: string;
  iconName: any;
  buttonText: string;
  callback: () => void;
  buttonIcon?: any;
};

const ConciergeComponent = ({ route }) => {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const { translations } = useContext(LocalizationContext);
  const { concierge: conciergeText } = translations;
  const navigation = useNavigation();
  const { accountManagerDetails } = useAppSelector((state) => state?.concierge);

  const conciergeData: ConciergeItem[] = [
    {
      title: conciergeText.askQuestion,
      subtitle: conciergeText.submitTicket,
      iconName: isDarkMode ? <ConciergeWhiteIcon /> : <AskQuestionIcon />,
      buttonText: conciergeText.takeMeThere,
      callback: () => {
        navigation.navigate('KeeperSupport');
      },
      buttonIcon: TakeMeThereIcon,
    },
    {
      title: conciergeText.hireAdvisor,
      subtitle: conciergeText.whiteGlovedService,
      iconName: isDarkMode ? <AdvisorWhiteIcon /> : <HireAdvisorIcon />,
      buttonText: conciergeText.connetWithAdvisor,
      callback: () => {
        navigation.navigate('Advisors');
      },
      buttonIcon: ConnectAdvisor,
    },
  ];

  return (
    <ScrollView style={styles.container}>
      {accountManagerDetails && <AccountManagerCard data={accountManagerDetails} />}
      {conciergeData.map((item, index) => (
        <Box
          key={index}
          style={styles.Card}
          backgroundColor={`${colorMode}.textInputBackground`}
          borderColor={`${colorMode}.separator`}
        >
          <Box style={styles.iconContainer}>
            <CircleIconWrapper
              width={wp(35)}
              icon={item.iconName}
              backgroundColor={`${colorMode}.separator`}
            />
            <Box style={styles.textContainer}>
              <Text fontSize={15} medium color={`${colorMode}.primaryText`}>
                {item.title}
              </Text>
              <Text fontSize={12} color={`${colorMode}.primaryText`}>
                {item.subtitle}
              </Text>
            </Box>
          </Box>
          <Box>
            <Buttons
              primaryText={item.buttonText}
              primaryCallback={item.callback}
              fullWidth
              RightIcon={item.buttonIcon}
            />
          </Box>
        </Box>
      ))}
    </ScrollView>
  );
};

export default ConciergeComponent;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: wp(22),
    paddingVertical: hp(10),
  },
  Card: {
    width: windowWidth * 0.88,
    borderWidth: 1,
    padding: wp(20),
    gap: 10,
    borderRadius: 10,
    marginBottom: hp(20),
  },
  iconContainer: {
    flexDirection: 'row',
    gap: 15,
    marginBottom: hp(10),
  },
  textContainer: {
    width: wp(220),
    gap: 5,
  },
});
