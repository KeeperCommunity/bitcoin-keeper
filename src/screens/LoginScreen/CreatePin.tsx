/* eslint-disable react/no-unstable-nested-components */
import { Box, StatusBar, useColorMode } from 'native-base';
import { StyleSheet } from 'react-native';
import React, { useContext, useEffect, useState } from 'react';
import {
  heightPercentageToDP as hp,
  widthPercentageToDP as wp,
} from 'react-native-responsive-screen';
import Text from 'src/components/KeeperText';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import ToastErrorIcon from 'src/assets/images/toast_error.svg';
import KeyPadView from 'src/components/AppNumPad/KeyPadView';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import DeleteIcon from 'src/assets/images/deleteLight.svg';
import BiometricIcon from 'src/assets/images/biometric-icon.svg';
import { changeLoginMethod, storeCreds, switchCredsChanged } from 'src/store/sagaActions/login';
import KeeperModal from 'src/components/KeeperModal';
import { setIsInitialLogin } from 'src/store/reducers/login';
import { throttle } from 'src/utils/utilities';
import Buttons from 'src/components/Buttons';
import PinDotView from 'src/components/AppPinInput/PinDotView';
import ReactNativeBiometrics from 'react-native-biometrics';
import LoginMethod from 'src/models/enums/LoginMethod';
import useToastMessage from 'src/hooks/useToastMessage';
import Fonts from 'src/constants/Fonts';
import ThemedColor from 'src/components/ThemedColor/ThemedColor';
import ThemedSvg from 'src/components/ThemedSvg.tsx/ThemedSvg';

enum PasscodeStages {
  CREATE = 'CREATE',
  CONFIRM = 'CONFIRM',
}

