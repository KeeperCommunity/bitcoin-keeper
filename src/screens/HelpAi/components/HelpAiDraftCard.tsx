import { useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import Buttons from 'src/components/Buttons';
import { hp, wp } from 'src/constants/responsive';
import Colors from 'src/theme/Colors';
import { HelpDraft, ScreenshotAsset } from 'src/models/interfaces/HelpAi';

type DraftStatus =
  | 'pending_review'
  | 'confirming_public_submission'
  | 'submitting'
  | 'submitted'
  | 'failed_retryable';

type HelpAiDraftCardProps = {
  draft: HelpDraft;
  draftStatus: DraftStatus;
  onReview: () => void;
  onConfirm: (assets: ScreenshotAsset[]) => void;
  onCancel: () => void;
  onRetry: () => void;
};

const HelpAiDraftCard = ({
  draft,
  draftStatus,
  onReview,
  onConfirm,
  onCancel,
  onRetry,
}: HelpAiDraftCardProps) => {
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  // Workaround: react-redux 7.x does not reliably trigger child re-renders
  // with React 19 when parent passes new props via useAppSelector.
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => forceUpdate((n) => n + 1), 100);
    return () => clearTimeout(t);
  }, [draftStatus]);

  const [selectedAssets, setSelectedAssets] = useState<ScreenshotAsset[]>([]);
  const uiColors = React.useMemo(
    () => ({
      surface: isDarkMode ? '#1f1f1f' : '#ffffff',
      separator: isDarkMode ? '#3a3a3a' : '#d8d8d8',
      primaryText: isDarkMode ? '#e7e7e7' : '#272421',
      secondaryText: isDarkMode ? '#a5a5a5' : '#878787',
      pantoneGreen: '#2f4f4f',
    }),
    [isDarkMode]
  );

  const handleAddScreenshot = () => {
    launchImageLibrary(
      { mediaType: 'photo', maxWidth: 1200, maxHeight: 1200, quality: 0.7 },
      (response) => {
        if (response.didCancel || response.errorCode) return;
        const asset = response.assets?.[0];
        if (!asset?.uri) return;
        setSelectedAssets((prev) => [
          ...prev,
          { uri: asset.uri, mimeType: asset.type || 'image/jpeg' },
        ]);
      }
    );
  };

  const handleConfirm = () => {
    onConfirm(selectedAssets);
  };

  const fields: Array<{ label: string; value?: string | string[] }> = [
    { label: 'Title', value: draft.title },
    ...(draft.steps ? [{ label: 'Steps', value: draft.steps }] : []),
    ...(draft.expected ? [{ label: 'Expected', value: draft.expected }] : []),
    ...(draft.actual ? [{ label: 'Actual', value: draft.actual }] : []),
    ...(draft.problem ? [{ label: 'Problem', value: draft.problem }] : []),
    ...(draft.proposed ? [{ label: 'Proposed', value: draft.proposed }] : []),
  ];

  return (
    <View
      testID="help_ai_draft_card"
      style={{
        borderWidth: 1,
        borderColor: uiColors.separator,
        backgroundColor: uiColors.surface,
        borderRadius: 10,
        padding: wp(14),
        marginTop: hp(10),
      }}
    >
      <Text style={{ fontWeight: '600', color: uiColors.primaryText }}>
        {draft.kind === 'bug' ? 'Bug Draft' : 'Feature Draft'}
      </Text>

      {fields.map((field) => {
        const isArray = Array.isArray(field.value);
        return (
          <View key={field.label} style={{ marginTop: hp(7) }}>
            <Text style={{ fontSize: 12, color: uiColors.secondaryText, fontWeight: '600' }}>
              {field.label}
            </Text>
            {isArray ? (
              <View>
                {(field.value as string[]).map((line, idx) => (
                  <Text
                    key={`${field.label}-${idx}`}
                    style={{ fontSize: 12, color: uiColors.primaryText }}
                  >
                    {`${idx + 1}. ${line}`}
                  </Text>
                ))}
              </View>
            ) : (
              <Text
                style={{
                  fontSize: 12,
                  color: uiColors.primaryText,
                }}
              >
                {(field.value as string) ?? ''}
              </Text>
            )}
          </View>
        );
      })}

      {draftStatus === 'pending_review' && (
        <View style={{ marginTop: hp(12) }}>
          <Buttons primaryText={'Review & Submit'} primaryCallback={onReview} fullWidth />
        </View>
      )}

      {draftStatus === 'confirming_public_submission' && (
        <View style={[{ marginTop: hp(12) }, styles.gap10]}>
          <Text style={{ fontSize: 12, color: uiColors.secondaryText }}>
            This will create a public GitHub issue. Confirm only if you are comfortable sharing this
            information publicly.
          </Text>

          {selectedAssets.length > 0 && (
            <View style={styles.thumbnailStrip}>
              {selectedAssets.map((asset, idx) => (
                <View key={asset.uri} style={styles.thumbnailWrapper}>
                  <Image source={{ uri: asset.uri }} style={styles.thumbnail} />
                  <Pressable
                    testID={`screenshot_remove_${idx}`}
                    style={styles.thumbnailRemoveBtn}
                    onPress={() =>
                      setSelectedAssets((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    <Text style={styles.thumbnailRemoveText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {selectedAssets.length < 3 && (
            <Pressable
              testID="btn_add_screenshot"
              style={[styles.addScreenshotRow, { borderColor: Colors.greyBorder }]}
              onPress={handleAddScreenshot}
            >
              <Text style={{ fontSize: 12, color: uiColors.secondaryText }}>
                + Add Screenshot (optional, max 3)
              </Text>
            </Pressable>
          )}

          <Text style={{ fontSize: 12, color: uiColors.secondaryText }}>
            Screenshots may expose wallet balances or addresses. Only attach what you are
            comfortable sharing publicly.
          </Text>

          <Buttons
            primaryText={'Confirm Public Submission'}
            primaryCallback={handleConfirm}
            fullWidth
          />
          <Buttons primaryText={'Cancel'} primaryCallback={onCancel} fullWidth />
        </View>
      )}

      {draftStatus === 'submitting' && (
        <View style={[{ marginTop: hp(12) }, styles.row]}>
          <ActivityIndicator size="small" />
          <Text style={{ fontSize: 12, color: uiColors.secondaryText }}>Submitting issue...</Text>
        </View>
      )}

      {draftStatus === 'failed_retryable' && (
        <View style={[{ marginTop: hp(12) }, styles.gap10]}>
          <Buttons primaryText={'Retry Submission'} primaryCallback={onRetry} fullWidth />
          <Buttons primaryText={'Cancel'} primaryCallback={onCancel} fullWidth />
        </View>
      )}

      {draftStatus === 'submitted' && (
        <View style={{ marginTop: hp(12) }}>
          <Text style={{ fontSize: 12, color: uiColors.pantoneGreen }}>
            Submitted successfully.
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  gap10: {
    gap: hp(10),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(8),
  },
  thumbnailStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: wp(8),
  },
  thumbnailWrapper: {
    position: 'relative',
  },
  thumbnail: {
    width: wp(80),
    height: wp(80),
    borderRadius: 8,
  },
  thumbnailRemoveBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 100,
    backgroundColor: '#555',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailRemoveText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
  addScreenshotRow: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: hp(10),
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default HelpAiDraftCard;
