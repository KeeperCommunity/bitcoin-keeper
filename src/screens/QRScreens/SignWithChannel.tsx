import React, { useContext, useEffect, useRef, useState } from 'react';
import { Box, VStack, useColorMode } from '@gluestack-ui/themed-native-base';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { VaultSigner } from 'src/services/wallets/interfaces/vault';
import config, { KEEPER_WEBSITE_BASE_URL } from 'src/utils/service-utilities/config';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import { io } from 'src/services/channel';
import { CHANNEL_MESSAGE, EMIT_MODES, JOIN_CHANNEL } from 'src/services/channel/constants';
import { useDispatch } from 'react-redux';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import { useAppSelector } from 'src/store/hooks';
import { updatePSBTEnvelops } from 'src/store/reducers/send_and_receive';
import { captureError } from 'src/services/sentry';
import { SerializedPSBTEnvelop } from 'src/services/wallets/interfaces';
import useVault from 'src/hooks/useVault';
import { VaultType } from 'src/services/wallets/enums';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import Text from 'src/components/KeeperText';
import crypto from 'crypto';
import {
  createCipherGcm,
  createDecipherGcm,
  generateOutputDescriptors,
} from 'src/utils/service-utilities/utils';
import useSignerFromKey from 'src/hooks/useSignerFromKey';
import { getPsbtForHwi } from 'src/hardware';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import ChannelRequestScanner from 'src/services/channel/ChannelRequestScanner';
import { InvalidChannelQRCodeError } from 'src/services/channel/crypto';
import { updateKeyDetails } from 'src/store/sagaActions/wallets';
import BackgroundTimer from 'react-native-background-timer';
import WalletHeader from 'src/components/WalletHeader';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { validatePSBT } from 'src/utils/utilities';

function ScanAndInstruct({ onBarCodeRead }) {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { choosePlan } = translations;
  return (
    <ChannelRequestScanner onScanCompleted={onBarCodeRead}>
      <VStack marginTop={'40%'}>
        <Text numberOfLines={2} color={`${colorMode}.greenText`} style={styles.instructions}>
          {choosePlan.continuesigntransWithDesktop}
        </Text>
        <ActivityIndicator style={{ marginTop: hp(20), alignSelf: 'center', padding: '2%' }} />
      </VStack>
    </ChannelRequestScanner>
  );
}

function SignWithChannel() {
  const { colorMode } = useColorMode();
  const { params } = useRoute();
  const {
    vaultKey,
    vaultId = '',
    signerType,
    isRemoteKey = false,
    serializedPSBTEnvelopFromProps,
    signTransaction,
  } = params as {
    vaultKey: VaultSigner;
    vaultId: string;
    signerType: string;
    isRemoteKey?: boolean;
    serializedPSBTEnvelopFromProps?: any;
    signTransaction: ({ signedSerializedPSBT }: { signedSerializedPSBT: string }) => void;
  };
  const { signer } = useSignerFromKey(vaultKey);
  const { activeVault } = useVault({ vaultId });
  const serializedPSBTEnvelops: SerializedPSBTEnvelop[] = useAppSelector(
    (state) => state.sendAndReceive.sendPhaseTwo.serializedPSBTEnvelops
  );

  const { serializedPSBT } = isRemoteKey
    ? serializedPSBTEnvelopFromProps
    : serializedPSBTEnvelops.filter((envelop) => vaultKey.xfp === envelop.xfp)[0];

  const [channel] = useState(io(config.CHANNEL_URL));
  const decryptionKey = useRef();

  const dispatch = useDispatch();
  const navgation = useNavigation();
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const { translations } = useContext(LocalizationContext);
  const { choosePlan, error: errorText } = translations;
  const { showToast } = useToastMessage();

  let miniscriptPolicy = null;
  if (activeVault?.type === VaultType.MINISCRIPT) {
    miniscriptPolicy = generateOutputDescriptors(activeVault);
  }
  const walletName = activeVault?.presentationData.name;
  let hmac = null;
  const currentHmac = vaultKey.registeredVaults?.find((info) => info.vaultId === vaultId)?.hmac;
  if (currentHmac) {
    hmac = currentHmac;
  }

  const onBarCodeRead = async (data) => {
    try {
      decryptionKey.current = data;
      const sha = crypto.createHash('sha256');
      sha.update(data);
      const room = sha.digest().toString('hex');
      const psbt = await getPsbtForHwi(serializedPSBT, activeVault);
      const requestBody = {
        action: EMIT_MODES.SIGN_TX,
        signerType,
        psbt,
        miniscriptPolicy,
        walletName,
        hmac,
      };
      const requestData = createCipherGcm(JSON.stringify(requestBody), decryptionKey.current);
      channel.emit(JOIN_CHANNEL, { room, network: bitcoinNetworkType, requestData });
      return true;
    } catch (error) {
      showToast(
        error instanceof InvalidChannelQRCodeError
          ? errorText.QrScannedDesptopInvalid
          : errorText.failedToConnectDesktop,
        <ToastErrorIcon />
      );
      return false;
    }
  };

  useEffect(() => {
    const startBackgroundListener = () => {
      BackgroundTimer.start();

      channel.connect();
      channel.on(CHANNEL_MESSAGE, async ({ data }) => {
        try {
          const { data: decrypted } = createDecipherGcm(data, decryptionKey.current);
          onSignedTnx(decrypted.responseData);
        } catch (error) {
          console.log('🚀 ~ channel.on ~ error:', error);
        }
      });
    };

    startBackgroundListener();

    return () => {
      BackgroundTimer.stop();
      channel.disconnect();
    };
  }, [channel]);

  const onSignedTnx = (data) => {
    try {
      const signedSerializedPSBT = data.data.signedSerializedPSBT;
      validatePSBT(serializedPSBT, signedSerializedPSBT, signer, errorText);
      const hmac = data.data.hmac;
      dispatch(
        updateKeyDetails(vaultKey, 'registered', {
          registered: true,
          hmac,
          vaultId,
        })
      );
      dispatch(
        healthCheckStatusUpdate([
          {
            signerId: signer.masterFingerprint,
            status: hcStatusType.HEALTH_CHECK_SIGNING,
          },
        ])
      );
      if (isRemoteKey) {
        signTransaction({ signedSerializedPSBT });
        navgation.dispatch(CommonActions.goBack());
        return;
      }
      dispatch(updatePSBTEnvelops({ signedSerializedPSBT, xfp: vaultKey.xfp }));
      navgation.dispatch(CommonActions.navigate({ name: 'SignTransactionScreen', merge: true }));
    } catch (error) {
      captureError(error);
      showToast(error?.message, <ToastErrorIcon />);
    }
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={choosePlan.signingWithDesktop}
        subTitle={`${choosePlan.subscribeWithDesktopDesc} ${KEEPER_WEBSITE_BASE_URL}${choosePlan.subscribeWithDesktopDesc4}`}
      />
      <Box style={styles.qrcontainer}>
        <ScanAndInstruct onBarCodeRead={onBarCodeRead} />
      </Box>
    </ScreenWrapper>
  );
}

export default SignWithChannel;

const styles = StyleSheet.create({
  qrcontainer: {
    borderRadius: 10,
    overflow: 'hidden',
    marginVertical: 25,
    alignItems: 'center',
  },
  noteWrapper: {
    width: '100%',
    bottom: 0,
    position: 'absolute',
    padding: 20,
  },
  instructions: {
    width: windowWidth * 0.75,
    padding: '2%',
    letterSpacing: 0.65,
    fontSize: 13,
    textAlign: 'center',
  },
});
