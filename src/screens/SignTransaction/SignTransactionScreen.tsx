import { FlatList, StyleSheet } from 'react-native';
import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { MultisigScriptType, SignerType, VaultType, NetworkType } from 'src/services/wallets/enums';
import { Signer, Vault, VaultSigner } from 'src/services/wallets/interfaces/vault';
import { sendPhaseThree } from 'src/store/sagaActions/send_and_receive';
import { Box, useColorMode } from 'native-base';
import Share from 'react-native-share';
import Buttons from 'src/components/Buttons';
import { CKTapCard } from 'cktap-protocol-react-native';
import {SatochipCard} from "satochip-react-native";
import NfcPrompt from 'src/components/NfcPromptAndroid';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { cloneDeep } from 'lodash';
import { refillMobileKey } from 'src/store/sagaActions/vaults';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import ShareGreen from 'src/assets/images/share-arrow-green.svg';
import ShareWhite from 'src/assets/images/share-arrow-white.svg';
import { sendPhaseThreeReset, updatePSBTEnvelops } from 'src/store/reducers/send_and_receive';
import { useAppSelector } from 'src/store/hooks';
import { useDispatch } from 'react-redux';
import useNfcModal from 'src/hooks/useNfcModal';
import useTapsignerModal from 'src/hooks/useTapsignerModal';
import useSatochipModal from 'src/hooks/useSatochipModal';
import useToastMessage from 'src/hooks/useToastMessage';
import { resetRealyVaultState } from 'src/store/reducers/bhr';
import { healthCheckStatusUpdate } from 'src/store/sagaActions/bhr';
import useVault from 'src/hooks/useVault';
import { signCosignerPSBT } from 'src/services/wallets/factories/WalletFactory';
import KeeperModal from 'src/components/KeeperModal';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useSignerMap from 'src/hooks/useSignerMap';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { getTxHexFromKeystonePSBT } from 'src/hardware/keystone';
import PasscodeVerifyModal from 'src/components/Modal/PasscodeVerify';
import { DelayedTransaction } from 'src/models/interfaces/AssistedKeys';
import { hash256 } from 'src/utils/service-utilities/encryption';
import { hcStatusType } from 'src/models/interfaces/HeathCheckTypes';
import { refreshWallets } from 'src/store/sagaActions/wallets';
import {
  cachedTxSnapshot,
  dropTransactionSnapshot,
  setTransactionSnapshot,
} from 'src/store/reducers/cachedTxn';
import { SIGNTRANSACTION } from 'src/navigation/contants';
import { isReading, stopReading } from 'src/hardware/portal';
import { hp, wp } from 'src/constants/responsive';
import { getKeyUID, getTnxIdFromCachedTnx, validatePSBT } from 'src/utils/utilities';
import { SentryErrorBoundary } from 'src/services/sentry';
import { deleteDelayedTransaction, updateDelayedTransaction } from 'src/store/reducers/storage';
import { Wallet } from 'src/services/wallets/interfaces/wallet';
import { SendConfirmationRouteParams, tnxDetailsProps } from '../Send/SendConfirmation';
import SignerModals from './SignerModals';
import SignerList from './SignerList';
import {
  signTransactionWithColdCard,
  signTransactionWithMobileKey,
  signTransactionWithPortal,
  signTransactionWithSatochip,
  signTransactionWithSeedWords,
  signTransactionWithSigningServer,
  signTransactionWithTapsigner,
} from './signWithSD';
import SendSuccessfulContent from '../Send/SendSuccessfulContent';
import WalletHeader from 'src/components/WalletHeader';

