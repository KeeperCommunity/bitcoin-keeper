import { Box, useColorMode } from 'native-base';
import React, { useContext } from 'react';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import Text from 'src/components/KeeperText';
import ShowQR from 'src/assets/images/qr-scan-icon.svg';
import AirDropIcon from 'src/assets/images/airdrop-circle-icon.svg';
import NFCIcon from 'src/assets/images/nfc-circle-icon.svg';
import { Platform, StyleSheet, TouchableOpacity } from 'react-native';
import { hp, wp } from 'src/constants/responsive';
import { captureError } from 'src/services/sentry';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import DocumentPicker from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import { LocalizationContext } from 'src/context/Localization/LocContext';

function OtherSignerOptionModal({ setOptionModal, navigatetoQR, setData, readFromNFC }) {
  const { colorMode } = useColorMode();
  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const { error: errorText, common, vault: vaultTranslation } = translations;

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
        showToast(errorText.validCoSignerFile, <ToastErrorIcon />);
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
      label: vaultTranslation.scanQR,
      icon: <ShowQR />,
      onPress: () => {
        navigatetoQR();
        setOptionModal(false);
      },
    },

    {
      id: 2,
      label: `${isIos ? 'Airdrop / ' : ''}File Export`,
      icon: <AirDropIcon />,
      onPress: () => {
        selectFile();
        setOptionModal(false);
      },
    },

    {
      id: 3,
      label: 'NFC',
      icon: <NFCIcon />,
      onPress: () => {
        setOptionModal(false);
        readFromNFC();
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

export default OtherSignerOptionModal;

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
