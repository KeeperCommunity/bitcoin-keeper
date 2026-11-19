import React, { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { Box, ScrollView, useColorMode } from '@gluestack-ui/themed-native-base';
import { useQuery } from '@realm/react';
import { useNavigation } from '@react-navigation/native';
import { RealmSchema } from 'src/storage/realm/enum';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import { checkBackupFreshness, repairBackup } from 'src/store/sagaActions/bhr';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import Buttons from 'src/components/Buttons';
import Text from 'src/components/KeeperText';
import { hp } from 'src/constants/responsive';

export default function AssistedBackupStatus() {
  const { colorMode } = useColorMode();
  const navigation = useNavigation();
  const dispatch = useAppDispatch();
  const { recoveryBackup: copy } = useContext(LocalizationContext).translations;
  const app = useQuery(RealmSchema.KeeperApp)[0] as any;
  const id = app?.id as string;
  const {
    automaticCloudBackup,
    backupRepairStateByAppId = {},
    backupRepairRunningByAppId = {},
  } = useAppSelector((state) => state.bhr);
  const phase = backupRepairStateByAppId[id];
  const running = !!backupRepairRunningByAppId[id];
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (automaticCloudBackup) dispatch(checkBackupFreshness());
  }, [id]);
  useEffect(() => {
    setSlow(false);
    if (!running) return undefined;
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [running, phase]);
  const state = !automaticCloudBackup
    ? 'disabled'
    : !running && ['checking', 'preparing', 'uploading', 'verifying'].includes(phase)
    ? 'unverified'
    : phase || 'unverified';
  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={copy.title} />
      <ScrollView contentContainerStyle={styles.content}>
        <Box backgroundColor={`${colorMode}.textInputBackground`} style={styles.card}>
          <Text allowFontScaling medium style={styles.title} accessibilityRole="header">
            {copy[state].title}
          </Text>
          {running && <ActivityIndicator accessibilityLabel={copy[state].title} />}
          <Text allowFontScaling style={styles.body} accessibilityLiveRegion="polite">
            {copy[state].body}
          </Text>
          {slow && (
            <Text allowFontScaling style={styles.body}>
              {copy.slow}
            </Text>
          )}
          {running && (
            <Text allowFontScaling style={styles.body}>
              {copy.leave}
            </Text>
          )}
        </Box>
        {!running && automaticCloudBackup && (
          <Buttons
            fullWidth
            primaryText={state === 'different' ? copy.backUp : copy.check}
            primaryCallback={() =>
              dispatch(state === 'different' ? repairBackup() : checkBackupFreshness())
            }
          />
        )}
        <Box marginTop={hp(16)}>
          <Buttons
            fullWidth
            primaryText={copy.back}
            primaryBackgroundColor={`${colorMode}.textInputBackground`}
            primaryTextColor={`${colorMode}.greenText`}
            primaryCallback={() => navigation.goBack()}
          />
        </Box>
      </ScrollView>
    </ScreenWrapper>
  );
}
const styles = StyleSheet.create({
  content: { paddingVertical: hp(24) },
  card: { padding: 20, borderRadius: 16, marginBottom: hp(24) },
  title: { fontSize: 18, marginBottom: hp(16) },
  body: { fontSize: 14, marginTop: hp(12) },
});
