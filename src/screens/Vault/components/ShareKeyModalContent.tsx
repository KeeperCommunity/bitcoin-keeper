import { Box, useColorMode } from 'native-base';
import React, { useContext, useEffect, useState } from 'react';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import Text from 'src/components/KeeperText';
import AirDropIcon from 'src/assets/images/airdrop-circle-icon.svg';
import NFCIcon from 'src/assets/images/nfc-circle-icon.svg';
import QR_Icon from 'src/assets/images/qr-scan-icon.svg';
import MagicLinkIcon from 'src/assets/images/magic-link-icon.svg';
import { Platform, StyleSheet, TouchableOpacity, Vibration } from 'react-native';
import { hp, wp } from 'src/constants/responsive';
import { captureError } from 'src/services/sentry';
import { exportFile } from 'src/services/fs';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { RKInteractionMode } from 'src/services/wallets/enums';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import { HCESession, HCESessionContext } from 'react-native-hce';
import NFC from 'src/services/nfc';
import nfcManager, { NfcTech } from 'react-native-nfc-manager';

function ShareKeyModalContent({
  vaultId,
  navigation,
  isPSBTSharing = false,
  vaultKey,
  fileName,
  signer,
  navigateToCosignerDetails,
  setShareKeyModal,
  xfp = '',
  isSignedPSBT = false,
  data,
  navigateToQrSigning,
  openmodal,
  navigateToShowPSBT,
}) {
  const { colorMode } = useColorMode();
  const { showToast } = useToastMessage();
  const [nfcVisible, setNfcVisible] = useState(false);
  const { session } = useContext(HCESessionContext);
  const isAndroid = Platform.OS === 'android';
  const isIos = Platform.OS === 'ios';

  const shareWithAirdrop = async () => {
    const shareFileName =
      fileName ||
      (isPSBTSharing
        ? `${vaultId}-${vaultKey?.xfp}-${Date.now()}.psbt`
        : `cosigner-${signer?.masterFingerprint}.txt`);
    try {
      await exportFile(
        data,
        shareFileName,
        (error) => showToast(error.message, <ToastErrorIcon />),
        'utf8',
        false
      );
    } catch (err) {
      console.log(err);
      captureError(err);
    }
  };

  const walletOptions = [
    {
      id: 1,
      label: 'Magic Link',
      icon: <MagicLinkIcon />,
      onPress: () => {
        setShareKeyModal(false);
        navigation.navigate('RemoteSharing', {
          psbt: data,
          mode: isPSBTSharing
            ? isSignedPSBT
              ? RKInteractionMode.SHARE_SIGNED_PSBT
              : RKInteractionMode.SHARE_PSBT
            : RKInteractionMode.SHARE_REMOTE_KEY,
          signer,
          xfp,
        });
      },
    },
    {
      id: 2,
      label: 'Show QR',
      icon: <QR_Icon />,
      onPress: () => {
        setShareKeyModal(false);
        openmodal && openmodal(true);
        navigateToShowPSBT && navigateToShowPSBT(data);
        if (navigateToQrSigning && typeof navigateToQrSigning === 'function') {
          navigateToQrSigning(vaultKey);
        } else if (navigateToCosignerDetails && typeof navigateToCosignerDetails === 'function') {
          navigateToCosignerDetails();
        }
      },
    },
    {
      id: 3,
      label: `${isIos ? 'Airdrop / ' : ''}File`,
      icon: <AirDropIcon />,
      onPress: () => {
        shareWithAirdrop();
        setShareKeyModal(false);
      },
    },

    {
      id: 4,
      label: 'NFC',
      icon: <NFCIcon />,
      onPress: () => {
        shareWithNFC();
      },
    },
  ];

  const cleanUp = () => {
    setNfcVisible(false);
    Vibration.cancel();
    if (isAndroid) {
      NFC.stopTagSession(session);
    }
  };

  useEffect(() => {
    const unsubDisconnect = session.on(HCESession.Events.HCE_STATE_DISCONNECTED, () => {
      cleanUp();
    });
    return () => {
      cleanUp();
      unsubDisconnect();
    };
  }, [session]);

  useEffect(() => {
    if (isAndroid) {
      if (nfcVisible) {
      } else {
        NFC.stopTagSession(session);
      }
    }
    return () => {
      nfcManager.cancelTechnologyRequest();
    };
  }, [nfcVisible]);

  const shareWithNFC = async () => {
    try {
      if (isIos) {
        if (!isIos) {
          setNfcVisible(true);
        }
        Vibration.vibrate([700, 50, 100, 50], true);
        const enc = NFC.encodeTextRecord(data);
        await NFC.send([NfcTech.Ndef], enc);
        cleanUp();
      } else {
        setNfcVisible(true);
        await NFC.startTagSession({ session, content: data });
        Vibration.vibrate([700, 50, 100, 50], true);
      }
    } catch (err) {
      cleanUp();
      if (err.toString() === 'Error: Not even registered') {
        console.log('NFC interaction cancelled.');
        return;
      }
      console.log('Error ', err);
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
      <NfcPrompt visible={nfcVisible} close={cleanUp} ctaText="Done" />
    </Box>
  );
}

export default ShareKeyModalContent;

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
