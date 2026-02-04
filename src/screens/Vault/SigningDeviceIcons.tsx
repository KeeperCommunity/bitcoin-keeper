import React from 'react';
import { SignerStorage, SignerType } from 'src/services/wallets/enums';

import COLDCARDICON from 'src/assets/images/coldcard_icon.svg';
import COLDCARDICONLIGHT from 'src/assets/images/coldcard_light.svg';
import COLDCARDLOGO from 'src/assets/images/coldcard_logo.svg';
import JADEICON from 'src/assets/images/jade_icon.svg';
import JADEICONLIGHT from 'src/assets/images/jade_icon_light.svg';
import JADELOGO from 'src/assets/images/jade_logo.svg';
import JADELOGOWHITE from 'src/assets/images/jade_logo_white.svg';
import KEEPERAPP from 'src/assets/images/KeeperIcon.svg';
import KEEPERAPPLIGHT from 'src/assets/images/KeeperIconLight.svg';
import KEYSTONEICON from 'src/assets/images/keystone_icon.svg';
import KEYSTONEICONLIGHT from 'src/assets/images/keystone_icon_light.svg';
import KEYSTONELOGO from 'src/assets/images/keystone_logo.svg';
import KEYSTONELOGOWHITE from 'src/assets/images/keystone_logo_white.svg';
import LEDGERICON from 'src/assets/images/ledger_icon.svg';
import LEDGERICONLIGHT from 'src/assets/images/ledger_light.svg';
import LEDGERLOGO from 'src/assets/images/ledger_logo.svg';
import LEDGERLOGOWHITE from 'src/assets/images/ledger_logo_white.svg';
import MOBILEKEY from 'src/assets/images/mobile_key.svg';
import MOBILEKEYLIGHT from 'src/assets/images/mobile_key_light.svg';
import PASSPORTICON from 'src/assets/images/passport_icon.svg';
import PASSPORTICONLIGHT from 'src/assets/images/passport_light.svg';
import PASSPORTLOGO from 'src/assets/images/passport_logo.svg';
import PASSPORTLOGOWHITE from 'src/assets/images/passport_logo_white.svg';
import SEEDSIGNERICON from 'src/assets/images/seedsigner_icon.svg';
import SEEDSIGNERICONLIGHT from 'src/assets/images/seedsigner_light.svg';
import SEEDSIGNERLOGO from 'src/assets/images/seedsignerlogo.svg';
import SPECTERICON from 'src/assets/images/specter_icon.svg';
import SPECTERICONLIGHT from 'src/assets/images/specter_icon_light.svg';
import SPECTERLOGO from 'src/assets/images/specter_logo.svg';
import SPECTERLOGOWHITE from 'src/assets/images/specter_logo_white.svg';
import SEEDWORDS from 'src/assets/images/seedwords.svg';
import SEEDWORDSLIGHT from 'src/assets/images/seedwordsLight.svg';
import SERVER from 'src/assets/images/server.svg';
import SERVERLIGHT from 'src/assets/images/server_light.svg';
import TAPSIGNERICON from 'src/assets/images/tapsigner_icon.svg';
import TAPSIGNERICONLIGHT from 'src/assets/images/tapsigner_light.svg';
import TAPSIGNERLOGO from 'src/assets/images/tapsigner_logo.svg';
import SATOCHIPICON from 'src/assets/images/satochip_icon.svg';
import SATOCHIPICONLIGHT from 'src/assets/images/satochip_light.svg';
import SATOCHIPLOGO from 'src/assets/images/satochip_logo.svg';
import SATOCHIPLOGOWHITE from 'src/assets/images/satochip_logo_white.svg';
import TREZORICON from 'src/assets/images/trezor_icon.svg';
import TREZORICONLIGHT from 'src/assets/images/trezor_light.svg';
import TREZORLOGO from 'src/assets/images/trezor_logo.svg';
import TREZORLOGOWHITE from 'src/assets/images/trezor_logo_white.svg';
import BITBOXICON from 'src/assets/images/BitBox.svg';
import BITBOXICONLIGHT from 'src/assets/images/BitBoxLight.svg';
import BITBOXLOGO from 'src/assets/images/bitbox_logo.svg';
import BITBOXLOGOWHITE from 'src/assets/images/bitbox_logo_white.svg';
import OTHERSDICON from 'src/assets/images/other.svg';
import OTHERSDICONLIGHT from 'src/assets/images/other_light.svg';
import COLDCARDGREENLIGHT from 'src/assets/images/coldcard-green-light.svg';
import COLDCARDGREENDARK from 'src/assets/images/coldcard-green-dark.svg';
import JADEGREENLIGHT from 'src/assets/images/jade-green-light.svg';
import JADEGREENDARK from 'src/assets/images/jade-green-dark.svg';
import KEYSTONEGREENLIGHT from 'src/assets/images/keystone-green-light.svg';
import KEYSTONEGREENDARK from 'src/assets/images/keystone-green-dark.svg';
import LEDGERGREENLIGHT from 'src/assets/images/ledger-green-light.svg';
import LEDGERGREENDARK from 'src/assets/images/ledger-green-dark.svg';
import PASSPORTGREENLIGHT from 'src/assets/images/passport-green-light.svg';
import PASSPORTGREENDARK from 'src/assets/images/passport-green-dark.svg';
import SEEDSIGNERGREENLIGHT from 'src/assets/images/seedsigner-green-light.svg';
import SEEDSIGNERGREENDARK from 'src/assets/images/seedsigner-green-dark.svg';
import SPECTERGREENLIGHT from 'src/assets/images/specter-green-light.svg';
import SPECTERGREENDARK from 'src/assets/images/specter-green-dark.svg';
import TAPSIGNERGREENLIGHT from 'src/assets/images/tapsigner-green-light.svg';
import TAPSIGNERGREENDARK from 'src/assets/images/tapsigner-green-dark.svg';
import SATOCHIPGREENLIGHT from 'src/assets/images/satochip-green-light.svg';
import SATOCHIPGREENDARK from 'src/assets/images/satochip-green-dark.svg';
import SERVERGREENLIGHT from 'src/assets/images/server-green-light.svg';
import SERVERGREENDARK from 'src/assets/images/server-green-dark.svg';
import MOBILEKEYGREENLIGHT from 'src/assets/images/mobile-key-green-light.svg';
import MOBILEKEYGREENDARK from 'src/assets/images/mobile-key-green-dark.svg';
import KEEPERAPPGREENLIGHT from 'src/assets/images/external-key-green-light.svg';
import KEEPERAPPGREENDARK from 'src/assets/images/external-key-green-dark.svg';
import SEEDWORDSGREENLIGHT from 'src/assets/images/seed-words-green-light.svg';
import SEEDWORDSGREENDARK from 'src/assets/images/seed-words-green-dark.svg';
import OTHERSDGREENLIGHT from 'src/assets/images/other-sd-green-light.svg';
import OTHERSDGREENDARK from 'src/assets/images/other-sd-green-dark.svg';
import BITBOXGREENLIGHT from 'src/assets/images/bitbox-green-light.svg';
import BITBOXGREENDARK from 'src/assets/images/bitbox-green-dark.svg';
import TREZORGREENLIGHT from 'src/assets/images/trezor-green-light.svg';
import TREZORGREENDARK from 'src/assets/images/trezor-green-dark.svg';
import PortalLogo from 'src/assets/images/portalLogo.svg';
import PortalLogoLight from 'src/assets/images/PortalLogoLight.svg';
import PortalIcon from 'src/assets/images/portalIcon.svg';
import PortalIconLight from 'src/assets/images/portalIconLight.svg';
import PortalGreenIconLight from 'src/assets/images/portal-green-light.svg';
import PortalGreenIconDark from 'src/assets/images/portal-green-dark.svg';
import KruxIcon from 'src/assets/images/KruxIcon.svg';
import KruxIconLight from 'src/assets/images/KruxIconDark.svg';
import KruxLogo from 'src/assets/images/KruxLogo.svg';
import KruxLogoDark from 'src/assets/images/KruxLogoDark.svg';

