import { ScrollView, StyleSheet } from 'react-native';
import { Box, useColorMode } from 'native-base';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  Signer,
  Vault,
  VaultScheme,
  VaultSigner,
  signerXpubs,
} from 'src/services/wallets/interfaces/vault';
import {
  SignerType,
  KeyValidationErrorCode,
  VaultType,
  XpubTypes,
  MiniscriptTypes,
} from 'src/services/wallets/enums';
import Buttons from 'src/components/Buttons';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import Note from 'src/components/Note/Note';
import { hp, wp } from 'src/constants/responsive';
import { useAppSelector } from 'src/store/hooks';
import useSignerIntel from 'src/hooks/useSignerIntel';
import useSigners from 'src/hooks/useSigners';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import useSignerMap from 'src/hooks/useSignerMap';
import WalletUtilities from 'src/services/wallets/operations/utils';
import useVault from 'src/hooks/useVault';
import VaultIcon from 'src/assets/images/vault_icon.svg';
import HexagonIcon from 'src/components/HexagonIcon';
import { useDispatch } from 'react-redux';
import { resetSignersUpdateState } from 'src/store/reducers/bhr';
import { getSignerDescription, getSignerNameFromType } from 'src/hardware';
import Text from 'src/components/KeeperText';
import idx from 'idx';
import KeeperModal from 'src/components/KeeperModal';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import CardPill from 'src/components/CardPill';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { RealmSchema } from 'src/storage/realm/enum';
import { useQuery } from '@realm/react';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { SETUPCOLLABORATIVEWALLET, ADDRESERVEKEY, ADDEMERGENCYKEY } from 'src/navigation/contants';
import { SentryErrorBoundary } from 'src/services/sentry';
import KeyAddedModal from 'src/components/KeyAddedModal';
import { SafeAreaView } from 'react-native-safe-area-context';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { getKeyUID } from 'src/utils/utilities';
import KeyUnAvailableIllustrationLight from 'src/assets/images/key-unavailable-illustration-light.svg';
import KeyUnAvailableIllustrationDark from 'src/assets/images/key-unavailable-illustration-dark.svg';
import KeyWarningIllustration from 'src/assets/images/reserve-key-illustration-light.svg';
import WalletHeader from 'src/components/WalletHeader';
import SuccessIcon from 'src/assets/images/successSvg.svg';
import {
  EMERGENCY_KEY_IDENTIFIER,
  INHERITANCE_KEY_IDENTIFIER,
} from 'src/services/wallets/operations/miniscript/default/EnhancedVault';
import HardwareModalMap, { InteracationMode } from './HardwareModalMap';
import SignerCard from '../AddSigner/SignerCard';
import VaultMigrationController from './VaultMigrationController';
import { SDIcons } from './SigningDeviceIcons';
import AddKeyButton from '../SigningDevices/components/AddKeyButton';
import EmptyListIllustration from '../../components/EmptyListIllustration';

const MINISCRIPT_SIGNERS = [
  SignerType.MY_KEEPER,
  SignerType.TAPSIGNER,
  SignerType.SATOCHIP,
  SignerType.BITBOX02,
  SignerType.COLDCARD,
  SignerType.JADE,
  SignerType.KRUX,
  SignerType.LEDGER,
  SignerType.SPECTER,
  SignerType.SEED_WORDS,
  SignerType.KEEPER,
  SignerType.POLICY_SERVER,
];

const onSignerSelect = (
  selected,
  signer: Signer,
  scheme,
  vaultKeys,
  setVaultKeys,
  selectedSigners,
  setSelectedSigners,
  setHotWalletSelected,
  setHotWalletInstanceNum,
  vaultType,
  showToast
) => {
  const amfXpub: signerXpubs[XpubTypes][0] = signer.signerXpubs[XpubTypes.AMF][0];
  const ssXpub: signerXpubs[XpubTypes][0] = signer.signerXpubs[XpubTypes.P2WPKH][0];
  const msXpub: signerXpubs[XpubTypes][0] = signer.signerXpubs[XpubTypes.P2WSH][0];

  const { isMock } = signer;
  const isAmf = !!amfXpub;
  const isMultisig = msXpub && (scheme.n > 1 || vaultType === VaultType.MINISCRIPT);

  if (selected) {
    const updated = selectedSigners.delete(getKeyUID(signer));
    if (updated) {
      if (isMock) {
        const updatedKeys = vaultKeys.filter((key) => msXpub && key.xpub !== msXpub.xpub);
        setVaultKeys(updatedKeys);
      } else if (isAmf) {
        const updatedKeys = vaultKeys.filter((key) => amfXpub && key.xpub !== amfXpub.xpub);
        setVaultKeys(updatedKeys);
      } else if (isMultisig) {
        const updatedKeys = vaultKeys.filter((key) => key.xpub !== msXpub.xpub);
        setVaultKeys(updatedKeys);
      } else {
        const updatedKeys = vaultKeys.filter((key) => key.xpub !== ssXpub.xpub);
        setVaultKeys(updatedKeys);
      }
      setSelectedSigners(new Map(selectedSigners));
      setHotWalletSelected(false);
      setHotWalletInstanceNum(null);
    }
  } else {
    const maxKeys =
      scheme?.miniscriptScheme?.usedMiniscriptTypes?.length > 0
        ? Object.keys(scheme?.miniscriptScheme?.keyInfoMap || {}).length
        : scheme.n;

    if (selectedSigners.size >= maxKeys) {
      showToast('You have already selected the total keys', null, IToastCategory.DEFAULT, 1700);
      return;
    }
    // TODO: Need special implementation in case of mobile key single sig without Miniscript.
    if (
      signer.type !== SignerType.MY_KEEPER ||
      scheme.n !== 1 ||
      vaultType === VaultType.MINISCRIPT
    ) {
      const scriptKey = WalletUtilities.getKeyForScheme(
        isMultisig,
        signer,
        msXpub,
        ssXpub,
        amfXpub
      );
      vaultKeys.push(scriptKey);
      setVaultKeys(vaultKeys);
      setHotWalletSelected(false);
      setHotWalletInstanceNum(null);
    } else {
      setHotWalletSelected(true);
      setHotWalletInstanceNum(signer.extraData.instanceNumber - 1);
    }

    const updatedSignerMap = selectedSigners.set(getKeyUID(signer), true);
    setSelectedSigners(new Map(updatedSignerMap));
  }
};

const getVaultType = ({
  activeVault,
  isCollaborativeWallet,
  isSSAddition,
  isAssistedWallet,
  isTimeLock,
  isInheritance,
  isEmergency,
  scheme,
}) => {
  if (activeVault) return activeVault.type;
  if (isInheritance || isEmergency || isTimeLock || isAssistedWallet) return VaultType.MINISCRIPT;
  if (isCollaborativeWallet) return VaultType.COLLABORATIVE;
  if (isSSAddition || scheme.n === 1) return VaultType.SINGE_SIG;
  return VaultType.DEFAULT;
};

