import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { Box, ScrollView, useColorMode } from 'native-base';
import KeeperHeader from 'src/components/KeeperHeader';
import useSigners from 'src/hooks/useSigners';
import { SDIcons } from 'src/screens/Vault/SigningDeviceIcons';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import { CommonActions, useFocusEffect, useNavigation } from '@react-navigation/native';
import useSignerMap from 'src/hooks/useSignerMap';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParams } from 'src/navigation/types';
import { UNVERIFYING_SIGNERS, getSignerDescription, getSignerNameFromType } from 'src/hardware';
import useVault from 'src/hooks/useVault';
import { Signer, Vault, VaultSigner } from 'src/services/wallets/interfaces/vault';
import { useAppSelector } from 'src/store/hooks';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import { resetSignersUpdateState } from 'src/store/reducers/bhr';
import { useDispatch } from 'react-redux';
import { SignerStorage, SignerType, VaultType } from 'src/services/wallets/enums';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import { useIndicatorHook } from 'src/hooks/useIndicatorHook';
import { uaiType } from 'src/models/interfaces/Uai';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { AppSubscriptionLevel } from 'src/models/enums/SubscriptionTier';
import useSubscriptionLevel from 'src/hooks/useSubscriptionLevel';
import SignerCard from '../AddSigner/SignerCard';
import KeyAddedModal from 'src/components/KeyAddedModal';
import KeeperModal from 'src/components/KeeperModal';
import Note from 'src/components/Note/Note';
import Text from 'src/components/KeeperText';
import { ConciergeTag } from 'src/store/sagaActions/concierge';
import Relay from 'src/services/backend/Relay';
import { notificationType } from 'src/models/enums/Notifications';
import { addSigningDevice } from 'src/store/sagaActions/vaults';
import AddKeyButton from './components/AddKeyButton';
import EmptyListIllustration from '../../components/EmptyListIllustration';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { setupKeeperSigner } from 'src/hardware/signerSetup';
import { getKeyUID } from 'src/utils/utilities';
import { SentryErrorBoundary } from 'src/services/sentry';
import PasscodeVerifyModal from 'src/components/Modal/PasscodeVerify';
import EnhancedKeysSection from './components/EnhancedKeysSection';
import ConciergeNeedHelp from 'src/assets/images/conciergeNeedHelp.svg';
import {
  EMERGENCY_KEY_IDENTIFIER,
  getKeyTimelock,
  INHERITANCE_KEY_IDENTIFIER,
} from 'src/services/wallets/operations/miniscript/default/EnhancedVault';
import WalletUtilities from 'src/services/wallets/operations/utils';
import HWError from 'src/hardware/HWErrorState';
import { HWErrorType } from 'src/models/enums/Hardware';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';

type ScreenProps = NativeStackScreenProps<AppStackParams, 'ManageSigners'>;