import Text from 'src/components/KeeperText';
import { StyleSheet } from 'react-native';
import { useColorMode } from 'native-base';

const getColouredIcon = (LightComponent, DarkComponent, isLight, width, height) => {
  const component = isLight ? LightComponent : DarkComponent;
  return React.cloneElement(component, { width, height });
};
type SDIconOptions = {
  type: SignerType;
  light?: boolean;
  width?: number;
  height?: number;
};

export const SDIcons = ({ type, light = true, width = 20, height = 20 }: SDIconOptions) => {
  const { colorMode } = useColorMode();

  switch (type) {
    case SignerType.COLDCARD:
      return {
        Icon: getColouredIcon(<COLDCARDICONLIGHT />, <COLDCARDICON />, light, width, height),
        Logo: <COLDCARDLOGO />,
        type: SignerStorage.COLD,
      };
    case SignerType.JADE:
      return {
        Icon: getColouredIcon(<JADEICONLIGHT />, <JADEICON />, light, width, height),
        Logo: colorMode === 'dark' ? <JADELOGOWHITE /> : <JADELOGO />,
        type: SignerStorage.COLD,
      };
    case SignerType.MY_KEEPER:
      return {
        Icon: getColouredIcon(<MOBILEKEYLIGHT />, <MOBILEKEY />, light, width, height),
        Logo: (
          <Text style={styles.text} color={`${colorMode}.modalWhiteContent`}>
            Mobile Key
          </Text>
        ),
      };
    case SignerType.KEEPER:
      return {
        Icon: getColouredIcon(<KEEPERAPPLIGHT />, <KEEPERAPP />, light, width, height),
        Logo: (
          <Text style={styles.text} color={`${colorMode}.modalWhiteContent`}>
            External Key
          </Text>
        ),
      };
    case SignerType.KEYSTONE:
      return {
        Icon: getColouredIcon(<KEYSTONEICONLIGHT />, <KEYSTONEICON />, light, width, height),
        Logo: colorMode === 'dark' ? <KEYSTONELOGOWHITE /> : <KEYSTONELOGO />,
        type: SignerStorage.COLD,
      };
    case SignerType.LEDGER:
      return {
        Icon: getColouredIcon(<LEDGERICONLIGHT />, <LEDGERICON />, light, width, height),
        Logo: colorMode === 'dark' ? <LEDGERLOGOWHITE /> : <LEDGERLOGO />,
        type: SignerStorage.COLD,
      };
    case SignerType.MOBILE_KEY:
      return {
        Icon: getColouredIcon(<MOBILEKEYLIGHT />, <MOBILEKEY />, light, width, height),
        Logo: (
          <Text style={styles.text} color={`${colorMode}.modalWhiteContent`}>
            Mobile Key
          </Text>
        ),
        type: SignerStorage.HOT,
      };
    case SignerType.PASSPORT:
      return {
        Icon: getColouredIcon(<PASSPORTICONLIGHT />, <PASSPORTICON />, light, width, height),
        Logo: colorMode === 'dark' ? <PASSPORTLOGOWHITE /> : <PASSPORTLOGO />,
        type: SignerStorage.COLD,
      };
    case SignerType.POLICY_SERVER:
      return {
        Icon: getColouredIcon(<SERVERLIGHT />, <SERVER />, light, width, height),
        Logo: (
          <Text style={styles.text} color={`${colorMode}.modalWhiteContent`}>
            Server Key +
          </Text>
        ),
        type: SignerStorage.HOT,
      };
    case SignerType.TAPSIGNER:
      return {
        Icon: getColouredIcon(<TAPSIGNERICONLIGHT />, <TAPSIGNERICON />, light, width, height),
        Logo: <TAPSIGNERLOGO />,
        type: SignerStorage.COLD,
      };
    case SignerType.SATOCHIP:
      return {
        Icon: getColouredIcon(<SATOCHIPICONLIGHT />, <SATOCHIPICON />, light, width, height),
        Logo: colorMode === 'dark' ? <SATOCHIPLOGOWHITE /> : <SATOCHIPLOGO />,
        type: SignerStorage.COLD,
      };
    case SignerType.TREZOR:
      return {
        Icon: getColouredIcon(<TREZORICONLIGHT />, <TREZORICON />, light, width, height),
        Logo: colorMode === 'dark' ? <TREZORLOGOWHITE /> : <TREZORLOGO />,
        type: SignerStorage.COLD,
      };
    case SignerType.SEEDSIGNER:
      return {
        Icon: getColouredIcon(<SEEDSIGNERICONLIGHT />, <SEEDSIGNERICON />, light, width, height),
        Logo: <SEEDSIGNERLOGO />,
        type: SignerStorage.COLD,
      };
    case SignerType.SPECTER:
      return {
        Icon: getColouredIcon(<SPECTERICONLIGHT />, <SPECTERICON />, light, width, height),
        Logo: colorMode === 'dark' ? <SPECTERLOGOWHITE /> : <SPECTERLOGO />,
        type: SignerStorage.COLD,
      };
    case SignerType.BITBOX02:
      return {
        Icon: getColouredIcon(<BITBOXICONLIGHT />, <BITBOXICON />, light, width, height),
        Logo: colorMode === 'dark' ? <BITBOXLOGOWHITE /> : <BITBOXLOGO />,
        type: SignerStorage.COLD,
      };
    case SignerType.PORTAL:
      return {
        Icon: getColouredIcon(<PortalIconLight />, <PortalIcon />, light, width, height),
        Logo: colorMode === 'dark' ? <PortalLogoLight /> : <PortalLogo />,
        type: SignerStorage.COLD,
      };
    case SignerType.OTHER_SD:
      return {
        Icon: getColouredIcon(<OTHERSDICONLIGHT />, <OTHERSDICON />, light, width, height),
        Logo: (
          <Text style={styles.text} color={`${colorMode}.modalWhiteContent`}>
            Other signer
          </Text>
        ),
        type: SignerStorage.COLD,
      };
    case SignerType.UNKOWN_SIGNER:
      return {
        Icon: getColouredIcon(<OTHERSDICONLIGHT />, <OTHERSDICON />, light, width, height),
        Logo: (
          <Text style={styles.text} color={`${colorMode}.modalWhiteContent`}>
            Unknown Signer
          </Text>
        ),
        type: SignerStorage.COLD,
      };
    case SignerType.SEED_WORDS:
      return {
        Icon: getColouredIcon(<SEEDWORDSLIGHT />, <SEEDWORDS />, light, width, height),
        Logo: (
          <Text style={styles.text} color={`${colorMode}.modalWhiteContent`}>
            Seed Key
          </Text>
        ),
        type: SignerStorage.WARM,
      };

    case SignerType.KRUX:
      return {
        Icon: getColouredIcon(<KruxIconLight />, <KruxIcon />, light, width, height),
        Logo: colorMode === 'dark' ? <KruxLogoDark /> : <KruxLogo />,
        type: SignerStorage.COLD,
      };
    default:
      return {
        Icon: null,
        Logo: null,
        type: SignerStorage.COLD,
      };
  }
};

