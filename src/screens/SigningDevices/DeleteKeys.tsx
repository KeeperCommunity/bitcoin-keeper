import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Box, Pressable, useColorMode } from '@gluestack-ui/themed-native-base';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import ScreenWrapper from 'src/components/ScreenWrapper';
import PasscodeVerifyModal from 'src/components/Modal/PasscodeVerify';
import KeeperModal from 'src/components/KeeperModal';
import useSigners from 'src/hooks/useSigners';
import { StyleSheet, ScrollView } from 'react-native';
import Text from 'src/components/KeeperText';
import { getSignerDescription, getSignerNameFromType } from 'src/hardware';
import DeleteIcon from 'src/assets/images/delete_bin.svg';
import ShowIcon from 'src/assets/images/show.svg';
import { useDispatch } from 'react-redux';
import { updateSignerDetails } from 'src/store/sagaActions/wallets';
import { Signer, Vault } from 'src/services/wallets/interfaces/vault';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import ActionCard from 'src/components/ActionCard';
import WalletVault from 'src/assets/images/wallet_vault.svg';
import { archiveSigningDevice, deleteSigningDevice } from 'src/store/sagaActions/vaults';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { SignerType, VaultType, VisibilityType } from 'src/services/wallets/enums';
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
import { store } from 'src/store/store';
import dbManager from 'src/storage/realm/dbManager';
import { currentBackupAccountSession } from 'src/services/backup/transport';
import { SDIcons } from '../Vault/SigningDeviceIcons';

type DeletionOrigin = { appId: string; accountSession: number };
type DeletionIntent = DeletionOrigin & { signer: Signer };

