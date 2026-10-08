import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useColorMode } from '@gluestack-ui/themed-native-base';
import { useNavigation } from '@react-navigation/native';
import NativeConfig from 'react-native-config';
import DeviceInfo from 'react-native-device-info';
import ScreenWrapper from 'src/components/ScreenWrapper';
import Text from 'src/components/KeeperText';
import WalletHeader from 'src/components/WalletHeader';
import WalletCreationChooser, { WalletChoiceCard } from 'src/components/WalletCreationChooser';
import { useAppSelector } from 'src/store/hooks';
import { NetworkType } from 'src/services/wallets/enums';
import { isEmptyWalletOnboardingEnabled } from 'src/services/wallets/operations/recoverable/emptyWalletOnboarding';

type ChoiceStage = 'chooser' | 'simple' | 'hot' | 'cold' | 'seedless';

export default function WalletChoiceScreen() {
  const navigation = useNavigation<any>();
  const { colorMode } = useColorMode();
  const network = useAppSelector((state) => state.settings.bitcoinNetworkType);
  const enabled =
    network === NetworkType.TESTNET &&
    isEmptyWalletOnboardingEnabled({
      emptyWalletFlag: NativeConfig.KEEPER_EMPTY_WALLET_ONBOARDING,
      previewFlag: NativeConfig.KEEPER_PREVIEW,
      testnetOnlyFlag: NativeConfig.KEEPER_PREVIEW_TESTNET_ONLY,
      bundleId: DeviceInfo.getBundleId(),
    });
  const [stage, setStage] = useState<ChoiceStage>('chooser');

  useEffect(() => {
    if (!enabled) navigation.goBack();
  }, [enabled, navigation]);

  if (!enabled) return null;

  const back = () => {
    if (stage === 'hot' || stage === 'cold') setStage('simple');
    else if (stage === 'simple' || stage === 'seedless') setStage('chooser');
    else navigation.goBack();
  };

  const title =
    stage === 'chooser'
      ? 'Choose a Wallet'
      : stage === 'simple'
      ? 'Simple Wallet'
      : stage === 'hot'
      ? 'Hot Wallet'
      : stage === 'cold'
      ? 'Cold Wallet'
      : 'Seedless Wallet';

  return (
    <ScreenWrapper backgroundcolor={`${colorMode}.primaryBackground`}>
      <WalletHeader title={title} onPressHandler={back} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {stage === 'chooser' && (
          <WalletCreationChooser
            onSimpleWallet={() => setStage('simple')}
            onSeedlessWallet={() => setStage('seedless')}
            onAdvancedWallet={() => navigation.navigate('AddNewWallet')}
            onImportWallet={() => navigation.navigate('VaultConfigurationCreation')}
            showSeedless
            seedlessBadge="TESTNET PREVIEW"
          />
        )}
        {stage === 'simple' && (
          <View testID="wallet-choice-simple-options" style={styles.section}>
            <Text color={`${colorMode}.primaryText`} style={styles.body}>
              A Simple Wallet uses one key to spend. Choose where that key would be held.
            </Text>
            <WalletChoiceCard
              title="Hot Wallet"
              icon="◉"
              eyebrow="ON THIS PHONE"
              description="A single key on this phone for everyday spending."
              testID="wallet-choice-hot"
              onPress={() => setStage('hot')}
            />
            <WalletChoiceCard
              title="Cold Wallet"
              icon="◇"
              eyebrow="EXTERNAL KEY"
              description="A single key on a separate signing device."
              testID="wallet-choice-cold"
              onPress={() => setStage('cold')}
            />
          </View>
        )}
        {/* TODO: Wire these choices after the empty-account Mobile Key readiness and cold signer
            flows are verified end to end. Do not route to AddSigningDevice with a missing signer. */}
        {(stage === 'hot' || stage === 'cold') && (
          <View testID={`wallet-choice-${stage}-unavailable`} style={styles.section}>
            <Text color={`${colorMode}.primaryText`} style={styles.body}>
              {stage === 'hot'
                ? 'Hot Wallet creation needs the Mobile Key to be ready before continuing.'
                : 'Cold Wallet creation needs a supported signing device and a verified setup flow.'}
            </Text>
            <Text color={`${colorMode}.secondaryText`} style={styles.body}>
              This route is not available in the testnet preview yet. No wallet or key has been
              created.
            </Text>
          </View>
        )}
        {/* The separately installed preview app owns the Seedless walkthrough. This normal-app
            route must not mount its isolated provider tree or request a Server Key. */}
        {stage === 'seedless' && (
          <View testID="wallet-choice-seedless-unavailable" style={styles.section}>
            <Text color={`${colorMode}.primaryText`} style={styles.body}>
              The Seedless Wallet walkthrough runs in the separate Keeper Preview app.
            </Text>
            <Text color={`${colorMode}.secondaryText`} style={styles.body}>
              No Mobile Key, Server Key, hardware connection, or wallet is created from this screen.
            </Text>
          </View>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 36 },
  section: { gap: 16, paddingTop: 18 },
  body: { fontSize: 15, lineHeight: 23 },
});
