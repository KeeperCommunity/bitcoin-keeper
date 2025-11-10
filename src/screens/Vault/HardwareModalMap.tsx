// /* eslint-disable no-case-declarations */

/* eslint-disable no-case-declarations */
import React, { useCallback, useContext, useEffect, useState } from 'react';
import * as bip39 from 'bip39';
import moment from 'moment';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  Linking,
  Platform,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Box, useColorMode, View } from 'native-base';
import { CommonActions, StackActions, useNavigation } from '@react-navigation/native';
import {
  KeyGenerationMode,
  SignerStorage,
  SignerType,
  XpubTypes,
} from 'src/services/wallets/enums';
import { hp, wp } from 'src/constants/responsive';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import Text from 'src/components/KeeperText';
import CVVInputsView from 'src/components/HealthCheck/CVVInputsView';
import DeleteIcon from 'src/assets/images/deleteBlack.svg';
import RecoverImage from 'src/assets/images/recover_white.svg';
import KeeperModal from 'src/components/KeeperModal';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { Signer, VaultSigner } from 'src/services/wallets/interfaces/vault';
import { addSigningDevice } from 'src/store/sagaActions/vaults';
import { captureError } from 'src/services/sentry';
import { KEEPER_WEBSITE_BASE_URL } from 'src/utils/service-utilities/config';
import {
  extractKeyFromDescriptor,
  generateSignerFromMetaData,
  getSignerNameFromType,
} from 'src/hardware';
import { getJadeDetails } from 'src/hardware/jade';
import { getKeystoneDetails, getKeystoneDetailsFromFile } from 'src/hardware/keystone';
import { getPassportDetails } from 'src/hardware/passport';
import { getSeedSignerDetails } from 'src/hardware/seedsigner';
import { hash512 } from 'src/utils/service-utilities/encryption';
import { useAppSelector } from 'src/store/hooks';
import { useDispatch } from 'react-redux';
import useToastMessage from 'src/hooks/useToastMessage';
import LoginMethod from 'src/models/enums/LoginMethod';
import HWError from 'src/hardware/HWErrorState';
import ReactNativeBiometrics from 'react-native-biometrics';
import { crossInteractionHandler, getAccountFromSigner } from 'src/utils/utilities';
import { isTestnet } from 'src/constants/Bitcoin';
import Buttons from 'src/components/Buttons';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import SigningServer from 'src/services/backend/SigningServer';
import * as SecureStore from 'src/storage/secure-store';
import { setSigningDevices } from 'src/store/reducers/bhr';
import Instruction from 'src/components/Instruction';
import useUnkownSigners from 'src/hooks/useUnkownSigners';
import WalletUtilities from 'src/services/wallets/operations/utils';
import { getSpecterDetails } from 'src/hardware/specter';
import Import from 'src/assets/images/import.svg';
import USBIcon from 'src/assets/images/usb_white.svg';
import NfcComms from 'src/assets/images/nfc_lines_white.svg';
import QRComms from 'src/assets/images/qr_comms.svg';
import useSigners from 'src/hooks/useSigners';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import { getCosignerDetails } from 'src/services/wallets/factories/WalletFactory';
import {
  setupColdcard,
  setupJade,
  setupKeeperSigner,
  setupKeystone,
  setupKrux,
  setupMobileKey,
  setupPassport,
  setupSeedSigner,
  setupSeedWordsBasedKey,
  setupSpecter,
} from 'src/hardware/signerSetup';
import { extractColdCardExport } from 'src/hardware/coldcard';
import PasscodeVerifyModal from 'src/components/Modal/PasscodeVerify';
import useCanaryWalletSetup from 'src/hooks/UseCanaryWalletSetup';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import NFC from 'src/services/nfc';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { setLastUsedOption } from 'src/store/reducers/signer';
import SetupSignerOptions from 'src/components/SetupSignerOptions';
import useNfcModal from 'src/hooks/useNfcModal';
import nfcManager, { NfcTech } from 'react-native-nfc-manager';
import { HCESession, HCESessionContext } from 'react-native-hce';
import idx from 'idx';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import * as bitcoin from 'bitcoinjs-lib';
import BackupModalContent from '../AppSettings/BackupModal';
import SignerOptionCard from './components/signerOptionCard';
import ColdCardUSBInstruction from './components/ColdCardUSBInstruction';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import { KRUX_LOAD_SEED, manipulateKruxData } from 'src/hardware/krux';

const RNBiometrics = new ReactNativeBiometrics();
const SIGNERS_SUPPORT_MULTIPLE_XPUBS = [
  SignerType.JADE,
  SignerType.SEEDSIGNER,
  SignerType.PASSPORT,
  SignerType.SPECTER,
  SignerType.KRUX,
];

export const enum InteracationMode {
  VAULT_ADDITION = 'VAULT_ADDITION',
  VAULT_REGISTER = 'VAULT_REGISTER',
  HEALTH_CHECK = 'HEALTH_CHECK',
  RECOVERY = 'RECOVERY',
  CONFIG_RECOVERY = 'CONFIG_RECOVERY',
  IDENTIFICATION = 'IDENTIFICATION',
  APP_ADDITION = 'APP_ADDITION',
  CANARY_ADDITION = 'CANARY_ADDITION',
  ADDRESS_VERIFICATION = 'ADDRESS_VERIFICATION',
  SIGN_TRANSACTION = 'SIGN_TRANSACTION',
  BACKUP_SIGNER = 'BACKUP_SIGNER',
  SIGNED_MESSAGE = 'SIGNED_MESSAGE',
}

