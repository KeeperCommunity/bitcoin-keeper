import React, { useState, useRef, forwardRef, useImperativeHandle, useContext } from 'react';
import useSignerMap from 'src/hooks/useSignerMap';
import SignerModals from '../screens/SignTransaction/SignerModals';
import { ScriptTypes, SignerType, XpubTypes } from 'src/services/wallets/enums';
import { CommonActions, useNavigation } from '@react-navigation/native';
import {
  signTransactionWithColdCard,
  signTransactionWithMobileKey,
  signTransactionWithPortal,
  signTransactionWithSeedWords,
  signTransactionWithTapsigner,
} from '../screens/SignTransaction/signWithSD';
import useTapsignerModal from 'src/hooks/useTapsignerModal';
import { CKTapCard } from 'cktap-protocol-react-native';
import useNfcModal from 'src/hooks/useNfcModal';
import NfcPrompt from 'src/components/NfcPromptAndroid';
import KeeperModal from 'src/components/KeeperModal';
import PasscodeVerifyModal from 'src/components/Modal/PasscodeVerify';
import { Box, useColorMode } from 'native-base';
import { SIGNTRANSACTION } from 'src/navigation/contants';
import { useDispatch } from 'react-redux';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import useToastMessage from 'src/hooks/useToastMessage';
import { getCosignerDetails, signCosignerPSBT } from 'src/services/wallets/factories/WalletFactory';
import { getInputsFromPSBT, getInputsToSignFromPSBT, isPsbtFullySigned } from 'src/utils/utilities';
import * as bitcoin from 'bitcoinjs-lib';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { useAppSelector } from 'src/store/hooks';
import ShareKeyModalContent from 'src/screens/Vault/components/ShareKeyModalContent';
import Text from './KeeperText';
import WalletOperations from 'src/services/wallets/operations';
import ActivityIndicatorView from './AppActivityIndicator/ActivityIndicatorView';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import ThemedSvg from './ThemedSvg.tsx/ThemedSvg';
import { hp } from 'src/constants/responsive';

