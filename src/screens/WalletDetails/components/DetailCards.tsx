import { Box, useColorMode } from 'native-base';
import React, { useContext } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import { EntityKind } from 'src/services/wallets/enums';
import { CommonActions, useNavigation } from '@react-navigation/native';

interface Props {
  setShowMore?: (value: boolean) => void;
  sendCallback?: () => void;
  receiveCallback?: () => void;
  buyCallback?: () => void;
  disabled?: boolean;
  wallet?: any;
}

const DetailCards = ({
  setShowMore,
  sendCallback,
  receiveCallback,
  buyCallback,
  disabled,
  wallet,
}: Props) => {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { usdtWalletText, buyBTC: buyBTCText, common } = translations;
  const navigation = useNavigation();

  const CardsData = [
    {
      id: 1,
      icon: 'send_Btc_arrow',
      title:
        wallet?.entityKind === EntityKind.USDT_WALLET
          ? usdtWalletText.sendUsdt
          : buyBTCText.sendBtc,
      callback: () => {
        sendCallback?.();
      },
      disableOption: disabled,
    },
    {
      id: 2,
      icon: 'recieve_Btc_arrow',
      title:
        wallet?.entityKind === EntityKind.USDT_WALLET
          ? usdtWalletText.recieveUSdt
          : buyBTCText.recieveBtc,
      callback: () => {
        receiveCallback?.();
      },
      disableOption: disabled,
    },
    {
      id: 4,
      icon: wallet?.entityKind === EntityKind.WALLET ? 'view_coins' : 'more_Btc_icon',
      title:
        wallet?.entityKind === EntityKind.WALLET
          ? common.viewAllCoins
          : wallet?.entityKind === EntityKind.USDT_WALLET
          ? usdtWalletText.moreOption
          : buyBTCText.moreOptions,
      callback: () => {
        wallet?.entityKind === EntityKind.WALLET
          ? navigation.dispatch(
              CommonActions.navigate('UTXOManagement', {
                data: wallet,
                routeName: 'Wallet',
              })
            )
          : setShowMore?.(true);
      },
      disableOption: false,
    },
  ].filter(Boolean);

  // Remove "More Options" for USDT wallets
  if (wallet?.entityKind === EntityKind.USDT_WALLET) {
    CardsData.pop();
  }

  return (
    <Box style={styles.container} backgroundColor="transparent">
      {CardsData.map(({ id, icon: Icon, title, callback, disableOption }) => (
        <TouchableOpacity
          key={id}
          onPress={callback}
          disabled={disableOption}
          style={{ opacity: disableOption ? 0.6 : 1 }}
        >
          <Box
            backgroundColor={`${colorMode}.primaryBackground`}
            borderWidth={1}
            borderColor={`${colorMode}.separator`}
            style={styles.card}
          >
            <ThemedSvg name={Icon} width={18} height={18} />
            <Text fontSize={11} style={styles.title} numberOfLines={2} ellipsizeMode="tail">
              {title}
            </Text>
          </Box>
        </TouchableOpacity>
      ))}
    </Box>
  );
};

export default DetailCards;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    margin: wp(4),
    width: wp(80),
    height: hp(100),
    paddingHorizontal: wp(8),
    paddingVertical: 12,
    shadowColor: 'rgba(0, 0, 0, 0.12)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 4,
    borderRadius: 8,
  },
  title: {
    marginTop: 8,
    textAlign: 'center',
    maxWidth: '100%',
  },
});
