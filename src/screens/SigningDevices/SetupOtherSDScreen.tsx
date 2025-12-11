import { Platform, StyleSheet } from 'react-native';
import React, { useContext, useEffect, useState } from 'react';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { Box, useColorMode } from 'native-base';
import { hp, wp } from 'src/constants/responsive';
import Buttons from 'src/components/Buttons';
import { generateSignerFromMetaData, getSignerNameFromType } from 'src/hardware';
import { useDispatch } from 'react-redux';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { SignerStorage, SignerType } from 'src/services/wallets/enums';
import { addSigningDevice } from 'src/store/sagaActions/vaults';
import useToastMessage, { IToastCategory } from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/icon_tick.svg';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import HWError from 'src/hardware/HWErrorState';
import { setSigningDevices } from 'src/store/reducers/bhr';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import KeeperTextInput from 'src/components/KeeperTextInput';
import { extractColdCardExport } from 'src/hardware/coldcard';
import { getPassportDetails } from 'src/hardware/passport';
import { HWErrorType } from 'src/models/enums/Hardware';
import OptionCard from 'src/components/OptionCard';
import { getKeystoneDetails } from 'src/hardware/keystone';
import { getSeedSignerDetails } from 'src/hardware/seedsigner';
import { getJadeDetails } from 'src/hardware/jade';
import { InteracationMode } from '../Vault/HardwareModalMap';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import WalletHeader from 'src/components/WalletHeader';
import KeeperModal from 'src/components/KeeperModal';
import Instruction from 'src/components/Instruction';
import { TouchableOpacity } from 'react-native-gesture-handler';
import InfoIconDark from 'src/assets/images/info-Dark-icon.svg';
import InfoIcon from 'src/assets/images/info_icon.svg';
import OtherSignerOptionModal from './components/OtherSignerOptionModal';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import useNfcModal from 'src/hooks/useNfcModal';
import NFC from 'src/services/nfc';
import nfcManager, { NfcTech } from 'react-native-nfc-manager';
import { captureError } from 'src/services/sentry';
import { HCESession, HCESessionContext } from 'react-native-hce';
import idx from 'idx';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import config from 'src/utils/service-utilities/config';
import { setShowTipModal } from 'src/store/reducers/settings';

