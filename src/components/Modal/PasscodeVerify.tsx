import React, { useContext, useState, useEffect } from 'react';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { increasePinFailAttempts } from 'src/store/reducers/storage';
import { credsAuthenticated } from 'src/store/reducers/login';
import { credsAuth } from 'src/store/sagaActions/login';
import LoginMethod from 'src/models/enums/LoginMethod';
import DeleteDarkIcon from 'src/assets/images/delete.svg';
import DeleteIcon from 'src/assets/images/deleteLight.svg';
import Buttons from 'src/components/Buttons';
import ReactNativeBiometrics from 'react-native-biometrics';
import { StyleSheet } from 'react-native';
import KeyPadView from '../AppNumPad/KeyPadView';
import PinInputsView from '../AppPinInput/PinInputsView';
import Text from '../KeeperText';

const RNBiometrics = new ReactNativeBiometrics();
let processing = false;

interface Props {
  useBiometrics: boolean;
  close?: Function;
  onSuccess?: Function;
  primaryText?: string;
  forcedMode?: boolean;
  onForceSuccess?: Function;
}

function PasscodeVerifyModal({
  useBiometrics = false,
  close,
  onSuccess,
  primaryText,
  forcedMode = false,
  onForceSuccess,
}: Props) {
  const { colorMode } = useColorMode();
  const { translations } = useContext(LocalizationContext);
  const { common, login, error: bioError } = translations;
  const dispatch = useAppDispatch();
  const [passcode, setPasscode] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [btnDisable, setBtnDisable] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [errMessage, setErrMessage] = useState(login.Incorrect);
  const { isAuthenticated, authenticationFailed } = useAppSelector((state) => state.login);
  const { loginMethod } = useAppSelector((state) => state.settings);
  const { appId, failedAttempts, lastLoginFailedAt } = useAppSelector((state) => state.storage);

  useEffect(() => {
    if (useBiometrics) {
      if (processing) return;
      processing = true;
      biometricAuth();
    }
  }, [useBiometrics]);

  const biometricAuth = async () => {
    if (loginMethod === LoginMethod.BIOMETRIC) {
      try {
        const { success, signature } = await RNBiometrics.createSignature({
          promptMessage: common.Authenticate,
          payload: appId,
          cancelButtonText: common.usePin,
        });
        if (success) {
          dispatch(credsAuth(signature, LoginMethod.BIOMETRIC, true));
        }
      } catch (error) {
        console.log(bioError.biometricAuth, error);
      } finally {
        processing = false;
      }
    }
  };

  const onPressNumber = (text) => {
    if (text === 'x') {
      setPasscode((current) => current.slice(0, -1));
      setLoginError(false);
    } else {
      setPasscode((current) => (current.length < 4 ? current + text : current));
    }
  };

  const onDeletePressed = () => {
    setPasscode((current) => current.slice(0, -1));
  };

  const disableCTA = () => {
    setTimeout(() => {
      setBtnDisable(false);
    }, 2000);
  };

  useEffect(() => {
    if (attempts >= 3) {
      setAttempts(1);
      dispatch(increasePinFailAttempts());
    }
  }, [attempts]);

  useEffect(() => {
    if (authenticationFailed && passcode) {
      if (forcedMode) {
        onForceSuccess();
        close();
        dispatch(credsAuthenticated(false));
      } else {
        setLoginError(true);
        setErrMessage(login.Incorrect);
        setPasscode('');
        setAttempts(attempts + 1);
        disableCTA();
      }
    } else {
      setLoginError(false);
      disableCTA();
    }
  }, [authenticationFailed]);

  useEffect(() => {
    if (isAuthenticated) {
      onSuccess(passcode);
      close();
      dispatch(credsAuthenticated(false));
    }
  }, [isAuthenticated]);

  const attemptLogin = (passcode: string) => {
    dispatch(credsAuth(passcode, LoginMethod.PIN, true));
  };

  return (
    <Box testID="modal_passcode_verify" borderRadius={10}>
      <Box style={{ width: '100%' }}>
        {/* pin input view */}
        <PinInputsView
          passCode={passcode}
          passcodeFlag={loginError}
          backgroundColor={colorMode === 'light'}
        />
        {loginError && (
          <Text color={`${colorMode}.indicator`} style={styles.errorText}>
            {errMessage}
          </Text>
        )}
        {/*  */}
        <Buttons
          primaryCallback={() => {
            setBtnDisable(true);
            setLoginError(false);
            attemptLogin(passcode);
          }}
          primaryText={primaryText ? primaryText : common.proceed}
          activeOpacity={0.5}
          primaryDisable={btnDisable || passcode.length !== 4}
          fullWidth
        />
      </Box>
      {/* keyboardview start */}
      <Box style={{ width: '100%' }}>
        <KeyPadView
          onDeletePressed={onDeletePressed}
          onPressNumber={onPressNumber}
          keyColor={colorMode === 'light' ? '#041513' : '#FFF'}
          ClearIcon={colorMode === 'dark' ? <DeleteIcon /> : <DeleteDarkIcon />}
        />
      </Box>
    </Box>
  );
}
const styles = StyleSheet.create({
  errorText: {
    textAlign: 'right',
    fontStyle: 'italic',
    marginRight: 10,
  },
});
export default PasscodeVerifyModal;
