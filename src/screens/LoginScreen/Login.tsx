/* eslint-disable react/no-unstable-nested-components */
import Text from 'src/components/KeeperText';
import { Box, StatusBar, theme, useColorMode } from 'native-base';
import React, { useContext, useEffect, useState, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { widthPercentageToDP } from 'react-native-responsive-screen';
import { hp, windowWidth, wp } from 'src/constants/responsive';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import TorAsset from 'src/components/Loader';
import KeeperModal from 'src/components/KeeperModal';
import LoginMethod from 'src/models/enums/LoginMethod';
import ReactNativeBiometrics from 'react-native-biometrics';
import messaging from '@react-native-firebase/messaging';
import { updateFCMTokens } from 'src/store/sagaActions/notifications';
import DowngradeToPleb from 'src/assets/images/downgradetopleb.svg';
import DowngradeToPlebDark from 'src/assets/images/downgradetoplebDark.svg';
import TestnetIndicator from 'src/components/TestnetIndicator';
import { isTestnet } from 'src/constants/Bitcoin';
import { getSecurityTip } from 'src/constants/defaultData';
import RestClient, { TorStatus } from 'src/services/rest/RestClient';
import { setSubscription } from 'src/store/sagaActions/settings';
import { AppSubscriptionLevel, SubscriptionTier } from 'src/models/enums/SubscriptionTier';
import SubScription from 'src/models/interfaces/Subscription';
import dbManager from 'src/storage/realm/dbManager';
import { RealmSchema } from 'src/storage/realm/enum';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import { credsAuth } from 'src/store/sagaActions/login';
import {
  credsAuthenticated,
  setOfflineStatus,
  setRecepitVerificationError,
} from 'src/store/reducers/login';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import {
  increasePinFailAttempts,
  setAutoUpdateEnabledBeforeDowngrade,
  setCampaignFlags,
  setPlebDueToOffline,
} from 'src/store/reducers/storage';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import BounceLoader from 'src/components/BounceLoader';
import { fetchOneDayInsight } from 'src/store/sagaActions/send_and_receive';
import { formatCoolDownTime, PasswordTimeout } from 'src/utils/PasswordTimeout';
import Buttons from 'src/components/Buttons';
import PinDotView from 'src/components/AppPinInput/PinDotView';
import { setAutomaticCloudBackup } from 'src/store/reducers/bhr';
import Relay from 'src/services/backend/Relay';
import { setAccountManagerDetails } from 'src/store/reducers/concierge';
import Fonts from 'src/constants/Fonts';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';
import CampaignModalIllustration from 'src/assets/images/CampaignModalIllustration.svg';
import { uaiType } from 'src/models/interfaces/Uai';
import { addToUaiStack, uaiChecks } from 'src/store/sagaActions/uai';
import { getAdvisors } from 'src/store/sagaActions/advisor';

const RNBiometrics = new ReactNativeBiometrics();

function LoginScreen({ navigation, route }) {
  const { colorMode } = useColorMode();
  const { relogin, title, screen, internalCheck } = route.params;
  const dispatch = useAppDispatch();
  const [passcode, setPasscode] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [loginModal, setLoginModal] = useState(false);
  const [errMessage, setErrMessage] = useState('');
  const existingFCMToken = useAppSelector((state) => state.notifications.fcmToken);
  const { loginMethod } = useAppSelector((state) => state.settings);
  const torEnbled = false;
  const { appId, failedAttempts, lastLoginFailedAt, campaignFlags } = useAppSelector(
    (state) => state.storage
  );
  const [loggingIn, setLogging] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [isBiometric, setIsBiometric] = useState(false);
  const [incorrectPassword, setIncorrectPassword] = useState(false);
  const [loginData] = useState(getSecurityTip());
  const [torStatus, settorStatus] = useState<TorStatus>(RestClient.getTorStatus());
  const retryTime = Number((Date.now() - lastLoginFailedAt) / 1000);
  // const isOnPleb = useAppSelector((state) => state.settings.subscription) === SubscriptionTier.L1;
  // const isKeeperPrivate =
  //   useAppSelector((state) => state.settings.subscription) === SubscriptionTier.L4;
  const isOnPleb = false;
  const isKeeperPrivate = false;
  const { automaticCloudBackup } = useAppSelector((state) => state.bhr);

  const login_button_backGround = ThemedColor({ name: 'login_button_backGround' });
  const slider_background = ThemedColor({ name: 'slider_background' });
  const login_text_color = ThemedColor({ name: 'login_text_color' });
  const login_button_text_color = ThemedColor({ name: 'login_button_text_color' });

  const [canLogin, setCanLogin] = useState(false);
  const {
    isAuthenticated,
    authenticationFailed,
    credsAuthenticatedError,
    recepitVerificationError,
  } = useAppSelector((state) => state.login);

  const { translations } = useContext(LocalizationContext);
  const { login } = translations;
  const { common } = translations;
  const { allAccounts, biometricEnabledAppId } = useAppSelector((state) => state.account);

  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [campaignDetails, setCampaignDetails] = useState(null);

  const onChangeTorStatus = (status: TorStatus) => {
    settorStatus(status);
  };

  async function requestUserPermission() {
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;

    if (enabled) {
      console.log('Authorization status:', authStatus);
    }
  }

  useEffect(() => {
    RestClient.subToTorStatus(onChangeTorStatus);
    if (loggingIn && !isBiometric) {
      attemptLogin(passcode);
    }
    return () => {
      RestClient.unsubscribe(onChangeTorStatus);
    };
  }, [loggingIn, isBiometric]);

  useEffect(() => {
    dispatch(fetchOneDayInsight());
    dispatch(getAdvisors());
    fetchCampaignDetails();
  }, []);

  useEffect(() => {
    const remainingTime = PasswordTimeout(failedAttempts) - retryTime;
    if (failedAttempts >= 1) {
      if (retryTime > PasswordTimeout(failedAttempts)) {
        setCanLogin(true);
        return;
      }

      setTimeout(() => {
        setLoginError(true);
        setErrMessage(`Please try after ${formatCoolDownTime(PasswordTimeout(failedAttempts))}`);
        setCanLogin(false);
      }, 100);

      setTimeout(() => {
        setCanLogin(false);
      }, 1000);

      setTimeout(() => {
        setCanLogin(true);
        setErrMessage('');
        setLoginError(false);
      }, remainingTime * 1000);
    } else {
      setCanLogin(true);
    }
  }, [failedAttempts, lastLoginFailedAt]);

  useEffect(() => {
    biometricAuth();
  }, [canLogin]);

  useEffect(() => {
    requestUserPermission();
  }, []);

  useEffect(() => {
    if (recepitVerificationError && isOnPleb) {
      setLoginError(false);
      setLogging(false);
      dispatch(setRecepitVerificationError(false));
      dispatch(setOfflineStatus(true));
      navigation.replace('App');
    }
  }, [recepitVerificationError]);

  const biometricAuth = async () => {
    if (
      (allAccounts.length === 0 && loginMethod === LoginMethod.BIOMETRIC) ||
      (allAccounts.length > 0 && biometricEnabledAppId !== null)
    ) {
      try {
        setTimeout(async () => {
          if (canLogin) {
            const { success, signature } = await RNBiometrics.createSignature({
              promptMessage: 'Authenticate',
              payload: biometricEnabledAppId ?? appId,
              cancelButtonText: common.usePin,
            });
            if (success) {
              setIsBiometric(true);
              setLoginModal(true);
              setLogging(true);
              setLoginError(false);
              dispatch(
                credsAuth(signature, LoginMethod.BIOMETRIC, false, biometricEnabledAppId ?? appId)
              );
            }
          }
        }, 200);
      } catch (error) {
        //
        console.log(error);
      }
    }
  };

  const onPressNumber = (text) => {
    let tmpPasscode = passcode;
    if (passcode.length < 4) {
      if (text !== 'x') {
        tmpPasscode += text;
        setPasscode(tmpPasscode);
      }
    }
    if (passcode && text === 'x') {
      setPasscode(passcode.slice(0, -1));
      setLoginError(false);
    }
  };

  const onDeletePressed = (text) => {
    setPasscode(passcode.slice(0, passcode.length - 1));
  };

  useEffect(() => {
    if (attempts >= 3 && authenticationFailed) {
      setAttempts(1);
      dispatch(increasePinFailAttempts());
      setIncorrectPassword(true);
    }
  }, [attempts, authenticationFailed]);

  useEffect(() => {
    if (loggingIn && authenticationFailed) {
      setLoginModal(false);
      setIsBiometric(false);
      setPasscode('');

      setAttempts(attempts + 1);

      setLoginError(true);

      if (credsAuthenticatedError) {
        if (credsAuthenticatedError.toString().includes('Incorrect Passcode')) {
          setErrMessage(login.Incorrect);
        } else {
          setErrMessage(credsAuthenticatedError + '\n\n' + login.closeAndReopen);
        }
      }

      setLogging(false);
    }
  }, [authenticationFailed, credsAuthenticatedError, passcode]);

  useEffect(() => {
    if (isAuthenticated && internalCheck) {
      navigation.navigate({
        name: screen,
        params: { isAuthenticated: true },
        merge: true,
      });
      dispatch(credsAuthenticated(false));
    }
  }, [isAuthenticated, internalCheck]);

  const loginModalAction = async () => {
    if (isAuthenticated) {
      setLoginModal(false);
      if (relogin) {
        navigation.navigate({
          name: screen,
          params: { isAuthenticated: true },
          merge: true,
        });
      } else if (appId !== '') {
        updateFCM();
        navigation.replace('App');
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'NewKeeperApp' }] });
      }
      dispatch(credsAuthenticated(false));
      if (isKeeperPrivate) {
        const res = await Relay.getAccountManagerDetails(appId);
        if (res) dispatch(setAccountManagerDetails(res));
        else dispatch(setAccountManagerDetails(null));
      }
    }
  };

  const updateFCM = async () => {
    try {
      const token = await messaging().getToken();
      if (!existingFCMToken || existingFCMToken !== token) dispatch(updateFCMTokens([token]));
    } catch (error) {
      console.log(error);
    }
  };

  const attemptLogin = (passcode: string) => {
    setLoginModal(true);

    dispatch(credsAuth(passcode, LoginMethod.PIN, relogin));
  };

  const modelAsset = useMemo(() => {
    if (torEnbled) {
      return <TorAsset />;
    }
    return loginData.assert;
  }, [torEnbled, torStatus]);

  const modelMessage = useMemo(() => {
    if (torEnbled) {
      if (torStatus === TorStatus.CONNECTED) {
        return loginData.message;
      }
      if (torStatus === TorStatus.ERROR) {
        return '';
      }
      return login.takeUptoMin;
    }
    return loginData.message;
  }, [torEnbled, torStatus]);

  const modelTitle = useMemo(() => {
    if (torEnbled) {
      if (torStatus === TorStatus.CONNECTED) {
        return loginData.title;
      }
      if (torStatus === TorStatus.ERROR) {
        return 'Error';
      }
      return login.connectingToTor;
    }
    return loginData.title;
  }, [torEnbled, torStatus]);

  const modelSubTitle = useMemo(() => {
    if (torEnbled) {
      if (torStatus === TorStatus.CONNECTED) {
        return loginData.subTitle;
      }
      if (torStatus === TorStatus.ERROR) {
        return login.failedToConnectTor;
      }
      return login.networkCallsAndTor;
    }
    return loginData.subTitle;
  }, [torEnbled, torStatus]);

  const modelButtonText = useMemo(() => {
    if (isAuthenticated) {
      if (campaignDetails && !campaignFlags?.loginModalShown) {
        setLoginModal(false);
        dispatch(setCampaignFlags({ key: 'loginModalShown', value: true }));
        setShowCampaignModal(true);
        return null;
      }
      if (torEnbled) {
        if (torStatus === TorStatus.CONNECTED) {
          return common.next;
        }
        if (torStatus === TorStatus.ERROR) {
          return 'Login w/o tor';
        }
        return null;
      }
      return common.next;
    }
    return null;
  }, [torEnbled, torStatus, isAuthenticated]);

  function LoginModalContent() {
    return (
      <Box style={{ width: wp(280) }}>
        <Box style={styles.modalAssetsWrapper}>{modelAsset}</Box>
        <Text color={`${colorMode}.primaryText`} style={styles.modalMessageText}>
          {modelMessage}
        </Text>
        {modelButtonText === null ? (
          <Box style={styles.modalMessageWrapper}>
            <Box style={{ width: '80%' }}>
              <Text
                color={`${colorMode}.primaryText`}
                style={[styles.modalMessageText, { paddingTop: hp(20) }]}
              >
                {login.Wait}
              </Text>
            </Box>
            <Box style={{ width: '20%' }}>
              <BounceLoader />
            </Box>
          </Box>
        ) : null}
      </Box>
    );
  }

  const CampaignContent = () => {
    return (
      <Box>
        <Box alignItems={'center'}>
          <CampaignModalIllustration />
        </Box>
      </Box>
    );
  };

  function resetToPleb() {
    const app: KeeperApp = dbManager.getCollection(RealmSchema.KeeperApp)[0];
    const updatedSubscription: SubScription = {
      receipt: '',
      productId: SubscriptionTier.L1,
      name: SubscriptionTier.L1,
      level: AppSubscriptionLevel.L1,
      icon: 'assets/ic_pleb.svg',
    };
    dbManager.updateObjectById(RealmSchema.KeeperApp, app.id, {
      subscription: updatedSubscription,
    });
    dispatch(setSubscription(updatedSubscription.name));
    dispatch(setOfflineStatus(true));
    // disable assisted server backup for pleb
    dispatch(setAutomaticCloudBackup(false));
    dispatch(setPlebDueToOffline(true));
    dispatch(setAutoUpdateEnabledBeforeDowngrade(automaticCloudBackup));
    navigation.replace('App');
  }

  function NoInternetModalContent() {
    return (
      <Box style={styles.noInternetModalContainer}>
        {colorMode === 'light' ? <DowngradeToPleb /> : <DowngradeToPlebDark />}
      </Box>
    );
  }

  const fetchCampaignDetails = async () => {
    if (!campaignFlags?.loginModalShown && appId != '' && !relogin) {
      const activeCampaign = await Relay.getActiveCampaign(appId);
      if (activeCampaign) {
        setCampaignDetails(activeCampaign);
      }
    }
  };

  const campaignNavigation = () => {
    updateFCM();
    // navigation.reset({
    //   index: 3,
    //   routes: [
    //     {
    //       name: 'App',
    //       state: {
    //         routes: [{ name: 'Home' }, { name: 'ChoosePlan', params: { showDiscounted: true } }],
    //       },
    //     },
    //   ],
    // });
    setShowCampaignModal(false);
  };

  return (
    <Box style={styles.content} safeAreaTop backgroundColor={slider_background}>
      <Box flex={1}>
        <StatusBar />
        <Box flex={1}>
          <Box>
            <Box style={styles.testnetIndicatorWrapper}>{isTestnet() && <TestnetIndicator />}</Box>
            <Text color={login_text_color} fontSize={25} style={styles.welcomeText}>
              {relogin ? title : login.welcomeback}
            </Text>
            <Box>
              <Box style={styles.passcodeWrapper}>
                <Text fontSize={14} color={login_text_color}>
                  {login.enter_your}
                  {login.passcode}
                </Text>
                <PinDotView
                  passCode={passcode}
                  dotColor={login_text_color}
                  borderColor={login_text_color}
                />
              </Box>
            </Box>
            <Box>
              {loginError && (
                <Text style={styles.errorMessage} color={`${colorMode}.error`}>
                  {errMessage}
                </Text>
              )}
            </Box>
          </Box>
          <KeyPadView
            disabled={!canLogin}
            onDeletePressed={onDeletePressed}
            onPressNumber={onPressNumber}
            ClearIcon={<ThemedSvg name="delete_icon" />}
            bubbleEffect
            keyColor={login_text_color}
          />
          <Box style={styles.btnWrapper}>
            <Buttons
              primaryCallback={() => {
                setLoginError(false);
                setLogging(true);
              }}
              primaryText={common.proceed}
              primaryDisable={passcode.length !== 4}
              primaryBackgroundColor={login_button_backGround}
              primaryTextColor={login_button_text_color}
              fullWidth
            />
          </Box>
        </Box>
      </Box>
      <KeeperModal
        visible={loginModal && !internalCheck}
        close={() => {}}
        title={modelTitle}
        subTitle={modelSubTitle}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        buttonBackground={`${colorMode}.pantoneGreen`}
        showCloseIcon={false}
        buttonText={modelButtonText}
        buttonCallback={loginModalAction}
        buttonTextColor={`${colorMode}.buttonText`}
        Content={LoginModalContent}
        subTitleWidth={wp(280)}
      />
      {campaignDetails && (
        <KeeperModal
          visible={showCampaignModal}
          close={() => {}}
          title={campaignDetails?.loginModalText?.title ?? ''}
          subTitle={campaignDetails?.loginModalText?.subTitle ?? ''}
          modalBackground={`${colorMode}.modalWhiteBackground`}
          textColor={`${colorMode}.textGreen`}
          subTitleColor={`${colorMode}.modalSubtitleBlack`}
          buttonBackground={`${colorMode}.pantoneGreen`}
          showCloseIcon={false}
          buttonText={campaignDetails?.loginModalText?.primaryCTA ?? common.next}
          buttonCallback={campaignNavigation}
          buttonTextColor={`${colorMode}.buttonText`}
          Content={CampaignContent}
          subTitleWidth={wp(280)}
          secondaryButtonText={common.goToWallets}
          secondaryCallback={() => {
            dispatch(
              addToUaiStack({ entityId: campaignDetails.planName, uaiType: uaiType.CAMPAIGN })
            );
            dispatch(uaiChecks([uaiType.CAMPAIGN]));
            loginModalAction();
          }}
          secondaryIcon={<ThemedSvg name="smallWallet" />}
        />
      )}

      <KeeperModal
        dismissible={false}
        close={() => {}}
        visible={!isOnPleb && recepitVerificationError}
        title={common.somethingWrong}
        subTitle={login.checkConnection}
        Content={NoInternetModalContent}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        subTitleWidth={wp(230)}
        showCloseIcon={false}
        buttonText={common.retry}
        buttonCallback={() => {
          setLoginError(false);
          setLogging(true);
          dispatch(setRecepitVerificationError(false));
          dispatch(credsAuth(passcode, LoginMethod.PIN, relogin));
        }}
        secondaryButtonText={login.continueOffline}
        secondaryCallback={() => {
          setLoginError(false);
          setLogging(false);
          dispatch(setRecepitVerificationError(false));
          // resetToPleb();
        }}
      />
      <KeeperModal
        visible={incorrectPassword}
        close={() => {}}
        title={login.incorrectPassword}
        subTitle={login.youEnteredIncorrectPasscode}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        subTitleColor={`${colorMode}.secondaryText`}
        textColor={`${colorMode}.modalGreenTitle`}
        showCloseIcon={false}
        buttonText={common.retry}
        buttonCallback={() => setIncorrectPassword(false)}
        subTitleWidth={wp(250)}
      />
    </Box>
  );
}

