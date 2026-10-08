export const HELP_AI_NEAR_BOTTOM_DISTANCE = 80;

export const isNearChatBottom = (
  offsetY: number,
  viewportHeight: number,
  contentHeight: number
): boolean => contentHeight - offsetY - viewportHeight <= HELP_AI_NEAR_BOTTOM_DISTANCE;

export const findRetryableChatMessage = (
  messages: Array<{ id: string; type: string; text?: string }>,
  failedMessageId?: string | null
): { id: string; text: string } | undefined => {
  if (!failedMessageId) return undefined;
  const message = messages.find((item) => item.id === failedMessageId);
  return message?.type === 'user' && typeof message.text === 'string'
    ? { id: message.id, text: message.text }
    : undefined;
};

export const planChatSend = (input: string, retryMessage?: { text: string }) => ({
  outboundText: retryMessage ? retryMessage.text : input.trim(),
  appendUserMessage: !retryMessage,
});