export default function CreatePin(props) {
  const { colorMode } = useColorMode();
  const [pinState, setPinState] = useState({
    value: '',
    stage: PasscodeStages.CREATE,
  });
  const [createPassword, setCreatePassword] = useState(false);
  const { oldPasscode, isForgot = false } = props.route.params || {};
  const dispatch = useAppDispatch();
  const { credsChanged, hasCreds } = useAppSelector((state) => state.login);
  const { translations } = useContext(LocalizationContext);
  const { login, common, error: errorText } = translations;
  const { showToast } = useToastMessage();

  const createPin = pinState.value.slice(0, 4);
  const confirmPin = pinState.value.slice(4, 8);
  const isCreateComplete = createPin.length === 4;
  const isConfirmComplete = confirmPin.length === 4;
  const isPinMatch = isConfirmComplete && createPin === confirmPin;
  const [enableBiometric, setEnableBiometric] = useState(false);

  const { loginMethod }: { loginMethod: LoginMethod } = useAppSelector((state) => state.settings);
  const { allAccounts } = useAppSelector((state) => state.account);
  const RNBiometrics = new ReactNativeBiometrics();
  const slider_background = ThemedColor({ name: 'slider_background' });
  const login_button_backGround = ThemedColor({ name: 'login_button_backGround' });
  const login_button_text_color = ThemedColor({ name: 'login_button_text_color' });
  const login_text_color = ThemedColor({ name: 'login_text_color' });

  useEffect(() => {
    if (hasCreds) {
      if (isForgot) props.navigation.replace('LoginStack', { screen: 'EnterSeedScreen' });
      else if (allAccounts.length) props.navigation.replace('OnBoardingSlides');
      else setEnableBiometric(true);
    }
  }, [hasCreds]);

  useEffect(() => {
    if (credsChanged === 'changed') {
      if (oldPasscode === '') {
        dispatch(switchCredsChanged());
        props.navigation.goBack();
        if (props.navigation.state.params?.onPasscodeReset) {
          props.navigation.state.params.onPasscodeReset();
        }
      } else {
        props.navigation.navigate('PasscodeChangeSuccessPage');
      }
    }
  }, [credsChanged]);

  const onPressNumber = throttle((text) => {
    setPinState((currentState) => {
      const currentLength = currentState.value.length;

      if (currentLength === 4) {
        return {
          value: currentState.value + text,
          stage: PasscodeStages.CONFIRM,
        };
      }

      if (currentLength < 8) {
        return {
          ...currentState,
          value: currentState.value + text,
          stage: currentLength < 4 ? PasscodeStages.CREATE : PasscodeStages.CONFIRM,
        };
      }

      return currentState;
    });
  }, 300);

  const onDeletePressed = throttle(() => {
    setPinState((currentState) => {
      const currentLength = currentState.value.length;

      if (currentLength === 0) return currentState;
      if (currentLength === 5) {
        return {
          value: currentState.value.slice(0, 4),
          stage: PasscodeStages.CREATE,
        };
      }
      return {
        ...currentState,
        value: currentState.value.slice(0, -1),
        stage: currentLength <= 5 ? PasscodeStages.CREATE : PasscodeStages.CONFIRM,
      };
    });
  }, 300);

  const handleNext = () => {
    dispatch(setIsInitialLogin(true));
    dispatch(storeCreds(createPin, (error: string) => showToast(error)));
    setCreatePassword(false);
  };

  function CreatePassModalContent() {
    return (
      <Box>
        <Box style={styles.passImg}>
          <ThemedSvg name={'AdditonalUserIcon'} />
        </Box>
        <Text color={`${colorMode}.secondaryText`} style={styles.modalMessageText}>
          {login.lockedOutOfApp}
        </Text>
      </Box>
    );
  }
  function BiometricContent() {
    return (
      <Box>
        <Box style={styles.passImg}>
          <BiometricIcon />
        </Box>
      </Box>
    );
  }

  const onChangeLoginMethod = async () => {
    try {
      const { available } = await RNBiometrics.isSensorAvailable();
      if (available) {
        if (loginMethod === LoginMethod.PIN) {
          const { keysExist } = await RNBiometrics.biometricKeysExist();
          if (keysExist) {
            await RNBiometrics.deleteKeys();
          }

          const { success } = await RNBiometrics.simplePrompt({
            promptMessage: errorText.confirmIdentity,
          });

          if (success) {
            const { publicKey } = await RNBiometrics.createKeys();
            dispatch(changeLoginMethod(LoginMethod.BIOMETRIC, publicKey));
            props.navigation.replace('OnBoardingSlides');
          } else {
            showToast(errorText.biometicAuthFailed, <ToastErrorIcon />);
            setTimeout(() => {
              props.navigation.replace('OnBoardingSlides');
            }, 2000);
          }
        } else {
          dispatch(changeLoginMethod(LoginMethod.PIN));
        }
      } else {
        showToast(errorText.biometricNotEnabled, <ToastErrorIcon />);
        setTimeout(() => {
          props.navigation.replace('OnBoardingSlides');
        }, 2000);
      }
    } catch (error) {
      console.log(error);
      showToast(errorText.errorWithBiometrics, <ToastErrorIcon />);
      setTimeout(() => {
        props.navigation.replace('OnBoardingSlides');
      }, 2000);
    }
  };

  return (
    <Box safeAreaTop testID="main" style={styles.container} backgroundColor={slider_background}>
      <Box style={styles.wrapper}>
        <StatusBar barStyle="light-content" />
        <Box style={styles.wrapper}>
          <Box style={styles.titleWrapper}>
            <Box>
              <Text style={styles.welcomeText} medium color={login_text_color}>
                {login.welcome}
              </Text>
            </Box>
            <Box style={styles.passCodeWrapper}>
              <Box style={styles.createPasscodeWrapper}>
                <Text color={login_text_color} style={styles.labelText}>
                  {login.Createpasscode}
                </Text>
                <PinDotView
                  passCode={createPin}
                  dotColor={login_text_color}
                  borderColor={login_text_color}
                />
              </Box>
              {isCreateComplete && (
                <Box style={styles.confirmPasscodeWrapper}>
                  <Text color={login_text_color} style={styles.labelText}>
                    {login.Confirmyourpasscode}
                  </Text>
                  <Box>
                    <PinDotView
                      passCode={confirmPin}
                      dotColor={login_text_color}
                      borderColor={login_text_color}
                    />
                    {isConfirmComplete && !isPinMatch && (
                      <Text color={`${colorMode}.error`} italic style={styles.errorText}>
                        {login.MismatchPasscode}
                      </Text>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
          <KeyPadView
            onDeletePressed={onDeletePressed}
            onPressNumber={onPressNumber}
            ClearIcon={<ThemedSvg name="delete_icon" />}
            bubbleEffect
            keyColor={login_text_color}
          />
          <Box style={styles.btnWrapper}>
            <Buttons
              primaryCallback={() => setCreatePassword(true)}
              primaryText={common.create}
              primaryDisable={!isPinMatch}
              primaryBackgroundColor={login_button_backGround}
              primaryTextColor={login_button_text_color}
              fullWidth
            />
          </Box>
        </Box>
      </Box>
      <KeeperModal
        visible={createPassword}
        close={() => {}}
        title={login.rememberPasscode}
        subTitle={login.storingDeviceSecure}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        showCloseIcon={false}
        buttonText={common.continue}
        secondaryButtonText={common.back}
        buttonCallback={handleNext}
        secondaryCallback={() => {
          setCreatePassword(false);
        }}
        Content={CreatePassModalContent}
        subTitleWidth={wp(80)}
      />
      <KeeperModal
        visible={enableBiometric}
        close={() => {}}
        title={login.enableBiometric}
        subTitle={login.fingerprintOrFace}
        modalBackground={`${colorMode}.modalWhiteBackground`}
        textColor={`${colorMode}.textGreen`}
        subTitleColor={`${colorMode}.modalSubtitleBlack`}
        showCloseIcon={false}
        buttonText={common.continue}
        secondaryButtonText={common.cancel}
        buttonCallback={() => {
          setEnableBiometric(false);
          onChangeLoginMethod();
        }}
        secondaryCallback={() => {
          props.navigation.replace('OnBoardingSlides');
          setEnableBiometric(false);
        }}
        Content={BiometricContent}
      />
    </Box>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 10,
  },
  wrapper: {
    flex: 1,
  },
  titleWrapper: {
    paddingTop: hp(6.7),
    alignItems: 'center',
    flex: 1,
    gap: hp(6),
  },
  welcomeText: {
    fontSize: 25,
    lineHeight: 27,
    fontFamily: Fonts.LoraMedium,
  },
  labelText: {
    fontSize: 14,
  },
  passCodeWrapper: {
    gap: hp(4.7),
  },
  createPasscodeWrapper: {
    gap: hp(1.8),
    alignItems: 'center',
  },
  confirmPasscodeWrapper: {
    alignItems: 'center',
    gap: hp(1.8),
  },
  errorText: {
    fontSize: 11,
    letterSpacing: 0.22,
    width: wp('68%'),
    textAlign: 'center',
    marginTop: 18,
  },
  modalMessageText: {
    fontSize: 13,
    letterSpacing: 0.13,
  },
  passImg: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  btnWrapper: {
    marginTop: 25,
    marginBottom: 30,
    alignSelf: 'center',
    width: '90%',
  },
});
