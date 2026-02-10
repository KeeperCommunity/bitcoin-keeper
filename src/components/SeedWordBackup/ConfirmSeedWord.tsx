import Text from 'src/components/KeeperText';
import { Box, useColorMode } from 'native-base';
import React, { useContext, useState } from 'react';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import Buttons from 'src/components/Buttons';
import { cryptoRandom } from 'src/utils/service-utilities/encryption';
import { StyleSheet } from 'react-native';
import { hp, wp } from 'src/constants/responsive';
import KeeperTextInput from '../KeeperTextInput';

function ConfirmSeedWord(props) {
  const { translations } = useContext(LocalizationContext);
  const { BackupWallet, error: errorText } = translations;
  const { common } = translations;
  const { colorMode } = useColorMode();

  const { words, errorMessage, secondaryText, title } = props;

  const [seedWord, setSeedWord] = useState('');
  const [index] = useState(Math.floor(cryptoRandom() * words.length));
  const [invalid, setInvalid] = useState(false);

  const getSeedNumber = (seedNumber: number) => {
    switch (seedNumber + 1) {
      case 1:
        return 'first (01)';
      case 2:
        return 'second (02)';
      case 3:
        return 'third (03)';
      case 4:
        return 'fourth (04)';
      case 5:
        return 'fifth (05)';
      case 6:
        return 'sixth (06)';
      case 7:
        return 'seventh (07)';
      case 8:
        return 'eighth (08)';
      case 9:
        return 'ninth (09)';
      case 10:
        return 'tenth (10)';
      case 11:
        return 'eleventh (11)';
      case 12:
        return 'twelfth (12)';
      default:
        return '';
    }
  };

  const getHint = (seedNumber: number) => {
    switch (seedNumber + 1) {
      case 1:
        return 'first';
      case 2:
        return 'second';
      case 3:
        return 'third';
      case 4:
        return 'fourth';
      case 5:
        return 'fifth';
      case 6:
        return 'sixth';
      case 7:
        return 'seventh';
      case 8:
        return 'eighth';
      case 9:
        return 'ninth';
      case 10:
        return 'tenth';
      case 11:
        return 'eleventh';
      case 12:
        return 'twelfth';
      default:
        return '';
    }
  };

  const getErrorMsg = () => {
    return /[A-Z]/.test(seedWord)
      ? errorText.seedWordAreCaseSensitive
      : errorMessage ?? errorText.pleaseEnterCorrectSeedWord;
  };

  return (
    <Box backgroundColor={`${colorMode}.primaryBackground`} style={styles.container}>
      <Box>
        <Text fontSize={19} color={`${colorMode}.primaryText`}>
          {title ?? BackupWallet.confirmSeedWord}
        </Text>
        <Text fontSize={13} color={`${colorMode}.secondaryText`}>
          {BackupWallet.confirmBackupSubtitle}
        </Text>
      </Box>
      <Box style={styles.contentContainer}>
        <Text style={styles.noOfWord}>{`${BackupWallet.enterThe} ${getSeedNumber(index)} ${
          BackupWallet.seedWord
        }`}</Text>
        <KeeperTextInput
          placeholder={BackupWallet.enterSeedWordPlaceholder}
          value={seedWord}
          autoCorrect={false}
          autoComplete="off"
          autoCapitalize="none"
          keyboardType="name-phone-pad"
          onChangeText={(value) => {
            setSeedWord(value?.toLowerCase()?.trim());
            setInvalid(false);
          }}
          fontWeight={seedWord ? 500 : 200}
          borderRadius={10}
        />
      </Box>
      {invalid && (
        <Text color={`${colorMode}.error`} style={styles.noOfWord}>
          {getErrorMsg()}
        </Text>
      )}
      <Box style={styles.seedWordNote}></Box>
      <Buttons
        secondaryText={secondaryText ?? common.skip}
        secondaryCallback={() => {
          props.closeBottomSheet();
        }}
        primaryText={common.confirm}
        primaryCallback={() => {
          if (seedWord === words[index]) {
            props.confirmBtnPress();
          } else {
            setInvalid(true);
          }
        }}
      />
    </Box>
  );
}

export default ConfirmSeedWord;

const styles = StyleSheet.create({
  container: {
    padding: wp(30),
    borderRadius: 10,
  },
  contentContainer: {
    marginTop: hp(20),
  },
  noOfWord: {
    fontSize: 13,
    marginLeft: 5,
  },
  seedWordNote: {
    marginVertical: 30,
  },
});
