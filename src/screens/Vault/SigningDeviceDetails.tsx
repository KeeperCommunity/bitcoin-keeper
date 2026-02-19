import React, { useContext, useEffect, useState } from 'react';
import { Platform, StyleSheet, TouchableOpacity, Vibration } from 'react-native';
import { Box, Center, useColorMode } from 'native-base';
import { CommonActions, StackActions, useNavigation } from '@react-navigation/native';
import { useDispatch } from 'react-redux';
import Text from 'src/components/KeeperText';
import { ScrollView } from 'react-native-gesture-handler';
import { hp, wp } from 'src/constants/responsive';
import KeeperHeader from 'src/components/KeeperHeader';
import useToastMessage from 'src/hooks/useToastMessage';
import KeeperModal from 'src/components/KeeperModal';
import SkipHealthCheck from 'src/assets/images/skipHealthCheck.svg';
import MobileKeyModalIllustration from 'src/assets/images/mobile-key-illustration.svg';
import WalletIcon from 'src/assets/images/wallet-white.svg';
import VaultIcon from 'src/assets/images/vault-white.svg';
import CollaborativeIcon from 'src/assets/images/collaborative_vault_white.svg';
import SettingIcon from 'src/assets/images/settings-gear.svg';
import SettingIconLight from 'src/assets/images/settings-gear-green.svg';
import HealthCheckLight from 'src/assets/images/health-check-green.svg';
import HealthCheckDark from 'src/assets/images/health-check-white.svg';
import ChangeKeyLight from 'src/assets/images/change-key-green.svg';
import ChangeKeyDark from 'src/assets/images/change-key-white.svg';
import EmptyStateLight from 'src/assets/images/empty-activity-illustration-light.svg';
import EmptyStateDark from 'src/assets/images/empty-activity-illustration-dark.svg';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import {
  EntityKind,
  SignerType,
  VaultType,
  VisibilityType,
  XpubTypes,
} from 'src/services/wallets/enums';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import useVault from 'src/hooks/useVault';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import KeeperFooter from 'src/components/KeeperFooter';
import { KEEPER_KNOWLEDGEBASE } from 'src/utils/service-utilities/config';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import useSignerMap from 'src/hooks/useSignerMap';
import useSigners from 'src/hooks/useSigners';
import { getPsbtForHwi, getSignerDescription, getSignerNameFromType } from 'src/hardware';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { useIndicatorHook } from 'src/hooks/useIndicatorHook';
import { uaiType } from 'src/models/interfaces/Uai';
import { ConciergeTag } from 'src/models/enums/ConciergeTag';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { Signer, Vault } from 'src/services/wallets/interfaces/vault';
import PasscodeVerifyModal from 'src/components/Modal/PasscodeVerify';
import BackupModalContent from 'src/screens/AppSettings/BackupModal';
import { getPersistedDocument } from 'src/services/documents';
import { generateDataFromPSBT, getAccountFromSigner, getKeyUID } from 'src/utils/utilities';
import idx from 'idx';
import Colors from 'src/theme/Colors';
import WalletCopiableData from 'src/components/WalletCopiableData';
import { captureError } from 'src/services/sentry';
import {
  findChangeFromReceiverAddresses,
  findVaultFromSenderAddress,
  getKeyExpression,
} from 'src/utils/service-utilities/utils';
import ConciergeNeedHelp from 'src/assets/images/conciergeNeedHelp.svg';
import { credsAuthenticated } from 'src/store/reducers/login';
import { Psbt, script } from 'bitcoinjs-lib';
import { resetSignersUpdateState } from 'src/store/reducers/bhr';
import SignerCard from '../AddSigner/SignerCard';
import { SDIcons } from './SigningDeviceIcons';
import IdentifySignerModal from './components/IdentifySignerModal';
import HardwareModalMap, { InteracationMode } from './HardwareModalMap';
import ShareKeyModalContent from './components/ShareKeyModalContent';
import STModalContent from './components/STModalContent';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import { HCESession, HCESessionContext } from 'react-native-hce';
import NFC from 'src/services/nfc';
import nfcManager, { NfcTech } from 'react-native-nfc-manager';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import HexagonIcon from 'src/components/HexagonIcon';

export const SignersReqVault = [
  SignerType.LEDGER,
  SignerType.TREZOR,
  SignerType.BITBOX02,
  SignerType.PORTAL,
  SignerType.KEYSTONE,
];

function EmptyActivityView({ colorMode, isDarkMode }) {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerTranslations } = translations;
  return (
    <Box style={styles.emptyWrapper}>
      <Text color={`${colorMode}.secondaryText`} style={styles.emptyText} medium>
        {signerTranslations.noActivityDetected}
      </Text>
      <Text color={`${colorMode}.secondaryText`} style={styles.emptySubText}>
        {signerTranslations.signerNotLinked}
      </Text>
      <Box style={styles.emptyStateContainer}>
        {!isDarkMode ? <EmptyStateLight /> : <EmptyStateDark />}
      </Box>
    </Box>
  );
}

