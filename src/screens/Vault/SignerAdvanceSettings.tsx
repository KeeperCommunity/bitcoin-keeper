import Text from 'src/components/KeeperText';
import { Box, Center, ScrollView, useColorMode, View } from 'native-base';
import { CommonActions, StackActions, useNavigation } from '@react-navigation/native';
import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Clipboard, Dimensions, StyleSheet, TouchableOpacity } from 'react-native';
import { Signer, Vault, VaultSigner } from 'src/services/wallets/interfaces/vault';
import ConciergeNeedHelp from 'src/assets/images/conciergeNeedHelp.svg';
import ScreenWrapper from 'src/components/ScreenWrapper';
import {
  SignerCategory,
  SignerType,
  VaultType,
  VisibilityType,
  XpubTypes,
} from 'src/services/wallets/enums';
import TickIcon from 'src/assets/images/icon_tick.svg';
import SigningServerIcon from 'src/assets/images/server_light.svg';
import idx from 'idx';
import { useDispatch } from 'react-redux';
import { updateSignerDetails } from 'src/store/sagaActions/wallets';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import useVault from 'src/hooks/useVault';
import WarningIllustration from 'src/assets/images/warning.svg';
import KeeperModal from 'src/components/KeeperModal';
import OptionCard from 'src/components/OptionCard';
import { hp, wp } from 'src/constants/responsive';
import ActionCard from 'src/components/ActionCard';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { captureError } from 'src/services/sentry';
import { getAccountFromSigner, getKeyUID } from 'src/utils/utilities';
import useSignerMap from 'src/hooks/useSignerMap';
import { getSignerNameFromType } from 'src/hardware';
import { KEEPER_KNOWLEDGEBASE } from 'src/utils/service-utilities/config';
import PasscodeVerifyModal from 'src/components/Modal/PasscodeVerify';
import { NewVaultInfo } from 'src/store/sagas/wallets';
import { addNewVault, refillMobileKey } from 'src/store/sagaActions/vaults';
import { generateVaultId } from 'src/services/wallets/factories/VaultFactory';
import WalletUtilities from 'src/services/wallets/operations/utils';
import useCanaryVault from 'src/hooks/useCanaryWallets';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { resetRealyVaultState, resetSignersUpdateState } from 'src/store/reducers/bhr';
import { useAppSelector } from 'src/store/hooks';
import usePlan from 'src/hooks/usePlan';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import HexagonIcon from 'src/components/HexagonIcon';
import Colors from 'src/theme/Colors';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import CVVInputsView from 'src/components/HealthCheck/CVVInputsView';
import SigningServer from 'src/services/backend/SigningServer';
import moment from 'moment';
import Note from 'src/components/Note/Note';
import useSigners from 'src/hooks/useSigners';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { generateMobileKeySeeds } from 'src/hardware/signerSeeds';
import useArchivedVaults from 'src/hooks/useArchivedVaults';
import WalletHeader from 'src/components/WalletHeader';
import Buttons from 'src/components/Buttons';
import { ConciergeTag } from 'src/models/enums/ConciergeTag';
import UpgradeIcon from 'src/assets/images/UpgradeCTAs.svg';
import { vaultAlreadyExists } from './VaultMigrationController';
import HardwareModalMap, { InteracationMode } from './HardwareModalMap';
import RegisterSignerContent from './components/RegisterSignerContent';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';

const { width } = Dimensions.get('screen');

function Content({ colorMode, vaultUsed }: { colorMode: string; vaultUsed: Vault }) {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  return (
    <Box>
      <ActionCard
        description={vaultUsed.presentationData?.description}
        cardName={vaultUsed.presentationData.name}
        icon={<ThemedSvg name={'WalletVault'} />}
        callback={() => {}}
      />
      <Box style={styles.pv20}>
        <Text color={`${colorMode}.primaryText`} style={styles.warningText}>
          {signerText.eitherHideVaultOrRemove}
        </Text>
      </Box>
    </Box>
  );
}

// add key check for cancary wallet based on ss config

