import { useColorMode } from 'native-base';
import { StyleSheet } from 'react-native';
import { TouchableOpacity } from 'react-native-gesture-handler';
import Text from 'src/components/KeeperText';
import { hp, wp } from 'src/constants/responsive';
import AddGreen from 'src/assets/images/add-plus-green.svg';
import AddWhite from 'src/assets/images/add-plus-white.svg';
import { useContext } from 'react';
import { LocalizationContext } from 'src/context/Localization/LocContext';

export function AddKeyButton({
  short = false,
  onPress,
  buttonText = null,
}: {
  short?: boolean;
  onPress: () => void;
  buttonText?: string;
}) {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const { translations } = useContext(LocalizationContext);
  const { vault: vaultTranslation } = translations;
  return (
    <TouchableOpacity onPress={onPress} style={styles.addNewBtn} testID="btn_add_new_key">
      <Text color={`${colorMode}.textGreen`} bold style={styles.addNew}>
        {buttonText ? buttonText : short ? vaultTranslation.addAKey : vaultTranslation.addNewKey}
      </Text>
      {isDarkMode ? <AddWhite /> : <AddGreen />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  addNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(5),
  },
  addNew: {
    fontSize: 14,
    textAlign: 'right',
    flex: 1,
  },
  addNewPlus: {
    fontSize: 26,
    marginTop: hp(6),
  },
});

export default AddKeyButton;
