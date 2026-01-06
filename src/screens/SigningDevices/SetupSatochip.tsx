import { Platform, StyleSheet, TouchableOpacity } from 'react-native';
import { Box, Input, useColorMode } from 'native-base';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { ScrollView } from 'react-native-gesture-handler';
import { SatochipCard } from 'satochip-react-native';

import Text from 'src/components/KeeperText';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { SignerStorage, SignerType, XpubTypes } from 'src/services/wallets/enums';
import {
  getCardInfo,
  getSatochipDetails,
  handleSatochipError,
} from 'src/hardware/satochip';
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
import useSatochipModal from 'src/hooks/useSatochipModal';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/icon_tick.svg';
import { hp, windowHeight, windowWidth, wp } from 'src/constants/responsive';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { isTestnet } from 'src/constants/Bitcoin';
import { generateMockExtendedKeyForSigner } from 'src/services/wallets/factories/VaultFactory';
import { Signer, VaultSigner, XpubDetailsType } from 'src/services/wallets/interfaces/vault';
import useAsync from 'src/hooks/useAsync';
import NfcManager from 'react-native-nfc-manager';
import DeviceInfo from 'react-native-device-info';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import MockWrapper from 'src/screens/Vault/MockWrapper';
import { setSigningDevices } from 'src/store/reducers/bhr';
import useUnkownSigners from 'src/hooks/useUnkownSigners';
import { InteracationMode } from '../Vault/HardwareModalMap';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import KeeperModal from 'src/components/KeeperModal';
import ErrorIcon from 'src/assets/images/error.svg';
import ErrorDarkIcon from 'src/assets/images/error-dark.svg';
import HexagonIcon from 'src/components/HexagonIcon';
import SATOCHIPICONLIGHT from 'src/assets/images/satochip_light.svg';
import NFCIcon from 'src/assets/images/nfc_lines.svg';
import NFCIconWhite from 'src/assets/images/nfc_lines_white.svg';
import Colors from 'src/theme/Colors';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import WalletHeader from 'src/components/WalletHeader';
import Instruction from 'src/components/Instruction';
import { useAppSelector } from 'src/store/hooks';
import ShareKeyModalContent from '../Vault/components/ShareKeyModalContent';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';

