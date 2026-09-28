import React, { useContext, useState } from 'react';
import DeviceCard from './DeviceCard';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { StyleSheet } from 'react-native';
import { hp } from 'src/constants/responsive';
import BitBox from 'src/assets/images/bit-box-2.svg';
import ColdCard from 'src/assets/images/coinkite-image.svg';
import Passport from 'src/assets/images/foundation-passport-icon.svg';
import Legder from 'src/assets/images/Ledger-icon.svg';
import Trezor from 'src/assets/images/TREZOR-icon.svg';
import { Image, ImageStyle } from 'react-native';

const OnekeyDevice = ({ width, height }: { width: number; height: number }) => (
  <Image source={require('src/assets/images/onekey-shop-device.png')} style={{ width, height } as ImageStyle} resizeMode="contain" />
);
import FlagHongKong from 'src/assets/images/flag-hongkong.svg';
import FlagJapan from 'src/assets/images/flag-japan.svg';
import FlagCanada from 'src/assets/images/flag-canada.svg';
import FlagUSA from 'src/assets/images/flag-usa.svg';
import FlagSwizerland from 'src/assets/images/flag-swizerland.svg';
import FlagFrance from 'src/assets/images/flag-france.svg';
import FlagRepublic from 'src/assets/images/flag-czech.svg';
import usePlan from 'src/hooks/usePlan';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import KeeperModal from 'src/components/KeeperModal';
import TrezorDevices from './TrezorDevices';
import CoinkiteDevices from './CoinkiteDevices';

const HardwareDevices = ({ sellers }) => {
  const { isOnL1 } = usePlan();
  const { translations } = useContext(LocalizationContext);
  const { common, wallet: walletText } = translations;
  const { colorMode } = useColorMode();
  const [isOpen, setIsOpen] = useState(false);
  const [coinkiteOpen, setCoinkiteOpen] = useState(false);

  const getSellerLink = (identifier) => {
    const seller = sellers.find((s) => s.identifier === identifier);
    return seller ? seller.link : null;
  };

  const data = [
    {
      id: 1,
      title: walletText.hardwareBitBox,
      image: <BitBox width={hp(90)} height={hp(100)} />,
      flagIcon: <FlagSwizerland />,
      country: walletText.hardwareBitBoxCountry,
      link: getSellerLink('bitbox'),
      subscribeText: walletText.hardwareBitboxDiscount,
      unSubscribeText: walletText.hardwareBitboxDiscount,
    },
    {
      id: 2,
      title: walletText.hardwareColdcard,
      image: <ColdCard height={hp(100)} width={hp(70)} />,
      flagIcon: <FlagCanada />,
      country: walletText.hardwareColdcardCountry,
      subscribeText: walletText.hardwareSubscribeText,
      unSubscribeText: walletText.hardwareSubscribeText,
      onPress: () => setCoinkiteOpen(true),
    },
    {
      id: 3,
      title: walletText.hardwareFoundation,
      image: <Passport height={hp(100)} width={hp(70)} />,
      flagIcon: <FlagUSA />,
      country: walletText.hardwareFoundationCountry,
      link: getSellerLink('foundation'),
      subscribeText: walletText.hardwareFoundationSubscribeText,
      unSubscribeText: walletText.hardwareFoundationSubscribeText,
    },
    {
      id: 4,
      title: walletText.hardwareLedger,
      image: <Legder height={hp(80)} width={hp(70)} />,
      flagIcon: <FlagFrance />,
      country: walletText.hardwareLedgerCountry,
      link: getSellerLink('leger'),
      subscribeText: '',
      unSubscribeText: '',
    },
    {
      id: 5,
      title: walletText.hardwareTrezor,
      image: <Trezor />,
      flagIcon: <FlagRepublic />,
      country: walletText.hardwareTrezorCountry,
      onPress: () => setIsOpen(true),
      subscribeText: '',
      unSubscribeText: '',
    },
    {
      id: 6,
      title: 'OneKey',
      image: <OnekeyDevice width={hp(90)} height={hp(100)} />,
      flagIcon: <><FlagHongKong width={18} height={12} /><FlagJapan width={18} height={12} /></>,
      country: 'HK & Japan',
      link: getSellerLink('onekey'),
      subscribeText: '',
      unSubscribeText: '',
    },
  ];

  return (
    <Box style={styles.container}>
      {data.map((item) => (
        <DeviceCard
          key={item.title}
          madeText={common.madeIn}
          title={item.title}
          image={item.image}
          flagIcon={item.flagIcon}
          country={item.country}
          plan={isOnL1}
          subscribeText={item.subscribeText}
          unSubscribeText={item.unSubscribeText}
          link={item.link}
          buttonText={walletText.hardwareDeviceButton}
          onPress={item.onPress}
        />
      ))}

      <KeeperModal
        visible={isOpen}
        title={walletText.hardwareTrezor}
        subTitle={walletText.TrezorModalSub}
        close={() => setIsOpen(false)}
        showCloseIcon
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => <TrezorDevices getSellerLink={getSellerLink} wallet={walletText} />}
      />
      <KeeperModal
        visible={coinkiteOpen}
        title={walletText.hardwareColdcard}
        subTitle={walletText.TrezorModalSub}
        close={() => setCoinkiteOpen(false)}
        showCloseIcon
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => <CoinkiteDevices getSellerLink={getSellerLink} wallet={walletText} />}
      />
    </Box>
  );
};

export default HardwareDevices;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: 14,
    paddingVertical: hp(20),
  },
});
