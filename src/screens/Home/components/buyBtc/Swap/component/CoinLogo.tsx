import { Box } from '@gluestack-ui/themed-native-base';
import React from 'react';
import BtcAcquireIcon from 'src/assets/images/bitcoin-acquire-icon.svg';
import UsdtWalletLogo from 'src/assets/images/usdt-wallet-logo.svg';
import CircleIconWrapper from 'src/components/CircleIconWrapper';
import Colors from 'src/theme/Colors';

export const CoinLogo = ({
  code,
  CircleWidth,
  logoWidth,
  logoHeight,
}: {
  code: string;
  CircleWidth?: number;
  logoWidth?: number;
  logoHeight?: number;
}) => {
  const isBtc = code === 'BTC';

  return (
    <Box>
      <CircleIconWrapper
        icon={
          isBtc ? (
            <BtcAcquireIcon width={logoWidth} height={logoHeight} />
          ) : (
            <UsdtWalletLogo width={logoWidth} height={logoHeight} />
          )
        }
        backgroundColor={isBtc ? Colors.BrightOrange : Colors.DesaturatedTeal}
        width={CircleWidth}
      />
    </Box>
  );
};