function SignerAdvanceSettings({ route }: any) {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const {
    vaultKey,
    vaultId,
    isMultisig,
    signer: signerFromParam,
  }: {
    signer: Signer;
    vaultKey: VaultSigner;
    isMultisig: boolean;
    vaultId: string;
  } = route.params;
  const { signerMap } = useSignerMap();
  const { signers } = useSigners();
  const { isOnL4, isOnL1 } = usePlan();

  const green_modal_text_color = ThemedColor({ name: 'green_modal_text_color' });
  const green_modal_background = ThemedColor({ name: 'green_modal_background' });
  const green_modal_button_background = ThemedColor({ name: 'green_modal_button_background' });
  const green_modal_button_text = ThemedColor({ name: 'green_modal_button_text' });
  const green_modal_sec_button_text = ThemedColor({ name: 'green_modal_sec_button_text' });

  const signer: Signer = signerFromParam
    ? signers.find((signer) => getKeyUID(signer) === getKeyUID(signerFromParam)) // to reflect associated contact image in real time
    : signerMap[getKeyUID(vaultKey)];

  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const {
    vault: vaultTranslation,
    common,
    signingServer,
    signer: signerTranslation,
    seed: seedTranslation,
    formatString,
    wallet: walletTranslation,
    error: errorTranslation,
  } = translations;
  const { allCanaryVaults } = useCanaryVault({ getAll: true });
  const { primaryMnemonic, id: appId }: KeeperApp = useQuery(RealmSchema.KeeperApp).map(
    getJSONFromRealmObject
  )[0];
  const [confirmPassVisible, setConfirmPassVisible] = useState(false);
  const [canaryVaultLoading, setCanaryVaultLoading] = useState(false);
  const [OTBLoading, setOTBLoading] = useState(false);
  const [backupModal, setBackupModal] = useState(false);
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [warningEnabled, setHideWarning] = useState(false);
  const [seed, setSeed] = useState('');
  const [vaultUsed, setVaultUsed] = useState<Vault>();
  const [canaryWalletId, setCanaryWalletId] = useState<string>();
  const [displayBackupModal, setDisplayBackupModal] = useState(false);
  const [otp, setOtp] = useState('');
  const [actionAfterPasscode, setActionAfterPasscode] = useState<
    null | 'hideKey' | 'mobileKeySeed'
  >(null);
  const [detailModal, setDetailModal] = useState(false);
  const [registerSignerModal, setRegisterSignerModal] = useState(false);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const [singleSigModal, setSingleSigModal] = useState(false);

  useEffect(() => {
    const fetchOrGenerateSeeds = async () => {
      if (isMobileKey) {
        try {
          if (!signer?.extraData?.instanceNumber) {
            throw new Error('Instance number is not available or invalid.');
          }
          const instanceNumber = signer?.extraData?.instanceNumber - 1;
          const generatedSeeds = await generateMobileKeySeeds(instanceNumber, primaryMnemonic);
          setSeed(generatedSeeds);
        } catch (error) {
          console.error('Error generating seeds: ', error);
        }
      }
    };
    setTimeout(() => {
      fetchOrGenerateSeeds();
    }, 100);
  }, [signer, primaryMnemonic]);

  const CANARY_SCHEME = { m: 1, n: 1 };

  const { isOnL2Above } = usePlan();

  const [waningModal, setWarning] = useState(false);

  const { activeVault, allVaults } = useVault({ vaultId, includeArchived: false });
  const { archivedVaults } = useArchivedVaults();
  const allUnhiddenVaults = allVaults.filter((vault) => {
    return idx(vault, (_) => _.presentationData.visibility) !== VisibilityType.HIDDEN;
  });
  const signerVaults: Vault[] = [];

  allUnhiddenVaults.forEach((vault) => {
    const keys = vault.signers;
    for (const key of keys) {
      if (getKeyUID(signer) === getKeyUID(key)) {
        signerVaults.push(vault);
        break;
      }
    }
  });

  useEffect(() => {
    if (vaultId && vaultKey) {
      if (signer.type === SignerType.MY_KEEPER && !vaultKey.xpriv) {
        dispatch(refillMobileKey(vaultKey));
      }
    }
  }, []);

  const hideKey = () => {
    dispatch(updateSignerDetails(signer, 'hidden', true));
    showToast(signerTranslation.keyHiddenSuccessfully, <TickIcon />);
    const popAction = StackActions.pop(2);
    navigation.dispatch(popAction);
  };

  const { relayVaultUpdate, relayVaultError, realyVaultErrorMessage } = useAppSelector(
    (state) => state.bhr
  );
  const { oneTimeBackupStatusByAppId } = useAppSelector((state) => state.account);

  useEffect(() => {
    if (relayVaultUpdate) {
      navigation.navigate('VaultDetails', { vaultId: canaryWalletId });
      setCanaryVaultLoading(false);
      dispatch(resetRealyVaultState());
    }
    if (relayVaultError) {
      showToast(`${signerTranslation.failedCanaryWallet} ${realyVaultErrorMessage}`);
      dispatch(resetRealyVaultState());
      setCanaryVaultLoading(false);
    }
  }, [relayVaultUpdate, relayVaultError]);

  const createCreateCanaryWallet = useCallback(
    (ssVaultKey) => {
      try {
        const vaultInfo: NewVaultInfo = {
          vaultType: VaultType.CANARY,
          vaultScheme: CANARY_SCHEME,
          vaultSigners: [ssVaultKey],
          vaultDetails: {
            name: walletTranslation.canaryWallet,
            description: `${walletTranslation.canaryWalletFor} ${signer.signerName}`,
          },
        };
        if (vaultAlreadyExists(vaultInfo, allVaults, archivedVaults)) {
          throw Error('Single-key wallet for this device already exists');
        }

        dispatch(addNewVault({ newVaultInfo: vaultInfo }));
        return vaultInfo;
      } catch (err) {
        captureError(err);
        showToast(err && err.message ? err.message.toString() : err.toString());
        setCanaryVaultLoading(false);
        return false;
      }
    },
    [signer]
  );

  const navigation: any = useNavigation();
  const dispatch = useDispatch();

  const navigateRegisterWithQR = () => {
    navigation.dispatch(CommonActions.navigate('RegisterWithQR', { vaultKey, vaultId }));
  };
  const navigateRegisterWithChannel = () => {
    navigation.dispatch(
      CommonActions.navigate('RegisterWithChannel', {
        vaultKey,
        vaultId,
        signerType: signer.type,
      })
    );
  };

  const registerSigner = async () => {
    switch (signer.type) {
      case SignerType.LEDGER:
      case SignerType.BITBOX02:
        navigateRegisterWithChannel();
        break;
      case SignerType.KEYSTONE:
      case SignerType.PASSPORT:
      case SignerType.SPECTER:
      case SignerType.OTHER_SD:
      case SignerType.COLDCARD:
      case SignerType.KRUX:
        setRegisterSignerModal(true);
        break;
      case SignerType.JADE:
        // For now, Jade only supports registration via USB for Miniscript
        if (activeVault.scheme.miniscriptScheme) {
          navigation.dispatch();
        } else {
          setRegisterSignerModal(true);
        }
        break;
      case SignerType.PORTAL:
        navigation.dispatch(
          CommonActions.navigate('SetupPortal', {
            vaultKey,
            vaultId,
            mode: InteracationMode.VAULT_REGISTER,
            accountNumber: getAccountFromSigner(signer),
          })
        );
        break;

      default:
        showToast(
          walletTranslation.deviceDoesntRequireVaultRegistration,
          null,
          IToastCategory.DEFAULT,
          1000
        );
        break;
    }
  };

  const navigateToPolicyChange = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'ChoosePolicyNew',
        params: {
          isUpdate: true,
          signer,
          vaultId,
          vaultKey,
        },
      })
    );
  };

  const navigateToKeyHistory = () => {
    navigation.dispatch(CommonActions.navigate('KeyHistory', { signer, vaultKey, vaultId }));
  };

  function WarningContent() {
    return (
      <>
        <Box style={styles.warningIllustration}>
          <WarningIllustration />
        </Box>
        <Box>
          <Text color={`${colorMode}.greenText`} style={styles.warningText}>
            {walletTranslation.warningContentData}
          </Text>
        </Box>
      </>
    );
  }

  const navigateToAssignSigner = () => {
    dispatch(resetSignersUpdateState());
    setWarning(false);
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

  const openTapsignerSettings = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'ManageTapsignerSettings',
        params: {
          signer,
        },
      })
    );
  };

  const openSatochipSettings = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'ManageSatochipSettings',
        params: {
          signer,
        },
      })
    );
  };

  // const signPSBTForExternalKeeperKey = async (serializedPSBT, resetQR) => {
  //   try {
  //     let signedSerialisedPSBT;
  //     try {
  //       const key = signer.signerXpubs[XpubTypes.P2WSH][0];
  //       signedSerialisedPSBT = signCosignerPSBT(
  //         signer.masterFingerprint,
  //         key.xpriv,
  //         serializedPSBT
  //       );
  //     } catch (e) {
  //       showToast(e.message);
  //       captureError(e);
  //     }
  //   }}};

  const [canaryWalletSingleSigModal, setCanaryWalletSingleSigModal] = useState(false);

  const handleCanaryWallet = () => {
    try {
      setCanaryVaultLoading(true);
      const singleSigSigner = idx(signer, (_) => _.signerXpubs[XpubTypes.P2WPKH][0]);
      if (!singleSigSigner) {
        setCanaryVaultLoading(false);
        setSingleSigModal(true);
      } else {
        const ssVaultKey: VaultSigner = {
          ...singleSigSigner,
          masterFingerprint: signer.masterFingerprint,
          xfp: WalletUtilities.getFingerprintFromExtendedKey(
            singleSigSigner.xpub,
            WalletUtilities.getNetworkByType(bitcoinNetworkType)
          ),
        };
        const canaryVaultId = generateVaultId([ssVaultKey], CANARY_SCHEME);
        setCanaryWalletId(canaryVaultId);
        const canaryVault = allCanaryVaults.find((vault) => vault.id === canaryVaultId);

        if (canaryVault) {
          navigation.navigate('VaultDetails', { vaultId: canaryVaultId });
          setCanaryVaultLoading(false);
        } else {
          createCreateCanaryWallet(ssVaultKey);
        }
      }
    } catch (err) {
      console.log(common.somethingWrong, err);
      setCanaryVaultLoading(false);
    }
  };

  const navigateToAdditionalDetails = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'AdditionalDetails',
        params: { signer },
      })
    );
  };

  function Card({ title = '', subTitle = '', icon = null }) {
    const { colorMode } = useColorMode();

    return (
      <Box backgroundColor={`${colorMode}.seashellWhite`} style={styles.cardContainer}>
        <Box style={styles.iconContainer}>
          <HexagonIcon width={44} height={38} backgroundColor={Colors.primaryGreen} icon={icon} />
        </Box>
        <Box style={styles.titlesContainer}>
          <Text style={styles.titleText}>{title}</Text>
          <Text style={styles.subTitleText}>{subTitle}</Text>
        </Box>
      </Box>
    );
  }

  useEffect(() => {
    if (!showOTPModal) {
      setOtp('');
    }
  }, [showOTPModal]);

  const backupModalContent = ({ title = '', subTitle = '', icon = null }) => {
    return (
      <Box>
        <Box style={styles.cardWrapper}>
          <Card title={title} subTitle={subTitle} icon={icon} />
        </Box>
        <Box style={styles.noteWrapper}>
          <Note
            title={common.note}
            subtitle={signerTranslation.OTBModalNote}
            subtitleColor="GreyText"
          />
        </Box>
      </Box>
    );
  };

  function SigningServerOTPModal() {
    const onPressNumber = (text) => {
      let tmpPasscode = otp;
      if (otp.length < 6) {
        if (text !== 'x') {
          tmpPasscode += text;
          setOtp(tmpPasscode);
        }
      }
      if (otp && text === 'x') {
        setOtp(otp.slice(0, -1));
      }
    };

    const onPressConfirm = async () => {
      const id =
        signer.signerXpubs[XpubTypes.P2WSH]?.[0]?.xpub &&
        WalletUtilities.getFingerprintFromExtendedKey(
          signer.signerXpubs[XpubTypes.P2WSH][0].xpub,
          WalletUtilities.getNetworkByType(bitcoinNetworkType)
        );
      try {
        setOTBLoading(true);
        const { mnemonic, derivationPath } = await SigningServer.fetchBackup(
          vaultKey?.xfp || id,
          Number(otp)
        );
        setOTBLoading(false);
        navigation.navigate('ExportSeed', {
          vaultKey,
          vaultId,
          seed: mnemonic,
          derivationPath,
          signer,
          isFromAssistedKey: true,
          isSS: true,
        });
      } catch (err) {
        setOTBLoading(false);
        showToast(`${err}`);
        setOtp('');
      }
      setShowOTPModal(false);
    };

    const onDeletePressed = () => {
      setOtp(otp.slice(0, otp.length - 1));
    };

    return (
      <Box style={styles.otpModal}>
        <Box>
          <TouchableOpacity
            onPress={async () => {
              const clipBoardData = await Clipboard.getString();
              if (clipBoardData.match(/^\d{6}$/)) {
                setOtp(clipBoardData);
              } else {
                showToast(errorTranslation.invalidOtpshort);
                setOtp('');
              }
            }}
          >
            <CVVInputsView
              passCode={otp}
              passcodeFlag={false}
              backgroundColor
              textColor
              height={hp(46)}
              width={hp(46)}
              marginTop={hp(0)}
              marginBottom={hp(10)}
              inputGap={2}
              customStyle={styles.CVVInputsView}
            />
          </TouchableOpacity>
        </Box>
        <KeyPadView
          onPressNumber={onPressNumber}
          onDeletePressed={onDeletePressed}
          keyColor={`${colorMode}.primaryText`}
        />
        <Box mt={5} alignSelf="flex-end">
          <Box>
            <Buttons
              primaryCallback={() => {
                onPressConfirm();
              }}
              fullWidth
              primaryText={common.confirm}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  const isPolicyServer = signer.type === SignerType.POLICY_SERVER;
  const isAppKey = signer.type === SignerType.KEEPER;
  const isMyAppKey = signer.type === SignerType.MY_KEEPER;
  const isTapsigner = signer.type === SignerType.TAPSIGNER;
  const isSatochip = signer.type === SignerType.SATOCHIP;
  const signersWithoutRegistration = isAppKey || isMyAppKey || isTapsigner || isSatochip;
  const isMobileKey = signer.type === SignerType.MY_KEEPER;

  const isOtherSD = signer.type === SignerType.UNKOWN_SIGNER;
  const CANARY_NON_SUPPORTED_DEVICES = [
    SignerType.UNKOWN_SIGNER,
    SignerType.POLICY_SERVER,
    SignerType.MOBILE_KEY,
    SignerType.MY_KEEPER,
  ];
  const isCanaryWalletAllowed = !CANARY_NON_SUPPORTED_DEVICES.includes(signer.type);

  const showOneTimeBackup = isPolicyServer && signer?.isBIP85;
  let disableOneTimeBackup = false; // disables OTB once the user has backed it up
  if (showOneTimeBackup) {
    if (isPolicyServer) disableOneTimeBackup = oneTimeBackupStatusByAppId[appId];
  }

  const onSuccess = () => {
    if (actionAfterPasscode === 'hideKey') {
      hideKey();
    } else if (actionAfterPasscode === 'mobileKeySeed') {
      navigation.dispatch(
        CommonActions.navigate('ExportSeed', {
          seed,
          isFromMobileKey: true,
          next: false,
        })
      );
    }
    setConfirmPassVisible(false);
  };

  const initiateOneTimeBackup = async () => {
    if (isPolicyServer) {
      setShowOTPModal(true);
      setBackupModal(false);
    } else {
      showToast(errorTranslation.oneTimeBackupNotSupported);
    }
  };

  const navigateToSigningRequests = () => {
    navigation.navigate('SigningRequest');
  };

  const BackupModalContent = useCallback(() => {
    return (
      <Box style={styles.modalContainer}>
        <ThemedSvg name={'signing_server_backup_modal_illustration'} />
        <Box>
          <Text fontSize={12} semiBold style={styles.modalTitle}>
            {signingServer.attention}:
          </Text>
          <Text fontSize={12} style={styles.modalTitle}>
            {signingServer.attentionSubTitle}
          </Text>
        </Box>
        <Buttons
          primaryCallback={() => {
            setDisplayBackupModal(false);
            initiateOneTimeBackup();
          }}
          fullWidth
          primaryText={common.backupNow}
          paddingVertical={13}
        />
      </Box>
    );
  }, []);

  const displayedCards = [
    !isMobileKey && (
      <OptionCard
        key="keyHistory"
        title={vaultTranslation.keyHistory}
        description={vaultTranslation.usageTimeline}
        callback={navigateToKeyHistory}
      />
    ),
    !(isPolicyServer || signersWithoutRegistration || !vaultId || !isMultisig) && (
      <OptionCard
        key="manualRegistration"
        title={vaultTranslation.manualRegistration}
        description={vaultTranslation.registerActiveVault}
        callback={registerSigner}
      />
    ),
    isPolicyServer && (
      <OptionCard
        key="configurationSetting"
        title={vaultTranslation.serverPolicySettings}
        description={vaultTranslation.updateServerKeyPolicy}
        callback={navigateToPolicyChange}
      />
    ),
    isPolicyServer && (
      <OptionCard
        key="signingRequests"
        title={signerTranslation.signingReq}
        description={signerTranslation.seePendingSigning}
        callback={navigateToSigningRequests}
      />
    ),
    isTapsigner && (
      <OptionCard
        key="manageTapsigner"
        title={signerTranslation.manageTapsigner}
        description={signerTranslation.manageTapsignerCard}
        callback={openTapsignerSettings}
      />
    ),
    isSatochip && (
      <OptionCard
        key="manageSatochip"
        title={signerTranslation.manageSatochip}
        description={signerTranslation.manageSatochipCard}
        callback={openSatochipSettings}
      />
    ),
    <OptionCard
      key="additionalInfo"
      title={signerTranslation.additionalInfo}
      description={signerTranslation.accociateContactAndDesc}
      callback={navigateToAdditionalDetails}
    />,
    isMobileKey && (
      <OptionCard
        key="mobileKeySeedWords"
        title={seedTranslation.mobileKeySeedWordsTitle}
        description={signerTranslation.mobileKeySeedOptionSubtitle}
        callback={() => {
          setActionAfterPasscode('mobileKeySeed');
          setConfirmPassVisible(true);
        }}
      />
    ),
    !(isPolicyServer || (signersWithoutRegistration && !isAppKey)) && (
      <OptionCard
        key="changeDeviceType"
        title={isOtherSD ? signerTranslation.deviceType : signerTranslation.changeDeviceType}
        description={signerTranslation.deviceList}
        callback={isOtherSD ? navigateToAssignSigner : () => setWarning(true)}
      />
    ),
    !vaultId && (
      <OptionCard
        key="hideKey"
        title={signerTranslation.hideKey}
        description={signerTranslation.hideKeyDesc}
        callback={() => {
          for (const vaultItem of allUnhiddenVaults) {
            if (vaultItem.signers.find((s) => getKeyUID(s) === getKeyUID(signer))) {
              setVaultUsed(vaultItem);
              setHideWarning(true);
              return;
            }
          }
          setActionAfterPasscode('hideKey');
          setConfirmPassVisible(true);
        }}
      />
    ),
    isCanaryWalletAllowed && (
      <OptionCard
        key="canaryWallet"
        title={walletTranslation.canaryWallet}
        description={walletTranslation.onChainKeyAlert}
        callback={handleCanaryWallet}
        disabled={isOnL1}
        rightComponent={
          isOnL1 &&
          (() => {
            return (
              <TouchableOpacity
                style={{ marginTop: hp(10) }}
                onPress={() => navigation.navigate('ChoosePlan')}
              >
                <UpgradeIcon style={styles.upgradeIcon} width={64} height={20} />
              </TouchableOpacity>
            );
          })
        }
      />
    ),
    isPolicyServer && showOneTimeBackup && (
      <OptionCard
        key="backupServerKey"
        title={signingServer.BackUpModalTitle}
        description={
          disableOneTimeBackup ? signingServer.serverKeyBackup : signingServer.saveBackup
        }
        callback={() => {
          if (!disableOneTimeBackup) setDisplayBackupModal(true);
        }}
        disabled={disableOneTimeBackup}
      />
    ),
    isPolicyServer && !signer.linkedViaSecondary && (
      <OptionCard
        key="AdditionalUsers"
        title={signingServer.additionalUsers}
        description={`${signingServer.AddMultipleUsers}${
          !isOnL4 ? `${signingServer.unlockKeeperPrivate}` : ''
        }`}
        callback={() => {
          isOnL4 && navigation.navigate('AdditionalUsers', { signer });
        }}
        disabled={!isOnL4}
        rightComponent={
          !isOnL4 &&
          (() => {
            return (
              <TouchableOpacity
                style={{ marginTop: hp(25) }}
                onPress={() => navigation.navigate('ChoosePlan')}
              >
                <UpgradeIcon style={styles.upgradeIcon} width={64} height={20} />
              </TouchableOpacity>
            );
          })
        }
      />
    ),
  ].filter(Boolean);

  const getSignerContent = (type: SignerType) => {
    switch (type) {
      case SignerType.COLDCARD:
        return {
          title: 'Coldcard',
          subTitle: signerTranslation.coldCardInfo,
          assert: <ThemedSvg name={'coldCard_illustration'} />,
          description: signerTranslation.coldCardDesx,
          FAQ: 'https://coldcard.com/docs/faq',
        };
      case SignerType.TAPSIGNER:
        return {
          title: 'TAPSIGNER',
          subTitle: signerTranslation.tapsignerInfo,
          assert: <ThemedSvg name={'tapSigner_illustration'} />,
          description: signerTranslation.tapsignerDes,
          FAQ: 'https://tapsigner.com/faq',
        };
      case SignerType.SATOCHIP:
        return {
          title: 'SATOCHIP',
          subTitle: signerTranslation.satochipInfo,
          assert: <ThemedSvg name={'satochip_illustration'} />,
          description: signerTranslation.satochipDes,
          FAQ: 'https://satochip.io/faq',
        };
      case SignerType.LEDGER:
        return {
          title: 'LEDGER',
          subTitle: signerTranslation.ledgerInfo,
          assert: <ThemedSvg name={'ledger_illustration'} width={180} height={180} />,
          description: '',
          FAQ: 'https://support.ledger.com/hc/en-us/categories/4404369571601?support=true',
        };
      case SignerType.SEEDSIGNER:
        return {
          title: 'SeedSigner',
          subTitle: signerTranslation.seedSigerInfo,
          assert: <ThemedSvg name={'seedSigner_illustration'} />,
          description: signerTranslation.seedSigerDes,
          FAQ: 'https://seedsigner.com/faqs/',
        };
      case SignerType.KEYSTONE:
        return {
          title: 'Keystone',
          subTitle: signerTranslation.keyStoneInfo,
          assert: <ThemedSvg name={'keyStone_illustration'} />,
          description: signerTranslation.keystoneDes,
          FAQ: 'https://support.keyst.one/miscellaneous/faq',
        };
      case SignerType.PASSPORT:
        return {
          title: 'Foundation Passport',
          subTitle: signerTranslation.foundationInfo,
          assert: <ThemedSvg name={'passport_illustration'} />,
          description: signerTranslation.foundationDesc,
          FAQ: 'https://docs.foundationdevices.com',
        };
      case SignerType.MOBILE_KEY:
        return {
          title: 'Mobile Key',
          subTitle: signerTranslation.mobileKeyInfo,
          assert: <ThemedSvg name={'external_Key_illustration'} />,
          description: signerTranslation.mobileKeyDes,
          FAQ: KEEPER_KNOWLEDGEBASE,
        };
      case SignerType.SEED_WORDS:
        return {
          title: 'Seed Key',
          subTitle: signerTranslation.seedKeyInfo,
          assert: <ThemedSvg name={'SeedSetupIllustration'} />,
          description: signerTranslation.seedKeyDes,
          FAQ: '',
        };
      case SignerType.MY_KEEPER:
      case SignerType.KEEPER:
        return {
          title: `${getSignerNameFromType(type)} as signer`,
          subTitle: signerTranslation.externalKeyinfo,
          assert: <ThemedSvg name={'external_Key_illustration'} />,
          description: signerTranslation.externalKeyDes,

          FAQ: KEEPER_KNOWLEDGEBASE,
        };
      case SignerType.POLICY_SERVER:
        return {
          title: 'Server Key',
          subTitle: signerTranslation.serverKeyinfo,
          assert: <ThemedSvg name={'signing_server_illustration'} />,
          description: signerTranslation.serverKeyDesc,
          FAQ: '',
        };
      case SignerType.BITBOX02:
        return {
          title: 'Bitbox 02',
          subTitle: signerTranslation.biTBoxInfo,
          assert: <ThemedSvg name={'bitBox_illustration'} />,
          description: signerTranslation.bitBoxDesx,
          FAQ: 'https://shiftcrypto.ch/support/',
        };
      case SignerType.TREZOR:
        return {
          title: 'Trezor',
          subTitle: signerTranslation.trezorInfo,
          assert: <ThemedSvg name={'trezor_illustration'} />,
          description: signerTranslation.trezorDes,
          FAQ: 'https://trezor.io/support',
        };
      case SignerType.JADE:
        return {
          title: 'Jade Blockstream',
          subTitle: signerTranslation.jadeInfo,
          assert: <ThemedSvg name={'jade_illustration'} />,
          description: signerTranslation.jadeDesc,
          FAQ: 'https://help.blockstream.com/hc/en-us/categories/900000061906-Blockstream-Jade',
        };
      case SignerType.SPECTER:
        return {
          title: 'Specter DIY',
          subTitle: signerTranslation.specterInfo,
          assert: <ThemedSvg name={'specter_illustration'} />,
          description: signerTranslation.specterDesc,
          FAQ: 'https://docs.specter.solutions/diy/faq/',
        };
      case SignerType.KRUX:
        return {
          title: 'Krux',
          subTitle: signerTranslation.kruxInfo,
          assert: <ThemedSvg name={'krux_illustration'} />,
          description: signerTranslation.kruxDesc,
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
  const { title, subTitle, assert, description } = getSignerContent(signer?.type);
  function SignerContent() {
    return (
      <Box>
        <Center>{assert}</Center>
        <Text color={green_modal_text_color} style={styles.contentDescription}>
          {description}
        </Text>
      </Box>
    );
  }

  const MissingXpubContent = () => {
    return (
      <Box style={styles.missingXpubContainer}>
        <ThemedSvg name={'MissingSingleXpubIllustration'} />
        <Buttons
          primaryText={common.addNow}
          primaryCallback={() => {
            setSingleSigModal(false);
            navigation.dispatch(
              CommonActions.navigate({
                name: 'SigningDeviceList',
                params: {
                  addSignerFlow: true,
                  signerCategory: SignerCategory.HARDWARE,
                  headerTitle: signerTranslation.hardwareKeysHeader,
                  headerSubtitle: signerTranslation.connectHardwareDevices,
                },
              })
            );
          }}
          fullWidth
        />
      </Box>
    );
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <ActivityIndicatorView visible={canaryVaultLoading || OTBLoading} showLoader={true} />
      <WalletHeader
        title={
          !signer.isBIP85
            ? ` ${getSignerNameFromType(signer.type, signer.isMock, false).replace(/\*+/g, '')} ${
                common.settings
              }`
            : ` ${getSignerNameFromType(signer.type, signer.isMock, false).replace(/\*+/g, '')} ${
                common.settings
              }`
        }
        rightComponent={
          <TouchableOpacity style={styles.infoIcon} onPress={() => setDetailModal(true)}>
            <ThemedSvg name="info_icon" />
          </TouchableOpacity>
        }
      />
      <ScrollView>
        <Box
          backgroundColor={
            isDarkMode ? `${colorMode}.modalWhiteBackground` : `${colorMode}.ChampagneBliss`
          }
          style={styles.contentContainerStyle}
          borderColor={`${colorMode}.separator`}
          borderWidth={1}
        >
          {displayedCards.map((card, index) => (
            <Box key={card.key}>
              {card}
              {index < displayedCards.length - 1 && (
                <View style={styles.divider} backgroundColor={`${colorMode}.secondaryText`} />
              )}
            </Box>
          ))}
        </Box>
      </ScrollView>
      <KeeperModal
        visible={registerSignerModal}
        close={() => setRegisterSignerModal(false)}
        title={vaultTranslation.manualRegistration}
        subTitle={vaultTranslation.registerActiveVault}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <RegisterSignerContent
            isUSBAvailable={activeVault?.scheme?.miniscriptScheme}
            signer={signer}
            vaultId={vaultId}
            vaultKey={vaultKey}
            setRegisterSignerModal={setRegisterSignerModal}
            activeVault={activeVault}
            navigateRegisterWithQR={navigateRegisterWithQR}
            navigateRegisterWithChannel={navigateRegisterWithChannel}
          />
        )}
      />

      <KeeperModal
        visible={waningModal}
        close={() => setWarning(false)}
        title={vaultTranslation.changeDeviceType}
        subTitle={vaultTranslation.wantTochageDevice}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.continue}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => setWarning(false)}
        buttonCallback={navigateToAssignSigner}
        Content={WarningContent}
      />
      <KeeperModal
        visible={displayBackupModal}
        close={() => setDisplayBackupModal(false)}
        title={signingServer.BackUpModalTitle}
        subTitle={signingServer.BackUpModalSubTitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={BackupModalContent}
      />
      <KeeperModal
        visible={warningEnabled && !!vaultUsed}
        close={() => setHideWarning(false)}
        title={vaultTranslation.keyUsedForVault}
        subTitle={vaultTranslation.keysTryingToHide}
        buttonText={vaultTranslation.ViewVault}
        secondaryButtonText={common.back}
        secondaryCallback={() => setHideWarning(false)}
        secButtonTextColor={`${colorMode}.greenText`}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        buttonTextColor={`${colorMode}.buttonText`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        buttonCallback={() => {
          setHideWarning(false);
          navigation.dispatch(CommonActions.navigate('VaultDetails', { vaultId: vaultUsed.id }));
        }}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => <Content vaultUsed={vaultUsed} colorMode={colorMode} />}
      />
      <KeeperModal
        visible={confirmPassVisible}
        closeOnOverlayClick={false}
        close={() => setConfirmPassVisible(false)}
        title={common.confirmPassCode}
        subTitleWidth={wp(240)}
        subTitle={
          actionAfterPasscode === 'hideKey'
            ? vaultTranslation.toHideKey
            : vaultTranslation.toviewMobileKey
        }
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
      <KeeperModal
        visible={backupModal}
        closeOnOverlayClick={true}
        close={() => setBackupModal(false)}
        showCloseIcon={false}
        title={`${signerTranslation.backingUp} ${signer.signerName}`}
        subTitle={`${signerTranslation.writeBackupSeed} ${signer.signerName}. ${signerTranslation.doItPrivately}`}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() =>
          backupModalContent({
            title: signer.signerName,
            subTitle: `${common.added} ${moment(signer.addedOn).calendar().toLowerCase()}`,
            icon: <SigningServerIcon />,
          })
        }
        buttonText={common.proceed}
        buttonCallback={initiateOneTimeBackup}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => setBackupModal(false)}
      />
      <KeeperModal
        visible={showOTPModal}
        close={() => {
          setShowOTPModal(false);
          setOtp('');
        }}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        title={common.confirm2FACodeTitle}
        subTitle={common.confirm2FACodeSubtitle}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={SigningServerOTPModal}
      />
      <HardwareModalMap
        type={signer.type}
        visible={canaryWalletSingleSigModal}
        close={() => setCanaryWalletSingleSigModal(false)}
        mode={InteracationMode.CANARY_ADDITION}
        isMultisig={true}
        addSignerFlow={false}
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
        visible={singleSigModal}
        close={() => setSingleSigModal(false)}
        title={signerTranslation.missingSingleSigTitle}
        subTitle={
          formatString(
            signerTranslation.missingSingleSigSubTitle,
            getSignerNameFromType(signer.type, signer.isMock, false).replace(/\*+/g, '')
          ) as string
        }
        subTitleWidth={wp(280)}
        Content={MissingXpubContent}
      />
    </ScreenWrapper>
  );
}

