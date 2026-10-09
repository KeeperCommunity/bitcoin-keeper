import React from 'react';
import { PixelRatio, Pressable, StyleSheet, View } from 'react-native';
import { useColorMode } from '@gluestack-ui/themed-native-base';
import Text from 'src/components/KeeperText';
import Colors from 'src/theme/Colors';

type WalletChoiceCardProps = {
  title: string;
  icon: string;
  description: string;
  eyebrow?: string;
  highlighted?: boolean;
  testID: string;
  onPress: () => void;
};

export type WalletCreationChooserProps = {
  onSimpleWallet: () => void;
  onSeedlessWallet?: () => void;
  onAdvancedWallet: () => void;
  onImportWallet?: () => void;
  showSeedless?: boolean;
  seedlessResumeHint?: string;
  previewNotice?: string;
};

function ScaledText({ children, style, color, ...props }: any) {
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

export function WalletChoiceCard({
  title,
  icon,
  description,
  eyebrow,
  highlighted = false,
  testID,
  onPress,
}: WalletChoiceCardProps) {
  const { colorMode } = useColorMode();
  const dark = colorMode === 'dark';
  const accent = dark ? Colors.mintGreen : Colors.primaryGreen;
  const text = dark ? Colors.bodyText : Colors.secondaryBlack;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
      onPress={onPress}
    >
      <View
        style={[
          styles.choiceCard,
          {
            backgroundColor: highlighted
              ? dark
                ? Colors.DullGreenDark
                : Colors.NewBadgeGreen
              : dark
              ? Colors.SecondaryBlack
              : Colors.brightCream,
            borderColor: highlighted ? accent : dark ? Colors.separator : Colors.greyBorder,
            borderWidth: highlighted ? 2 : 1,
          },
        ]}
      >
        <View style={styles.choiceHeader}>
          <View
            style={[
              styles.choiceIcon,
              {
                backgroundColor: highlighted
                  ? accent
                  : dark
                  ? Colors.DeepCharcoalGreen
                  : Colors.dullGreen,
              },
            ]}
          >
            <ScaledText
              color={highlighted ? (dark ? Colors.PrimaryBlack : Colors.headerWhite) : accent}
              style={styles.choiceIconText}
            >
              {icon}
            </ScaledText>
          </View>
          <ScaledText color={text} style={styles.choiceTitle}>
            {title}
          </ScaledText>
          <ScaledText color={accent} style={styles.choiceArrow}>
            ›
          </ScaledText>
        </View>
        {eyebrow && (
          <View style={highlighted && [styles.choiceBadge, { backgroundColor: accent }]}>
            <ScaledText
              color={highlighted ? (dark ? Colors.PrimaryBlack : Colors.headerWhite) : accent}
              style={styles.choiceEyebrow}
            >
              {eyebrow}
            </ScaledText>
          </View>
        )}
        <ScaledText color={text}>{description}</ScaledText>
      </View>
    </Pressable>
  );
}

export default function WalletCreationChooser({
  onSimpleWallet,
  onSeedlessWallet,
  onAdvancedWallet,
  onImportWallet,
  showSeedless = false,
  seedlessResumeHint,
  previewNotice,
}: WalletCreationChooserProps) {
  const { colorMode } = useColorMode();
  const dark = colorMode === 'dark';
  const accent = dark ? Colors.mintGreen : Colors.primaryGreen;
  const muted = dark ? Colors.darkGrey : Colors.GreenishGrey;

  return (
    <View testID="wallet-creation-chooser" style={styles.chooserSection}>
      <WalletChoiceCard
        title="Single-Key Wallet"
        icon="◉"
        description="Use your phone or a signing device."
        testID="wallet-choice-simple"
        onPress={onSimpleWallet}
      />
      {showSeedless && onSeedlessWallet && (
        <>
          <WalletChoiceCard
            title="Seedless Wallet"
            icon="✦"
            description="Phone, compatible hardware and Server Key. 2 of 3 keys to spend."
            highlighted
            testID="wallet-choice-seedless"
            onPress={onSeedlessWallet}
          />
          {seedlessResumeHint && (
            <ScaledText color={accent} style={styles.resumeNote}>
              {seedlessResumeHint}
            </ScaledText>
          )}
        </>
      )}
      <WalletChoiceCard
        title="Custom Wallet"
        icon="✣"
        description="Choose your keys and spending rules."
        testID="wallet-choice-advanced"
        onPress={onAdvancedWallet}
      />
      {onImportWallet && (
        <View style={styles.importRow}>
          <ScaledText color={muted}>Already have a wallet?</ScaledText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Import Wallet"
            testID="wallet-choice-import"
            onPress={onImportWallet}
            style={styles.importAction}
          >
            <ScaledText color={accent} style={styles.importText}>
              Import Wallet
            </ScaledText>
          </Pressable>
        </View>
      )}
      {previewNotice && (
        <ScaledText color={muted} style={styles.previewNotice}>
          {previewNotice}
        </ScaledText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bodyText: { fontSize: 15, lineHeight: 23 },
  chooserSection: { gap: 14, paddingTop: 10 },
  choiceCard: { borderRadius: 16, padding: 16, gap: 9 },
  choiceHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  choiceIcon: {
    width: 39,
    height: 39,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceIconText: { fontSize: 21, lineHeight: 27, fontWeight: '600' },
  choiceTitle: { fontSize: 18, lineHeight: 25, fontWeight: '700', flex: 1 },
  choiceArrow: { fontSize: 29, lineHeight: 32 },
  choiceEyebrow: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  choiceBadge: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 4,
  },
  importRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  importAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  importText: { fontWeight: '600' },
  resumeNote: { fontSize: 13, lineHeight: 20, marginTop: -3 },
  previewNotice: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