const getSignerContent = (type: SignerType) => {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerTranslations } = translations;
  switch (type) {
    case SignerType.COLDCARD:
      return {
        title: 'Coldcard',
        subTitle: signerTranslations.coldCardInfo,
        assert: <ThemedSvg name={'coldCard_illustration'} />,
        description: signerTranslations.coldCardDesx,
        FAQ: 'https://coldcard.com/docs/faq',
      };
    case SignerType.TAPSIGNER:
      return {
        title: 'TAPSIGNER',
        subTitle: signerTranslations.tapsignerInfo,
        assert: <ThemedSvg name={'tapSigner_illustration'} />,
        description: signerTranslations.tapsignerDes,
        FAQ: 'https://tapsigner.com/faq',
      };
    case SignerType.LEDGER:
      return {
        title: 'LEDGER',
        subTitle: signerTranslations.ledgerInfo,
        assert: <ThemedSvg name={'ledger_illustration'} width={180} height={180} />,
        description: '',
        FAQ: 'https://support.ledger.com/hc/en-us/categories/4404369571601?support=true',
      };
    case SignerType.SEEDSIGNER:
      return {
        title: 'SeedSigner',
        subTitle: signerTranslations.seedSigerInfo,
        assert: <ThemedSvg name={'seedSigner_illustration'} />,
        description: signerTranslations.seedSigerDes,
        FAQ: 'https://seedsigner.com/faqs/',
      };
    case SignerType.KEYSTONE:
      return {
        title: 'Keystone',
        subTitle: signerTranslations.keyStoneInfo,
        assert: <ThemedSvg name={'keyStone_illustration'} />,
        description: signerTranslations.keystoneDes,
        FAQ: 'https://support.keyst.one/miscellaneous/faq',
      };
    case SignerType.PASSPORT:
      return {
        title: 'Foundation Passport',
        subTitle: signerTranslations.foundationInfo,
        assert: <ThemedSvg name={'passport_illustration'} />,
        description: signerTranslations.foundationDesc,
        FAQ: 'https://docs.foundationdevices.com',
      };
    case SignerType.MOBILE_KEY:
      return {
        title: 'Mobile Key',
        subTitle: signerTranslations.mobileKeyInfo,
        assert: <ThemedSvg name={'external_Key_illustration'} />,
        description: signerTranslations.mobileKeyDes,
        FAQ: KEEPER_KNOWLEDGEBASE,
      };
    case SignerType.SEED_WORDS:
      return {
        title: 'Seed Key',
        subTitle: signerTranslations.seedKeyInfo,
        assert: <ThemedSvg name={'SeedSetupIllustration'} />,
        description: signerTranslations.seedKeyDes,
        FAQ: '',
      };
    case SignerType.MY_KEEPER:
    case SignerType.KEEPER:
      return {
        title: `${getSignerNameFromType(type)} as signer`,
        subTitle: signerTranslations.externalKeyinfo,
        assert: <ThemedSvg name={'external_Key_illustration'} />,
        description: signerTranslations.externalKeyDes,
        FAQ: KEEPER_KNOWLEDGEBASE,
      };
    case SignerType.POLICY_SERVER:
      return {
        title: 'Server Key',
        subTitle: signerTranslations.serverKeyinfo,
        assert: <ThemedSvg name={'signing_server_illustration'} />,
        description: signerTranslations.serverKeyDesc,
        FAQ: '',
      };
    case SignerType.BITBOX02:
      return {
        title: 'Bitbox 02',
        subTitle: signerTranslations.biTBoxInfo,
        assert: <ThemedSvg name={'bitBox_illustration'} />,
        description: signerTranslations.bitBoxDesx,
        FAQ: 'https://shiftcrypto.ch/support/',
      };
    case SignerType.TREZOR:
      return {
        title: 'Trezor',
        subTitle: signerTranslations.trezorInfo,
        assert: <ThemedSvg name={'trezor_illustration'} />,
        description: signerTranslations.trezorDes,
        FAQ: 'https://trezor.io/support',
      };
    case SignerType.JADE:
      return {
        title: 'Jade Blockstream',
        subTitle: signerTranslations.jadeInfo,
        assert: <ThemedSvg name={'jade_illustration'} />,
        description: signerTranslations.jadeDesc,
        FAQ: 'https://help.blockstream.com/hc/en-us/categories/900000061906-Blockstream-Jade',
      };
    case SignerType.SPECTER:
      return {
        title: 'Specter DIY',
        subTitle: signerTranslations.specterInfo,
        assert: <ThemedSvg name={'specter_illustration'} />,
        description: signerTranslations.specterDesc,
        FAQ: 'https://docs.specter.solutions/diy/faq/',
      };
    case SignerType.KRUX:
      return {
        title: 'Krux',
        subTitle: signerTranslations.kruxInfo,
        assert: <ThemedSvg name={'krux_illustration'} />,
        description: signerTranslations.kruxDesc,
        FAQ: 'https://selfcustody.github.io/krux/faq/',
      };
    default:
      return {
        title: '',
        subTitle: '',
        assert: null,
        description: '',
        FAQ: '',
      };
  }
};

