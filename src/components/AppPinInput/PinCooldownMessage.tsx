import React, { useContext, useEffect, useState } from 'react';
import { AppState, StyleProp, TextStyle } from 'react-native';
import Text from 'src/components/KeeperText';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { formatPinCooldown, getRemainingPinCooldown } from 'src/utils/pinCooldown';

interface Props {
  failedAttempts: number;
  lastLoginFailedAt: number | null;
  color: string;
  style: StyleProp<TextStyle>;
}

export default function PinCooldownMessage({
  failedAttempts,
  lastLoginFailedAt,
  color,
  style,
}: Props) {
  const { translations } = useContext(LocalizationContext);
  const [now, setNow] = useState(Date.now);
  const remaining = getRemainingPinCooldown(failedAttempts, lastLoginFailedAt, now);

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    const interval = setInterval(refresh, 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [failedAttempts, lastLoginFailedAt]);

  return (
    <Text style={style} color={color} accessibilityLiveRegion="none">
      {translations.formatString(translations.login.retryPasscodeIn, formatPinCooldown(remaining))}
    </Text>
  );
}