export default SignerAdvanceSettings;

const styles = StyleSheet.create({
  card: {
    height: 80,
    width: '100%',
    borderRadius: 10,
    marginVertical: '10%',
    paddingHorizontal: '6%',
    justifyContent: 'center',
  },
  circle: {
    height: 60,
    width: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#694B2E',
  },
  divider: {
    height: 1,
    marginVertical: hp(5),
    opacity: 0.1,
  },
  item: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  descriptionBox: {
    height: 24,
    backgroundColor: '#F9F4F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  descriptionEdit: {
    height: 50,
    backgroundColor: '#F9F4F0',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  descriptionContainer: {
    width: width * 0.8,
  },
  textInput: {
    height: 55,
    padding: 20,
    backgroundColor: 'rgba(253, 247, 240, 1)',
    borderRadius: 10,
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
  },
  walletNameText: {
    fontSize: 20,
  },
  inputContainer: {
    alignItems: 'center',
    borderBottomLeftRadius: 10,
    borderTopLeftRadius: 10,
    marginTop: '10%',
  },
  inputWrapper: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    height: 60,
  },
  copyIconWrapper: {
    padding: 10,
    borderRadius: 10,
    marginRight: 5,
  },
  deleteContentWrapper: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    marginVertical: hp(10),
    gap: 10,
    padding: 10,
    height: hp(70),
    alignItems: 'center',
    flexDirection: 'row',
  },
  warningIconWrapper: {
    alignItems: 'center',
    marginVertical: hp(20),
  },
  noteText: {
    fontSize: 15,
  },
  noteDescription: {
    fontSize: 12,
    padding: 1,
  },
  contentDescription: {
    fontSize: 14,
    marginTop: hp(25),
  },
  editModalContainer: {},
  fw800: {
    fontWeight: '800',
  },
  fingerprintContainer: {
    justifyContent: 'center',
    paddingLeft: 2,
  },
  w80: {
    width: '80%',
  },
  warningText: {
    fontSize: 14,
    padding: 1,
    letterSpacing: 0.65,
  },
  walletUsedText: {
    marginLeft: 2,
    marginVertical: 20,
  },
  actionCardContainer: {
    gap: 5,
  },
  cta: {
    borderRadius: 10,
    width: wp(120),
    height: hp(45),
    justifyContent: 'center',
    alignItems: 'center',
  },
  ctaText: {
    fontSize: 13,
    letterSpacing: 1,
  },
  updateBtnCtaStyle: { alignItems: 'flex-end', marginTop: 10 },
  errorStyle: {
    marginTop: 10,
  },
  fingerprint: {
    alignItems: 'center',
  },
  signerText: {
    marginVertical: hp(15),
  },
  signerCard: {
    borderWidth: 1,
    borderColor: Colors.secondaryLightGrey,
    height: 120,
    width: wp(105),
    paddingTop: 5,
    paddingLeft: 14,
  },
  pv20: {
    paddingVertical: 20,
  },
  warningIllustration: {
    alignSelf: 'center',
    marginBottom: hp(20),
    marginRight: wp(40),
  },
  contentContainerStyle: {
    marginTop: hp(20),
    paddingHorizontal: wp(20),
    paddingVertical: hp(10),
    borderRadius: wp(15),
  },
  signerVaults: {
    gap: 5,
  },
  textDesc: {
    fontSize: 13,
    marginTop: hp(10),
    marginBottom: hp(10),
  },
  cardContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 15,
    marginBottom: hp(20),
    minHeight: hp(70),
  },
  iconContainer: {
    width: wp(30),
    marginLeft: wp(10),
  },
  titlesContainer: {
    marginLeft: wp(15),
  },
  titleText: {
    color: Colors.primaryGreen,
    fontSize: 14,
    fontWeight: '500',
  },
  subTitleText: {
    fontSize: 12,
  },
  cvvInputInfoText: {
    fontSize: 14,
    width: '100%',
  },
  otpModal: {
    width: '100%',
  },
  cardWrapper: {
    marginBottom: hp(50),
  },
  noteWrapper: {
    marginBottom: hp(15),
  },
  infoIcon: {
    width: wp(40),
    height: wp(40),
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  modalTitle: {
    marginBottom: 10,
  },
  CVVInputsView: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  upgradeIcon: {
    marginRight: 20,
  },
  missingXpubContainer: {
    alignItems: 'center',
    gap: hp(30),
  },
});
