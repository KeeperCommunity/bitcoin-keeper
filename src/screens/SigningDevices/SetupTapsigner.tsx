import { Platform, StyleSheet, TouchableOpacity } from 'react-native';
import { Box, Input, useColorMode } from 'native-base';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { ScrollView } from 'react-native-gesture-handler';
import { CKTapCard } from 'cktap-protocol-react-native';

import Text from 'src/components/KeeperText';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { EntityKind, SignerStorage, SignerType, XpubTypes } from 'src/services/wallets/enums';
import {
  downloadBackup,
  getCardInfo,
  getTapsignerDetails,
  handleTapsignerError,
} from 'src/hardware/tapsigner';
import DeleteDarkIcon from 'src/assets/images/delete.svg';
import DeleteIcon from 'src/assets/images/deleteLight.svg';
import Buttons from 'src/components/Buttons';

import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import NFC from 'src/services/nfc';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import { useCallback, useContext, useRef, useState } from 'react';
import { addSigningDevice } from 'src/store/sagaActions/vaults';
import { generateSignerFromMetaData } from 'src/hardware';
import { useDispatch } from 'react-redux';
import useTapsignerModal from 'src/hooks/useTapsignerModal';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/icon_tick.svg';
import { hp, windowHeight, windowWidth, wp } from 'src/constants/responsive';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { isTestnet } from 'src/constants/Bitcoin';
import { generateMockExtendedKeyForSigner } from 'src/services/wallets/factories/VaultFactory';
import { Signer, VaultSigner, XpubDetailsType } from 'src/services/wallets/interfaces/vault';
import useAsync from 'src/hooks/useAsync';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import DeviceInfo from 'react-native-device-info';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import MockWrapper from 'src/screens/Vault/MockWrapper';
import { setSigningDevices } from 'src/store/reducers/bhr';
import useUnkownSigners from 'src/hooks/useUnkownSigners';
import { InteracationMode } from '../Vault/HardwareModalMap';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { exportFile } from 'src/services/fs';
import KeeperModal from 'src/components/KeeperModal';
import ErrorIcon from 'src/assets/images/error.svg';
import ErrorDarkIcon from 'src/assets/images/error-dark.svg';
import HexagonIcon from 'src/components/HexagonIcon';
import TAPSIGNERICONLIGHT from 'src/assets/images/tapsigner_light.svg';
import NFCIcon from 'src/assets/images/nfc_lines.svg';
import NFCIconWhite from 'src/assets/images/nfc_lines_white.svg';
import Colors from 'src/theme/Colors';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import WalletHeader from 'src/components/WalletHeader';
import Instruction from 'src/components/Instruction';
import { useAppSelector } from 'src/store/hooks';
import ShareKeyModalContent from '../Vault/components/ShareKeyModalContent';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import { setShowTipModal } from 'src/store/reducers/settings';
import config from 'src/utils/service-utilities/config';

