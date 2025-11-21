import QRCode from 'react-native-qrcode-svg';
import React from 'react';
import { StyleSheet } from 'react-native';

import { Box, useColorMode } from 'native-base';
import { useSelector } from 'react-redux';
import KeeperNewLogo from 'src/assets/images/keeper-new-logo.png';
import KeeperPrivateNewLogo from 'src/assets/privateImages/keeper-private-new-logo.png';

function KeeperQRCode({
  qrData,
  size,
  ecl = 'L',
  logoBackgroundColor,
  showLogo = false,
}: {
  qrData: any;
  size: number;
  ecl?: 'L' | 'M' | 'Q' | 'H';
  logoBackgroundColor?: string;
  showLogo?: boolean;
}) {
  const { colorMode } = useColorMode();
  const themeMode = useSelector((state: any) => state?.settings?.themeMode);
  const privateTheme = themeMode === 'PRIVATE' || themeMode === 'PRIVATE_LIGHT';
  return (
    <Box style={styles.qrWrapper} borderColor={`${colorMode}.headerWhite`}>
      {qrData && (
        <QRCode
          value={qrData}
          {...(logoBackgroundColor ? { logoBackgroundColor } : {})}
          size={size}
          ecl={ecl}
          logo={showLogo ? (privateTheme ? KeeperPrivateNewLogo : KeeperNewLogo) : undefined}
          logoSize={size * 0.2}
        />
      )}
    </Box>
  );
}

const styles = StyleSheet.create({
  qrWrapper: {
    borderWidth: 10,
  },
});

export default KeeperQRCode;
