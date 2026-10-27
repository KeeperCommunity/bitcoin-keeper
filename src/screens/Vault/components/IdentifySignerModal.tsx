import React, { useCallback, useContext } from 'react';
import KeeperModal from 'src/components/KeeperModal';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { useNavigation, CommonActions } from '@react-navigation/native';
import WarningIllustration from 'src/assets/images/warning.svg';
import Text from 'src/components/KeeperText';
import useVault from 'src/hooks/useVault';
import { LocalizationContext } from 'src/context/Localization/LocContext';

function IdentifySignerModal({ visible, close, signer, secondaryCallback, vaultId }) {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { translations } = useContext(LocalizationContext);
  const { coldcard, common } = translations;

  const { activeVault } = useVault({ vaultId });
  const Content = useCallback(() => {
    return (
      <Box alignItems="center">
        <WarningIllustration />
        <Box>
          <Text color={`${colorMode}.greenText`} fontSize={14} padding={1} letterSpacing={0.65}>
            {coldcard.smoothSignoingProcess}
          </Text>
        </Box>
      </Box>
    );
  }, []);

  const callback = () => {
    close();
    navigation.dispatch(
      CommonActions.navigate({
        name: 'AssignSignerType',
        params: {
          vault: activeVault,
          signer,
        },
      })
    );
  };
  const cleanedSecondaryCallback = () => {
    close();
    secondaryCallback();
  };
  return (
    <KeeperModal
      visible={visible}
      modalBackground={`${colorMode}.modalWhiteBackground`}
      textColor={`${colorMode}.textGreen`}
      subTitleColor={`${colorMode}.modalSubtitleBlack`}
      close={close}
      title={coldcard.assignDeviceType}
      subTitle={coldcard.assignDeviceTypeSubTitle}
      buttonText={common.identify}
      secondaryButtonText={common.skip}
      secondaryCallback={cleanedSecondaryCallback}
      Content={Content}
      buttonCallback={callback}
    />
  );
}

export default IdentifySignerModal;
