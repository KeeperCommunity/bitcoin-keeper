import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useContext, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet } from 'react-native';
import KeeperModal from 'src/components/KeeperModal';
import Text from 'src/components/KeeperText';
import KeeperTextInput from 'src/components/KeeperTextInput';
import ScreenWrapper from 'src/components/ScreenWrapper';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import WalletHeader from 'src/components/WalletHeader';
import { hp, wp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useToastMessage from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import Buttons from 'src/components/Buttons';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { useUSDTWallets } from 'src/hooks/useUSDTWallets';
import { USDTWalletType } from 'src/services/wallets/factories/USDTWalletFactory';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';

const AddUsdtWallet = () => {
  const { colorMode } = useColorMode();
  const { primaryMnemonic }: KeeperApp = useQuery(RealmSchema.KeeperApp)[0];
  const { translations } = useContext(LocalizationContext);
  const {
    usdtWalletText,
    wallet: walletText,
    importWallet,
    vault: vaultText,
    common,
  } = translations;
  const [walletName, setWalletName] = useState('');
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const descriptionInputRef = useRef('USDT wallet');
  const initialDescription = useRef(descriptionInputRef.current);
  const { showToast } = useToastMessage();
  const navigation = useNavigation();
  const { createWallet } = useUSDTWallets();

  const onDescriptionChange = (value) => {
    descriptionInputRef.current = value;
  };

  const navigationState = {
    name: 'Home',
    params: { selectedOption: 'Wallets' },
  };

  const handleCreateWallet = async () => {
    if (!walletName.trim()) {
      showToast('Please enter a wallet name');
      return;
    }

    try {
      setIsCreating(true);

      const { newWallet, error } = await createWallet({
        type: USDTWalletType.DEFAULT,
        name: walletName.trim(),
        description: descriptionInputRef.current || 'USDT wallet',
        primaryMnemonic,
      });

      if (newWallet) {
        showToast('USDT wallet created successfully!', <TickIcon />);
        setTimeout(() => {
          navigation.dispatch(CommonActions.navigate(navigationState));
          setIsCreating(false);
        }, 900);
      } else {
        showToast(`Failed to create wallet: ${error}`, <ToastErrorIcon />);
        setIsCreating(false);
      }
    } catch (err) {
      showToast(err.message || 'Failed to create wallet', <ToastErrorIcon />);
      setIsCreating(false);
    }
  };

  return (
    <ScreenWrapper barStyle="dark-content" backgroundcolor={`${colorMode}.primaryBackground`}>
      <Box flex={1}>
        <WalletHeader
          title={usdtWalletText.addWalletDetails}
          subTitle={usdtWalletText.dedicatedWalletSub}
        />
        <Box style={styles.fieldsContainer}>
          <Text fontSize={14} medium>
            {walletText.yourWalletName}
          </Text>
          <Box style={styles.inputFieldWrapper}>
            <KeeperTextInput
              placeholder={walletText.WalletNamePlaceHolder}
              value={walletName}
              onChangeText={(value) => {
                setWalletName(value);
              }}
              maxLength={18}
              testID="input_wallet_name"
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
            />
          </Box>
          <Pressable
            onPress={() => {
              setShowDescriptionModal(true);
              initialDescription.current = descriptionInputRef.current;
            }}
          >
            <Box style={styles.descriptionContainer}>
              <Text color={`${colorMode}.greenText`}>{importWallet.addDescription}</Text>
              <ThemedSvg name={'add_circle'} />
            </Box>
          </Pressable>
        </Box>
      </Box>
      {!isInputFocused && (
        <Box style={styles.noteContainer}>
          <Text
            color={`${colorMode}.dashedButtonBorderColor`}
            style={styles.noteTitle}
            fontSize={14}
            medium
          >
            {common.note}
          </Text>

          <Text color={`${colorMode}.primaryText`} fontSize={12}>
            {usdtWalletText.UsdtPowerdBy}
            <Text
              bold
              style={[styles.link]}
              onPress={() => Linking.openURL('https://gasfree.io/home')}
            >
              {'GasFree.io'}
            </Text>{' '}
            {usdtWalletText.keeperDontControl}{' '}
            <Text
              style={[styles.link]}
              bold
              onPress={() => Linking.openURL('https://gasfree.io/home')}
            >
              {'GasFree.io'}
            </Text>{' '}
            {usdtWalletText.becomesUnavailable}
          </Text>
        </Box>
      )}
      <Box style={styles.footer}>
        <Buttons
          primaryText={isCreating ? 'Creating Wallet...' : walletText.createYourWallet}
          primaryCallback={handleCreateWallet}
          primaryDisable={!walletName.trim() || isCreating}
          fullWidth
        />
      </Box>

      <KeeperModal
        visible={showDescriptionModal}
        close={() => setShowDescriptionModal(false)}
        title={importWallet.addDescription}
        subTitle={vaultText.vaultEditSubtitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        showCloseIcon={false}
        Content={() => {
          const [description, setDescription] = useState(descriptionInputRef.current);

          return (
            <Box style={styles.descriptionInput}>
              <KeeperTextInput
                placeholder={walletText.addOptionalDesc}
                value={description}
                onChangeText={(value) => {
                  setDescription(value);
                  descriptionInputRef.current = value;
                  onDescriptionChange(value);
                }}
                testID="vault_description"
                maxLength={20}
              />
            </Box>
          );
        }}
        buttonText={common.saveChanges}
        buttonCallback={() => {
          setShowDescriptionModal(false);
          showToast(walletText.descriptionAddedSuccessfully, <TickIcon />);
        }}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => {
          descriptionInputRef.current = initialDescription.current;
          setShowDescriptionModal(false);
        }}
      />
    </ScreenWrapper>
  );
};

export default AddUsdtWallet;

const styles = StyleSheet.create({
  descriptionContainer: {
    width: '100%',
    height: hp(30),
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(5),
  },
  inputFieldWrapper: {
    borderRadius: 10,
    marginRight: wp(10),
  },
  fieldsContainer: {
    marginTop: hp(30),
    marginBottom: hp(50),
    gap: hp(10),
  },
  descriptionInput: {
    marginBottom: hp(10),
  },
  footer: {
    flexDirection: 'row',
    marginHorizontal: 10,
    marginVertical: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noteContainer: {
    marginHorizontal: wp(10),
    marginBottom: hp(10),
  },
  noteTitle: {
    marginBottom: hp(5),
  },
  link: {
    textDecorationLine: 'underline',
  },
});
