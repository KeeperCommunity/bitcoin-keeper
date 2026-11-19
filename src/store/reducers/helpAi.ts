import { PayloadAction, createSlice } from '@reduxjs/toolkit';
import { persistReducer } from 'redux-persist';
import {
  HelpChatMessage,
  HelpIconType,
  HelpChatMetadata,
  HelpDraft,
  HelpEscalationCard,
} from 'src/models/interfaces/HelpAi';
import { reduxStorage } from 'src/storage';

export type HelpAiDraftStatus =
  | 'pending_review'
  | 'confirming_public_submission'
  | 'submitting'
  | 'submitted'
  | 'failed_retryable';

export type HelpAiRenderMessage =
  | { id: string; type: 'user'; text: string }
  | {
      id: string;
      type: 'ai';
      text: string;
      iconType?: HelpIconType;
      sources?: Array<{ title: string; url: string }>;
    }
  | { id: string; type: 'escalation'; card: HelpEscalationCard }
  | { id: string; type: 'issue'; issueUrl: string; issueNumber: number; text: string }
  | { id: string; type: 'system_error'; text: string; retryText?: string };

export type HelpAiThread = {
  conversationId: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
  messages: HelpAiRenderMessage[];
  rawMessages: HelpChatMessage[];
  draft: HelpDraft | null;
  draftStatus: HelpAiDraftStatus;
  lastEscalationStage: string;
  chatMeta: HelpChatMetadata | null;
  issueCount: number;
};

type HelpAiState = {
  threads: HelpAiThread[];
  activeConversationId: string | null;
};

const DEFAULT_DRAFT_STATUS: HelpAiDraftStatus = 'pending_review';

const initialState: HelpAiState = {
  threads: [],
  activeConversationId: null,
};

const getMessagePreview = (message: HelpAiRenderMessage): string => {
  if (message.type === 'escalation') return message.card.title;
  if (message.type === 'issue') return message.text;
  return message.text;
};

const makeThread = (conversationId: string): HelpAiThread => ({
  conversationId,
  title: 'New chat',
  lastMessage: '',
  updatedAt: new Date().toISOString(),
  messages: [],
  rawMessages: [],
  draft: null,
  draftStatus: DEFAULT_DRAFT_STATUS,
  lastEscalationStage: 'none',
  chatMeta: null,
  issueCount: 1,
});

const findOrCreateThread = (state: HelpAiState, conversationId: string) => {
  let thread = state.threads.find((item) => item.conversationId === conversationId);
  if (!thread) {
    thread = makeThread(conversationId);
    state.threads.unshift(thread);
  }
  return thread;
};

const helpAiSlice = createSlice({
  name: 'helpAi',
  initialState,
  reducers: {
    createHelpAiThread: (state, action: PayloadAction<{ conversationId: string }>) => {
      findOrCreateThread(state, action.payload.conversationId);
      state.activeConversationId = action.payload.conversationId;
    },
    setHelpAiActiveConversation: (state, action: PayloadAction<string | null>) => {
      state.activeConversationId = action.payload;
    },
    appendHelpAiMessage: (
      state,
      action: PayloadAction<{ conversationId: string; message: HelpAiRenderMessage }>
    ) => {
      const thread = findOrCreateThread(state, action.payload.conversationId);
      thread.messages.push(action.payload.message);
      thread.lastMessage = getMessagePreview(action.payload.message);
      thread.updatedAt = new Date().toISOString();

      if (
        thread.title === 'New chat' &&
        action.payload.message.type === 'user' &&
        action.payload.message.text.trim()
      ) {
        thread.title = action.payload.message.text.trim().slice(0, 60);
      }

      state.threads = state.threads
        .slice()
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    },
    setHelpAiRawMessages: (
      state,
      action: PayloadAction<{ conversationId: string; messages: HelpChatMessage[] }>
    ) => {
      const thread = findOrCreateThread(state, action.payload.conversationId);
      thread.rawMessages = action.payload.messages;
      thread.updatedAt = new Date().toISOString();
    },
    setHelpAiDraft: (
      state,
      action: PayloadAction<{ conversationId: string; draft: HelpDraft | null }>
    ) => {
      const thread = findOrCreateThread(state, action.payload.conversationId);
      thread.draft = action.payload.draft;
      thread.updatedAt = new Date().toISOString();
    },
    setHelpAiDraftStatus: (
      state,
      action: PayloadAction<{ conversationId: string; draftStatus: HelpAiDraftStatus }>
    ) => {
      const thread = findOrCreateThread(state, action.payload.conversationId);
      thread.draftStatus = action.payload.draftStatus;
      thread.updatedAt = new Date().toISOString();
    },
    setHelpAiEscalationStage: (
      state,
      action: PayloadAction<{ conversationId: string; escalationStage: string }>
    ) => {
      const thread = findOrCreateThread(state, action.payload.conversationId);
      thread.lastEscalationStage = action.payload.escalationStage;
      thread.updatedAt = new Date().toISOString();
    },
    setHelpAiChatMeta: (
      state,
      action: PayloadAction<{ conversationId: string; chatMeta: HelpChatMetadata | null }>
    ) => {
      const thread = findOrCreateThread(state, action.payload.conversationId);
      thread.chatMeta = action.payload.chatMeta;
    },
    incrementHelpAiIssueCount: (state, action: PayloadAction<{ conversationId: string }>) => {
      const thread = findOrCreateThread(state, action.payload.conversationId);
      thread.issueCount += 1;
      thread.updatedAt = new Date().toISOString();
    },
  },
});

export const {
  createHelpAiThread,
  setHelpAiActiveConversation,
  appendHelpAiMessage,
  setHelpAiRawMessages,
  setHelpAiDraft,
  setHelpAiDraftStatus,
  setHelpAiEscalationStage,
  setHelpAiChatMeta,
  incrementHelpAiIssueCount,
} = helpAiSlice.actions;

const helpAiPersistConfig = {
  key: 'helpAi',
  storage: reduxStorage,
  whitelist: ['threads', 'activeConversationId'],
};

export default persistReducer(helpAiPersistConfig, helpAiSlice.reducer);