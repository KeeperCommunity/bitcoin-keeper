export type HelpChatMessage = {
  role: 'user' | 'ai';
  text: string;
  time?: string;
};

export type HelpChatMetadata = {
  appVersion: string;
  platform: 'ios' | 'android';
  device: string;
  currentScreen: string;
  walletType?: string;
  signerType?: string;
  locale?: string;
  timezone?: string;
};

export type ScreenshotAsset = {
  uri: string;
  mimeType: string;
};

export type HelpDraft = {
  kind: 'bug' | 'feature';
  title: string;
  steps?: string[];
  expected?: string;
  actual?: string;
  problem?: string;
  proposed?: string;
};

export type HelpEscalationCard = {
  type: 'telegram' | 'advisor' | 'developer_email';
  title: string;
  description: string;
  ctaLabel: string;
};

export type HelpChatResponse = {
  reply: string;
  intent: 'help' | 'bug' | 'feature';
  draft?: HelpDraft;
  draftReadyForConfirmation: boolean;
  sources?: Array<{ title: string; url: string }>;
  escalationCard?: HelpEscalationCard;
  conversationState?: {
    messageCount: number;
    dissatisfactionCount: number;
    escalationStage: 'none' | 'telegram_suggested' | 'advisor_suggested' | 'email_suggested';
  };
};

export type HelpIssueSubmitResponse = {
  issueUrl: string;
  issueNumber: number;
  thankYouMessage: string;
};