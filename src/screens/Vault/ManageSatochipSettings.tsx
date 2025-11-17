import { useColorMode } from 'native-base';
import { CommonActions, useNavigation } from '@react-navigation/native';
import React, { useCallback, useContext, useRef, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Signer } from 'src/services/wallets/interfaces/vault';
import ScreenWrapper from 'src/components/ScreenWrapper';
import OptionCard from 'src/components/OptionCard';
import { hp, wp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { ScrollView } from 'react-native-gesture-handler';
import { InteracationMode } from './HardwareModalMap';
import KeeperModal from 'src/components/KeeperModal';
import HexagonIcon from 'src/components/HexagonIcon';
import Colors from 'src/theme/Colors';
import Text from 'src/components/KeeperText';
import Buttons from 'src/components/Buttons';
import SATOCHIPICONLIGHT from 'src/assets/images/satochip_light.svg';
import useSatochipModal from 'src/hooks/useSatochipModal';
import { SatochipCard } from 'satochip-react-native';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import NFC from 'src/services/nfc';
import { getCardInfo, handleSatochipError } from 'src/hardware/satochip';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { getAccountFromSigner } from 'src/utils/utilities';
import WalletHeader from 'src/components/WalletHeader';

function ManageSatochipSettings({ route }: any) {
  const { colorMode } = useColorMode();
  const {
    signer: signerFromParam,
  }: {
    signer: Signer;
  } = route.params;

  const signer: Signer = signerFromParam;

  const { translations } = useContext(LocalizationContext);
  const { signer: signerTranslations, common } = translations;

  const card = useRef(new SatochipCard()).current;
  const { withModal, nfcVisible, closeNfc } = useSatochipModal(card);
  const { showToast } = useToastMessage();

  const navigation: any = useNavigation();

  const onChangeSatochipPin = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'ChangeSatochipPin',
        params: {
          signer: signer,
        },
      })
    );
  };

  // TODO: factory reset?

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={signerTranslations.manageSatochip} />
      <ScrollView
        contentContainerStyle={styles.contentContainerStyle}
        showsVerticalScrollIndicator={false}
      >
        <OptionCard
          title={signerTranslations.changePIN}
          description={signerTranslations.changeCardPIN}
          callback={onChangeSatochipPin}
        />
      </ScrollView>
      <NfcPrompt visible={nfcVisible} close={closeNfc} />
    </ScreenWrapper>
  );
}

export default ManageSatochipSettings;

const styles = StyleSheet.create({
  contentContainerStyle: {
    paddingTop: hp(10),
    paddingHorizontal: wp(10),
  },
  bottomText: {
    fontSize: 14,
    textAlign: 'left',
    marginLeft: wp(10),
  },
});
