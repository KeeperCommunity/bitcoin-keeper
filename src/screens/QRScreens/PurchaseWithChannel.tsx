import { createChannelRequestData } from 'src/services/channel/crypto';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { Box, VStack, useColorMode } from '@gluestack-ui/themed-native-base';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { ActivityIndicator, Alert, ScrollView, StyleSheet } from 'react-native';
import config, { KEEPER_WEBSITE_BASE_URL } from 'src/utils/service-utilities/config';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import { io } from 'src/services/channel';
import { CHANNEL_MESSAGE, EMIT_MODES, JOIN_CHANNEL } from 'src/services/channel/constants';
import { useDispatch } from 'react-redux';
import { useNavigation } from '@react-navigation/native';
import Text from 'src/components/KeeperText';
import crypto from 'crypto';
import QRScanner from 'src/components/QRScanner';
import BackgroundTimer from 'react-native-background-timer';
import Relay from 'src/services/backend/Relay';
import SubScription from 'src/models/interfaces/Subscription';
import useToastMessage from 'src/hooks/useToastMessage';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { setSubscription } from 'src/store/sagaActions/settings';
import Note from 'src/components/Note/Note';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import TierUpgradeModal, { UPGRADE_TYPE } from '../ChoosePlanScreen/TierUpgradeModal';
import { useQuery } from '@realm/react';
import { manipulateIosProdProductId } from 'src/utils/utilities';
import { useAppSelector } from 'src/store/hooks';
import WalletHeader from 'src/components/WalletHeader';

function ScanAndInstruct({ onBarCodeRead }) {
  const { colorMode } = useColorMode();
  const [channelCreated, setChannelCreated] = useState(false);
  const { translations } = useContext(LocalizationContext);
  const { common } = translations;

  const callback = (data) => {
    let success = onBarCodeRead(data);
    if (success) {
      setChannelCreated(true);
    }
  };
  return !channelCreated ? (
    <QRScanner onScanCompleted={callback} />
  ) : (
    <VStack>
      <VStack marginTop={'40%'}>
        <Text numberOfLines={2} color={`${colorMode}.greenText`} style={styles.instructions}>
          {common.continueOnDesktopApp}
        </Text>
        <ActivityIndicator style={{ marginTop: hp(20), alignSelf: 'center', padding: '2%' }} />
      </VStack>
    </VStack>
  );
}

function PurchaseWithChannel() {
  const { colorMode } = useColorMode();
  const [channel] = useState(io(config.CHANNEL_URL));
  const decryptionKey = useRef();
  const {
    common,
    error: errorText,
    choosePlan,
    wallet,
  } = useContext(LocalizationContext).translations;
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const { showToast } = useToastMessage();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeType, setUpgradeType] = useState(null);
  const { subscription }: KeeperApp = useQuery(RealmSchema.KeeperApp)[0];
  const {
    id,
    subscription: currentSubscription,
    publicId,
  }: KeeperApp = dbManager.getObjectByIndex(RealmSchema.KeeperApp);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);

  useEffect(() => {
    const startBackgroundListener = () => {
      BackgroundTimer.start();
      const isSocketActive = channel.connected;
      if (isSocketActive) return;
      channel.connect();
      channel.on(CHANNEL_MESSAGE, async ({ data }) => {
        try {
          if (data?.isUpdated) {
            const { icon } = data;
            const res = await Relay.verifyReceipt(id, publicId);
            if (!res.isValid || res.level == 1) {
              showToast(errorText.somethingWentWrong, <ToastErrorIcon />);
              navigation.goBack();
            }
            const subscription: SubScription = {
              productId: manipulateIosProdProductId(res?.productId),
              receipt: res?.transactionReceipt,
              name: res?.plan,
              level: res?.level,
              icon,
              isDesktopPurchase: true,
            };
            calculateModalContent(subscription, currentSubscription);
            dbManager.updateObjectById(RealmSchema.KeeperApp, id, {
              subscription,
            });
            dispatch(setSubscription(subscription.name));
            setShowUpgradeModal(true);
          } else {
            if (data?.error) {
              Alert.alert('Error', data.error, [
                {
                  text: 'ok',
                  onPress: () => navigation.goBack(),
                  style: 'cancel',
                },
              ]);
            } else {
              showToast(errorText.somethingWentWrong, <ToastErrorIcon />);
              navigation.goBack();
            }
          }
        } catch (error) {
          console.log('🚀 ~ channel.on ~ error:', error);
        }
      });
    };

    startBackgroundListener();

    return () => {
      BackgroundTimer.stop();
      channel.disconnect();
      channel.removeAllListeners();
    };
  }, []);

  const calculateModalContent = (response, appSubscription) => {
    if (response.level === appSubscription.level) {
      if (appSubscription.productId.includes('yearly'))
        setUpgradeType(UPGRADE_TYPE.YEARLY_TO_MONTHLY);
      else setUpgradeType(UPGRADE_TYPE.MONTHLY_TO_YEARLY);
    } else if (response.level > appSubscription.level) setUpgradeType(UPGRADE_TYPE.UPGRADE);
    else setUpgradeType(UPGRADE_TYPE.DOWNGRADE);
  };

  const onBarCodeRead = async (data) => {
    decryptionKey.current = data;
    const sha = crypto.createHash('sha256');
    sha.update(data);
    const room = sha.digest().toString('hex');
    const requestBody = {
      appId: id,
      roomId: room,
    };
    const res = await Relay.checkEligibilityForBtcPay(requestBody);
    if (res.status) {
      requestBody['action'] = EMIT_MODES.PURCHASE_SUBS;
      const requestData = createChannelRequestData(
        requestBody,
        bitcoinNetworkType,
        decryptionKey.current
      );
      channel.emit(JOIN_CHANNEL, { room, network: bitcoinNetworkType, requestData });
    } else {
      navigation.goBack();
      showToast(res.error ?? errorText.somethingWentWrong, <ToastErrorIcon />);
    }
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={choosePlan.subscribeWithDesktop}
        subTitle={`${choosePlan.subscribeWithDesktopDesc} ${KEEPER_WEBSITE_BASE_URL} ${choosePlan.subscribeWithDesktopDesc2}`}
      />
      <ScrollView contentContainerStyle={styles.container} scrollEnabled={false}>
        <ScanAndInstruct onBarCodeRead={onBarCodeRead} />
      </ScrollView>
      <Box style={styles.noteWrapper}>
        <Note title={common.note} subtitle={wallet.QrTips} subtitleColor="GreyText" />
      </Box>
      <TierUpgradeModal
        visible={showUpgradeModal}
        close={() => setShowUpgradeModal(false)}
        onPress={() => {
          setShowUpgradeModal(false);
          navigation.goBack();
        }}
        upgradeType={upgradeType}
        plan={subscription.name}
      />
    </ScreenWrapper>
  );
}

export default PurchaseWithChannel;

const styles = StyleSheet.create({
  qrContainer: {
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

  container: {
    marginVertical: 25,
    alignItems: 'center',
  },
  addressContainer: {
    marginHorizontal: wp(20),
  },
});
