import React from 'react';
import { Box, useColorMode } from '@gluestack-ui/themed-native-base';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Text from 'src/components/KeeperText';

// Backup choices have long, materially different labels. Keep each choice in
// its own wrapping touch target instead of the shared single-line button row.
export function ProtectedBackupAction({
  label,
  onPress,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  // eslint-disable-next-line react/require-default-props -- Defaulted in the function signature.
  secondary?: boolean;
}) {
  const { colorMode } = useColorMode();
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={styles.touchTarget}>
      <Box
        backgroundColor={`${colorMode}.${secondary ? 'textInputBackground' : 'pantoneGreen'}`}
        style={styles.button}
      >
        <Text
          allowFontScaling
          medium
          color={`${colorMode}.${secondary ? 'greenText' : 'buttonText'}`}
          style={styles.label}
        >
          {label}
        </Text>
      </Box>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touchTarget: { width: '100%', marginTop: 12 },
  button: { minHeight: 48, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10 },
  label: { fontSize: 14, textAlign: 'center', flexShrink: 1 },
});
