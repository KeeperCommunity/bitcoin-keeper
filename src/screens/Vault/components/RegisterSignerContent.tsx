import { Box, useColorMode } from 'native-base';
import React, { useContext, useState } from 'react';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import Text from 'src/components/KeeperText';
import AirDropIcon from 'src/assets/images/airdrop-circle-icon.svg';
import NFCIcon from 'src/assets/images/nfc-circle-icon.svg';
import QR_Icon from 'src/assets/images/qr-scan-icon.svg';
import { Platform, StyleSheet, TouchableOpacity, Vibration } from 'react-native';
import { hp, wp } from 'src/constants/responsive';
import { captureError } from 'src/services/sentry';
import { exportFile } from 'src/services/fs';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import USBIcon from 'src/assets/images/usb_white.svg';
import { sanitizeFileName } from 'src/utils/utilities';
import { generateOutputDescriptors } from 'src/utils/service-utilities/utils';
import { getWalletConfig } from 'src/hardware';
import { SignerType } from 'src/services/wallets/enums';
import { HCESessionContext } from 'react-native-hce';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import NFC from 'src/services/nfc';
import { NfcTech } from 'react-native-nfc-manager';

function RegisterSignerContent({
  vaultId,
  isPSBTSharing = false,
  vaultKey,
  signer,
  setRegisterSignerModal,
  isUSBAvailable,
  activeVault,
  navigateRegisterWithQR,
  navigateRegisterWithChannel,
}) {
  const { colorMode } = useColorMode();
  const { showToast } = useToastMessage();
  const isIos = Platform.OS === 'ios';
  const [visible, setVisible] = useState(false);
  const { session } = useContext(HCESessionContext);
  const isAndroid = Platform.OS === 'android';

  const fileName = `${sanitizeFileName(activeVault.presentationData.name)}.txt`;

  const walletConfig =
    signer.type === SignerType.SPECTER
      ? `addwallet ${activeVault.presentationData.name}&${generateOutputDescriptors(
          activeVault,
          false,
          false
        )
          .replace('/**', '/{0,1}/*')
          .replace(/<(\d+);(\d+)>/g, '{$1,$2}')}`
      : activeVault.scheme.miniscriptScheme
      ? generateOutputDescriptors(activeVault)
      : getWalletConfig({ vault: activeVault, signerType: signer.type });

  const shareWithAirdrop = async () => {
    const shareFileName =
      fileName ||
      (isPSBTSharing
        ? `${vaultId}-${vaultKey?.xfp}-${Date.now()}.psbt`
        : `cosigner-${signer?.masterFingerprint}.txt`);

    try {
      await exportFile(
        walletConfig,
        shareFileName,
        (error) => {
          console.error('File export error:', error);
          showToast(error.message, <ToastErrorIcon />);
        },
        'utf8',
        false
      );
    } catch (err) {
      console.error('Airdrop function error:', err);
      captureError(err);
    }
  };

  const walletOptions = [
    {
      id: 1,
      label: 'Scan QR',
      icon: <QR_Icon />,
      onPress: () => {
        setRegisterSignerModal(false);
        navigateRegisterWithQR();
      },
    },
    {
      id: 2,
      label: `${isIos ? 'Airdrop / ' : ''}File Export`,
      icon: <AirDropIcon />,
      onPress: () => {
        shareWithAirdrop();
        setRegisterSignerModal(false);
      },
    },

    {
      id: 3,
      label: 'NFC',
      icon: <NFCIcon />,
      onPress: () => {
        shareWithNFC();
      },
    },
    ...(isUSBAvailable
      ? [
          {
            id: 4,
            label: 'USB',
            icon: <USBIcon />,
            onPress: () => {
              navigateRegisterWithChannel();
              setRegisterSignerModal(false);
            },
          },
        ]
      : []),
  ];

  const cleanUp = () => {
    setVisible(false);
    Vibration.cancel();
    if (isAndroid) {
      NFC.stopTagSession(session);
    }
  };

  const shareWithNFC = async () => {
    try {
      if (isIos) {
        if (!isIos) {
          setVisible(true);
        }
        Vibration.vibrate([700, 50, 100, 50], true);
        const enc = NFC.encodeTextRecord(walletConfig);
        await NFC.send([NfcTech.Ndef], enc);
        cleanUp();
      } else {
        setVisible(true);
        await NFC.startTagSession({ session, content: walletConfig });
        Vibration.vibrate([700, 50, 100, 50], true);
      }
    } catch (err) {
      cleanUp();
      if (err.toString() === 'Error: Not even registered') {
        console.log('NFC interaction cancelled.');
        return;
      }
      captureError(err);
    }
  };

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
      <NfcPrompt visible={visible} close={cleanUp} />
    </Box>
  );
}

export default RegisterSignerContent;

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