export const SDColoredIcons = (type: SignerType, light = true, width = 20, height = 20) => {
  switch (type) {
    case SignerType.COLDCARD:
      return {
        Icon: getColouredIcon(<COLDCARDGREENLIGHT />, <COLDCARDGREENDARK />, light, width, height),
        type: SignerStorage.COLD,
      };
    case SignerType.JADE:
      return {
        Icon: getColouredIcon(<JADEGREENLIGHT />, <JADEGREENDARK />, light, width, height),
        type: SignerStorage.COLD,
      };
    case SignerType.MY_KEEPER:
      return {
        Icon: getColouredIcon(
          <MOBILEKEYGREENLIGHT />,
          <MOBILEKEYGREENDARK />,
          light,
          width,
          height
        ),
      };
    case SignerType.KEEPER:
      return {
        Icon: getColouredIcon(
          <KEEPERAPPGREENLIGHT />,
          <KEEPERAPPGREENDARK />,
          light,
          width,
          height
        ),
      };
    case SignerType.KEYSTONE:
      return {
        Icon: getColouredIcon(<KEYSTONEGREENLIGHT />, <KEYSTONEGREENDARK />, light, width, height),
        type: SignerStorage.COLD,
      };
    case SignerType.LEDGER:
      return {
        Icon: getColouredIcon(<LEDGERGREENLIGHT />, <LEDGERGREENDARK />, light, width, height),
        type: SignerStorage.COLD,
      };
    case SignerType.MOBILE_KEY:
      return {
        Icon: getColouredIcon(
          <MOBILEKEYGREENLIGHT />,
          <MOBILEKEYGREENDARK />,
          light,
          width,
          height
        ),
        type: SignerStorage.HOT,
      };
    case SignerType.PASSPORT:
      return {
        Icon: getColouredIcon(<PASSPORTGREENLIGHT />, <PASSPORTGREENDARK />, light, width, height),
        type: SignerStorage.COLD,
      };
    case SignerType.POLICY_SERVER:
      return {
        Icon: getColouredIcon(<SERVERGREENLIGHT />, <SERVERGREENDARK />, light, width, height),
        type: SignerStorage.HOT,
      };
    case SignerType.TAPSIGNER:
      return {
        Icon: getColouredIcon(
          <TAPSIGNERGREENLIGHT />,
          <TAPSIGNERGREENDARK />,
          light,
          width,
          height
        ),
        type: SignerStorage.COLD,
      };
    case SignerType.SATOCHIP:
      return {
        Icon: getColouredIcon(
          <SATOCHIPGREENLIGHT />,
          <SATOCHIPGREENDARK />,
          light,
          width,
          height
        ),
        type: SignerStorage.COLD,
      };
    case SignerType.TREZOR:
      return {
        Icon: getColouredIcon(<TREZORGREENLIGHT />, <TREZORGREENDARK />, light, width, height),
        type: SignerStorage.COLD,
      };
    case SignerType.SEEDSIGNER:
      return {
        Icon: getColouredIcon(
          <SEEDSIGNERGREENLIGHT />,
          <SEEDSIGNERGREENDARK />,
          light,
          width,
          height
        ),
        type: SignerStorage.COLD,
      };
    case SignerType.SPECTER:
      return {
        Icon: getColouredIcon(<SPECTERGREENLIGHT />, <SPECTERGREENDARK />, light, width, height),
        type: SignerStorage.COLD,
      };
    case SignerType.BITBOX02:
      return {
        Icon: getColouredIcon(<BITBOXGREENLIGHT />, <BITBOXGREENDARK />, light, width, height),
        type: SignerStorage.COLD,
      };
    case SignerType.OTHER_SD:
      return {
        Icon: getColouredIcon(<OTHERSDGREENLIGHT />, <OTHERSDGREENDARK />, light, width, height),
        type: SignerStorage.COLD,
      };
    case SignerType.UNKOWN_SIGNER:
      return {
        Icon: getColouredIcon(<OTHERSDGREENLIGHT />, <OTHERSDGREENDARK />, light, width, height),
        type: SignerStorage.COLD,
      };
    case SignerType.SEED_WORDS:
      return {
        Icon: getColouredIcon(
          <SEEDWORDSGREENLIGHT />,
          <SEEDWORDSGREENDARK />,
          light,
          width,
          height
        ),
        type: SignerStorage.WARM,
      };
    case SignerType.PORTAL:
      return {
        Icon: getColouredIcon(
          <PortalGreenIconLight />,
          <PortalGreenIconDark />,
          light,
          width,
          height
        ),
        type: SignerStorage.COLD,
      };
    case SignerType.KRUX:
      return {
        Icon: getColouredIcon(<KruxIcon />, <KruxIcon />, light, width, height),
        type: SignerStorage.COLD,
      };
    default:
      return {
        Icon: null,
        type: SignerStorage.COLD,
      };
  }
};

const styles = StyleSheet.create({
  text: {
    fontSize: 14,
    fontWeight: '500',
  },
});
