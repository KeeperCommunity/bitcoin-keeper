import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Box } from 'native-base';
import { SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import { useNavigation } from '@react-navigation/native';
import { VaultSigner } from 'src/services/wallets/interfaces/vault';
import { useColorMode } from 'native-base';
import { SignerType } from 'src/services/wallets/enums';
import UpgradeSubscription from 'src/screens/InheritanceToolsAndTips/components/UpgradeSubscription';
import HardwareModalMap, { InteracationMode } from '../HardwareModalMap';
import { SDIcons } from '../SigningDeviceIcons';
import { hp, windowHeight, windowWidth, wp } from 'src/constants/responsive';
import RightArrow from 'src/assets/images/icon_arrow.svg';
import RightArrowWhite from 'src/assets/images/icon_arrow_white.svg';
import useToastMessage from 'src/hooks/useToastMessage';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';

type SigningDeviceCardProps = {
  type: SignerType;
  disabled: boolean;
  message: string;
  first?: boolean;
  last?: boolean;
  isOnL1: boolean;
  isOnL2: boolean;
  addSignerFlow: boolean;
  vaultId: string;
  vaultSigners?: VaultSigner[];
  isMultisig: boolean;
  primaryMnemonic: string;
  accountNumber: number;
  displayToast?: boolean;
};

const SigningDeviceCard = ({
  type,
  disabled,
  message,
  first = false,
  last = false,
  isOnL1,
  isOnL2,
  addSignerFlow,
  vaultId,
  vaultSigners,
  isMultisig,
  primaryMnemonic,
  accountNumber,
  displayToast,
}: SigningDeviceCardProps) => {
  const [visible, setVisible] = useState(false);
  const navigation = useNavigation();
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const { showToast } = useToastMessage();
  const signing_device_card_background = ThemedColor({ name: 'signing_device_card_background' });

  const onPress = () => {
    if (shouldUpgrade) {
      navigateToUpgrade();
      return;
    }
    if (displayToast) {
      showToast(message);
    } else {
      open();
    }
  };

  const open = () => setVisible(true);
  const close = () => setVisible(false);
  const shouldUpgrade = message.includes('upgrade');

  const navigateToUpgrade = () => {
    // navigation.navigate('ChoosePlan');
  };

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        disabled={disabled && !shouldUpgrade && !displayToast}
        testID={`btn_${type}`}
      >
        <Box
          backgroundColor={signing_device_card_background}
          borderTopRadius={first ? 10 : 0}
          borderBottomRadius={last ? 10 : 0}
          borderWidth={isDarkMode ? 1 : 0}
          borderTopWidth={first && isDarkMode ? 1 : 0}
          borderBottomWidth={isDarkMode || !last ? 1 : 0}
          borderColor={`${colorMode}.dullGreyBorder`}
          style={[styles.container]}
        >
          {isOnL1 && type === SignerType.POLICY_SERVER && (
            <Box style={styles.upgradeButtonContainer}>
              <UpgradeSubscription
                type={SubscriptionTier.L2}
                customStyles={styles.upgradeButtonCustomStyles}
              />
            </Box>
          )}
          <Box
            style={[
              styles.walletMapContainer,
              {
                opacity: disabled ? 0.4 : 1,
              },
            ]}
          >
            <Box style={styles.walletMapWrapper}>
              {SDIcons({ type, light: colorMode === 'dark' }).Icon}
            </Box>
            <Box backgroundColor={`${colorMode}.dullGreyBorder`} style={styles.divider} />
            <Box style={styles.walletMapLogoWrapper}>{SDIcons({ type }).Logo}</Box>

            <Box style={styles.arrowIconWrapper}>
              {isDarkMode ? <RightArrowWhite /> : <RightArrow />}
            </Box>
          </Box>
        </Box>
      </TouchableOpacity>
      <HardwareModalMap
        visible={visible}
        close={close}
        type={type}
        mode={InteracationMode.VAULT_ADDITION}
        isMultisig={isMultisig}
        primaryMnemonic={primaryMnemonic}
        addSignerFlow={addSignerFlow}
        vaultId={vaultId}
        vaultSigners={vaultSigners}
        accountNumber={accountNumber}
      />
    </>
  );
};

const styles = StyleSheet.create({
  walletMapContainer: {
    alignItems: 'center',
    minHeight: windowHeight * 0.075,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  walletMapWrapper: {
    marginRight: wp(13.2),
    alignItems: 'center',
  },
  walletMapLogoWrapper: {
    marginLeft: wp(20),
    justifyContent: 'flex-end',
    marginVertical: hp(20),
    width: windowWidth * 0.53,
  },
  messageText: {
    fontSize: 10,
    letterSpacing: 0.1,
    width: windowWidth * 0.6,
  },
  divider: {
    height: hp(25),
    width: 1,
  },
  upgradeButtonContainer: {
    width: '100%',
  },
  upgradeButtonCustomStyles: {
    container: {
      borderTopWidth: 0,
      justifyContent: 'space-between',
      paddingHorizontal: wp(22),
    },
  },
  container: {
    alignItems: 'center',
  },
  arrowIconWrapper: {
    marginLeft: wp(10),
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default SigningDeviceCard;