function ManageSigners({ route }: ScreenProps) {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { vaultId = '', addedSigner, remoteData } = route.params || {};
  const { activeVault } = useVault({ vaultId });
  const { signers: vaultKeys } = activeVault || { signers: [] };
  const { signerMap } = useSignerMap();
  const { signers } = useSigners('', false);
  const {
    realySignersUpdateErrorMessage,
    relaySignersUpdate,
    relaySignersUpdateLoading,
    realySignersAdded,
  } = useAppSelector((state) => state.bhr);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const { showToast } = useToastMessage();
  const dispatch = useDispatch();
  const [keyAddedModalVisible, setKeyAddedModalVisible] = useState(false);
  const [timerModal, setTimerModal] = useState(false);
  const [showLearnMoreModal, setShowLearnMoreModal] = useState(false);
  const [newSigner, setNewSigner] = useState(null);
  const [confirmPassVisible, setConfirmPassVisible] = useState(false);
  const [inProgress, setInProgress] = useState(false);
  const { translations } = useContext(LocalizationContext);
  const { signer: signerTranslation, common, settings } = translations;
  const { typeBasedIndicator } = useIndicatorHook({
    types: [uaiType.SIGNING_DEVICES_HEALTH_CHECK, uaiType.RECOVERY_PHRASE_HEALTH_CHECK],
  });

  const green_modal_text_color = ThemedColor({ name: 'green_modal_text_color' });
  const green_modal_background = ThemedColor({ name: 'green_modal_background' });
  const green_modal_button_background = ThemedColor({ name: 'green_modal_button_background' });
  const green_modal_button_text = ThemedColor({ name: 'green_modal_button_text' });
  const green_modal_sec_button_text = ThemedColor({ name: 'green_modal_sec_button_text' });
  const manage_signer_backGround = ThemedColor({ name: 'manage_signer_backGround' });

  useEffect(() => {
    if (remoteData?.key && !timerModal) {
      const signerNetwork = WalletUtilities.getNetworkFromPrefix(
        remoteData?.key.split(']')[1]?.slice(0, 4)
      );
      if (signerNetwork != bitcoinNetworkType) {
        showToast(new HWError(HWErrorType.INCORRECT_NETWORK).message, <ToastErrorIcon />);
        return;
      }
      setTimerModal(true);
    }
  }, [remoteData]);

  useEffect(() => {
    setInProgress(relaySignersUpdateLoading);
  }, [relaySignersUpdateLoading]);

  useEffect(() => {
    if (realySignersUpdateErrorMessage) {
      setInProgress(false);
      showToast(
        realySignersUpdateErrorMessage,
        <ToastErrorIcon />,
        IToastCategory.SIGNING_DEVICE,
        5000
      );
      dispatch(resetSignersUpdateState());
    }
    return () => {
      dispatch(resetSignersUpdateState());
    };
  }, [realySignersUpdateErrorMessage]);

  useFocusEffect(
    useCallback(() => {
      if (relaySignersUpdate) {
        setInProgress(false);
        if (realySignersAdded && navigation.isFocused()) {
          setKeyAddedModalVisible(true);
        }
        dispatch(resetSignersUpdateState());
      }
    }, [relaySignersUpdate])
  );

  const handleCardSelect = (signer, item, isInheritanceKey?, isEmergencyKey?) => {
    navigation.dispatch(
      CommonActions.navigate('SigningDeviceDetails', {
        signerId: getKeyUID(signer),
        vaultId,
        isInheritanceKey,
        isEmergencyKey,
        vaultKey: vaultKeys.length ? item : undefined,
        vaultSigners: vaultKeys,
      })
    );
  };

  const handleAddSigner = () => {
    navigation.dispatch(CommonActions.navigate('SignerCategoryList', { addSignerFlow: true }));
  };

  const handleModalClose = () => {
    setKeyAddedModalVisible(false);
  };

  const onSuccess = () => navigation.dispatch(CommonActions.navigate('DeleteKeys'));

  const acceptRemoteKey = async () => {
    try {
      setTimerModal(false);
      const hw = setupKeeperSigner(remoteData.key);
      dispatch(addSigningDevice([hw.signer]));
      setNewSigner(hw.signer);
      await Relay.sendSingleNotification({
        fcm: remoteData.fcm,
        notification: {
          title: signerTranslation.remoteKeyAccepted,
          body: signerTranslation.remoteKeyAcceptedDesc,
        },
        data: {
          notificationType: notificationType.REMOTE_KEY_SHARE,
        },
      });
    } catch (error) {
      console.log('🚀 ~ ManageSigners ~ error:', { error });
      showToast('Error while adding External Key');
    }
  };

  const rejectRemoteKey = async () => {
    setTimerModal(false);
    await Relay.sendSingleNotification({
      fcm: remoteData.fcm,
      notification: {
        title: signerTranslation.remoteKeyRejected,
        body: signerTranslation.remotweKeyRejectedDesc,
      },
      data: {
        notificationType: notificationType.REMOTE_KEY_SHARE,
      },
    });
  };

  return (
    <Box safeAreaTop backgroundColor={manage_signer_backGround} style={[styles.wrapper]}>
      <Box style={styles.topSection}>
        <KeeperHeader
          title={signerTranslation.ManageKeys}
          subtitle={signerTranslation.ViewAndChangeKeyDetails}
          mediumTitle
          learnMore
          learnMorePressed={() => setShowLearnMoreModal(true)}
          learnBackgroundColor={manage_signer_backGround}
          learnTextColor={`${colorMode}.buttonText`}
          titleColor={`${colorMode}.seashellWhiteText`}
          subTitleColor={`${colorMode}.seashellWhiteText`}
          icon={
            <CircleIconWrapper
              backgroundColor={`${colorMode}.seashellWhiteText`}
              icon={<ThemedSvg name={'manage_keys_icon'} />}
            />
          }
          contrastScreen
        />
      </Box>
      <Box style={styles.signersContainer} backgroundColor={`${colorMode}.primaryBackground`}>
        <SignersList
          colorMode={colorMode}
          vaultKeys={vaultKeys}
          signers={signers}
          signerMap={signerMap}
          handleCardSelect={handleCardSelect}
          handleAddSigner={handleAddSigner}
          vault={activeVault}
          typeBasedIndicator={typeBasedIndicator}
        />
      </Box>
      <KeeperModal
        title={signerTranslation.keyReceived}
        subTitle={signerTranslation.keyReceiveMessage}
        close={() => setTimerModal(false)}
        visible={timerModal}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        secButtonTextColor={`${colorMode}.pantoneGreen`}
        buttonText={signerTranslation.addKey}
        secondaryButtonText={signerTranslation.reject}
        buttonCallback={acceptRemoteKey}
        secondaryCallback={rejectRemoteKey}
        Content={() => (
          <Box style={{ marginBottom: hp(10) }}>
            <Note subtitle={signerTranslation.remoteKeyReceiveNote} />
          </Box>
        )}
      />
      <KeyAddedModal
        visible={keyAddedModalVisible}
        close={handleModalClose}
        signer={addedSigner ?? newSigner}
      />
      <KeeperModal
        close={() => {
          setShowLearnMoreModal(false);
        }}
        visible={showLearnMoreModal}
        title={signerTranslation.ManageKeys}
        subTitle={signerTranslation.manageKeysModalSubtitle}
        subTitleColor={green_modal_text_color}
        modalBackground={green_modal_background}
        textColor={green_modal_text_color}
        DarkCloseIcon={colorMode === 'dark' ? true : false}
        buttonTextColor={green_modal_button_text}
        buttonBackground={green_modal_button_background}
        secButtonTextColor={green_modal_sec_button_text}
        secondaryButtonText={common.needHelp}
        secondaryIcon={<ConciergeNeedHelp />}
        secondaryCallback={() => {
          setShowLearnMoreModal(false);
          navigation.dispatch(
            CommonActions.navigate({
              name: 'CreateTicket',
              params: {
                tags: [ConciergeTag.KEYS],
                screenName: 'manage-keys',
              },
            })
          );
        }}
        buttonText={common.Okay}
        buttonCallback={() => setShowLearnMoreModal(false)}
        Content={() => (
          <Box style={styles.modalContent}>
            <Box style={styles.illustrationContainer}>
              <ThemedSvg name={'diversify_hardware'} />
            </Box>
            <Text color={green_modal_text_color} style={styles.modalDesc}>
              {signerTranslation.manageKeysModalDesc}
            </Text>
          </Box>
        )}
      />
      <KeeperModal
        visible={confirmPassVisible}
        closeOnOverlayClick={false}
        close={() => setConfirmPassVisible(false)}
        title={settings.EnterPasscodeTitle}
        subTitleWidth={wp(240)}
        subTitle={settings.EnterPasscodeSubtitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <PasscodeVerifyModal
            useBiometrics={false}
            close={() => {
              setConfirmPassVisible(false);
            }}
            onSuccess={onSuccess}
          />
        )}
      />
      {inProgress && <ActivityIndicatorView visible={inProgress} />}
    </Box>
  );
}

