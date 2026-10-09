import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { NativeBaseProvider, useColorMode } from '@gluestack-ui/themed-native-base';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import Text from 'src/components/KeeperText';
import ScreenWrapper from 'src/components/ScreenWrapper';
import WalletCreationChooser, { WalletChoiceCard } from 'src/components/WalletCreationChooser';
import { customTheme } from 'src/navigation/themes';
import Colors from 'src/theme/Colors';
import {
  ContactDecisionState,
  ContactEnrollmentState,
  decideContactRequest,
  initialContactEnrollment,
  reduceContactEnrollment,
  reviewContactRequest,
} from 'src/services/wallets/recoverable/contactRecoveryFlow';
import {
  HARDWARE_CHOICES,
  canPreviewInheritanceForHardware,
  initialPreviewDraft,
  PreviewAction,
  PreviewDraft,
  reducePreviewDraft,
} from './previewFlow';
import {
  initialSimulatedSetupState,
  reduceSimulatedSetup,
  SimulatedSetupState,
} from './simulatedSetup';

type Palette = {
  background: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  warning: string;
};

type PreviewSurface =
  | 'wallets'
  | 'chooser'
  | 'simple'
  | 'hot'
  | 'cold'
  | 'advanced'
  | 'import'
  | 'seedless'
  | 'recovery'
  | 'cloud'
  | 'contact';

// Public placeholder metadata for an isolated UI sample. No wallet, policy, or credential exists.
const SAMPLE_POLICY_HASH = '0'.repeat(64);
const SAMPLE_NOW = 1_000_000;
const SAMPLE_REQUEST = {
  requestId: 'sample-request-only',
  walletPolicyHash: SAMPLE_POLICY_HASH,
  contactCredentialId: 'sample-no-credential',
  replacementDeviceKeyId: 'sample-no-device-key',
  expiresAt: SAMPLE_NOW + 600,
};
const SIMULATED_KEY_STEP_MS = 800;

function PreviewText({ children, style, color, ...props }: any) {
  const fontScale = Math.min(PixelRatio.getFontScale(), 2);
  const textStyle = StyleSheet.flatten([styles.bodyText, style]);
  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={2}
      color={color}
      style={[styles.bodyText, style, { lineHeight: Math.ceil(textStyle.lineHeight * fontScale) }]}
      {...props}
    >
      {children}
    </Text>
  );
}

function Panel({ children, palette, selected = false, testID }: any) {
  return (
    <View
      testID={testID}
      style={[
        styles.panel,
        {
          backgroundColor: palette.card,
          borderColor: selected ? palette.accent : palette.border,
          borderWidth: selected ? 2 : 1,
        },
      ]}
    >
      {children}
    </View>
  );
}

function ScreenHeading({
  title,
  onBack,
  palette,
}: {
  title: string;
  onBack?: () => void;
  palette: Palette;
}) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="preview-back"
          onPress={onBack}
          hitSlop={12}
          style={styles.backButton}
        >
          <PreviewText color={palette.accent} style={styles.backText}>
            ‹
          </PreviewText>
        </Pressable>
      )}
      <PreviewText accessibilityRole="header" color={palette.text} style={styles.headerTitle}>
        {title}
      </PreviewText>
    </View>
  );
}

function Banner({ palette, children, testID }: any) {
  return (
    <View testID={testID} style={[styles.banner, { backgroundColor: palette.warning }]}>
      <PreviewText color={palette.text} style={styles.bannerText}>
        {children}
      </PreviewText>
    </View>
  );
}

function LinkAction({ label, onPress, palette, testID }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={styles.linkButton}
    >
      <PreviewText color={palette.accent} style={styles.linkText}>
        {label}
      </PreviewText>
    </Pressable>
  );
}

