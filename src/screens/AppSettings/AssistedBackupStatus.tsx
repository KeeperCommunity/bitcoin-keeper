import React, { useContext, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { Box, ScrollView, useColorMode } from '@gluestack-ui/themed-native-base';
import { useQuery } from '@realm/react';
import { useNavigation } from '@react-navigation/native';
import DeviceInfo from 'react-native-device-info';
import { RealmSchema } from 'src/storage/realm/enum';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import { checkBackupFreshness, repairBackup } from 'src/store/sagaActions/bhr';
import { isAutomaticCloudBackupEnabled } from 'src/store/reducers/bhr';
import { isBackupVerificationCurrent } from 'src/services/backup/automatic';
import { getBackupDiagnostic } from 'src/services/backup/transport';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletHeader from 'src/components/WalletHeader';
import { ProtectedBackupAction } from 'src/components/Backup/ProtectedBackupActions';
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
    automaticCloudBackupByAppId,
    backupRepairStateByAppId = {},
    backupRepairRunningByAppId = {},
    protectedBackupStateByAppId = {},
  } = useAppSelector((state) => state.bhr);
  const automaticCloudBackup = isAutomaticCloudBackupEnabled({ automaticCloudBackupByAppId }, id);
  const recordedPhase = backupRepairStateByAppId[id];
  const phase =
    recordedPhase === 'verified' && !isBackupVerificationCurrent(id) ? 'unverified' : recordedPhase;
  const running = !!backupRepairRunningByAppId[id];
  const [slow, setSlow] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const diagnostic = getBackupDiagnostic(id);
  const deletionRecorded = protectedBackupStateByAppId[id]?.status === 'deleted';
  useEffect(() => {
    // Preserve the last failed operation when navigating here from its result.
    // Check Again explicitly replaces it with a fresh, read-only check.
    if (id && !getBackupDiagnostic(id)) dispatch(checkBackupFreshness(id));
  }, [id]);
  useEffect(() => setShowDetails(false), [id, running]);
  useEffect(() => {
    setSlow(false);
    if (!running) return undefined;
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, [running, phase]);
  const state = running
    ? phase || 'checking'
    : phase === 'deleted' || phase === 'never-enrolled'
    ? phase
    : phase === 'unverified'
    ? 'unverified'
    : !automaticCloudBackup
    ? 'disabled'
    : ['checking', 'preparing', 'uploading', 'verifying'].includes(phase)
    ? 'unverified'
    : phase || 'unverified';
  const canBackUp =
    automaticCloudBackup &&
    !deletionRecorded &&
    ['unverified', 'different', 'never-enrolled'].includes(state);
  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={copy.title} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text allowFontScaling style={styles.automaticStatus}>
          {automaticCloudBackup ? copy.automaticOn : copy.automaticOff}
        </Text>
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
        {deletionRecorded && state !== 'deleted' && (
          <Box backgroundColor={`${colorMode}.textInputBackground`} style={styles.card}>
            <Text allowFontScaling medium style={styles.title} accessibilityRole="header">
              {copy.deletionRecordedTitle}
            </Text>
            <Text allowFontScaling style={styles.body}>
              {copy.deletionRecordedBody}
            </Text>
          </Box>
        )}
        <Text allowFontScaling style={styles.notice}>
          {copy.retainedCopyNotice}
        </Text>
        {!running && (
          <Box>
            {canBackUp && (
              <>
                <Text allowFontScaling style={styles.body}>
                  {copy.backUpGuidance}
                </Text>
                <ProtectedBackupAction
                  label={copy.backUp}
                  onPress={() => dispatch(repairBackup(id))}
                />
              </>
            )}
            <ProtectedBackupAction
              secondary={canBackUp}
              label={copy.check}
              onPress={() => dispatch(checkBackupFreshness(id))}
            />
            {diagnostic && (
              <>
                <Text allowFontScaling style={styles.body}>
                  {copy.lastOperationGuidance}
                </Text>
                <ProtectedBackupAction
                  secondary
                  label={showDetails ? copy.hideDetails : copy.showDetails}
                  onPress={() => setShowDetails((visible) => !visible)}
                />
                {showDetails && (
                  <Text allowFontScaling selectable style={styles.body}>
                    {`${copy.detailsLabel}\n${diagnostic.operation} / ${diagnostic.stage} / ${
                      diagnostic.category
                    }\n${copy.httpStatus}: ${diagnostic.httpStatus ?? '—'}; ${copy.elapsed}: ${
                      diagnostic.elapsedMs
                    } ms\n${
                      copy.appBuild
                    }: ${DeviceInfo.getVersion()} (${DeviceInfo.getBuildNumber()})`}
                  </Text>
                )}
              </>
            )}
          </Box>
        )}
        <Box marginTop={hp(16)}>
          <ProtectedBackupAction secondary label={copy.back} onPress={() => navigation.goBack()} />
        </Box>
      </ScrollView>
    </ScreenWrapper>
  );
}
const styles = StyleSheet.create({
  content: { paddingTop: hp(16), paddingBottom: hp(40) },
  automaticStatus: { fontSize: 14, marginBottom: hp(20) },
  card: { padding: 20, borderRadius: 16, marginBottom: hp(24) },
  title: { fontSize: 18, marginBottom: hp(16) },
  body: { fontSize: 14, marginTop: hp(12) },
  notice: { fontSize: 14, marginTop: hp(8), marginBottom: hp(24) },
});
