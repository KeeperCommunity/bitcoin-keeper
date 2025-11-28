import React, { useCallback, useState, useContext, useEffect, useRef } from 'react';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { Box, Pressable, ScrollView, useColorMode } from 'native-base';
import Buttons from 'src/components/Buttons';
import { NewWalletInfo } from 'src/store/sagas/wallets';
import {
  DerivationPurpose,
  MiniscriptTypes,
  VaultType,
  WalletType,
} from 'src/services/wallets/enums';
import { useDispatch } from 'react-redux';
import { addNewWallets } from 'src/store/sagaActions/wallets';
import { LocalizationContext } from 'src/context/Localization/LocContext';

import { useAppSelector } from 'src/store/hooks';
import useToastMessage from 'src/hooks/useToastMessage';
import { resetRealyWalletState } from 'src/store/reducers/bhr';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import KeeperModal from 'src/components/KeeperModal';
import { hp, wp } from 'src/constants/responsive';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { StyleSheet } from 'react-native';
import { resetWalletStateFlags } from 'src/store/reducers/wallets';
import Text from 'src/components/KeeperText';
import ScreenWrapper from 'src/components/ScreenWrapper';
import KeeperTextInput from 'src/components/KeeperTextInput';
import SettingsIcon from 'src/assets/images/settings_grey.svg';
import EditIcon from 'src/assets/images/edit_brown.svg';
import EditIconWhite from 'src/assets/images/edit_white.svg';
import WalletVaultCreationModal from 'src/components/Modal/WalletVaultCreationModal';
import useWallets from 'src/hooks/useWallets';
import { ConciergeTag } from 'src/models/enums/ConciergeTag';
import VaultMigrationController from '../Vault/VaultMigrationController';
import useVault from 'src/hooks/useVault';
import CardPill from 'src/components/CardPill';
import { Vault } from 'src/services/wallets/interfaces/vault';
import VaultIcon from 'src/assets/images/vault_icon.svg';
import DerivationPathModalContent from '../EnterWalletDetailScreen/DerivationPathModal';
import useWalletAsset from 'src/hooks/useWalletAsset';
import WalletHeader from 'src/components/WalletHeader';
import SignerCard from '../AddSigner/SignerCard';
import { getKeyUID } from 'src/utils/utilities';
import { getSignerDescription, getSignerNameFromType } from 'src/hardware';
import { SDIcons } from '../Vault/SigningDeviceIcons';
import useSigners from 'src/hooks/useSigners';
import useIsSmallDevices from 'src/hooks/useSmallDevices';
import ConciergeNeedHelp from 'src/assets/images/conciergeNeedHelp.svg';
import { CTACardDotted } from 'src/components/CTACardDotted';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import HexagonIcon from 'src/components/HexagonIcon';
import { setShowTipModal } from 'src/store/reducers/settings';
import config from 'src/utils/service-utilities/config';

