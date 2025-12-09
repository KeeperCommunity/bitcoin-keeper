import React, { useContext } from 'react';
import { StyleSheet } from 'react-native';
import { useDispatch } from 'react-redux';
import { useAppSelector } from 'src/store/hooks';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import HeartIcon from 'src/assets/images/heart.svg';
import { Box, useColorMode } from 'native-base';
import { setShowTipModal } from 'src/store/reducers/settings';
import { CommonActions, useNavigation } from '@react-navigation/native';
import KeeperModal from '../KeeperModal';
import config from 'src/utils/service-utilities/config';

type TipBottomSheetProps = {};

export const TipBottomSheet = (props: TipBottomSheetProps) => {
  const dispatch = useDispatch();
  const { showTipModal } = useAppSelector((state) => state.settings);
  const { settings, common } = useContext(LocalizationContext).translations;
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { tipAddress } = useAppSelector((state) => state.settings);
  const fromSettings = tipAddress == config.ADDRESS.settings;

  const onDismiss = () => dispatch(setShowTipModal({ status: false }));

  const navigateToPay = () => {
    navigation.dispatch(CommonActions.navigate({ name: 'SendTip', params: { tipAddress } }));
    onDismiss();
  };

  return (
    showTipModal && (
      <KeeperModal
        visible={showTipModal}
        title={fromSettings ? settings.supportDeveloperTitle : settings.supportDeveloperTitle2}
        subTitle={
          fromSettings ? settings.supportDeveloperSubTitle : settings.supportDeveloperSubTitle2
        }
        close={onDismiss}
        showCloseIcon={false}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={settings.tipNow}
        buttonCallback={navigateToPay}
        secondaryButtonText={fromSettings ? common.maybeLater : common.noThanks}
        secondaryCallback={onDismiss}
        Content={() => (
          <Box style={styles.illustration}>
            <HeartIcon />
          </Box>
        )}
      />
    )
  );
};

const styles = StyleSheet.create({
  illustration: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
