import { useColorMode } from '@gluestack-ui/themed-native-base';
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import Buttons from 'src/components/Buttons';
import KeeperModal from 'src/components/KeeperModal';
import { hp, wp } from 'src/constants/responsive';
import useToastMessage from 'src/hooks/useToastMessage';
import {
  HelpChatMessage,
  HelpChatMetadata,
  HelpChatResponse,
  HelpEscalationCard,
} from 'src/models/interfaces/HelpAi';
import Relay from 'src/services/backend/Relay';
import { useQuery } from '@realm/react';
import { RealmSchema } from 'src/storage/realm/enum';
import { getJSONFromRealmObject } from 'src/storage/realm/utils';
import { KeeperApp } from 'src/models/interfaces/KeeperApp';
import HelpAiDraftCard from './components/HelpAiDraftCard';
import HelpAiShell from './components/HelpAiShell';
import PaperPlaneLight from 'src/assets/images/paper-plane-light.svg';
import PaperPlaneDark from 'src/assets/images/paper-plane-dark.svg';
import Colors from 'src/theme/Colors';
import { batch } from 'react-redux';
import { useAppDispatch, useAppSelector } from 'src/store/hooks';
import {
  appendHelpAiMessage,
  createHelpAiThread,
  incrementHelpAiIssueCount,
  setHelpAiChatMeta,
  setHelpAiDraft,
  setHelpAiDraftStatus,
  setHelpAiEscalationStage,
  setHelpAiRawMessages,
  type HelpAiDraftStatus,
  type HelpAiRenderMessage,
} from 'src/store/reducers/helpAi';
import { GREETINGS } from 'src/constants/ChatAiGreetings';
import {
  HELP_AI_ESCALATION_ADVISOR_ROUTE,
  HELP_AI_DISCLAIMER_STORAGE_KEY,
  HELP_AI_ESCALATION_DEV_EMAIL,
  HELP_AI_ESCALATION_DEV_EMAIL_BODY,
  HELP_AI_ESCALATION_DEV_EMAIL_SUBJECT,
  HELP_AI_ESCALATION_TELEGRAM_URL,
} from 'src/constants/helpAiEscalation';
import { LocalizationContext } from 'src/context/Localization/LocContext';
import { hasItem, setItem } from 'src/storage';
import AskKeeperShield from 'src/assets/images/ask_keeper_shield.svg';
import AskKeeperInfo from 'src/assets/images/ask_keeper_info.svg';
import AskKeeperLock from 'src/assets/images/ask_keeper_lock.svg';
import LockIcon from 'src/assets/images/lockLightGreen.svg';
import Fonts from 'src/constants/Fonts';
import { HELP_AI_ICON_MAP } from 'src/constants/helpAiIcons';
import { sanitizeHelpAiReplyLinks, sanitizeHelpAiSources } from 'src/utils/helpAiLinkPolicy';
import { detectSensitiveInput, detectSensitiveInDraft } from 'src/utils/helpAiSensitiveData';

// Enhanced error handler to distinguish between all backend rate limit codes
const getHelpAiFriendlyError = (error: any, scope: 'chat' | 'issue'): string => {
  const rawMessage = error?.message || error?.error || '';

  if (rawMessage.includes('HELP_AI_NEW_CHAT_LIMIT_REACHED')) {
    return 'You have reached your daily new chat creation limit. Please try again after 24 hours.';
  }
  if (rawMessage.includes('HELP_AI_DAILY_MESSAGE_LIMIT_REACHED')) {
    return 'You have reached your daily message limit for this chat. Please try again after 24 hours.';
  }
  if (rawMessage.includes('HELP_AI_ISSUE_LIMIT_REACHED')) {
    return 'You have reached your daily issue submission limit. Please try again after 24 hours.';
  }
  if (rawMessage.includes('HELP_AI_RATE_LIMIT_REACHED')) {
    return 'You have reached a rate limit. Please try again after 24 hours.';
  }
  if (rawMessage.includes('429')) {
    return scope === 'chat'
      ? 'Chat is temporarily rate-limited. Please try again shortly.'
      : 'Issue submission is temporarily rate-limited. Please try again shortly.';
  }
  return (
    rawMessage ||
    (scope === 'chat'
      ? 'Unable to send message. Please retry.'
      : 'Issue submission failed. Please retry.')
  );
};

