import { useColorMode } from 'native-base';
import { CommonActions, useNavigation } from '@react-navigation/native';
import React, { useContext, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { Signer } from 'src/services/wallets/interfaces/vault';
import ScreenWrapper from 'src/components/ScreenWrapper';
import OptionCard from 'src/components/OptionCard';
import { hp, wp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { ScrollView } from 'react-native-gesture-handler';
import useSatochipModal from 'src/hooks/useSatochipModal';
import { SatochipCard } from 'satochip-react-native';
import NfcPrompt from 'src/components/NfcPromptAndroid';
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
  const { signer: signerTranslations, satochip: satochipTranslations } = translations;

  const card = useRef(new SatochipCard()).current;
  const { nfcVisible, closeNfc } = useSatochipModal(card);

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

  const onSatochipVerifyAuthenticity = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'SatochipVerifyAuthenticity',
        params: {
          signer: signer,
        },
      })
    );
  };

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
        <OptionCard
          title={satochipTranslations.verifyAuthenticity}
          description={""}
          callback={onSatochipVerifyAuthenticity}
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