const getSignerContent = (
  type: SignerType,
  isMultisig: boolean,
  translations: any,
  isHealthcheck: boolean,
  isCanaryAddition: boolean,
  isIdentification: boolean,
  colorMode: string,
  isNfcSupported: boolean,
  keyGenerationMode: KeyGenerationMode,
  formatString: any
) => {
  const {
    tapsigner,
    satochip,
    coldcard,
    ledger,
    bitbox,
    trezor,
    externalKey,
    common,
    signer: signerText,
  } = translations;

  switch (type) {
    case SignerType.COLDCARD:
      return {
        type: SignerType.COLDCARD,
        Illustration: <ThemedSvg name={'coldCard_illustration'} />,
        Instructions: [signerText.coldCardInstruction, signerText.coldCardInstruction1],
        title: isHealthcheck ? signerText.coldCardtitle : coldcard.SetupTitle,
        subTitle: isHealthcheck ? signerText.coldcardsubTitle : `${coldcard.SetupDescription}`,
        options: [
          {
            title: 'Scan QR',
            icon: (
              <CircleIconWrapper
                icon={<QRComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={38}
              />
            ),
            name: KeyGenerationMode.QR,
          },

          {
            title: 'File',
            icon: (
              <CircleIconWrapper
                icon={<Import />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={38}
              />
            ),
            name: KeyGenerationMode.FILE,
          },
          {
            title: 'USB',
            icon: (
              <CircleIconWrapper
                icon={<USBIcon />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={38}
              />
            ),
            name: KeyGenerationMode.USB,
          },
          {
            title: 'NFC',
            icon: (
              <CircleIconWrapper
                icon={<NfcComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={38}
              />
            ),
            name: KeyGenerationMode.NFC,
            disabled: !isNfcSupported,
          },
        ],
      };
    case SignerType.JADE:
      const jadeUnlockInstructions = signerText.jadeInstruction3;
      const jadeInstructions = `${signerText.jadeInstruction4}${
        isMultisig ? 'MultiSig' : 'SingleSig'
      }.`;

      const usbInstructions = `${signerText.usbInstruction} ${KEEPER_WEBSITE_BASE_URL}/${signerText.usbInstruction1}`;

      const instructions =
        keyGenerationMode === KeyGenerationMode.USB
          ? [usbInstructions]
          : [jadeUnlockInstructions, jadeInstructions];
      if (isTestnet()) {
        instructions.push(signerText.testNetInstruction);
      }
      return {
        type: SignerType.JADE,
        Illustration: <ThemedSvg name={'jade_illustration'} />,
        Instructions: instructions,
        title: isHealthcheck
          ? signerText.jadeHealthCheckTitle
          : isCanaryAddition
          ? signerText.jadeCanaryTiltle
          : signerText.jadeTitle,
        subTitle: signerText.jadeSubtitle,
        options: [
          {
            title: 'QR',
            icon: (
              <CircleIconWrapper
                icon={<QRComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: KeyGenerationMode.QR,
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
            name: KeyGenerationMode.USB,
          },
        ],
      };
    case SignerType.KEEPER:
      return {
        type: SignerType.KEEPER,
        Illustration: <ThemedSvg name={'external_Key_illustration'} />,
        Instructions: [externalKey.modalInstruction1, externalKey.modalInstruction2],
        title: isHealthcheck
          ? `${common.verify} ${getSignerNameFromType(type)}`
          : isCanaryAddition
          ? externalKey.setupCanaryTitle
          : `${common.importing} ${getSignerNameFromType(type)}`,
        subTitle: isHealthcheck ? '' : signerText.externalKeySub,
        options: [
          {
            title: 'Scan QR',
            icon: (
              <CircleIconWrapper
                icon={<QRComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={38}
              />
            ),
            name: KeyGenerationMode.QR,
          },

          {
            title: 'File',
            icon: (
              <CircleIconWrapper
                icon={<Import />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={38}
              />
            ),
            name: KeyGenerationMode.FILE,
          },
          {
            title: 'NFC',
            icon: (
              <CircleIconWrapper
                icon={<NfcComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={38}
              />
            ),
            name: KeyGenerationMode.NFC,
          },
        ],
      };
    case SignerType.MY_KEEPER:
      return {
        type: SignerType.MY_KEEPER,
        Illustration: isHealthcheck ? (
          <ThemedSvg name={'SeedSetupIllustration'} />
        ) : (
          <ThemedSvg name={'external_Key_illustration'} />
        ),
        Instructions: isHealthcheck
          ? [signerText.mobileHealthinstruction, signerText.mobileHealthinstruction1]
          : [signerText.mobileInstruction, signerText.mobileInstruction1],
        title: isHealthcheck
          ? signerText.mobileHealthTitile
          : `${signerText.settingUp} ${getSignerNameFromType(type)} (Hot)`,
        subTitle: isHealthcheck
          ? signerText.mobileHealthSub
          : `${signerText.generatingInternal} ${getSignerNameFromType(type)}`,
        options: [],
      };
    case SignerType.MOBILE_KEY:
      return {
        type: SignerType.MOBILE_KEY,
        Illustration: <ThemedSvg name={'external_Key_illustration'} />,
        Instructions: [signerText.walletRecoveryKey],
        title: isHealthcheck ? signerText.mobileHealthTitile : signerText.setupMobile,
        subTitle: signerText.passcodeandBiometrics,
        options: [],
      };
    case SignerType.KEYSTONE:
      const keystoneInstructions = isMultisig
        ? signerText.keystoneBtcOnlty
        : signerText.keystoneBtc2;
      return {
        type: SignerType.KEYSTONE,
        Illustration: <ThemedSvg name={'keyStone_illustration'} />,
        Instructions: isTestnet()
          ? [keystoneInstructions, signerText.keystoneInstruction3]
          : [keystoneInstructions],
        title: isHealthcheck
          ? signerText.verifyKeystone
          : isCanaryAddition
          ? signerText.jadeCanaryTiltle
          : signerText.addUrKeystone,
        subTitle: signerText.chooseKeystone,
        options: [
          {
            title: 'QR',
            icon: (
              <CircleIconWrapper
                icon={<QRComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: KeyGenerationMode.QR,
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
            name: KeyGenerationMode.FILE,
          },
        ],
      };
    case SignerType.PASSPORT:
      const passportInstructions = `${signerText.pasportinstruction} ${
        isMultisig ? 'Multisig' : 'Singlesig'
      } > QR Code.\n`;
      return {
        type: SignerType.PASSPORT,
        Illustration: <ThemedSvg name={'passport_illustration'} />,
        Instructions: isTestnet()
          ? [passportInstructions, signerText.passportTestnetInstruction]
          : [passportInstructions],
        title: isHealthcheck
          ? signerText.verifyPassport
          : isCanaryAddition
          ? signerText.jadeCanaryTiltle
          : signerText.addPassport,
        subTitle: signerText.passportSub,
        options: [
          {
            title: 'QR',
            icon: (
              <CircleIconWrapper
                icon={<QRComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: KeyGenerationMode.QR,
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
            name: KeyGenerationMode.FILE,
          },
        ],
      };
    case SignerType.POLICY_SERVER:
      const subtitle = isHealthcheck ? signerText.policyHealthCheck : signerText.policyServerSub;
      return {
        type: SignerType.POLICY_SERVER,
        Illustration: <ThemedSvg name={'signing_server_illustration'} />,
        Instructions: isHealthcheck
          ? [signerText.policyHealthCheck]
          : [signerText.policyInstruction, signerText.policyInstruction1],
        title: isHealthcheck ? signerText.verifyServer : signerText.setupServer,
        subTitle: subtitle,
      };
    case SignerType.SEEDSIGNER:
      const seedSignerInstructions = (
        <Text color={`${colorMode}.secondaryText`} style={styles.infoText}>
          {signerText.makeSureSeedLoad}
          <Text
            medium
            style={styles.learnHow}
            color={`${colorMode}.greenText`}
            onPress={() =>
              Linking.openURL(
                'https://econoalchemist.github.io/SeedSigner/04_Generate-Seed.html#generate-a-new-seed'
              )
            }
          >
            {signerText.learnHow}
          </Text>
          {signerText.makeSureSeedLoad1}
        </Text>
      );

      const setupGuideLink = !isHealthcheck && (
        <Text
          color={`${colorMode}.secondaryText`}
          style={styles.infoText}
          onPress={() =>
            Linking.openURL(
              'https://bitcoinmagazine.com/guides/how-to-use-seedsigner-for-secure-bitcoin'
            )
          }
        >
          {signerText.settingSigner}
          <Text
            style={{
              textDecorationLine: 'underline',
            }}
            color={`${colorMode}.hyperlink`}
          >
            https://bitcoinmagazine.com/guides/how-to-use-seedsigner-for-secure-bitcoin
          </Text>
        </Text>
      );

      return {
        type: SignerType.SEEDSIGNER,
        Illustration: <ThemedSvg name={'seedSigner_illustration'} />,
        Instructions: isTestnet()
          ? [seedSignerInstructions, signerText.seedSignerTestnetInst, setupGuideLink].filter(
              Boolean
            )
          : [seedSignerInstructions, setupGuideLink].filter(Boolean),
        title: isHealthcheck
          ? signerText.verifySeedSigner
          : isCanaryAddition
          ? signerText.jadeCanaryTiltle
          : signerText.addSeedSigner,
        subTitle: signerText.seedSignerSub,
        options: [],
      };

    case SignerType.SPECTER:
      const specterInstructions = `${signerText.makeSureSeedLoaded} ${
        isMultisig ? 'Multisig' : 'Singlesig'
      }${signerText.nativeSegwit}`;
      return {
        type: SignerType.SPECTER,
        Illustration: <ThemedSvg name={'specter_illustration'} />,
        Instructions: isTestnet()
          ? [specterInstructions, signerText.enableTestNEt]
          : [specterInstructions],
        title: isHealthcheck
          ? signerText.verifySepector
          : isCanaryAddition
          ? signerText.jadeCanaryTiltle
          : signerText.addSepector,
        subTitle: signerText.spectorSub,
        options: [],
      };
    case SignerType.BITBOX02:
      return {
        type: SignerType.BITBOX02,
        Illustration: <ThemedSvg name={'bitBox_illustration'} />,
        Instructions: [
          `${signerText.bitBoxintruction} ${KEEPER_WEBSITE_BASE_URL}/${signerText.desktopBitBox}`,
          signerText.bitBoxintructionstruction2,
        ],
        title: isHealthcheck ? signerText.verifyBitBox : bitbox.SetupTitle,
        subTitle: bitbox.SetupDescription,
        options: [],
      };
    case SignerType.TREZOR:
      return {
        type: SignerType.TREZOR,
        Illustration: <ThemedSvg name={'trezor_illustration'} />,
        Instructions: [
          `${signerText.bitBoxintruction} ${KEEPER_WEBSITE_BASE_URL}/${signerText.desktopTrezor}`,
          signerText.trezorInstruction,
        ],
        title: isHealthcheck ? signerText.verifyTrezor : trezor.SetupTitle,
        subTitle: trezor.SetupDescription,
        options: [],
      };
    case SignerType.LEDGER:
      return {
        type: SignerType.LEDGER,
        Illustration: <ThemedSvg name={'ledger_illustration'} />,
        Instructions: [
          `${signerText.bitBoxintruction} ${KEEPER_WEBSITE_BASE_URL}/${signerText.desktopLedger}`,
          signerText.ledgerInstruction,
        ],
        title: isHealthcheck ? signerText.verifyLedger : ledger.SetupTitle,
        subTitle: ledger.SetupDescription,
        options: [],
      };
    case SignerType.SEED_WORDS:
      return {
        type: SignerType.SEED_WORDS,
        Illustration: <ThemedSvg name={'SeedSetupIllustration'} />,
        Instructions: [signerText.seedWordInstruction],
        title: isHealthcheck ? signerText.verifySeed : signerText.addSeedKey,
        subTitle: signerText.seedKeyDesp,
        options: !isHealthcheck &&
          !isIdentification && [
            {
              title: 'Import',
              icon: (
                <CircleIconWrapper
                  icon={<Import />}
                  backgroundColor={`${colorMode}.pantoneGreen`}
                  width={35}
                />
              ),
              callback: () => {},
              name: KeyGenerationMode.IMPORT,
            },
            {
              title: 'Create',
              icon: (
                <CircleIconWrapper
                  icon={<RecoverImage />}
                  backgroundColor={`${colorMode}.pantoneGreen`}
                  width={35}
                />
              ),

              callback: () => {},
              name: KeyGenerationMode.CREATE,
            },
          ],
      };
    case SignerType.TAPSIGNER:
      return {
        type: SignerType.TAPSIGNER,
        Illustration: <ThemedSvg name={'tapSigner_illustration'} />,
        Instructions: [signerText.tapsignerInstruction3, signerText.tapsignerInstruction4],
        title: isHealthcheck ? signerText.VerifyTapsigner : tapsigner.SetupTitle,
        subTitle: tapsigner.SetupDescription,
        options: [],
      };
    case SignerType.SATOCHIP:
      return {
        type: SignerType.SATOCHIP,
        Illustration: <ThemedSvg name={'satochip_illustration'} />,
        Instructions: [signerText.satochipInstruction3, signerText.satochipInstruction4],
        title: isHealthcheck ? signerText.VerifySatochip : satochip.SetupTitle,
        subTitle: satochip.SetupDescription,
        options: [],
      };
    case SignerType.PORTAL:
      return {
        type: SignerType.PORTAL,
        Illustration: <ThemedSvg name={'portal_illustration'} />,
        Instructions: [signerText.portalInstruction, signerText.portalInstruction3],
        title: signerText.addPortal,
        subTitle: signerText.portalSubtilte,
        options: [],
      };
    case SignerType.OTHER_SD:
      return {
        type: SignerType.OTHER_SD,
        Illustration: <ThemedSvg name={'otherSigner_illustration'} />,
        Instructions: [signerText.otherSignerInstruction, signerText.otherSignerInstruction1],
        title: isHealthcheck ? signerText.verifySigner : signerText.addsigner,
        subTitle: signerText.signerSub,
        options: [],
      };

    case SignerType.KRUX:
      const kruxLink = (
        <Text
          color={`${colorMode}.secondaryText`}
          style={styles.infoText}
          onPress={() => Linking.openURL(KRUX_LOAD_SEED)}
        >
          {signerText.kruxInstruction1}
          <Text style={{ textDecorationLine: 'underline' }} color={`${colorMode}.hyperlink`}>
            {signerText.learnHow}
          </Text>
        </Text>
      );

      const kruxIns = [
        kruxLink,
        signerText.kruxInstruction2,
        signerText.kruxInstruction3,
        formatString(
          signerText.kruxInstruction4,
          keyGenerationMode === KeyGenerationMode.FILE ? 'XPUB-Text' : 'XPUB QR Code'
        ),
      ];

      return {
        type: SignerType.KRUX,
        Illustration: <ThemedSvg name={'krux_illustration'} />,
        Instructions: kruxIns,
        title: isHealthcheck
          ? signerText.kruxVerify
          : isCanaryAddition
          ? signerText.jadeCanaryTiltle
          : signerText.kruxAdd,
        subTitle: signerText.kruxSub,
        options: [
          {
            title: 'QR',
            icon: (
              <CircleIconWrapper
                icon={<QRComms />}
                backgroundColor={`${colorMode}.pantoneGreen`}
                width={35}
              />
            ),
            name: KeyGenerationMode.QR,
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
            name: KeyGenerationMode.FILE,
          },
        ],
      };

    default:
      return {
        type,
        Illustration: null,
        Instructions: [],
        title: tapsigner.SetupTitle,
        subTitle: tapsigner.SetupDescription,
        unsupported: true,
        options: [],
      };
  }
};

const getnavigationState = (type) => ({
  index: 5,
  routes: [
    { name: 'NewKeeperApp' },
    { name: 'EnterSeedScreen', params: { isSoftKeyRecovery: false, type } },
    { name: 'OtherRecoveryMethods' },
    { name: 'VaultRecoveryAddSigner' },
    { name: 'SigningDeviceListRecovery' },
    { name: 'EnterSeedScreen', params: { isSoftKeyRecovery: true, type } },
  ],
});

export function formatDuration(ms) {
  const duration = moment.duration(ms);
  return Math.floor(duration.asHours()) + moment.utc(duration.asMilliseconds()).format(':mm:ss');
}

function SignerContent({
  Illustration,
  Instructions,
  mode,
  options,
  keyGenerationMode,
  sepInstruction = '',
  onSelect,
}: {
  Illustration: Element;
  Instructions: Array<string>;
  mode: InteracationMode;
  options?: any;
  keyGenerationMode: any;
  sepInstruction?: String;
  onSelect: (option) => any;
}) {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { signer: signerTranslations } = translations;
  return (
    <View>
      {Illustration && <Box style={{ alignSelf: 'center', marginRight: 35 }}>{Illustration}</Box>}
      <Box>
        {mode === InteracationMode.HEALTH_CHECK && (
          <Instruction text={signerTranslations.autoHealthCheck} />
        )}
        {Instructions?.map((instruction) => (
          <Instruction text={instruction} key={instruction} />
        ))}
        {sepInstruction && (
          <Text fontSize={14} color={`${colorMode}.secondaryText`}>
            {sepInstruction}
          </Text>
        )}
      </Box>
      {options && options.length > 0 && (
        <Box style={styles.signerOptionTitle}>
          <Text medium color={`${colorMode}.greenText`}>
            {mode === InteracationMode.HEALTH_CHECK
              ? signerTranslations.verifySignerVia
              : signerTranslations.setupSignerVia}
          </Text>
        </Box>
      )}
      {options && options.length > 0 && (
        <View
          style={{
            marginVertical: hp(14),
            gap: 2,
            flexDirection: 'row',
          }}
        >
          <Box style={styles.setupOptionsContainer}>
            {options &&
              options.map((option) => (
                <SetupSignerOptions
                  disabled={option.disabled}
                  key={option.name}
                  isSelected={keyGenerationMode === option.name}
                  name={option.title}
                  icon={option.icon}
                  onCardSelect={() => {
                    onSelect(option);
                  }}
                  customStyle={{
                    width: '48%',
                    paddingTop: hp(14),
                    paddingBottom: hp(9),
                    paddingLeft: wp(12),
                    paddingRight: wp(14),
                  }}
                />
              ))}
          </Box>
        </View>
      )}
    </View>
  );
}

// TODO: Also compare xpubs

const verifyPassport = (qrData, signer) => {
  const { masterFingerprint } = getPassportDetails(qrData);
  return masterFingerprint === signer.masterFingerprint;
};

const verifySeedSigner = (qrData: any, signer: VaultSigner) => {
  const { masterFingerprint } = getSeedSignerDetails(qrData);
  return masterFingerprint === signer.masterFingerprint;
};

const verifySpecter = (qrData, signer) => {
  const { masterFingerprint } = getSpecterDetails(qrData);
  return masterFingerprint === signer.masterFingerprint;
};

const verifyKeystone = (qrData, signer) => {
  const { masterFingerprint } = getKeystoneDetails(qrData);
  return masterFingerprint === signer.masterFingerprint;
};

const verifyJade = (qrData, signer) => {
  const { masterFingerprint } = getJadeDetails(qrData);
  return masterFingerprint === signer.masterFingerprint;
};

const verifyKeeperSigner = (qrData, signer) => {
  try {
    const { masterFingerprint } = extractKeyFromDescriptor(qrData);
    return masterFingerprint === signer.masterFingerprint;
  } catch (err) {
    const message = crossInteractionHandler(err);
    throw new Error(message);
  }
};

const verifyColdCard = (qrData, signer, isMultiSig) => {
  const { masterFingerprint } = extractColdCardExport(qrData, isMultiSig);
  return masterFingerprint === signer.masterFingerprint;
};

const verifyKrux = (qrData: any, signer: VaultSigner) => {
  const { mfp } = manipulateKruxData(qrData);
  return mfp === signer.masterFingerprint;
};

function PasswordEnter({
  primaryMnemonic,
  navigation,
  dispatch,
  pinHash,
  isHealthcheck,
  signer,
  close,
  isMultisig,
  addSignerFlow,
}: {
  primaryMnemonic;
  navigation;
  dispatch;
  pinHash;
  isHealthcheck?;
  signer?;
  close?;
  isMultisig;
  addSignerFlow;
}) {
  const { colorMode } = useColorMode();
  const [password, setPassword] = useState('');
  const { showToast } = useToastMessage();
  const [inProgress, setInProgress] = useState(false);
  const { translations } = useContext(LocalizationContext);
  const { error: errorTranslations } = translations;

  const addMobileKeyWithProgress = () => {
    setInProgress(true);
  };
  useEffect(() => {
    if (inProgress) {
      isHealthcheck ? verifyMobileKey() : addMobileKey();
    }
  }, [inProgress]);
  const addMobileKey = async () => {
    try {
      const currentPinHash = hash512(password);
      if (currentPinHash === pinHash) {
        const { signer } = await setupMobileKey({ primaryMnemonic, isMultisig });
        dispatch(addSigningDevice([signer]));
        const navigationState = addSignerFlow
          ? {
              name: 'Home',
              params: { selectedOption: 'Keys', addedSigner: signer },
            }
          : {
              name: 'AddSigningDevice',
              merge: true,
              params: { addedSigner: signer },
            };
        navigation.dispatch(CommonActions.navigate(navigationState));
        setInProgress(false);
        close();
      } else {
        setInProgress(false);
        showToast(errorTranslations.incorrectPassword, <ToastErrorIcon />);
        close();
      }
    } catch (error) {
      setInProgress(false);
      if (error instanceof HWError) {
        showToast(error.message, <ToastErrorIcon />);
      } else if (error.toString() === 'Error') {
        /* empty */
      } else captureError(error);
    }
  };

  const verifyMobileKey = () => {
    try {
      const currentPinHash = hash512(password);
      if (currentPinHash === pinHash) {
        dispatch(
          healthCheckStatusUpdate([
            {
              signerId: signer.masterFingerprint,
              status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
            },
          ])
        );
        showToast(errorTranslations.MobileKeyVerified, <TickIcon />);
        setInProgress(false);
        close();
      } else {
        setInProgress(false);
        showToast(errorTranslations.incorrectPassword, <ToastErrorIcon />);
        close();
      }
    } catch (error) {
      setInProgress(false);
      if (error instanceof HWError) {
        showToast(error.message, <ToastErrorIcon />);
        close();
      } else if (error.toString() === 'Error') {
        /* empty */
      } else captureError(error);
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

  const onDeletePressed = () => {
    setPassword(password.slice(0, password.length - 1));
  };

  return (
    <Box style={styles.passwordContainer}>
      <CVVInputsView
        passCode={password}
        passcodeFlag={false}
        backgroundColor
        textColor
        length={4}
      />
      <Text style={styles.infoText} color={`${colorMode}.greenText`}>
        {errorTranslations.appUseMobileKey}
      </Text>
      <Box mt={10} alignSelf="flex-end" mr={2}>
        <Box>
          {inProgress ? (
            <ActivityIndicator size="small" />
          ) : (
            <Buttons
              primaryCallback={addMobileKeyWithProgress}
              primaryText="Confirm"
              primaryLoading={inProgress}
            />
          )}
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

function HardwareModalMap({
  type,
  visible,
  close,
  isMultisig,
  signer,
  skipHealthCheckCallBack,
  mode = InteracationMode.VAULT_ADDITION,
  primaryMnemonic,
  addSignerFlow = false,
  vaultSigners,
  vaultId,
  accountNumber,
}: {
  type: SignerType;
  visible: boolean;
  close: any;
  signer?: Signer;
  skipHealthCheckCallBack?: any;
  mode?: InteracationMode;
  isMultisig: boolean;
  primaryMnemonic?: string;
  addSignerFlow: boolean;
  vaultSigners?: VaultSigner[];
  vaultId?: string;
  accountNumber?: number;
}) {
  const { colorMode } = useColorMode();
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const { showToast } = useToastMessage();
  const { translations, formatString } = useContext(LocalizationContext);
  const {
    common,
    settings,
    externalKey,
    error: errorText,
    wallet: walletText,
    signer: signerText,
    vault: vaultText,
    cloudBackup,
  } = translations;
  const { createCreateCanaryWallet } = useCanaryWalletSetup({});
  const [passwordModal, setPasswordModal] = useState(false);
  const [inProgress, setInProgress] = useState(false);

  const { mapUnknownSigner } = useUnkownSigners();
  const { loginMethod, bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const { signers } = useSigners();
  const myAppKeys = signers.filter(
    (signer) => signer.type === SignerType.MY_KEEPER && !signer.archived
  );

  const appId = useAppSelector((state) => state.storage.appId);
  const { pinHash } = useAppSelector((state) => state.storage);
  const isHealthcheck = mode === InteracationMode.HEALTH_CHECK;
  const isIdentification = mode === InteracationMode.IDENTIFICATION;
  const isCanaryAddition = mode === InteracationMode.CANARY_ADDITION;
  const isExternalKey = type === SignerType.KEEPER;
  const [otp, setOtp] = useState('');
  const [signingServerHealthCheckOTPModal, setSigningServerHealthCheckOTPModal] = useState(false);
  const [signingServerRecoverOTPModal, setSigningServerRecoverOTPModal] = useState(false);
  const [isNfcSupported, setNfcSupport] = useState(true);
  const [keyGenerationMode, setKeyGenerationMode] = useState(KeyGenerationMode.FILE);
  const data = useQuery(RealmSchema.BackupHistory);
  const [backupModalVisible, setBackupModalVisible] = useState(false);
  const [openSetup, setOpenSetup] = useState(false);

  const getNfcSupport = async () => {
    const isSupported = await NFC.isNFCSupported();
    setNfcSupport(isSupported);
  };

  useEffect(() => {
    getNfcSupport();
  }, []);

  const navigateToTapsignerSetup = () => {
    if (mode === InteracationMode.RECOVERY) {
      navigation.dispatch(
        CommonActions.navigate({
          name: 'AddTapsignerRecovery',
          params: { mode, signer, isMultisig, accountNumber: getAccountFromSigner(signer) },
        })
      );
    }
    navigation.dispatch(
      CommonActions.navigate({
        name: 'TapsignerAction',
        params: {
          mode,
          signer,
          isMultisig,
          accountNumber,
          addSignerFlow,
          Illustration,
          Instructions,
        },
      })
    );
  };

  const navigateToSatochipSetup = () => {
    if (mode === InteracationMode.RECOVERY) {
      navigation.dispatch(
        CommonActions.navigate({
          name: 'AddSatochipRecovery',
          params: { mode, signer, isMultisig, accountNumber: getAccountFromSigner(signer) },
        })
      );
    }
    navigation.dispatch(
      CommonActions.navigate({
        name: 'SatochipAction',
        params: {
          mode,
          signer,
          isMultisig,
          accountNumber,
          addSignerFlow,
          Illustration,
          Instructions,
        },
      })
    );
  };

  const navigateToPortalSetup = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'SetupPortal',
        params: {
          mode,
          signer,
          isMultisig,
          accountNumber,
          addSignerFlow,
          Illustration,
          Instructions,
          isHealthcheck,
        },
      })
    );
  };

  const navigateToColdCardSetup = () => {
    if (mode === InteracationMode.RECOVERY) {
      navigation.dispatch(
        CommonActions.navigate({
          name: 'AddColdCardRecovery',
          params: { mode, signer, isMultisig },
        })
      );
    }
    navigation.dispatch(
      CommonActions.navigate({
        name: 'AddColdCard',
        params: {
          mode,
          signer,
          isMultisig,
          addSignerFlow,
          Illustration,
          Instructions,
        },
      })
    );
  };

  const navigateToAddQrBasedSigner = () => {
    let routeName = 'ScanQR';
    if (!isHealthcheck && !isCanaryAddition && !isExternalKey) {
      if (SIGNERS_SUPPORT_MULTIPLE_XPUBS.includes(type)) {
        routeName = 'AddMultipleXpub';
      }
    }
    navigation.dispatch(
      CommonActions.navigate({
        name: routeName,
        params: {
          title: `${
            isHealthcheck
              ? common.verify
              : isCanaryAddition
              ? signerText.jadeCanaryTiltle
              : isExternalKey
              ? common.add
              : signerText.settingUp
          } ${getSignerNameFromType(type)}`,
          subtitle: walletText.ScanQRData,
          onQrScan: (data) => (isHealthcheck ? onQRScanHealthCheck(data, signer) : onQRScan(data)),
          setup: true,
          type,
          mode,
          signer,
          addSignerFlow,
          importOptions: false,
          Illustration,
          Instructions,
        },
      })
    );
  };

  const navigateToFileBasedSigner = (type) => {
    const route = type === SignerType.KRUX && addSignerFlow ? 'AddMultipleXpubFiles' : 'HandleFile';
    navigation.dispatch(
      CommonActions.navigate({
        name: route,
        params: {
          title: `${
            isHealthcheck
              ? common.verify
              : isCanaryAddition
              ? signerText.jadeCanaryTiltle
              : signerText.settingUp
          } ${getSignerNameFromType(type)}`,
          subTitle: signerText.uploadFileAndPaste,
          mode,
          signerType: type,
          addSignerFlow,
          ctaText: common.proceed,
          onFileExtract,
          isHealthcheck,
          Illustration,
          Instructions,
        },
      })
    );
  };

  const generateMyAppKey = async () => {
    try {
      setInProgress(true);
      const instanceNumberToSet = WalletUtilities.getInstanceNumberForSigners(myAppKeys);
      getCosignerDetails(primaryMnemonic, instanceNumberToSet).then((cosigner) => {
        const hw = setupKeeperSigner(cosigner);
        if (hw) {
          dispatch(addSigningDevice([hw.signer]));
          const navigationState = addSignerFlow
            ? {
                name: 'Home',
                params: { selectedOption: 'Keys', addedSigner: hw.signer },
              }
            : {
                name: 'AddSigningDevice',
                merge: true,
                params: { addedSigner: hw.signer },
              };
          navigation.dispatch(CommonActions.navigate(navigationState));
        }
        setInProgress(false);
      });
    } catch (err) {
      setInProgress(false);
      captureError(err);
      showToast(errorText.keyNotAdded, <ToastErrorIcon />);
    }
  };

  const checkSigningServerHealth = async () => {
    if (mode === InteracationMode.HEALTH_CHECK) {
      try {
        setInProgress(true);
        const signerXfp = WalletUtilities.getFingerprintFromExtendedKey(
          signer.signerXpubs[XpubTypes.P2WSH][0].xpub,
          WalletUtilities.getNetworkByType(bitcoinNetworkType)
        );
        const { isSignerAvailable } = await SigningServer.checkSignerHealth(signerXfp, Number(otp));
        if (isSignerAvailable) {
          dispatch(
            healthCheckStatusUpdate([
              {
                signerId: signer.masterFingerprint,
                status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
              },
            ])
          );
          close();
          showToast(errorText.healthCheckDone, <TickIcon />);
        } else {
          close();
          dispatch(
            healthCheckStatusUpdate([
              {
                signerId: signer.masterFingerprint,
                status: hcStatusType.HEALTH_CHECK_FAILED,
              },
            ])
          );
          showToast(errorText.errorhealthCheck, <ToastErrorIcon />);
        }
        setInProgress(false);
      } catch (err) {
        console.log(err);
        setInProgress(false);
        close();
        showToast(errorText.errorhealthCheck, <ToastErrorIcon />);
      } finally {
        setOtp('');
      }
    }
  };
  const navigateToSigningServerSetup = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'ChoosePolicyNew',
        params: { signer, addSignerFlow, vaultId },
      })
    );
  };

  const navigateToSetupWithChannel = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'ConnectChannel',
        params: {
          title: `${
            isHealthcheck
              ? common.verify
              : isCanaryAddition
              ? signerText.jadeCanaryTiltle
              : signerText.settingUp
          } ${getSignerNameFromType(type)}`,
          subtitle: `${signerText.bitBoxintruction} ${KEEPER_WEBSITE_BASE_URL}/${signerText.desktopToConnect}.`,
          type,
          signer,
          mode,
          isMultisig,
          addSignerFlow,
          accountNumber,
          Illustration,
          Instructions,
          subTitle,
        },
      })
    );
  };

  const navigateToSetupWithOtherSD = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'SetupOtherSDScreen',
        params: {
          mode,
          isMultisig,
          addSignerFlow,
          Illustration,
          Instructions,
          signer,
        },
      })
    );
  };

  const importSeedWordsBasedKey = (mnemonic, remember = false) => {
    try {
      const { signer, key } = setupSeedWordsBasedKey(mnemonic, isMultisig, remember);
      dispatch(addSigningDevice([signer]));
      const navigationState = addSignerFlow
        ? {
            name: 'Home',
            params: { selectedOption: 'Keys', addedSigner: signer },
          }
        : {
            name: 'AddSigningDevice',
            merge: true,
            params: { addedSigner: signer },
          };
      navigation.dispatch(CommonActions.navigate(navigationState));
    } catch (err) {
      Alert.alert(err?.message);
    }
  };

  const navigateToSeedWordSetup = (isImport = false) => {
    if (mode === InteracationMode.RECOVERY) {
      const navigationState = getnavigationState(SignerType.SEED_WORDS);
      navigation.dispatch(CommonActions.reset(navigationState));
      close();
    } else if (mode === InteracationMode.VAULT_ADDITION && !isImport) {
      close();
      const mnemonic = bip39.generateMnemonic();
      navigation.dispatch(
        CommonActions.navigate({
          name: 'SetupSeedWordSigner',
          params: {
            seed: mnemonic,
            next: true,
            isHealthcheck,
            onSuccess: (mnemonic, remember) => {
              try {
                const { signer, key } = setupSeedWordsBasedKey(mnemonic, isMultisig, remember);
                dispatch(addSigningDevice([signer]));
                const navigationState = addSignerFlow
                  ? {
                      name: 'Home',
                      params: { selectedOption: 'Keys', addedSigner: signer },
                    }
                  : {
                      name: 'AddSigningDevice',
                      merge: true,
                      params: { addedSigner: signer },
                    };
                navigation.dispatch(CommonActions.navigate(navigationState));
              } catch (err) {
                showToast(err?.message, <ToastErrorIcon />);
              }
            },
            addSignerFlow,
          },
        })
      );
    } else if (mode === InteracationMode.HEALTH_CHECK || mode === InteracationMode.IDENTIFICATION) {
      navigation.dispatch(
        CommonActions.navigate({
          name: 'EnterSeedScreen',
          params: {
            mode,
            signer,
            isMultisig,
            setupSeedWordsBasedSigner: setupSeedWordsBasedKey,
            mapUnknownSigner,
          },
        })
      );
    } else if (isImport) {
      navigation.dispatch(
        CommonActions.navigate({
          name: 'EnterSeedScreen',
          params: {
            mode,
            isImport,
            isHealthCheck: false,
            signer,
            isMultisig,
            setupSeedWordsBasedSigner: setupSeedWordsBasedKey,
            addSignerFlow,
            importSeedCta: importSeedWordsBasedKey,
          },
        })
      );
    }
  };

  const navigateToRecoveryKeySetup = () => {
    if (data.length === 0 && mode === InteracationMode.HEALTH_CHECK) {
      setConfirmPassVisible(true);
    } else {
      return navigation.navigate('WalletBackHistory', { isUaiFlow: true });
    }
    close();
  };

  const onQRScan = async (qrData) => {
    try {
      bitcoin.Psbt.fromBase64(qrData);
      // Prevent receiving PSBT during the sign tnx flow, as multiple handlers process PSBT and signer details via NFC on the same screen.
      return;
    } catch (error) {}
    let hw: { signer: Signer; key: VaultSigner };
    try {
      switch (type) {
        case SignerType.PASSPORT:
          hw = setupPassport(qrData, isMultisig);
          break;
        case SignerType.SEEDSIGNER:
          hw = setupSeedSigner(qrData, isMultisig);
          break;
        case SignerType.SPECTER:
          hw = setupSpecter(qrData, isMultisig);
          break;
        case SignerType.KEEPER:
          hw = setupKeeperSigner(qrData);
          break;
        case SignerType.KEYSTONE:
          hw = setupKeystone(qrData, isMultisig);
          break;
        case SignerType.JADE:
          hw = setupJade(qrData);
          break;
        case SignerType.COLDCARD:
          hw = setupColdcard(qrData, isMultisig);
          break;
        case SignerType.KRUX:
          hw = setupKrux(qrData, isMultisig);
          break;
        default:
          break;
      }

      const handleSuccess = () => {
        dispatch(
          healthCheckStatusUpdate([
            {
              signerId: hw.signer.masterFingerprint,
              status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
            },
          ])
        );
        navigation.dispatch(StackActions.pop(2));
        showToast(`${hw.signer.signerName} verified successfully`, <TickIcon />);
      };

      const handleFailure = () => {
        navigation.dispatch(CommonActions.goBack());
        dispatch(
          healthCheckStatusUpdate([
            {
              signerId: hw.signer.masterFingerprint,
              status: hcStatusType.HEALTH_CHECK_FAILED,
            },
          ])
        );
        showToast(`${hw.signer.signerName} verification failed`, <ToastErrorIcon />);
      };

      if (mode === InteracationMode.RECOVERY) {
        dispatch(setSigningDevices(hw.signer));
        navigation.navigate('LoginStack', { screen: 'VaultRecoveryAddSigner' });
      } else if (mode === InteracationMode.IDENTIFICATION) {
        const mapped = mapUnknownSigner({ masterFingerprint: hw.signer.masterFingerprint, type });
        mapped ? handleSuccess() : handleFailure();
      } else if (mode === InteracationMode.CANARY_ADDITION) {
        dispatch(setSigningDevices(hw.signer));
        createCreateCanaryWallet(hw.signer);
      } else {
        dispatch(addSigningDevice([hw.signer]));
        const navigationState = addSignerFlow
          ? {
              name: 'Home',
              params: { selectedOption: 'Keys', addedSigner: hw.signer },
            }
          : {
              name: 'AddSigningDevice',
              merge: true,
              params: { addedSigner: hw.signer },
            };
        navigation.dispatch(CommonActions.navigate(navigationState));
      }
    } catch (error) {
      if (error instanceof HWError) {
        showToast(error.message, <ToastErrorIcon />);
      } else {
        captureError(error);
        showToast(`${vaultText.invalidQRError} ${getSignerNameFromType(type)}`, <ToastErrorIcon />);
      }
    }
  };

  const onQRScanHealthCheck = async (qrData, signer) => {
    try {
      bitcoin.Psbt.fromBase64(qrData);
      // Prevent receiving PSBT during the sign tnx flow, as multiple handlers process PSBT and signer details via NFC on the same screen.
      return;
    } catch (error) {}
    let healthcheckStatus: boolean;
    try {
      switch (type) {
        case SignerType.PASSPORT:
          healthcheckStatus = verifyPassport(qrData, signer);
          break;
        case SignerType.SEEDSIGNER:
          healthcheckStatus = verifySeedSigner(qrData, signer);
          break;
        case SignerType.SPECTER:
          healthcheckStatus = verifySpecter(qrData, signer);
          break;
        case SignerType.KEEPER:
          healthcheckStatus = verifyKeeperSigner(qrData, signer);
          break;
        case SignerType.KEYSTONE:
          healthcheckStatus = verifyKeystone(qrData, signer);
          break;
        case SignerType.JADE:
          healthcheckStatus = verifyJade(qrData, signer);
          break;
        case SignerType.COLDCARD:
          healthcheckStatus = verifyColdCard(qrData, signer, isMultisig);
          break;
        case SignerType.KRUX:
          healthcheckStatus = verifyKrux(qrData, signer);
          break;
        default:
          break;
      }
      if (healthcheckStatus) {
        dispatch(
          healthCheckStatusUpdate([
            {
              signerId: signer.masterFingerprint,
              status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
            },
          ])
        );
        navigation.dispatch(CommonActions.goBack());
        showToast(errorText.healthCheckDone, <TickIcon />);
      } else {
        navigation.dispatch(CommonActions.goBack());
        dispatch(
          healthCheckStatusUpdate([
            {
              signerId: signer.masterFingerprint,
              status: hcStatusType.HEALTH_CHECK_FAILED,
            },
          ])
        );
        showToast(cloudBackup.CLOUD_BACKUP_HEALTH_FAILED, <ToastErrorIcon />);
      }
    } catch (error) {
      if (error instanceof HWError) {
        showToast(error.message, <ToastErrorIcon />);
      } else {
        captureError(error);
        showToast(`${vaultText.invalidQRError} ${getSignerNameFromType(type)}`, <ToastErrorIcon />);
        navigation.dispatch(CommonActions.goBack());
      }
    }
  };

  const onFileExtract = async (fileData) => {
    if (!fileData || !fileData.trim) return;
    let jsonData;
    let hw;
    let error;
    try {
      jsonData = JSON.parse(fileData);
    } catch {
      try {
        if (type === SignerType.KEEPER) {
          const { signer } = setupKeeperSigner(fileData);

          if (!signer) {
            throw Error('Failed to import file data');
          } else {
            hw = signer;
          }
        } else {
          throw Error('Failed to import file data');
        }
      } catch (error) {
        showToast(`${errorText.importFileFrom} ${getSignerNameFromType(type)}`, <ToastErrorIcon />);
        return;
      }
    }
    switch (type) {
      case SignerType.PASSPORT:
        try {
          const passportDetails = isMultisig
            ? getPassportDetails(jsonData)
            : extractColdCardExport(jsonData, isMultisig);
          const { xpub, derivationPath, masterFingerprint } = passportDetails;
          const { signer } = generateSignerFromMetaData({
            xpub,
            derivationPath,
            masterFingerprint,
            signerType: SignerType.PASSPORT,
            storageType: SignerStorage.COLD,
            isMultisig,
          });
          hw = signer;
          break;
        } catch (err) {
          error = err;
        }
      case SignerType.COLDCARD:
        try {
          const ccDetails = extractColdCardExport(jsonData, isMultisig);
          const { xpub, derivationPath, masterFingerprint, xpubDetails } = ccDetails;
          const { signer } = generateSignerFromMetaData({
            xpub,
            derivationPath,
            masterFingerprint,
            isMultisig,
            signerType: SignerType.COLDCARD,
            storageType: SignerStorage.COLD,
            xpubDetails,
          });
          hw = signer;
        } catch (err) {
          error = err;
        }
        break;
      case SignerType.KEYSTONE:
        try {
          const { xpub, derivationPath, masterFingerprint, forMultiSig, forSingleSig } =
            getKeystoneDetailsFromFile(jsonData);
          if ((isMultisig && forMultiSig) || (!isMultisig && forSingleSig)) {
            const { signer } = generateSignerFromMetaData({
              xpub,
              derivationPath,
              masterFingerprint,
              signerType: SignerType.KEYSTONE,
              storageType: SignerStorage.COLD,
              isMultisig,
            });
            hw = signer;
          } else {
            // TODO: handle sig type mismatch
            showToast(
              `${errorText.importFileFrom} ${getSignerNameFromType(type)}`,
              <ToastErrorIcon />
            );
          }
        } catch (err) {
          error = err;
        }
      case SignerType.KRUX:
        try {
          const { signer } = setupKrux(jsonData, isMultisig);
          if (!signer)
            showToast(
              `${errorText.importFileFrom} ${getSignerNameFromType(type)}`,
              <ToastErrorIcon />
            );
          else hw = signer;
        } catch (err) {
          error = err;
        }
        break;
      default:
        break;
    }
    if (error) {
      showToast(`${errorText.importFileFrom} ${getSignerNameFromType(type)}`, <ToastErrorIcon />);
      captureError(error);
      return;
    }
    if (mode === InteracationMode.HEALTH_CHECK) {
      dispatch(
        healthCheckStatusUpdate([
          {
            signerId: signer.masterFingerprint,
            status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
          },
        ])
      );
      showToast('Health check successful!');
    } else {
      dispatch(addSigningDevice([hw]));
      const navigationState = addSignerFlow
        ? { name: 'Home', params: { selectedOption: 'Keys', addedSigner: hw } }
        : {
            name: 'AddSigningDevice',
            merge: true,
            params: { addedSigner: hw },
          };
      navigation.dispatch(CommonActions.navigate(navigationState));
    }
  };

  function SigningServerOTPModal() {
    const { translations } = useContext(LocalizationContext);
    const { vault: vaultTranslation, common, signer: signerTranslation } = translations;

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
      <Box width="100%">
        <Box>
          <TouchableOpacity
            onPress={async () => {
              const clipBoardData = await Clipboard.getString();
              if (clipBoardData.match(/^\d{6}$/)) {
                setOtp(clipBoardData);
              } else {
                showToast(errorText.invalidOtpshort);
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
              marginBottom={hp(20)}
              inputGap={2}
              customStyle={styles.CVVInputsView}
            />
          </TouchableOpacity>
        </Box>
        <KeyPadView
          onPressNumber={onPressNumber}
          onDeletePressed={onDeletePressed}
          keyColor={`${colorMode}.primaryText`}
          ClearIcon={<DeleteIcon />}
        />
        <Box mt={10} alignSelf="flex-end" mr={2}>
          <Box>
            <Buttons
              primaryCallback={() => {
                if (mode === InteracationMode.HEALTH_CHECK) {
                  checkSigningServerHealth();
                  setSigningServerHealthCheckOTPModal(false);
                } else {
                  showToast(errorText.actionNotImplemented, <ToastErrorIcon />);
                }
              }}
              primaryText={common.confirm}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  const navigateToMobileKey = async (isMultiSig) => {
    if (mode === InteracationMode.RECOVERY) {
      const navigationState = getnavigationState(SignerType.MOBILE_KEY);
      navigation.dispatch(CommonActions.reset(navigationState));
      close();
    } else if (mode === InteracationMode.VAULT_ADDITION) {
      await biometricAuth(isMultiSig);
    } else if (mode === InteracationMode.HEALTH_CHECK) {
      navigation.dispatch(
        CommonActions.navigate('ExportSeed', {
          seed: primaryMnemonic,
          next: true,
          isHealthCheck: true,
          signer,
        })
      );
    } else if (mode === InteracationMode.IDENTIFICATION) {
      navigation.dispatch(
        CommonActions.navigate({
          name: 'ExportSeed',
          params: {
            seed: primaryMnemonic,
            signer,
            isHealthCheck: true,
            mode,
            next: true,
          },
        })
      );
    }
  };

  const biometricAuth = async (isMultisig) => {
    if (loginMethod === LoginMethod.BIOMETRIC) {
      try {
        setInProgress(true);
        setTimeout(async () => {
          const { success, signature } = await RNBiometrics.createSignature({
            promptMessage: 'Authenticate',
            payload: appId,
            cancelButtonText: 'Use PIN',
          });
          if (success) {
            setInProgress(false);
            const res = await SecureStore.verifyBiometricAuth(signature, appId);
            if (res.success) {
              const { signer, key } = await setupMobileKey({ primaryMnemonic, isMultisig });
              dispatch(addSigningDevice([signer]));
              const navigationState = addSignerFlow
                ? {
                    name: 'Home',
                    params: { selectedOption: 'Keys', addedSigner: signer },
                  }
                : {
                    name: 'AddSigningDevice',
                    merge: true,
                    params: { addedSigner: signer },
                  };
              navigation.dispatch(CommonActions.navigate(navigationState));
            } else {
              showToast(errorText.incorrectPassword, <ToastErrorIcon />);
            }
          }
        }, 200);
      } catch (error) {
        setInProgress(false);
        captureError(error);
      }
    } else {
      setInProgress(false);
      setPasswordModal(true);
    }
  };

  const handleSigningServerKey = () => {
    if (mode === InteracationMode.HEALTH_CHECK) {
      setSigningServerHealthCheckOTPModal(true);
    } else {
      navigateToSigningServerSetup();
    }
  };

  const {
    Illustration,
    Instructions,
    title,
    subTitle,
    unsupported,
    options,
    sepInstruction = '',
    type: signerType,
  } = getSignerContent(
    type,
    isMultisig,
    translations,
    isHealthcheck,
    isCanaryAddition,
    isIdentification,
    colorMode,
    isNfcSupported,
    keyGenerationMode,
    formatString
  );

  const lastUsedOption = useAppSelector(
    (state) => state.signer.lastUsedOptions[signerType] || KeyGenerationMode.FILE
  );

  const [confirmPassVisible, setConfirmPassVisible] = useState(false);

  useEffect(() => {
    setKeyGenerationMode(lastUsedOption);
  }, [lastUsedOption]);

  const onSelect = (option) => {
    switch (signerType) {
      case SignerType.POLICY_SERVER:
      case SignerType.KEEPER:
      case SignerType.SEED_WORDS:
      case SignerType.COLDCARD:
      case SignerType.JADE:
      case SignerType.PASSPORT:
      case SignerType.KEYSTONE:
      case SignerType.KRUX:
        setKeyGenerationMode(option.name);
        dispatch(setLastUsedOption({ signerType, option: option.name }));
        break;
      default:
        break;
    }
  };

  const Content = useCallback(() => {
    if (signerType === SignerType.POLICY_SERVER) {
      return (
        <Box style={styles.modalContainer}>
          {Illustration}
          {isHealthcheck ? (
            <Instruction text={signerText.autoHealthCheck} />
          ) : (
            <Text>{signerText.addExtraLayer}</Text>
          )}
        </Box>
      );
    }
    if (
      signerType === SignerType.COLDCARD ||
      signerType === SignerType.JADE ||
      signerType === SignerType.KEYSTONE ||
      signerType === SignerType.PASSPORT ||
      (signerType === SignerType.SEED_WORDS && !isHealthcheck) ||
      signerType === SignerType.KEEPER ||
      signerType === SignerType.KRUX
    ) {
      return (
        <Box style={styles.modalContainer}>
          <SignerNewContent
            options={options}
            onSelect={onSelect}
            keyGenerationMode={keyGenerationMode}
          />
        </Box>
      );
    }
    if (
      signerType === SignerType.BITBOX02 ||
      signerType === SignerType.LEDGER ||
      signerType === SignerType.TREZOR
    ) {
      return (
        <Box>
          <ColdCardUSBInstruction />
        </Box>
      );
    }

    return (
      <SignerContent
        Illustration={Illustration}
        mode={mode}
        options={options}
        Instructions={Instructions}
        keyGenerationMode={keyGenerationMode}
        sepInstruction={sepInstruction}
        onSelect={onSelect}
      />
    );
  }, [signerType, keyGenerationMode, options]);

  const setupContent = useCallback(() => {
    if (signerType === SignerType.COLDCARD || signerType === SignerType.JADE) {
      if (keyGenerationMode === KeyGenerationMode.USB) {
        return (
          <Box>
            <ColdCardUSBInstruction />
          </Box>
        );
      } else {
        return (
          <Box style={styles.modalContainer}>
            {Illustration}
            <Box>
              {Instructions?.map((instruction) => (
                <Instruction text={instruction} key={instruction} />
              ))}
            </Box>
          </Box>
        );
      }
    }
    if (
      signerType === SignerType.KEYSTONE ||
      signerType === SignerType.PASSPORT ||
      signerType === SignerType.SEED_WORDS ||
      signerType === SignerType.KEEPER ||
      signerType === SignerType.KRUX
    ) {
      return (
        <Box style={styles.modalContainer}>
          {Illustration}
          <Box>
            {Instructions?.map((instruction) => (
              <Instruction text={instruction} key={instruction} />
            ))}
          </Box>
        </Box>
      );
    }
    return <Box>{Illustration}</Box>;
  }, [signerType, keyGenerationMode]);
  const { nfcVisible, closeNfc, withNfcModal } = useNfcModal();

  const readFromNFC = async () => {
    try {
      await withNfcModal(async () => {
        const records = await NFC.read([NfcTech.Ndef]);
        try {
          const cosigner = records[0].data;
          isHealthcheck ? onQRScanHealthCheck(cosigner, signer) : onQRScan(cosigner);
        } catch (err) {
          captureError(err);
          showToast(vaultText.invalidNFCTag, <ToastErrorIcon />);
        }
      });
    } catch (err) {
      if (err.toString() === 'Error') {
        console.log('NFC interaction cancelled');
        return;
      }
      captureError(err);
      showToast(common.somethingWrong, <ToastErrorIcon />);
    }
  };

  const { session } = useContext(HCESessionContext);
  const isAndroid = Platform.OS === 'android';

  useEffect(() => {
    if (isAndroid) {
      if (nfcVisible) {
        NFC.startTagSession({ session, content: '', writable: true });
      } else {
        NFC.stopTagSession(session);
      }
    }
    return () => {
      nfcManager.cancelTechnologyRequest();
    };
  }, [nfcVisible]);

  useEffect(() => {
    const unsubConnect = session.on(HCESession.Events.HCE_STATE_WRITE_FULL, () => {
      try {
        // content written from iOS to android
        const data = idx(session, (_) => _.application.content.content);
        if (!data) {
          showToast(errorText.scanValidCoSigner, <ToastErrorIcon />);
          return;
        }
        isHealthcheck ? onQRScanHealthCheck(data, signer) : onQRScan(data);
      } catch (err) {
        captureError(err);
        showToast(common.somethingWrong, <ToastErrorIcon />);
      } finally {
        closeNfc();
      }
    });
    const unsubDisconnect = session.on(HCESession.Events.HCE_STATE_DISCONNECTED, () => {
      closeNfc();
    });
    return () => {
      unsubConnect();
      unsubDisconnect();
      NFC.stopTagSession(session);
    };
  }, [session]);
  const buttonCallback = () => {
    close();
    setOpenSetup(false);
    switch (type) {
      case SignerType.TAPSIGNER:
        return navigateToTapsignerSetup();
      case SignerType.SATOCHIP:
        return navigateToSatochipSetup();
      case SignerType.COLDCARD:
        if (keyGenerationMode === KeyGenerationMode.FILE) {
          return navigateToFileBasedSigner(type);
        } else if (keyGenerationMode === KeyGenerationMode.USB) {
          return navigateToSetupWithChannel();
        } else if (keyGenerationMode === KeyGenerationMode.QR) {
          return navigateToAddQrBasedSigner();
        }
        return navigateToColdCardSetup();
      case SignerType.POLICY_SERVER:
        return handleSigningServerKey();
      case SignerType.MOBILE_KEY:
        return navigateToMobileKey(isMultisig);
      case SignerType.SEED_WORDS:
        if (keyGenerationMode === KeyGenerationMode.IMPORT) {
          return navigateToSeedWordSetup(true);
        } else {
          return navigateToSeedWordSetup();
        }
      case SignerType.MY_KEEPER:
        if (mode === InteracationMode.HEALTH_CHECK) {
          return navigateToRecoveryKeySetup();
        }
        return setConfirmPassVisible(true);
      case SignerType.BITBOX02:
      case SignerType.TREZOR:
      case SignerType.LEDGER:
        return navigateToSetupWithChannel();
      case SignerType.PASSPORT:
      case SignerType.KEYSTONE:
      case SignerType.KRUX:
        if (keyGenerationMode === KeyGenerationMode.FILE) {
          return navigateToFileBasedSigner(type);
        }
        return navigateToAddQrBasedSigner();
      case SignerType.SEEDSIGNER:
      case SignerType.SPECTER:
        return navigateToAddQrBasedSigner();
      case SignerType.JADE:
        if (keyGenerationMode === KeyGenerationMode.USB) {
          return navigateToSetupWithChannel();
        }
        return navigateToAddQrBasedSigner();
      case SignerType.KEEPER:
        if (keyGenerationMode === KeyGenerationMode.FILE) {
          return navigateToFileBasedSigner(type);
        }
        if (keyGenerationMode === KeyGenerationMode.NFC) {
          return readFromNFC();
        }
        return navigateToAddQrBasedSigner();
      case SignerType.OTHER_SD:
        return navigateToSetupWithOtherSD();
      case SignerType.PORTAL:
        return navigateToPortalSetup();
      default:
        return null;
    }
  };

  function SignerNewContent({
    options,
    keyGenerationMode,
    onSelect,
  }: {
    options?: any;
    keyGenerationMode: any;
    onSelect: (option) => any;
  }) {
    return (
      <View>
        <Box gap={2} width="100%">
          {options &&
            options.map((option) => (
              <SignerOptionCard
                disabled={option.disabled}
                key={option.name}
                isSelected={keyGenerationMode === option.name}
                name={option.title}
                icon={option.icon}
                onCardSelect={() => {
                  onSelect(option);
                  close();
                  setOpenSetup(true);
                }}
              />
            ))}
        </Box>
      </View>
    );
  }
  const modalContentConfig = {
    [SignerType.COLDCARD]: {
      [KeyGenerationMode.NFC]: {
        setupTitle: signerText.coldCardNfcTitle,
        setupSubTitle: signerText.coldCardNfcDesp,
      },
      [KeyGenerationMode.QR]: {
        setupTitle: signerText.coldCardQrTitle,
        setupSubTitle: signerText.coldCardNfcDesp,
      },
      [KeyGenerationMode.FILE]: {
        setupTitle: signerText.coldCardFileTitle,
        setupSubTitle: signerText.coldCardNfcDesp,
      },
      [KeyGenerationMode.USB]: {
        setupTitle: signerText.coldCardUsbTitle,
        setupSubTitle: signerText.coldCardNfcDesp,
      },
    },
    [SignerType.JADE]: {
      [KeyGenerationMode.QR]: {
        setupTitle: signerText.jadeQrTitle,
        setupSubTitle: signerText.jadeQrSub,
      },

      [KeyGenerationMode.USB]: {
        setupTitle: signerText.jadeUsbtitle,
        setupSubTitle: signerText.jadeQrSub,
      },
    },
    [SignerType.KEYSTONE]: {
      [KeyGenerationMode.QR]: {
        setupTitle: signerText.keyStoneQrTitle,
        setupSubTitle: signerText.keyStoneQrSub,
      },
      [KeyGenerationMode.FILE]: {
        setupTitle: signerText.keyStoneUsbtitle,
        setupSubTitle: signerText.keyStoneQrSub,
      },
    },
    [SignerType.PASSPORT]: {
      [KeyGenerationMode.QR]: {
        setupTitle: signerText.pasportQr,
        setupSubTitle: signerText.pasportQrSub,
      },
      [KeyGenerationMode.FILE]: {
        setupTitle: signerText.pasporfile,
        setupSubTitle: signerText.pasportQrSub,
      },
    },
    [SignerType.SEED_WORDS]: {
      [KeyGenerationMode.IMPORT]: {
        setupTitle: signerText.seedKeyTiltle,
        setupSubTitle: signerText.seedKeySub,
      },
      [KeyGenerationMode.CREATE]: {
        setupTitle: signerText.createSeedKey,
        setupSubTitle: signerText.seedKeySub,
      },
    },
    [SignerType.KEEPER]: {
      [KeyGenerationMode.NFC]: {
        setupTitle: `${signerText.addWith} NFC`,
        setupSubTitle: externalKey.modalSubtitle,
      },
      [KeyGenerationMode.QR]: {
        setupTitle: `${signerText.addWith} QR`,
        setupSubTitle: externalKey.modalSubtitle,
      },
      [KeyGenerationMode.FILE]: {
        setupTitle: `${signerText.addWith} file`,
        setupSubTitle: externalKey.modalSubtitle,
      },
    },
    [SignerType.KRUX]: {
      [KeyGenerationMode.QR]: {
        setupTitle: signerText.kruxQr,
        setupSubTitle: signerText.kruxQrSub,
      },

      [KeyGenerationMode.FILE]: {
        setupTitle: signerText.kruxFile,
        setupSubTitle: signerText.kruxQrSub,
      },
    },
  };
  // Select content dynamically
  const { setupTitle, setupSubTitle } = modalContentConfig[signerType]?.[keyGenerationMode] || {
    title: 'Setup',
    subTitle: 'Configure your signer',
  };

  return (
    <>
      <KeeperModal
        visible={openSetup}
        close={() => setOpenSetup(false)}
        title={setupTitle}
        subTitle={setupSubTitle}
        subTitleWidth={wp(250)}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={setupContent}
        buttonText={common.proceed}
        buttonCallback={buttonCallback}
      />
      <KeeperModal
        visible={visible && !unsupported}
        close={close}
        title={title}
        subTitle={subTitle}
        buttonText={
          signerType === SignerType.COLDCARD ||
          signerType === SignerType.JADE ||
          signerType === SignerType.KEYSTONE ||
          signerType === SignerType.PASSPORT ||
          (signerType === SignerType.SEED_WORDS && !isHealthcheck)
            ? null
            : signerType === SignerType.POLICY_SERVER
            ? isHealthcheck
              ? signerText.startHealthCheck
              : signerText.startSeuo
            : common.proceed
        }
        buttonTextColor={`${colorMode}.buttonText`}
        buttonCallback={buttonCallback}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        Content={Content}
        secondaryButtonText={isHealthcheck ? 'Skip' : null}
        secondaryCallback={
          isHealthcheck ? skipHealthCheckCallBack : type === SignerType.POLICY_SERVER ? close : null
        }
        loading={inProgress}
      />
      <KeeperModal
        visible={confirmPassVisible}
        closeOnOverlayClick={false}
        close={() => setConfirmPassVisible(false)}
        title={signerText.enterPasscode}
        subTitleWidth={wp(240)}
        subTitle={signerText.confirmPasscode}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <PasscodeVerifyModal
            close={() => {
              setConfirmPassVisible(false);
            }}
            onSuccess={() => {
              if (type === SignerType.MY_KEEPER && mode === InteracationMode.HEALTH_CHECK) {
                setConfirmPassVisible(false);
                setBackupModalVisible(true);
              } else {
                generateMyAppKey();
              }
            }}
          />
        )}
      />
      <KeeperModal
        visible={passwordModal && mode === InteracationMode.VAULT_ADDITION}
        close={() => {
          setPasswordModal(false);
        }}
        title={signerText.enterPass}
        subTitle={signerText.enterPassDesp}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() =>
          PasswordEnter({
            primaryMnemonic,
            navigation,
            dispatch,
            pinHash,
            isHealthcheck,
            signer,
            close: () => {
              setPasswordModal(false);
            },
            isMultisig,
            addSignerFlow,
          })
        }
      />
      <KeeperModal
        visible={
          (visible &&
            type === SignerType.POLICY_SERVER &&
            (mode === InteracationMode.RECOVERY || mode === InteracationMode.IDENTIFICATION)) ||
          (type === SignerType.POLICY_SERVER &&
            mode === InteracationMode.HEALTH_CHECK &&
            signingServerHealthCheckOTPModal) ||
          (type === SignerType.POLICY_SERVER &&
            mode === InteracationMode.VAULT_ADDITION &&
            signingServerRecoverOTPModal)
        }
        close={() => {
          if (type === SignerType.POLICY_SERVER && mode === InteracationMode.HEALTH_CHECK) {
            setSigningServerHealthCheckOTPModal(false);
            setOtp('');
          } else {
            setSigningServerRecoverOTPModal(false);
            setOtp('');
          }
          close();
        }}
        title={
          signingServerHealthCheckOTPModal ? common.confirm2FACodeTitle : 'Confirm OTP to setup 2FA'
        }
        subTitle={
          signingServerHealthCheckOTPModal
            ? common.confirm2FACodeSubtitle
            : signerText.settingUpSigner
        }
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={SigningServerOTPModal}
      />
      <KeeperModal
        visible={backupModalVisible}
        close={() => setBackupModalVisible(false)}
        title={settings.RKBackupTitle}
        subTitle={settings.RKBackupSubTitle}
        subTitleWidth={wp(300)}
        modalBackground={`${colorMode}.primaryBackground`}
        subTitleColor={`${colorMode}.secondaryText`}
        textColor={`${colorMode}.modalGreenTitle`}
        showCloseIcon={false}
        buttonText={common.backupNow}
        secondaryButtonText={common.cancel}
        secondaryCallback={() => setBackupModalVisible(false)}
        secButtonTextColor={`${colorMode}.greenText`}
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
      <NfcPrompt visible={nfcVisible} close={closeNfc} />
      {inProgress && <ActivityIndicatorView visible={inProgress} />}
    </>
  );
}

const styles = StyleSheet.create({
  passwordContainer: {
    width: wp(280),
    marginLeft: wp(5),
  },
  cvvInputInfoText: {
    fontSize: 14,
    width: '100%',
    marginVertical: 2,
  },
  infoText: {
    padding: 3,
    fontSize: 14,
    fontWeight: '400',
    width: wp(285),
  },
  learnHow: {
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  signerOptionTitle: {
    marginTop: hp(10),
  },
  setupOptionsContainer: {
    gap: wp(11),
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  modalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 25,
  },
  CVVInputsView: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
export default HardwareModalMap;
