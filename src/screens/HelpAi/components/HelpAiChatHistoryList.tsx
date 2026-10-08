import { useColorMode } from '@gluestack-ui/themed-native-base';
import { Text, View } from 'react-native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import Fonts from 'src/constants/Fonts';
import { hp, wp } from 'src/constants/responsive';
import { HELP_AI_ICON_MAP, getThreadIconType } from 'src/constants/helpAiIcons';
import { HelpAiThread } from 'src/store/reducers/helpAi';
import Colors from 'src/theme/Colors';
import PencilWhite from 'src/assets/images/edit_white.svg';
import Fab from 'src/components/Fab';

type HelpAiChatHistoryListProps = {
  threads: HelpAiThread[];
  onOpenChat: (conversationId: string) => void;
  onStartNewChat: () => void;
};

const formatRelativeTime = (isoDate: string) => {
  const time = new Date(isoDate).getTime();
  if (Number.isNaN(time)) return '';

  const diffMs = Date.now() - time;
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) return 'Just now';
  if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)}m ago`;
  if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}h ago`;
  if (diffMs < dayMs * 7) return `${Math.floor(diffMs / dayMs)}d ago`;

  return new Date(isoDate).toLocaleDateString();
};

const HelpAiChatHistoryList = ({
  threads,
  onOpenChat,
  onStartNewChat,
}: HelpAiChatHistoryListProps) => {
  const { colorMode } = useColorMode();

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.listContent}>
        {threads.map((thread, idx) => {
          const iconType = getThreadIconType(thread.messages);
          const ThreadIcon = HELP_AI_ICON_MAP[iconType] || HELP_AI_ICON_MAP.chat;

          return (
            <Pressable
              testID={`chat_thread_${idx}`}
              key={thread.conversationId}
              onPress={() => onOpenChat(thread.conversationId)}
              style={({ pressed }) => [styles.itemPressable, { opacity: pressed ? 0.75 : 1 }]}
            >
              <View style={[styles.itemCard]}>
                <View style={styles.iconWrap}>
                  <ThreadIcon width={wp(22)} height={wp(22)} />
                </View>
                <View style={styles.cardBody}>
                  {/* Icon + header row */}
                  <View style={styles.itemHeader}>
                    <View style={styles.iconAndTitle}>
                      <Text
                        testID={`chat_thread_title_${idx}`}
                        style={[
                          styles.threadTitle,
                          { color: colorMode === 'dark' ? '#e7e7e7' : '#272421' },
                        ]}
                        numberOfLines={1}
                      >
                        {thread.title || 'New chat'}
                      </Text>
                    </View>
                    <Text
                      testID={`chat_thread_time_${idx}`}
                      style={[
                        styles.metaText,
                        { color: colorMode === 'dark' ? '#696969' : '#677e7c' },
                      ]}
                    >
                      {formatRelativeTime(thread.updatedAt)}
                    </Text>
                  </View>

                  {/* Preview */}
                  <Text
                    testID={`chat_thread_preview_${idx}`}
                    style={[
                      styles.previewText,
                      { color: colorMode === 'dark' ? '#7a7a7a' : '#9a9590' },
                    ]}
                    numberOfLines={1}
                  >
                    {thread.lastMessage || 'No messages yet'}
                  </Text>
                </View>
              </View>
              {idx < threads.length - 1 && <View style={styles.spacer} />}
            </Pressable>
          );
        })}
      </ScrollView>
      <Fab
        icon={<PencilWhite height={hp(22)} width={wp(22)} />}
        onPress={onStartNewChat}
        containerStyle={{ right: wp(22) }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: wp(12),
    width: '100%',
  },
  title: {},
  listContent: {
    paddingBottom: hp(20),
  },
  itemPressable: {
    width: '100%',
  },
  itemCard: {
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardBody: {
    flex: 1,
    gap: hp(0),
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: wp(8),
  },
  iconAndTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(8),
    flex: 1,
  },
  iconWrap: {
    marginRight: wp(8),
    borderRadius: wp(100),
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#c6ddd1',
  },
  threadTitle: {
    flex: 1,
    maxWidth: '70%',
    fontSize: 17,
    fontWeight: '500',
  },
  metaText: {
    fontSize: 11,
    fontFamily: Fonts.InterRegular,
  },
  previewText: {
    fontSize: 13,
    fontFamily: Fonts.InterRegular,
    lineHeight: hp(18),
    maxWidth: '90%',
  },
  ctaCtr: {
    paddingBottom: hp(12),
    paddingTop: hp(6),
  },
  spacer: {
    height: hp(1),
    width: '95%',
    marginVertical: hp(10),
    backgroundColor: Colors.greyBorder,
    opacity: 0.5,
    alignSelf: 'center',
  },
});

export default HelpAiChatHistoryList;
