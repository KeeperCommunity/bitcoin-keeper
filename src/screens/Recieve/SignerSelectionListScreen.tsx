import { FlatList, Platform, StyleSheet, TouchableOpacity, Vibration, View } from 'react-native';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import React, { useContext, useEffect, useState } from 'react';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import Next from 'src/assets/images/icon_arrow.svg';
import ScreenWrapper from 'src/components/ScreenWrapper';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { getOneKeyDeviceBindings } from 'src/services/onekeyBle/deviceConstants';
import type { Signer } from 'src/services/wallets/interfaces/vault';
import { SDIcons } from '../Vault/SigningDeviceIcons';
import { getSignerNameFromType } from 'src/hardware';
import moment from 'moment';
import useSigners from 'src/hooks/useSigners';
import { getKeyUID } from 'src/utils/utilities';
import { SentryErrorBoundary } from 'src/services/sentry';
import KeeperModal from 'src/components/KeeperModal';
import RegisterMultisig from '../SignTransaction/component/RegisterMultisig';
import { SignerType, VaultType } from 'src/services/wallets/enums';
import useVault from 'src/hooks/useVault';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import NFC from 'src/services/nfc';
import { NfcTech } from 'react-native-nfc-manager';
import { InteracationMode } from '../Vault/HardwareModalMap';
import WalletHeader from 'src/components/WalletHeader';
import Text from 'src/components/KeeperText';
import { LocalizationContext } from 'src/context/Localization/LocContext';

type HceSessionContextValue = { session: any };
const hceModule = Platform.OS === 'android' ? require('react-native-hce') : null;
const HCESessionContext: React.Context<HceSessionContextValue> =
  hceModule?.HCESessionContext ?? React.createContext<HceSessionContextValue>({ session: null });
const HCESession = hceModule?.HCESession;

function SignerSelectionListScreen() {
  const { params } = useRoute();
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { vaultId, signersMFP, title, description, callback, vaultKeydata, mode } = params as {
    vaultId: string;
    signersMFP: string[];
    title: string;
    description: string;
    vaultKeydata: any;
    callback: (signer, signerName) => void;
    mode: InteracationMode;
  };
  const { vaultSigners } = useSigners(vaultId);
  const [availableSigners] = useState(
    vaultSigners.filter((signer) => signersMFP?.includes(signer.masterFingerprint))
  );

  const [registerSignerModal, setRegisterSignerModal] = useState(false);
  const [selectedSigner, setSelectedSigner] = useState(null);

  const vaultKey = vaultKeydata?.find(
    (item) => item?.masterFingerprint === selectedSigner?.masterFingerprint
  );

  const { activeVault } = useVault({ vaultId, includeArchived: false });
  const [nfcVisible, setNfcVisible] = useState(false);
  const { session } = useContext(HCESessionContext);
  console.log('🚀 ~ SignerSelectionListScreen ~ session:', session);
  const { translations } = useContext(LocalizationContext);
  const { vault: vaultTranslations } = translations;

  const isAndroid = Platform.OS === 'android';
  const isIos = Platform.OS === 'ios';

  useEffect(() => {
    if (!isAndroid || !session || !HCESession?.Events) {
      return undefined;
    }

    const unsubDisconnect = session.on(HCESession.Events.HCE_STATE_DISCONNECTED, () => {
      cleanUp();
    });
    const unsubRead = session.on(HCESession.Events.HCE_STATE_READ, () => {});
    return () => {
      cleanUp();
      unsubRead();
      unsubDisconnect();
    };
  }, [session]);

  const handleSignerPress = (signer) => {
    if (signer.type === SignerType.PORTAL) {
      callback(signer, getSignerNameFromType(signer.type));
    } else {
      if (mode === InteracationMode.ADDRESS_VERIFICATION) {
        callback(signer, getSignerNameFromType(signer.type));
        return;
      }
      setSelectedSigner(signer);
      setRegisterSignerModal(true);
    }
  };

  const cleanUp = () => {
    setNfcVisible(false);
    Vibration.cancel();
    if (isAndroid && session) {
      NFC.stopTagSession(session);
    }
  };

  const shareWithNFC = async (details) => {
    try {
      if (isIos) {
        if (!isIos) {
          setNfcVisible(true);
        }
        Vibration.vibrate([700, 50, 100, 50], true);
        const enc = NFC.encodeTextRecord(details);
        await NFC.send([NfcTech.Ndef], enc);
        cleanUp();
      } else {
        setNfcVisible(true);
        await NFC.startTagSession({ session, content: details });
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
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <ActivityIndicatorView visible={false} showLoader />
      <WalletHeader title={title} subTitle={description} />
      <FlatList
        contentContainerStyle={{ paddingTop: '5%' }}
        data={availableSigners}
        keyExtractor={(item) => getKeyUID(item)}
        renderItem={({ item }) => (
          <SignerCard onPress={() => handleSignerPress(item)} signer={item} />
        )}
      />

      <KeeperModal
        visible={registerSignerModal}
        close={() => setRegisterSignerModal(false)}
        title={vaultTranslations.registerMultisig}
        subTitle={vaultTranslations.registerActiveVault}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <RegisterMultisig
            isUSBAvailable={activeVault.type === VaultType.MINISCRIPT}
            signer={selectedSigner || {}}
            vaultId={vaultId}
            vaultKey={vaultKey}
            setRegisterSignerModal={setRegisterSignerModal}
            activeVault={activeVault}
            navigation={navigation}
            CommonActions={CommonActions}
            shareWithNFC={shareWithNFC}
          />
        )}
      />
      <NfcPrompt visible={nfcVisible} close={cleanUp} ctaText="Done" />
    </ScreenWrapper>
  );
}

export default SentryErrorBoundary(SignerSelectionListScreen);

const styles = StyleSheet.create({
  inheritenceView: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    backgroundColor: '#E3E3E3',
    borderRadius: 30,
    marginRight: 20,
    alignSelf: 'center',
  },
});

const SignerCard = ({ onPress, signer }: { onPress: () => void; signer: Signer }) => {
  const { colorMode } = useColorMode();
  const signerName = getSignerNameFromType(signer.type, signer.isMock, false);
  const signerDescription =
    signer.type === SignerType.ONEKEY
      ? getOneKeyDeviceBindings(signer).find(
          (device) => device.bleConnectId === signer.extraData?.bleConnectId
        )?.name || signer.signerDescription
      : signer.signerDescription;

  return (
    <TouchableOpacity testID={`btn_transactionSigner`} onPress={onPress}>
      <Box margin={5}>
        <Box flexDirection="row" borderRadius={10} justifyContent="space-between">
          <Box flexDirection="row">
            <View style={styles.inheritenceView}>
              <Box
                width={30}
                height={30}
                borderRadius={30}
                backgroundColor={`${colorMode}.DarkSlateGray`}
                justifyContent="center"
                alignItems="center"
                marginX={1}
              >
                {SDIcons({ type: signer.type }).Icon}
              </Box>
            </View>
            <View style={{ flexDirection: 'column' }}>
              <Text color={`${colorMode}.textBlack`} fontSize={14}>
                {`${signerName} (${signer.masterFingerprint})`}
              </Text>
              {signerDescription ? (
                <Text numberOfLines={1} color={`${colorMode}.greenText`} fontSize={12}>
                  {signerDescription}
                </Text>
              ) : (
                <Text color={`${colorMode}.GreyText`} fontSize={12}>
                  {`Added on ${moment(signer.addedOn).calendar().toLowerCase()}`}
                </Text>
              )}
            </View>
          </Box>
          <Box alignItems="center" justifyContent="center">
            <Next />
          </Box>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};