const isAssistedKeyValidForScheme = (
  scheme
): { isValid: boolean; code?: KeyValidationErrorCode } => {
  // case 1: scheme-based restrictions for assisted keys
  // both assisted keys can be added starting from Vaults w/ m: 2 and n:3
  if (scheme.n < 3) {
    return { isValid: false, code: KeyValidationErrorCode.INSUFFICIENT_TOTAL_KEYS };
  }
  if (scheme.m < 2) {
    return { isValid: false, code: KeyValidationErrorCode.INSUFFICIENT_REQUIRED_KEYS };
  }

  return { isValid: true };
};

const isSignerValidForScheme = (
  signer: Signer,
  scheme,
  activeVault,
  isMultisig
): { isValid: boolean; code?: KeyValidationErrorCode } => {
  if (signer.type === SignerType.POLICY_SERVER) {
    return isAssistedKeyValidForScheme(scheme);
  }

  const amfXpub = idx(signer, (_) => _.signerXpubs[XpubTypes.AMF][0]);
  const ssXpub = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WPKH][0]);
  const msXpub = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WSH][0]);

  if (
    signer.type === SignerType.MY_KEEPER &&
    (!activeVault || activeVault.type === VaultType.MINISCRIPT)
  ) {
    return { isValid: true };
  }

  if (
    (isMultisig && !msXpub && !amfXpub && !signer.isMock) ||
    (!isMultisig && !ssXpub && !amfXpub && !signer.isMock)
  ) {
    if (signer.type === SignerType.MY_KEEPER) {
      return { isValid: false, code: KeyValidationErrorCode.MOBILE_KEY_NOT_ALLOWED };
    } else if (signer.type === SignerType.KEEPER && !isMultisig) {
      return { isValid: false, code: KeyValidationErrorCode.EXTERNAL_KEY_SINGLESIG };
    }
    return { isValid: false, code: KeyValidationErrorCode.MISSING_XPUB };
  }

  return { isValid: true };
};

const setInitialKeys = (
  activeVault,
  vaultType,
  scheme,
  signerMap,
  setVaultKeys,
  setSelectedSigners,
  selectedSigners,
  keyToRotate
) => {
  if (activeVault) {
    // setting initital keys (update if scheme has changed)
    const vaultKeys = activeVault.signers.filter(
      (key) => keyToRotate && getKeyUID(key) !== getKeyUID(keyToRotate)
    );
    const isMultisig =
      scheme.n > 1 ||
      activeVault?.type === VaultType.MINISCRIPT ||
      vaultType === VaultType.MINISCRIPT;
    const modifiedVaultKeysForScriptType = [];
    const updatedSignerMap = new Map();
    vaultKeys.forEach((key) => {
      const signer = signerMap[getKeyUID(key)];
      if (isSignerValidForScheme(signer, scheme, activeVault, isMultisig).isValid) {
        if (modifiedVaultKeysForScriptType.length < scheme.n) {
          updatedSignerMap.set(getKeyUID(key), true);
          const msXpub: signerXpubs[XpubTypes][0] = signer.signerXpubs[XpubTypes.P2WSH][0];
          const ssXpub: signerXpubs[XpubTypes][0] = signer.signerXpubs[XpubTypes.P2WPKH][0];
          const amfXpub: signerXpubs[XpubTypes][0] = signer.signerXpubs[XpubTypes.AMF][0];
          const scriptKey = WalletUtilities.getKeyForScheme(
            isMultisig,
            signer,
            msXpub,
            ssXpub,
            amfXpub
          );
          if (scriptKey) {
            modifiedVaultKeysForScriptType.push(scriptKey);
          }
        }
      }
    });
    setVaultKeys(modifiedVaultKeysForScriptType);
    setSelectedSigners(new Map(updatedSignerMap));
  }
};

const getSelectedKeysByType = (vaultKeys, signerMap, type) => {
  return vaultKeys.filter((key) => signerMap[getKeyUID(key)].type === type);
};

const handleSignerSelect = (
  selected: boolean,
  signer: Signer,
  disabledMessage: { title: string; message: string; code?: string; clickedSigner?: Signer } | null,
  vaultType: VaultType,
  setModalContent: (content: {
    name: string;
    title: string;
    subtitle: string;
    message: string;
    code: string | null;
    clickedSigner: Signer | null;
  }) => void,
  setShowSignerModal: (show: boolean) => void,
  onSignerSelect: Function,
  {
    scheme,
    vaultKeys,
    setVaultKeys,
    selectedSigners,
    setSelectedSigners,
    setHotWalletSelected,
    setHotWalletInstanceNum,
    showToast,
  }
) => {

  //SATOCHIP DEBUG
  console.log(`selected: ${selected}`);
  console.log(`signer: ${signer}`);
  console.log(JSON.stringify(signer, null, 2));
  console.log(`signer.type: ${signer.type}`);
  console.log(`vaultType: ${vaultType}`);
  console.log(`setModalContent: ${setModalContent}`);
  console.log(`setShowSignerModal: ${setShowSignerModal}`);
  console.log(`onSignerSelect: ${onSignerSelect}`);

  // ENDBUG

  console.log('disabledMessage');
  console.log(disabledMessage);
  if (disabledMessage) {
    setModalContent({
      name: getSignerNameFromType(signer.type),
      title: disabledMessage.title,
      message: disabledMessage.message,
      subtitle: '',
      code: disabledMessage.code,
      clickedSigner: disabledMessage.clickedSigner,
    });
    setShowSignerModal(true);
    return;
  }

  if (!selected && signer?.type === SignerType.KEEPER && vaultType === VaultType.MINISCRIPT) {
    console.log(`in if condition1`);
    setModalContent({
      name: getSignerNameFromType(signer.type),
      title: 'Verify with Key Holder',
      subtitle:
        'Please make sure the external key uses a device which has Miniscript support, as it is required to sign transactions of the Enhanced Vault.',
      message:
        'At the moment, the following devices are supported: Keeper Mobile Key, BitBox02, Coldcard, Blockstream Jade, Ledger, Satochip and TAPSIGNER.',
      code: null,
      clickedSigner: signer,
    });
    setShowSignerModal(true);
  }

  console.log(`after if condition1`);
  onSignerSelect(
    selected,
    signer,
    scheme,
    vaultKeys,
    setVaultKeys,
    selectedSigners,
    setSelectedSigners,
    setHotWalletSelected,
    setHotWalletInstanceNum,
    vaultType,
    showToast
  );
};