const isCurrentDeletionOrigin = (origin: DeletionOrigin) => {
  if (
    !origin.appId || store.getState().storage.appId !== origin.appId ||
    currentBackupAccountSession() !== origin.accountSession
  ) return false;
  try {
    return (dbManager.getObjectByIndex(RealmSchema.KeeperApp) as { id?: string } | undefined)?.id === origin.appId;
  } catch {
    return false;
  }
};

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
  const renderedAppId = useAppSelector((state) => state.storage.appId);
  const renderedSession = currentBackupAccountSession();
  const navigation = useNavigation();
  const [unhidingKeyUID, setUnhidingKeyUID] = useState('');
  // Deletion safety must include hidden/canary wallets and both networks.
  // Presentation hooks intentionally filter those records out.
  const vaultRecords = useQuery(RealmSchema.Vault);
  // Realm types toJSON as DefaultObject; this query contains Vault records.
  const readVaults = (): Vault[] =>
    vaultRecords.map((record) => getJSONFromRealmObject(record) as unknown as Vault);
  const [warningEnabled, setHideWarning] = useState(false);
  const [warningKeyUID, setWarningKeyUID] = useState<string | null>(null);
  // Store only the key identity: names, visibility and all current references
  // must be read again when the warning rerenders, including newly added ones.
  const vaultsUsed = warningKeyUID === null
    ? []
    : readVaults().filter(
        (vault) => !vault.archived && vault.signers.some((s) => getKeyUID(s) === warningKeyUID)
      );
  const [deletionIntent, setDeletionIntent] = useState<DeletionIntent | null>(null);
  const pendingDeletion = useRef<DeletionIntent | null>(null);
  const signerToDelete = deletionIntent?.signer;
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

  useFocusEffect(
    useCallback(
      () => () => {
        pendingDeletion.current = null;
        setDeletionIntent(null);
        setConfirmPassVisible(false);
        setWarningKeyUID(null);
        setHideWarning(false);
      },
      []
    )
  );

  const displaySigners = showAll ? [...allUnhideSigners, ...hiddenSigners] : allUnhideSigners;
  // References remain blocking even when their names must stay concealed.
  const showReferenceDetails = vaultsUsed.length > 0 && vaultsUsed.every(
    (vault) =>
      typeof vault.id === 'string' && vault.id.trim().length > 0 &&
      vault.type !== VaultType.CANARY &&
      vault.presentationData?.visibility === VisibilityType.DEFAULT
  );
  const showMultipleReferences = vaultsUsed.length > 1 && showReferenceDetails;

  const cancelDeletion = (intent: DeletionIntent | null) => {
    if (pendingDeletion.current !== intent) return;
    pendingDeletion.current = null;
    setDeletionIntent(null);
    setConfirmPassVisible(false);
  };

  const onSuccess = (intent: DeletionIntent | null) => {
    if (intent && pendingDeletion.current === intent) {
      // Consume synchronously: replayed/cancelled callbacks cannot reuse this
      // authorization or clear a later selection before React rerenders.
      cancelDeletion(intent);
      // Dispatch-time origin stamping must not rebind an old confirmation.
      if (!isCurrentDeletionOrigin(intent)) return;
      const { signer } = intent;
      // Read live Results at invocation; a retained callback must not use a
      // render-time snapshot from before a new active or archived reference.
      const references = getReferences(signer);
      const vaultsInvolved = references.filter((vault) => !vault.archived);
      if (vaultsInvolved.length) {
        setWarningKeyUID(getKeyUID(signer));
        setHideWarning(true);
        return;
      }
      if (references.some((vault) => vault.archived)) {
        dispatch({
          ...archiveSigningDevice([signer]), originAppId: intent.appId,
          originBackupAccountSession: intent.accountSession,
        });
      } else {
        dispatch({
          ...deleteSigningDevice([signer]), originAppId: intent.appId,
          originBackupAccountSession: intent.accountSession,
        });
      }
      setDeletedSigner(signer);
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

  const getReferences = (signer: Signer): Vault[] =>
    readVaults()
      .filter((vault) => vault.signers.some((s) => getKeyUID(s) === getKeyUID(signer)));

  const handleDelete = (signer: Signer) => {
    const origin = { appId: renderedAppId, accountSession: renderedSession };
    if (!isCurrentDeletionOrigin(origin)) return;
    pendingDeletion.current = null;
    setDeletionIntent(null);
    setHideWarning(false);
    setWarningKeyUID(null);
    const vaultsInvolved = getReferences(signer).filter((vault) => !vault.archived);
    if (vaultsInvolved.length > 0) {
      setHideWarning(true);
      setWarningKeyUID(getKeyUID(signer));
      setConfirmPassVisible(false);
      return;
    }
    const intent = { ...origin, signer };
    pendingDeletion.current = intent;
    setDeletionIntent(intent);
    setConfirmPassVisible(true);
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
            <Box key={vault.id}>
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
            {showMultipleReferences
              ? signerText.deleteMultipleVaultInstruction
              : signerText.deleteVaultInstruction}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <ScreenWrapper barStyle="dark-content" backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={signerText.manageKeys} subTitle={signerText.ViewAndChangeKeyDetails} />
      <Box style={styles.container}>
        {allUnhideSigners.length === 0 && !showAll ? (
          <Box style={styles.emptyWrapper}>
            <Text color={`${colorMode}.greenishGreyText`} style={styles.emptyText} medium>
              {signerText.allKeysHidden}
            </Text>
            <Text color={`${colorMode}.secondaryText`} style={styles.emptySubText}>
              {signerText.clickToUnhide}
            </Text>
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
                  testID={`manage_key_type_${signer.type}`}
                  isLoading={getKeyUID(signer) === unhidingKeyUID && !showAll}
                  primaryAction={showDelete ? () => handleDelete(signer) : null}
                  secondaryAction={() =>
                    signer.hidden === true ? unhide(signer) : hideSigner(signer)
                  }
                  primaryText={showDelete ? signerText.delete : null}
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
        visible={warningEnabled}
        close={() => setHideWarning(false)}
        title={
          showMultipleReferences ? signerText.deleteMultipleVaultWarning : signerText.deleteVaultWarning
        }
        subTitle={
          !showReferenceDetails
            ? signerText.deleteVaultInstruction
            : showMultipleReferences
              ? signerText.multipleVaultWarningSubtitle
              : signerText.vaultWarningSubtitle
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
        Content={() =>
          showReferenceDetails ? <Content vaultsUsed={vaultsUsed} colorMode={colorMode} /> : null
        }
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
        close={() => cancelDeletion(deletionIntent)}
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
              close={() => cancelDeletion(deletionIntent)}
              onSuccess={() => onSuccess(deletionIntent)}
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
