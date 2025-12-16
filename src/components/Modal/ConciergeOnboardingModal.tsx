import { StyleSheet } from 'react-native';
import React, { useContext } from 'react';
import KeeperModal from 'src/components/KeeperModal';
import { useDispatch } from 'react-redux';
import { Box, useColorMode } from 'native-base';
import { hp, wp } from 'src/constants/responsive';
import { hideOnboarding } from 'src/store/reducers/concierge';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import QueryIllustrationLight from 'src/assets/images/concierge-query-illustration-light.svg';
import QueryIllustrationDark from 'src/assets/images/concierge-query-illustration-dark.svg';
import { setDontShowConceirgeOnboarding } from 'src/store/reducers/storage';
import Text from '../KeeperText';
import { CommonActions, useNavigation } from '@react-navigation/native';
import Colors from 'src/theme/Colors';

function ConciergeOnboardingModal({ visible }) {
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { common, concierge } = translations;
  const isDarkMode = colorMode === 'dark';

  const handleCloseModal = () => {
    dispatch(hideOnboarding());
  };
  const handleContinue = () => {
    dispatch(hideOnboarding());
    dispatch(setDontShowConceirgeOnboarding());
    // navigation.dispatch(CommonActions.navigate({ name: 'KeeperConcierge' }));
  };

  return (
    <KeeperModal
      visible={visible}
      close={handleCloseModal}
      title={concierge.welcomeToConcierge}
      subTitle={concierge.getAnsweredWithConcierge}
      subTitleWidth={wp(310)}
      buttonText={common.confirm}
      buttonCallback={handleContinue}
      buttonBackground={Colors.headerWhite}
      buttonTextColor={Colors.primaryGreen}
      modalBackground={`${colorMode}.pantoneGreen`}
      textColor={`${colorMode}.headerWhite`}
      Content={() => (
        <Box>
          <Box style={styles.illustrationContainer}>
            {isDarkMode ? <QueryIllustrationDark /> : <QueryIllustrationLight />}
          </Box>
          <Text color={`${colorMode}.headerWhite`} style={styles.modalText}>
            {concierge.conciergeModalDesc}
          </Text>
        </Box>
      )}
      showCloseIcon={false}
    />
  );
}

const styles = StyleSheet.create({
  illustrationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: hp(25),
    marginBottom: hp(43),
  },
  modalText: {
    marginBottom: hp(10),
  },
});

export default ConciergeOnboardingModal;