function Footer({
  amfSigners,
  invalidSS,
  invalidMessage,
  areSignersValid,
  relayVaultUpdateLoading,
  colorMode,
  setCreating,
  isCollaborativeFlow,
  isAssistedWalletFlow,
  hasInitialTimelock,
  setTimelockCautionModal,
  isReserveKeyFlow,
  isEmergencyKeyFlow,
  isAddInheritanceKey,
  isAddEmergencyKey,
  currentBlockHeight,
  vaultKeys,
  onGoBack,
  selectedSigners,
  name,
  description,
  vaultId,
  scheme,
  vaultType,
  isHotWallet,
  hotWalletInstanceNum,
  keyToRotate,
  signers,
  activeVault,
}) {
  const navigation = useNavigation();
  const { translations } = useContext(LocalizationContext);
  const { common } = translations;
  const renderNotes = () => {
    const notes = [];
    if (amfSigners.length) {
      const message = `* ${amfSigners.join(
        ' and '
      )} does not support Testnet directly, so the app creates a proxy Testnet key for you in the beta app`;
      notes.push(
        <Box style={styles.noteContainer} key={message}>
          <Note title={common.note} subtitle={message} />
        </Box>
      );
    }
    if (invalidSS) {
      const message = invalidMessage;
      notes.push(
        <Box style={styles.noteContainer} key={message}>
          <Note title="WARNING" subtitle={message} subtitleColor="error" />
        </Box>
      );
    }
    return notes;
  };

  const handleProceedButtonClick = () => {
    if (onGoBack) {
      onGoBack(vaultKeys);
    }

    navigation.goBack();
  };

  const isProceedDisabled =
    (isCollaborativeFlow || isAssistedWalletFlow) && selectedSigners.size === 0;
  const isConfirmDisabled = (isReserveKeyFlow || isEmergencyKeyFlow) && selectedSigners.size === 0;
  const signersList = Array.from(selectedSigners.keys()).map((id) =>
    signers.find((s) => getKeyUID(s) === id)
  );

  return (
    <Box style={styles.bottomContainer}>
      {!(isCollaborativeFlow || isAssistedWalletFlow) && renderNotes()}
      {!(isCollaborativeFlow || isAssistedWalletFlow) &&
      !isReserveKeyFlow &&
      !isEmergencyKeyFlow ? (
        <Buttons
          primaryDisable={!areSignersValid && !isHotWallet}
          primaryLoading={relayVaultUpdateLoading}
          primaryText={keyToRotate ? 'Replace Key' : common.proceed}
          primaryCallback={
            !hasInitialTimelock
              ? !isAddInheritanceKey
                ? !isAddEmergencyKey
                  ? keyToRotate
                    ? () => {
                        setCreating(true);
                      }
                    : () => {
                        navigation.navigate('ConfirmWalletDetails', {
                          vaultKeys,
                          scheme,
                          isHotWallet,
                          vaultType,
                          hasInitialTimelock,
                          isAddInheritanceKey,
                          currentBlockHeight,
                          hotWalletInstanceNum,
                          selectedSigners: signersList,
                          vaultId,
                        });
                      }
                  : () =>
                      navigation.dispatch(
                        CommonActions.navigate('AddEmergencyKey', {
                          vaultKeys: vaultKeys.filter(
                            (signer) =>
                              !Object.keys(
                                activeVault?.scheme?.miniscriptScheme?.miniscriptElements
                                  ?.signerFingerprints || {}
                              )
                                .filter((key) => key.startsWith(EMERGENCY_KEY_IDENTIFIER))
                                .some((key) => {
                                  const fingerprint =
                                    activeVault?.scheme?.miniscriptScheme?.miniscriptElements
                                      ?.signerFingerprints[key];
                                  const fingerprintCount = Object.values(
                                    activeVault?.scheme?.miniscriptScheme?.miniscriptElements
                                      ?.signerFingerprints || {}
                                  ).filter((fp) => fp === fingerprint).length;
                                  return (
                                    signer.masterFingerprint === fingerprint &&
                                    fingerprintCount === 1
                                  );
                                })
                          ),
                          vaultId,
                          scheme,
                          name,
                          description,
                          isAddInheritanceKey,
                          isAddEmergencyKey,
                          hasInitialTimelock,
                          currentBlockHeight,
                          selectedSigners: signersList,
                        })
                      )
                : () =>
                    navigation.dispatch(
                      CommonActions.navigate('AddReserveKey', {
                        vaultKeys: vaultKeys.filter(
                          (signer) =>
                            !Object.keys(
                              activeVault?.scheme?.miniscriptScheme?.miniscriptElements
                                ?.signerFingerprints || {}
                            )
                              .filter((key) => key.startsWith(INHERITANCE_KEY_IDENTIFIER))
                              .some(
                                (key) =>
                                  signer.masterFingerprint ===
                                  activeVault?.scheme?.miniscriptScheme?.miniscriptElements
                                    ?.signerFingerprints[key]
                              )
                        ),
                        vaultId,
                        scheme,
                        name,
                        description,
                        isAddInheritanceKey,
                        isAddEmergencyKey,
                        hasInitialTimelock,
                        currentBlockHeight,
                        selectedSigners: signersList,
                      })
                    )
              : () =>
                  navigation.dispatch(
                    CommonActions.navigate('SelectInitialTimelock', {
                      vaultKeys,
                      vaultId,
                      scheme,
                      name,
                      description,
                      isAddInheritanceKey,
                      isAddEmergencyKey,
                      hasInitialTimelock,
                      currentBlockHeight,
                      selectedSigners: signersList,
                    })
                  )
          }
          fullWidth
        />
      ) : isReserveKeyFlow || isEmergencyKeyFlow ? (
        <Buttons
          primaryDisable={isConfirmDisabled}
          primaryLoading={relayVaultUpdateLoading}
          primaryText={common.confirm}
          primaryCallback={handleProceedButtonClick}
          fullWidth
        />
      ) : (
        <Buttons
          primaryDisable={isProceedDisabled}
          primaryLoading={relayVaultUpdateLoading}
          primaryText={common.proceed}
          primaryCallback={() => handleProceedButtonClick()}
          fullWidth
        />
      )}
    </Box>
  );
}