function SetupTapsigner({ route }) {
  const { colorMode } = useColorMode();
  const [cvc, setCvc] = useState('');
  const navigation = useNavigation();
  const { translations } = useContext(LocalizationContext);
  const {
    signer: signerTranslations,
    common,
    error: errorTranslations,
    tapsigner: tapsignerTranslations,
  } = translations;
  const card = useRef(new CKTapCard()).current;
  const { withModal, nfcVisible, closeNfc } = useTapsignerModal(card);
  const [openOptionModal, setOpenOptionModal] = useState(false);

  const {
    mode,
    signer,
    isMultisig,
    accountNumber,
    signTransaction,
    addSignerFlow = false,
    isRemoteKey = false,
    Illustration,
    Instructions,
  }: {
    mode: InteracationMode;
    signer: Signer;
    isMultisig: boolean;
    accountNumber: number;
    signTransaction?: (options: { tapsignerCVC?: string }) => {};
    addSignerFlow?: boolean;
    isRemoteKey?: boolean;
    Illustration?: any;
    Instructions?: any;
  } = route.params;
  const { mapUnknownSigner } = useUnkownSigners();
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [tapsignerDerivationPath, setTapsignerDerivationPath] = useState(null);
  const [tapsignerBackupsCount, setTapsignerBackupsCount] = useState(null);
  const isDarkMode = colorMode === 'dark';
  const isHealthCheck = mode === InteracationMode.HEALTH_CHECK;
  const [infoModal, setInfoModal] = useState(false);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const [signedPSBT, setSignedPSBT] = useState(null);

  const onPressHandler = (digit) => {
    let temp = cvc;
    if (digit !== 'x') {
      temp += digit;
      setCvc(temp);
    }
    if (cvc && digit === 'x') {
      setCvc(cvc.slice(0, -1));
    }
  };
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();

  const onDeletePressed = () => {
    setCvc(cvc.slice(0, cvc.length - 1));
  };

  const { inProgress, start } = useAsync();

  const addTapsignerWithProgress = async () => {
    NfcManager.isSupported().then(async (supported) => {
      if (supported) {
        if (mode === InteracationMode.HEALTH_CHECK) verifyTapsginer();
        await start(addTapsigner);
      } else if (!(await DeviceInfo.isEmulator())) {
        showToast(errorTranslations.nfcNotSupported, <ToastErrorIcon />);
      }
    });
  };

  const addTapsigner = useCallback(async () => {
    try {
      const { xpub, derivationPath, masterFingerprint, xpubDetails } = await withModal(async () =>
        getTapsignerDetails(card, cvc, isTestnet(), isMultisig, accountNumber)
      )();
      let tapsigner: Signer;
      let vaultKey: VaultSigner;
      if (isTestnet() && (await DeviceInfo.isEmulator())) {
        // fetched multi-sig key
        const {
          xpub: multiSigXpub,
          xpriv: multiSigXpriv,
          derivationPath: multiSigPath,
          masterFingerprint,
        } = generateMockExtendedKeyForSigner(true, SignerType.TAPSIGNER, bitcoinNetworkType);
        // fetched single-sig key
        const {
          xpub: singleSigXpub,
          xpriv: singleSigXpriv,
          derivationPath: singleSigPath,
        } = generateMockExtendedKeyForSigner(false, SignerType.TAPSIGNER, bitcoinNetworkType);

        const xpubDetails: XpubDetailsType = {};

        xpubDetails[XpubTypes.P2WPKH] = {
          xpub: singleSigXpub,
          xpriv: singleSigXpriv,
          derivationPath: singleSigPath,
        };

        xpubDetails[XpubTypes.P2WSH] = {
          xpub: multiSigXpub,
          xpriv: multiSigXpriv,
          derivationPath: multiSigPath,
        };

        xpubDetails[XpubTypes.AMF] = {
          xpub: multiSigXpub,
          xpriv: multiSigXpriv,
          derivationPath: multiSigPath,
        };

        const { signer, key } = generateSignerFromMetaData({
          xpub: multiSigXpub,
          derivationPath: multiSigPath,
          masterFingerprint,
          signerType: SignerType.TAPSIGNER,
          storageType: SignerStorage.COLD,
          isMultisig,
          xpriv: multiSigXpriv,
          isMock: false,
          xpubDetails,
        });
        tapsigner = signer;
        vaultKey = key;
      } else {
        const { signer, key } = generateSignerFromMetaData({
          xpub,
          derivationPath,
          masterFingerprint,
          signerType: SignerType.TAPSIGNER,
          storageType: SignerStorage.COLD,
          isMultisig,
          xpubDetails,
          isAmf: false,
        });
        tapsigner = signer;
        vaultKey = key;
      }
      if (mode === InteracationMode.RECOVERY) {
        if (Platform.OS === 'ios') NFC.showiOSMessage(tapsignerTranslations.tapsignerHealthCheck);
        dispatch(setSigningDevices(tapsigner));
        navigation.dispatch(
          CommonActions.navigate('LoginStack', { screen: 'VaultRecoveryAddSigner' })
        );
      } else {
        if (Platform.OS === 'ios')
          NFC.showiOSMessage(tapsignerTranslations.tapsignerAddedSuccessfully);
        dispatch(addSigningDevice([tapsigner]));
        const navigationState = addSignerFlow
          ? {
              name: 'Home',
              params: { selectedOption: 'Keys', addedSigner: tapsigner },
            }
          : {
              name: 'AddSigningDevice',
              merge: true,
              params: { addedSigner: tapsigner },
            };
        navigation.dispatch(CommonActions.navigate(navigationState));
      }
    } catch (error) {
      const errorMessage = handleTapsignerError(error, navigation);
      if (errorMessage) {
        showToast(errorMessage, <ToastErrorIcon />, IToastCategory.DEFAULT, 3000, true);
      }
    } finally {
      closeNfc();
      card.endNfcSession();
    }
  }, [cvc, accountNumber]);

  const verifyTapsginer = useCallback(async () => {
    try {
      const { masterFingerprint } = await withModal(async () =>
        getTapsignerDetails(card, cvc, isTestnet(), isMultisig, accountNumber)
      )();
      const handleSuccess = () => {
        dispatch(
          healthCheckStatusUpdate([
            {
              signerId: signer.masterFingerprint,
              status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
            },
          ])
        );
        navigation.dispatch(CommonActions.goBack());
        if (Platform.OS === 'ios') NFC.showiOSMessage(tapsignerTranslations.tapsignerVerified);
        showToast(tapsignerTranslations.tapsignerVerified, <TickIcon />);
        dispatch(setShowTipModal({ status: true, address: config.ADDRESS.health }));
      };

      const handleFailure = () => {
        const errorMessage = errorTranslations.somethingWentWrong;
        if (Platform.OS === 'ios') NFC.showiOSErrorMessage(errorMessage);
        else showToast(errorMessage);
      };

      if (mode === InteracationMode.IDENTIFICATION) {
        const mapped = mapUnknownSigner({ masterFingerprint, type: SignerType.TAPSIGNER });
        if (mapped) {
          handleSuccess();
        } else {
          handleFailure();
        }
      } else {
        if (masterFingerprint === signer.masterFingerprint) {
          handleSuccess();
        } else {
          handleFailure();
        }
      }
    } catch (error) {
      const errorMessage = handleTapsignerError(error, navigation);
      if (errorMessage) {
        showToast(errorMessage, <ToastErrorIcon />, IToastCategory.DEFAULT, 3000, true);
      }
    } finally {
      closeNfc();
      card.endNfcSession();
    }
  }, [cvc, accountNumber]);

  const signWithTapsigner = useCallback(async () => {
    try {
      const signedSerializedPSBT = await signTransaction({ tapsignerCVC: cvc });
      if (Platform.OS === 'ios') NFC.showiOSMessage(tapsignerTranslations.tapsignerSigned);
      if (isRemoteKey && signedSerializedPSBT) {
        setSignedPSBT(signedSerializedPSBT);
        setOpenOptionModal(true);
      } else {
        navigation.goBack();
      }
    } catch (error) {
      const errorMessage = handleTapsignerError(error, navigation);
      if (errorMessage) {
        showToast(errorMessage, <ToastErrorIcon />, IToastCategory.DEFAULT, 3000, true);
      }
    } finally {
      closeNfc();
      card.endNfcSession();
    }
  }, [cvc]);

  const downloadTapsignerBackup = useCallback(async () => {
    try {
      const { backup, cardId } = await withModal(async () => downloadBackup(card, cvc))();
      if (backup) {
        if (Platform.OS === 'ios') NFC.showiOSMessage(tapsignerTranslations.backupRetrieved);
        closeNfc();
        card.endNfcSession();

        const now = new Date();
        const timestamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '');
        const fileName = `backup-${cardId.split('-')[0]}-${timestamp}.aes`;

        await exportFile(
          backup,
          fileName,
          (error) => showToast(error.message, <ToastErrorIcon />),
          'base64'
        );
        navigation.dispatch(CommonActions.goBack());
        showToast(tapsignerTranslations.backupSavedSuccessfully, <TickIcon />);
      } else {
        if (Platform.OS === 'ios')
          NFC.showiOSErrorMessage(tapsignerTranslations.errorWhileDownloading);
        else showToast(tapsignerTranslations.errorWhileDownloading);
      }
    } catch (error) {
      const errorMessage = handleTapsignerError(error, navigation);
      if (errorMessage) {
        showToast(errorMessage, <ToastErrorIcon />, IToastCategory.DEFAULT, 3000, true);
      }
    } finally {
      closeNfc();
      card.endNfcSession();
    }
  }, [cvc]);

  const checkTapsignerSetupStatus = useCallback(async () => {
    try {
      const { cardId, path, backupsCount } = await withModal(async () => getCardInfo(card))();

      if (cardId) {
        if (Platform.OS === 'ios') NFC.showiOSMessage(tapsignerTranslations.tapsignerInfoRetrieved);
        closeNfc();
        card.endNfcSession();

        if (path) {
          setTapsignerDerivationPath(path);
          setTapsignerBackupsCount(backupsCount);
        } else {
          setTapsignerDerivationPath(null);
          setTapsignerBackupsCount(null);
        }
        setStatusModalVisible(true);
      } else {
        if (Platform.OS === 'ios')
          NFC.showiOSErrorMessage(tapsignerTranslations.errorFetchingTapsignerInfo);
        else showToast(tapsignerTranslations.errorFetchingTapsignerInfo);
      }
    } catch (error) {
      const errorMessage = handleTapsignerError(error, navigation);
      if (errorMessage) {
        showToast(errorMessage, <ToastErrorIcon />, IToastCategory.DEFAULT, 3000, true);
      }
    } finally {
      closeNfc();
      card.endNfcSession();
    }
  }, []);

  function StatusModalContent() {
    return (
      <Box>
        <Box
          padding={hp(20)}
          borderRadius={7}
          backgroundColor={`${colorMode}.textInputBackground`}
          flexDirection="row"
        >
          <HexagonIcon
            width={wp(43)}
            height={hp(38)}
            backgroundColor={colorMode === 'light' ? Colors.primaryGreen : Colors.GreenishGrey}
            icon={<TAPSIGNERICONLIGHT />}
          />
          <Box marginLeft={wp(12)}>
            <Text color={`${colorMode}.greenText`} fontSize={15}>
              TAPSIGNER
            </Text>
            <Text fontSize={13}>{`${common.status}: ${
              tapsignerDerivationPath
                ? signerTranslations.AlreadyInitialized
                : signerTranslations.Uninitialized
            }`}</Text>
          </Box>
        </Box>
        <Box marginTop={hp(10)} marginBottom={hp(40)}>
          {tapsignerDerivationPath ? (
            // TODO: Move warning to component
            <Box
              style={styles.warningContainer}
              backgroundColor={`${colorMode}.errorToastBackground`}
              borderColor={`${colorMode}.alertRed`}
            >
              <Box style={styles.warningIcon}>
                {colorMode === 'light' ? <ErrorIcon /> : <ErrorDarkIcon />}
              </Box>
              <Text style={styles.warningText}>
                {`${tapsignerTranslations.tapsigneralreadyexists} ${
                  tapsignerBackupsCount ? tapsignerTranslations.andBackedUp : ''
                }${tapsignerTranslations.proceedOnlyIfTrusted}`}
              </Text>
            </Box>
          ) : (
            <Text style={styles.statusText}>{signerTranslations.NotBeenInitializedBottomText}</Text>
          )}
        </Box>
        <Buttons
          fullWidth
          primaryText={common.Okay}
          primaryCallback={() => {
            setStatusModalVisible(false);
          }}
        />
      </Box>
    );
  }

  function ShareKeyModalData() {
    return (
      <Box>
        <ShareKeyModalContent
          navigation={navigation}
          signer={signer}
          navigateToShowPSBT={navigateToShowPSBT}
          setShareKeyModal={setOpenOptionModal}
          data={signedPSBT}
          isSignedPSBT
          isPSBTSharing
          fileName={`signedTransaction.psbt`}
        />
      </Box>
    );
  }

  const navigateToShowPSBT = (signedSerializedPSBT: string) => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'ShowPSBT',
        params: {
          data: signedSerializedPSBT,
          encodeToBytes: false,
          title: signerTranslations.PSBTSigned,
          subtitle: signerTranslations.PSBTSignedDesc,
          type: SignerType.KEEPER,
          isSignedPSBT: false,
        },
      })
    );
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={(() => {
          switch (mode) {
            case InteracationMode.HEALTH_CHECK:
              return signerTranslations.VerifyTapsigner;
            case InteracationMode.SIGN_TRANSACTION:
              return signerTranslations.SignWithTapsigner;
            case InteracationMode.BACKUP_SIGNER:
              return signerTranslations.SaveTapsignerBackup;
            default:
              return signerTranslations.SettingUpTapsigner;
          }
        })()}
        subTitle={signerTranslations.EnterTapsignerPinSubtitle}
        rightComponent={
          !isHealthCheck ? (
            <TouchableOpacity style={styles.infoIcon} onPress={() => setInfoModal(true)}>
              <ThemedSvg name={'info_icon'} />
            </TouchableOpacity>
          ) : null
        }
      />
      <MockWrapper
        signerType={SignerType.TAPSIGNER}
        addSignerFlow={addSignerFlow}
        mode={mode}
        signerXfp={signer?.masterFingerprint}
      >
        <ScrollView>
          <Box
            style={styles.input}
            backgroundColor={`${colorMode}.seashellWhite`}
            borderColor={`${colorMode}.separator`}
          >
            <Input
              borderWidth={0}
              value={cvc}
              onChangeText={setCvc}
              secureTextEntry
              showSoftInputOnFocus={false}
              backgroundColor={`${colorMode}.seashellWhite`}
            />
          </Box>
          <Text style={styles.heading} color={`${colorMode}.greenText`}>
            {tapsignerTranslations.scanTapsigneraftertheStep}
          </Text>
        </ScrollView>
      </MockWrapper>
      {(mode === InteracationMode.APP_ADDITION || mode === InteracationMode.VAULT_ADDITION) && (
        <TouchableOpacity
          onPress={() => {
            checkTapsignerSetupStatus();
          }}
          testID="checkTapsignerSetupStatus"
        >
          <Box flexDirection="row">
            <Text color={`${colorMode}.textGreen`} style={styles.checkInitialStatus} medium>
              {tapsignerTranslations.checkInitialSetupStatus}
            </Text>
            <Box paddingTop={hp(1)}>{colorMode === 'light' ? <NFCIcon /> : <NFCIconWhite />}</Box>
          </Box>
        </TouchableOpacity>
      )}
      <KeyPadView
        onPressNumber={onPressHandler}
        onDeletePressed={onDeletePressed}
        keyColor={colorMode === 'light' ? '#041513' : '#FFF'}
        ClearIcon={colorMode === 'dark' ? <DeleteIcon /> : <DeleteDarkIcon />}
      />
      <Box style={styles.btnContainer}>
        <Buttons
          fullWidth
          primaryText={(() => {
            switch (mode) {
              case InteracationMode.SIGN_TRANSACTION:
                return common.sign;
              case InteracationMode.BACKUP_SIGNER:
                return signerTranslations.saveBackup;
              default:
                return common.proceed;
            }
          })()}
          primaryCallback={() => {
            switch (mode) {
              case InteracationMode.HEALTH_CHECK:
                return verifyTapsginer();
              case InteracationMode.SIGN_TRANSACTION:
                return signWithTapsigner();
              case InteracationMode.BACKUP_SIGNER:
                return downloadTapsignerBackup();
              default:
                return addTapsignerWithProgress();
            }
          }}
          primaryDisable={cvc.length < 6}
          primaryLoading={inProgress}
        />
      </Box>
      <NfcPrompt visible={nfcVisible} close={closeNfc} />
      <KeeperModal
        visible={statusModalVisible}
        close={() => setStatusModalVisible(false)}
        title={signerTranslations.TapsignerSetupStatus}
        subTitle={signerTranslations.TapsignerSetupStatusSubtitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={StatusModalContent}
      />
      <KeeperModal
        visible={infoModal}
        close={() => {
          setInfoModal(false);
        }}
        title={signerTranslations.SettingUpTapsigner}
        subTitle={tapsignerTranslations.SetupDescription}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <Box>
            <Box style={styles.illustration}>{Illustration}</Box>

            {Instructions?.map((instruction) => (
              <Instruction text={instruction} key={instruction} />
            ))}
          </Box>
        )}
      />
      <KeeperModal
        visible={openOptionModal}
        close={() => setOpenOptionModal(false)}
        title={signerTranslations.signTransaction}
        subTitle={signerTranslations.selectSignOption}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <Box>
            <ShareKeyModalData />
          </Box>
        )}
      />
    </ScreenWrapper>
  );
}