const styles = StyleSheet.create({
  textBoxStyles: {
    height: widthPercentageToDP('13%'),
    width: widthPercentageToDP('13%'),
    borderRadius: 7,
    marginLeft: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9F4F0',
  },
  textBoxActive: {
    height: widthPercentageToDP('13%'),
    width: widthPercentageToDP('13%'),
    borderRadius: 7,
    marginLeft: 20,
    elevation: 10,
    shadowOpacity: 1,
    shadowOffset: {
      width: 0,
      height: 3,
    },
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9F4F0',
  },
  textStyles: {
    color: '#000000',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  textFocused: {
    color: '#000000',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  content: {
    flex: 1,
    padding: 10,
  },
  errorMessage: {
    fontStyle: 'italic',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 18,
  },
  forgotPassWrapper: {
    flex: 0.8,
    margin: 20,
    width: '65%',
    marginTop: 30,
  },
  btnWrapper: {
    marginTop: 25,
    marginBottom: 30,
    alignSelf: 'center',
    width: '90%',
  },
  createBtn: {
    paddingVertical: hp(15),
    borderRadius: 10,
    paddingHorizontal: 20,
  },
  cancelBtn: {
    marginRight: wp(20),
    borderRadius: 10,
  },
  btnText: {
    fontSize: 12,
    letterSpacing: 0.84,
  },
  modalAssetsWrapper: {
    width: windowWidth * 0.8,
    alignItems: 'center',
    paddingVertical: hp(20),
  },
  modalMessageText: {
    fontSize: 14,
    letterSpacing: 0.13,
  },
  modalMessageWrapper: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'center',
  },
  noInternetModalContainer: {
    width: wp(200),
    alignItems: 'center',
    marginTop: hp(20),
    marginBottom: hp(60),
  },
  testnetIndicatorWrapper: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  welcomeText: {
    marginTop: hp(47),
    textAlign: 'center',
    fontFamily: Fonts.LoraMedium,
  },
  passcodeWrapper: {
    alignItems: 'center',
    marginTop: hp(45),
    gap: hp(15),
  },
});

export default LoginScreen;
