import { Alert, Linking, StyleSheet } from 'react-native';
import Text from 'src/components/KeeperText';
import { Box, useColorMode } from 'native-base';
import DeleteIcon from 'src/assets/images/deleteBlack.svg';
import { CommonActions, useNavigation } from '@react-navigation/native';
import React, { useContext, useEffect, useState } from 'react';
import { hp, wp } from 'src/constants/responsive';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import CVVInputsView from 'src/components/HealthCheck/CVVInputsView';
import KeeperModal from 'src/components/KeeperModal';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import LoginMethod from 'src/models/enums/LoginMethod';
import ReactNativeBiometrics from 'react-native-biometrics';
import { RKInteractionMode, SignerType, SigningMode } from 'src/services/wallets/enums';
import { credsAuthenticated } from 'src/store/reducers/login';
import { hash512 } from 'src/utils/service-utilities/encryption';
import { Signer, VaultSigner } from 'src/services/wallets/interfaces/vault';
import * as SecureStore from 'src/storage/secure-store';
import Buttons from 'src/components/Buttons';
import useAsync from 'src/hooks/useAsync';
import Instruction from 'src/components/Instruction';
import { getSignerNameFromType } from 'src/hardware';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import QRComms from 'src/assets/images/qr_comms.svg';
import NfcComms from 'src/assets/images/nfc_comms.svg';
import Import from 'src/assets/images/import.svg';
import USBIcon from 'src/assets/images/usb_white.svg';
import { SerializedPSBTEnvelop } from 'src/services/wallets/interfaces';
import { InteracationMode } from '../Vault/HardwareModalMap';
import { SendConfirmationRouteParams, tnxDetailsProps } from '../Send/SendConfirmation';
import { getAccountFromSigner, getKeyUID } from 'src/utils/utilities';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import SignerOptionCard from '../Vault/components/signerOptionCard';
import ColdCardUSBInstruction from '../Vault/components/ColdCardUSBInstruction';
import ShareKeyModalContent from '../Vault/components/ShareKeyModalContent';
import MagicLinkIcon from 'src/assets/images/magic-link-icon.svg';
import useVault from 'src/hooks/useVault';
import RegisterSignerContent from '../Vault/components/RegisterSignerContent';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import { KRUX_LOAD_SEED, KRUX_REGISTER } from 'src/hardware/krux';

const RNBiometrics = new ReactNativeBiometrics();

function ColdCardContent({
  isMultisig,
  signingMode,
}: {
  isMultisig: boolean;
  signingMode: SigningMode;
}) {
  let message = '';
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;

  if (isMultisig) {
    message = signerText.coldCardMultisigMsg;
  }

  if (signingMode === SigningMode.USB) {
    return <ColdCardUSBInstruction />;
  } else {
    return (
      <Box alignItems="center">
        <ThemedSvg name={'coldCard_illustration'} />
      </Box>
    );
  }
}

function PassportContent({ isMultisig }: { isMultisig: boolean }) {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  return (
    <Box alignItems="center">
      <ThemedSvg name={'passport_illustration'} />
      <Box marginTop={4}>
        {isMultisig && <Instruction text={signerText.pasportInstruction1} />}
        <Instruction text={signerText.passportInstruction2} />
      </Box>
    </Box>
  );
}

function SeedSignerContent({ isMultisig }: { isMultisig: boolean }) {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  return (
    <Box alignItems="center">
      <ThemedSvg name={'seedSigner_illustration'} />
      <Box marginTop={2}>
        {isMultisig ? (
          <Text style={styles.instructionsText}>{signerText.seedSignerInstruction1}</Text>
        ) : null}
        <Text style={styles.instructionsText}>{signerText.seedSignerInstruction2}</Text>
      </Box>
    </Box>
  );
}

function SpecterContent({ isMultisig }: { isMultisig: boolean }) {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  return (
    <Box alignItems="center">
      <ThemedSvg name={'specter_illustration'} />
      <Box marginTop={2}>
        {isMultisig && (
          <Text style={styles.instructionsText}>{`\u2022 ${signerText.spectorInstruction1}`}</Text>
        )}
        <Text style={styles.instructionsText}>{`\u2022 ${signerText.spectorInstruction2}`}</Text>
      </Box>
    </Box>
  );
}

function KeystoneContent({ isMultisig }: { isMultisig: boolean }) {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  return (
    <Box alignItems="center">
      <ThemedSvg name={'keyStone_illustration'} />
      <Box marginTop={4}>
        {isMultisig && <Instruction text={signerText.keystoneinstruction1} />}
        <Instruction
          text={`${signerText.forQrSigning} ${
            isMultisig ? signerText.multisigMenu : signerText.genericWalletSection
          }, ${signerText.pressScanIcon}`}
        />
      </Box>
    </Box>
  );
}

function JadeContent({
  isMultisig,
  signingMode,
}: {
  isMultisig: boolean;
  signingMode: SigningMode;
}) {
  if (signingMode === SigningMode.USB) {
    return <ColdCardUSBInstruction />;
  }
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  return (
    <Box alignItems="center">
      <ThemedSvg name={'jade_illustration'} />
      <Box marginTop={2}>
        {isMultisig && <Instruction text={signerText.jadeInstruction1} />}
        <Instruction text={signerText.jadeInstruction2} />
      </Box>
    </Box>
  );
}

function TrezorContent() {
  return (
    <Box alignItems="center">
      <ColdCardUSBInstruction />
    </Box>
  );
}

function BitBox02Content() {
  return (
    <Box alignItems="center">
      <ColdCardUSBInstruction />
    </Box>
  );
}

function LedgerContent() {
  return (
    <Box alignItems="center">
      <ColdCardUSBInstruction />
    </Box>
  );
}

function OtherSDContent() {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  return (
    <Box alignItems="center">
      <ThemedSvg name={'otherSigner_illustration'} />
      <Box marginTop={2}>
        <Text style={styles.instructionsText}>{signerText.eitherScanOrExport}</Text>
      </Box>
    </Box>
  );
}
export function KeeperContent(props) {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText, home } = translations;
  return (
    <Box alignItems="center">
      <ThemedSvg name={'external_Key_illustration'} />
      <Box marginTop={2}>
        <Text style={styles.instructionsText}>
          {`${signerText.openOtherApp} ${props.masterFingerPrint} > ${home.Signtransaction}`}
        </Text>
      </Box>
    </Box>
  );
}