const RKSignersModal = ({ signer, psbt, isMiniscript, vaultId }, ref) => {
  const { primaryMnemonic }: KeeperApp = useQuery(RealmSchema.KeeperApp)[0];

  const serializedPSBTEnvelop = {
    serializedPSBT: psbt,
  };
  const isMultisig = true;

  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const {
    error: errorText,
    signer: signerText,
    settings,
    common,
    transactions: tnxText,
  } = translations;

  const [coldCardModal, setColdCardModal] = useState(false);
  const [passportModal, setPassportModal] = useState(false);
  const [ledgerModal, setLedgerModal] = useState(false);
  const [trezorModal, setTrezorModal] = useState(false);
  const [bitbox02modal, setBitbox02modal] = useState(false);
  const [seedSignerModal, setSeedSignerModal] = useState(false);
  const [keystoneModal, setKeystoneModal] = useState(false);
  const [jadeModal, setJadeModal] = useState(false);
  const [specterModal, setSpecterModal] = useState(false);
  const [tapsignerModal, setTapsignerModal] = useState(false);
  const [confirmPassVisible, setConfirmPassVisible] = useState(false);
  const [portalModal, setPortalModal] = useState(false);
  const [kruxModal, setKruxModal] = useState(false);
  const [openOptionModal, setOpenOptionModal] = useState(false);
  const [details, setDetails] = useState(null);
  const [passwordModal, setPasswordModal] = useState(false);

  const card = useRef(new CKTapCard()).current;
  const { withModal, nfcVisible: TSNfcVisible } = useTapsignerModal(card);
  const { withNfcModal, nfcVisible, closeNfc } = useNfcModal();
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const [broadcastModal, setBroadcastModal] = useState(false);
  const [tnxHex, setTnxHex] = useState(null);
  const [broadcastSuccess, setBroadcastSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const textRef = useRef(null);
  const { signerMap } = useSignerMap();
  const signerType = signer.type;
  const navigation = useNavigation();

  useImperativeHandle(ref, () => {
    return {
      openModal() {
        selectWalletModal();
      },
    };
  });

  const selectWalletModal = async () => {
    switch (signerType) {
      case SignerType.COLDCARD:
        setColdCardModal(true);
        break;
      case SignerType.PASSPORT:
        setPassportModal(true);
        break;
      case SignerType.LEDGER:
        setLedgerModal(true);
        break;
      case SignerType.TREZOR:
        setTrezorModal(true);
        break;
      case SignerType.BITBOX02:
        setBitbox02modal(true);
        break;
      case SignerType.KEYSTONE:
        setKeystoneModal(true);
        break;
      case SignerType.JADE:
        setJadeModal(true);
        break;
      case SignerType.SEEDSIGNER:
        setSeedSignerModal(true);
        break;
      case SignerType.SPECTER:
        setSpecterModal(true);
        break;
      case SignerType.TAPSIGNER:
        setTapsignerModal(true);
        break;
      case SignerType.MY_KEEPER:
        setConfirmPassVisible(true);
        break;
      case SignerType.KEEPER:
        showToast(
          `You cannot sign with an external key, please share transaction with the key owner`
        );
        break;
      case SignerType.PORTAL:
        setPortalModal(true);
        break;
      case SignerType.KRUX:
        setKruxModal(true);
        break;
      case SignerType.SEED_WORDS: {
        if (vaultKeys.xpriv) setConfirmPassVisible(true);
        else
          navigation.dispatch(
            CommonActions.navigate({
              name: 'EnterSeedScreen',
              params: {
                parentScreen: SIGNTRANSACTION,
                xfp: vaultKeys.xfp,
                onSuccess: signTransaction,
              },
            })
          );
      }

      default:
        break;
    }
  };

  const navigateToShowPSBT = (signedSerializedPSBT: string) => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'ShowPSBT',
        params: {
          data: signedSerializedPSBT,
          encodeToBytes: false,
          title: signerText.PSBTSigned,
          subtitle: signerText.PSBTSignedDesc,
          type: SignerType.KEEPER,
          isSignedPSBT: false,
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
          navigateToShowPSBT={navigateToShowPSBT}
          setShareKeyModal={setOpenOptionModal}
          data={details}
          isSignedPSBT
          isPSBTSharing
          fileName={`signedTransaction.psbt`}
        />
      </Box>
    );
  }

  const signTransaction = async ({
    seedBasedSingerMnemonic,
    tapsignerCVC,
    portalCVC,
    signedSerializedPSBT,
  }) => {
    try {
      if (SignerType.SEED_WORDS === signerType) {
        const signSeedKeyWithPin = async () => {
          const inputs = getInputsFromPSBT(serializedPSBTEnvelop.serializedPSBT);
          const inputsToSign = getInputsToSignFromPSBT(
            serializedPSBTEnvelop.serializedPSBT,
            signer
          );
          const signingPayload = [
            {
              payloadTarget: signerType,
              inputsToSign,
              inputs,
            },
          ];
          const signed = await signTransactionWithMobileKey({
            isRemoteKey: true,
            setPasswordModal,
            signingPayload: signingPayload,
            defaultVault: { signers: [vaultKeys], networkType: bitcoinNetworkType }, // replicating vault details in case of RK,
            serializedPSBT: serializedPSBTEnvelop.serializedPSBT,
            xfp: vaultKeys.xfp,
          });
          return signed;
        };

        const { signedSerializedPSBT } = vaultKeys.xpriv
          ? await signSeedKeyWithPin()
          : await signTransactionWithSeedWords({
              isRemoteKey: true,
              signingPayload: {},
              defaultVault: { signers: [signer], networkType: bitcoinNetworkType }, // replicating vault details in case of RK
              seedBasedSingerMnemonic,
              serializedPSBT: serializedPSBTEnvelop.serializedPSBT,
              xfp: {},
              isMultisig: isMultisig,
            });
        if (signedSerializedPSBT) {
          dispatch(
            healthCheckStatusUpdate([
              {
                signerId: signer.masterFingerprint,
                status: hcStatusType.HEALTH_CHECK_SIGNING,
              },
            ])
          );
          setDetails(signedSerializedPSBT);
          checkIfPsbtIsFullySigned(signedSerializedPSBT);
        }
      } else if (SignerType.MY_KEEPER === signerType) {
        let signedSerializedPSBT: string;
        const key = signer.signerXpubs[XpubTypes.P2WSH][0];
        if (!key.xpriv) {
          let { xpubDetails } = await getCosignerDetails(
            primaryMnemonic,
            signer.extraData.instanceNumber - 1
          );
          if (key.xpub != xpubDetails[XpubTypes.P2WSH].xpub) {
            throw new Error(errorText.cannotGetSignerPrivateKey);
          }
          key.xpriv = xpubDetails[XpubTypes.P2WSH].xpriv;
        }
        signedSerializedPSBT = signCosignerPSBT(
          signer.masterFingerprint,
          key.xpriv,
          serializedPSBTEnvelop.serializedPSBT
        );
        if (signedSerializedPSBT) {
          setDetails(signedSerializedPSBT);
          checkIfPsbtIsFullySigned(signedSerializedPSBT);
        }
      } else if (SignerType.TAPSIGNER === signerType) {
        const currentKey = {
          derivationPath: signer.signerXpubs[XpubTypes.P2WSH][0].derivationPath,
        };
        const inputs = getInputsFromPSBT(serializedPSBTEnvelop.serializedPSBT);
        const inputsToSign = getInputsToSignFromPSBT(serializedPSBTEnvelop.serializedPSBT, signer);
        const signingPayload = [
          {
            payloadTarget: signer.type,
            inputsToSign,
            inputs,
          },
        ];

        const { signingPayload: signedPayload } = await signTransactionWithTapsigner({
          setTapsignerModal,
          signingPayload,
          currentKey,
          withModal,
          defaultVault: {},
          serializedPSBT: serializedPSBTEnvelop.serializedPSBT,
          card,
          cvc: tapsignerCVC,
          signer,
        });
        const psbt = bitcoin.Psbt.fromBase64(serializedPSBTEnvelop.serializedPSBT);
        signedPayload[0].inputsToSign.forEach(
          ({ inputIndex, signature, publicKey, sighashType }) => {
            psbt.addSignedDigest(
              inputIndex,
              Buffer.from(publicKey, 'hex'),
              Buffer.from(signature, 'hex'),
              sighashType
            );
          }
        );
        const signedPSBT = psbt.toBase64();
        dispatch(
          healthCheckStatusUpdate([
            {
              signerId: signer.masterFingerprint,
              status: hcStatusType.HEALTH_CHECK_SIGNING,
            },
          ])
        );
        return signedPSBT;
      } else if (SignerType.PORTAL === signerType) {
        const { signedSerializedPSBT } = await signTransactionWithPortal({
          setPortalModal,
          withNfcModal,
          serializedPSBTEnvelop,
          closeNfc,
          vault: {},
          portalCVC,
        });
        dispatch(
          healthCheckStatusUpdate([
            {
              signerId: signer.masterFingerprint,
              status: hcStatusType.HEALTH_CHECK_SIGNING,
            },
          ])
        );
        if (signedSerializedPSBT) {
          setDetails(signedSerializedPSBT);
          checkIfPsbtIsFullySigned(signedSerializedPSBT);
        } else throw new Error('Portal signing failed');
        return signedSerializedPSBT;
      } else if (SignerType.COLDCARD === signerType) {
        await signTransactionWithColdCard({
          setColdCardModal,
          withNfcModal,
          serializedPSBTEnvelop,
          closeNfc,
        });
      } else {
        if (signedSerializedPSBT) {
          setDetails(signedSerializedPSBT);
          checkIfPsbtIsFullySigned(signedSerializedPSBT);
        } else {
          throw new Error('Cannot get signed PSBT');
        }
      }
    } catch (error) {
      console.log('🚀 ~ signTransaction ~ error:', error);
      showToast(`${error}`);
    }
  };

  const checkIfPsbtIsFullySigned = (signedSerializedPSBT) => {
    setLoading(true);
    const hex = isPsbtFullySigned(signedSerializedPSBT);
    if (hex) {
      setBroadcastModal(true);
      setTnxHex(hex);
    } else setOpenOptionModal(true);
    setLoading(false);
  };

  const onFileSign = (signedSerializedPSBT: string) => {
    dispatch(
      healthCheckStatusUpdate([
        {
          signerId: signer.masterFingerprint,
          status: hcStatusType.HEALTH_CHECK_SIGNING,
        },
      ])
    );
    setDetails(signedSerializedPSBT);
    checkIfPsbtIsFullySigned(signedSerializedPSBT);
  };

  const onBroadcastTnx = async () => {
    setLoading(true);
    try {
      await WalletOperations.broadcastTransaction(null, tnxHex, []);
      setBroadcastSuccess(true);
    } catch (error) {
      console.log('🚀 ~ onBroadcastTnx ~ error:', error);
      showToast(error.message, <ToastErrorIcon />);
    } finally {
      setBroadcastModal(false);
      setLoading(false);
    }
  };

  const vaultKeys = {
    masterFingerprint: signer.masterFingerprint,
    xpub: signer.signerXpubs[ScriptTypes.P2WSH][0].xpub,
    xfp: signer.masterFingerprint,
    derivationPath: signer.signerXpubs[ScriptTypes.P2WSH][0].derivationPath,
    registeredVaults: [],
    xpriv: signer.signerXpubs[ScriptTypes.P2WSH][0]?.xpriv,
  };
  return (
    <>
      <NfcPrompt visible={nfcVisible || TSNfcVisible} close={closeNfc} />
      {/* For MK  */}
      <KeeperModal
        visible={confirmPassVisible}
        closeOnOverlayClick={false}
        close={() => setConfirmPassVisible(false)}
        title={settings.EnterPasscodeTitle}
        subTitle={`Confirm passcode to sign with ${signer.signerName}`}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <PasscodeVerifyModal
            useBiometrics={false}
            close={() => {
              setConfirmPassVisible(false);
            }}
            onSuccess={signTransaction}
          />
        )}
      />
      <KeeperModal
        visible={openOptionModal}
        close={() => setOpenOptionModal(false)}
        title="Share Transaction"
        subTitle="Select how you want to share the transaction"
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
        visible={broadcastModal}
        close={() => setBroadcastModal(false)}
        title={tnxText.broadcastTnxTitle}
        subTitle={tnxText.broadcastTnxSubTitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.broadCast}
        buttonCallback={onBroadcastTnx}
        secondaryButtonText={tnxText.shareTnx}
        secondaryCallback={() => {
          setBroadcastModal(false);
          setOpenOptionModal(true);
        }}
        Content={() => (
          <Box gap={hp(20)}>
            <Box alignItems={'center'}>
              <ThemedSvg name={'broadcastModal'} />
            </Box>
            <Box>
              <Text>{tnxText.broadcastTnxText1}</Text>
              <Text>{tnxText.broadcastTnxText2}</Text>
            </Box>
          </Box>
        )}
      />
      <KeeperModal
        visible={broadcastSuccess}
        close={() => setBroadcastSuccess(false)}
        title={tnxText.broadcastSuccessTitle}
        subTitle={tnxText.broadcastSuccessSubTitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonText={common.close}
        buttonCallback={async () => {
          setBroadcastSuccess(false);
          navigation.goBack();
        }}
        Content={() => (
          <Box gap={hp(20)}>
            <Box alignItems={'center'}>
              <ThemedSvg name={'success_illustration'} />
            </Box>
            <Box>
              <Text>{tnxText.broadcastSuccessText1}</Text>
              <Text>{tnxText.broadcastSuccessText2}</Text>
            </Box>
          </Box>
        )}
      />
      <SignerModals
        vaultId={vaultId || ''}
        vaultKeys={[vaultKeys]}
        activeXfp={vaultKeys.masterFingerprint}
        coldCardModal={coldCardModal}
        tapsignerModal={tapsignerModal}
        ledgerModal={ledgerModal}
        otpModal={false}
        passwordModal={passwordModal}
        passportModal={passportModal}
        seedSignerModal={seedSignerModal}
        keystoneModal={keystoneModal}
        jadeModal={jadeModal}
        keeperModal={false}
        trezorModal={trezorModal}
        bitbox02Modal={bitbox02modal}
        otherSDModal={false}
        specterModal={specterModal}
        portalModal={portalModal}
        kruxModal={kruxModal}
        setSpecterModal={setSpecterModal}
        setOtherSDModal={() => {}}
        setTrezorModal={setTrezorModal}
        setBitbox02Modal={setBitbox02modal}
        setJadeModal={setJadeModal}
        setKeystoneModal={setKeystoneModal}
        setSeedSignerModal={setSeedSignerModal}
        setPassportModal={setPassportModal}
        setKeeperModal={() => {}}
        setColdCardModal={setColdCardModal}
        setLedgerModal={setLedgerModal}
        setPasswordModal={setPasswordModal}
        setTapsignerModal={setTapsignerModal}
        showOTPModal={() => {}}
        setPortalModal={setPortalModal}
        setKruxModal={setKruxModal}
        signTransaction={signTransaction}
        textRef={textRef}
        isMultisig={isMultisig}
        signerMap={signerMap}
        onFileSign={onFileSign}
        isRemoteKey={true}
        isMiniscript={isMiniscript}
        serializedPSBTEnvelopFromProps={{
          serializedPSBT: psbt,
          isSigned: false,
          signerType,
          xfp: vaultKeys.xfp,
        }}
      />
      <ActivityIndicatorView visible={loading} />
    </>
  );
};

export default forwardRef(RKSignersModal);