function PrimaryAction({ label, onPress, palette, disabled = false }: any) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={`primary-${label}`}
      onPress={onPress}
      style={[
        styles.primaryButton,
        { backgroundColor: palette.accent, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <PreviewText
        color={
          palette.background === Colors.PrimaryBlack ? Colors.PrimaryBlack : Colors.headerWhite
        }
        style={styles.primaryButtonText}
      >
        {label}
      </PreviewText>
    </Pressable>
  );
}

function PreviewContent() {
  const { colorMode } = useColorMode();
  const dark = colorMode === 'dark';
  const palette: Palette = {
    background: dark ? Colors.PrimaryBlack : Colors.primaryCream,
    card: dark ? Colors.SecondaryBlack : Colors.brightCream,
    text: dark ? Colors.bodyText : Colors.secondaryBlack,
    muted: dark ? Colors.darkGrey : Colors.GreenishGrey,
    border: dark ? Colors.separator : Colors.greyBorder,
    accent: dark ? Colors.mintGreen : Colors.primaryGreen,
    warning: dark ? Colors.DeepCharcoalGreen : Colors.dullGreen,
  };
  const [surface, setSurface] = useState<PreviewSurface>('wallets');
  const [choiceOrigin, setChoiceOrigin] = useState<'wallets' | 'chooser'>('wallets');
  const [draft, setDraft] = useState<PreviewDraft>(initialPreviewDraft);
  const [automaticSetup, setAutomaticSetup] = useState<SimulatedSetupState>(
    initialSimulatedSetupState
  );
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [contactEnrollment, setContactEnrollment] =
    useState<ContactEnrollmentState>(initialContactEnrollment);
  const [contactSample, setContactSample] = useState<'overview' | 'invitation' | 'request'>(
    'overview'
  );
  const [invitationDecision, setInvitationDecision] = useState<
    'pending' | 'approval-intent' | 'declined' | 'expired'
  >('pending');
  const [requestDecision, setRequestDecision] = useState<ContactDecisionState | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const act = (action: PreviewAction) => setDraft((current) => reducePreviewDraft(current, action));
  const resetWalkthrough = () => {
    act({ type: 'RESET' });
    setAutomaticSetup(initialSimulatedSetupState);
    setShowHowItWorks(false);
  };
  const exitFlow = () => setSurface(choiceOrigin);
  const openChoice = (choice: PreviewSurface) => {
    setChoiceOrigin(surface === 'chooser' ? 'chooser' : 'wallets');
    setSurface(choice);
  };
  const openRecoveryOptions = () => {
    setContactEnrollment(
      reduceContactEnrollment(initialContactEnrollment, {
        type: 'START',
        assurance: 'cloud-and-contact',
        walletPolicyHash: SAMPLE_POLICY_HASH,
      })
    );
    setContactSample('overview');
    setInvitationDecision('pending');
    setRequestDecision(null);
    setSurface('recovery');
  };
  const startSampleInvitation = () => {
    setInvitationDecision('pending');
    setContactSample('invitation');
  };
  const startSampleRequest = () => {
    setRequestDecision(reviewContactRequest(SAMPLE_REQUEST, SAMPLE_NOW));
    setContactSample('request');
  };
  const decideSampleRequest = (decision: 'approve' | 'decline' | 'expire') => {
    setRequestDecision((current) =>
      current
        ? decideContactRequest(
            current,
            decision,
            decision === 'expire' ? SAMPLE_REQUEST.expiresAt : SAMPLE_NOW + 1
          )
        : current
    );
  };
  const back = () => {
    if (surface === 'cloud' || surface === 'contact') setSurface('recovery');
    else if (surface === 'recovery') setSurface('seedless');
    else if (surface === 'chooser') setSurface('wallets');
    else if (surface === 'simple') setSurface(choiceOrigin);
    else if (surface === 'hot' || surface === 'cold') setSurface('simple');
    else if (surface === 'advanced' || surface === 'import') setSurface(choiceOrigin);
    else if (surface === 'seedless' && draft.stage === 'complete') {
      resetWalkthrough();
      exitFlow();
    } else if (surface === 'seedless' && draft.stage === 'automatic') exitFlow();
    else if (surface === 'seedless') act({ type: 'BACK' });
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (surface === 'wallets') return false;
      back();
      return true;
    });
    return () => subscription.remove();
  }, [surface, draft.stage, choiceOrigin]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [surface, draft.stage]);

  useEffect(() => {
    if (
      surface !== 'seedless' ||
      draft.stage !== 'automatic' ||
      (automaticSetup !== 'adding-mobile' && automaticSetup !== 'adding-server')
    )
      return undefined;
    // Demonstration only: these timers change labels, not key or server state.
    const timer = setTimeout(
      () => setAutomaticSetup((current) => reduceSimulatedSetup(current, 'COMPLETE_STEP')),
      SIMULATED_KEY_STEP_MS
    );
    return () => clearTimeout(timer);
  }, [surface, draft.stage, automaticSetup]);

  const setupFailed = automaticSetup === 'mobile-failed' || automaticSetup === 'server-failed';
  const selectedDevice = HARDWARE_CHOICES.find(({ id }) => id === draft.hardware);
  const canProposeInheritance = canPreviewInheritanceForHardware(draft.hardware);
  const hasDraft =
    automaticSetup !== initialSimulatedSetupState ||
    draft.stage !== 'automatic' ||
    draft.hardware !== null ||
    draft.inheritanceEnabled;
  const walletChooser = (fromWallets: boolean) => (
    <WalletCreationChooser
      onSimpleWallet={() => openChoice('simple')}
      onSeedlessWallet={() => openChoice('seedless')}
      onAdvancedWallet={() => openChoice('advanced')}
      onImportWallet={() => openChoice('import')}
      showSeedless
      previewNotice={
        fromWallets
          ? undefined
          : 'TESTNET PREVIEW · Simulated choices. No wallet, key, address, or backup is created.'
      }
      seedlessResumeHint={
        hasDraft ? 'Your Seedless Wallet walkthrough will resume where you left off.' : undefined
      }
    />
  );

  return (
    <ScreenWrapper backgroundcolor={palette.background}>
      <ScreenHeading
        title={
          surface === 'wallets'
            ? 'Wallets'
            : surface === 'chooser'
            ? 'Choose a Wallet'
            : surface === 'simple'
            ? 'Single-Key Wallet'
            : surface === 'hot'
            ? 'Hot Wallet'
            : surface === 'cold'
            ? 'Cold Wallet'
            : surface === 'advanced'
            ? 'Custom Wallet'
            : surface === 'import'
            ? 'Import Wallet'
            : surface === 'recovery'
            ? 'Recovery Options'
            : surface === 'cloud'
            ? 'Cloud Backup'
            : surface === 'contact'
            ? 'Recovery Contact'
            : 'Seedless Wallet'
        }
        onBack={surface === 'wallets' ? undefined : back}
        palette={palette}
      />
      <ScrollView
        ref={scrollRef}
        testID="preview-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {surface !== 'chooser' && (
          <Banner palette={palette} testID="preview-simulation-banner">
            {surface === 'wallets'
              ? 'TESTNET DEMO · No wallet or key.'
              : surface === 'seedless'
              ? 'TESTNET DEMO · No wallet or key.'
              : 'TESTNET PREVIEW · Simulated walkthrough. No wallet, key, address, cloud backup, or server registration is created.'}
          </Banner>
        )}

        {surface === 'wallets' && (
          <View testID="preview-wallets-empty" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              No wallets yet
            </PreviewText>
            {walletChooser(true)}
          </View>
        )}

        {surface === 'chooser' && walletChooser(false)}

        {surface === 'simple' && (
          <View testID="preview-simple-wallet" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              One key to spend
            </PreviewText>
            <PreviewText color={palette.muted}>
              Choose where the key would be held. These are simulated choices in this isolated
              preview; no wallet or key will be created.
            </PreviewText>
            <WalletChoiceCard
              title="Hot Wallet"
              icon="◉"
              eyebrow="ON THIS PHONE"
              description="A single key held by this phone for everyday spending."
              testID="preview-choice-hot"
              onPress={() => setSurface('hot')}
            />
            <WalletChoiceCard
              title="Cold Wallet"
              icon="◇"
              eyebrow="EXTERNAL KEY"
              description="A single key held on a separate signing device."
              testID="preview-choice-cold"
              onPress={() => setSurface('cold')}
            />
          </View>
        )}

        {(surface === 'hot' || surface === 'cold') && (
          <View testID={`preview-${surface}-wallet`} style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              {surface === 'hot' ? 'Hot Wallet' : 'Cold Wallet'}
            </PreviewText>
            <PreviewText color={palette.muted}>
              {surface === 'hot'
                ? 'A Hot Wallet would use one key on this phone. No key is generated or stored here.'
                : 'A Cold Wallet would use one external signing key. No device is connected or registered here.'}
            </PreviewText>
            <Banner palette={palette}>
              SIMULATED CHOICE · Single-Key Wallet creation is not available in this preview. No
              wallet, address, or backup exists.
            </Banner>
            <LinkAction
              label="Choose Another"
              testID="preview-choose-another-wallet"
              palette={palette}
              onPress={exitFlow}
            />
          </View>
        )}

        {surface === 'advanced' && (
          <View testID="preview-advanced-wallet" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Custom setup
            </PreviewText>
            <PreviewText color={palette.muted}>
              Custom Wallet is for choosing your keys and spending rules, including Miniscript
              options such as Inheritance Key, Emergency Key, and Wallet Timelock.
            </PreviewText>
            <Banner palette={palette}>
              PREVIEW ONLY · Custom Wallet creation is not connected in this isolated app. No
              policy, key, or wallet is created.
            </Banner>
          </View>
        )}

        {surface === 'import' && (
          <View testID="preview-import-unavailable" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Import Wallet
            </PreviewText>
            <PreviewText color={palette.muted}>
              Import is available in standard Keeper. The isolated testnet preview does not read
              existing wallets or import files.
            </PreviewText>
            <Banner palette={palette}>
              UNAVAILABLE IN PREVIEW · No existing wallet or key was accessed.
            </Banner>
          </View>
        )}

        {surface === 'seedless' && draft.stage === 'automatic' && (
          <View testID="preview-automatic" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Setting up your keys
            </PreviewText>
            <PreviewText color={palette.muted}>
              Mobile and Server first. Choose hardware next.
            </PreviewText>
            <View accessibilityLiveRegion="polite" style={styles.section}>
              <Panel palette={palette} testID="preview-mobile-key-status">
                <View style={styles.progressRow}>
                  {automaticSetup === 'adding-mobile' ? (
                    <ActivityIndicator
                      color={palette.accent}
                      accessibilityLabel="Adding Mobile Key"
                    />
                  ) : (
                    <PreviewText
                      color={automaticSetup === 'mobile-failed' ? Colors.redAlert : palette.accent}
                      style={styles.stepIcon}
                    >
                      {automaticSetup === 'mobile-failed' ? '!' : '✓'}
                    </PreviewText>
                  )}
                  <View style={styles.progressCopy}>
                    <PreviewText color={palette.text} style={styles.cardTitle}>
                      Mobile Key
                    </PreviewText>
                    <PreviewText
                      color={automaticSetup === 'mobile-failed' ? Colors.redAlert : palette.accent}
                      style={styles.status}
                    >
                      {automaticSetup === 'adding-mobile'
                        ? 'Adding… · SIMULATED'
                        : automaticSetup === 'mobile-failed'
                        ? 'Failed · SIMULATED'
                        : 'Added · SIMULATED'}
                    </PreviewText>
                  </View>
                </View>
              </Panel>
              <Panel palette={palette} testID="preview-server-key-status">
                <View style={styles.progressRow}>
                  {automaticSetup === 'adding-server' ? (
                    <ActivityIndicator
                      color={palette.accent}
                      accessibilityLabel="Adding Server Key"
                    />
                  ) : (
                    <PreviewText
                      color={
                        automaticSetup === 'server-failed'
                          ? Colors.redAlert
                          : automaticSetup === 'ready'
                          ? palette.accent
                          : palette.muted
                      }
                      style={styles.stepIcon}
                    >
                      {automaticSetup === 'server-failed'
                        ? '!'
                        : automaticSetup === 'ready'
                        ? '✓'
                        : '○'}
                    </PreviewText>
                  )}
                  <View style={styles.progressCopy}>
                    <PreviewText color={palette.text} style={styles.cardTitle}>
                      Server Key
                    </PreviewText>
                    <PreviewText
                      color={
                        automaticSetup === 'server-failed'
                          ? Colors.redAlert
                          : automaticSetup === 'ready'
                          ? palette.accent
                          : palette.muted
                      }
                      style={styles.status}
                    >
                      {automaticSetup === 'adding-server'
                        ? 'Adding… · SIMULATED'
                        : automaticSetup === 'server-failed'
                        ? 'Failed · SIMULATED'
                        : automaticSetup === 'ready'
                        ? 'Added · SIMULATED'
                        : 'Waiting · SIMULATED'}
                    </PreviewText>
                  </View>
                </View>
              </Panel>
              <Panel palette={palette} testID="preview-hardware-key-status">
                <View style={styles.progressRow}>
                  <PreviewText color={palette.muted} style={styles.stepIcon}>
                    ○
                  </PreviewText>
                  <View style={styles.progressCopy}>
                    <PreviewText color={palette.text} style={styles.cardTitle}>
                      Hardware Key
                    </PreviewText>
                    <PreviewText color={palette.muted} style={styles.status}>
                      {automaticSetup === 'ready' ? 'Choose your device' : 'Waiting for you'}
                    </PreviewText>
                  </View>
                </View>
              </Panel>
            </View>
            {setupFailed && (
              <Banner palette={palette} testID="preview-automatic-error">
                SIMULATED FAILURE ·{' '}
                {automaticSetup === 'mobile-failed' ? 'Mobile Key' : 'Server Key'} setup stopped in
                this walkthrough. No key or server registration was attempted.
              </Banner>
            )}
            <PrimaryAction
              label="Choose Hardware"
              disabled={automaticSetup !== 'ready'}
              onPress={() => automaticSetup === 'ready' && act({ type: 'NEXT' })}
              palette={palette}
            />
            {setupFailed ? (
              <LinkAction
                label="Try Again"
                onPress={() =>
                  setAutomaticSetup((current) => reduceSimulatedSetup(current, 'RETRY'))
                }
                palette={palette}
                testID="preview-automatic-retry"
              />
            ) : (
              <LinkAction
                label={automaticSetup === 'ready' ? 'Show Setup Error' : 'Simulate Failure'}
                onPress={() =>
                  setAutomaticSetup((current) =>
                    reduceSimulatedSetup(
                      current,
                      current === 'ready' ? 'SHOW_SERVER_FAILURE' : 'SIMULATE_FAILURE'
                    )
                  )
                }
                palette={palette}
                testID="preview-automatic-simulate-failure"
              />
            )}
            <LinkAction
              label={showHowItWorks ? 'Hide details' : 'How it works'}
              onPress={() => setShowHowItWorks((visible) => !visible)}
              palette={palette}
              testID="preview-how-it-works"
            />
            {showHowItWorks && (
              <Panel palette={palette} testID="preview-how-it-works-details">
                <PreviewText color={palette.text} style={styles.cardTitle}>
                  How it works
                </PreviewText>
                <PreviewText color={palette.muted}>
                  The proposed wallet needs any 2 of 3 keys to spend: Mobile Key, Server Key, and
                  Hardware Key. Keeper cannot spend with Server Key alone. Your signing device may
                  have its own backup steps.
                </PreviewText>
                <PreviewText color={palette.muted}>
                  This preview only changes status labels. No key material has been generated, and
                  no Server Key has been requested or registered.
                </PreviewText>
              </Panel>
            )}
            <LinkAction
              label="Cancel"
              onPress={exitFlow}
              palette={palette}
              testID="preview-cancel"
            />
          </View>
        )}

        {surface === 'seedless' && draft.stage === 'hardware' && (
          <View testID="preview-hardware" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Choose Hardware
            </PreviewText>
            <PreviewText color={palette.muted}>
              Choose a device for the last key. Connection and policy support are not verified here.
            </PreviewText>
            {HARDWARE_CHOICES.map((choice) => (
              <Pressable
                key={choice.id}
                testID={`preview-hardware-${choice.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.hardware === choice.id }}
                onPress={() => act({ type: 'SELECT_HARDWARE', hardware: choice.id })}
              >
                <Panel palette={palette} selected={draft.hardware === choice.id}>
                  <PreviewText color={palette.text} style={styles.cardTitle}>
                    {choice.id}
                  </PreviewText>
                  <PreviewText color={palette.muted}>{choice.transport}</PreviewText>
                  <PreviewText color={palette.muted}>{choice.verification}</PreviewText>
                </Panel>
              </Pressable>
            ))}
            <PrimaryAction
              label="Continue"
              disabled={!draft.hardware}
              onPress={() => act({ type: 'NEXT' })}
              palette={palette}
            />
            <LinkAction
              label="Cancel"
              onPress={exitFlow}
              palette={palette}
              testID="preview-cancel"
            />
          </View>
        )}

        {surface === 'seedless' && draft.stage === 'connect' && (
          <View testID="preview-connect" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Connect Hardware
            </PreviewText>
            <Panel palette={palette}>
              <PreviewText color={palette.text} style={styles.cardTitle}>
                {selectedDevice?.id}
              </PreviewText>
              <PreviewText color={palette.muted}>{selectedDevice?.transport}</PreviewText>
              <PreviewText color={palette.muted}>
                Selected for this walkthrough only. No device has been read, paired, or registered.
              </PreviewText>
            </Panel>
            <PreviewText color={palette.muted}>
              Simulate Error shows a sample connection failure. It does not start NFC, camera, file,
              or Desktop access.
            </PreviewText>
            {draft.connectionAttempts > 0 && (
              <Banner palette={palette} testID="preview-connection-error">
                Simulated error {draft.connectionAttempts}: hardware connection is not implemented.
                No hardware was accessed. You can choose another device or continue with the
                simulated selection.
              </Banner>
            )}
            <PrimaryAction
              label="Simulate Error"
              onPress={() => act({ type: 'ATTEMPT_CONNECTION' })}
              palette={palette}
            />
            <LinkAction
              label="Continue Preview"
              onPress={() => act({ type: 'CONTINUE_SIMULATION' })}
              palette={palette}
              testID="preview-continue-simulation"
            />
            <LinkAction
              label="Choose Another"
              onPress={() => act({ type: 'BACK' })}
              palette={palette}
              testID="preview-choose-another"
            />
            <LinkAction
              label="Cancel"
              onPress={exitFlow}
              palette={palette}
              testID="preview-cancel"
            />
          </View>
        )}

        {surface === 'seedless' && draft.stage === 'inheritance' && (
          <View testID="preview-inheritance" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Inheritance Key
            </PreviewText>
            {canProposeInheritance ? (
              <>
                <PreviewText color={palette.muted}>
                  Proposal, not configured: an Inheritance Key would give your heir a delayed path
                  after a fixed on-chain unlock date. Opening Keeper would not reset that date.
                </PreviewText>
                <Banner palette={palette} testID="preview-inheritance-candidate">
                  UNVERIFIED CANDIDATE · Coldcard has not been proven to register or sign this full
                  inheritance policy. No Inheritance Key or policy is created here.
                </Banner>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: draft.inheritanceEnabled }}
                  testID="preview-inheritance-toggle"
                  onPress={() =>
                    act({ type: 'SET_INHERITANCE', enabled: !draft.inheritanceEnabled })
                  }
                >
                  <Panel palette={palette} selected={draft.inheritanceEnabled}>
                    <PreviewText color={palette.text} style={styles.cardTitle}>
                      {draft.inheritanceEnabled ? '✓ Add Inheritance Key' : '○ Add Inheritance Key'}
                    </PreviewText>
                    <PreviewText color={palette.muted}>
                      Optional. It does not lower the 2-of-3 spending requirement today.
                    </PreviewText>
                  </Panel>
                </Pressable>
                {draft.inheritanceEnabled && (
                  <Banner palette={palette}>
                    SIMULATED PROPOSAL · Your heir would need an Inheritance Key and a second signer
                    they can access without Server Key. Changing the unlock date would require a new
                    wallet and moving bitcoin. No heir, date, signer, or Miniscript policy is
                    configured.
                  </Banner>
                )}
              </>
            ) : (
              <Banner palette={palette} testID="preview-inheritance-unavailable">
                Inheritance Key is unavailable with {selectedDevice?.id} in this preview. Keeper
                cannot verify the full delayed policy with this device yet. Continue with 2 of 3 or
                change device.
              </Banner>
            )}
            <PrimaryAction
              label="Review Policy"
              onPress={() => act({ type: 'NEXT' })}
              palette={palette}
            />
            <LinkAction
              label="Change Device"
              onPress={() => act({ type: 'CHANGE_HARDWARE' })}
              palette={palette}
              testID="preview-change-hardware"
            />
            <LinkAction
              label="Cancel"
              onPress={exitFlow}
              palette={palette}
              testID="preview-cancel"
            />
          </View>
        )}

        {surface === 'seedless' && draft.stage === 'review' && (
          <View testID="preview-review" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Review Policy
            </PreviewText>
            <PreviewText color={palette.muted}>
              Review the complete proposed wallet before any real wallet would be created. This
              preview cannot approve or register a policy.
            </PreviewText>
            <Panel palette={palette}>
              <PreviewText color={palette.text} style={styles.cardTitle}>
                Spending now · 2 of 3
              </PreviewText>
              <PreviewText color={palette.muted}>Mobile Key · ready status simulated</PreviewText>
              <PreviewText color={palette.muted}>Server Key · ready status simulated</PreviewText>
              <PreviewText color={palette.muted}>
                {selectedDevice?.id} Hardware Key · selected, not connected
              </PreviewText>
              <PreviewText color={palette.muted}>
                Any 2 of these 3 keys would be needed to spend. Keeper cannot spend with Server Key
                alone.
              </PreviewText>
              <PreviewText color={palette.muted}>
                Your signing device may have its own backup steps.
              </PreviewText>
            </Panel>
            <Panel palette={palette}>
              <PreviewText color={palette.text} style={styles.cardTitle}>
                Inheritance · {draft.inheritanceEnabled ? 'selected' : 'not added'}
              </PreviewText>
              <PreviewText color={palette.muted}>
                {draft.inheritanceEnabled
                  ? 'Proposed delayed path, not configured: after a fixed on-chain unlock date, your heir would use an Inheritance Key plus a designated second signer available without Server Key. Opening Keeper would not reset the date. Changing it would require a new wallet and moving bitcoin. No date, signer, or Miniscript policy exists in this preview. Coldcard compatibility remains unverified.'
                  : canProposeInheritance
                  ? 'The proposed wallet has only the base 2-of-3 spending path.'
                  : `The proposed wallet has only the base 2-of-3 spending path. Inheritance Key is unavailable with ${selectedDevice?.id} in this preview.`}
              </PreviewText>
            </Panel>
            <Banner palette={palette}>
              SIMULATED POLICY · No private keys, descriptor, address, backup, transaction, or
              server approval exists. Hardware and inheritance compatibility still need physical
              testing and security review.
            </Banner>
            <PrimaryAction
              label="Finish Preview"
              onPress={() => act({ type: 'NEXT' })}
              palette={palette}
            />
            <LinkAction
              label="Cancel"
              onPress={exitFlow}
              palette={palette}
              testID="preview-cancel"
            />
          </View>
        )}

        {surface === 'seedless' && draft.stage === 'complete' && (
          <View testID="preview-complete" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Walkthrough Complete
            </PreviewText>
            <Banner palette={palette}>
              No wallet was created. No bitcoin can be received or sent from this preview.
            </Banner>
            <PreviewText color={palette.muted}>
              Your selected hardware and inheritance choice were used only to show the proposed
              review. No key, hardware device, cloud service, or Keeper server was accessed.
            </PreviewText>
            <PrimaryAction
              label="Recovery Options"
              onPress={openRecoveryOptions}
              palette={palette}
            />
            <LinkAction
              label="Start Again"
              onPress={resetWalkthrough}
              palette={palette}
              testID="preview-start-again"
            />
            <LinkAction label="Done" onPress={back} palette={palette} testID="preview-done" />
          </View>
        )}

        {surface === 'recovery' && (
          <View testID="preview-recovery-options" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Recovery Options
            </PreviewText>
            <PreviewText color={palette.muted}>
              Explore proposed ways to restore this wallet's Mobile Key on another phone. These
              options do not change the wallet policy.
            </PreviewText>
            <Banner palette={palette}>
              SIMULATED · No Mobile Key, encrypted cloud blob, contact credential, or server
              exchange exists. Neither option can restore or spend bitcoin.
            </Banner>
            <Pressable
              accessibilityRole="button"
              testID="preview-recovery-cloud"
              onPress={() => setSurface('cloud')}
            >
              <Panel palette={palette}>
                <PreviewText color={palette.text} style={styles.cardTitle}>
                  Encrypted Cloud Backup
                </PreviewText>
                <PreviewText color={palette.muted}>
                  A separate encrypted Mobile Key backup would need upload, download, and verified
                  readback. None is configured here.
                </PreviewText>
              </Panel>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="preview-recovery-contact"
              onPress={() => setSurface('contact')}
            >
              <Panel palette={palette}>
                <PreviewText color={palette.text} style={styles.cardTitle}>
                  Recovery Contact
                </PreviewText>
                <PreviewText color={palette.muted}>
                  A contact could approve a lost-phone request using a separate credential. Cloud
                  readback and cryptographic verification would still be required.
                </PreviewText>
              </Panel>
            </Pressable>
          </View>
        )}

        {surface === 'cloud' && (
          <View testID="preview-cloud-backup" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Encrypted Cloud Backup
            </PreviewText>
            <Panel palette={palette}>
              <PreviewText color={palette.text} style={styles.cardTitle}>
                Unavailable · readback not verified
              </PreviewText>
              <PreviewText color={palette.muted}>
                No encrypted Mobile Key was written or downloaded. No dedicated preview iCloud or
                Google Drive container is connected. A matching download alone would not prove
                authenticated decryption.
              </PreviewText>
            </Panel>
            {contactEnrollment.stage === 'cloud-offline' ? (
              <Banner palette={palette} testID="preview-cloud-offline">
                SIMULATED OFFLINE · The cloud cannot be reached. An invitation or recovery request
                cannot continue without the backup readback. No upload was attempted.
              </Banner>
            ) : (
              <Banner palette={palette} testID="preview-cloud-unverified">
                READBACK NOT VERIFIED · Backup and recovery are blocked until a real encrypted
                write, download, and authenticated readback succeed.
              </Banner>
            )}
            {contactEnrollment.stage === 'cloud-offline' ? (
              <PrimaryAction
                label="Try Again"
                onPress={() =>
                  setContactEnrollment((current) =>
                    reduceContactEnrollment(current, { type: 'RETRY_CLOUD' })
                  )
                }
                palette={palette}
              />
            ) : (
              <PrimaryAction
                label="Simulate Offline"
                onPress={() =>
                  setContactEnrollment((current) =>
                    reduceContactEnrollment(current, { type: 'CLOUD_OFFLINE' })
                  )
                }
                palette={palette}
              />
            )}
            <LinkAction
              label="Recovery Options"
              onPress={() => setSurface('recovery')}
              palette={palette}
              testID="preview-recovery-back"
            />
          </View>
        )}

        {surface === 'contact' && (
          <View testID="preview-contact-recovery" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Recovery Contact
            </PreviewText>
            <PreviewText color={palette.muted}>
              A contact is not an Inheritance Key or wallet signer. Contact approval would help
              restore only the Mobile Key; another signer would still be needed to spend.
            </PreviewText>
            <Banner palette={palette} testID="preview-contact-blocked">
              ENROLLMENT BLOCKED · Cloud readback is not verified. No invitation can be sent, no
              contact credential exists, and no recovery request can be exchanged.
            </Banner>
            {contactEnrollment.stage === 'cloud-offline' && (
              <Banner palette={palette} testID="preview-contact-offline">
                SIMULATED OFFLINE · Cloud backup is unavailable. Contact recovery cannot proceed
                without retrieving the encrypted backup.
              </Banner>
            )}
            {contactSample === 'overview' && (
              <View style={styles.section}>
                <PreviewText color={palette.muted}>
                  The samples below show possible decisions only. They do not bypass cloud readback
                  or create a contact credential.
                </PreviewText>
                <PrimaryAction
                  label="Sample Invite"
                  onPress={startSampleInvitation}
                  palette={palette}
                />
                <LinkAction
                  label="Sample Request"
                  onPress={startSampleRequest}
                  palette={palette}
                  testID="preview-sample-request"
                />
              </View>
            )}
            {contactSample === 'invitation' && (
              <View testID="preview-sample-invitation" style={styles.section}>
                <Panel palette={palette}>
                  <PreviewText color={palette.text} style={styles.cardTitle}>
                    Sample invitation · not sent
                  </PreviewText>
                  <PreviewText color={palette.muted}>
                    A real contact would review who invited them and decide whether to accept. No
                    invitation, contact credential, or wrapped backup key exists in this sample.
                  </PreviewText>
                </Panel>
                {invitationDecision === 'pending' ? (
                  <View style={styles.section}>
                    <PrimaryAction
                      label="Simulate Approval"
                      onPress={() => setInvitationDecision('approval-intent')}
                      palette={palette}
                    />
                    <LinkAction
                      label="Simulate Decline"
                      onPress={() => setInvitationDecision('declined')}
                      palette={palette}
                      testID="preview-invite-decline"
                    />
                    <LinkAction
                      label="Simulate Expiry"
                      onPress={() => setInvitationDecision('expired')}
                      palette={palette}
                      testID="preview-invite-expire"
                    />
                  </View>
                ) : (
                  <Banner palette={palette} testID="preview-invite-result">
                    {invitationDecision === 'approval-intent'
                      ? 'SIMULATED APPROVAL INTENT · No credential was enrolled and no cryptographic key wrapping occurred.'
                      : invitationDecision === 'declined'
                      ? 'SIMULATED DECLINE · Enrollment stops. No credential or backup access was granted.'
                      : 'SIMULATED EXPIRY · The invitation can no longer be accepted. No credential was created.'}
                  </Banner>
                )}
                <LinkAction
                  label="Reset Sample"
                  onPress={startSampleInvitation}
                  palette={palette}
                  testID="preview-invite-reset"
                />
                <LinkAction
                  label="Sample Request"
                  onPress={startSampleRequest}
                  palette={palette}
                  testID="preview-sample-request"
                />
              </View>
            )}
            {contactSample === 'request' && requestDecision && (
              <View testID="preview-sample-contact-request" style={styles.section}>
                <Panel palette={palette}>
                  <PreviewText color={palette.text} style={styles.cardTitle}>
                    Sample lost-phone request · not sent
                  </PreviewText>
                  <PreviewText color={palette.muted}>
                    A contact would verify the person and replacement phone through a separate
                    trusted check before deciding. This sample has no enrolled credential, device
                    key, encrypted response, or server exchange.
                  </PreviewText>
                </Panel>
                {requestDecision.stage === 'pending' ? (
                  <View style={styles.section}>
                    <PrimaryAction
                      label="Simulate Approval"
                      onPress={() => decideSampleRequest('approve')}
                      palette={palette}
                    />
                    <LinkAction
                      label="Simulate Decline"
                      onPress={() => decideSampleRequest('decline')}
                      palette={palette}
                      testID="preview-request-decline"
                    />
                    <LinkAction
                      label="Simulate Expiry"
                      onPress={() => decideSampleRequest('expire')}
                      palette={palette}
                      testID="preview-request-expire"
                    />
                  </View>
                ) : (
                  <Banner palette={palette} testID="preview-request-result">
                    {requestDecision.stage === 'approval-intent'
                      ? 'SIMULATED APPROVAL INTENT · No response was encrypted or delivered, and no Mobile Key was restored.'
                      : requestDecision.stage === 'declined'
                      ? 'SIMULATED DECLINE · The recovery request stops. No Mobile Key was restored.'
                      : 'SIMULATED EXPIRY · The request cannot be approved. No Mobile Key was restored.'}
                  </Banner>
                )}
                <LinkAction
                  label="Reset Sample"
                  onPress={startSampleRequest}
                  palette={palette}
                  testID="preview-request-reset"
                />
                <LinkAction
                  label="Sample Invite"
                  onPress={startSampleInvitation}
                  palette={palette}
                  testID="preview-sample-invite"
                />
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

export default function RecoverableWalletPreviewApp() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <NativeBaseProvider theme={customTheme}>
          <PreviewContent />
        </NativeBaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: 46, marginBottom: 8 },
  backButton: { width: 36, minHeight: 44, justifyContent: 'center' },
  backText: { fontSize: 32, lineHeight: 40 },
  headerTitle: { fontSize: 18, fontWeight: '600', flexShrink: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 36 },
  section: { gap: 14, paddingTop: 12 },
  pageTitle: { fontSize: 24, fontWeight: '600' },
  bodyText: { fontSize: 15, lineHeight: 23 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  panel: { borderRadius: 12, padding: 16, gap: 7 },
  banner: { borderRadius: 10, padding: 14, marginTop: 8 },
  bannerText: { fontSize: 14, lineHeight: 21, fontWeight: '500' },
  status: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressCopy: { flex: 1, gap: 3 },
  stepIcon: { width: 22, fontSize: 20, lineHeight: 26, textAlign: 'center' },
  linkButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: 8 },
  linkText: { fontSize: 15, fontWeight: '600' },
  primaryButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  primaryButtonText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  note: { fontSize: 13, lineHeight: 20, marginTop: 4 },
});
