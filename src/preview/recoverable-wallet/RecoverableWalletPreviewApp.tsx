import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, PixelRatio, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { NativeBaseProvider, useColorMode } from '@gluestack-ui/themed-native-base';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import Text from 'src/components/KeeperText';
import ScreenWrapper from 'src/components/ScreenWrapper';
import { customTheme } from 'src/navigation/themes';
import Colors from 'src/theme/Colors';
import {
  HARDWARE_CHOICES,
  initialPreviewDraft,
  PreviewAction,
  PreviewDraft,
  reducePreviewDraft,
} from './previewFlow';

type Palette = {
  background: string;
  card: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  warning: string;
};

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
  const [inFlow, setInFlow] = useState(false);
  const [draft, setDraft] = useState<PreviewDraft>(initialPreviewDraft);
  const scrollRef = useRef<ScrollView>(null);
  const act = (action: PreviewAction) => setDraft((current) => reducePreviewDraft(current, action));
  const exitFlow = () => setInFlow(false);
  const back = () => {
    if (draft.stage === 'complete') {
      act({ type: 'RESET' });
      exitFlow();
    } else if (draft.stage === 'automatic') exitFlow();
    else act({ type: 'BACK' });
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!inFlow) return false;
      back();
      return true;
    });
    return () => subscription.remove();
  }, [inFlow, draft.stage]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [inFlow, draft.stage]);

  const selectedDevice = HARDWARE_CHOICES.find(({ id }) => id === draft.hardware);
  const hasDraft =
    draft.stage !== 'automatic' || draft.hardware !== null || draft.inheritanceEnabled;

  return (
    <ScreenWrapper backgroundcolor={palette.background}>
      <ScreenHeading
        title={inFlow ? 'Wallet Preview' : 'Add Wallet'}
        onBack={inFlow ? back : undefined}
        palette={palette}
      />
      <ScrollView
        ref={scrollRef}
        testID="preview-scroll"
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Banner palette={palette} testID="preview-simulation-banner">
          TESTNET PREVIEW · Simulated walkthrough. No wallet, key, address, cloud backup, or server
          registration is created.
        </Banner>

        {!inFlow && (
          <View testID="preview-add-wallet" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Recoverable Wallet
            </PreviewText>
            <PreviewText color={palette.muted}>
              Explore a fixed 2-of-3 wallet with an automatic Mobile Key and Server Key, then choose
              your Hardware Key. This preview cannot receive or send bitcoin.
            </PreviewText>
            <Panel palette={palette}>
              <PreviewText color={palette.text} style={styles.cardTitle}>
                Recoverable Wallet · Preview
              </PreviewText>
              <PreviewText color={palette.muted}>
                Choose hardware, consider an optional Inheritance Key, and review the complete
                proposed policy.
              </PreviewText>
            </Panel>
            <PrimaryAction
              label={hasDraft ? 'Resume' : 'Start Preview'}
              onPress={() => setInFlow(true)}
              palette={palette}
            />
            {hasDraft && (
              <LinkAction
                label="Start Again"
                testID="preview-start-again"
                palette={palette}
                onPress={() => {
                  act({ type: 'RESET' });
                  setInFlow(true);
                }}
              />
            )}
            <PreviewText color={palette.muted} style={styles.note}>
              Progress can be resumed while this preview stays open. It is cleared when the app
              closes.
            </PreviewText>
          </View>
        )}

        {inFlow && draft.stage === 'automatic' && (
          <View testID="preview-automatic" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Automatic Keys
            </PreviewText>
            <PreviewText color={palette.muted}>
              The proposed wallet needs 2 of 3 keys to spend. These statuses demonstrate the
              intended automatic setup. No key material has been generated.
            </PreviewText>
            <Panel palette={palette}>
              <PreviewText color={palette.text} style={styles.cardTitle}>
                Mobile Key
              </PreviewText>
              <PreviewText color={palette.accent} style={styles.status}>
                Ready status · SIMULATED
              </PreviewText>
              <PreviewText color={palette.muted}>
                The app would prepare this key automatically. There is no Mobile Key or cloud backup
                in this preview.
              </PreviewText>
            </Panel>
            <Panel palette={palette}>
              <PreviewText color={palette.text} style={styles.cardTitle}>
                Server Key
              </PreviewText>
              <PreviewText color={palette.accent} style={styles.status}>
                Ready status · SIMULATED
              </PreviewText>
              <PreviewText color={palette.muted}>
                No Server Key has been requested or registered. Server Key is one key in your
                wallet. Keeper cannot spend your bitcoin with this key alone.
              </PreviewText>
            </Panel>
            <PrimaryAction
              label="Continue"
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

        {inFlow && draft.stage === 'hardware' && (
          <View testID="preview-hardware" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Choose Hardware
            </PreviewText>
            <PreviewText color={palette.muted}>
              Choose the last base key. Selecting a device here does not connect it or prove that it
              can sign the final policy.
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

        {inFlow && draft.stage === 'connect' && (
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

        {inFlow && draft.stage === 'inheritance' && (
          <View testID="preview-inheritance" style={styles.section}>
            <PreviewText color={palette.text} style={styles.pageTitle}>
              Inheritance Key
            </PreviewText>
            <PreviewText color={palette.muted}>
              An Inheritance Key gives your chosen heir or trusted party a delayed access path,
              based on the wallet rules you set.
            </PreviewText>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.inheritanceEnabled }}
              testID="preview-inheritance-toggle"
              onPress={() => act({ type: 'SET_INHERITANCE', enabled: !draft.inheritanceEnabled })}
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
                Selection is simulated. No heir, delay, Inheritance Key, or Miniscript policy is
                configured here.
              </Banner>
            )}
            <PrimaryAction
              label="Review Policy"
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

        {inFlow && draft.stage === 'review' && (
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
            </Panel>
            <Panel palette={palette}>
              <PreviewText color={palette.text} style={styles.cardTitle}>
                Inheritance · {draft.inheritanceEnabled ? 'selected' : 'not added'}
              </PreviewText>
              <PreviewText color={palette.muted}>
                {draft.inheritanceEnabled
                  ? 'After eligibility, an Inheritance Key and any eligible original signer would form the 2-of-4 spending path. The delay and Miniscript conditions are not configured in this preview.'
                  : 'The proposed wallet has only the base 2-of-3 spending path.'}
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

        {inFlow && draft.stage === 'complete' && (
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
              label="Start Again"
              onPress={() => act({ type: 'RESET' })}
              palette={palette}
            />
            <LinkAction label="Done" onPress={back} palette={palette} testID="preview-done" />
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