// eslint-disable-next-line react/prop-types
function ConfirmWalletDetails({ route }) {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();
  const { wallets } = useWallets({ getAll: true });
  const { translations } = useContext(LocalizationContext);
  const { wallet: walletText, choosePlan, common, importWallet, vault: vaultText } = translations;
  const { vaultId } = route.params || {};
  const { activeVault } = useVault({ vaultId });
  const [walletName, setWalletName] = useState(
    activeVault ? activeVault.presentationData.name : route.params?.name
  );
  const { getWalletTags } = useWalletAsset();
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);

  const isHotWallet = route.params?.isHotWallet;
  const [walletCreatedModal, setWalletCreatedModal] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  const { relayWalletUpdateLoading, relayWalletUpdate, relayWalletError, realyWalletErrorMessage } =
    useAppSelector((state) => state.bhr);
  const { hasNewWalletsGenerationFailed, err } = useAppSelector((state) => state.wallet);
  const [visibleModal, setVisibleModal] = useState(false);

  // TODO: purpose and path only used for hot wallet creation for now, should update when adding support for Taproot for vaults
  const [purpose, setPurpose] = useState(DerivationPurpose.BIP84);
  const [path, setPath] = useState(
    route.params?.path
      ? route.params?.path
      : WalletUtilities.getDerivationPath(false, bitcoinNetworkType, 0, purpose)
  );

  const [advancedSettingsVisible, setAdvancedSettingsVisible] = useState(false);

  const descriptionInputRef = useRef(activeVault ? activeVault.presentationData.description : '');
  const initialDescription = useRef(descriptionInputRef.current);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const onDescriptionChange = (value) => {
    descriptionInputRef.current = value;
  };
  const [vaultCreating, setCreating] = useState(false);
  const [generatedVaultId, setGeneratedVaultId] = useState('');
  const { allVaults } = useVault({});
  const newVault = allVaults.filter((v) => v.id === generatedVaultId)[0];
  const [vaultCreatedModalVisible, setVaultCreatedModalVisible] = useState(false);
  const vaultType = route.params.vaultType;
  const isSmallDevice = useIsSmallDevices();
  const green_modal_text_color = ThemedColor({ name: 'green_modal_text_color' });
  const green_modal_background = ThemedColor({ name: 'green_modal_background' });
  const green_modal_button_background = ThemedColor({ name: 'green_modal_button_background' });
  const green_modal_button_text = ThemedColor({ name: 'green_modal_button_text' });
  const green_modal_sec_button_text = ThemedColor({ name: 'green_modal_sec_button_text' });
  const HexagonIconColor = ThemedColor({ name: 'HexagonIcon' });
  const [viewWalletLoader, setViewWalletLoader] = useState(false);

  const { signers } = useSigners();

  // TODO: Update to be an array
  const inheritanceSigners = route.params.reservedKeys
    ? route.params.reservedKeys.map((reserveKey) =>
        signers.find((s) => getKeyUID(s) === getKeyUID(reserveKey.key))
      )
    : [];

  const emergencySigners = route.params.emergencyKeys
    ? route.params.emergencyKeys.map((emergencyKey) =>
        signers.find((s) => getKeyUID(s) === getKeyUID(emergencyKey.key))
      )
    : [];

  const createNewHotWallet = useCallback(() => {
    // Note: only caters to new wallets(imported wallets currently have a different flow)
    setWalletLoading(true);
    const newWallet: NewWalletInfo = {
      walletType: WalletType.DEFAULT,
      walletDetails: {
        name: walletName,
        description: descriptionInputRef.current,
        derivationPath: path,
        instanceNum: route.params.hotWalletInstanceNum,
      },
    };
    dispatch(addNewWallets([newWallet]));
  }, [walletName, descriptionInputRef, path, purpose]);

  useEffect(() => {
    if (relayWalletUpdate) {
      dispatch(resetRealyWalletState());
      setWalletLoading(false);
      setWalletCreatedModal(true);
    }
    if (relayWalletError) {
      showToast(realyWalletErrorMessage || walletText.walletCreationFailed, <ToastErrorIcon />);
      setWalletLoading(false);
      dispatch(resetRealyWalletState());
    }
  }, [relayWalletUpdate, relayWalletError]);

  function FailedModalContent() {
    return (
      <Box w="100%">
        <Buttons
          primaryCallback={() => {
            // navigation.replace('ChoosePlan');
            dispatch(resetWalletStateFlags());
          }}
          primaryText={choosePlan.viewSubscription}
          activeOpacity={0.5}
          // secondaryCallback={() => {
          //   dispatch(resetWalletStateFlags());
          //   navigation.replace('ChoosePlan');
          // }}
          // secondaryText={common.cancel}
          paddingHorizontal={wp(30)}
        />
      </Box>
    );
  }

  function TapRootContent() {
    const { colorMode } = useColorMode();
    const { translations } = useContext(LocalizationContext);
    const { wallet: walletText } = translations;
    return (
      <Box>
        <Box style={styles.tapRootContainer}>
          <Box style={styles.tapRootIconWrapper}>
            <ThemedSvg name={'wallet_Recovery_icon'} />
          </Box>
          <Box style={styles.tapRootContentWrapper}>
            <Text color={green_modal_text_color} style={styles.tapRootTitleText}>
              {walletText.walletRecovery}
            </Text>
            <Text color={`${colorMode}.headerWhite`} style={styles.tapRootDescText}>
              {walletText.walletRecoveryDesc}
            </Text>
          </Box>
        </Box>
        <Box style={styles.tapRootContainer}>
          <Box style={styles.tapRootIconWrapper}>
            <ThemedSvg name={'efficiency_icon'} />
          </Box>
          <Box style={styles.tapRootContentWrapper}>
            <Text color={green_modal_text_color} style={styles.tapRootTitleText}>
              {walletText.compatibility}
            </Text>
            <Text color={green_modal_text_color} style={styles.tapRootDescText}>
              {walletText.compatibilityDesc}
            </Text>
          </Box>
        </Box>
        <Box style={styles.tapRootContainer}>
          <Box style={styles.tapRootIconWrapper}>
            <ThemedSvg name={'security_iocn'} />
          </Box>
          <Box style={styles.tapRootContentWrapper}>
            <Text color={green_modal_text_color} style={styles.tapRootTitleText}>
              {walletText.securityStructure}
            </Text>
            <Text color={green_modal_text_color} style={styles.tapRootDescText}>
              {walletText.securityStructureDesc}
            </Text>
          </Box>
        </Box>
        <Box style={styles.tapRootContainer}>
          <Box style={styles.tapRootIconWrapper}>
            <ThemedSvg name={'organization_icon'} />
          </Box>
          <Box style={styles.tapRootContentWrapper}>
            <Text color={green_modal_text_color} style={styles.tapRootTitleText}>
              {walletText.Organization}
            </Text>
            <Text color={green_modal_text_color} style={styles.tapRootDescText}>
              {walletText.OrganizationDesc}
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  function VaultCreatedModalContent(vault: Vault) {
    const tags = getWalletTags(vault).map((tag, index) => ({
      ...tag,
      key: `tag-${index}-${tag.tag}`,
    }));
    const { translations } = useContext(LocalizationContext);
    const { wallet: walletText } = translations;

    return (
      <Box>
        <Box
          backgroundColor={`${colorMode}.seashellWhite`}
          style={styles.walletVaultInfoContainer}
          borderColor={`${colorMode}.separator`}
          borderWidth={1}
        >
          <Box style={styles.walletVaultInfoWrapper}>
            <Box style={styles.iconWrapper}>
              <HexagonIcon
                width={44}
                height={38}
                backgroundColor={HexagonIconColor}
                icon={<VaultIcon />}
              />
            </Box>
            <Box marginTop={hp(4)}>
              {vault.presentationData.description ? (
                <Text fontSize={12} color={`${colorMode}.secondaryText`}>
                  {vault.presentationData.description}
                </Text>
              ) : null}
              <Text color={`${colorMode}.greenText`} medium style={styles.titleText}>
                {vault.presentationData.name}
              </Text>
            </Box>
          </Box>
          <Box style={styles.pillsContainer}>
            {tags?.map(({ tag, color }) => {
              return (
                <>
                  <CardPill key={tag} heading={tag} backgroundColor={color} />
                </>
              );
            })}
          </Box>
        </Box>
        <Box style={{ marginBottom: hp(10) }}>
          <Text fontSize={13} style={{ marginBottom: hp(2) }}>
            {walletText.backupyourwallet}
          </Text>
          <Text fontSize={13} style={{ marginBottom: hp(2) }}>
            {walletText.recoverYourWallet}
          </Text>
          <Text fontSize={13} style={{ marginBottom: hp(2) }}>
            {walletText.doThisLater}
          </Text>
        </Box>
        <CTACardDotted
          title={walletText.backupFile}
          subTitle={walletText.keepItPrivate}
          isActive={true}
          onPress={viewVaultConfigFile}
          width={'100%'}
        />
      </Box>
    );
  }

  function SingleSigWallet(vault: Vault) {
    const tags = getWalletTags(vault).map((tag, index) => ({
      ...tag,
      key: `tag-${index}-${tag.tag}`,
    }));

    return (
      <Box>
        <Box
          backgroundColor={`${colorMode}.seashellWhite`}
          style={styles.walletVaultInfoContainer}
          borderColor={`${colorMode}.separator`}
          borderWidth={1}
        >
          <Box style={styles.walletVaultInfoWrapper}>
            <Box style={styles.iconWrapper}>
              <HexagonIcon
                width={44}
                height={38}
                backgroundColor={HexagonIconColor}
                icon={<VaultIcon />}
              />
            </Box>
            <Box marginTop={hp(4)}>
              {vault.presentationData.description ? (
                <Text fontSize={12} color={`${colorMode}.secondaryText`}>
                  {vault.presentationData.description}
                </Text>
              ) : null}
              <Text color={`${colorMode}.greenText`} medium style={styles.titleText}>
                {vault.presentationData.name}
              </Text>
            </Box>
          </Box>

          <Box style={styles.singleSigpills}>
            {tags?.map(({ tag, color }) => {
              return <CardPill key={tag} heading={tag} backgroundColor={color} />;
            })}
          </Box>
        </Box>
      </Box>
    );
  }

  const viewVault = () => {
    setViewWalletLoader(true);
    setTimeout(() => {
      const navigationState = {
        index: 1,
        routes: [
          { name: 'Home' },
          {
            name: 'VaultDetails',
            params: {
              vaultId: generatedVaultId,
              vaultTransferSuccessful: true,
              autoRefresh: true,
              hardRefresh: true,
            },
          },
        ],
      };
      navigation.dispatch(CommonActions.reset(navigationState));
      if (vaultType !== VaultType.SINGE_SIG) {
        dispatch(setShowTipModal({ status: true, address: config.ADDRESS.multiSigCreate }));
      } 
    }, 50);
  };

  const viewVaultConfigFile = () => {
    setVaultCreatedModalVisible(false);
    const navigationState = {
      index: 1,
      routes: [
        { name: 'Home' },
        {
          name: 'VaultDetails',
          params: {
            vaultId: generatedVaultId,
            vaultTransferSuccessful: true,
            autoRefresh: true,
            hardRefresh: true,
          },
        },
        {
          name: 'VaultSettings',
          params: {
            vaultId: generatedVaultId,
            exportConfig: true,
          },
        },
      ],
    };
    setTimeout(() => {
      navigation.dispatch(CommonActions.reset(navigationState));
    }, 300);
  };

  return (
    <ScreenWrapper barStyle="dark-content" backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={walletText.confirmWalletDetail}
        rightComponent={
          isHotWallet && (
            <Pressable
              style={styles.advancedContainer}
              onPress={() => setAdvancedSettingsVisible(true)}
            >
              <SettingsIcon />
            </Pressable>
          )
        }
      />

      <ScrollView
        contentContainerStyle={{ flex: 1, justifyContent: 'space-between' }}
        showsVerticalScrollIndicator={false}
      >
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
        <Box flexDirection={'row'}>
          <Text fontSize={14} medium style={{ flex: 1 }}>
            {walletText.yourWalletKey}
            {route.params.selectedSigners.length > 1 || vaultType === VaultType.MINISCRIPT
              ? 's'
              : ''}
          </Text>
          <Pressable
            style={styles.editKeysContainer}
            onPress={() => {
              if (route.params.isAddInheritanceKey) {
                navigation.goBack();
              }
              if (route.params.isAddEmercencyKey) {
                navigation.goBack();
              }
              navigation.goBack();
            }}
          >
            {isDarkMode ? <EditIconWhite /> : <EditIcon />}

            <Text
              color={isDarkMode ? `${colorMode}.secondaryCreamWhite` : `${colorMode}.BrownNeedHelp`}
              semiBold
              fontSize={13}
            >
              {common.edit}
            </Text>
          </Pressable>
        </Box>
        <ScrollView showsVerticalScrollIndicator={false}>
          <Box
            flexDirection={'row'}
            flex={1}
            marginTop={isSmallDevice ? hp(4) : hp(6)}
            flexWrap={'wrap'}
          >
            {route.params.selectedSigners.map((signer) => {
              return (
                <SignerCard
                  key={getKeyUID(signer)}
                  name={getSignerNameFromType(signer.type, signer.isMock, signer.isAMF)}
                  description={getSignerDescription(signer)}
                  // customStyle={styles.signerCard}
                  icon={SDIcons({ type: signer.type }).Icon}
                  image={signer?.extraData?.thumbnailPath}
                  showSelection={false}
                  isFullText
                  colorVarient="green"
                  colorMode={colorMode}
                />
              );
            })}
            {inheritanceSigners.map((inheritanceSigner) => (
              <SignerCard
                key={getKeyUID(inheritanceSigner)}
                name={getSignerNameFromType(
                  inheritanceSigner.type,
                  inheritanceSigner.isMock,
                  false
                )}
                description={getSignerDescription(inheritanceSigner)}
                icon={SDIcons({ type: inheritanceSigner.type }).Icon}
                image={inheritanceSigner?.extraData?.thumbnailPath}
                showSelection={false}
                isFullText
                colorVarient="green"
                colorMode={colorMode}
                badgeText="Inheritance Key"
              />
            ))}
            {emergencySigners.map((emergencySigner) => (
              <SignerCard
                key={getKeyUID(emergencySigner)}
                name={getSignerNameFromType(emergencySigner.type, emergencySigner.isMock, false)}
                description={getSignerDescription(emergencySigner)}
                icon={SDIcons({ type: emergencySigner.type }).Icon}
                image={emergencySigner?.extraData?.thumbnailPath}
                showSelection={false}
                isFullText
                colorVarient="green"
                colorMode={colorMode}
                badgeText="Emergency Key"
              />
            ))}
          </Box>
        </ScrollView>
      </ScrollView>
      <Box style={styles.footer}>
        <Buttons
          primaryText={walletText.createYourWallet}
          primaryCallback={
            isHotWallet
              ? createNewHotWallet
              : () => {
                  setCreating(true);
                }
          }
          primaryDisable={!walletName}
          primaryLoading={vaultCreating || walletLoading || relayWalletUpdateLoading}
          fullWidth
        />
      </Box>

      <VaultMigrationController
        vaultCreating={vaultCreating}
        vaultKeys={route.params.vaultKeys}
        scheme={route.params.scheme}
        name={walletName}
        description={descriptionInputRef.current}
        vaultId={vaultId}
        setGeneratedVaultId={setGeneratedVaultId}
        setCreating={setCreating}
        vaultType={vaultType}
        inheritanceKeys={route.params.reservedKeys ?? []}
        emergencyKeys={route.params.emergencyKeys ?? []}
        currentBlockHeight={route.params.currentBlockHeight}
        initialTimelockDuration={route.params.initialTimelockDuration ?? 0}
        miniscriptTypes={[
          ...(route.params.hasInitialTimelock ? [MiniscriptTypes.TIMELOCKED] : []),
          ...(route.params.isAddInheritanceKey ? [MiniscriptTypes.INHERITANCE] : []),
          ...(route.params.isAddEmergencyKey ? [MiniscriptTypes.EMERGENCY] : []),
        ]}
        setVaultCreatedModalVisible={setVaultCreatedModalVisible}
      />
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
      <KeeperModal
        visible={advancedSettingsVisible}
        close={() => setAdvancedSettingsVisible(false)}
        title={importWallet.derivationPath}
        subTitle={walletText.changeOrUpdatePurpose}
        subTitleWidth={wp(240)}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        showCloseIcon={false}
        learnMoreButton={true}
        learnMoreButtonPressed={() => {
          setVisibleModal(true);
        }}
        Content={() => (
          <DerivationPathModalContent
            initialPath={path}
            initialPurpose={purpose}
            closeModal={() => setAdvancedSettingsVisible(false)}
            setSelectedPath={setPath}
            setSelectedPurpose={setPurpose}
          />
        )}
      />
      <KeeperModal
        dismissible
        close={() => {}}
        visible={hasNewWalletsGenerationFailed}
        subTitle={err}
        title={common.failed}
        Content={FailedModalContent}
        buttonText=""
        buttonCallback={() => {
          // setInitiating(true)
        }}
        subTitleColor={`${colorMode}.secondaryText`}
        subTitleWidth={wp(210)}
        showCloseIcon={false}
      />
      <KeeperModal
        dismissible
        close={() => {}}
        visible={vaultCreatedModalVisible}
        title={walletText.WalletCreated}
        subTitle={walletText.walletCreatedSuccessfullyDesc}
        Content={
          vaultType === VaultType.SINGE_SIG
            ? () => SingleSigWallet(newVault)
            : () => VaultCreatedModalContent(newVault)
        }
        buttonText={walletText.ViewWallet}
        buttonCallback={viewVault}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        subTitleWidth={wp(280)}
        showCloseIcon={false}
        loading={viewWalletLoader}
      />
      <WalletVaultCreationModal
        visible={walletCreatedModal}
        title={walletText.WalletCreated}
        subTitle={walletText.walletCreatedSuccessfullyDesc}
        buttonText={walletText.ViewWallet}
        descriptionMessage={walletText.recoveryKeyAsBackup}
        buttonCallback={() => {
          setViewWalletLoader(true);
          setTimeout(() => {
            navigation.dispatch(
              CommonActions.reset({
                index: 1,
                routes: [
                  { name: 'Home' },
                  {
                    name: 'WalletDetails',
                    params: { autoRefresh: true, walletId: wallets[wallets.length - 1].id },
                  },
                ],
              })
            );
          }, 50);
        }}
        walletType={WalletType.DEFAULT}
        walletName={walletName}
        walletDescription={descriptionInputRef.current}
        loading={viewWalletLoader}
      />
      <KeeperModal
        visible={visibleModal}
        close={() => {
          setVisibleModal(false);
        }}
        title={walletText.derivationPath}
        subTitle={''}
        modalBackground={green_modal_background}
        textColor={green_modal_text_color}
        Content={() => <TapRootContent />}
        showCloseIcon={true}
        DarkCloseIcon
        buttonText={common.Okay}
        secondaryButtonText={common.needHelp}
        buttonTextColor={green_modal_button_text}
        buttonBackground={green_modal_button_background}
        secButtonTextColor={green_modal_sec_button_text}
        secondaryIcon={<ConciergeNeedHelp />}
        secondaryCallback={() => {
          setAdvancedSettingsVisible(false);
          setVisibleModal(false);
          navigation.dispatch(
            CommonActions.navigate({
              name: 'CreateTicket',
              params: {
                tags: [ConciergeTag.WALLET],
                screenName: 'add-wallet-advanced-settings',
              },
            })
          );
        }}
        buttonCallback={() => setVisibleModal(false)}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  inputFieldWrapper: {
    borderRadius: 10,
    marginRight: wp(10),
  },
  fieldsContainer: {
    marginTop: hp(30),
    marginBottom: hp(50),
    gap: hp(10),
  },
  footer: {
    flexDirection: 'row',
    marginHorizontal: 10,
    marginVertical: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  advancedContainer: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 22,
  },
  editKeysContainer: {
    flexDirection: 'row',
    gap: hp(5),
    alignItems: 'center',
    paddingHorizontal: wp(16),
  },
  tapRootContainer: {
    flexDirection: 'row',
    width: '100%',
  },
  tapRootIconWrapper: {
    width: '15%',
  },
  tapRootContentWrapper: {
    width: '85%',
    marginBottom: hp(20),
  },
  tapRootDescText: {
    fontSize: 13,
    letterSpacing: 0.65,
    padding: 1,
    marginBottom: 5,
  },
  tapRootTitleText: {
    fontSize: 14,
    fontWeight: 'bold',
    letterSpacing: 0.65,
    padding: 1,
  },
  descriptionContainer: {
    width: '100%',
    height: hp(30),
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(5),
  },
  descriptionInput: {
    marginBottom: hp(10),
  },
  walletVaultInfoContainer: {
    paddingHorizontal: 15,
    paddingVertical: 15,
    marginBottom: 20,
    borderRadius: 10,
    gap: 20,
  },
  pillsContainer: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: hp(3),
    width: '100%',
    flexWrap: 'wrap',
  },
  singleSigpills: {
    flexDirection: 'row',
    rowGap: 6,
    columnGap: 8,
    width: '100%',
    flexWrap: 'wrap',
  },
  walletVaultInfoWrapper: {
    flexDirection: 'row',
  },
  iconWrapper: {
    marginRight: 10,
  },
  titleText: {
    fontSize: 14,
  },
});

export default ConfirmWalletDetails;
