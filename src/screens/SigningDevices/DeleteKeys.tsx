import React, { useContext, useEffect, useState } from 'react';
import { Box, Pressable, useColorMode } from 'native-base';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import ScreenWrapper from 'src/components/ScreenWrapper';
import PasscodeVerifyModal from 'src/components/Modal/PasscodeVerify';
import KeeperModal from 'src/components/KeeperModal';
import useSigners from 'src/hooks/useSigners';
import { StyleSheet, ScrollView } from 'react-native';
import { SDIcons } from '../Vault/SigningDeviceIcons';
import Text from 'src/components/KeeperText';
import { getSignerDescription, getSignerNameFromType } from 'src/hardware';
import DeleteIcon from 'src/assets/images/delete_bin.svg';
import EmptyState from 'src/assets/images/empty-state-illustration.svg';
import ShowIcon from 'src/assets/images/show.svg';
import { useDispatch } from 'react-redux';
import { updateSignerDetails } from 'src/store/sagaActions/wallets';
import { Signer, Vault } from 'src/services/wallets/interfaces/vault';
import useVault from 'src/hooks/useVault';
import { CommonActions, useNavigation } from '@react-navigation/native';
import ActionCard from 'src/components/ActionCard';
import WalletVault from 'src/assets/images/wallet_vault.svg';
import { archiveSigningDevice, deleteSigningDevice } from 'src/store/sagaActions/vaults';
import useArchivedVault from 'src/hooks/useArchivedVaults';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { SignerType } from 'src/services/wallets/enums';
import { RECOVERY_KEY_SIGNER_NAME } from 'src/constants/defaultData';
import KeyCard from 'src/components/SigningDevices/KeyCard';
import HexagonIcon from 'src/components/HexagonIcon';
import Colors from 'src/theme/Colors';
import { useAppSelector } from 'src/store/hooks';
import { hideDeletingKeyModal, hideKeyDeletedSuccessModal } from 'src/store/reducers/bhr';
import BounceLoader from 'src/components/BounceLoader';
import TorAsset from 'src/components/Loader';
import moment from 'moment';
import { getKeyUID } from 'src/utils/utilities';
import WalletHeader from 'src/components/WalletHeader';
import ShowAllIcon from 'src/assets/images/show_wallet.svg';
import HideAllIcon from 'src/assets/images/hide_wallet.svg';
import HideWalletIcon from 'src/assets/images/hide_wallet.svg';
import useToastMessage from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/icon_tick.svg';
import usePlan from 'src/hooks/usePlan';

