import { Box, ScrollView } from 'native-base';
import React, { useContext, useState } from 'react';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import { LocalizationContext } from 'src/context/Localization/LocContext';

import HardwareDevices from './components/HardwareDevices';
import HardwareReseller from './components/HardwareReseller';
import MonthlyYearlySwitch from 'src/components/Switch/MonthlyYearlySwitch';
import { resellers, sellers } from 'src/constants/HardwareReferralLinks';

const HardwareWallet = () => {
  const { translations } = useContext(LocalizationContext);
  const { wallet: walletText } = translations;
  const [isToggled, setIsToggled] = useState(false);

  return (
    <ScreenWrapper>
      <Box>
        <WalletHeader title={walletText.hardwareShopWallet} />
      </Box>
      <MonthlyYearlySwitch
        title2="Resellers"
        title1="Devices"
        value={isToggled}
        onValueChange={() => setIsToggled(!isToggled)}
      />
      <ScrollView showsVerticalScrollIndicator={false}>
        {!isToggled ? (
          <HardwareDevices sellers={sellers} />
        ) : (
          <HardwareReseller resellers={resellers} />
        )}
      </ScrollView>
    </ScreenWrapper>
  );
};

export default HardwareWallet;
