import React, { useContext, useEffect, useState } from 'react';
import { StyleSheet, Share } from 'react-native';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { Box, ScrollView, useColorMode, VStack } from '@gluestack-ui/themed-native-base';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParams } from 'src/navigation/types';
import Buttons from 'src/components/Buttons';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import MessagePreview from 'src/components/MessagePreview';
import { useNavigation } from '@react-navigation/native';
import { useAppSelector } from 'src/store/hooks';
import { RKInteractionMode } from 'src/services/wallets/enums';
import Relay from 'src/services/backend/Relay';
import { encrypt, getKeyAndHash } from 'src/utils/service-utilities/encryption';
import config, { APP_STAGE } from 'src/utils/service-utilities/config';
import { getKeyUID } from 'src/utils/utilities';
import WalletHeader from 'src/components/WalletHeader';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import * as bitcoin from 'bitcoinjs-lib';

type ScreenProps = NativeStackScreenProps<AppStackParams, 'RemoteSharing'>;

const getRemoteShareText = (signerTranslation: any) => ({
  [RKInteractionMode.SHARE_REMOTE_KEY]: {
    title: signerTranslation.magicLinkSharing,
    desc: signerTranslation.magicLinkSharingDesc,
    cta: signerTranslation.magicLinkCTA,
    msgTitle: signerTranslation.magicLinkSharing,
    msgDesc: signerTranslation.magicLinkSharingDesc1,
  },
  [RKInteractionMode.SHARE_PSBT]: {
    title: signerTranslation.signTransactionRemotely,
    desc: signerTranslation.signTransactionRemotelyDesc,
    cta: signerTranslation.signTransactionRemotelyCTA,
    msgTitle: signerTranslation.signTransactionRemotelymsgTitle,
    msgDesc: signerTranslation.signTransactionRemotelyDesc1,
  },
  [RKInteractionMode.SHARE_SIGNED_PSBT]: {
    title: signerTranslation.signedTransactionReceived,
    desc: signerTranslation.signedTransactionReceivedDesc,
    cta: signerTranslation.signTransactionRemotelyCTA1,
    msgTitle: signerTranslation.signTransactionRemotelymsgTitle1,
    msgDesc: signerTranslation.signTransactionRemotelymsgDesc1,
  },
});

const DeepLinkIdentifier = {
  [APP_STAGE.DEVELOPMENT]: 'app/dev',
  [APP_STAGE.PRODUCTION]: 'app/prod',
};

type dataProps = {
  type: RKInteractionMode;
  fcm?: string;
  psbt?: string;
  key?: string;
  keyUID?: string;
  xfp?: string;
  cachedTxid?: string; // for recovering the cached tnx from store on receiving the signed psbt
};

function RemoteSharing({ route }: ScreenProps) {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const fcmToken = useAppSelector((state) => state.notifications.fcmToken);
  let { isPSBTSharing = false, psbt, mode, signer = null, xfp = '' } = route.params;
  const { remoteLinkDetails } = useAppSelector((state) => state.vault);
  const cachedTxid = useAppSelector((state) => state.sendAndReceive.sendPhaseTwo.cachedTxid);
  const [primaryLoading, setPrimaryLoading] = useState(false);
  const { translations } = useContext(LocalizationContext);
  const { signer: signerTranslation, common } = translations;
  const RemoteShareText = getRemoteShareText(signerTranslation);
  const serializedPSBTEnvelops = useAppSelector(
    (state) => state.sendAndReceive.sendPhaseTwo.serializedPSBTEnvelops
  );

  useEffect(() => {
    if (mode === RKInteractionMode.SHARE_PSBT) {
      let combinedPSBT = bitcoin.Psbt.fromBase64(psbt);
      for (const psbtEnvelop of serializedPSBTEnvelops) {
        if (psbtEnvelop.isSigned) {
          combinedPSBT.combine(bitcoin.Psbt.fromBase64(psbtEnvelop.serializedPSBT));
        }
      }
      psbt = combinedPSBT.toBase64();
    }
  }, []);

  const handleShare = async () => {
    setPrimaryLoading(true);
    try {
      const data: dataProps = {
        type: mode,
      };

      if (mode === RKInteractionMode.SHARE_REMOTE_KEY) {
        data.key = psbt;
        data.fcm = fcmToken;
      }

      if (mode === RKInteractionMode.SHARE_PSBT) {
        data.psbt = psbt;
        data.keyUID = getKeyUID(signer);
        data.xfp = xfp;
        data.cachedTxid = cachedTxid;
      }

      if (mode === RKInteractionMode.SHARE_SIGNED_PSBT) {
        data.psbt = psbt;
        data.xfp = remoteLinkDetails.xfp;
        data.cachedTxid = remoteLinkDetails.cachedTxid;
      }
      const { encryptionKey, hash } = getKeyAndHash(12);
      const encryptedData = encrypt(encryptionKey, JSON.stringify(data));
      const res = await Relay.createRemoteKey(encryptedData, hash);
      if (res?.id) {
        const result = await Share.share({
          title: RemoteShareText[mode].msgTitle,
          message: `${RemoteShareText[mode].msgDesc}\nhttps://www.bitcoinkeeper.app/${
            DeepLinkIdentifier[config.ENVIRONMENT]
          }/remote/${encryptionKey}`,
        });
        if (result.action === Share.sharedAction) {
          if (result.activityType) navigation.goBack();
        }
      }
    } catch (error) {
      console.log('🚀 ~ handleShare ~ error:', error);
    } finally {
      setPrimaryLoading(false);
    }
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={RemoteShareText[mode].title} subTitle={RemoteShareText[mode].desc} />
      <VStack style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.contentContainer}
          showsVerticalScrollIndicator={false}
        >
          {!isPSBTSharing && (
            <ThemedSvg
              name={'remote_share_illustration'}
              style={styles.illustration}
              width={130}
              height={130}
            />
          )}

          <Box style={styles.messagePreview}>
            <MessagePreview
              title={RemoteShareText[mode].msgTitle}
              description={RemoteShareText[mode].msgDesc}
              link="www.bitcoinkeeper.app..."
            />
          </Box>
        </ScrollView>
        <Box style={styles.CTAContainer}>
          <Buttons
            primaryText={RemoteShareText[mode].cta}
            primaryCallback={handleShare}
            width={windowWidth * 0.82}
            primaryLoading={primaryLoading}
            paddingVertical={hp(12)}
          />
          <Buttons
            secondaryText={common.cancel}
            secondaryCallback={() => {
              navigation.goBack();
            }}
            width={windowWidth * 0.82}
          />
        </Box>
      </VStack>
    </ScreenWrapper>
  );
}

export default RemoteSharing;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    marginHorizontal: wp(10),
  },
  contentContainer: {
    alignItems: 'center',
  },

  CTAContainer: {
    alignItems: 'center',
    gap: 15,
  },
  title: {
    fontSize: 20,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    width: wp(300),
  },
  illustration: {
    marginTop: hp(20),
    marginRight: wp(15),
  },
  messagePreview: {
    width: '100%',
    marginTop: hp(10),
    marginBottom: hp(34),
  },
});
