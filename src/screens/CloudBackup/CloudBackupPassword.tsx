import { Box, ScrollView, useColorMode } from 'native-base';
import React, { useContext, useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import { useDispatch } from 'react-redux';
import Buttons from 'src/components/Buttons';
import Text from 'src/components/KeeperText';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import { hp } from 'src/constants/responsive';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import useToastMessage from 'src/hooks/useToastMessage';
import TickIcon from 'src/assets/images/icon_check.svg';
import { setPersonalBackupPassword } from 'src/store/reducers/account';
import KeeperTextInput from 'src/components/KeeperTextInput';
import useIsSmallDevices from 'src/hooks/useSmallDevices';
import { RealmSchema } from 'src/storage/realm/enum';
import dbManager from 'src/storage/realm/dbManager';
const { height } = Dimensions.get('window');

export const CloudBackupPassword = ({ navigation }: any) => {
  const { colorMode } = useColorMode();
  const dispatch = useDispatch();
  const { showToast } = useToastMessage();
  const [password, setPassword] = useState(null);
  const [confPassword, setConfPassword] = useState(null);
  const isSmallDevice = useIsSmallDevices();
  const { common, cloudBackup, error: errorText } = useContext(LocalizationContext).translations;
  const [errorMessage, setErrorMessage] = useState(null);
  const { id: appId }: any = dbManager.getObjectByIndex(RealmSchema.KeeperApp);

  const onSavePassword = () => {
    try {
      setErrorMessage(null);
      validatePassword();
      dispatch(setPersonalBackupPassword({ appId, password }));
      setTimeout(() => showToast(cloudBackup.passwordUpdate, <TickIcon />), 0);
      navigation.goBack();
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const validatePassword = () => {
    if (!password) throw new Error(errorText.passwordError);
    if (!confPassword) throw new Error(errorText.confirmPasswordError);
    if (password != confPassword) throw new Error(errorText.passwordMatchError);
  };

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <Box style={styles.container} backgroundColor={`${colorMode}.primaryBackground`}>
        <Box style={styles.header}>
          <WalletHeader title={cloudBackup.passwordTitle} />
        </Box>
        <ScrollView
          style={styles.scrollViewWrapper}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={isSmallDevice && { paddingBottom: hp(100) }}
        >
          <Box>
            <Text>{cloudBackup.passwordDesc}</Text>{' '}
          </Box>

          <Box style={styles.inputContainer}>
            <KeyboardInputWithLabel
              testId={'input_password'}
              label={common.enterPassword}
              value={password}
              onChangeText={setPassword}
            />
            <KeyboardInputWithLabel
              testId={'input_conf_password'}
              label={common.confirmPassword}
              value={confPassword}
              onChangeText={setConfPassword}
            />
          </Box>
          {errorMessage && <Text color={`${colorMode}.alertRed`}>{errorMessage}</Text>}
          <Box height={height / 6} />
        </ScrollView>

        <Buttons primaryCallback={onSavePassword} primaryText={common.confirm} fullWidth />
      </Box>
    </ScreenWrapper>
  );
};

export const KeyboardInputWithLabel = ({ testId, label, value, onChangeText }) => {
  const { colorMode } = useColorMode();
  return (
    <Box>
      {label?.length > 0 && <Text>{label}</Text>}
      <KeeperTextInput
        testID={testId}
        placeholder={''}
        inpuBackgroundColor={`${colorMode}.textInputBackground`}
        inpuBorderColor={`${colorMode}.dullGreyBorder`}
        value={value}
        onChangeText={onChangeText}
        paddingLeft={5}
        secureTextEntry
        auto
        autoCapitalize="none"
      />
    </Box>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    marginBottom: 18,
  },
  scrollViewWrapper: {
    flex: 1,
  },
  inputContainer: {
    marginTop: hp(30),
    gap: hp(10),
  },
});