function SigningDeviceDetails({ route }) {
  const { translations } = useContext(LocalizationContext);
  const {
    signer: signerTranslations,
    BackupWallet: strings,
    common,
    error: errorText,
    wallet: walletText,
    vault: vaultText,
    healthcheck: healthcheckText,
  } = translations;
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const { vaultKey, vaultId, isInheritanceKey, isEmergencyKey, signerId, vaultSigners, isUaiFlow } =
    route.params;
  const { signers } = useSigners();
  const currentSigner =
    signers.find((signer) => getKeyUID(signer) === signerId) ||
    signers.find((signer) => signer.masterFingerprint === signerId);
  const { signerMap } = useSignerMap();
  const signer: Signer = currentSigner || signerMap[getKeyUID(vaultKey)];
  const [detailModal, setDetailModal] = useState(false);
  const [details, setDetails] = useState('');

  const [skipHealthCheckModalVisible, setSkipHealthCheckModalVisible] = useState(false);
  const [visible, setVisible] = useState(isUaiFlow);
  const [identifySignerModal, setIdentifySignerModal] = useState(false);
  const { showToast } = useToastMessage();
  const { activeVault, allVaults } = useVault({ vaultId, includeArchived: false });
  const allUnhiddenVaults = allVaults.filter((vault) => {
    return idx(vault, (_) => _.presentationData.visibility) !== VisibilityType.HIDDEN;
  });
  const { primaryMnemonic, id: appRecoveryKeyId }: KeeperApp = useQuery(RealmSchema.KeeperApp).map(
    getJSONFromRealmObject
  )[0];
  const { entityBasedIndicator } = useIndicatorHook({ entityId: signer.id });
  const { typeBasedIndicator } = useIndicatorHook({
    types: [uaiType.RECOVERY_PHRASE_HEALTH_CHECK],
  });
  const [showMobileKeyModal, setShowMobileKeyModal] = useState(false);
  const [confirmPassVisible, setConfirmPassVisible] = useState(false);
  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [shareKeyModal, setShareKeyModal] = useState(false);
  const [stModal, setStModal] = useState(false);
  const isDarkMode = colorMode === 'dark';
  const data = useQuery(RealmSchema.BackupHistory);
  const signerVaults: Vault[] = [];

  const [nfcVisible, setNfcVisible] = React.useState(false);
  const { session } = useContext(HCESessionContext);
  const manage_signer_backGround = ThemedColor({ name: 'manage_signer_backGround' });
  const HexagonIconColor = ThemedColor({ name: 'HexagonIcon' });
  const green_modal_text_color = ThemedColor({ name: 'green_modal_text_color' });
  const green_modal_background = ThemedColor({ name: 'green_modal_background' });
  const green_modal_button_background = ThemedColor({ name: 'green_modal_button_background' });
  const green_modal_button_text = ThemedColor({ name: 'green_modal_button_text' });
  const green_modal_sec_button_text = ThemedColor({ name: 'green_modal_sec_button_text' });
  const signing_CircleIconWrapper = ThemedColor({ name: 'signing_CircleIconWrapper' });

  const cleanUp = () => {
    setNfcVisible(false);
    Vibration.cancel();
    if (isAndroid) {
      NFC.stopTagSession(session);
    }
  };
  useEffect(() => {
    const unsubDisconnect = session.on(HCESession.Events.HCE_STATE_DISCONNECTED, () => {
      cleanUp();
    });
    const unsubConnect = session.on(HCESession.Events.HCE_STATE_WRITE_FULL, () => {
      try {
        const data = idx(session, (_) => _.application.content.content);
        if (!data) {
          showToast(errorText.scanValidPsbt, <ToastErrorIcon />);
          return;
        }
        signPSBT(data);
      } catch (err) {
        captureError(err);
        showToast(common.somethingWrong, <ToastErrorIcon />);
      } finally {
        cleanUp();
      }
    });

    const unsubRead = session.on(HCESession.Events.HCE_STATE_READ, () => {});
    return () => {
      cleanUp();
      unsubRead();
      unsubDisconnect();
      unsubConnect();
    };
  }, [session]);

  useEffect(() => {
    if (isAndroid) {
      if (nfcVisible) {
      } else {
        NFC.stopTagSession(session);
      }
    }
    return () => {
      nfcManager.cancelTechnologyRequest();
    };
  }, [nfcVisible]);

  const isAndroid = Platform.OS === 'android';
  const isIos = Platform.OS === 'ios';

  allUnhiddenVaults.forEach((vault) => {
    const keys = vault.signers;
    for (const key of keys) {
      if (getKeyUID(signer) === getKeyUID(key)) {
        signerVaults.push(vault);
        break;
      }
    }
  });

  if (!signer) {
    return null;
  }
  const fetchKeyExpression = (signer: Signer) => {
    for (const type of [XpubTypes.P2WSH]) {
      if (signer.masterFingerprint && signer.signerXpubs[type] && signer.signerXpubs[type]?.[0]) {
        const keyDescriptor = getKeyExpression(
          signer.masterFingerprint,
          idx(signer, (_) => _.signerXpubs[type][0].derivationPath.replaceAll('h', "'")),
          idx(signer, (_) => _.signerXpubs[type][0].xpub),
          false
        );
        return keyDescriptor;
      }
    }

    throw new Error('Missing key details.');
  };

  useEffect(() => {
    if (!details) {
      setTimeout(() => {
        try {
          const keyDescriptor = fetchKeyExpression(signer);
          setDetails(keyDescriptor);
        } catch (_) {}
      }, 200);
    }
  }, []);

  const { title, subTitle, assert, description } = getSignerContent(signer?.type);
  function SignerContent() {
    return (
      <Box>
        <Center>{assert}</Center>
        <Text color={`${colorMode}.headerWhite`} style={styles.contentDescription}>
          {description}
        </Text>
      </Box>
    );
  }

  function HealthCheckSkipContent() {
    return (
      <Box>
        <Box style={styles.skipHealthIllustration}>
          <SkipHealthCheck />
        </Box>
        <Text>{signerTranslations.manualHealthCheck}</Text>
      </Box>
    );
  }
  const navigateToCosignerDetails = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'CosignerDetails',
        params: { signer },
      })
    );
  };
  const navigateToScanPSBT = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'ScanQR',
        params: {
          title: walletText.scanTransaction,
          subtitle: walletText.ScanQRData,
          onQrScan: signPSBT,
          setup: true,
          type: SignerType.KEEPER,
          isHealthcheck: true,
          signer,
          disableMockFlow: true,
          isPSBT: true,
          importOptions: false,
          isSingning: true,
        },
      })
    );
  };
  function ShareKeyModalData() {
    return (
      <Box>
        <ShareKeyModalContent
          navigation={navigation}
          signer={signer}
          navigateToCosignerDetails={navigateToCosignerDetails}
          setShareKeyModal={setShareKeyModal}
          data={details}
        />
      </Box>
    );
  }
  function StModalContent() {
    return (
      <Box>
        <STModalContent
          navigateToScanPSBT={navigateToScanPSBT}
          setData={signPSBT}
          setStModal={setStModal}
          readFromNFC={readFromNFC}
        />
      </Box>
    );
  }

  const readFromNFC = async () => {
    try {
      if (!isIos) {
        setNfcVisible(true);
        NFC.startTagSession({ session, content: '', writable: true });
      }
      const records = await NFC.read([NfcTech.Ndef]);
      try {
        const psbt = records[0].data;
        signPSBT(psbt);
      } catch (err) {
        captureError(err);
        showToast(errorText.scanValidPsbt, <ToastErrorIcon />);
      }
    } catch (err) {
      cleanUp();
      if (err.toString() === 'Error') {
        console.log('NFC interaction cancelled');
        return;
      }
      captureError(err);
      showToast(common.somethingWrong, <ToastErrorIcon />);
    }
  };

  function MobileKeyModalContent() {
    return (
      <Box>
        <Box style={styles.mobileKeyIllustration}>
          <MobileKeyModalIllustration />
        </Box>
        <Text style={styles.mobileKeyText}>{signerTranslations.MKHealthCheckModalDesc}</Text>
      </Box>
    );
  }

  const navigateToAssignSigner = () => {
    dispatch(resetSignersUpdateState());
    navigation.dispatch(
      CommonActions.navigate({
        name: 'AssignSignerType',
        params: {
          parentNavigation: navigation,
          vault: activeVault,
          signer,
        },
      })
    );
  };

  const signPSBT = async (serializedPSBT) => {
    try {
      let { senderAddresses, receiverAddresses, fees, signerMatched, feeRate, changeAddressIndex } =
        generateDataFromPSBT(serializedPSBT, signer);
      let isMiniscript = false;
      try {
        const psbt = Psbt.fromBase64(serializedPSBT);
        // Check script ASM for Miniscript-specific patterns
        const miniscriptPatterns = ['OP_CHECKLOCKTIMEVERIFY', 'OP_CHECKSEQUENCEVERIFY'];

        psbt.data.inputs.forEach((input) => {
          if (input.witnessUtxo?.script) {
            const witnessScript = script.decompile(input.witnessScript);
            // Convert to ASM format to check opcodes
            const asm = script.toASM(witnessScript);
            isMiniscript = miniscriptPatterns.some((pattern) => asm.includes(pattern));
          }
        });
      } catch (error) {
        console.log('Error checking if miniscript:', error);
      }

      if (!signerMatched) {
        showToast(errorText.signerNotValid, <ToastErrorIcon />);
        navigation.goBack();
        return;
      }
      const activeVault = findVaultFromSenderAddress(allVaults, senderAddresses);
      if (SignersReqVault.includes(signer.type)) {
        if (!activeVault) {
          navigation.goBack();
          throw new Error('Please import the vault before signing');
        }
        const psbtWithGlobalXpub = await getPsbtForHwi(serializedPSBT, activeVault);
        serializedPSBT = psbtWithGlobalXpub.serializedPSBT;
      }
      if (activeVault && changeAddressIndex) {
        receiverAddresses = findChangeFromReceiverAddresses(
          activeVault,
          receiverAddresses,
          parseInt(changeAddressIndex)
        );
      }
      if (activeVault) {
        isMiniscript = !!activeVault?.scheme?.miniscriptScheme;
      }
      if (signer.type === SignerType.BITBOX02) {
        // Update PSBT inputs to use SELECTED_MINISCRIPT_BIP32_DERIVATIONS if they exist
        // This is needed for Miniscript since the BitBox02 only produces one signature,
        // but the Ledger and Coldcard require to pass all bip32 derivations to sign,
        // so the BitBox02 will only produce signature for one of these and we can't control
        // if it's the correct one or not
        const psbt = Psbt.fromBase64(serializedPSBT);
        psbt.data.inputs.map((input) => {
          if (input.unknownKeyVals) {
            const newBip32Derivations = input.unknownKeyVals.find(
              (keyVal) => keyVal.key.toString() === 'SELECTED_MINISCRIPT_BIP32_DERIVATIONS'
            );
            if (newBip32Derivations) {
              const parsed = JSON.parse(Buffer.from(newBip32Derivations.value).toString());

              // PSBT expects bip32Derivation to be an array of:
              // { masterFingerprint: Buffer, pubkey: Buffer, path: string }
              input.bip32Derivation = parsed.map((deriv) => ({
                masterFingerprint: Buffer.from(deriv.masterFingerprint.data),
                pubkey: Buffer.from(deriv.pubkey.data),
                path: deriv.path,
              }));
            }
          }
        });
        serializedPSBT = psbt.toBase64();
      }

      navigation.dispatch(
        StackActions.replace('PSBTSendConfirmation', {
          sender: senderAddresses,
          recipient: receiverAddresses,
          fees,
          signer,
          psbt: serializedPSBT,
          feeRate,
          isMiniscript,
          activeVault,
        })
      );
    } catch (error) {
      console.log('🚀 ~ signPSBT ~ error:', error);
      showToast(error.message);
      captureError(error);
    }
  };

  function FooterIcon({ Icon, showDot = false }) {
    return (
      <Box justifyContent="center" alignItems="center" position="relative">
        <Icon />
        {showDot && <Box style={styles.redDot} />}
      </Box>
    );
  }

  const navigateToSettings = () => {
    navigation.dispatch(
      CommonActions.navigate('SignerAdvanceSettings', {
        signer,
        vaultKey,
        vaultId,
        isMultisig: activeVault?.isMultiSig,
        signerId,
      })
    );
  };

  const getWalletIcon = (wallet) => {
    if (wallet.entityKind === EntityKind.VAULT) {
      if (wallet.type === VaultType.SINGE_SIG) return <WalletIcon />;
      else
        return wallet.type === VaultType.COLLABORATIVE ? (
          <CollaborativeIcon width={15} height={15} />
        ) : (
          <VaultIcon />
        );
    } else {
      return <WalletIcon />;
    }
  };

  const identifySigner = signer.type === SignerType.OTHER_SD;
  const signerFooterItems = [
    signer?.type !== SignerType.POLICY_SERVER &&
      details && {
        text: signerTranslations.magicLinkCTA,
        Icon: () => <FooterIcon Icon={() => <ThemedSvg name={'share_key'} />} />,
        onPress: () => {
          if (signer.type === SignerType.SATOCHIP) {
            // Fix for Satochip keys created with buggy v2.5.8 that have zpub/Zpub instead of xpub
            const xpub = signer.signerXpubs[XpubTypes.P2WPKH][0].xpub;
            const prefix= xpub.substring(0, 4);
            if (prefix === 'zpub' || prefix === 'Zpub') {
              showToast(`This key has an invalid xpub. Please remove and reimport it`, <ToastErrorIcon />);
              return;
            }
          }
          setShareKeyModal(true);
        },
      },
    signer?.type !== SignerType.KEEPER &&
      signer?.type !== SignerType.POLICY_SERVER &&
      signer?.type !== SignerType.UNKOWN_SIGNER &&
      details && {
        text: walletText.SignTransaction,
        Icon: () => <FooterIcon Icon={() => <ThemedSvg name={'sign_transaction'} />} />,
        // onPress: navigateToScanPSBT,
        onPress: () => {
          setStModal(true);
        },
      },
    signer?.type === SignerType.UNKOWN_SIGNER && {
      text: walletText.setDeviceType,
      Icon: () => <FooterIcon Icon={() => <ThemedSvg name={'change_key_icon'} />} />,
      onPress: navigateToAssignSigner,
    },
    signer?.type !== SignerType.MY_KEEPER && {
      text: vaultText.healthCheck,
      Icon: () => (
        <FooterIcon
          Icon={() => <ThemedSvg name="health_check" />}
          showDot={
            (signer.type !== SignerType.MY_KEEPER &&
              entityBasedIndicator?.[signer.id]?.[uaiType.SIGNING_DEVICES_HEALTH_CHECK]) ||
            (signer.type === SignerType.MY_KEEPER &&
              typeBasedIndicator?.[uaiType.RECOVERY_PHRASE_HEALTH_CHECK]?.[appRecoveryKeyId])
          }
        />
      ),
      onPress: () => {
        if (signer.type === SignerType.UNKOWN_SIGNER) {
          navigation.dispatch(
            CommonActions.navigate({
              name: 'AssignSignerType',
              params: {
                parentNavigation: navigation,
                vault: activeVault,
                signer,
              },
            })
          );
        } else if (signer.type === SignerType.MY_KEEPER) {
          setShowMobileKeyModal(true);
        } else {
          setVisible(true);
        }
      },
    },
  ].filter(Boolean);

  const vaultSignerFooterItems = [
    ...(signer.type !== SignerType.MY_KEEPER
      ? [
          {
            text: vaultText.healthCheck,
            Icon: () => (
              <FooterIcon
                Icon={isDarkMode ? HealthCheckDark : HealthCheckLight}
                showDot={
                  entityBasedIndicator?.[signer.masterFingerprint]?.[
                    uaiType.SIGNING_DEVICES_HEALTH_CHECK
                  ]
                }
              />
            ),
            onPress: () => {
              if (signer.type === SignerType.UNKOWN_SIGNER) {
                navigation.dispatch(
                  CommonActions.navigate({
                    name: 'AssignSignerType',
                    params: {
                      parentNavigation: navigation,
                      vault: activeVault,
                      signer,
                    },
                  })
                );
              } else if (signer.type === SignerType.MY_KEEPER) {
                setShowMobileKeyModal(true);
              } else {
                setVisible(true);
              }
            },
          },
        ]
      : []),
    ...(activeVault &&
    ((!isInheritanceKey && !isEmergencyKey) ||
      !activeVault.scheme?.miniscriptScheme?.usedMiniscriptTypes?.length ||
      activeVault.scheme?.miniscriptScheme?.usedMiniscriptTypes?.length < 2)
      ? [
          {
            text: vaultText.changeKey,
            Icon: () => <FooterIcon Icon={() => <ThemedSvg name={'change_key_icon'} />} />,
            onPress: isEmergencyKey
              ? () =>
                  navigation.dispatch(
                    CommonActions.navigate('AddEmergencyKey', {
                      vaultId,
                      name: activeVault.presentationData.name,
                      description: activeVault.presentationData.description,
                      scheme: activeVault.scheme,
                      isAddEmergencyKey: true,
                      currentBlockHeight: null,
                      keyToRotate: signer,
                    })
                  )
              : isInheritanceKey
              ? () =>
                  navigation.dispatch(
                    CommonActions.navigate('AddReserveKey', {
                      vaultId,
                      name: activeVault.presentationData.name,
                      description: activeVault.presentationData.description,
                      scheme: activeVault.scheme,
                      isAddInheritanceKey: true,
                      currentBlockHeight: null,
                      keyToRotate: signer,
                    })
                  )
              : () =>
                  navigation.dispatch(
                    CommonActions.navigate({
                      name: 'AddSigningDevice',
                      merge: true,
                      params: {
                        vaultId,
                        name: activeVault.presentationData.name,
                        description: activeVault.presentationData.description,
                        scheme: activeVault.scheme,
                        keyToRotate: vaultKey,
                      },
                    })
                  ),
          },
        ]
      : []),
    {
      text: common.settings,
      Icon: () => <FooterIcon Icon={isDarkMode ? SettingIcon : SettingIconLight} />,
      onPress: navigateToSettings,
    },
  ];

  const footerItems = !vaultKey ? signerFooterItems : vaultSignerFooterItems;

  return (
    <Box safeAreaTop backgroundColor={manage_signer_backGround} style={[styles.wrapper]}>
      <Box style={styles.topSection}>
        <KeeperHeader
          contrastScreen
          learnMore={signer.type !== SignerType.UNKOWN_SIGNER}
          learnMorePressed={() => setDetailModal(true)}
          learnBackgroundColor={manage_signer_backGround}
          learnTextColor={`${colorMode}.buttonText`}
          mediumTitle
          title={signer?.signerName === 'Signing Server' ? 'Server Key' : signer?.signerName}
          titleColor={`${colorMode}.headerWhite`}
          subTitleColor={`${colorMode}.headerWhite`}
          subtitle={getSignerDescription(signer)}
          icon={
            <CircleIconWrapper
              backgroundColor={signing_CircleIconWrapper}
              icon={SDIcons({ type: signer.type, light: false, width: 26, height: 26 }).Icon}
              image={getPersistedDocument(signer?.extraData?.thumbnailPath)}
            />
          }
          topRightComponent={
            !vaultKey ? (
              <TouchableOpacity
                style={styles.settingIcon}
                onPress={navigateToSettings}
                testID="btn_manage_singner_setting"
              >
                <SettingIcon />
              </TouchableOpacity>
            ) : null
          }
        />
      </Box>
      <Box style={styles.bottomSection} backgroundColor={`${colorMode}.primaryBackground`}>
        <Box style={styles.paddedArea}>
          <Box style={styles.flex1}>
            <Text style={styles.recentHistoryText} color={`${colorMode}.secondaryText`} medium>
              {`Key used in ${signerVaults.length} wallet${signerVaults.length > 1 ? 's' : ''}`}
            </Text>
            {signerVaults.length > 0 ? (
              <ScrollView
                horizontal
                contentContainerStyle={styles.signerVaults}
                showsHorizontalScrollIndicator={false}
              >
                {signerVaults.map((vault) => (
                  <SignerCard
                    key={vault?.id}
                    name={vault?.presentationData.name}
                    description={vault?.presentationData?.description}
                    icon={
                      <HexagonIcon
                        width={38}
                        height={34}
                        backgroundColor={HexagonIconColor}
                        icon={getWalletIcon(vault)}
                      />
                    }
                    showSelection={false}
                    colorVarient="transparent"
                    cardBackground={`${colorMode}.thirdBackground`}
                    customStyle={styles.signerCard}
                    colorMode={colorMode}
                    borderColor={`${colorMode}.separator`}
                  />
                ))}
              </ScrollView>
            ) : (
              <Box style={{ flex: 1 }}>
                <EmptyActivityView colorMode={colorMode} isDarkMode={isDarkMode} />
              </Box>
            )}
            <Box style={styles.fingerprint}>
              <WalletCopiableData
                title={common.signerFingerPrint}
                data={signer.masterFingerprint}
                dataType="fingerprint"
                width="95%"
                height={65}
              />
            </Box>
            <HardwareModalMap
              type={signer?.type}
              visible={visible}
              close={() => setVisible(false)}
              signer={signer}
              skipHealthCheckCallBack={() => {
                setVisible(false);
                setSkipHealthCheckModalVisible(true);
              }}
              mode={InteracationMode.HEALTH_CHECK}
              isMultisig={activeVault?.isMultiSig || true}
              primaryMnemonic={primaryMnemonic}
              vaultId={vaultId}
              addSignerFlow={false}
              vaultSigners={vaultSigners}
              accountNumber={getAccountFromSigner(signer)}
            />
            <KeeperModal
              visible={skipHealthCheckModalVisible}
              close={() => setSkipHealthCheckModalVisible(false)}
              title={healthcheckText.SkippingHealthCheck}
              subTitle={healthcheckText.keepYourSignersSecure}
              buttonText={healthcheckText.confirmAccess}
              secondaryButtonText={healthcheckText.confirmLater}
              buttonTextColor={`${colorMode}.buttonText`}
              buttonCallback={() => {
                dispatch(
                  healthCheckStatusUpdate([
                    {
                      signerId: signer.masterFingerprint,
                      status: hcStatusType.HEALTH_CHECK_MANAUAL,
                    },
                  ])
                );
                showToast(healthcheckText.deviceVerifiedManually);
                setSkipHealthCheckModalVisible(false);
              }}
              secondaryCallback={() => {
                dispatch(
                  healthCheckStatusUpdate([
                    {
                      signerId: signer.masterFingerprint,
                      status: hcStatusType.HEALTH_CHECK_SKIPPED,
                    },
                  ])
                );
                showToast(healthcheckText.deviceHealthCheckSkipped);
                setSkipHealthCheckModalVisible(false);
              }}
              textColor={`${colorMode}.textGreen`}
              subTitleColor={`${colorMode}.modalSubtitleBlack`}
              Content={HealthCheckSkipContent}
            />

            <KeeperModal
              visible={detailModal}
              close={() => setDetailModal(false)}
              title={!signer.isBIP85 ? title : `${title} +`}
              subTitle={subTitle}
              modalBackground={green_modal_background}
              textColor={green_modal_text_color}
              Content={SignerContent}
              subTitleWidth={wp(280)}
              DarkCloseIcon
              buttonText={common.Okay}
              secondaryButtonText={common.needHelp}
              buttonTextColor={green_modal_button_text}
              buttonBackground={green_modal_button_background}
              secButtonTextColor={green_modal_sec_button_text}
              secondaryIcon={<ConciergeNeedHelp />}
              secondaryCallback={() => {
                setDetailModal(false);
                navigation.dispatch(
                  CommonActions.navigate({
                    name: 'CreateTicket',
                    params: {
                      tags: [ConciergeTag.KEYS],
                      screenName: 'signing-device-details',
                    },
                  })
                );
              }}
              buttonCallback={() => setDetailModal(false)}
            />
            <KeeperModal
              visible={showMobileKeyModal}
              close={() => setShowMobileKeyModal(false)}
              title={signerTranslations.performHealthCheckTitle}
              subTitle={signerTranslations.performHealthCheckSubTitle}
              modalBackground={`${colorMode}.modalWhiteBackground`}
              textColor={`${colorMode}.modalWhiteContent`}
              subTitleWidth={wp(280)}
              buttonText={common.continue}
              buttonCallback={() => {
                if (data.length === 0) {
                  dispatch(credsAuthenticated(false));
                  setConfirmPassVisible(true);
                } else {
                  setShowMobileKeyModal(false);
                  navigation.navigate('WalletBackHistory', { isUaiFlow: true });
                }
              }}
              secondaryButtonText={common.back}
              secondaryCallback={() => setShowMobileKeyModal(false)}
              buttonTextColor={`${colorMode}.buttonText`}
              buttonBackground={`${colorMode}.pantoneGreen`}
              Content={MobileKeyModalContent}
            />
            <KeeperModal
              visible={confirmPassVisible}
              closeOnOverlayClick={false}
              close={() => setConfirmPassVisible(false)}
              title={common.confirmPassCode}
              subTitleWidth={wp(240)}
              subTitle={signerTranslations.RKBackupPassSubTitle}
              modalBackground={`${colorMode}.modalWhiteBackground`}
              textColor={`${colorMode}.textGreen`}
              subTitleColor={`${colorMode}.modalSubtitleBlack`}
              Content={() => (
                <PasscodeVerifyModal
                  useBiometrics
                  close={() => {
                    setConfirmPassVisible(false);
                  }}
                  onSuccess={() => {
                    setShowMobileKeyModal(false);
                    setBackupModalVisible(true);
                  }}
                />
              )}
            />
            <KeeperModal
              visible={shareKeyModal}
              close={() => setShareKeyModal(false)}
              title={signerTranslations.shareKeyDetails}
              subTitle={signerTranslations.howToShare}
              modalBackground={`${colorMode}.modalWhiteBackground`}
              textColor={`${colorMode}.textGreen`}
              subTitleColor={`${colorMode}.modalSubtitleBlack`}
              Content={ShareKeyModalData}
            />
            <KeeperModal
              visible={stModal}
              close={() => setStModal(false)}
              title={walletText.scanTransaction}
              subTitle={walletText.scanAndVerifyTransaction}
              modalBackground={`${colorMode}.modalWhiteBackground`}
              textColor={`${colorMode}.textGreen`}
              subTitleColor={`${colorMode}.modalSubtitleBlack`}
              Content={StModalContent}
            />

            <KeeperModal
              visible={backupModalVisible}
              close={() => setBackupModalVisible(false)}
              title={signerTranslations.RKBackupTitle}
              subTitle={signerTranslations.RKBackupSubTitle}
              subTitleWidth={wp(300)}
              modalBackground={`${colorMode}.primaryBackground`}
              subTitleColor={`${colorMode}.secondaryText`}
              textColor={`${colorMode}.modalGreenTitle`}
              showCloseIcon={false}
              buttonText={common.backupNow}
              buttonCallback={() => {
                setBackupModalVisible(false);
                navigation.dispatch(
                  CommonActions.navigate('ExportSeed', {
                    seed: primaryMnemonic,
                    next: true,
                  })
                );
              }}
              Content={BackupModalContent}
            />
            <IdentifySignerModal
              visible={identifySigner && identifySignerModal}
              close={() => setIdentifySignerModal(false)}
              signer={signer}
              secondaryCallback={() => {
                setVisible(true);
              }}
              vaultId={vaultId}
            />
          </Box>
        </Box>
        <Box
          safeAreaBottom
          style={styles.footerWrapper}
          backgroundColor={isDarkMode ? Colors.SecondaryBlack : `${colorMode}.primaryBackground`}
        >
          <KeeperFooter
            marginX={footerItems.length === 2 ? wp(20) : !vaultKey ? 0 : wp(5)}
            wrappedScreen={false}
            items={footerItems}
            fontSize={12}
            backgroundColor={isDarkMode ? Colors.SecondaryBlack : `${colorMode}.primaryBackground`}
          />
          <NfcPrompt visible={nfcVisible} close={cleanUp} ctaText="Done" />
        </Box>
      </Box>
    </Box>
  );
}
const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  container: {
    flex: 1,
    position: 'relative',
  },
  topSection: {
    height: '25%',
    paddingHorizontal: 20,
    paddingTop: hp(15),
  },
  bottomSection: {
    borderTopRightRadius: 30,
    borderTopLeftRadius: 30,
    flex: 1,
  },
  skipHealthIllustration: {
    marginLeft: wp(25),
  },
  walletHeaderWrapper: {
    margin: wp(15),
    flexDirection: 'row',
    width: '100%',
  },
  walletIconWrapper: {
    width: '15%',
  },
  walletIconView: {
    height: 40,
    width: 40,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletDescText: {
    fontSize: 14,
  },
  walletNameWrapper: {
    width: '85%',
    marginLeft: 10,
  },
  walletNameText: {
    fontSize: 20,
  },
  recentHistoryText: {
    fontSize: 16,
    paddingTop: hp(43),
    paddingBottom: hp(10),
    paddingHorizontal: wp(10),
  },
  redDot: {
    width: 10,
    height: 10,
    borderRadius: 10 / 2,
    backgroundColor: 'red',
    position: 'absolute',
    top: 0,
    right: -10,
    borderWidth: 1,
    borderColor: 'white',
  },
  contentDescription: {
    fontSize: 14,
    marginTop: hp(25),
  },
  circleIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flex1: {
    flexGrow: 1,
  },
  healthCheckContainer: {
    marginHorizontal: wp(15),
  },
  mobileKeyIllustration: {
    alignSelf: 'center',
    marginBottom: hp(20),
  },
  mobileKeyText: {
    width: wp(280),
    marginBottom: hp(20),
  },
  healthCheckListContainer: {
    height: hp(520),
  },
  itemBox: {
    padding: 4,
    marginLeft: 10,
    borderLeftWidth: 1,
    width: '100%',
    position: 'relative',
  },
  dotContainer: {
    zIndex: 999,
    position: 'absolute',
    left: -8,
    padding: 4,
    borderRadius: 15,
  },
  title: {
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 20,
    opacity: 0.7,
  },
  date: {
    fontSize: 11,
    marginLeft: 20,
    opacity: 0.7,
  },
  noteWrapper: {
    marginHorizontal: '5%',
  },
  healthCheckList: {
    flexGrow: 1,
    paddingBottom: hp(220),
  },
  emptyWrapper: {
    marginTop: hp(15),
    alignItems: 'center',
    justifyContent: 'center',
    height: '90%',
  },
  emptyStateContainer: {
    marginLeft: wp(20),
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
  signerVaults: {
    gap: 5,
  },
  signerCard: {
    borderWidth: 1,
    borderColor: Colors.secondaryLightGrey,
    height: hp(125),
    width: wp(161),
    paddingTop: 5,
    paddingLeft: 14,
  },
  fingerprint: {
    alignItems: 'center',
  },
  paddedArea: {
    flexGrow: 1,
    paddingHorizontal: '5%',
  },
  footerWrapper: {
    justifyContent: 'center',
  },
  settingIcon: {
    width: wp(40),
    height: wp(40),
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default SigningDeviceDetails;