const nowId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const LOCK_ICON_SIZE = hp(15);

const buildMetadata = async (): Promise<HelpChatMetadata> => {
  const appVersion = DeviceInfo.getVersion();
  const device = await DeviceInfo.getDeviceName();
  return {
    appVersion,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    device,
    currentScreen: 'HelpAiChat',
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
};

const HelpAiChat = ({ navigation, route }) => {
  const dispatch = useAppDispatch();
  const { id: appId } = useQuery(RealmSchema.KeeperApp).map(
    getJSONFromRealmObject
  )[0] as unknown as KeeperApp;
  const { colorMode } = useColorMode();
  const isDarkMode = colorMode === 'dark';
  const uiColors = useMemo(
    () => ({
      surface: isDarkMode ? '#1f1f1f' : '#ffffff',
      separator: isDarkMode ? '#3a3a3a' : '#d8d8d8',
      primaryText: isDarkMode ? Colors.bodyText : Colors.secondaryBlack,
      secondaryText: isDarkMode ? Colors.darkGrey : Colors.secondaryDarkGrey,
      buttonText: '#ffffff',
      link: isDarkMode ? Colors.mintGreen : Colors.primaryGreen,
      error: isDarkMode ? Colors.CrimsonRed : Colors.redAlert,
      userBubble: Colors.primaryGreen,
      aiBubble: isDarkMode ? Colors.SecondaryBlack : 'white',
      inputText: isDarkMode ? '#ffffff' : '#101010',
      placeholderText: isDarkMode ? '#9b9b9b' : '#8a8a8a',
    }),
    [isDarkMode]
  );
  const { translations } = useContext(LocalizationContext);
  const { askAi } = translations;
  const disclaimerPoints = [askAi.disclaimerPoint1, askAi.disclaimerPoint2, askAi.disclaimerPoint3];
  const { showToast } = useToastMessage();
  const listRef = useRef<FlatList<HelpAiRenderMessage>>(null);
  const generatedConversationId = useMemo(() => `conv_${Date.now().toString(36)}`, []);
  const conversationId = route?.params?.conversationId || generatedConversationId;
  const initialPrompt = route?.params?.prefillText || '';
  const persistedThread = useAppSelector((state) =>
    state.helpAi.threads.find((thread) => thread.conversationId === conversationId)
  );
  const greetings = useRef(GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);

  const defaultIntro: HelpAiRenderMessage = {
    id: 'help-ai-intro',
    type: 'ai',
    text: greetings.current,
    iconType: 'chat',
  };
  const messages = persistedThread?.messages?.length ? persistedThread.messages : [defaultIntro];
  const rawChatMessages = persistedThread?.rawMessages || [];
  const draft = persistedThread?.draft || null;
  const draftStatus: HelpAiDraftStatus = persistedThread?.draftStatus || 'pending_review';
  const lastEscalationStage = persistedThread?.lastEscalationStage || 'none';
  const chatMeta = persistedThread?.chatMeta || null;
  const issueCount = persistedThread?.issueCount || 1;

  const [input, setInput] = useState(initialPrompt);
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);

  useEffect(() => {
    dispatch(createHelpAiThread({ conversationId }));
  }, [conversationId, dispatch]);

  useEffect(() => {
    if (!hasItem(HELP_AI_DISCLAIMER_STORAGE_KEY)) {
      setShowDisclaimerModal(true);
    }
  }, []);

  const dismissDisclaimerModal = () => {
    setItem(HELP_AI_DISCLAIMER_STORAGE_KEY, true);
    setShowDisclaimerModal(false);
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  useEffect(() => {
    if (!messages.length) return undefined;
    // Small delay to let FlatList measure new content before scrolling
    const t = setTimeout(scrollToBottom, 150);
    return () => clearTimeout(t);
  }, [messages.length]);

  const appendMessage = (message: HelpAiRenderMessage) => {
    dispatch(appendHelpAiMessage({ conversationId, message }));
  };

  const handleEscalationCardAction = async (card: HelpEscalationCard) => {
    try {
      if (card.type === 'telegram') {
        await Linking.openURL(HELP_AI_ESCALATION_TELEGRAM_URL);
      } else if (card.type === 'advisor') {
        navigation.navigate(HELP_AI_ESCALATION_ADVISOR_ROUTE);
      } else if (card.type === 'developer_email') {
        const subject = encodeURIComponent(HELP_AI_ESCALATION_DEV_EMAIL_SUBJECT);
        const body = encodeURIComponent(HELP_AI_ESCALATION_DEV_EMAIL_BODY);
        await Linking.openURL(
          `mailto:${HELP_AI_ESCALATION_DEV_EMAIL}?subject=${subject}&body=${body}`
        );
      }
    } catch (error) {
      showToast('Unable to open this action right now');
    }
  };

  const sendToChat = async (text: string) => {
    if (!text.trim()) return;
    if (!appId) {
      showToast('Missing app id. Please restart the app and try again.');
      return;
    }
    const sensitiveResult = detectSensitiveInput(text.trim());
    if (sensitiveResult) {
      showToast(sensitiveResult.message);
      return;
    }

    const outboundText = text.trim();
    setInput('');
    setSending(true);
    setTyping(true);
    appendMessage({ id: nowId(), type: 'user', text: outboundText });

    try {
      const metadata = chatMeta || (await buildMetadata());
      if (!chatMeta) {
        dispatch(setHelpAiChatMeta({ conversationId, chatMeta: metadata }));
      }
      const nextHistory: HelpChatMessage[] = [
        ...rawChatMessages,
        { role: 'user' as const, text: outboundText, time: new Date().toISOString() },
      ].slice(-20);
      const response: HelpChatResponse = await Relay.helpChat({
        appId,
        conversationId,
        messages: nextHistory,
        userText: outboundText,
        metadata,
      });

      const sanitizedReply = sanitizeHelpAiReplyLinks(response.reply);
      const sanitizedSources = sanitizeHelpAiSources(response.sources);
      const aiMsg: HelpChatMessage = {
        role: 'ai',
        text: sanitizedReply,
        time: new Date().toISOString(),
      };
      const aiRenderMsg: HelpAiRenderMessage = {
        id: nowId(),
        type: 'ai',
        text: sanitizedReply,
        iconType: response.iconType,
        sources: sanitizedSources,
      };
      const escalationRenderMsg: HelpAiRenderMessage | null =
        response.escalationCard &&
        response.conversationState?.escalationStage !== lastEscalationStage
          ? { id: nowId(), type: 'escalation', card: response.escalationCard }
          : null;
      batch(() => {
        dispatch(
          setHelpAiRawMessages({ conversationId, messages: [...nextHistory, aiMsg].slice(-20) })
        );
        dispatch(appendHelpAiMessage({ conversationId, message: aiRenderMsg }));
        if (response.draft && (response.intent === 'bug' || response.intent === 'feature')) {
          dispatch(setHelpAiDraft({ conversationId, draft: response.draft }));
          dispatch(setHelpAiDraftStatus({ conversationId, draftStatus: 'pending_review' }));
        }
        if (escalationRenderMsg) {
          dispatch(
            setHelpAiEscalationStage({
              conversationId,
              escalationStage: response.conversationState.escalationStage,
            })
          );
          dispatch(appendHelpAiMessage({ conversationId, message: escalationRenderMsg }));
        }
      });
      setLastFailedText(null);
    } catch (error) {
      showToast(getHelpAiFriendlyError(error, 'chat'));
      setLastFailedText(outboundText);
    } finally {
      setSending(false);
      setTyping(false);
    }
  };

  const submitDraftIssue = async () => {
    if (!draft || !chatMeta) return;
    if (!appId) {
      showToast('Missing app id. Please restart the app and try again.');
      return;
    }

    const draftSensitiveResult = detectSensitiveInDraft(draft);
    if (draftSensitiveResult) {
      showToast(draftSensitiveResult.message);
      return;
    }

    try {
      dispatch(setHelpAiDraftStatus({ conversationId, draftStatus: 'submitting' }));
      const idempotencyKey = `issue-${conversationId}-${issueCount}`;
      const response = await Relay.submitHelpIssue({
        appId,
        conversationId,
        kind: draft.kind,
        confirm: true,
        idempotencyKey,
        draft,
        metadata: {
          appVersion: chatMeta.appVersion,
          platform: chatMeta.platform,
          device: chatMeta.device,
        },
      });

      dispatch(incrementHelpAiIssueCount({ conversationId }));
      dispatch(setHelpAiDraftStatus({ conversationId, draftStatus: 'submitted' }));
      appendMessage({
        id: nowId(),
        type: 'issue',
        issueUrl: response.issueUrl,
        issueNumber: response.issueNumber,
        text: response.thankYouMessage,
      });
      appendMessage({
        id: nowId(),
        type: 'ai',
        text: response.thankYouMessage,
        iconType: 'chat',
      });
    } catch (error) {
      dispatch(setHelpAiDraftStatus({ conversationId, draftStatus: 'failed_retryable' }));
      showToast(getHelpAiFriendlyError(error, 'issue'));
    }
  };

  const renderMessage = ({ item, index }: { item: HelpAiRenderMessage; index: number }) => {
    if (item.type === 'escalation') {
      return (
        <View
          style={[
            styles.card,
            {
              backgroundColor: uiColors.surface,
              borderColor: uiColors.separator,
            },
          ]}
        >
          <Text testID={`escalation_title_${index}`} style={[styles.textMedium, { color: uiColors.primaryText }]}>
            {item.card.title}
          </Text>
          <Text testID={`escalation_description_${index}`} style={[styles.textSmall, { color: uiColors.secondaryText, marginTop: hp(4) }]}>
            {item.card.description}
          </Text>
          <View style={styles.cardCtaCtr}>
            <Buttons
              primaryText={item.card.ctaLabel}
              primaryCallback={() => handleEscalationCardAction(item.card)}
              fullWidth
            />
          </View>
        </View>
      );
    }

    if (item.type === 'issue') {
      return (
        <View
          style={[
            styles.card,
            {
              backgroundColor: uiColors.surface,
              borderColor: uiColors.separator,
            },
          ]}
        >
          <Text testID={`issue_title_${index}`} style={[styles.textMedium, { color: uiColors.primaryText }]}>
            {`Issue #${item.issueNumber} created`}
          </Text>
          <Text testID={`issue_description_${index}`} style={[styles.textSmall, { color: uiColors.secondaryText, marginTop: hp(4) }]}>
            {item.text}
          </Text>
          <Pressable onPress={() => Linking.openURL(item.issueUrl)}>
            <Text
              testID={`issue_url_${index}`}
              style={[
                styles.textSmall,
                styles.linkText,
                { color: uiColors.link, marginTop: hp(4) },
              ]}
            >
              {item.issueUrl}
            </Text>
          </Pressable>
        </View>
      );
    }

    if (item.type === 'system_error') {
      return (
        <View style={styles.systemErrorCtr}>
          <Text testID={`system_error_${index}`} style={[styles.textSmall, { color: uiColors.error }]}>{item.text}</Text>
          {item.retryText ? (
            <Pressable onPress={() => sendToChat(item.retryText)}>
              <Text testID={`system_error_retry_${index}`} style={[styles.textSmall, styles.textMediumWeight, { color: uiColors.link }]}>
                Retry
              </Text>
            </Pressable>
          ) : null}
        </View>
      );
    }

    const isUser = item.type === 'user';
    const sources = item.type === 'ai' ? item.sources : undefined;
    const iconType = item.type === 'ai' ? item.iconType : undefined;
    const AvatarIcon = HELP_AI_ICON_MAP[iconType || 'chat'] || HELP_AI_ICON_MAP.chat;

    const bubble = (
      <View
        collapsable={false}
        style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.aiBubble,
          {
            backgroundColor: isUser ? uiColors.userBubble : uiColors.aiBubble,
            borderColor: isUser ? uiColors.userBubble : uiColors.separator,
          },
        ]}
      >
        <Text
          testID={`${item.type}_message_${index}`}
          style={{
            color: isUser ? uiColors.buttonText : uiColors.primaryText,
            fontSize: 15,
            lineHeight: 18,
          }}
        >
          {item.text}
        </Text>
        {sources?.length > 0 && (
          <View style={styles.sourcesCtr}>
            {sources.map((source, idx) => (
              <Pressable
                key={`${source.url}-${source.title}-${idx}`}
                onPress={() => Linking.openURL(source.url)}
              >
                <Text
                  testID={`source_${index}_${idx}`}
                  style={[styles.linkText, { fontSize: 11, lineHeight: 16, color: uiColors.link }]}
                >
                  {source.title}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );

    if (!isUser) {
      return (
        <View style={styles.aiBubbleRow}>
          <View style={styles.aiAvatar}>
            <AvatarIcon width={wp(18)} height={wp(18)} />
          </View>
          {bubble}
        </View>
      );
    }
    return bubble;
  };

  return (
    <HelpAiShell title={askAi.askKeeper} onInfoPress={() => setShowDisclaimerModal(true)}>
      <View style={styles.container}>
        <View style={styles.scrollArea}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => (
              <View testID={`message_${index}`} collapsable={false} style={styles.messageWrapper}>
                {renderMessage({ item, index })}
              </View>
            )}
            contentContainerStyle={styles.messagesContainer}
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={
              <>
                {typing && (
                  <View style={styles.typingCtr}>
                    <ActivityIndicator size="small" />
                    <Text style={[styles.textSmall, { color: uiColors.secondaryText }]}>
                      Keeper is typing...
                    </Text>
                  </View>
                )}
                {draft && draftStatus !== 'submitted' && (
                  <HelpAiDraftCard
                    draft={draft}
                    draftStatus={draftStatus}
                    onReview={() =>
                      dispatch(
                        setHelpAiDraftStatus({
                          conversationId,
                          draftStatus: 'confirming_public_submission',
                        })
                      )
                    }
                    onConfirm={submitDraftIssue}
                    onCancel={() =>
                      dispatch(
                        setHelpAiDraftStatus({ conversationId, draftStatus: 'pending_review' })
                      )
                    }
                    onRetry={submitDraftIssue}
                  />
                )}
              </>
            }
          />
        </View>

        <View style={styles.inputBar}>
          <View style={styles.warningCtr}>
            <View style={styles.warningIconBox}>
              <LockIcon height={LOCK_ICON_SIZE} width={LOCK_ICON_SIZE} />
            </View>
            <Text style={styles.warningText}>{askAi.neverShareSeedWarning}</Text>
          </View>
          <View style={styles.inputWrapper}>
            <TextInput
              testID="input_message"
              style={[
                styles.input,
                { color: uiColors.inputText, backgroundColor: uiColors.aiBubble },
              ]}
              value={input}
              onChangeText={setInput}
              placeholder={'Type your message'}
              placeholderTextColor={uiColors.placeholderText}
              editable={!sending}
              multiline
            />
            <Pressable
              testID="btn_send"
              style={[
                styles.sendBtn,
                {
                opacity: sending ? 0.6 : 1,
                backgroundColor: Colors.primaryGreen,
              },
              ]}
              onPress={() => sendToChat(input)}
              disabled={sending}
            >
              {isDarkMode ? (
                <PaperPlaneDark height={hp(15)} width={hp(15)} />
              ) : (
                <PaperPlaneLight height={hp(15)} width={hp(15)} />
              )}
            </Pressable>
          </View>
        </View>

        {lastFailedText ? (
          <Pressable style={styles.retryBar} onPress={() => sendToChat(lastFailedText)}>
            <Text style={[styles.textSmall, styles.textMediumWeight, { color: uiColors.link }]}>
              Retry last failed message
            </Text>
          </Pressable>
        ) : null}
      </View>
      <KeeperModal
        visible={showDisclaimerModal}
        close={dismissDisclaimerModal}
        title={askAi.disclaimerTitle}
        showCloseIcon={false}
        buttonText={askAi.disclaimerCta}
        buttonCallback={dismissDisclaimerModal}
        centerTitle
        Content={() => (
          <View>
            <View style={styles.disclaimerRow}>
              <AskKeeperShield width={hp(45)} height={hp(45)} />
              <Text style={[styles.disclaimerText, { color: uiColors.primaryText }]}>
                {disclaimerPoints[0]}
              </Text>
            </View>
            <View style={styles.disclaimerRow}>
              <AskKeeperInfo width={hp(45)} height={hp(45)} />
              <Text style={[styles.disclaimerText, { color: uiColors.primaryText }]}>
                {disclaimerPoints[1]}
              </Text>
            </View>
            <View style={styles.disclaimerRow}>
              <AskKeeperLock width={hp(45)} height={hp(45)} />
              <Text style={[styles.disclaimerText, { color: uiColors.primaryText }]}>
                {disclaimerPoints[2]}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                navigation.navigate('AskKeeperInfo');
                setShowDisclaimerModal(false);
              }}
              style={styles.learnMoreCtr}
            >
              <Text style={[styles.learnMoreText, { color: Colors.primaryGreen }]}>
                {askAi.disclaimerLearnMore}
              </Text>
              <Text style={[styles.learnMoreArrow, { color: Colors.primaryGreen }]}>›</Text>
            </Pressable>
          </View>
        )}
      />
    </HelpAiShell>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: wp(16),
    paddingBottom: hp(12),
  },
  messagesContainer: {
    paddingVertical: hp(14),
    gap: hp(5),
  },
  scrollArea: {
    flex: 1,
    minHeight: 0,
  },
  messageWrapper: {
    overflow: 'hidden',
  },
  inputBar: {
    paddingTop: hp(5),
  },
  input: {
    flex: 1,
    maxHeight: hp(100),
    minHeight: hp(42),
    fontSize: 13,
    lineHeight: 18,
    borderWidth: 1,
    borderColor: Colors.greyBorder,
    borderRadius: 20,
    paddingHorizontal: wp(12),
    ...Platform.select({
      ios: {
        paddingVertical: hp(12),
      },
      android: {
        textAlignVertical: 'center',
        paddingVertical: hp(8),
      },
    }),
  },
  sendBtn: {
    borderRadius: 100,
    height: hp(38),
    width: hp(38),
    alignItems: 'center',
    justifyContent: 'center',
  },
  typingCtr: {
    flexDirection: 'row',
    gap: wp(8),
    alignItems: 'center',
    marginBottom: hp(8),
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: wp(12),
    marginBottom: hp(8),
    overflow: 'hidden',
  },
  cardCtaCtr: {
    marginTop: hp(8),
  },
  bubble: {
    maxWidth: '86%',
    borderRadius: 16,
    paddingHorizontal: wp(12),
    paddingVertical: hp(10),
    marginBottom: hp(8),
    borderWidth: 1,
    overflow: 'hidden',
  },
  userBubble: {
    alignSelf: 'flex-end',
  },
  aiBubble: {
    alignSelf: 'flex-start',
  },
  sourcesCtr: {
    marginTop: hp(6),
  },
  linkText: {
    marginTop: hp(6),
    textDecorationLine: 'underline',
  },
  systemErrorCtr: {
    alignSelf: 'center',
    marginBottom: hp(8),
    alignItems: 'center',
    gap: hp(3),
  },
  retryBar: {
    alignSelf: 'center',
    marginTop: hp(8),
  },
  textSmall: {
    fontSize: 12,
    lineHeight: 17,
  },
  textMedium: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  textMediumWeight: {
    fontWeight: '500',
  },
  aiBubbleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: wp(6),
  },
  aiAvatar: {
    borderRadius: wp(50),
    backgroundColor: '#c6ddd1',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginBottom: hp(8),
    padding: 8,
  },
  disclaimerText: {
    fontSize: 14,
    lineHeight: 18,
    flex: 1,
  },
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(12),
    marginBottom: hp(18),
  },
  learnMoreCtr: {
    borderTopWidth: 1,
    borderTopColor: Colors.greyBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: wp(6),
    paddingTop: hp(12),
    marginTop: hp(2),
    marginBottom: hp(8),
  },
  learnMoreText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  learnMoreArrow: {
    fontSize: 24,
    lineHeight: 24,
  },
  warningCtr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: wp(6),
    alignSelf: 'center',
    marginBottom: hp(5),
  },
  warningIconBox: {
    width: LOCK_ICON_SIZE,
    height: LOCK_ICON_SIZE,
    overflow: 'hidden',
  },
  warningText: {
    paddingTop: hp(3),
    color: Colors.DarkSlateGray,
    fontFamily: Fonts.InterRegular,
    marginBottom: 4,
    fontSize: 14,
  },
  inputWrapper: {
    flexDirection: 'row',
    gap: wp(8),
    alignItems: 'flex-end',
    flexShrink: 0,
  },
});

export default HelpAiChat;
