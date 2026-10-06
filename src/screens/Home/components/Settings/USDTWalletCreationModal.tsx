import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { CommonActions, useNavigation } from '@react-navigation/native';
import React, { useContext } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import ImportWalletIcon from 'src/assets/images/import.svg';
import NewWalletIcon from 'src/assets/images/wallet-white-small.svg';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import KeeperModal from 'src/components/KeeperModal';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useToastMessage from 'src/hooks/useToastMessage';
import { useUSDTWallets } from 'src/hooks/useUSDTWallets';
import { USDTWalletType } from 'src/services/wallets/factories/USDTWalletFactory';

const USDTWalletCreationModal = ({ visible, close }: { visible: boolean; close: () => void }) => {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { translations } = useContext(LocalizationContext);
  const { wallet: walletText, home } = translations;
  const { createWallet } = useUSDTWallets();
  const { showToast } = useToastMessage();

  const importUSDTWallet = async (mnemonic) => {
    try {
      const { newWallet, error } = await createWallet({
        type: USDTWalletType.IMPORTED,
        name: 'USDT Wallet',
        description: 'Imported USDT Wallet',
        importDetails: { mnemonic },
      });

      if (!newWallet) throw new Error(error);

      showToast('USDT wallet imported successfully!', <TickIcon />);
      setTimeout(() => {
        navigation.dispatch(
          CommonActions.navigate({ name: 'Home', params: { selectedOption: 'Wallets' } })
        );
      }, 900);
    } catch (err) {
      showToast(`Failed to import USDT wallet: ${err.message}`, <ToastErrorIcon />);
    }
  };

  const options = [
    {
      title: walletText.createWallet,
      subtitle: 'Create a new USDT wallet',
      icon: <NewWalletIcon />,
      onPress: () => {
        close();
        navigation.dispatch(CommonActions.navigate('addUsdtWallet'));
      },
    },
    {
      title: home.ImportWallet,
      subtitle: walletText.restoreExistingWallet,
      icon: <ImportWalletIcon />,
      onPress: () => {
        close();
        navigation.dispatch(
          CommonActions.navigate({
            name: 'EnterSeedScreen',
            params: { isImport: true, isUSDTWallet: true, importSeedCta: importUSDTWallet },
          })
        );
      },
    },
  ];

  return (
    <KeeperModal
      visible={visible}
      title={walletText.AddUSDTWallet}
      subTitle={walletText.createOrImportWallet}
      close={close}
      textColor={`${colorMode}.textGreen`}
      subTitleColor={`${colorMode}.modalSubtitleBlack`}
      showCloseIcon
      Content={() => (
        <Box style={styles.optionsList}>
          {options.map((option) => (
            <TouchableOpacity key={option.title} onPress={option.onPress}>
              <Box
                style={styles.option}
                backgroundColor={`${colorMode}.boxSecondaryBackground`}
                borderColor={`${colorMode}.separator`}
              >
                <CircleIconWrapper
                  width={wp(40)}
                  icon={option.icon}
                  backgroundColor={`${colorMode}.pantoneGreen`}
                />
                <Box>
                  <Text color={`${colorMode}.secondaryText`} fontSize={15} medium>
                    {option.title}
                  </Text>
                  <Text color={`${colorMode}.secondaryText`} fontSize={12}>
                    {option.subtitle}
                  </Text>
                </Box>
              </Box>
            </TouchableOpacity>
          ))}
        </Box>
      )}
    />
  );
};

export default USDTWalletCreationModal;

const styles = StyleSheet.create({
  optionsList: { gap: wp(15), marginBottom: hp(10) },
  option: {
    flexDirection: 'row',
    paddingHorizontal: wp(15),
    paddingVertical: hp(22),
    alignItems: 'center',
    gap: wp(16),
    borderRadius: 12,
    borderWidth: 1,
  },
});
