import React, { useCallback, useContext, useRef } from 'react';
import { Box, useColorMode } from 'native-base';
import { StyleSheet } from 'react-native';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import SettingCard from './Component/SettingCard';
import { useSettingKeeper } from 'src/hooks/useSettingKeeper';
import usePlan from 'src/hooks/usePlan';
import Text from 'src/components/KeeperText';
import Colors from 'src/theme/Colors';
import { hp, wp } from 'src/constants/responsive';
import { UpgradeCTA } from 'src/components/UpgradeCTA';
import { useFocusEffect } from '@react-navigation/native';
import { setShowTipModal } from 'src/store/reducers/settings';
import config from 'src/utils/service-utilities/config';
import { useDispatch } from 'react-redux';

const InheritanceDocumentScreen = () => {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText, inheritancePlanning } = translations;
  const { inheritanceDocument } = useSettingKeeper();
  const { isOnL3Above } = usePlan();
  const dispatch = useDispatch();

  const hasFocusedOnce = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (hasFocusedOnce.current)
        dispatch(setShowTipModal({ status: true, address: config.ADDRESS.inheritanceDoc }));
      else hasFocusedOnce.current = true;
    }, [])
  );

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <Box style={styles.container} backgroundColor={`${colorMode}.primaryBackground`}>
        <Box style={styles.header}>
          <WalletHeader title={signerText.inheritanceDocuments} />
        </Box>

        {!isOnL3Above && (
          <Box style={styles.upgradeCtr}>
            <Text fontSize={14} semiBold style={styles.upgradeText}>
              {inheritancePlanning.unlockMessage}
            </Text>
            <UpgradeCTA
              title={'Upgrade'}
              backgroundColor={Colors.GreenishGrey}
              // onPress={() => navigation.dispatch(CommonActions.navigate('ChoosePlan'))}
              onPress={() => {}}
            />
          </Box>
        )}

        <SettingCard
          subtitleColor={`${colorMode}.balanceText`}
          backgroundColor={`${colorMode}.textInputBackground`}
          borderColor={`${colorMode}.separator`}
          items={inheritanceDocument}
        />
      </Box>
    </ScreenWrapper>
  );
};

export default InheritanceDocumentScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    marginBottom: 18,
  },
  upgradeCtr: { gap: hp(10), marginBottom: hp(15) },
  upgradeText: {
    textAlign: 'center',
    lineHeight: wp(20),
  },
});