export default SetupTapsigner;

const styles = StyleSheet.create({
  header: {
    flex: 1,
    paddingHorizontal: '5%',
    marginBottom: windowHeight > 850 ? 0 : '25%',
  },
  input: {
    marginVertical: '5%',
    marginHorizontal: '3%',
    paddingHorizontal: 15,
    width: wp(305),
    height: 50,
    borderRadius: 10,
    letterSpacing: 5,
    justifyContent: 'center',
    borderWidth: 1,
  },
  heading: {
    margin: '5%',
    padding: 5,
    width: windowWidth * 0.8,
    fontSize: 13,
    letterSpacing: 0.65,
  },
  btnContainer: {
    justifyContent: 'flex-end',
    flexDirection: 'row',
    paddingHorizontal: '3%',
    paddingTop: '5%',
  },
  checkInitialStatus: {
    fontSize: 13,
    textAlign: 'left',
    marginBottom: hp(30),
    marginLeft: hp(15),
    marginRight: wp(7),
  },
  warningContainer: {
    width: '97%',
    alignSelf: 'center',
    marginTop: hp(20),
    paddingVertical: hp(17),
    paddingHorizontal: hp(9),
    borderWidth: 0.5,
    borderRadius: 10,
    flexDirection: 'row',
  },
  warningText: {
    fontSize: 13,
    textAlign: 'left',
    width: '80%',
    marginLeft: wp(10),
  },
  warningIcon: {
    width: wp(30),
    height: hp(30),
    marginTop: hp(5),
    marginHorizontal: hp(2),
  },
  statusText: {
    fontSize: 14,
    textAlign: 'left',
    marginLeft: wp(10),
    marginTop: wp(15),
  },
  infoIcon: {
    marginRight: wp(10),
  },
  illustration: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: hp(20),
  },
});
