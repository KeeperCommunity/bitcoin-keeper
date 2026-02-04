import React, { useContext } from 'react';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { Box, useColorMode } from 'native-base';
import KeeperModal from 'src/components/KeeperModal';
import { hp, wp } from 'src/constants/responsive';
import { StyleSheet } from 'react-native';
import { getAccountFromSigner } from 'src/utils/utilities';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ThemedSvg from './ThemedSvg.tsx/ThemedSvg';
import { SignerType } from 'src/services/wallets/enums';

function KeyAddedModal({ visible, close, signer }) {
  const navigation = useNavigation();
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { common, importWallet, signer: signerText } = translations;

  const KeyAddedIllustration = ({ signer }) => {
    let Illustration;

    switch (signer.type) {
      case SignerType.COLDCARD:
        Illustration = (
          <ThemedSvg
            name={'coldCard_success_illustration'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.BITBOX02:
        Illustration = (
          <ThemedSvg
            name={'bitBox_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.JADE:
        Illustration = (
          <ThemedSvg
            name={'jade_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.KEYSTONE:
        Illustration = (
          <ThemedSvg
            name={'keyStone_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.LEDGER:
        Illustration = (
          <ThemedSvg
            name={'ledger_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.PASSPORT:
        Illustration = (
          <ThemedSvg
            name={'foundation_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.PORTAL:
        Illustration = (
          <ThemedSvg
            name={'portal_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.SEEDSIGNER:
        Illustration = (
          <ThemedSvg
            name={'seedSigner_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.SPECTER:
        Illustration = (
          <ThemedSvg
            name={'specter_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.TAPSIGNER:
        Illustration = (
          <ThemedSvg
            name={'tapSigner_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.SATOCHIP:
        Illustration = (
          <ThemedSvg
            name={'satochip_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.TREZOR:
        Illustration = (
          <ThemedSvg
            name={'trezor_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      case SignerType.KRUX:
        Illustration = (
          <ThemedSvg
            name={'krux_success'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
        break;
      default:
        Illustration = (
          <ThemedSvg
            name={'success_illustration'}
            width={wp(200)}
            height={hp(200)}
            style={styles.externalKeyIllustration}
          />
        );
    }

    return Illustration;
  };

  const defaultConfig = {
    buttonText: importWallet.addDescription,
    buttonCallback: () => {
      close();
      signer &&
        navigation.dispatch(
          CommonActions.navigate({
            name: 'AdditionalDetails',
            params: { signer },
          })
        );
    },
    secondaryButtonText: common.cancel,
    secondaryButtonCallback: close,
    content: null,
  };

  const { buttonText, buttonCallback, secondaryButtonText, content } = defaultConfig;

  const getSignerTitle = (signerType) => {
    if (signerType === SignerType.MY_KEEPER) {
      return 'Mobile Key Added Successfully!';
    } else if (signerType === SignerType.KEEPER) {
      return 'External Key Added Successfully!';
    } else if (signerType === SignerType.POLICY_SERVER) {
      return 'Server Key Added Successfully!';
    } else if (signerType === SignerType.OTHER_SD) {
      return 'Other Signer Added Successfully!';
    } else if (signerType === SignerType.SEED_WORDS) {
      return 'Seed key Added Successfully!';
    }
    const formattedType = signerType.charAt(0).toUpperCase() + signerType.slice(1).toLowerCase();
    return `${formattedType} Added Successfully!`;
  };

  return (
    signer && (
      <KeeperModal
        visible={visible}
        title={getSignerTitle(signer.type)}
        subTitle={`${
          getAccountFromSigner(signer) !== 0
            ? `${common.Account} #${getAccountFromSigner(signer)} ${signerText.halfSuccessfulText} `
            : ''
        }${signerText.AccessKeyDetails}`}
        close={close}
        showCloseIcon
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={buttonText}
        buttonCallback={buttonCallback}
        secondaryButtonText={secondaryButtonText}
        secondaryCallback={close}
        Content={() => (
          <Box style={styles.externalKeyModal}>
            <KeyAddedIllustration signer={signer} />
            {content}
          </Box>
        )}
      />
    )
  );
}

const styles = StyleSheet.create({
  externalKeyModal: {
    alignItems: 'center',
  },
  externalKeyIllustration: {
    marginBottom: hp(20),
    marginRight: wp(15),
  },
  externalKeyText: {
    marginBottom: hp(20),
  },
});

export default KeyAddedModal;