function SignTransactionScreen() {
  const route = useRoute();
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';

  const {
    note,
    vaultId,
    sendConfirmationRouteParams,
    isMoveAllFunds,
    tnxDetails,
    miniscriptTxElements,
    sender,
    internalRecipients,
    addresses,
    amounts,
  } = (route.params || {
    note: '',
    vaultId: '',
    sendConfirmationRouteParams: null,
    isMoveAllFunds: false,
    sender: {},
    miniscriptTxElements: null,
    internalRecipients: [],
    addresses: [],
    amounts: [],
  }) as {
    note: string;
    vaultId: string;
    isMoveAllFunds: boolean;
    sender: Vault;
    sendConfirmationRouteParams: SendConfirmationRouteParams;
    tnxDetails: tnxDetailsProps;
    miniscriptTxElements: {
      selectedPhase: number;
      selectedPaths: number[];
    };
    internalRecipients: (Wallet | Vault)[];
    addresses: string[];
    amounts: number[];
  };

  const { activeVault: defaultVault } = useVault({
    vaultId,
  });

  const { signers: vaultKeys } = defaultVault;

  const { signerMap } = useSignerMap();
  const { translations } = useContext(LocalizationContext);
  const {
    wallet: walletTransactions,
    common,
    error: errorText,
    transactions: transactionText,
    settings: settingsText,
  } = translations;

  const [coldCardModal, setColdCardModal] = useState(false);
  const [tapsignerModal, setTapsignerModal] = useState(false);
  const [satochipModal, setSatochipModal] = useState(false);
  const [ledgerModal, setLedgerModal] = useState(false);
  const [passportModal, setPassportModal] = useState(false);
  const [seedSignerModal, setSeedSignerModal] = useState(false);
  const [specterModal, setSpecterModal] = useState(false);
  const [keystoneModal, setKeystoneModal] = useState(false);
  const [jadeModal, setJadeModal] = useState(false);
  const [keeperModal, setKeeperModal] = useState(false);
  const [trezorModal, setTrezorModal] = useState(false);
  const [bitbox02Modal, setBitbox02Modal] = useState(false);
  const [otherSDModal, setOtherSDModal] = useState(false);
  const [otpModal, showOTPModal] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const [confirmPassVisible, setConfirmPassVisible] = useState(false);
  const [portalModal, setPortalModal] = useState(false);
  const [kruxModal, setKruxModal] = useState(false);
  const [activeXfp, setActiveXfp] = useState<string>();
  const { showToast } = useToastMessage();

  const navigation = useNavigation();
  const serializedPSBTEnvelops = useAppSelector(
    (state) => state.sendAndReceive.sendPhaseTwo.serializedPSBTEnvelops
  );
  const fcmToken = useAppSelector((state) => state.notifications.fcmToken);
  const { relayVaultUpdate, relayVaultError, realyVaultErrorMessage } = useAppSelector(
    (state) => state.bhr
  );

  const sendSuccessful = useAppSelector((state) => state.sendAndReceive.sendPhaseThree.txid);
  const sendFailedMessage = useAppSelector(
    (state) => state.sendAndReceive.sendPhaseThree.failedErrorMessage
  );
  const delayedTransactions = useAppSelector((state) => state.storage.delayedTransactions) || {};

  const [broadcasting, setBroadcasting] = useState(false);
  const [visibleModal, setVisibleModal] = useState(false);
  const card = useRef(new CKTapCard()).current;
  const satochipCard = useRef(new SatochipCard()).current;
  const dispatch = useDispatch();

  const cachedTxn = useAppSelector((state) => state.cachedTxn);
  const cachedTxid = useAppSelector((state) => state.sendAndReceive.sendPhaseTwo.cachedTxid);
  const snapshot: cachedTxSnapshot = cachedTxn.snapshots[cachedTxid];

  const [snapshotOptions, setSnapshotOptions] = useState(snapshot?.options || {});
  const sendAndReceive = useAppSelector((state) => state.sendAndReceive);
  const { bitcoinNetworkType } = useAppSelector((state) => state.settings);
  const [activeSignerName, setActiveSignerName] = useState('');

  useEffect(() => {
    if (sendAndReceive.sendPhaseThree.txid) {
      // transaction successful
      dispatch(dropTransactionSnapshot({ cachedTxid }));
    } else {
      // transaction in process, sets/updates transaction snapshot
      dispatch(
        setTransactionSnapshot({
          cachedTxid,
          snapshot: {
            state: sendAndReceive,
            routeParams: sendConfirmationRouteParams,
            options: snapshotOptions,
            potentialTxId: getTnxIdFromCachedTnx({ snapshot: { state: sendAndReceive } }),
          },
        })
      );
    }
  }, [sendAndReceive, snapshotOptions]);

  useEffect(() => {
    if (relayVaultError) {
      showToast(`Error: ${realyVaultErrorMessage}`, <ToastErrorIcon />);
      dispatch(resetRealyVaultState());
    }
  }, [relayVaultError, realyVaultErrorMessage]);

  useEffect(() => {
    if (sendSuccessful) {
      setBroadcasting(false);
      setVisibleModal(true);
    }
  }, [sendSuccessful]);

  useEffect(() => {
    return () => {
      dispatch(sendPhaseThreeReset());
    };
  }, []);

  useEffect(() => {
    if (sendFailedMessage && broadcasting) {
      setBroadcasting(false);
      showToast(sendFailedMessage);
    }
  }, [sendFailedMessage, broadcasting]);

  useEffect(() => {
    let serverKey: VaultSigner;
    let serverKeySigner: Signer;
    for (const key of vaultKeys) {
      const signer: Signer = signerMap[getKeyUID(key)];
      if (signer.type === SignerType.POLICY_SERVER) {
        serverKey = key;
        serverKeySigner = signer;
      }
    }

    if (serverKey && serverKeySigner) {
      // Server Key is one of the signers
      const serializedPSBTEnvelop = serializedPSBTEnvelops.find(
        (envelop) => envelop.xfp === serverKey.xfp
      );

      if (!serializedPSBTEnvelop) {
        return;
      }

      const delayedTxid = hash256(serializedPSBTEnvelop.serializedPSBT);
      const delayedTx: DelayedTransaction = delayedTransactions[delayedTxid];

      if (delayedTx && delayedTx.signedPSBT) {
        // has a delayed transaction which is already signed by the server key
        dispatch(
          updatePSBTEnvelops({
            signedSerializedPSBT: delayedTx.signedPSBT,
            xfp: serverKey.xfp,
          })
        );
        dispatch(
          healthCheckStatusUpdate([
            {
              signerId: serverKeySigner.masterFingerprint,
              status: hcStatusType.HEALTH_CHECK_SIGNING,
            },
          ])
        );

        dispatch(deleteDelayedTransaction(delayedTxid));
      }
    }
  }, []);

  const onSuccess = () => {
    signTransaction({ xfp: activeXfp });
  };

  const areSignaturesSufficient = () => {
    let signedTxCount = 0;
    serializedPSBTEnvelops.forEach((envelop) => {
      if (envelop.isSigned) signedTxCount += 1;
    });

    const hasThresholdSignatures = signedTxCount >= defaultVault.scheme.m;
    if (signedTxCount === serializedPSBTEnvelops.length) return true;
    if (defaultVault.scheme.multisigScriptType === MultisigScriptType.MINISCRIPT_MULTISIG) {
      if (defaultVault.type === VaultType.MINISCRIPT) return hasThresholdSignatures;
      else if (signedTxCount === serializedPSBTEnvelops.length) return true;
    } else return hasThresholdSignatures;
  };

  useEffect(() => {
    vaultKeys.forEach((vaultKey) => {
      const signer = signerMap[getKeyUID(vaultKey)];
      if (signer.type === SignerType.MY_KEEPER && !vaultKey.xpriv) {
        dispatch(refillMobileKey(vaultKey));
      }
    });
  }, []);

  const { withModal, nfcVisible: TSNfcVisible, closeNfc: closeTSNfc } = useTapsignerModal(card);
  const { withModal: withSatochipModal, nfcVisible: satochipNfcVisible, closeNfc: closeSatochipNfc } = useSatochipModal(satochipCard);
  const { withNfcModal, nfcVisible, closeNfc } = useNfcModal();

  useEffect(() => {
    if (nfcVisible == false && isReading()) stopReading();
  }, [nfcVisible]);

  const signTransaction = useCallback(
    async ({
      xfp,
      signingServerOTP,
      seedBasedSingerMnemonic,
      tapsignerCVC,
      portalCVC,
      satochipPin,
    }: {
      xfp?: string;
      signingServerOTP?: string;
      seedBasedSingerMnemonic?: string;
      tapsignerCVC?: string;
      portalCVC?: string;
      satochipPin?: string;
    } = {}) => {
      const activeId = xfp || activeXfp;
      const currentKey = vaultKeys.filter((vaultKey) => vaultKey.xfp === activeId)[0];
      const signer = signerMap[getKeyUID(currentKey)];
      if (serializedPSBTEnvelops && serializedPSBTEnvelops.length) {
        const serializedPSBTEnvelop = serializedPSBTEnvelops.filter(
          (envelop) => envelop.xfp === activeId
        )[0];
        const copySerializedPSBTEnvelop = cloneDeep(serializedPSBTEnvelop);
        const { signerType, serializedPSBT, signingPayload, xfp } = copySerializedPSBTEnvelop;
        if (SignerType.TAPSIGNER === signerType) {
          try {
            const { signingPayload: signedPayload, signedSerializedPSBT } =
              await signTransactionWithTapsigner({
                setTapsignerModal,
                signingPayload,
                currentKey,
                withModal,
                defaultVault,
                serializedPSBT,
                card,
                cvc: tapsignerCVC,
                signer,
              });
            validatePSBT(
              serializedPSBTEnvelop.serializedPSBT,
              signedSerializedPSBT,
              signer,
              errorText
            );
            dispatch(
              updatePSBTEnvelops({ signedSerializedPSBT, xfp, signingPayload: signedPayload })
            );
            dispatch(
              healthCheckStatusUpdate([
                {
                  signerId: signer.masterFingerprint,
                  status: hcStatusType.HEALTH_CHECK_SIGNING,
                },
              ])
            );
          } catch (error) {
            closeTSNfc();
            throw error;
          }
        } else if (SignerType.SATOCHIP === signerType) {
          try {
            const { signingPayload: signedPayload, signedSerializedPSBT } =
              await signTransactionWithSatochip({
                setSatochipModal,
                signingPayload,
                currentKey,
                withModal: withSatochipModal,
                closeNfc: closeSatochipNfc,
                defaultVault,
                serializedPSBT,
                card: satochipCard,
                pin: satochipPin,
                signer,
              });
            validatePSBT(
              serializedPSBTEnvelop.serializedPSBT,
              signedSerializedPSBT,
              signer,
              errorText
            );
            dispatch(
              updatePSBTEnvelops({ signedSerializedPSBT, xfp, signingPayload: signedPayload })
            );
            dispatch(
              healthCheckStatusUpdate([
                {
                  signerId: signer.masterFingerprint,
                  status: hcStatusType.HEALTH_CHECK_SIGNING,
                },
              ])
            );
          } catch (error) {
            throw error;
          }
        } else if (SignerType.COLDCARD === signerType) {
          await signTransactionWithColdCard({
            setColdCardModal,
            withNfcModal,
            serializedPSBTEnvelop,
            closeNfc,
          });
        } else if (SignerType.MOBILE_KEY === signerType) {
          const { signedSerializedPSBT } = await signTransactionWithMobileKey({
            setPasswordModal,
            signingPayload,
            defaultVault,
            serializedPSBT,
            xfp,
          });
          dispatch(updatePSBTEnvelops({ signedSerializedPSBT, xfp }));
          dispatch(
            healthCheckStatusUpdate([
              {
                signerId: signer.masterFingerprint,
                status: hcStatusType.HEALTH_CHECK_SIGNING,
              },
            ])
          );
        } else if (SignerType.POLICY_SERVER === signerType) {
          const { signedSerializedPSBT, delayed, delayedTransaction } =
            await signTransactionWithSigningServer({
              xfp,
              vault: defaultVault,
              signingPayload,
              signingServerOTP,
              serializedPSBT,
              showOTPModal,
              showToast,
              fcmToken,
            });

          if (delayed) {
            showToast(errorText.transactionBeingProcessed);
            dispatch(updateDelayedTransaction(delayedTransaction));
          } else if (signedSerializedPSBT) {
            dispatch(updatePSBTEnvelops({ signedSerializedPSBT, xfp }));
            dispatch(
              healthCheckStatusUpdate([
                {
                  signerId: signer.masterFingerprint,
                  status: hcStatusType.HEALTH_CHECK_SIGNING,
                },
              ])
            );
          }
        } else if (SignerType.SEED_WORDS === signerType) {
          const { signedSerializedPSBT } = currentKey.xpriv
            ? await signTransactionWithMobileKey({
                setPasswordModal,
                signingPayload,
                defaultVault,
                serializedPSBT,
                xfp,
              })
            : await signTransactionWithSeedWords({
                signingPayload,
                defaultVault,
                seedBasedSingerMnemonic,
                serializedPSBT,
                xfp,
                isMultisig: defaultVault.isMultiSig,
              });
          dispatch(updatePSBTEnvelops({ signedSerializedPSBT, xfp }));
          dispatch(
            healthCheckStatusUpdate([
              {
                signerId: signer.masterFingerprint,
                status: hcStatusType.HEALTH_CHECK_SIGNING,
              },
            ])
          );
        } else if (SignerType.MY_KEEPER === signerType) {
          const signedSerializedPSBT = signCosignerPSBT(
            currentKey.masterFingerprint,
            currentKey.xpriv,
            serializedPSBT
          );
          dispatch(updatePSBTEnvelops({ signedSerializedPSBT, xfp }));
          dispatch(
            healthCheckStatusUpdate([
              {
                signerId: signer.masterFingerprint,
                status: hcStatusType.HEALTH_CHECK_SIGNING,
              },
            ])
          );
        } else if (SignerType.PORTAL === signerType) {
          try {
            const { signedSerializedPSBT } = await signTransactionWithPortal({
              setPortalModal,
              withNfcModal,
              serializedPSBTEnvelop,
              closeNfc,
              vault: defaultVault,
              portalCVC,
            });
            validatePSBT(
              serializedPSBTEnvelop.serializedPSBT,
              signedSerializedPSBT,
              signer,
              errorText
            );
            dispatch(updatePSBTEnvelops({ signedSerializedPSBT, xfp }));
            dispatch(
              healthCheckStatusUpdate([
                {
                  signerId: signer.masterFingerprint,
                  status: hcStatusType.HEALTH_CHECK_SIGNING,
                },
              ])
            );
          } catch (error) {
            showToast(error.message, <ToastErrorIcon />);
          }
        }
      }
    },
    [activeXfp, serializedPSBTEnvelops, delayedTransactions, defaultVault]
  );

  const onFileSign = (signedSerializedPSBT: string) => {
    const currentKey = vaultKeys.filter((vaultKey) => vaultKey.xfp === activeXfp)[0];
    const signer = signerMap[getKeyUID(currentKey)];
    if (signer.type === SignerType.KEYSTONE) {
      const serializedPSBTEnvelop = serializedPSBTEnvelops.filter(
        (envelop) => envelop.xfp === activeXfp
      )[0];
      const tx = getTxHexFromKeystonePSBT(
        serializedPSBTEnvelop.serializedPSBT,
        signedSerializedPSBT
      );
      dispatch(updatePSBTEnvelops({ xfp: activeXfp, txHex: tx.toHex() }));
      dispatch(
        healthCheckStatusUpdate([
          {
            signerId: signer.masterFingerprint,
            status: hcStatusType.HEALTH_CHECK_SIGNING,
          },
        ])
      );
      return;
    }
    dispatch(updatePSBTEnvelops({ signedSerializedPSBT, xfp: activeXfp }));
    dispatch(
      healthCheckStatusUpdate([
        {
          signerId: signer.masterFingerprint,
          status: hcStatusType.HEALTH_CHECK_SIGNING,
        },
      ])
    );
  };

  const callbackForSigners = (vaultKey: VaultSigner, signer: Signer) => {
    setActiveXfp(vaultKey.xfp);
    if (areSignaturesSufficient()) {
      showToast(errorText.enoughtSignature);
      return;
    }
    setActiveSignerName(signer.signerName);
    switch (signer.type) {
      case SignerType.TAPSIGNER:
        setTapsignerModal(true);
        break;
      case SignerType.SATOCHIP:
        setSatochipModal(true);
        break;
      case SignerType.COLDCARD:
        setColdCardModal(true);
        break;
      case SignerType.LEDGER:
        setLedgerModal(true);
        break;
      case SignerType.MOBILE_KEY:
        setPasswordModal(true);
        break;
      case SignerType.POLICY_SERVER:
        if (signer.signerPolicy) {
          const serializedPSBTEnvelop = serializedPSBTEnvelops.filter(
            (envelop) => envelop.xfp === vaultKey.xfp
          )[0];

          // check existing signing request
          const delayedTxid = hash256(serializedPSBTEnvelop.serializedPSBT);
          const delayedTx: DelayedTransaction = delayedTransactions[delayedTxid];
          if (delayedTx) {
            if (!delayedTx.signedPSBT) {
              showToast(errorText.transactionAlreadySubmitted);
              return;
            }
          }

          showOTPModal(true);
        } else showOTPModal(true);
        break;
      case SignerType.SEED_WORDS: {
        if (vaultKey.xpriv) setConfirmPassVisible(true);
        else {
          navigation.dispatch(
            CommonActions.navigate({
              name: 'EnterSeedScreen',
              params: {
                parentScreen: SIGNTRANSACTION,
                xfp: vaultKey.xfp,
                onSuccess: signTransaction,
              },
            })
          );
        }
        break;
      }
      case SignerType.PASSPORT:
        setPassportModal(true);
        break;
      case SignerType.SPECTER:
        setSpecterModal(true);
        break;
      case SignerType.SEEDSIGNER:
        setSeedSignerModal(true);
        break;
      case SignerType.KEYSTONE:
        setKeystoneModal(true);
        break;
      case SignerType.JADE:
        setJadeModal(true);
        break;
      case SignerType.UNKOWN_SIGNER:
      case SignerType.KEEPER:
        setKeeperModal(true);
        break;
      case SignerType.TREZOR:
        setTrezorModal(true);
        break;
      case SignerType.BITBOX02:
        setBitbox02Modal(true);
        break;
      case SignerType.OTHER_SD:
        setOtherSDModal(true);
        break;
      case SignerType.MY_KEEPER:
        setConfirmPassVisible(true);
        break;
      case SignerType.PORTAL:
        setPortalModal(true);
        break;
      case SignerType.KRUX:
        setKruxModal(true);
        break;
      default:
        showToast(`action not set for ${signer.type}`);
        break;
    }
  };

  const viewDetails = () => {
    setVisibleModal(false);
    navigation.dispatch(
      CommonActions.reset({
        index: 1,
        routes: [
          { name: 'Home' },
          {
            name: 'VaultDetails',
            params: { autoRefresh: true, hardRefresh: false, vaultId, transactionToast: true },
          },
        ],
      })
    );
  };

  const viewManageWallets = () => {
    new Promise((resolve, reject) => {
      try {
        const result = dispatch(refreshWallets([sender], { hardRefresh: false }));
        resolve(result);
      } catch (error) {
        reject(error);
      }
    })
      .then(() => {
        setVisibleModal(false);
        navigation.dispatch(
          CommonActions.reset({
            index: 1,
            routes: [
              { name: 'Home' },
              {
                name: 'ManageWallets',
              },
            ],
          })
        );
      })
      .catch((error) => {
        console.error('Error refreshing wallets:', error);
      });
  };

  const handleShare = async () => {
    const url = `https://mempool.space${
      bitcoinNetworkType === NetworkType.TESTNET ? '/testnet4' : ''
    }/tx/${sendSuccessful}`;

    try {
      await Share.open({
        title: transactionText.TransactionDetails,
        message: transactionText.transactionSuccessSent + url,
      });
    } catch (err) {
      console.error('Share error:', err);
    }
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <ActivityIndicatorView visible={broadcasting} showLoader />
      <WalletHeader
        title={walletTransactions.SignTransaction}
        subTitle={
          serializedPSBTEnvelops.length == 1
            ? walletTransactions.signTransactionWithKey
            : `${walletTransactions.choose} ${defaultVault.scheme.m} ${walletTransactions.keysToSign}`
        }
      />
      <FlatList
        contentContainerStyle={styles.contentContainerStyle}
        data={vaultKeys}
        extraData={serializedPSBTEnvelops}
        keyExtractor={(item) => item.xfp}
        renderItem={({ item, index }) => {
          let isPayloadAvailable = false; // case: payloads are only available for signers on the redeem path of a given miniscript vault
          for (const psbtEnvelop of serializedPSBTEnvelops) {
            if (item.masterFingerprint === psbtEnvelop.mfp) {
              isPayloadAvailable = true;
              break;
            }
          }
          if (isPayloadAvailable) {
            return (
              <Box style={styles.signerListContainer}>
                <SignerList
                  vaultKey={item}
                  callback={() => callbackForSigners(item, signerMap[getKeyUID(item)])}
                  envelops={serializedPSBTEnvelops}
                  signerMap={signerMap}
                />
              </Box>
            );
          }
        }}
      />
      <Box style={styles.buttonContainer}>
        <Buttons
          fullWidth
          primaryDisable={!areSignaturesSufficient()}
          primaryLoading={broadcasting}
          primaryText={common.broadCast}
          primaryCallback={() => {
            if (areSignaturesSufficient()) {
              setBroadcasting(true);
              dispatch(
                sendPhaseThree({
                  wallet: defaultVault,
                  txnPriority: tnxDetails.transactionPriority,
                  note,
                  miniscriptTxElements,
                })
              );
            } else {
              showToast(errorText.notEnoughtSignature);
            }
          }}
        />
      </Box>

      <SignerModals
        vaultId={vaultId}
        vaultKeys={vaultKeys}
        activeXfp={activeXfp}
        coldCardModal={coldCardModal}
        tapsignerModal={tapsignerModal}
        satochipModal={satochipModal}
        portalModal={portalModal}
        ledgerModal={ledgerModal}
        otpModal={otpModal}
        passwordModal={passwordModal}
        passportModal={passportModal}
        seedSignerModal={seedSignerModal}
        keystoneModal={keystoneModal}
        jadeModal={jadeModal}
        keeperModal={keeperModal}
        trezorModal={trezorModal}
        bitbox02Modal={bitbox02Modal}
        otherSDModal={otherSDModal}
        specterModal={specterModal}
        kruxModal={kruxModal}
        setSpecterModal={setSpecterModal}
        setOtherSDModal={setOtherSDModal}
        setTrezorModal={setTrezorModal}
        setBitbox02Modal={setBitbox02Modal}
        setJadeModal={setJadeModal}
        setKeystoneModal={setKeystoneModal}
        setSeedSignerModal={setSeedSignerModal}
        setPassportModal={setPassportModal}
        setKeeperModal={setKeeperModal}
        setColdCardModal={setColdCardModal}
        setLedgerModal={setLedgerModal}
        setPasswordModal={setPasswordModal}
        setTapsignerModal={setTapsignerModal}
        setSatochipModal={setSatochipModal}
        showOTPModal={showOTPModal}
        setPortalModal={setPortalModal}
        setKruxModal={setKruxModal}
        signTransaction={signTransaction}
        isMultisig={defaultVault.isMultiSig}
        signerMap={signerMap}
        onFileSign={onFileSign}
        sendConfirmationRouteParams={sendConfirmationRouteParams}
        tnxDetails={tnxDetails}
        isRemoteKey={false}
        isMiniscript={!!defaultVault?.scheme?.miniscriptScheme}
      />
      <NfcPrompt
        visible={nfcVisible || TSNfcVisible || satochipNfcVisible}
        close={() => (TSNfcVisible ? closeTSNfc() : satochipNfcVisible? closeSatochipNfc() : closeNfc())}
      />
      <KeeperModal
        visible={visibleModal}
        close={() => {
          setVisibleModal(false);
          !isMoveAllFunds ? viewDetails() : viewManageWallets();
        }}
        title={walletTransactions.SendSuccess}
        subTitle={walletTransactions.transactionBroadcasted}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        Content={() => (
          <SendSuccessfulContent
            transactionPriority={tnxDetails.transactionPriority}
            amounts={amounts}
            sender={sender}
            recipients={internalRecipients}
            addresses={addresses}
            primaryText={
              !isMoveAllFunds ? walletTransactions.ViewWallets : walletTransactions.ManageWallets
            }
            primaryCallback={!isMoveAllFunds ? viewDetails : viewManageWallets}
            secondaryCallback={handleShare}
            secondaryText={common.shareDetails}
            SecondaryIcon={isDarkMode ? <ShareWhite /> : <ShareGreen />}
            primaryButtonWidth={wp(142)}
          />
        )}
        DarkCloseIcon={colorMode === 'dark' ? 'light' : 'dark'}
      />
      <KeeperModal
        visible={confirmPassVisible}
        closeOnOverlayClick={false}
        close={() => setConfirmPassVisible(false)}
        title={settingsText.EnterPasscodeTitle}
        subTitle={`Confirm passcode to sign with ${activeSignerName}`}
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
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  signerListContainer: {
    flex: 1,
    paddingHorizontal: '2.5%',
  },
  contentContainerStyle: {
    paddingTop: hp(30),
  },
  buttonContainer: {
    paddingVertical: hp(15),
    paddingHorizontal: '2.5%',
  },
});

export default SentryErrorBoundary(SignTransactionScreen);