function SignersList({
  colorMode,
  vaultKeys,
  signers,
  signerMap,
  handleCardSelect,
  handleAddSigner,
  vault,
  typeBasedIndicator,
}: {
  colorMode: string;
  vaultKeys: VaultSigner[];
  signers: Signer[];
  signerMap: Record<string, Signer>;
  handleCardSelect: (
    signer: Signer,
    item: VaultSigner,
    isInheritanceKey?: boolean,
    isEmergencyKey?: boolean
  ) => void;
  handleAddSigner: () => void;
  vault: Vault;
  typeBasedIndicator: Record<string, Record<string, boolean>>;
}) {
  const list = vaultKeys.length ? vaultKeys : signers.filter((signer) => !signer.hidden);
  const { level } = useSubscriptionLevel();
  const { showToast } = useToastMessage();
  const isNonVaultManageSignerFlow = !vault; // Manage Signers flow accessible via home screen
  const shellKeys = [];

  const [currentBlockHeight, setCurrentBlockHeight] = useState(null);
  const [currentMedianTimePast, setCurrentMedianTimePast] = useState(null);

  const inheritanceKeys = vault?.scheme?.miniscriptScheme?.miniscriptElements?.signerFingerprints
    ? Object.entries(vault.scheme.miniscriptScheme.miniscriptElements.signerFingerprints)
        .filter(([key]) => key.startsWith(INHERITANCE_KEY_IDENTIFIER))
        .map(([identifier, fingerprint]) => ({
          identifier,
          key: signerMap[getKeyUID(vault.signers.find((s) => s.masterFingerprint === fingerprint))],
          keyMeta: vault.signers.find((s) => s.masterFingerprint === fingerprint),
        }))
    : [];

  const emergencyKeys = vault?.scheme?.miniscriptScheme?.miniscriptElements?.signerFingerprints
    ? Object.entries(vault.scheme.miniscriptScheme.miniscriptElements.signerFingerprints)
        .filter(([key]) => key.startsWith(EMERGENCY_KEY_IDENTIFIER))
        .map(([identifier, fingerprint]) => ({
          identifier,
          key: signerMap[getKeyUID(vault.signers.find((s) => s.masterFingerprint === fingerprint))],
          keyMeta: vault.signers.find((s) => s.masterFingerprint === fingerprint),
        }))
    : [];

  const shellAssistedKeys = useMemo(() => {
    const generateShellAssistedKey = (signerType: SignerType) => ({
      type: signerType,
      storageType: SignerStorage.WARM,
      signerName: getSignerNameFromType(signerType, false, false),
      lastHealthCheck: new Date(),
      addedOn: new Date(),
      masterFingerprint: Date.now().toString() + signerType,
      signerXpubs: {},
      hidden: false,
    });

    let hasSigningServer = false; // actual signing server present?
    let isSigningServerShellCreated = false;

    if (shellKeys.filter((signer) => signer.type === SignerType.POLICY_SERVER).length > 0) {
      isSigningServerShellCreated = true;
    }

    for (const signer of signers) {
      if (signer.type === SignerType.POLICY_SERVER) hasSigningServer = true;
    }

    // if (!isSigningServerShellCreated && !hasSigningServer && level >= AppSubscriptionLevel.L2) {
    if (!isSigningServerShellCreated && !hasSigningServer) {
      shellKeys.push(generateShellAssistedKey(SignerType.POLICY_SERVER));
    }

    const addedSignersTypes = signers.map((signer) => signer.type);
    return shellKeys.filter((shellSigner) => !addedSignersTypes.includes(shellSigner.type));
  }, [signers]);

  return (
    <SafeAreaView style={styles.topContainer}>
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        {!vaultKeys.length && (
          <Box style={{ marginBottom: hp(25), marginRight: wp(15) }}>
            <AddKeyButton onPress={handleAddSigner} />
          </Box>
        )}
        <Box style={styles.addedSignersContainer}>
          {list.map((item) => {
            const signer = vaultKeys.length ? signerMap[getKeyUID(item)] : item;
            if (
              !signer ||
              signer.archived ||
              inheritanceKeys.map((inheritanceKey) => inheritanceKey.key).includes(signer)
            ) {
              return null;
            }
            if (
              emergencyKeys.map((emergencyKey) => emergencyKey.key).includes(signer) &&
              !Object.entries(
                vault?.scheme?.miniscriptScheme?.miniscriptElements?.signerFingerprints || {}
              ).some(
                ([key, fingerprint]) =>
                  key.startsWith('K') && fingerprint === signer.masterFingerprint
              )
            ) {
              return null;
            }
            const isRegistered = vaultKeys.length
              ? item.registeredVaults?.find((info) => info.vaultId === vault.id)
              : false;

            const showDot =
              (vaultKeys.length &&
                !UNVERIFYING_SIGNERS.includes(signer.type) &&
                !isRegistered &&
                !signer.isMock &&
                vault.isMultiSig) ||
              (signer.type !== SignerType.MY_KEEPER &&
                typeBasedIndicator?.[uaiType.SIGNING_DEVICES_HEALTH_CHECK]?.[item.id]);

            return (
              <SignerCard
                key={getKeyUID(signer)}
                onCardSelect={() => {
                  handleCardSelect(signer, item);
                }}
                name={
                  !signer.isBIP85
                    ? getSignerNameFromType(signer.type, signer.isMock, false)
                    : `${getSignerNameFromType(signer.type, signer.isMock, false)} +`
                }
                description={getSignerDescription(signer)}
                icon={SDIcons({ type: signer.type, light: true }).Icon}
                image={signer?.extraData?.thumbnailPath}
                showSelection={false}
                showDot={showDot}
                colorVarient="green"
                colorMode={colorMode}
                customStyle={styles.signerCard}
              />
            );
          })}
          {isNonVaultManageSignerFlow && list.length == 0 && shellAssistedKeys.length == 0 && (
            <EmptyListIllustration listType="keys" />
          )}
        </Box>

        {vault?.type === VaultType.MINISCRIPT &&
          vault.scheme.miniscriptScheme.miniscriptElements.timelocks.map((timelock) => (
            <EnhancedKeysSection
              keys={inheritanceKeys
                .concat(emergencyKeys)
                .filter(
                  (key) =>
                    getKeyTimelock(
                      key.identifier,
                      vault.scheme.miniscriptScheme.miniscriptElements
                    ) === timelock
                )}
              vault={vault}
              currentBlockHeight={currentBlockHeight}
              currentMedianTimePast={currentMedianTimePast}
              handleCardSelect={handleCardSelect}
              setCurrentBlockHeight={setCurrentBlockHeight}
              setCurrentMedianTimePast={setCurrentMedianTimePast}
            />
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topContainer: {
    flex: 1,
    marginBottom: 20,
  },
  wrapper: {
    flex: 1,
  },
  topSection: {
    height: '25%',
    paddingHorizontal: 20,
    paddingTop: hp(15),
  },
  signersContainer: {
    paddingHorizontal: '5%',
    borderTopRightRadius: 30,
    borderTopLeftRadius: 30,
    flex: 1,
  },
  scrollContainer: {
    zIndex: 2,
    marginVertical: wp(30),
    paddingBottom: hp(30),
  },
  addedSignersContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  modalContent: {
    marginBottom: hp(10),
  },
  illustrationContainer: {
    marginBottom: hp(30),
    alignContent: 'center',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalDesc: {
    width: '95%',
  },
  signerCard: {
    width: windowWidth * 0.43,
    height: wp(130),
  },
});

export default SentryErrorBoundary(ManageSigners);