function DeleteKeys({ route }) {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText, error: errorText } = translations;
  const isUaiFlow: boolean = route.params?.isUaiFlow ?? false;
  const [confirmPassVisible, setConfirmPassVisible] = useState(isUaiFlow);
  const [confirmPassForSigner, setConfirmPassForSigner] = useState(isUaiFlow);
  const { signers } = useSigners('', false);
  const { showToast } = useToastMessage();
  const { isOnL2Above } = usePlan();

  const hiddenSigners = signers.filter(
    (signer) => signer.signerName !== RECOVERY_KEY_SIGNER_NAME && signer.hidden && !signer.archived
  );
  const allUnhideSigners = signers.filter(
    (signer) => signer.signerName !== RECOVERY_KEY_SIGNER_NAME && !signer.hidden && !signer.archived
  );

  const dispatch = useDispatch();
  const navigation = useNavigation();
  const [unhidingKeyUID, setUnhidingKeyUID] = useState('');
  const [multipleHidden, setMultipleHidden] = useState(false);
  const { allVaults } = useVault({ includeArchived: true });
  const { archivedVaults } = useArchivedVault();
  const [warningEnabled, setHideWarning] = useState(false);
  const [vaultsUsed, setVaultsUsed] = useState<Vault[]>();
  const [signerToDelete, setSignerToDelete] = useState<Signer>();
  const [deletedSigner, setDeletedSigner] = useState<Signer>();
  const deletingKeyModalVisible = useAppSelector((state) => state.bhr.deletingKeyModalVisible);
  const keyDeletedSuccessModalVisible = useAppSelector(
    (state) => state.bhr.keyDeletedSuccessModalVisible
  );

  enum PasswordMode {
    DEFAULT = 'DEFAULT',
    SHOWALL = 'SHOWALL',
  }
  const [showAll, setshowAll] = useState(false);
  const [showAllForced, setShowAllForced] = useState(false);
  const [passwordMode, setPasswordMode] = useState(PasswordMode.DEFAULT);

  const displaySigners = showAll ? [...allUnhideSigners, ...hiddenSigners] : allUnhideSigners;

  const onSuccess = () => {
    if (signerToDelete) {
      const involvedArchivedVaults = archivedVaults.filter((vault) =>
        vault.signers.find((s) => getKeyUID(s) === getKeyUID(signerToDelete))
      );
      if (involvedArchivedVaults.length) {
        dispatch(archiveSigningDevice([signerToDelete]));
      } else {
        dispatch(deleteSigningDevice([signerToDelete]));
      }
      setDeletedSigner(signerToDelete);
      setSignerToDelete(null);
    }
  };
  const onForceProceed = () => {
    if (passwordMode === PasswordMode.SHOWALL) {
      setShowAllForced(true);
      showToast(errorText.showingHiddenWallets, <TickIcon />);
    }
  };

  const unhide = async (signer: Signer) => {
    setUnhidingKeyUID(getKeyUID(signer));
    await dispatch(updateSignerDetails(signer, 'hidden', false));
    showToast('Key is now unhidden', <TickIcon />);
  };
  const hideSigner = (signer: Signer) => {
    setUnhidingKeyUID(getKeyUID(signer));
    dispatch(updateSignerDetails(signer, 'hidden', true));
  };
  const onSignerSuccess = () => {
    if (showAll) {
      setshowAll(false);
      setPasswordMode(PasswordMode.DEFAULT);
      showToast(errorText.hidingKeys, <TickIcon />);
    } else {
      showToast(errorText.showingKeys, <TickIcon />);
      setPasswordMode(PasswordMode.SHOWALL);
      setshowAll(true);
    }
  };

  const handleDelete = (signer: Signer) => {
    setMultipleHidden(false);
    const vaultsInvolved = allVaults.filter(
      (vault) => !vault.archived && vault.signers.find((s) => getKeyUID(s) === getKeyUID(signer))
    );
    if (vaultsInvolved.length > 0) {
      if (vaultsInvolved.length > 1) setMultipleHidden(true);
      setHideWarning(true);
      setVaultsUsed(vaultsInvolved);
      setConfirmPassVisible(false);
      return;
    }
    setConfirmPassVisible(true);
    setSignerToDelete(signer);
  };

  useEffect(() => {
    if (unhidingKeyUID && !hiddenSigners.find((signer) => getKeyUID(signer) === unhidingKeyUID)) {
      setUnhidingKeyUID('');
    }
  }, [hiddenSigners]);

  function DeleteLoadingContent() {
    return (
      <Box style={styles.loadingModalContainer}>
        <Box style={styles.loadingIcon}>
          <TorAsset />
        </Box>
        <Box style={styles.loadingText}>
          <Text color={`${colorMode}.primaryText`}>{signerText.thisStepTakesTime}</Text>
          <BounceLoader />
        </Box>
      </Box>
    );
  }

  function DeletedSuccessContent() {
    return (
      <Box style={styles.successModalContainer} backgroundColor={`${colorMode}.seashellWhite`}>
        <Box style={styles.signerContentContainer}>
          <HexagonIcon
            width={43}
            height={38}
            backgroundColor={Colors.primaryGreen}
            icon={SDIcons({ type: deletedSigner?.type, light: true }).Icon}
          />
          <Box>
            <Text numberOfLines={1} fontSize={14} color={`${colorMode}.greenText`}>
              {getSignerNameFromType(deletedSigner?.type)}
            </Text>
            <Text numberOfLines={1} fontSize={12} color={`${colorMode}.secondaryText`}>
              {getSignerDescription(deletedSigner)}
            </Text>
          </Box>
        </Box>
      </Box>
    );
  }

  function Content({ colorMode, vaultsUsed }) {
    return (
      <Box>
        <ScrollView
          contentContainerStyle={{ gap: 10 }}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {vaultsUsed.map((vault) => (
            <Box>
              <ActionCard
                description={vault.presentationData?.description}
                cardName={vault.presentationData.name}
                icon={<WalletVault />}
                callback={() => {}}
              />
            </Box>
          ))}
        </ScrollView>

        <Box style={{ paddingVertical: 20 }}>
          <Text color={`${colorMode}.primaryText`} style={styles.warningText}>
            {multipleHidden
              ? signerText.deleteMultipleVaultInstruction
              : signerText.deleteVaultInstruction}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <ScreenWrapper barStyle="dark-content" backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={signerText.hiddenKeys} subTitle={signerText.showingHiddenKeys} />
      <Box style={styles.container}>
        {allUnhideSigners.length === 0 && !showAll ? (
          <Box style={styles.emptyWrapper}>
            <Text color={`${colorMode}.greenishGreyText`} style={styles.emptyText} medium>
              {signerText.allKeysHidden}
            </Text>
            <Text color={`${colorMode}.secondaryText`} style={styles.emptySubText}>
              {signerText.clickToUnhide}
            </Text>
            <EmptyState />
          </Box>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContainer}
            showsVerticalScrollIndicator={false}
          >
            {displaySigners.map((signer) => {
              const showDelete = signer.type !== SignerType.POLICY_SERVER;

              return (
                <KeyCard
                  key={getKeyUID(signer)}
                  isLoading={getKeyUID(signer) === unhidingKeyUID && !showAll}
                  primaryAction={
                    signer.hidden === true && showDelete ? () => handleDelete(signer) : null
                  }
                  secondaryAction={() =>
                    signer.hidden === true ? unhide(signer) : hideSigner(signer)
                  }
                  primaryText={signer.hidden === true && showDelete ? signerText.delete : null}
                  secondaryText={signer.hidden === true ? signerText.unhide : 'Hide'}
                  primaryIcon={showDelete ? <DeleteIcon /> : null}
                  secondaryIcon={signer.hidden === true ? <ShowIcon /> : <HideWalletIcon />}
                  icon={{
                    element: SDIcons({ type: signer.type, light: true }).Icon,
                    backgroundColor: 'pantoneGreen',
                  }}
                  name={getSignerNameFromType(signer.type)}
                  description={getSignerDescription(signer)}
                  descriptionTitle={'Description'}
                  dateAdded={`Added ${moment(signer?.addedOn).calendar()}`}
                />
              );
            })}
          </ScrollView>
        )}
        <Box backgroundColor="#BABABA" height={0.9} width="100%" />
        <Pressable
          onPress={() => {
            if (showAll) {
              setshowAll(!showAll);
              setShowAllForced(false);
            } else if (showAllForced) {
              setShowAllForced(!showAllForced);
            } else {
              setConfirmPassForSigner(true);
              setPasswordMode(PasswordMode.SHOWALL);
            }
          }}
          style={styles.footer}
        >
          <Box backgroundColor={`${colorMode}.BrownNeedHelp`} style={styles.bottomIcon}>
            {showAll || showAllForced ? <HideAllIcon /> : <ShowAllIcon />}
          </Box>
          <Text style={{ fontWeight: '500' }} color={`${colorMode}.primaryText`}>
            {showAll || showAllForced ? signerText.hideSigner : signerText.showSigner}
          </Text>
        </Pressable>
      </Box>
      <KeeperModal
        visible={warningEnabled && !!vaultsUsed}
        close={() => setHideWarning(false)}
        title={
          multipleHidden ? signerText.deleteMultipleVaultWarning : signerText.deleteVaultWarning
        }
        subTitle={
          multipleHidden ? signerText.multipleVaultWarningSubtitle : signerText.vaultWarningSubtitle
        }
        buttonText={signerText.viewVault}
        secondaryButtonText={signerText.back}
        secondaryCallback={() => setHideWarning(false)}
        secButtonTextColor={`${colorMode}.greenText`}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonCallback={() => {
          setHideWarning(false);
          navigation.dispatch(CommonActions.navigate('ManageWallets'));
        }}
        textColor={`${colorMode}.textGreen`}
        Content={() => <Content vaultsUsed={vaultsUsed} colorMode={colorMode} />}
      />
      <KeeperModal
        visible={deletingKeyModalVisible}
        close={() => dispatch(hideDeletingKeyModal())}
        showCloseIcon={false}
        title={signerText.deletingKey}
        subTitle={signerText.keyWillBeDeleted}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={DeleteLoadingContent}
      />
      <KeeperModal
        visible={keyDeletedSuccessModalVisible}
        close={() => dispatch(hideKeyDeletedSuccessModal())}
        closeOnOverlayClick
        showCloseIcon={false}
        title={signerText.keyDeletedSuccessfully}
        subTitle={signerText.keyDeletedSuccessMessage}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonText={signerText.continue}
        buttonCallback={() => {
          dispatch(hideKeyDeletedSuccessModal());
        }}
        Content={DeletedSuccessContent}
      />

      <KeeperModal
        visible={confirmPassVisible}
        closeOnOverlayClick={false}
        close={() => setConfirmPassVisible(false)}
        title={signerText.enterPasscode}
        subTitleWidth={wp(240)}
        subTitle={signerText.confirmPasscodeToDeleteKey}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <Box>
            {signerToDelete && (
              <Box style={styles.signerContentContainer} marginBottom={hp(20)}>
                <HexagonIcon
                  width={43}
                  height={38}
                  backgroundColor={Colors.primaryGreen}
                  icon={SDIcons({ type: signerToDelete.type, light: true }).Icon}
                />
                <Box>
                  <Text numberOfLines={1} fontSize={14} color={`${colorMode}.greenText`}>
                    {getSignerNameFromType(signerToDelete.type)}
                  </Text>
                  <Text numberOfLines={1} fontSize={12} color={`${colorMode}.secondaryText`}>
                    {getSignerDescription(signerToDelete)}
                  </Text>
                </Box>
              </Box>
            )}
            <PasscodeVerifyModal
              useBiometrics={false}
              close={() => setConfirmPassVisible(false)}
              onSuccess={onSuccess}
            />
          </Box>
        )}
      />
      <KeeperModal
        visible={confirmPassForSigner}
        closeOnOverlayClick={false}
        close={() => setConfirmPassForSigner(false)}
        title={signerText.enterPasscode}
        subTitleWidth={wp(240)}
        subTitle={signerText.confirmPasscodeToDeleteKey}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <Box>
            <PasscodeVerifyModal
              forcedMode={passwordMode === PasswordMode.SHOWALL && isOnL2Above}
              useBiometrics={false}
              close={() => setConfirmPassForSigner(false)}
              onSuccess={onSignerSuccess}
              onForceSuccess={onForceProceed}
            />
          </Box>
        )}
      />
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  warningText: {
    fontSize: 13,
    padding: 1,
    letterSpacing: 0.65,
  },
  emptyWrapper: {
    height: '85%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: hp(3),
  },
  emptySubText: {
    fontSize: 14,
    lineHeight: 20,
    width: wp(250),
    textAlign: 'center',
    marginBottom: hp(30),
  },
  signerContentContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: wp(12),
  },
  loadingModalContainer: {
    marginBottom: hp(20),
  },
  loadingIcon: {
    width: windowWidth * 0.85,
    marginTop: hp(30),
    marginBottom: hp(50),
  },
  loadingText: {
    width: windowWidth * 0.8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  successModalContainer: {
    paddingHorizontal: wp(25),
    justifyContent: 'center',
    height: hp(108),
    marginBottom: hp(20),
    borderRadius: 10,
  },
  scrollContainer: {
    paddingVertical: 30,
  },
  footer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 15,
    gap: 10,
  },
  bottomIcon: {
    width: 38,
    height: 38,
    borderRadius: 38 / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default DeleteKeys;