function SetupOtherSDScreen({ route }) {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const [xpub, setXpub] = useState('');
  const [derivationPath, setDerivationPath] = useState('');
  const [masterFingerprint, setMasterFingerprint] = useState('');
  const [optionModal, setOptionModal] = useState(false);
  const [infoModal, setInfoModal] = useState(false);
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const { showToast } = useToastMessage();
  const { translations } = useContext(LocalizationContext);
  const { common, error: errorText, vault: vaultText, signer: signerText } = translations;
  const {
    mode,
    signer: hcSigner,
    isMultisig,
    addSignerFlow = false,
    Illustration,
    Instructions,
  } = route.params;

  const validateAndAddSigner = async () => {
    try {
      if (!xpub.match(/^([xyYzZtuUvV]pub[1-9A-HJ-NP-Za-km-z]{79,108})$/)) {
        throw new Error('Please check the xPub format');
      }
      const { signer, key } = generateSignerFromMetaData({
        xpub,
        derivationPath: derivationPath.replaceAll('h', "'"),
        masterFingerprint,
        isMultisig,
        signerType: SignerType.OTHER_SD,
        storageType: SignerStorage.COLD,
      });
      if (mode === InteracationMode.RECOVERY) {
        dispatch(setSigningDevices(signer));
        navigation.dispatch(
          CommonActions.navigate('LoginStack', { screen: 'VaultRecoveryAddSigner' })
        );
      } else if (mode === InteracationMode.VAULT_ADDITION) {
        dispatch(addSigningDevice([signer]));
        const navigationState = addSignerFlow
          ? { name: 'Home' }
          : { name: 'AddSigningDevice', merge: true, params: {} };
        navigation.dispatch(CommonActions.navigate(navigationState));
        showToast(
          `${signer.signerName} added successfully`,
          <TickIcon />,
          IToastCategory.SIGNING_DEVICE
        );
      } else if (mode === InteracationMode.HEALTH_CHECK) {
        if (key.masterFingerprint === hcSigner.masterFingerprint) {
          dispatch(
            healthCheckStatusUpdate([
              {
                signerId: signer.masterFingerprint,
                status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
              },
            ])
          );
          showToast(signerText.otherSignerVerified, <TickIcon />);
          dispatch(setShowTipModal({ status: true, address: config.ADDRESS.health }));
        } else {
          dispatch(
            healthCheckStatusUpdate([
              {
                signerId: signer.masterFingerprint,
                status: hcStatusType.HEALTH_CHECK_FAILED,
              },
            ])
          );
          showToast(common.somethingWrong, <ToastErrorIcon />);
        }
      }
    } catch (error) {
      if (error instanceof HWError) {
        showToast(error.message, <ToastErrorIcon />);
      } else {
        showToast(error.message, <ToastErrorIcon />);
      }
    }
  };

  const onQrScan = async (qrData) => {
    try {
      let hw: any;
      try {
        hw = getPassportDetails(qrData);
      } catch (e) {
        // ignore and try other type
      }
      try {
        hw = getSeedSignerDetails(qrData);
      } catch (error) {
        // ignore and try other type
      }
      try {
        hw = getKeystoneDetails(qrData);
      } catch (error) {
        // ignore and try other type
      }
      try {
        hw = getJadeDetails(qrData);
      } catch (error) {
        // ignore
      }
      try {
        hw = extractColdCardExport(JSON.parse(qrData), isMultisig);
      } catch (error) {
        // ignore
      }

      if (hw) {
        const { xpub, derivationPath, masterFingerprint, forMultiSig, forSingleSig } = hw;
        if ((isMultisig && forMultiSig) || (!isMultisig && forSingleSig)) {
          const { signer } = generateSignerFromMetaData({
            xpub,
            derivationPath,
            masterFingerprint,
            isMultisig,
            signerType: SignerType.OTHER_SD,
            storageType: SignerStorage.COLD,
          });
          if (signer) {
            dispatch(addSigningDevice([signer]));
            if (mode === InteracationMode.VAULT_ADDITION) {
              navigation.dispatch(CommonActions.navigate({ name: 'Home' }));
              showToast(
                signerText.signerAddedSuccessMessage,
                <TickIcon />,
                IToastCategory.SIGNING_DEVICE
              );
            } else if (mode === InteracationMode.HEALTH_CHECK) {
              navigation.goBack();
              if (signer.masterFingerprint == hcSigner.masterFingerprint) {
                dispatch(
                  healthCheckStatusUpdate([
                    {
                      signerId: signer.masterFingerprint,
                      status: hcStatusType.HEALTH_CHECK_SUCCESSFULL,
                    },
                  ])
                );
                showToast(signerText.otherSignerVerified, <TickIcon />);
                dispatch(setShowTipModal({ status: true, address: config.ADDRESS.health }));
              } else {
                showToast(common.somethingWrong, <ToastErrorIcon />);
              }
            }
          }
        } else {
          throw new HWError(HWErrorType.INVALID_SIG);
        }
      } else {
        showToast(errorText.scanValidQR, <ToastErrorIcon />);
      }
    } catch (e) {
      if (e instanceof HWError) {
        showToast(e.message, <ToastErrorIcon />);
        return;
      }
      showToast(errorText.scanValidCoSigner, <ToastErrorIcon />);
    }
  };

  const navigatetoQR = () => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'ScanQR',
        params: {
          title: `${signerText.settingUp} ${getSignerNameFromType(SignerType.OTHER_SD)}`,
          subtitle: signerText.scanUntilQrDataRetrieved,
          onQrScan,
          setup: true,
          type: SignerType.OTHER_SD,
          isSingning: true,
          importOptions: false,
        },
      })
    );
  };
  const { nfcVisible, closeNfc, withNfcModal } = useNfcModal();

  const readFromNFC = async () => {
    try {
      await withNfcModal(async () => {
        const records = await NFC.read([NfcTech.Ndef]);
        try {
          const cosigner = records[0].data;
          onQrScan(cosigner);
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
        onQrScan(data);
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

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader
        title={`${mode === InteracationMode.HEALTH_CHECK ? common.verify : common.setup} ${
          signerText.otherSigner
        }`}
        subTitle={signerText.manuallyProvideSignerDetails}
        rightComponent={
          InteracationMode.VAULT_ADDITION ? (
            <TouchableOpacity style={styles.infoIcon} onPress={() => setInfoModal(true)}>
              {isDarkMode ? <InfoIconDark /> : <InfoIcon />}
            </TouchableOpacity>
          ) : null
        }
      />
      <Box style={styles.flex}>
        <KeeperTextInput
          placeholder="xPub"
          value={xpub}
          onChangeText={setXpub}
          testID="xPub"
          placeholderTextColor={`${colorMode}.SlateGreen`}
        />
        <KeeperTextInput
          placeholder={signerText.derivationPath}
          value={derivationPath}
          onChangeText={setDerivationPath}
          testID="derivationPath"
          placeholderTextColor={`${colorMode}.SlateGreen`}
        />
        <KeeperTextInput
          placeholder={signerText.masterFingerprint}
          value={masterFingerprint}
          onChangeText={setMasterFingerprint}
          testID="masterFingerprint"
          placeholderTextColor={`${colorMode}.SlateGreen`}
        />
        <OptionCard
          title={signerText.showImportOptions}
          description={signerText.airGappedDevice}
          callback={() => {
            setOptionModal(true);
          }}
        />
      </Box>
      <Buttons
        primaryText={common.proceed}
        primaryCallback={validateAndAddSigner}
        primaryDisable={!xpub.length || !derivationPath.length || masterFingerprint.length !== 8}
      />
      <KeeperModal
        visible={infoModal}
        close={() => {
          setInfoModal(false);
        }}
        title={signerText.addSigner}
        subTitle={signerText.signerReady}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <Box>
            <Box style={styles.illustrations}>{Illustration}</Box>

            {Instructions?.map((instruction) => (
              <Instruction text={instruction} key={instruction} />
            ))}
          </Box>
        )}
      />
      <KeeperModal
        visible={optionModal}
        close={() => {
          setOptionModal(false);
        }}
        title={signerText.addSigner}
        subTitle={signerText.chooseHowToAddSigner}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <Box>
            <OtherSignerOptionModal
              setOptionModal={setOptionModal}
              navigatetoQR={navigatetoQR}
              setData={onQrScan}
              readFromNFC={readFromNFC}
            />
          </Box>
        )}
      />
      <NfcPrompt visible={nfcVisible} close={closeNfc} />
    </ScreenWrapper>
  );
}

export default SetupOtherSDScreen;

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    marginHorizontal: '2.5%',
    marginTop: '5%',
  },
  input: {
    margin: '5%',
    paddingHorizontal: 15,
    width: wp(305),
    height: 50,
    borderRadius: 10,
    backgroundColor: '#f0e7dd',
    letterSpacing: 1,
  },
  infoIcon: {
    marginRight: wp(10),
  },
  illustrations: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: hp(20),
  },
});