function SignerUnavailableContent({ modalContent, setShowSignerModal, setVisibleImportXpub }) {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { vault: vaultText, common } = translations;
  const isDarkMode = colorMode === 'dark';
  return (
    <Box>
      <Box style={styles.unAvailableIllustration}>
        {modalContent.code ? (
          isDarkMode ? (
            <KeyUnAvailableIllustrationDark />
          ) : (
            <KeyUnAvailableIllustrationLight />
          )
        ) : (
          <KeyWarningIllustration />
        )}
      </Box>
      <Text color={`${colorMode}.secondaryText`}>{modalContent.message}</Text>
      <Box style={styles.modalButtonContainer}>
        {modalContent.code === KeyValidationErrorCode.MISSING_XPUB ? (
          <Buttons
            primaryText={vaultText.importXpub}
            primaryCallback={() => {
              setShowSignerModal(false);
              setVisibleImportXpub(true);
            }}
            secondaryText={common.cancel}
            secondaryCallback={() => setShowSignerModal(false)}
          />
        ) : (
          <Buttons
            fullWidth
            primaryText={common.Okay}
            primaryCallback={() => setShowSignerModal(false)}
          />
        )}
      </Box>
    </Box>
  );
}

function Signers({
  signers,
  selectedSigners,
  setSelectedSigners,
  setHotWalletSelected,
  setHotWalletInstanceNum,
  scheme,
  colorMode,
  vaultKeys,
  setVaultKeys,
  showToast,
  navigation,
  vaultId,
  signerMap,
  showSelection,
  keyToRotate,
  setCreating,
  isCollaborativeFlow,
  isAssistedWalletFlow,
  isReserveKeyFlow,
  isEmergencyKeyFlow,
  signerFilters,
  coSigners,
  setExternalKeyAddedModal,
  setAddedKey,
  vaultType,
  selectedSignersFromParams,
  activeVault,
}) {
  const { translations } = useContext(LocalizationContext);
  const { vault: vaultText, common } = translations;
  const [visibleImportXpub, setVisibleImportXpub] = useState(false);
  const [showSSModal, setShowSSModal] = useState(false);
  const [showSignerModal, setShowSignerModal] = useState(false);
  const [modalContent, setModalContent] = useState({
    name: '',
    title: '',
    message: '',
    subtitle: null,
    code: '',
    clickedSigner: null,
  });
  const isMultisig = scheme.n !== 1 || vaultType === VaultType.MINISCRIPT;
  const { primaryMnemonic }: KeeperApp = useQuery(RealmSchema.KeeperApp).map(
    getJSONFromRealmObject
  )[0];
  const closeSSModal = () => setShowSSModal(false);

  const getDisabledMessage = (
    signer,
    myAppKeys,
    selectedSigners,
    scheme,
    signerMap,
    keyToRotate,
    vaultType
  ) => {
    const validationResult = isSignerValidForScheme(signer, scheme, activeVault, isMultisig);

    if (!validationResult.isValid) {
      let title, message;

      switch (validationResult.code) {
        case KeyValidationErrorCode.MOBILE_KEY_NOT_ALLOWED:
          title = vaultText.mobileKeyNotAllowedTitle;
          message = vaultText.mobileKeyNotAllowedMessage;
          break;
        case KeyValidationErrorCode.MISSING_XPUB:
          title = vaultText.missingXpubTitle;
          message = vaultText.missingXpubMessage;
          break;
        case KeyValidationErrorCode.EXTERNAL_KEY_SINGLESIG:
          title = vaultText.externalKeySinglesigTitle;
          message = vaultText.externalKeySinglesigMessage;
          break;
        case KeyValidationErrorCode.INSUFFICIENT_TOTAL_KEYS:
        case KeyValidationErrorCode.INSUFFICIENT_REQUIRED_KEYS:
          title = `${getSignerNameFromType(signer.type)} ${vaultText.insufficientTotalKeysTitle}`;
          message = `${common.the} ${getSignerNameFromType(signer.type)} ${
            vaultText.insufficientTotalKeysMessage
          }`;
          break;
        default:
          return null;
      }

      return { title, message, code: validationResult.code, clickedSigner: signer };
    }

    if (
      signer.type === SignerType.MY_KEEPER &&
      myAppKeys.length >= 1 &&
      getKeyUID(myAppKeys[0]) !== getKeyUID(signer)
    ) {
      return {
        title: vaultText.anotherMobileKeyAlreadySelectedTitle,
        message: vaultText.anotherMobileKeyAlreadySelectedMessage,
      };
    }

    if (
      vaultKeys.some(
        (key) =>
          key.masterFingerprint === signer.masterFingerprint && getKeyUID(key) !== getKeyUID(signer)
      )
    ) {
      return {
        title: vaultText.keyFromSameDeviceAlreadySelectedTitle,
        message: vaultText.keyFromSameDeviceAlreadySelectedMessage,
      };
    }

    if (
      keyToRotate &&
      (getKeyUID(keyToRotate) === getKeyUID(signer) ||
        activeVault.signers.find((s) => getKeyUID(s) === getKeyUID(signer)))
    ) {
      return {
        title: vaultText.keyAlreadyUsedInVaultTitle,
        message: vaultText.keyAlreadyUsedInVaultMessage,
      };
    }

    if (vaultType === VaultType.MINISCRIPT && !MINISCRIPT_SIGNERS.includes(signer.type)) {
      return {
        title: vaultText.keyDoesntSupportMiniscriptTitle,
        message: vaultText.keyDoesntSupportMiniscriptMessage,
      };
    }

    return null;
  };

  const renderSigners = useCallback(
    (signerFilters = []) => {
      const myAppKeys = getSelectedKeysByType(vaultKeys, signerMap, SignerType.MY_KEEPER);
      const filteredSigners =
        signerFilters.length > 0
          ? signers.filter((signer) => signerFilters.includes(signer.type))
          : signers;

      const signerCards = filteredSigners.map((signer) => {
        if (signer.archived) return null;

        const disabledMessage = getDisabledMessage(
          signer,
          myAppKeys,
          selectedSigners,
          scheme,
          signerMap,
          keyToRotate,
          vaultType
        );
        const disabled = disabledMessage !== null;

        return (
          <SignerCard
            showSelection={showSelection}
            disabledWithTouch={disabled}
            key={getKeyUID(signer)}
            name={
              !signer.isBIP85
                ? getSignerNameFromType(signer.type, signer.isMock, false)
                : `${getSignerNameFromType(signer.type, signer.isMock, false)} +`
            }
            description={getSignerDescription(signer)}
            icon={SDIcons({ type: signer.type }).Icon}
            image={signer?.extraData?.thumbnailPath}
            isSelected={!!selectedSigners.get(getKeyUID(signer))}
            onCardSelect={(selected) => {
              handleSignerSelect(
                selected,
                signer,
                disabledMessage,
                vaultType,
                setModalContent,
                setShowSignerModal,
                onSignerSelect,
                {
                  scheme,
                  vaultKeys,
                  setVaultKeys,
                  selectedSigners,
                  setSelectedSigners,
                  setHotWalletSelected,
                  setHotWalletInstanceNum,
                  showToast,
                }
              );
            }}
            colorMode={colorMode}
          />
        );
      });

      return signerCards;
    },
    [signers, signerFilters]
  );

  const renderCollaborativeSigners = useCallback(() => {
    const myAppKeys = getSelectedKeysByType(vaultKeys, signerMap, SignerType.MY_KEEPER);
    const anySignerSelected = [...selectedSigners.values()].some((selected) => selected);
    const validCoSigners = coSigners.filter((signer) => signer);
    const coSignersMap = new Map(validCoSigners.map((signer) => [getKeyUID(signer), true]));

    const filteredSigners = signers
      .filter(
        (signer) =>
          signer.type === SignerType.KEEPER &&
          !signer.archived &&
          !coSignersMap.has(getKeyUID(signer))
      )
      .map((signer) => {
        const { isValid } = isSignerValidForScheme(signer, scheme, activeVault, isMultisig);
        const disabled =
          !isValid ||
          (signer.type === SignerType.MY_KEEPER &&
            myAppKeys.length >= 1 &&
            getKeyUID(myAppKeys[0]) !== getKeyUID(signer)) ||
          vaultKeys.some(
            (key) =>
              key.masterFingerprint === signer.masterFingerprint &&
              getKeyUID(key) !== getKeyUID(signer)
          ) ||
          (anySignerSelected && !selectedSigners.get(getKeyUID(signer)));

        const handleCardSelect = (selected) => {
          if (disabled) return;

          onSignerSelect(
            selected,
            signer,
            scheme,
            vaultKeys,
            setVaultKeys,
            selectedSigners,
            setSelectedSigners,
            setHotWalletSelected,
            setHotWalletInstanceNum,
            vaultType,
            showToast
          );
        };

        return (
          <SignerCard
            showSelection={showSelection}
            disabled={disabled}
            key={getKeyUID(signer)}
            name={
              !signer.isBIP85
                ? getSignerNameFromType(signer.type, signer.isMock)
                : `${getSignerNameFromType(signer.type, signer.isMock)} +`
            }
            description={getSignerDescription(signer)}
            icon={SDIcons({ type: signer.type }).Icon}
            image={signer?.extraData?.thumbnailPath}
            isSelected={!!selectedSigners.get(getKeyUID(signer))}
            onCardSelect={handleCardSelect}
            colorMode={colorMode}
          />
        );
      });

    return filteredSigners;
  }, [
    signers,
    selectedSigners,
    scheme,
    signerMap,
    vaultKeys,
    keyToRotate,
    showSelection,
    colorMode,
    setSelectedSigners,
    setVaultKeys,
    showToast,
    setCreating,
    coSigners,
  ]);

  const renderReservedKeys = useCallback(() => {
    const myAppKeys = getSelectedKeysByType(
      selectedSignersFromParams,
      signerMap,
      SignerType.MY_KEEPER
    );

    const selectedFingerprintsSet = new Set(
      selectedSignersFromParams.map((signer) => signer.masterFingerprint)
    );

    const signerCards = signers
      .filter((signer) => !signer.archived)
      .filter((signer) => !selectedFingerprintsSet.has(signer.masterFingerprint)) // Avoid selected signers from params
      .filter((signer) => signer.type !== SignerType.POLICY_SERVER) // Policy/Signing server cannot be used as an Inheritance Key
      .map((signer) => {
        const disabledMessage = getDisabledMessage(
          signer,
          myAppKeys,
          selectedSigners,
          scheme,
          signerMap,
          keyToRotate,
          vaultType
        );
        const disabled = disabledMessage !== null;
        return (
          <SignerCard
            showSelection={showSelection}
            disabledWithTouch={disabled}
            key={getKeyUID(signer)}
            name={
              !signer.isBIP85
                ? getSignerNameFromType(signer.type, signer.isMock)
                : `${getSignerNameFromType(signer.type, signer.isMock)} +`
            }
            description={getSignerDescription(signer)}
            icon={SDIcons({ type: signer.type }).Icon}
            image={signer?.extraData?.thumbnailPath}
            isSelected={!!selectedSigners.get(getKeyUID(signer))}
            onCardSelect={(selected) => {
              handleSignerSelect(
                selected,
                signer,
                disabledMessage,
                vaultType,
                setModalContent,
                setShowSignerModal,
                onSignerSelect,
                {
                  scheme,
                  vaultKeys,
                  setVaultKeys,
                  selectedSigners,
                  setSelectedSigners,
                  setHotWalletSelected,
                  setHotWalletInstanceNum,
                  showToast,
                }
              );
            }}
            colorMode={colorMode}
          />
        );
      });

    return signerCards;
  }, [
    signers,
    selectedSigners,
    selectedSignersFromParams,
    scheme,
    signerMap,
    vaultKeys,
    keyToRotate,
    showSelection,
    colorMode,
    setSelectedSigners,
    setVaultKeys,
    showToast,
    setCreating,
  ]);

  const renderEmergencyKeys = useCallback(() => {
    const myAppKeys = getSelectedKeysByType(
      selectedSignersFromParams,
      signerMap,
      SignerType.MY_KEEPER
    );

    const signerCards = signers
      .filter((signer) => !signer.archived)
      .filter((signer) => signer.type !== SignerType.POLICY_SERVER) // Policy/Signing server cannot be used as an Emergency Key
      .map((signer) => {
        const disabledMessage = getDisabledMessage(
          signer,
          myAppKeys,
          selectedSigners,
          scheme,
          signerMap,
          keyToRotate,
          vaultType
        );
        const disabled = disabledMessage !== null;
        return (
          <SignerCard
            showSelection={showSelection}
            disabledWithTouch={disabled}
            key={getKeyUID(signer)}
            name={
              !signer.isBIP85
                ? getSignerNameFromType(signer.type, signer.isMock)
                : `${getSignerNameFromType(signer.type, signer.isMock)} +`
            }
            description={getSignerDescription(signer)}
            icon={SDIcons({ type: signer.type }).Icon}
            image={signer?.extraData?.thumbnailPath}
            isSelected={!!selectedSigners.get(getKeyUID(signer))}
            onCardSelect={(selected) => {
              handleSignerSelect(
                selected,
                signer,
                disabledMessage,
                vaultType,
                setModalContent,
                setShowSignerModal,
                onSignerSelect,
                {
                  scheme,
                  vaultKeys,
                  setVaultKeys,
                  selectedSigners,
                  setSelectedSigners,
                  setHotWalletSelected,
                  setHotWalletInstanceNum,
                  showToast,
                }
              );
            }}
            colorMode={colorMode}
          />
        );
      });

    return signerCards;
  }, [
    signers,
    selectedSigners,
    selectedSignersFromParams,
    scheme,
    signerMap,
    vaultKeys,
    keyToRotate,
    showSelection,
    colorMode,
    setSelectedSigners,
    setVaultKeys,
    showToast,
    setCreating,
  ]);

  const isDarkMode = colorMode === 'dark';
  const signer: Signer = keyToRotate ? signerMap[getKeyUID(keyToRotate)] : null;

  return (
    <Box style={styles.signerContainer}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Box style={styles.signerInnetContainer}>
          <Box style={{ marginRight: wp(10), marginBottom: hp(20), flexDirection: 'row' }}>
            <Text color={`${colorMode}.primaryText`} style={styles.title} numberOfLines={2}>
              {keyToRotate
                ? `Select the key to be rotated with ${getSignerNameFromType(signer.type)} (${
                    keyToRotate.masterFingerprint
                  })`
                : isReserveKeyFlow
                ? 'Select your Inheritance Key'
                : isEmergencyKeyFlow
                ? 'Select your Emergency Key'
                : isCollaborativeFlow
                ? 'Select keys'
                : scheme.n == 1
                ? 'Select a key for your wallet'
                : `Select ${scheme.n} keys for your wallet`}
            </Text>
            {!isCollaborativeFlow && (
              <Box style={styles.addKeyBtnWrapper}>
                <AddKeyButton
                  short
                  onPress={() =>
                    navigation.dispatch(
                      CommonActions.navigate('SignerCategoryList', {
                        scheme,
                        vaultId,
                        vaultType,
                        vaultSigners: vaultKeys,
                      })
                    )
                  }
                />
              </Box>
            )}
          </Box>
          {signers.length ? (
            <Box>
              <Box style={styles.addedSigners}>
                {!isCollaborativeFlow && !isReserveKeyFlow && !isEmergencyKeyFlow ? (
                  <>{renderSigners(signerFilters)}</>
                ) : isReserveKeyFlow ? (
                  <>{renderReservedKeys()}</>
                ) : isEmergencyKeyFlow ? (
                  <>{renderEmergencyKeys()}</>
                ) : signers.filter(
                    (signer) => signer.type === SignerType.KEEPER && !signer.archived
                  ).length ? (
                  <>{renderCollaborativeSigners()}</>
                ) : (
                  <EmptyListIllustration listType="keys" />
                )}
              </Box>
            </Box>
          ) : (
            <EmptyListIllustration listType="keys" />
          )}
          <HardwareModalMap
            visible={showSSModal}
            close={closeSSModal}
            type={SignerType.POLICY_SERVER}
            mode={InteracationMode.VAULT_ADDITION}
            isMultisig={isMultisig}
            primaryMnemonic={primaryMnemonic}
            addSignerFlow={false}
            vaultId={vaultId}
            vaultSigners={vaultKeys}
          />
          <HardwareModalMap
            visible={visibleImportXpub}
            close={() => setVisibleImportXpub(false)}
            type={modalContent?.clickedSigner?.type}
            mode={InteracationMode.VAULT_ADDITION}
            isMultisig={isMultisig}
            primaryMnemonic={primaryMnemonic}
            addSignerFlow={false}
            vaultId={vaultId}
            vaultSigners={vaultKeys}
          />
          <KeeperModal
            dismissible
            close={() => setShowSignerModal(false)}
            visible={showSignerModal}
            title={modalContent.title}
            subTitle={modalContent.subtitle || ''}
            modalBackground={`${colorMode}.modalWhiteBackground`}
            buttonTextColor={`${colorMode}.buttonText`}
            buttonBackground={`${colorMode}.pantoneGreen`}
            textColor={`${colorMode}.textGreen`}
            subTitleColor={`${colorMode}.modalSubtitleBlack`}
            subTitleWidth={wp(280)}
            showCloseIcon={true}
            DarkCloseIcon={isDarkMode}
            Content={() => (
              <SignerUnavailableContent
                modalContent={modalContent}
                setShowSignerModal={setShowSignerModal}
                setVisibleImportXpub={setVisibleImportXpub}
              />
            )}
          />
        </Box>
      </ScrollView>
    </Box>
  );
}