function TapsignerContent() {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  return (
    <>
      <Box style={styles.portalIllustration}>
        <ThemedSvg name={'tapSigner_illustration'} />
      </Box>
      <Instruction text={signerText.tapsignerInstruction1} />
      <Instruction text={signerText.tapsignerInstruction2} />
    </>
  );
}
function SatochipContent() {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  return (
    <>
      <Box style={styles.portalIllustration}>
        <ThemedSvg name={'satochip_illustration'} />
      </Box>
      <Instruction text={signerText.satochipInstruction1} />
      <Instruction text={signerText.satochipInstruction2} />
    </>
  );
}
function PortalContent() {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  return (
    <>
      <Box style={styles.portalIllustration}>
        <ThemedSvg name={'portal_illustration'} />
      </Box>
      <Instruction text={signerText.portalInstruction1} />
      <Instruction text={signerText.portalInstruction2} />
    </>
  );
}
function KruxContent({ isMultisig }) {
  const { translations } = useContext(LocalizationContext);
  const { signer: signerText } = translations;
  const { colorMode } = useColorMode();

  const kruxSeed = (
    <Text onPress={() => Linking.openURL(KRUX_LOAD_SEED)}>
      {signerText.kruxInstruction1}
      <Text style={{ textDecorationLine: 'underline' }} color={`${colorMode}.hyperlink`}>
        {signerText.learnHow}
      </Text>
    </Text>
  );
  const kruxRegister = (
    <Text onPress={() => Linking.openURL(KRUX_REGISTER)}>
      {signerText.kruxSign1}
      <Text style={{ textDecorationLine: 'underline' }} color={`${colorMode}.hyperlink`}>
        {signerText.learnHow}
      </Text>
    </Text>
  );

  return (
    <>
      <Box style={styles.portalIllustration}>
        <ThemedSvg name={'krux_illustration'} />
      </Box>
      <Instruction text={kruxSeed} />
      {isMultisig && <Instruction text={kruxRegister} />}
      <Instruction text={signerText.kruxSign2} />
    </>
  );
}

function PasswordEnter({ signTransaction, setPasswordModal }) {
  const { colorMode } = useColorMode();
  const { pinHash } = useAppSelector((state) => state.storage);
  const loginMethod = useAppSelector((state) => state.settings.loginMethod);
  const appId = useAppSelector((state) => state.storage.appId);
  const dispatch = useAppDispatch();
  const { inProgress, start } = useAsync();
  const [password, setPassword] = useState('');

  useEffect(() => {
    biometricAuth();
    return () => {
      dispatch(credsAuthenticated(false));
    };
  }, []);

  const biometricAuth = async () => {
    if (loginMethod === LoginMethod.BIOMETRIC) {
      try {
        setPasswordModal(false);
        setTimeout(async () => {
          const { success, signature } = await RNBiometrics.createSignature({
            promptMessage: 'Authenticate',
            payload: appId,
            cancelButtonText: 'Use PIN',
          });
          if (success) {
            const res = await SecureStore.verifyBiometricAuth(signature, appId);
            if (res.success) {
              signTransaction();
            } else {
              Alert.alert('Invalid auth. Try again!');
            }
          }
        }, 200);
      } catch (error) {
        console.log(error);
      }
    }
  };

  const onPressNumber = (text) => {
    let tmpPasscode = password;
    if (password.length < 4) {
      if (text !== 'x') {
        tmpPasscode += text;
        setPassword(tmpPasscode);
      }
    }
    if (password && text === 'x') {
      setPassword(password.slice(0, -1));
    }
  };

  const onDeletePressed = () => setPassword(password.slice(0, password.length - 1));

  const primaryCallback = () =>
    start(async () => {
      const currentPinHash = hash512(password);
      if (currentPinHash === pinHash) {
        await signTransaction();
      } else Alert.alert('Incorrect password. Try again!');
    });

  return (
    <Box width={hp(280)}>
      <Box>
        <CVVInputsView
          passCode={password}
          passcodeFlag={false}
          backgroundColor
          textColor
          length={4}
        />
        <Text
          fontSize={13}
          letterSpacing={0.65}
          width={wp(290)}
          color={`${colorMode}.greenText`}
          marginTop={2}
        />
        <Box mt={10} alignSelf="flex-end" mr={2}>
          <Buttons
            primaryCallback={primaryCallback}
            primaryText="Confirm"
            primaryLoading={inProgress}
          />
        </Box>
      </Box>
      <KeyPadView
        onPressNumber={onPressNumber}
        onDeletePressed={onDeletePressed}
        keyColor={`${colorMode}.primaryText`}
        ClearIcon={<DeleteIcon />}
      />
    </Box>
  );
}

function OtpContent({ signTransaction }) {
  const { colorMode } = useColorMode();
  const [otp, setOtp] = useState('');
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
  const onDeletePressed = () => {
    setOtp(otp.slice(0, otp.length - 1));
  };

  return (
    <Box width={'100%'}>
      <Box>
        <CVVInputsView
          passCode={otp}
          passcodeFlag={false}
          backgroundColor
          textColor
          height={hp(46)}
          width={hp(46)}
          marginTop={hp(0)}
          marginBottom={hp(20)}
          inputGap={2}
          customStyle={styles.CVVInputsView}
        />
      </Box>
      <KeyPadView
        onPressNumber={onPressNumber}
        onDeletePressed={onDeletePressed}
        keyColor={`${colorMode}.primaryText`}
        ClearIcon={<DeleteIcon />}
      />
      <Box mt={5} alignSelf="flex-end" mr={2}>
        <Box>
          <Buttons
            primaryCallback={() => {
              signTransaction({ signingServerOTP: otp });
            }}
            fullWidth
            primaryText="Proceed"
            primaryDisable={otp.length !== 6}
          />
        </Box>
      </Box>
    </Box>
  );
}

