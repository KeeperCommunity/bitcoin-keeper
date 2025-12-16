import { InteractionManager, Linking, Platform } from 'react-native';
import React, { useContext, useEffect, useRef } from 'react';
import {
  RKInteractionMode,
  SignerStorage,
  SignerType,
  XpubTypes,
} from 'src/services/wallets/enums';
import TickIcon from 'src/assets/images/icon_tick.svg';
import {
  resetElectrumNotConnectedErr,
  setHasDeepLink,
  setIsInitialLogin,
} from 'src/store/reducers/login';
import {
  findChangeFromReceiverAddresses,
  findVaultFromSenderAddress,
} from 'src/utils/service-utilities/utils';
import { useAppSelector } from 'src/store/hooks';
import useToastMessage from 'src/hooks/useToastMessage';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import { useDispatch } from 'react-redux';
import useSigners from 'src/hooks/useSigners';
import { getCosignerDetails } from 'src/services/wallets/factories/WalletFactory';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { generateSignerFromMetaData, getPsbtForHwi } from 'src/hardware';
import { addSigningDevice, refreshCanaryWallets } from 'src/store/sagaActions/vaults';
import { resetVaultMigration, setRemoteLinkDetails } from 'src/store/reducers/vaults';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import dbManager from 'src/storage/realm/dbManager';
import useAsync from 'src/hooks/useAsync';
import { initializeSentry } from 'src/services/sentry';
import Relay from 'src/services/backend/Relay';
import { generateDataFromPSBT } from 'src/utils/utilities';
import { getKeyUID } from 'src/utils/utilities';
import { updatePSBTEnvelops } from 'src/store/reducers/send_and_receive';
import { decrypt, getHashFromKey } from 'src/utils/service-utilities/encryption';
import { CommonActions, useNavigationState } from '@react-navigation/native';
import { updateCachedPsbtEnvelope } from 'src/store/reducers/cachedTxn';
import { store } from 'src/store/store';
import config from 'src/utils/service-utilities/config';
import { SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import messaging from '@react-native-firebase/messaging';
import { notificationType } from 'src/models/enums/Notifications';
import { SignersReqVault } from '../Vault/SigningDeviceDetails';
import useVault from 'src/hooks/useVault';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { setSubscription } from 'src/store/sagaActions/settings';
import { setAppWideLoading, setThemeMode } from 'src/store/reducers/settings';
import ThemeMode from 'src/models/enums/ThemeMode';
import { getString, setItem } from 'src/storage';
import ActivityIndicatorView from 'src/components/AppActivityIndicator/ActivityIndicatorView';
import { setAccountManagerDetails } from 'src/store/reducers/concierge';
export const KEEPER_PRIVATE_LINK = 'KEEPER_PRIVATE_LINK';

function InititalAppController({ navigation, electrumErrorVisible, setElectrumErrorVisible }) {
  const electrumClientConnectionStatus = useAppSelector(
    (state) => state.login.electrumClientConnectionStatus
  );
  const { showToast } = useToastMessage();
  const dispatch = useDispatch();
  const { isInitialLogin, hasDeepLink } = useAppSelector((state) => state.login);
  const { appWideLoading } = useAppSelector((state) => state.settings);
  const appData: any = useQuery(RealmSchema.KeeperApp);
  const { allVaults } = useVault({ includeArchived: false });
  const { translations } = useContext(LocalizationContext);
  const { error: errorText } = translations;
  const isAndroid = Platform.OS === 'android';

  const getAppData = (): { isPleb: boolean; appId: string } => {
    const tempApp = appData.map(getJSONFromRealmObject)[0];
    // const isPleb = tempApp.subscription.name.toUpperCase() === SubscriptionTier.L1.toUpperCase();
    const isPleb = false;
    const appId = tempApp.id.toString();
    return { isPleb, appId };
  };

  function handleDeepLinkEvent(event) {
    const { url } = event;
    if (url) {
      if (url.includes('remote/')) {
        handleRemoteKeyDeepLink(url);
      } else if (url.includes('kp/')) {
        handleKeeperPrivate(url);
      }
    }
  }

  const activeRoute = useNavigationState((state) => {
    const route = state.routes[state.index]; // Get the active route
    return route.name;
  });

  const { inProgress, start } = useAsync();

  const handleRemoteKeyDeepLink = async (initialUrl: string) => {
    dispatch(setAppWideLoading(true));
    const encryptionKey = initialUrl.split('remote/')[1];
    const hash = getHashFromKey(encryptionKey);
    if (encryptionKey && hash) {
      try {
        const res = await Relay.getRemoteKey(hash);
        if (!res) {
          showToast(errorText.remoteKeyLinkExpired);
          return false;
        }
        const { data: response } = res;
        const tempData = JSON.parse(decrypt(encryptionKey, response));
        switch (tempData.type) {
          case RKInteractionMode.SHARE_REMOTE_KEY:
            navigation.navigate('ManageSigners', {
              remoteData: tempData,
            });
            break;

          case RKInteractionMode.SHARE_PSBT:
            const { keyUID, xfp, cachedTxid } = tempData;
            let serializedPSBT = tempData.psbt;

            if (serializedPSBT) {
              try {
                try {
                  const signer = signersRef.current.find((s) => keyUID == getKeyUID(s));
                  // TODO: Need to find a way to detect Miniscript in PSBT without having to import the vault
                  let isMiniscript = false;
                  if (!signer) throw { message: errorText.signerNotFound };
                  let {
                    senderAddresses,
                    receiverAddresses,
                    fees,
                    signerMatched,
                    feeRate,
                    changeAddressIndex,
                  } = generateDataFromPSBT(serializedPSBT, signer);

                  if (!signerMatched) {
                    showToast(errorText.invalidSignerSelection, <ToastErrorIcon />);
                    navigation.goBack();
                    return false;
                  }

                  const activeVault = findVaultFromSenderAddress(allVaults, senderAddresses);
                  if (SignersReqVault.includes(signer.type)) {
                    if (!activeVault) {
                      navigation.goBack();
                      throw new Error(errorText.importBeforeSignig);
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

                  dispatch(setRemoteLinkDetails({ xfp, cachedTxid }));
                  navigation.dispatch(
                    CommonActions.navigate({
                      name: 'PSBTSendConfirmation',
                      params: {
                        sender: senderAddresses,
                        recipient: receiverAddresses,
                        fees: fees,
                        signer,
                        psbt: serializedPSBT,
                        feeRate,
                        isMiniscript,
                      },
                    })
                  );
                } catch (e) {
                  showToast(e.message, <ToastErrorIcon />);
                }
              } catch (e) {
                console.log('🚀 ~ handleRemoteKeyDeepLink ~ e:', e);
                showToast(errorText.somethingWentWrong, <ToastErrorIcon />);
              }
            } else {
              showToast(errorText.invalidLink, <ToastErrorIcon />);
            }
            break;

          case RKInteractionMode.SHARE_SIGNED_PSBT:
            try {
              const { psbt, xfp, cachedTxid } = tempData;
              var state = store.getState();

              if (
                state.sendAndReceive.sendPhaseTwo.cachedTxid === cachedTxid &&
                state.sendAndReceive.sendPhaseTwo.serializedPSBTEnvelops.length &&
                activeRoute != 'Home'
              ) {
                dispatch(updatePSBTEnvelops({ xfp, signedSerializedPSBT: psbt }));
                const navState = navigation.getState();
                const routeIndex = navState.routes.findIndex(
                  (route) => route.name === 'SignTransactionScreen'
                );
                if (routeIndex !== -1) {
                  navigation.pop(navState.index - routeIndex);
                  showToast(errorText.remoteSignedSuccesful, <TickIcon />);
                }
              } else {
                dispatch(updateCachedPsbtEnvelope({ xfp, signedSerializedPSBT: psbt, cachedTxid }));
                showToast(errorText.remoteSignedSuccesful, <TickIcon />);
              }
            } catch (err) {
              if (err.message) showToast(err.message, <ToastErrorIcon />);
              console.log('🚀 ~ handleRemoteKeyDeepLink ~ err:', err);
            }
            break;
          default:
            break;
        }
      } catch (error) {
        console.log('🚀 ~ handleRemoteKeyDeepLink ~ error:', error);
        showToast(errorText.somethingWentWrong);
      } finally {
        dispatch(setAppWideLoading(false));
      }
    } else {
      showToast(errorText.invalidRemoteLink);
    }
    return true;
  };

  const handleKeeperPrivate = async (initialUrl: string) => {
    const previousKeeperPrivateLink = getString(KEEPER_PRIVATE_LINK);
    if (isAndroid && previousKeeperPrivateLink === initialUrl) return false; // check on android if same link gets triggered again on restart

    const [redeemCode, accountManagerId] = initialUrl.split('kp/')[1].split('/');
    try {
      const response = await Relay.redeemKeeperPrivate({
        appId: getAppData().appId,
        redeemCode,
        accountManagerId,
      });
      if (!response.status) {
        showToast(
          response?.message ?? 'Something went wrong, please try again.',
          <ToastErrorIcon />
        );
        return;
      }
      // const subscription = {
      //   productId: response.data.productId,
      //   receipt: response.data.transactionReceipt,
      //   name: response.data.plan,
      //   level: response.data.level,
      //   icon: response.data.icon,
      // };
      // dbManager.updateObjectById(RealmSchema.KeeperApp, getAppData().appId, {
      //   subscription,
      // });
      if (isAndroid) setItem(KEEPER_PRIVATE_LINK, initialUrl); // saving currently availed keeper private deep link on android to avoid processing on restart
      // dispatch(setSubscription(subscription.name));
      // dispatch(setThemeMode(ThemeMode.PRIVATE));
      if (response.isExtended) {
        showToast(
          `You have successfully extended your ${response.data.plan} subscription.`,
          <TickIcon />
        );
      } else {
        showToast(`You are successfully upgraded to ${response.data.plan} tier.`, <TickIcon />);
      }
      const res = await Relay.getAccountManagerDetails(getAppData().appId);
      if (res) dispatch(setAccountManagerDetails(res));
      else dispatch(setAccountManagerDetails(null));
    } catch (error) {
      console.log('🚀 ~ handleKeeperPrivate ~ error:', error);
      showToast('Something went wrong, Please try again.', <ToastErrorIcon />);
    }
  };

  const toggleSentryReports = async () => {
    if (inProgress) {
      return;
    }
    if (config.isDevMode()) {
      await start(() => initializeSentry());
    }
    dbManager.updateObjectById(RealmSchema.KeeperApp, getAppData().appId, {
      enableAnalytics: config.isDevMode(),
    });
  };

  const handleZendeskNotificationRedirection = (data) => {
    if (data?.notificationType === notificationType.ZENDESK_TICKET) {
      const { ticketId = null, ticketStatus = null } = data;
      if (ticketId && ticketStatus)
        navigation.navigate({
          name: 'TicketDetails',
          params: { ticketId: parseInt(ticketId), ticketStatus },
        });
    }
  };

  useEffect(() => {
    const unsubscribe = messaging().onNotificationOpenedApp((remoteMessage) => {
      handleZendeskNotificationRedirection(remoteMessage.data);
    });

    // Listener for when the app is opened from a terminated state
    const getInitialNotification = async () => {
      const initialNotification = await messaging().getInitialNotification();
      if (initialNotification) handleZendeskNotificationRedirection(initialNotification.data);
    };

    getInitialNotification();

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (isInitialLogin) {
      toggleSentryReports();
    }
    dispatch(setIsInitialLogin(false));
    if (hasDeepLink) {
      handleDeepLinkEvent({ url: hasDeepLink });
      dispatch(setHasDeepLink(null));
    }
  }, []);

  async function handleDeepLinking() {
    try {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        if (initialUrl.includes('remote/')) {
          handleRemoteKeyDeepLink(initialUrl);
        }
      }
    } catch (error) {
      //
    }
  }

  useEffect(() => {
    Linking.addEventListener('url', handleDeepLinkEvent);
    handleDeepLinking();
    return () => {
      Linking.removeAllListeners('url');
    };
  }, []);

  useEffect(() => {
    InteractionManager.runAfterInteractions(() => {
      if (electrumClientConnectionStatus.success) {
        if (electrumErrorVisible) setElectrumErrorVisible(false);
      } else if (electrumClientConnectionStatus.failed && !electrumErrorVisible) {
        showToast(`${electrumClientConnectionStatus.error}`, <ToastErrorIcon />);
        setElectrumErrorVisible(true);
      }
    });
  }, [electrumClientConnectionStatus.success, electrumClientConnectionStatus.failed]);

  useEffect(() => {
    InteractionManager.runAfterInteractions(() => {
      if (electrumClientConnectionStatus.setElectrumNotConnectedErr) {
        showToast(
          `${electrumClientConnectionStatus.setElectrumNotConnectedErr}`,
          <ToastErrorIcon />
        );
        dispatch(resetElectrumNotConnectedErr());
      }
    });
  }, [electrumClientConnectionStatus.setElectrumNotConnectedErr]);

  // inital mobile key generation
  const { primaryMnemonic }: KeeperApp = useQuery(RealmSchema.KeeperApp)[0];

  const { signers } = useSigners();
  const signersRef = useRef(signers); // to get the latest value of signers in deep link handler
  const myAppKeys = signers.filter((signer) => signer.type === SignerType.MY_KEEPER);
  const myAppKeyCount = myAppKeys.length;

  useEffect(() => {
    signersRef.current = signers;
  }, [signers]);

  useEffect(() => {
    InteractionManager.runAfterInteractions(() => {
      if (!myAppKeyCount) {
        getCosignerDetails(primaryMnemonic, myAppKeyCount).then((details) => {
          const { signer } = generateSignerFromMetaData({
            xpub: details.xpubDetails[XpubTypes.P2WSH].xpub,
            xpriv: details.xpubDetails[XpubTypes.P2WSH].xpriv,
            derivationPath: details.xpubDetails[XpubTypes.P2WSH].derivationPath,
            masterFingerprint: details.mfp,
            signerType: SignerType.MY_KEEPER,
            storageType: SignerStorage.WARM,
            isMultisig: true,
          });
          dispatch(addSigningDevice([signer]));
        });
      }
    });
  }, []);

  useEffect(() => {
    dispatch(refreshCanaryWallets);
  }, []);

  // cleanup instances on app start
  useEffect(() => {
    dispatch(resetVaultMigration());
  }, []);

  return <ActivityIndicatorView visible={appWideLoading} showLoader />;
}

export default InititalAppController;