function AddSigningDevice() {
  const { colorMode } = useColorMode();
  const [vaultCreating, setCreating] = useState(false);
  const navigation = useNavigation();
  const route = useRoute() as {
    params: {
      isInheritance: boolean;
      scheme: VaultScheme;
      name: string;
      description: string;
      vaultId: string;
      keyToRotate?: VaultSigner;
      parentScreen?: string;
      onGoBack?: any;
      coSigners?: any;
      isSSAddition?: boolean;
      addedSigner?: Signer;
      addSignerFlow?: boolean;
      showModal?: boolean;
      currentBlockHeight?: number;
      selectedSignersFromParams?: Signer[];
      isAddInheritanceKey?: boolean;
      isAddEmergencyKey?: boolean;
      isNewSchemeFlow?: boolean;
      signerFilters?: SignerType | Array<SignerType>;
      hasInitialTimelock?: boolean;
    };
  };
  const {
    name = 'Vault',
    description = '',
    isInheritance = false,
    vaultId = '',
    scheme: schemeParam,
    keyToRotate,
    parentScreen = '',
    onGoBack,
    coSigners,
    isSSAddition = false,
    addedSigner,
    selectedSignersFromParams,
    isAddInheritanceKey: isAddInheritanceKeyParam = false,
    isAddEmergencyKey: isAddEmergencyKeyParam = false,
    hasInitialTimelock,
    isNewSchemeFlow = false,
    currentBlockHeight,
    signerFilters = [],
  } = route.params;
  const { showToast } = useToastMessage();
  const { relayVaultUpdateLoading } = useAppSelector((state) => state.bhr);
  const { translations } = useContext(LocalizationContext);
  const { vault: vaultTranslation, wallet: walletTranslation } = translations;
  const [keyAddedModalVisible, setKeyAddedModalVisible] = useState(false);

  const { signers } = useSigners('', false);
  // filter out archived and hidden signers, along w/ external server keys
  const activeSigners = signers.filter(
    (signer) =>
      !signer.archived &&
      !signer.hidden &&
      !(signer.isExternal && signer.type === SignerType.POLICY_SERVER)
  );

  const { signerMap } = useSignerMap();
  const [selectedSigners, setSelectedSigners] = useState(new Map());
  const [vaultKeys, setVaultKeys] = useState<VaultSigner[]>([]);
  const { activeVault, allVaults } = useVault({ vaultId });
  const scheme = isNewSchemeFlow ? schemeParam : activeVault ? activeVault.scheme : schemeParam;
  const isAddInheritanceKey = isNewSchemeFlow
    ? isAddInheritanceKeyParam
    : activeVault
    ? activeVault.scheme?.miniscriptScheme?.usedMiniscriptTypes?.includes(
        MiniscriptTypes.INHERITANCE
      )
    : isAddInheritanceKeyParam;
  const isAddEmergencyKey = isNewSchemeFlow
    ? isAddEmergencyKeyParam
    : activeVault
    ? activeVault.scheme?.miniscriptScheme?.usedMiniscriptTypes?.includes(MiniscriptTypes.EMERGENCY)
    : isAddEmergencyKeyParam;
  const isCollaborativeWallet = activeVault?.type == VaultType.COLLABORATIVE;
  const isCollaborativeFlow = parentScreen === SETUPCOLLABORATIVEWALLET;
  const isAssistedWallet = activeVault?.type == VaultType.ASSISTED;
  const [hotWalletSelected, setHotWalletSelected] = useState(false);
  const [hotWalletInstanceNum, setHotWalletInstanceNum] = useState(false);

  const isReserveKeyFlow = parentScreen === ADDRESERVEKEY;
  const isEmergencyKeyFlow = parentScreen === ADDEMERGENCYKEY;
  const [externalKeyAddedModal, setExternalKeyAddedModal] = useState(false);
  const [addedKey, setAddedKey] = useState(null);

  const { areSignersValid, amfSigners, invalidSS, invalidMessage } = useSignerIntel({
    scheme,
    vaultKeys,
    selectedSigners,
    existingKeys: activeVault?.signers || [],
  });

  const {
    relayVaultUpdate,
    relayVaultError,
    realyVaultErrorMessage,
    relaySignersUpdate,
    realySignersUpdateErrorMessage,
    relaySignersUpdateLoading,
    realySignersAdded,
  } = useAppSelector((state) => state.bhr);

  const dispatch = useDispatch();

  const [generatedVaultId, setGeneratedVaultId] = useState('');
  const newVault = allVaults.filter((v) => v.id === generatedVaultId)[0];
  const [vaultCreatedModalVisible, setVaultCreatedModalVisible] = useState(false);
  const [inProgress, setInProgress] = useState(false);

  const handleModalClose = () => {
    setKeyAddedModalVisible(false);
  };

  useEffect(() => {
    if (relaySignersUpdateLoading) {
      setInProgress(true);
    }
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

  useEffect(() => {
    if (relaySignersUpdate) {
      setInProgress(false);
      if (realySignersAdded && navigation.isFocused()) {
        setKeyAddedModalVisible(true);
      }
      dispatch(resetSignersUpdateState());
    }
    return () => {
      dispatch(resetSignersUpdateState());
    };
  }, [relaySignersUpdate]);

  useEffect(() => {
    setInitialKeys(
      activeVault,
      vaultType,
      scheme,
      signerMap,
      setVaultKeys,
      setSelectedSigners,
      selectedSigners,
      keyToRotate
    );
  }, []);

  function VaultCreatedModalContent(vault: Vault) {
    const tags = ['Vault', `${vault.scheme.m}-of-${vault.scheme.n}`];
    return (
      <Box>
        <Box backgroundColor={`${colorMode}.seashellWhite`} style={styles.walletVaultInfoContainer}>
          <Box style={styles.pillsContainer}>
            {tags?.map((tag, index) => {
              return (
                <CardPill
                  key={tag}
                  heading={tag}
                  backgroundColor={
                    index % 2 !== 0 ? null : `${colorMode}.SignleSigCardPillBackColor`
                  }
                />
              );
            })}
          </Box>
          <Box style={styles.walletVaultInfoWrapper}>
            <Box style={styles.iconWrapper}>
              <HexagonIcon
                width={44}
                height={38}
                backgroundColor="rgba(47, 79, 79, 1)"
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
        </Box>
        <Box>
          <Text color={`${colorMode}.secondaryText`} style={styles.descText}>
            {vaultTranslation.VaultCreatedModalDesc}
          </Text>
        </Box>
      </Box>
    );
  }

  function SingleSigWallet(vault: Vault) {
    const tags = ['SINGLE-KEY', 'COLD'];
    return (
      <Box>
        <Box backgroundColor={`${colorMode}.seashellWhite`} style={styles.walletVaultInfoContainer}>
          <Box style={styles.pillsContainer}>
            {tags?.map((tag, index) => {
              return (
                <CardPill
                  key={tag}
                  heading={tag}
                  backgroundColor={
                    index % 2 !== 0 ? null : `${colorMode}.SignleSigCardPillBackColor`
                  }
                />
              );
            })}
          </Box>
          <Box style={styles.walletVaultInfoWrapper}>
            <Box style={styles.iconWrapper}>
              <HexagonIcon
                width={44}
                height={38}
                backgroundColor="rgba(47, 79, 79, 1)"
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
        </Box>
        <Box>
          <Text color={`${colorMode}.secondaryText`} style={styles.descText}>
            {vaultTranslation.VaultCreatedModalDesc}
          </Text>
        </Box>
      </Box>
    );
  }

  const viewVault = () => {
    setVaultCreatedModalVisible(false);
    const navigationState = {
      index: 1,
      routes: [
        { name: 'Home' },
        {
          name: 'VaultDetails',
          params: { vaultId: generatedVaultId, vaultTransferSuccessful: true },
        },
      ],
    };
    navigation.dispatch(CommonActions.reset(navigationState));
  };

  const vaultType = getVaultType({
    activeVault,
    isCollaborativeWallet,
    isSSAddition,
    isAssistedWallet,
    isTimeLock: hasInitialTimelock,
    isInheritance: isAddInheritanceKey,
    isEmergency: isAddEmergencyKey,
    scheme,
  });

  const maxKeys = scheme?.miniscriptScheme?.usedMiniscriptTypes?.includes(
    MiniscriptTypes.INHERITANCE
  )
    ? scheme.n + 1
    : scheme.n;

  if (selectedSigners.size >= maxKeys) {
    // Handle the case where the selectedSigners exceed the maxKeys
    console.warn('Selected signers exceed the maximum allowed');
  }

  return (
    <Box backgroundColor={`${colorMode}.primaryBackground`} flex={1}>
      <SafeAreaView style={styles.topContainer}>
        <Box style={styles.topSection}>
          <WalletHeader title={vaultTranslation.selectYourWalletKeys} />
        </Box>
        <VaultMigrationController
          vaultCreating={vaultCreating}
          vaultKeys={vaultKeys}
          scheme={scheme}
          name={name}
          description={description}
          vaultId={vaultId}
          setGeneratedVaultId={setGeneratedVaultId}
          setCreating={setCreating}
          vaultType={vaultType}
          currentBlockHeight={currentBlockHeight}
          miniscriptTypes={[
            ...(hasInitialTimelock ? [MiniscriptTypes.TIMELOCKED] : []),
            ...(isAddInheritanceKey ? [MiniscriptTypes.INHERITANCE] : []),
            ...(isAddEmergencyKey ? [MiniscriptTypes.EMERGENCY] : []),
          ]}
          setVaultCreatedModalVisible={setVaultCreatedModalVisible}
        />
        <Box flex={1}>
          <Signers
            keyToRotate={keyToRotate}
            showSelection={true}
            signers={activeSigners}
            selectedSigners={selectedSigners}
            setSelectedSigners={setSelectedSigners}
            scheme={scheme}
            colorMode={colorMode}
            vaultKeys={vaultKeys}
            setVaultKeys={setVaultKeys}
            showToast={showToast}
            navigation={navigation}
            vaultId={vaultId}
            signerMap={signerMap}
            setCreating={setCreating}
            isCollaborativeFlow={isCollaborativeFlow}
            isReserveKeyFlow={isReserveKeyFlow}
            isEmergencyKeyFlow={isEmergencyKeyFlow}
            signerFilters={signerFilters}
            coSigners={coSigners}
            setExternalKeyAddedModal={setExternalKeyAddedModal}
            setAddedKey={setAddedKey}
            selectedSignersFromParams={selectedSignersFromParams}
            setHotWalletSelected={setHotWalletSelected}
            setHotWalletInstanceNum={setHotWalletInstanceNum}
            vaultType={vaultType}
            activeVault={activeVault}
          />
        </Box>
        <Footer
          amfSigners={amfSigners}
          invalidSS={invalidSS}
          invalidMessage={invalidMessage}
          areSignersValid={areSignersValid || hotWalletSelected}
          relayVaultUpdateLoading={relayVaultUpdateLoading}
          colorMode={colorMode}
          setCreating={setCreating}
          isCollaborativeFlow={isCollaborativeFlow}
          isReserveKeyFlow={isReserveKeyFlow}
          isEmergencyKeyFlow={isEmergencyKeyFlow}
          isAddInheritanceKey={isAddInheritanceKey}
          isAddEmergencyKey={isAddEmergencyKey}
          hasInitialTimelock={hasInitialTimelock}
          currentBlockHeight={currentBlockHeight}
          onGoBack={onGoBack}
          vaultKeys={vaultKeys}
          selectedSigners={selectedSigners}
          name={name}
          description={description}
          scheme={scheme}
          vaultId={vaultId}
          isHotWallet={hotWalletSelected}
          vaultType={vaultType}
          hotWalletInstanceNum={hotWalletInstanceNum}
          signers={activeSigners}
          keyToRotate={keyToRotate}
          activeVault={activeVault}
        />
        <KeeperModal
          dismissible
          close={() => {}}
          visible={vaultCreatedModalVisible}
          title={
            keyToRotate ? vaultTranslation.keyReplacedSuccessfully : walletTranslation.WalletCreated
          }
          subTitle={
            keyToRotate
              ? walletTranslation.yourWalletKeyWasSuccessfullyReplaced
              : `${walletTranslation.your} ${newVault?.scheme?.m}-of-${newVault?.scheme?.n} ${walletTranslation.testVault}`
          }
          Content={
            keyToRotate
              ? () => {
                  return (
                    <Box flex={1} alignItems="center">
                      <SuccessIcon />
                    </Box>
                  );
                }
              : isSSAddition
              ? () => SingleSigWallet(newVault)
              : () => VaultCreatedModalContent(newVault)
          }
          buttonText={walletTranslation.ViewWallet}
          buttonCallback={viewVault}
          secondaryCallback={viewVault}
          modalBackground={`${colorMode}.modalWhiteBackground`}
          buttonTextColor={`${colorMode}.buttonText`}
          buttonBackground={`${colorMode}.pantoneGreen`}
          textColor={`${colorMode}.textGreen`}
          subTitleColor={`${colorMode}.modalSubtitleBlack`}
          subTitleWidth={wp(280)}
          showCloseIcon={false}
        />
        <KeyAddedModal
          visible={externalKeyAddedModal}
          close={() => {
            setExternalKeyAddedModal(false);
          }}
          signer={addedKey}
        />
        <KeyAddedModal
          visible={keyAddedModalVisible}
          close={handleModalClose}
          signer={addedSigner}
        />
      </SafeAreaView>
      {inProgress && <ActivityIndicatorView visible={inProgress} />}
    </Box>
  );
}

const styles = StyleSheet.create({
  topContainer: {
    flex: 1,
  },
  topSection: {
    paddingHorizontal: 20,
    paddingTop: hp(15),
  },
  addedSigners: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginLeft: hp(20),
  },
  signerItem: {
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  bottomContainer: {
    gap: 10,
    paddingHorizontal: wp(32),
    paddingBottom: hp(15),
    paddingTop: hp(15),
  },
  noteContainer: {
    width: wp(307),
  },
  signerContainer: {
    flex: 1,
  },
  signerInnetContainer: {
    flex: 1,
    marginTop: hp(35),
  },
  title: {
    marginLeft: wp(25),
    fontSize: 14,
    flex: -1,
  },
  walletVaultInfoContainer: {
    paddingHorizontal: 15,
    paddingVertical: 20,
    marginVertical: 20,
    borderRadius: 10,
  },
  pillsContainer: {
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'flex-end',
    marginBottom: 10,
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
  descText: {
    fontSize: 14,
    width: wp(300),
    marginBottom: hp(18),
  },
  illustrationContainer: {
    alignSelf: 'center',
    marginTop: hp(18),
    marginBottom: hp(30),
  },
  desc: {
    marginBottom: hp(18),
  },
  externalKeyModal: {
    alignItems: 'center',
  },
  externalKeyIllustration: {
    marginBottom: hp(20),
  },
  externalKeyText: {
    marginBottom: hp(20),
  },
  cautionIllustration: {
    alignSelf: 'center',
    marginBottom: hp(30),
  },
  timelockContent: {
    marginBottom: hp(10),
  },
  buttonContainer: {
    marginTop: hp(30),
  },
  emptyWrapper: {
    alignSelf: 'center',
    width: '90%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: hp(35),
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: hp(3),
  },
  emptySubText: {
    fontSize: 14,
    lineHeight: 20,
    width: wp(206),
    textAlign: 'center',
    marginBottom: hp(30),
  },
  addKeyBtnWrapper: {
    flex: 1,
    minWidth: wp(110),
    marginLeft: wp(15),
    marginRight: wp(25),
    marginTop: hp(1),
  },
  unAvailableIllustration: {
    alignItems: 'center',
    marginBottom: hp(30),
  },
  modalButtonContainer: {
    marginTop: hp(40),
  },
});

export default SentryErrorBoundary(AddSigningDevice);
