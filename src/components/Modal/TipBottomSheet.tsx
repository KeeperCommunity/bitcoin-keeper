import React, { useContext } from 'react';
import { StyleSheet } from 'react-native';
import { useDispatch } from 'react-redux';
import { useAppSelector } from 'src/store/hooks';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import TipIllustration from 'src/assets/images/TipIllustration.svg';
import { Box, useColorMode } from 'native-base';
import { setShowTipModal, dismissTipFlow } from 'src/store/reducers/settings';
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

  const onNoThanks = () => {
    if (tipAddress) {
      const flowIdentifier = config.getTipFlowIdentifier(tipAddress);
      if (flowIdentifier) {
        dispatch(dismissTipFlow(flowIdentifier));
      }
    }
    onDismiss();
  };

  const navigateToPay = () => {
    if (!fromSettings) {
      const flowIdentifier = config.getTipFlowIdentifier(tipAddress);
      if (flowIdentifier) {
        dispatch(dismissTipFlow(flowIdentifier));
      }
    }
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
        secondaryCallback={fromSettings ? onDismiss : onNoThanks}
        Content={() => (
          <Box style={styles.illustration}>
            <TipIllustration />
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