function SetupSatochip({ route }) {
  const { colorMode } = useColorMode();
  const [pin, setPin] = useState('');
  const navigation = useNavigation();
  const { translations } = useContext(LocalizationContext);
  const {
    signer: signerTranslations,
    common,
    error: errorTranslations,
    satochip: satochipTranslations,
  } = translations;
  const card = useRef(new SatochipCard()).current;
  const { withModal, nfcVisible, closeNfc } = useSatochipModal(card);
  const [openOptionModal, setOpenOptionModal] = useState(false);
  const [setupOptionsModalVisible, setSetupOptionsModalVisible] = useState(false);

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
    signTransaction?: (options: { satochipPin?: string }) => {};
    addSignerFlow?: boolean;
    isRemoteKey?: boolean;
    Illustration?: any;
    Instructions?: any;
  } = route.params;
  const { mapUnknownSigner } = useUnkownSigners();
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [satochipSetupDone, setSatochipSetupDone] = useState(null);
  const [satochipIsSeeded, setSatochipIsSeeded] = useState(null);
  const [satochipIsAuthentic, setSatochipIsAuthentic] = useState(null);
  const [satochipStatusCode, setSatochipStatusCode] = useState(null);
  const isDarkMode = colorMode === 'dark';
  const isHealthCheck = mode === InteracationMode.HEALTH_CHECK;
  const [infoModal, setInfoModal] = useState(false);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const [signedPSBT, setSignedPSBT] = useState(null);

  const onPressHandler = (digit) => {
    let temp = pin;
    if (digit !== 'x') {
      temp += digit;
      setPin(temp);
    }
    if (pin && digit === 'x') {
      setPin(pin.slice(0, -1));
    }
  };
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();

  const onDeletePressed = () => {
    setPin(pin.slice(0, pin.length - 1));
  };

  const { inProgress, start } = useAsync();

  const addSatochipWithProgress = async () => {
    NfcManager.isSupported().then(async (supported) => {
      if (supported) {
        if (mode === InteracationMode.HEALTH_CHECK) verifySatochip();
        await start(addSatochip);
      } else if (!(await DeviceInfo.isEmulator())) {
        showToast(errorTranslations.nfcNotSupported, <ToastErrorIcon />);
      }
    });
  };

  const addSatochip = useCallback(async () => {
    try {
      const { xpub, derivationPath, masterFingerprint, xpubDetails } = await withModal(async () =>
        getSatochipDetails(card, pin, isTestnet(), isMultisig, accountNumber)
      )();
      let satochip: Signer;
      let vaultKey: VaultSigner;
      if (isTestnet() && (await DeviceInfo.isEmulator())) {
        // fetched multi-sig key
        const {
          xpub: multiSigXpub,
          xpriv: multiSigXpriv,
          derivationPath: multiSigPath,
          masterFingerprint,
        } = generateMockExtendedKeyForSigner(true, SignerType.SATOCHIP, bitcoinNetworkType);
        // fetched single-sig key
        const {
          xpub: singleSigXpub,
          xpriv: singleSigXpriv,
          derivationPath: singleSigPath,
        } = generateMockExtendedKeyForSigner(false, SignerType.SATOCHIP, bitcoinNetworkType);

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
          signerType: SignerType.SATOCHIP,
          storageType: SignerStorage.COLD,
          isMultisig,
          xpriv: multiSigXpriv,
          isMock: false,
          xpubDetails,
        });
        satochip = signer;
        vaultKey = key;
      } else {
        const { signer, key } = generateSignerFromMetaData({
          xpub,
          derivationPath,
          masterFingerprint,
          signerType: SignerType.SATOCHIP,
          storageType: SignerStorage.COLD,
          isMultisig,
          xpubDetails,
          isAmf: false,
        });
        satochip = signer;
        vaultKey = key;
      }
      if (mode === InteracationMode.RECOVERY) {
        if (Platform.OS === 'ios') NFC.showiOSMessage('SATOCHIP health check completed');
        dispatch(setSigningDevices(satochip));
        navigation.dispatch(
          CommonActions.navigate('LoginStack', { screen: 'VaultRecoveryAddSigner' })
        );
      } else {
        if (Platform.OS === 'ios')
          NFC.showiOSMessage('SATOCHIP added successfully');
        dispatch(addSigningDevice([satochip]));
        const navigationState = addSignerFlow
          ? {
              name: 'Home',
              params: { selectedOption: 'Keys', addedSigner: satochip },
            }
          : {
              name: 'AddSigningDevice',
              merge: true,
              params: { addedSigner: satochip },
            };
        navigation.dispatch(CommonActions.navigate(navigationState));
      }
    } catch (error) {
      const errorMessage = handleSatochipError(error, navigation);
      if (errorMessage) {
        showToast(errorMessage, <ToastErrorIcon />, IToastCategory.DEFAULT, 3000, true);
      }
    } finally {
      closeNfc();
      card.endNfcSession();
    }
  }, [pin, accountNumber]);

  const verifySatochip = useCallback(async () => {
    try {
      const { masterFingerprint } = await withModal(async () =>
        getSatochipDetails(card, pin, isTestnet(), isMultisig, accountNumber)
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
        if (Platform.OS === 'ios') NFC.showiOSMessage('SATOCHIP verified');
        showToast('SATOCHIP verified', <TickIcon />);
      };

      const handleFailure = () => {
        const errorMessage = errorTranslations.somethingWentWrong;
        if (Platform.OS === 'ios') NFC.showiOSErrorMessage(errorMessage);
        else showToast(errorMessage);
      };

      if (mode === InteracationMode.IDENTIFICATION) {
        const mapped = mapUnknownSigner({ masterFingerprint, type: SignerType.SATOCHIP });
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
      const errorMessage = handleSatochipError(error, navigation);
      if (errorMessage) {
        showToast(errorMessage, <ToastErrorIcon />, IToastCategory.DEFAULT, 3000, true);
      }
    } finally {
      closeNfc();
      card.endNfcSession();
    }
  }, [pin, accountNumber]);

  const signWithSatochip = useCallback(async () => {
    try {
      const signedSerializedPSBT = await signTransaction({ satochipPin: pin });

      if (Platform.OS === 'ios') NFC.showiOSMessage('SATOCHIP signed successfully');
      if (isRemoteKey && signedSerializedPSBT) {
        setSignedPSBT(signedSerializedPSBT);
        setOpenOptionModal(true);
      } else {
        navigation.goBack();
      }
    } catch (error) {
      const errorMessage = handleSatochipError(error, navigation);
      if (errorMessage) {
        showToast(errorMessage, <ToastErrorIcon />, IToastCategory.DEFAULT, 3000, true);
      }
      // propagate error higher since nfc modal cannot be closed from here
      throw new Error(errorMessage);
    } finally {
      closeNfc();
      card.endNfcSession();
    }
  }, [pin]);

  const checkSatochipSetupStatus = useCallback(async () => {
    try {

      // if pin is defined, use it to verify PIN, as required for authenticity check
      const { setupDone, isSeeded, isAuthentic, authenticityMsg } = await withModal(async () => getCardInfo(card, pin))();

      setSatochipSetupDone(setupDone);
      setSatochipIsSeeded(isSeeded);
      setSatochipIsAuthentic(isAuthentic);
      setSatochipStatusCode(authenticityMsg);
      setStatusModalVisible(true);

    } catch (error) {
      const errorMessage = handleSatochipError(error, navigation);
      if (errorMessage) {
        showToast(errorMessage, <ToastErrorIcon />, IToastCategory.DEFAULT, 3000, true);
      }
    } finally {
      closeNfc();
      card.endNfcSession();
    }
  }, [pin]);

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
            icon={<SATOCHIPICONLIGHT />}
          />
          <Box marginLeft={wp(12)}>
            <Text color={`${colorMode}.greenText`} fontSize={15}>
              SATOCHIP
            </Text>
            <Text fontSize={13}>{`${common.status}: ${
              satochipSetupDone
                ? satochipIsSeeded 
                  ? satochipTranslations.satochipAlreadySetupAndSeeded 
                  : satochipTranslations.satochipAlreadySetupButNotSeeded
                : signerTranslations.Uninitialized
            }`}</Text>
          </Box>
        </Box>
        <Box marginTop={hp(10)} marginBottom={hp(40)}>
          {satochipIsAuthentic === true ? (
            <Text style={styles.statusText}>{satochipTranslations.satochipIsAuthentic}</Text>
          ) : (
              <Box
                style={styles.warningContainer}
                backgroundColor={`${colorMode}.errorToastBackground`}
                borderColor={`${colorMode}.alertRed`}
              >
                <Box style={styles.warningIcon}>
                  {colorMode === 'light' ? <ErrorIcon /> : <ErrorDarkIcon />}
                </Box>

                {satochipIsAuthentic === false ? (
                  <Text style={styles.warningText}>
                    {`SATOCHIP is not authentic. ${
                      satochipStatusCode ? satochipStatusCode + '.' : ''
                    } Proceed only if trusted`}
                  </Text>
                ) : (
                  <Text style={styles.warningText}>
                    {`Could not authenticate SATOCHIP. ${satochipStatusCode}`}
                  </Text>
                )
                }
              </Box>
          )
          }
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

  function SetupOptionsModalContent() {
    const handleCheckStatus = () => {
      setSetupOptionsModalVisible(false);
      checkSatochipSetupStatus();
    };

    const handleSetupNewCard = () => {
      setSetupOptionsModalVisible(false);
      navigation.dispatch(
        CommonActions.navigate({
          name: 'SatochipSetupPin',
          params: {
            setupSatochipParams: route.params,
          },
        })
      );
    };

    const handleImportSeed = () => {
      if (pin.length < 4) {
        showToast(satochipTranslations.enterPinFirst, <ToastErrorIcon />);
        return;
      }
      setSetupOptionsModalVisible(false);
      navigation.dispatch(
        CommonActions.navigate({
          name: 'ImportSatochipSeed',
          params: {
            pin,
            setupSatochipParams: route.params,
          },
        })
      );
    };

    const handleResetSeed = () => {
      if (pin.length < 4) {
        showToast(satochipTranslations.enterPinFirst, <ToastErrorIcon />);
        return;
      }
      setSetupOptionsModalVisible(false);
      navigation.dispatch(
        CommonActions.navigate({
          name: 'ResetSatochipSeed',
          params: {
            pin,
            setupSatochipParams: route.params,
          },
        })
      );
    };

    return (
      <Box>
        <TouchableOpacity onPress={handleCheckStatus} testID="checkSatochipSetupStatus">
          <Box
            flexDirection="row"
            alignItems="center"
            paddingVertical={hp(15)}
            paddingHorizontal={wp(10)}
          >
            <Text
              color={`${colorMode}.textGreen`}
              style={styles.modalOptionText}
              medium
              flex={1}
            >
              {satochipTranslations.checkInitialSetupStatus}
            </Text>
            <Box>{colorMode === 'light' ? <NFCIcon /> : <NFCIconWhite />}</Box>
          </Box>
        </TouchableOpacity>

        <Box height={1} backgroundColor={`${colorMode}.separator`} marginHorizontal={wp(10)} />

        <TouchableOpacity onPress={handleSetupNewCard} testID="satochipSetupPin">
          <Box
            flexDirection="row"
            alignItems="center"
            paddingVertical={hp(15)}
            paddingHorizontal={wp(10)}
          >
            <Text
              color={`${colorMode}.textGreen`}
              style={styles.modalOptionText}
              medium
              flex={1}
            >
              {satochipTranslations.setupNewCard}
            </Text>
            <Box>{colorMode === 'light' ? <NFCIcon /> : <NFCIconWhite />}</Box>
          </Box>
        </TouchableOpacity>

        <Box height={1} backgroundColor={`${colorMode}.separator`} marginHorizontal={wp(10)} />

        <TouchableOpacity onPress={handleImportSeed} testID="importSatochipSeed">
          <Box
            flexDirection="row"
            alignItems="center"
            paddingVertical={hp(15)}
            paddingHorizontal={wp(10)}
          >
            <Text
              color={`${colorMode}.textGreen`}
              style={styles.modalOptionText}
              medium
              flex={1}
            >
              {satochipTranslations.importSeed}
            </Text>
            <Box>{colorMode === 'light' ? <NFCIcon /> : <NFCIconWhite />}</Box>
          </Box>
        </TouchableOpacity>

        <Box height={1} backgroundColor={`${colorMode}.separator`} marginHorizontal={wp(10)} />

        <TouchableOpacity onPress={handleResetSeed} testID="resetSatochipSeed">
          <Box
            flexDirection="row"
            alignItems="center"
            paddingVertical={hp(15)}
            paddingHorizontal={wp(10)}
          >
            <Text
              color={`${colorMode}.textGreen`}
              style={styles.modalOptionText}
              medium
              flex={1}
            >
              {satochipTranslations.resetSeed}
            </Text>
            <Box>{colorMode === 'light' ? <NFCIcon /> : <NFCIconWhite />}</Box>
          </Box>
        </TouchableOpacity>
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
              return signerTranslations.VerifySatochip; //'Verify SATOCHIP';
            case InteracationMode.SIGN_TRANSACTION:
              return signerTranslations.SignWithSatochip; //'Sign with SATOCHIP';
            default:
              return signerTranslations.SettingUpSatochip; //'Setting up SATOCHIP';
          }
        })()}
        subTitle={signerTranslations.EnterSatochipPinSubtitle} //'Enter SATOCHIP PIN to proceed'
        rightComponent={
          !isHealthCheck ? (
            <TouchableOpacity style={styles.infoIcon} onPress={() => setInfoModal(true)}>
              <ThemedSvg name={'info_icon'} />
            </TouchableOpacity>
          ) : null
        }
      />
      <MockWrapper
        signerType={SignerType.SATOCHIP}
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
              value={pin}
              onChangeText={setPin}
              secureTextEntry
              showSoftInputOnFocus={false}
              backgroundColor={`${colorMode}.seashellWhite`}
              placeholder="Enter PIN"
              placeholderTextColor="#999999"
            />
          </Box>

          {(mode === InteracationMode.APP_ADDITION || mode === InteracationMode.VAULT_ADDITION) && (
            <TouchableOpacity
              onPress={() => setSetupOptionsModalVisible(true)}
              testID="setupOptionsButton"
            >
              <Box
                style={styles.input}
                flexDirection="row"
                alignItems="center"
                backgroundColor={`${colorMode}.seashellWhite`}
                borderColor={`${colorMode}.separator`}
              >
                <Text color={`${colorMode}.textGreen`} fontSize={14} medium flex={1}>
                  Setup options
                </Text>
                {colorMode === 'light' ? <NFCIcon /> : <NFCIconWhite />}
              </Box>
            </TouchableOpacity>
          )}

          <Text style={styles.heading} color={`${colorMode}.greenText`}>
            Scan SATOCHIP after entering PIN
          </Text>

        </ScrollView>
      </MockWrapper>

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
              default:
                return common.proceed;
            }
          })()}
          primaryCallback={() => {
            switch (mode) {
              case InteracationMode.HEALTH_CHECK:
                return verifySatochip();
              case InteracationMode.SIGN_TRANSACTION:
                return signWithSatochip();
              default:
                return addSatochipWithProgress();
            }
          }}
          primaryDisable={pin.length < 4} // Satochip typically uses 4-digit PINs
          primaryLoading={inProgress}
        />
      </Box>
      <NfcPrompt visible={nfcVisible} close={closeNfc} />
      <KeeperModal
        visible={statusModalVisible}
        close={() => setStatusModalVisible(false)}
        title='SATOCHIP Setup Status'
        subTitle='Current status of your SATOCHIP'
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
        title='Setting up SATOCHIP'
        subTitle='Follow these steps to set up your SATOCHIP'
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

      <KeeperModal
        visible={setupOptionsModalVisible}
        close={() => setSetupOptionsModalVisible(false)}
        title="SATOCHIP Setup Options"
        subTitle="Select an action to perform"
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={SetupOptionsModalContent}
      />

    </ScreenWrapper>
  );
}

export default SetupSatochip;

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
  setupOptionsButton: {
    marginTop: hp(10),
  },
  modalOptionText: {
    fontSize: 14,
    letterSpacing: 0.65,
  },
});