const getSupportedSigningOptions = (signerType: SignerType, colorMode) => {
  switch (signerType) {
    case SignerType.COLDCARD:
      return {
        supportedSigningOptions: [
          {
            title: 'QR',
            icon: (
              <CircleIconWrapper
                icon={<QRComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.QR,
          },
          {
            title: 'File',
            icon: (
              <CircleIconWrapper
                icon={<Import />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.FILE,
          },

          {
            title: 'USB',
            icon: (
              <CircleIconWrapper
                icon={<USBIcon />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.USB,
          },
          {
            title: 'NFC',
            icon: (
              <CircleIconWrapper
                icon={<NfcComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.NFC,
          },
        ],
      };
    case SignerType.KEEPER:
    case SignerType.OTHER_SD:
    case SignerType.UNKOWN_SIGNER:
      return {
        supportedSigningOptions: [
          {
            title: 'Magic Link',
            icon: (
              <CircleIconWrapper
                icon={<MagicLinkIcon />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: 'MAGIC_LINK',
          },
          {
            title: 'QR',
            icon: (
              <CircleIconWrapper
                icon={<QRComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.QR,
          },
          {
            title: 'File',
            icon: (
              <CircleIconWrapper
                icon={<Import />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.FILE,
          },
          {
            title: 'NFC',
            icon: (
              <CircleIconWrapper
                icon={<NfcComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.NFC,
          },
        ],
      };
    case SignerType.KEYSTONE:
    case SignerType.PASSPORT:
    case SignerType.KRUX:
      return {
        supportedSigningOptions: [
          {
            title: 'QR',
            icon: (
              <CircleIconWrapper
                icon={<QRComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.QR,
          },
          {
            title: 'File',
            icon: (
              <CircleIconWrapper
                icon={<Import />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.FILE,
          },
        ],
      };
    case SignerType.JADE:
      return {
        supportedSigningOptions: [
          {
            title: 'QR',
            icon: (
              <CircleIconWrapper
                icon={<QRComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.QR,
          },
          {
            title: 'USB',
            icon: (
              <CircleIconWrapper
                icon={<USBIcon />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.USB,
          },
        ],
      };
    case SignerType.ONEKEY:
      return {
        supportedSigningOptions: [
          {
            title: 'Bluetooth',
            icon: (
              <CircleIconWrapper
                icon={<USBIcon />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: SigningMode.USB,
          },
        ],
      };
    default:
      return {
        supportedSigningOptions: [],
      };
  }
};

function SignerModals({
  vaultId,
  activeXfp,
  coldCardModal,
  tapsignerModal,
  satochipModal,
  ledgerModal,
  otpModal,
  passwordModal,
  passportModal,
  seedSignerModal,
  keystoneModal,
  jadeModal,
  keeperModal,
  trezorModal,
  bitbox02Modal,
  portalModal,
  otherSDModal,
  oneKeyModal,
  kruxModal,
  setOtherSDModal,
  setOneKeyModal,
  setTrezorModal,
  setBitbox02Modal,
  setJadeModal,
  setKeystoneModal,
  setSeedSignerModal,
  setPassportModal,
  setKeeperModal,
  setColdCardModal,
  setTapsignerModal,
  setSatochipModal,
  setLedgerModal,
  setPasswordModal,
  showOTPModal,
  setPortalModal,
  setKruxModal,
  signTransaction,
  vaultKeys,
  isMultisig,
  signerMap,
  specterModal,
  setSpecterModal,
  onFileSign,
  isRemoteKey = false,
  serializedPSBTEnvelopFromProps,
  sendConfirmationRouteParams,
  tnxDetails,
  isMiniscript,
}: {
  vaultId: string;
  activeXfp: string;
  coldCardModal: boolean;
  tapsignerModal: boolean;
  satochipModal: boolean;
  ledgerModal: boolean;
  otpModal: boolean;
  passwordModal: boolean;
  passportModal: boolean;
  seedSignerModal: boolean;
  keystoneModal: boolean;
  jadeModal: boolean;
  keeperModal: boolean;
  trezorModal: boolean;
  bitbox02Modal: boolean;
  portalModal: boolean;
  otherSDModal: boolean;
  oneKeyModal: boolean;
  kruxModal: boolean;
  setOtherSDModal: any;
  setOneKeyModal: any;
  setTrezorModal: any;
  setBitbox02Modal: any;
  setJadeModal: any;
  setKeystoneModal: any;
  setSeedSignerModal: any;
  setPassportModal: any;
  setKeeperModal: any;
  setColdCardModal: any;
  setTapsignerModal: any;
  setSatochipModal: any;
  setLedgerModal: any;
  setPasswordModal: any;
  showOTPModal: any;
  setPortalModal: any;
  setKruxModal: any;
  signTransaction: any;
  vaultKeys: VaultSigner[];
  isMultisig: boolean;
  signerMap: { [key: string]: Signer };
  specterModal: boolean;
  setSpecterModal: any;
  onFileSign: any;
  isRemoteKey: boolean;
  serializedPSBTEnvelopFromProps?: SerializedPSBTEnvelop;
  sendConfirmationRouteParams?: SendConfirmationRouteParams;
  tnxDetails?: tnxDetailsProps;
  isMiniscript?: boolean;
}) {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const { translations } = useContext(LocalizationContext);
  const {
    common,
    tapsigner: tapSignerText,
    satochip: satochipText,
    signer: signerText,
    vault: vaultText,
    login,
  } = translations;
  const serializedPSBTEnvelops = useAppSelector(
    (state) => state.sendAndReceive.sendPhaseTwo.serializedPSBTEnvelops
  );
  const serializedPSBTEnvelop: SerializedPSBTEnvelop = isRemoteKey
    ? serializedPSBTEnvelopFromProps
    : serializedPSBTEnvelops?.filter((envelop) => envelop.xfp === activeXfp)[0];

  const [coldCardContentModal, setColdCardContentModal] = useState(false);
  const [passportContentModal, setPassportContentModal] = useState(false);
  const [keystoneContentModal, setKeystoneContentModal] = useState(false);
  const [jadeModalContent, setJadeModalContent] = useState(false);
  const [keeperModalContent, setKeeperModalContent] = useState(false);
  const [otherModalContent, setOtherModalContent] = useState(false);
  const [registerSignerModal, setRegisterSignerModal] = useState(false);
  const [kruxContentModal, setKruxContentModal] = useState(false);

  const navigateToQrSigning = (vaultKey: VaultSigner) => {
    setPassportModal(false);
    setSeedSignerModal(false);
    setKeeperModal(false);
    setOtherSDModal(false);
    setJadeModal(false);
    setSpecterModal(false);
    navigation.dispatch(
      CommonActions.navigate('SignWithQR', {
        signTransaction,
        vaultKey,
        vaultId,
        isRemoteKey: isRemoteKey,
        serializedPSBTEnvelopFromProps,
        isMultisig: isMultisig,
        sendConfirmationRouteParams,
        tnxDetails,
      })
    );
  };

  const navigateToChannelSigning = (vaultKey: VaultSigner, signerType: string) => {
    setTrezorModal(false);
    setBitbox02Modal(false);
    setLedgerModal(false);
    navigation.dispatch(
      CommonActions.navigate('SignWithChannel', {
        signTransaction,
        vaultKey,
        vaultId,
        signerType,
        isRemoteKey,
        serializedPSBTEnvelopFromProps,
        isMultisig,
      })
    );
  };

  const navigateToOneKeySigning = (vaultKey: VaultSigner) => {
    setOneKeyModal(false);
    navigation.dispatch(
      CommonActions.navigate('SignWithOneKeyBle', {
        signTransaction,
        vaultKey,
        isRemoteKey,
        serializedPSBTEnvelopFromProps,
      })
    );
  };
  const [registeredSigner, setRegisteredSigner] = useState(null);
  const [registeredVaultKey, setRegisteredVaultKey] = useState(null);
  const [registerActiveVault, setRegisterActiveVault] = useState(null);

  const openRegisterModal = (signer, vaultKey, activeVault) => {
    setRegisteredSigner(signer);
    setRegisteredVaultKey(vaultKey);
    setRegisterSignerModal(true);
    setRegisterActiveVault(activeVault);
  };

  return (
    <>
      {vaultKeys.map((vaultKey) => {
        const signer = signerMap[getKeyUID(vaultKey)];
        const currentSigner = vaultKey.xfp === activeXfp;
        const { supportedSigningOptions } = getSupportedSigningOptions(signer.type, colorMode);
        const [signingMode, setSigningMode] = useState<SigningMode>(
          supportedSigningOptions[0]?.name || null
        );
        const { activeVault } = useVault({ vaultId, includeArchived: false });

        const info = vaultKey.registeredVaults?.find((info) => info.vaultId === vaultId);

        function OptionModalContent({
          supportedSigningOptions,
          onSelect,
          signingMode,
        }: {
          options?: any;
          supportedSigningOptions: any[];
          onSelect: (option) => any;
          signingMode: SigningMode;
        }) {
          return (
            <Box style={styles.optionModalContent}>
              {supportedSigningOptions &&
                supportedSigningOptions.map((option) => (
                  <SignerOptionCard
                    key={option.name}
                    isSelected={signingMode === option.name}
                    name={option.title}
                    icon={option.icon}
                    onCardSelect={() => {
                      onSelect(option.name);
                      if (option.name !== 'MAGIC_LINK') {
                        if (signer.type === SignerType.OTHER_SD) {
                          setOtherModalContent(true);
                          setOtherSDModal(false);
                        }
                        if (signer.type === SignerType.PASSPORT) {
                          setPassportContentModal(true);
                          setPassportModal(false);
                        } else if (signer.type === SignerType.KEYSTONE) {
                          setKeystoneContentModal(true);
                          setKeystoneModal(false);
                        } else if (signer.type === SignerType.JADE) {
                          setJadeModalContent(true);
                          setJadeModal(false);
                        } else if (
                          [SignerType.UNKOWN_SIGNER, SignerType.KEEPER].includes(signer.type)
                        ) {
                          setKeeperModalContent(true);
                          setKeeperModal(false);
                        }
                        if (signer.type === SignerType.KRUX) {
                          setKruxContentModal(true);
                          setKruxModal(false);
                        } else {
                          setColdCardContentModal(true);
                          setColdCardModal(false);
                        }
                      } else {
                        setKeeperModal(false);
                        setOtherSDModal(false);
                        navigation.dispatch(
                          CommonActions.navigate('RemoteSharing', {
                            psbt: serializedPSBTEnvelop.serializedPSBT,
                            mode: RKInteractionMode.SHARE_PSBT,
                            signer: signer,
                            xfp: vaultKey.xfp,
                          })
                        );
                      }
                    }}
                  />
                ))}
            </Box>
          );
        }

        if (signer.type === SignerType.TAPSIGNER) {
          const navigateToSignWithTapsigner = () => {
            setTapsignerModal(false);
            navigation.dispatch(
              CommonActions.navigate('TapsignerAction', {
                mode: InteracationMode.SIGN_TRANSACTION,
                signer,
                isMultisig,
                accountNumber: getAccountFromSigner(signer),
                signTransaction,
                isRemoteKey,
              })
            );
          };
          return (
            <KeeperModal
              key={vaultKey.xfp}
              visible={currentSigner && tapsignerModal}
              close={() => setTapsignerModal(false)}
              title={tapSignerText.getTapsignerReady}
              subTitle={tapSignerText.SetupDescription}
              buttonText={common.proceed}
              buttonCallback={navigateToSignWithTapsigner}
              Content={() => <TapsignerContent />}
            />
          );
        }
        if (signer.type === SignerType.SATOCHIP) {
          const navigateToSignWithSatochip = () => {
            setSatochipModal(false);
            navigation.dispatch(
              CommonActions.navigate('SatochipAction', {
                mode: InteracationMode.SIGN_TRANSACTION,
                signer,
                isMultisig,
                accountNumber: getAccountFromSigner(signer),
                signTransaction,
                isRemoteKey,
              })
            );
          };
          return (
            <KeeperModal
              key={vaultKey.xfp}
              visible={currentSigner && satochipModal}
              close={() => setSatochipModal(false)}
              title={satochipText.getSatochipReady}
              subTitle={satochipText.SetupDescription}
              buttonText={common.proceed}
              buttonCallback={navigateToSignWithSatochip}
              Content={() => <SatochipContent />}
            />
          );
        }
        if (signer.type === SignerType.COLDCARD) {
          const navigateToSignWithColdCard = () => {
            setColdCardContentModal(false);
            if (signingMode === SigningMode.FILE) {
              navigation.dispatch(
                CommonActions.navigate({
                  name: 'HandleFile',
                  params: {
                    title: `${signerText.signingWith} ${getSignerNameFromType(signer.type)}`,
                    subTitle: signerText.uploadAndPasteFile,
                    ctaText: common.proceed,
                    onFileExtract: onFileSign,
                    fileData: serializedPSBTEnvelop.serializedPSBT,
                    fileType: 'PSBT',
                    signerType: signer.type,
                    signer,
                  },
                })
              );
              return;
            } else if (signingMode === SigningMode.USB) {
              navigateToChannelSigning(vaultKey, SignerType.COLDCARD);
            } else if (signingMode === SigningMode.QR) {
              navigateToQrSigning(vaultKey);
            } else {
              navigation.dispatch(
                CommonActions.navigate('SignWithColdCard', {
                  signTransaction,
                  vaultKey,
                  isMultisig,
                  vaultId,
                  isRemoteKey,
                })
              );
            }
          };
          return (
            <>
              <KeeperModal
                visible={currentSigner && coldCardModal}
                close={() => setColdCardModal(false)}
                title={signerText.getColdCardReady}
                subTitle={signerText.selectSignOption}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => (
                  <OptionModalContent
                    supportedSigningOptions={supportedSigningOptions}
                    onSelect={(mode) => {
                      setSigningMode(mode);
                    }}
                    signingMode={signingMode}
                  />
                )}
              />

              <KeeperModal
                key={vaultKey.xfp}
                visible={currentSigner && coldCardContentModal}
                close={() => setColdCardContentModal(false)}
                title={signerText.signingWith + signingMode}
                subTitle={signerText.coldCardModalSubtitle}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => (
                  <ColdCardContent isMultisig={isMultisig} signingMode={signingMode} />
                )}
                buttonText={signerText.startSigning}
                buttonCallback={navigateToSignWithColdCard}
                secondaryButtonText={
                  signingMode !== SigningMode.USB && isMultisig && !isRemoteKey && !info?.registered
                    ? vaultText.registerMultisig
                    : null
                }
                secondaryCallback={() => {
                  setColdCardContentModal(false);
                  openRegisterModal(signer, vaultKey, activeVault);
                }}
              />
            </>
          );
        }
        if (signer.type === SignerType.LEDGER) {
          return (
            <KeeperModal
              key={vaultKey.xfp}
              visible={currentSigner && ledgerModal}
              close={() => {
                setLedgerModal(false);
              }}
              title={signerText.getYourLedgerReady}
              subTitle={signerText.connectLedgerToComp}
              textColor={`${colorMode}.textGreen`}
              subTitleColor={`${colorMode}.modalSubtitleBlack`}
              Content={() => <LedgerContent />}
              buttonText={common.proceed}
              buttonCallback={() => navigateToChannelSigning(vaultKey, signer.type)}
            />
          );
        }
        if (signer.type === SignerType.MOBILE_KEY) {
          return (
            <KeeperModal
              key={vaultKey.xfp}
              visible={currentSigner && passwordModal}
              close={() => {
                setPasswordModal(false);
              }}
              title={login.Enteryourpassword}
              subTitle=""
              textColor={`${colorMode}.textGreen`}
              subTitleColor={`${colorMode}.modalSubtitleBlack`}
              Content={() => (
                <PasswordEnter
                  signTransaction={signTransaction}
                  setPasswordModal={setPassportModal}
                />
              )}
            />
          );
        }
        if (signer.type === SignerType.POLICY_SERVER) {
          return (
            <KeeperModal
              key={vaultKey.xfp}
              visible={currentSigner && otpModal}
              close={() => {
                showOTPModal(false);
              }}
              title={common.confirm2FACodeTitle}
              subTitle={common.confirm2FACodeSubtitle}
              textColor={`${colorMode}.textGreen`}
              subTitleColor={`${colorMode}.modalSubtitleBlack`}
              Content={() => <OtpContent signTransaction={signTransaction} />}
            />
          );
        }
        if (signer.type === SignerType.PASSPORT) {
          return (
            <>
              <KeeperModal
                visible={currentSigner && passportModal}
                close={() => setPassportModal(false)}
                title={signerText.keepPasportReady}
                subTitle={signerText.selectSignOption}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => (
                  <OptionModalContent
                    supportedSigningOptions={supportedSigningOptions}
                    onSelect={(mode) => {
                      setSigningMode(mode);
                    }}
                    signingMode={signingMode}
                  />
                )}
              />
              <KeeperModal
                key={vaultKey.xfp}
                visible={currentSigner && passportContentModal}
                close={() => {
                  setPassportContentModal(false);
                }}
                title={signerText.signingWith + signingMode}
                subTitle={signerText.xPubPassPortSub}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => <PassportContent isMultisig={isMultisig} />}
                buttonText={signerText.startSigning}
                secondaryButtonText={
                  isMultisig && !isRemoteKey && !info?.registered
                    ? vaultText.registerMultisig
                    : null
                }
                secondaryCallback={() => {
                  setPassportContentModal(false);
                  openRegisterModal(signer, vaultKey, activeVault);
                }}
                buttonCallback={() => {
                  setPassportContentModal(false);
                  if (signingMode === SigningMode.FILE) {
                    navigation.dispatch(
                      CommonActions.navigate({
                        name: 'HandleFile',
                        params: {
                          title: `${signerText.signingWith} ${getSignerNameFromType(signer.type)}`,
                          subTitle: signerText.uploadAndPasteFile,
                          ctaText: common.proceed,
                          onFileExtract: onFileSign,
                          fileData: serializedPSBTEnvelop.serializedPSBT,
                          fileType: 'PSBT',
                          signerType: signer.type,
                          signer,
                        },
                      })
                    );
                    return;
                  }
                  navigateToQrSigning(vaultKey);
                }}
              />
            </>
          );
        }
        if (signer.type === SignerType.SEEDSIGNER) {
          return (
            <>
              <KeeperModal
                key={vaultKey.xfp}
                visible={currentSigner && seedSignerModal}
                close={() => setSeedSignerModal(false)}
                title={signerText.keepSeedSignerReady}
                subTitle={signerText.getSeedSignerReady}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => <SeedSignerContent isMultisig={isMultisig} />}
                buttonText={common.proceed}
                buttonCallback={() => {
                  navigateToQrSigning(vaultKey);
                  setSeedSignerModal(false);
                }}
              />
            </>
          );
        }
        if (signer.type === SignerType.SPECTER) {
          return (
            <>
              <KeeperModal
                key={vaultKey.xfp}
                visible={currentSigner && specterModal}
                close={() => {
                  setSpecterModal(false);
                }}
                title={signerText.keepSpectorReady}
                subTitle={signerText.getSpectorReady}
                textColor={`${colorMode}.textGreen`}
                Content={() => <SpecterContent isMultisig={isMultisig} />}
                buttonText={signerText.startSigning}
                secondaryButtonText={
                  isMultisig && !isRemoteKey && !info?.registered
                    ? vaultText.registerMultisig
                    : null
                }
                secondaryCallback={() => {
                  setSpecterModal(false);
                  openRegisterModal(signer, vaultKey, activeVault);
                }}
                buttonCallback={() => navigateToQrSigning(vaultKey)}
              />
            </>
          );
        }
        if (signer.type === SignerType.KEYSTONE) {
          return (
            <>
              <KeeperModal
                visible={currentSigner && keystoneModal}
                close={() => setKeystoneModal(false)}
                title={signerText.keepKeyStoneReady}
                subTitle={signerText.selectSignOption}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => (
                  <OptionModalContent
                    supportedSigningOptions={supportedSigningOptions}
                    onSelect={(mode) => {
                      setSigningMode(mode);
                    }}
                    signingMode={signingMode}
                  />
                )}
              />
              <KeeperModal
                key={vaultKey.xfp}
                visible={currentSigner && keystoneContentModal}
                close={() => {
                  setKeystoneContentModal(false);
                }}
                title={signerText.signingWith + signingMode}
                subTitle={signerText.keyStoneModalSubtitle}
                textColor={`${colorMode}.textGreen`}
                Content={() => <KeystoneContent isMultisig={isMultisig} />}
                buttonText={signerText.startSigning}
                secondaryButtonText={
                  isMultisig && !isRemoteKey && !info?.registered
                    ? vaultText.registerMultisig
                    : null
                }
                secondaryCallback={() => {
                  setKeystoneContentModal(false);
                  openRegisterModal(signer, vaultKey, activeVault);
                }}
                buttonCallback={() => {
                  setKeystoneContentModal(false);
                  if (signingMode === SigningMode.FILE) {
                    navigation.dispatch(
                      CommonActions.navigate({
                        name: 'HandleFile',
                        params: {
                          title: `${signerText.signingWith} ${getSignerNameFromType(signer.type)}`,
                          subTitle: signerText.uploadAndPasteFile,
                          ctaText: common.proceed,
                          onFileExtract: onFileSign,
                          fileData: serializedPSBTEnvelop.serializedPSBT,
                          fileType: 'PSBT',
                          signerType: signer.type,
                          signingMode,
                          signer,
                        },
                      })
                    );
                    return;
                  }
                  navigateToQrSigning(vaultKey);
                }}
              />
            </>
          );
        }
        if (signer.type === SignerType.JADE) {
          return (
            <>
              <KeeperModal
                visible={currentSigner && jadeModal}
                close={() => setJadeModal(false)}
                title={signerText.keepJadeReady}
                subTitle={signerText.selectSignOption}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => (
                  <OptionModalContent
                    supportedSigningOptions={supportedSigningOptions}
                    onSelect={(mode) => {
                      setSigningMode(mode);
                    }}
                    signingMode={signingMode}
                  />
                )}
              />
              <KeeperModal
                key={vaultKey.xfp}
                visible={currentSigner && jadeModalContent}
                close={() => {
                  setJadeModalContent(false);
                }}
                title={signerText.keepJadeReady}
                subTitle={signerText.getJadeReady}
                textColor={`${colorMode}.textGreen`}
                Content={() => <JadeContent signingMode={signingMode} isMultisig={isMultisig} />}
                buttonText={signerText.startSigning}
                secondaryButtonText={
                  signingMode !== SigningMode.USB && isMultisig && !isRemoteKey && !info?.registered
                    ? vaultText.registerMultisig
                    : null
                }
                secondaryCallback={() => {
                  setJadeModalContent(false);
                  openRegisterModal(signer, vaultKey, activeVault);
                }}
                buttonCallback={() => {
                  setJadeModalContent(false);
                  if (signingMode === SigningMode.USB) {
                    navigateToChannelSigning(vaultKey, SignerType.JADE);
                  } else {
                    navigateToQrSigning(vaultKey);
                  }
                }}
              />
            </>
          );
        }
        if (signer.type === SignerType.TREZOR) {
          return (
            <KeeperModal
              key={vaultKey.xfp}
              visible={currentSigner && trezorModal}
              close={() => {
                setTrezorModal(false);
              }}
              title={signerText.keepTrezorReady}
              subTitle={signerText.connectTrezortoComp}
              textColor={`${colorMode}.textGreen`}
              subTitleColor={`${colorMode}.modalSubtitleBlack`}
              Content={() => <TrezorContent />}
              buttonText={common.proceed}
              buttonCallback={() => navigateToChannelSigning(vaultKey, signer.type)}
            />
          );
        }
        if (signer.type === SignerType.BITBOX02) {
          return (
            <KeeperModal
              key={vaultKey.xfp}
              visible={currentSigner && bitbox02Modal}
              close={() => {
                setBitbox02Modal(false);
              }}
              title={signerText.keepBitBox02Ready}
              subTitle={signerText.keepBitBox02ReadySub}
              textColor={`${colorMode}.textGreen`}
              subTitleColor={`${colorMode}.modalSubtitleBlack`}
              Content={() => <BitBox02Content />}
              buttonText={common.proceed}
              buttonCallback={() => navigateToChannelSigning(vaultKey, signer.type)}
            />
          );
        }
        if (signer.type === SignerType.OTHER_SD) {
          const navigateToSign = () => {
            setOtherModalContent(false);
            if (signingMode === SigningMode.FILE) {
              navigation.dispatch(
                CommonActions.navigate({
                  name: 'HandleFile',
                  params: {
                    title: `${signerText.signingWith} ${getSignerNameFromType(signer.type)}`,
                    subTitle: signerText.uploadAndPasteFile,
                    ctaText: common.proceed,
                    onFileExtract: onFileSign,
                    fileData: serializedPSBTEnvelop.serializedPSBT,
                    fileType: 'PSBT',
                    signerType: signer.type,
                    signingMode,
                    signer,
                  },
                })
              );
              return;
            } else if (signingMode === SigningMode.QR) {
              navigateToQrSigning(vaultKey);
            } else {
              navigation.dispatch(
                CommonActions.navigate('SignWithColdCard', {
                  signTransaction,
                  vaultKey,
                  isMultisig,
                  vaultId,
                  isRemoteKey,
                  serializedPSBTEnvelop,
                })
              );
            }
          };

          return (
            <>
              <KeeperModal
                visible={currentSigner && otherSDModal}
                close={() => setOtherSDModal(false)}
                title={signerText.keepSignerReady}
                subTitle={signerText.chooseOneoftheFollowingOptions}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => (
                  <OptionModalContent
                    supportedSigningOptions={supportedSigningOptions}
                    onSelect={setSigningMode}
                    signingMode={signingMode}
                  />
                )}
              />
              <KeeperModal
                key={vaultKey.xfp}
                visible={currentSigner && otherModalContent}
                close={() => setOtherModalContent(false)}
                title={signerText.keepSignerReady}
                subTitle={signerText.signerReady}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => <OtherSDContent />}
                buttonText={common.proceed}
                buttonCallback={navigateToSign}
              />
            </>
          );
        }
        if (signer.type === SignerType.UNKOWN_SIGNER) {
          const navigateToSign = () => {
            setKeeperModalContent(false);
            if (signingMode === SigningMode.FILE) {
              navigation.dispatch(
                CommonActions.navigate({
                  name: 'HandleFile',
                  params: {
                    title: `${signerText.signingWith} ${getSignerNameFromType(signer.type)}`,
                    subTitle: signerText.uploadAndPasteFile,
                    ctaText: common.proceed,
                    onFileExtract: onFileSign,
                    fileData: serializedPSBTEnvelop.serializedPSBT,
                    fileType: 'PSBT',
                    signerType: signer.type,
                    signingMode,
                    signer,
                  },
                })
              );
              return;
            } else if (signingMode === SigningMode.QR) {
              navigateToQrSigning(vaultKey);
            } else {
              navigation.dispatch(
                CommonActions.navigate('SignWithColdCard', {
                  signTransaction,
                  vaultKey,
                  isMultisig,
                  vaultId,
                  isRemoteKey,
                  serializedPSBTEnvelop,
                })
              );
            }
          };

          return (
            <>
              <KeeperModal
                visible={currentSigner && keeperModal}
                close={() => {
                  setKeeperModal(false);
                }}
                title={signerText.getYourDeviceReady}
                subTitle={signerText.selectSignOption}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => (
                  <OptionModalContent
                    supportedSigningOptions={supportedSigningOptions}
                    onSelect={(mode) => {
                      setSigningMode(mode);
                    }}
                    signingMode={signingMode}
                  />
                )}
              />
              <KeeperModal
                key={vaultKey.xfp}
                visible={currentSigner && keeperModalContent}
                close={() => {
                  setKeeperModalContent(false);
                }}
                title={signerText.getYourDeviceReady}
                subTitle={`Get your ${getSignerNameFromType(signer.type)} ready before proceeding`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => (
                  <KeeperContent masterFingerPrint={signer && signer.masterFingerprint} />
                )}
                buttonText={common.proceed}
                buttonCallback={navigateToSign}
              />
            </>
          );
        }
        if (signer.type === SignerType.KEEPER) {
          const navigateToSignWithKeeper = () => {
            setKeeperModalContent(false);
            if (signingMode === SigningMode.FILE) {
              navigation.dispatch(
                CommonActions.navigate({
                  name: 'HandleFile',
                  params: {
                    title: `${signerText.signingWith} ${getSignerNameFromType(signer.type)}`,
                    subTitle: signerText.uploadAndPasteFile,
                    ctaText: common.proceed,
                    onFileExtract: onFileSign,
                    fileData: serializedPSBTEnvelop.serializedPSBT,
                    fileType: 'PSBT',
                    signerType: signer.type,
                    signingMode,
                    signer,
                  },
                })
              );
              return;
            } else if (signingMode === SigningMode.QR) {
              navigateToQrSigning(vaultKey);
            } else {
              navigation.dispatch(
                CommonActions.navigate('SignWithColdCard', {
                  signTransaction,
                  vaultKey,
                  isMultisig,
                  vaultId,
                  isRemoteKey,
                  serializedPSBTEnvelop,
                })
              );
            }
          };
          return (
            <>
              <KeeperModal
                visible={currentSigner && keeperModal}
                close={() => setKeeperModal(false)}
                title={signerText.getYourDeviceReady}
                subTitle={signerText.selectSignOption}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => (
                  <OptionModalContent
                    supportedSigningOptions={supportedSigningOptions}
                    onSelect={(mode) => {
                      setSigningMode(mode);
                    }}
                    signingMode={signingMode}
                  />
                )}
              />
              <KeeperModal
                key={vaultKey.xfp}
                visible={currentSigner && keeperModalContent}
                close={() => {
                  setKeeperModalContent(false);
                }}
                title={signerText.getYourDeviceReady}
                subTitle={`Get your ${getSignerNameFromType(signer.type)} ready before proceeding`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => (
                  <KeeperContent masterFingerPrint={signer && signer.masterFingerprint} />
                )}
                buttonText={common.proceed}
                buttonCallback={navigateToSignWithKeeper}
                secondaryButtonText={
                  isMultisig && !isRemoteKey && !info?.registered
                    ? vaultText.registerMultisig
                    : null
                }
                secondaryCallback={() => {
                  setKeeperModalContent(false);
                  openRegisterModal(signer, vaultKey, activeVault);
                }}
              />
            </>
          );
        }
        if (signer.type === SignerType.PORTAL) {
          const navigateToSignWithPortal = () => {
            setPortalModal(false);
            navigation.dispatch(
              CommonActions.navigate('SetupPortal', {
                mode: InteracationMode.SIGN_TRANSACTION,
                signer,
                isMultisig,
                signTransaction,
                isRemoteKey,
                accountNumber: getAccountFromSigner(signer),
              })
            );
          };
          return (
            <KeeperModal
              key={vaultKey.xfp}
              visible={currentSigner && portalModal}
              close={() => setPortalModal(false)}
              title={signerText.keepPortalReady}
              subTitle={signerText.portalReadySub}
              buttonText={common.proceed}
              modalBackground={`${colorMode}.modalWhiteBackground`}
              textColor={`${colorMode}.textGreen`}
              subTitleColor={`${colorMode}.modalSubtitleBlack`}
              buttonCallback={navigateToSignWithPortal}
              secondaryButtonText={
                isMultisig && !isRemoteKey && !info?.registered ? vaultText.registerMultisig : null
              }
              secondaryCallback={() => {
                setPortalModal(false);
                navigation.dispatch(
                  CommonActions.navigate('SetupPortal', {
                    vaultKey,
                    vaultId,
                    mode: InteracationMode.VAULT_REGISTER,
                    accountNumber: getAccountFromSigner(vaultKey),
                  })
                );
              }}
              Content={() => <PortalContent />}
            />
          );
        }
        if (signer.type === SignerType.KRUX) {
          return (
            <>
              <KeeperModal
                visible={currentSigner && kruxModal}
                close={() => setKruxModal(false)}
                title={signerText.kruxReady}
                subTitle={signerText.selectSignOption}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => (
                  <OptionModalContent
                    supportedSigningOptions={supportedSigningOptions}
                    onSelect={(mode) => {
                      setSigningMode(mode);
                    }}
                    signingMode={signingMode}
                  />
                )}
              />
              <KeeperModal
                key={vaultKey.xfp}
                visible={currentSigner && kruxContentModal}
                close={() => {
                  setKruxContentModal(false);
                }}
                title={signerText.signingWith + signingMode}
                subTitle={signerText.kruxQrSub}
                modalBackground={`${colorMode}.modalWhiteBackground`}
                textColor={`${colorMode}.textGreen`}
                subTitleColor={`${colorMode}.modalSubtitleBlack`}
                Content={() => <KruxContent isMultisig={isMultisig} />}
                buttonText={signerText.startSigning}
                secondaryButtonText={
                  isMultisig && !isRemoteKey && !info?.registered
                    ? vaultText.registerMultisig
                    : null
                }
                secondaryCallback={() => {
                  setKruxContentModal(false);
                  openRegisterModal(signer, vaultKey, activeVault);
                }}
                buttonCallback={() => {
                  setKruxContentModal(false);
                  if (signingMode === SigningMode.FILE) {
                    navigation.dispatch(
                      CommonActions.navigate({
                        name: 'HandleFile',
                        params: {
                          title: `${signerText.signingWith} ${getSignerNameFromType(signer.type)}`,
                          subTitle: signerText.uploadAndPasteFile,
                          ctaText: common.proceed,
                          onFileExtract: onFileSign,
                          fileData: serializedPSBTEnvelop.serializedPSBT,
                          fileType: 'PSBT',
                          signerType: signer.type,
                          signer,
                        },
                      })
                    );
                    return;
                  }
                  navigateToQrSigning(vaultKey);
                }}
              />
            </>
          );
        }
        if (signer.type === SignerType.ONEKEY) {
          return (
            <KeeperModal
              key={vaultKey.xfp}
              visible={currentSigner && oneKeyModal}
              close={() => setOneKeyModal(false)}
              title="连接 OneKey"
              subTitle="通过蓝牙连接 OneKey 并进行交易签名"
              modalBackground={`${colorMode}.modalWhiteBackground`}
              textColor={`${colorMode}.textGreen`}
              subTitleColor={`${colorMode}.modalSubtitleBlack`}
              buttonText={common.proceed}
              buttonCallback={() => navigateToOneKeySigning(vaultKey)}
              Content={() => <LedgerContent />}
            />
          );
        }

        return null;
      })}
      {registerSignerModal && registeredSigner && (
        <KeeperModal
          visible={registerSignerModal}
          close={() => setRegisterSignerModal(false)}
          title={vaultText.registerMultisig}
          subTitle={vaultText.registerActiveVault}
          modalBackground={`${colorMode}.modalWhiteBackground`}
          textColor={`${colorMode}.textGreen`}
          subTitleColor={`${colorMode}.modalSubtitleBlack`}
          Content={() => (
            <RegisterSignerContent
              isUSBAvailable={isMiniscript}
              signer={registeredSigner}
              vaultId={vaultId}
              vaultKey={registeredVaultKey}
              setRegisterSignerModal={setRegisterSignerModal}
              activeVault={registerActiveVault}
              navigateRegisterWithQR={() =>
                navigation.dispatch(
                  CommonActions.navigate('RegisterWithQR', {
                    vaultKey: registeredVaultKey,
                    vaultId,
                  })
                )
              }
              navigateRegisterWithChannel={() =>
                navigation.dispatch(
                  CommonActions.navigate('RegisterWithChannel', {
                    vaultKey: registeredVaultKey,
                    vaultId,
                    signerType: registeredSigner.type,
                  })
                )
              }
            />
          )}
        />
      )}
    </>
  );
}

export default SignerModals;

const styles = StyleSheet.create({
  instructionsText: {
    fontSize: 14,
    marginHorizontal: wp(5),
    marginTop: wp(3),
    marginBottom: wp(10),
  },
  setupOptionsContainer: {
    gap: wp(11),
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  supportedMediumCardStyle: {
    width: '48%',
    paddingTop: hp(14),
    paddingBottom: hp(9),
    paddingLeft: wp(12),
    paddingRight: wp(14),
  },
  CVVInputsView: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionModalContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: wp(10),
  },
  portalIllustration: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: hp(10),
  },
});
