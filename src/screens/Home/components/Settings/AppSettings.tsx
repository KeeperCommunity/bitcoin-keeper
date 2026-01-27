import { Box, useColorMode } from 'native-base';
import React, { useContext, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet } from 'react-native';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import SettingCard from './Component/SettingCard';
import { useSettingKeeper } from 'src/hooks/useSettingKeeper';
import { hp, wp } from 'src/constants/responsive';
import Text from 'src/components/KeeperText';
import CheckBoxActive from 'src/assets/images/checkbox_active.svg';
import CheckBoxInactive from 'src/assets/images/checkbox_inactive.svg';
import KeeperModal from 'src/components/KeeperModal';
import Buttons from 'src/components/Buttons';
import { NetworkType } from 'src/services/wallets/enums';
import { useAppSelector } from 'src/store/hooks';
import { useDispatch } from 'react-redux';
import { changeBitcoinNetwork } from 'src/store/sagaActions/settings';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import useToastMessage from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/tick_icon.svg';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import * as Keychain from 'react-native-keychain';
import * as SecureStore from 'src/storage/secure-store';
import { deleteBackupFile, restoreBackupKey } from 'src/services/backupfile';
import RNFS from 'react-native-fs';

const SettingsApp = () => {
  const { colorMode } = useColorMode();
  const dispatch = useDispatch();
  const { settings, common } = useContext(LocalizationContext).translations;
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const { showToast } = useToastMessage();
  const [networkModeModal, setNetworkModeModal] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(bitcoinNetworkType);
  const [loading, setLoading] = useState(false);
  const { allAccounts } = useAppSelector((state) => state.account);

  let appSetting = [
    ...useSettingKeeper().appSetting,
    {
      title: settings.networkModeTitle,
      description: settings.networkModeSubTitle,
      icon: <ThemedSvg name={'NetworkIcon'} />,
      onPress: () => setNetworkModeModal(true),
      isDiamond: false,
    },
  ];

  const NETWORK_OPTIONS = [
    {
      label: NetworkType.MAINNET.charAt(0) + NetworkType.MAINNET.slice(1).toLowerCase(),
      onPress: () => setSelectedNetwork(NetworkType.MAINNET),
      id: NetworkType.MAINNET,
    },
    {
      label: NetworkType.TESTNET.charAt(0) + NetworkType.TESTNET.slice(1).toLowerCase(),
      onPress: () => setSelectedNetwork(NetworkType.TESTNET),
      id: NetworkType.TESTNET,
    },
  ];

  const confirmNetworkMode = () => {
    Alert.alert('', settings.networkModeChangeConfirmationTitle, [
      {
        text: common.cancel,
        onPress: () => {
          setNetworkModeModal(false);
          setSelectedNetwork(bitcoinNetworkType);
        },
        style: 'cancel',
      },
      {
        text: common.ok,
        onPress: () => {
          setLoading(true);
          setNetworkModeModal(false);
          setSelectedNetwork(selectedNetwork);
          dispatch(
            changeBitcoinNetwork(selectedNetwork, (success) => {
              setLoading(false);
              if (success) showToast('Bitcoin network updated successfully', <TickIcon />);
              else
                showToast('Failed to update Bitcoin network. Please try again', <ToastErrorIcon />);
            })
          );
        },
      },
    ]);
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <Box style={styles.container} backgroundColor={`${colorMode}.primaryBackground`}>
        <Box style={styles.header}>
          <WalletHeader title={settings.appSetting} />
        </Box>

        <SettingCard
          subtitleColor={`${colorMode}.balanceText`}
          backgroundColor={`${colorMode}.textInputBackground`}
          borderColor={`${colorMode}.separator`}
          items={appSetting}
        />

        <KeeperModal
          visible={networkModeModal}
          closeOnOverlayClick={false}
          close={() => {
            setNetworkModeModal(false);
            setSelectedNetwork(bitcoinNetworkType);
          }}
          title={settings.networkModeTitle}
          subTitleWidth={wp(240)}
          subTitle={settings.networkModeModalSubTitle}
          modalBackground={`${colorMode}.modalWhiteBackground`}
          textColor={`${colorMode}.textGreen`}
          subTitleColor={`${colorMode}.modalSubtitleBlack`}
          Content={() => (
            <Box>
              <Box style={styles.optionsWrapper}>
                {NETWORK_OPTIONS.map((option, index) => (
                  <OptionItem
                    key={index}
                    option={option}
                    colorMode={colorMode}
                    active={option.id === selectedNetwork}
                  />
                ))}
              </Box>
              <Box marginTop={hp(20)}>
                <Buttons
                  primaryText={settings.networkChangePrimaryCTA}
                  fullWidth
                  primaryDisable={selectedNetwork === bitcoinNetworkType}
                  primaryCallback={() => confirmNetworkMode()}
                />
              </Box>
            </Box>
          )}
        />
        {/* // ! Remove this later | Only for reproducing condition for tester  */}
        {Platform.OS == 'ios' && (
          <>
            <Buttons
              primaryText="Clear All Passcode"
              primaryCallback={async () => {
                let count = 0;
                for (const acc of allAccounts) {
                  const service = acc.accountIdentifier == '' ? undefined : acc.accountIdentifier;
                  const res = await Keychain.resetGenericPassword({ service: service });
                  count++;
                  console.log('🚀 ~ Delete keychain for :', service, res);
                }
                showToast(`Clear passcode for ${count} accounts`);
              }}
              secondaryText="Has Passcode"
              secondaryCallback={async () => {
                const hasCreds = await SecureStore.hasPin();
                console.log('🚀 ~ attemptLogin ~ hasCreds:', hasCreds);
                showToast(`Passcode is set: ${hasCreds}`);
              }}
            />
            <Buttons
              primaryText="Delete backup file"
              primaryCallback={async () => {
                const res = await deleteBackupFile('backup.txt');
                showToast(`Backup file deleted: ${res}`);
              }}
              secondaryText="Try Restore"
              secondaryCallback={async () => {
                const res = await restoreBackupKey(false);
                showToast(`Restore status: ${res}`);
              }}
            />
            {/*  */}
            <Buttons
              primaryText="Create corrupted file"
              primaryCallback={async () => {
                const FILE_NAME = 'backup.txt';
                const filePath = `${RNFS.DocumentDirectoryPath}/${FILE_NAME}`;
                const gibberishData =
                  "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised in the 1960s with the release of Letraset sheets containing Lore";
                await RNFS.writeFile(filePath, gibberishData, 'utf8');
              }}
            />
          </>
        )}
        {/* // ! Remove this later | Only for reproducing condition for tester  */}
        <ActivityIndicatorView visible={loading} showLoader />
      </Box>
    </ScreenWrapper>
  );
};

export default SettingsApp;

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    marginBottom: 18,
  },
  optionCTR: {
    flexDirection: 'row',
    paddingHorizontal: wp(16),
    paddingVertical: hp(19),
    alignItems: 'center',
    gap: wp(20),
    borderRadius: 12,
    borderWidth: 1,
  },
  optionsWrapper: {
    gap: hp(10),
  },
});

const OptionItem = ({ option, colorMode, active }) => (
  <Pressable onPress={option.onPress}>
    <Box
      style={styles.optionCTR}
      backgroundColor={`${colorMode}.boxSecondaryBackground`}
      borderColor={`${colorMode}.greyBorder`}
    >
      {active ? (
        <CheckBoxActive width={wp(18)} height={wp(18)} />
      ) : (
        <CheckBoxInactive width={wp(18)} height={wp(18)} />
      )}
      <Text fontSize={14} medium>
        {option.label}
      </Text>
    </Box>
  </Pressable>
);
