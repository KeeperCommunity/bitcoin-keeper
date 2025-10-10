import { Box, useColorMode } from 'native-base';
import React, { useContext, useState } from 'react';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import Text from 'src/components/KeeperText';
import AirDropIcon from 'src/assets/images/airdrop-circle-icon.svg';
import NFCIcon from 'src/assets/images/nfc-circle-icon.svg';
import QR_Icon from 'src/assets/images/qr-scan-icon.svg';
import { Platform, StyleSheet, TouchableOpacity, Vibration } from 'react-native';
import { hp, wp } from 'src/constants/responsive';
import NFC from 'src/services/nfc';
import { captureError } from 'src/services/sentry';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import { exportFile } from 'src/services/fs';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { HCESessionContext } from 'react-native-hce';
import USBIcon from 'src/assets/images/usb_white.svg';
import { sanitizeFileName } from 'src/utils/utilities';
import { SignerType } from 'src/services/wallets/enums';
import { generateOutputDescriptors } from 'src/utils/service-utilities/utils';
import { getWalletConfig } from 'src/hardware';

function RegisterMultisig({
  vaultId,
  useNdef = false,
  isPSBTSharing = false,
  vaultKey,
  signer,
  setRegisterSignerModal,
  isUSBAvailable,
  activeVault,
  navigation,
  CommonActions,
  shareWithNFC,
}) {
  const { colorMode } = useColorMode();
  const [visible, setVisible] = useState(false);
  const { showToast } = useToastMessage();
  const { session } = useContext(HCESessionContext);

  const isIos = Platform.OS === 'ios';
  const isAndroid = Platform.OS === 'android';

  const fileName = `${sanitizeFileName(activeVault?.presentationData?.name)}.txt`;
  const walletConfig =
    signer?.type === SignerType.SPECTER
      ? `addwallet ${activeVault?.presentationData?.name}&${generateOutputDescriptors(
          activeVault,
          false,
          false
        )
          .replace('/**', '/{0,1}/*')
          .replace(/<(\d+);(\d+)>/g, '{$1,$2}')}`
      : activeVault.scheme.miniscriptScheme
      ? generateOutputDescriptors(activeVault)
      : getWalletConfig({ vault: activeVault, signerType: signer?.type });

  const cleanUp = () => {
    setVisible(false);
    Vibration.cancel();
    if (isAndroid && !useNdef) {
      NFC.stopTagSession(session);
    }
  };

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
  const navigateRegisterWithQR = () => {
    navigation.dispatch(CommonActions.navigate('RegisterWithQR', { vaultKey, vaultId }));
  };
  const navigateRegisterWithChannel = () => {
    navigation.dispatch(
      CommonActions.navigate('RegisterWithChannel', {
        vaultKey,
        vaultId,
        signerType: signer?.type,
      })
    );
  };

  const walletOptions = [
    {
      id: 1,
      label: 'Show QR',
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
        shareWithNFC(walletConfig);
        setRegisterSignerModal(false);
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
      <NfcPrompt visible={visible} close={cleanUp} ctaText="Done" />
    </Box>
  );
}

export default RegisterMultisig;

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
