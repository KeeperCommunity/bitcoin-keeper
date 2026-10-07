import React, { useContext } from 'react';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { Platform, StyleSheet, TouchableOpacity } from 'react-native';
import { hp, wp } from 'src/constants/responsive';
import WalletIcon from 'src/assets/images/Wallet-grey.svg';
import KeyIcon from 'src/assets/images/key-grey.svg';
import ConciergeIcon from 'src/assets/images/faq-grey.svg';
import MoreIcon from 'src/assets/images/more-grey.svg';
import Text from './KeeperText';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ThemedSvg from './ThemedSvg.tsx/ThemedSvg';
import ThemedColor from './ThemedColor/ThemedColor';

const MenuFooter = ({ selectedOption, onOptionChange }) => {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const { translations } = useContext(LocalizationContext);
  const { wallet: walletTranslation, askAi } = translations;
  const selectedFooterColor = ThemedColor({ name: 'footer_selected_option' });

  const menuOptions = [
    {
      testID: 'home_tab_wallets',
      name: walletTranslation.homeWallets,
      defaultIcon: <WalletIcon />,
      selectedIcon: <ThemedSvg name={'footer_Wallet'} />,
    },
    {
      testID: 'home_tab_keys',
      name: walletTranslation.keys,
      defaultIcon: <KeyIcon />,
      selectedIcon: <ThemedSvg name={'footer_Key'} />,
    },
    {
      testID: 'home_tab_ask',
      name: askAi.ask,
      defaultIcon: <ConciergeIcon />,
      selectedIcon: <ThemedSvg name={'footer_concierge'} />,
    },
    {
      testID: 'home_tab_more',
      name: walletTranslation.more,
      defaultIcon: <MoreIcon />,
      selectedIcon: <ThemedSvg name={'footer_more'} />,
    },
  ].filter(Boolean);

  return (
    <Box
      style={[styles.container, { paddingBottom: Platform.OS === 'ios' ? hp(26) : 0 }]}
      backgroundColor={
        isDarkMode ? `${colorMode}.primaryGreenBackground` : `${colorMode}.ChampagneBliss`
      }
      borderColor={`${colorMode}.MistSlate`}
    >
      <Box style={styles.menuWrapper}>
        {menuOptions.map((option) => (
          <TouchableOpacity
            key={option.name}
            testID={option.testID}
            onPress={() => onOptionChange(option.name)}
            style={[styles.menuItem]}
          >
            <Box style={styles.iconContainer}>
              {selectedOption === option.name ? option.selectedIcon : option.defaultIcon}
            </Box>
            <Text
              style={[styles.menuText]}
              color={
                selectedOption === option.name
                  ? selectedFooterColor
                  : `${colorMode}.placeHolderTextColor`
              }
            >
              {option.name}
            </Text>
          </TouchableOpacity>
        ))}
      </Box>
    </Box>
  );
};

export default MenuFooter;

const styles = StyleSheet.create({
  container: {
    width: '100%',
    minHeight: hp(85),
    borderRadius: 20,
    paddingHorizontal: wp(10),
    paddingTop: hp(10),
    borderWidth: 1,
  },
  menuWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  menuItem: {
    alignItems: 'center',
    paddingVertical: hp(5),
    paddingHorizontal: wp(10),
    borderRadius: 10,
  },
  iconContainer: {
    width: wp(20),
    height: wp(20),
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuText: {
    marginTop: 5,
    fontSize: 11,
    textAlign: 'center',
  },
});
