import { Box, useColorMode } from 'native-base';
import React, { useContext } from 'react';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import Text from 'src/components/KeeperText';
import AirDropIcon from 'src/assets/images/airdrop-circle-icon.svg';
import NFCIcon from 'src/assets/images/nfc-circle-icon.svg';
import QR_Icon from 'src/assets/images/qr-scan-icon.svg';
import { Platform, StyleSheet, TouchableOpacity } from 'react-native';
import { hp, wp } from 'src/constants/responsive';
import { captureError } from 'src/services/sentry';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import DocumentPicker from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import { LocalizationContext } from 'src/context/Localization/LocContext';

function STModalContent({ navigateToScanPSBT, setData, setStModal, readFromNFC }) {
  const { colorMode } = useColorMode();
  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const { error: errorTranslation, common } = translations;

  const isIos = Platform.OS === 'ios';

  const selectFile = async () => {
    try {
      const result = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
      });
      try {
        const filePath = result[0].uri.split('%20').join(' ');
        const cosigner = await RNFS.readFile(filePath);
        setData(cosigner);
      } catch (err) {
        captureError(err);
        showToast(errorTranslation.validCoSignerFile, <ToastErrorIcon />);
      }
    } catch (err) {
      if (err.toString().includes('user canceled')) {
        // user cancelled
        return;
      }
      captureError(err);
      showToast(common.somethingWrong, <ToastErrorIcon />);
    }
  };

  const walletOptions = [
    {
      id: 1,
      label: 'Scan QR',
      icon: <QR_Icon />,
      onPress: () => {
        navigateToScanPSBT();
        setStModal(false);
      },
    },
    {
      id: 2,
      label: `${isIos ? 'Airdrop / ' : ''}File`,
      icon: <AirDropIcon />,
      onPress: () => {
        setStModal(false);
        setTimeout(() => {
          selectFile();
        }, 100);
      },
    },

    {
      id: 4,
      label: 'NFC',
      icon: <NFCIcon />,
      onPress: () => {
        readFromNFC();
        setStModal(false);
      },
    },
  ];

  return (
    <Box>
      {walletOptions.map((option) => (
        <TouchableOpacity key={option.id} onPress={option.onPress}>
          <Box
            style={styles.container}
            backgroundColor={`${colorMode}.textInputBackground`}
            borderColor={`${colorMode}.separator`}
            borderWidth={1}
          >
            <CircleIconWrapper
              width={40}
              icon={option.icon}
              backgroundColor={`${colorMode}.pantoneGreen`}
            />
            <Text>{option.label}</Text>
          </Box>
        </TouchableOpacity>
      ))}
    </Box>
  );
}

export default STModalContent;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(20),
    paddingHorizontal: wp(20),
    paddingVertical: hp(16),
    borderRadius: 10,
    marginBottom: hp(10),
  },
});
