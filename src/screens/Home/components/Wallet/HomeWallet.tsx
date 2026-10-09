import { Box, useColorMode, View } from '@gluestack-ui/themed-native-base';
import React, { useContext, useState, useEffect } from 'react';
import { FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import WalletCard from './WalletCard';
import Colors from 'src/theme/Colors';
import useWallets from 'src/hooks/useWallets';
import useVault from 'src/hooks/useVault';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { Vault } from 'src/services/wallets/interfaces/vault';

import useWalletAsset from 'src/hooks/useWalletAsset';
import { EntityKind, VisibilityType } from 'src/services/wallets/enums';
import { useNavigation } from '@react-navigation/native';
import KeeperModal from 'src/components/KeeperModal';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';

import NewWalletIcon from 'src/assets/images/wallet-white-small.svg';
import ImportWalletIcon from 'src/assets/images/import.svg';
import CollaborativeWalletIcon from 'src/assets/images/collaborative_vault_white.svg';

import { useAppSelector } from 'src/store/hooks';
import { resetCollaborativeSession } from 'src/store/reducers/vaults';
import { useDispatch } from 'react-redux';
import { useWalletRefresh } from 'src/hooks/useWalletRefresh';
import { RefreshControl } from 'react-native';
import { ELECTRUM_CLIENT } from 'src/services/electrum/client';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { useUSDTWallets } from 'src/hooks/useUSDTWallets';
import {
  getAvailableBalanceUSDTWallet,
  USDTWallet,
} from 'src/services/wallets/factories/USDTWalletFactory';
import useToastMessage from 'src/hooks/useToastMessage';
import Fab from 'src/components/Fab';
import AddIcon from 'src/assets/images/add_white.svg';
import { useUTXOSpendability } from 'src/hooks/useUTXOSpendability';
import { clearDustToast } from 'src/store/reducers/utxos';

function WalletCardItem({
  item,
  getWalletCardGradient,
  getWalletTags,
  isShowAmount,
  setIsShowAmount,
  navigation,
}: {
  item: Wallet | Vault | USDTWallet;
  getWalletCardGradient: (w: any) => string[];
  getWalletTags: (w: any) => any;
  isShowAmount: boolean;
  setIsShowAmount: () => void;
  navigation: any;
}) {
  const { hasDoNotSpendUTXOs } = useUTXOSpendability(
    item.entityKind === EntityKind.USDT_WALLET ? null : (item as Wallet | Vault)
  );

  const handleWalletPress = () => {
    if (item.entityKind === EntityKind.VAULT) {
      navigation.navigate('VaultDetails', { vaultId: item.id, autoRefresh: true });
    } else if (item.entityKind === EntityKind.USDT_WALLET) {
      navigation.navigate('usdtDetails', { usdtWalletId: item.id });
    } else {
      navigation.navigate('WalletDetails', { walletId: item.id, autoRefresh: true });
    }
  };

  return (
    <TouchableOpacity onPress={handleWalletPress} testID={`wallet_item_${item.id}`}>
      <WalletCard
        backgroundColor={getWalletCardGradient(item)}
        hexagonBackgroundColor={
          item.entityKind === EntityKind.USDT_WALLET ? Colors.aqualightMarine : Colors.CyanGreen
        }
        iconWidth={42}
        iconHeight={38}
        title={item.presentationData.name}
        tags={getWalletTags(item)}
        totalBalance={
          item.entityKind === EntityKind.USDT_WALLET
            ? getAvailableBalanceUSDTWallet(item as USDTWallet)
            : item.specs.balances.confirmed + item.specs.balances.unconfirmed
        }
        description={item.presentationData.description}
        wallet={item}
        isShowAmount={isShowAmount}
        setIsShowAmount={setIsShowAmount}
        showDot={hasDoNotSpendUTXOs}
      />
    </TouchableOpacity>
  );
}

const HomeWallet = () => {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { wallets } = useWallets({ getAll: true });
  const { translations } = useContext(LocalizationContext);
  const { wallet: walletText, home, common } = translations;
  const { getWalletCardGradient, getWalletTags } = useWalletAsset();
  const { allVaults } = useVault({
    includeArchived: false,
    getFirst: true,
    getHiddenWallets: false,
  });
  const { usdtWallets } = useUSDTWallets();
  const { collaborativeSession } = useAppSelector((state) => state.vault);

  const dispatch = useDispatch();
  const [showAddWalletModal, setShowAddWalletModal] = useState(false);
  const [collabSessionExistsModalVisible, setCollabSessionExistsModalVisible] = useState(false);
  const [navigateAfterSessionReset, setNavigateAfterSessionReset] = useState(false);
  const { refreshing: pullRefresh, autoRefresh } = useWalletRefresh();
  const { walletSyncing } = useAppSelector((state) => state.wallet);
  const syncing =
    ELECTRUM_CLIENT.isClientConnected &&
    Object.values(walletSyncing).some((isSyncing) => isSyncing);

  const nonHiddenWallets = wallets.filter(
    (wallet) => wallet.presentationData.visibility !== VisibilityType.HIDDEN
  );
  const allWallets: (Wallet | Vault | USDTWallet)[] = [
    ...nonHiddenWallets,
    ...allVaults,
    ...usdtWallets,
  ].filter((item) => item !== null);
  const [isShowAmount, setIsShowAmount] = useState(false);
  const { showToast } = useToastMessage();

  const pendingDustToast = useAppSelector((state: any) => state.utxos.pendingDustToast);

  useEffect(() => {
    if (pendingDustToast) {
      showToast('Potential dust payment found');
      dispatch(clearDustToast());
    }
  }, [pendingDustToast]);

  useEffect(() => {
    if (navigateAfterSessionReset && Object.keys(collaborativeSession.signers).length === 0) {
      setNavigateAfterSessionReset(false);
      navigation.navigate('SetupCollaborativeWallet');
    }
  }, [navigateAfterSessionReset, collaborativeSession.signers, navigation]);

  const resetAndStartCollaborativeWallet = () => {
    dispatch(resetCollaborativeSession());
    setNavigateAfterSessionReset(true);
  };

  const handleCollaborativeWalletCreation = () => {
    setShowAddWalletModal(false);
    if (Object.keys(collaborativeSession.signers).length > 0) {
      setCollabSessionExistsModalVisible(true);
    } else {
      resetAndStartCollaborativeWallet();
    }
  };

  const pullDownRefresh = () => {
    autoRefresh();
  };

  const CREATE_WALLET_OPTIONS = [
    {
      title: walletText.createWallet,
      subtitle: walletText.createWalletDesc,
      icon: <NewWalletIcon />,
      onPress: () => {
        setShowAddWalletModal(false);
        navigation.navigate('AddNewWallet');
      },
      id: 'newWallet',
    },
    {
      title: home.ImportWallet,
      subtitle: walletText.restoreExistingWallet,
      icon: <ImportWalletIcon />,
      onPress: () => {
        setShowAddWalletModal(false);
        navigation.navigate('VaultConfigurationCreation');
      },
      id: 'importWallet',
    },
    {
      title: common.collaborativeWallet,
      subtitle: walletText.walletWithFamily,
      icon: <CollaborativeWalletIcon />,
      onPress: handleCollaborativeWalletCreation,
      id: 'collaborativeWallet',
    },
  ];
  const renderWalletCard = ({ item }: { item: Wallet | Vault | USDTWallet }) => (
    <WalletCardItem
      item={item}
      getWalletCardGradient={getWalletCardGradient}
      getWalletTags={getWalletTags}
      isShowAmount={isShowAmount}
      setIsShowAmount={setIsShowAmount}
      navigation={navigation}
    />
  );

  return (
    <Box style={styles.walletContainer}>
      <ActivityIndicatorView visible={syncing} showLoader />
      <Fab
        icon={<AddIcon height={hp(22)} width={wp(22)} />}
        onPress={() => setShowAddWalletModal(true)}
      />
      <FlatList
        data={allWallets}
        renderItem={renderWalletCard}
        refreshControl={<RefreshControl onRefresh={pullDownRefresh} refreshing={pullRefresh} />}
        keyExtractor={(item, index) => `${item.id || index}`}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
      <KeeperModal
        visible={showAddWalletModal}
        title={walletText.addNewWallet}
        subTitle={walletText.createOrImportWallet}
        close={() => setShowAddWalletModal(false)}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        showCloseIcon
        Content={() => (
          <Box style={styles.addWalletOptionsList}>
            {CREATE_WALLET_OPTIONS.map((option, index) => (
              <OptionItem key={index} option={option} colorMode={colorMode} />
            ))}
          </Box>
        )}
      />
      <KeeperModal
        visible={collabSessionExistsModalVisible}
        close={() => setCollabSessionExistsModalVisible(false)}
        title={walletText.collaborativeSessionExists}
        subTitle={walletText.collaborativeSessionExistsDesc}
        buttonText={common.continueSession}
        secondaryButtonText={common.startNew}
        secondaryCallback={() => {
          setCollabSessionExistsModalVisible(false);
          resetAndStartCollaborativeWallet();
        }}
        buttonCallback={() => {
          setCollabSessionExistsModalVisible(false);
          navigation.navigate('SetupCollaborativeWallet');
        }}
      />
    </Box>
  );
};

const OptionItem = ({ option, colorMode }) => {
  return (
    <TouchableOpacity onPress={option.onPress}>
      <Box
        style={styles.optionCTR}
        backgroundColor={`${colorMode}.boxSecondaryBackground`}
        borderColor={`${colorMode}.separator`}
      >
        <CircleIconWrapper
          width={wp(40)}
          icon={option.icon}
          backgroundColor={`${colorMode}.pantoneGreen`}
        />
        <Box>
          <Text
            color={`${colorMode}.secondaryText`}
            fontSize={15}
            medium
            style={styles.optionTitle}
          >
            {option.title}
          </Text>
          <Text color={`${colorMode}.secondaryText`} fontSize={12}>
            {option.subtitle}
          </Text>
        </Box>
      </Box>
    </TouchableOpacity>
  );
};

export default HomeWallet;

const styles = StyleSheet.create({
  walletContainer: {
    gap: 15,
  },
  addWalletOptionsList: {
    gap: wp(15),
    marginBottom: hp(10),
  },
  optionTitle: {
    marginBottom: hp(5),
  },
  optionCTR: {
    flexDirection: 'row',
    paddingHorizontal: wp(15),
    paddingVertical: hp(22),
    alignItems: 'center',
    gap: wp(16),
    borderRadius: 12,
    borderWidth: 1,
  },
});
