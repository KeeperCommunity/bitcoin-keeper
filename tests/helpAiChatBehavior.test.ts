import {
  canSendChatMessage,
  findRetryableChatMessage,
  isNearChatBottom,
  planChatSend,
  removeFailedChatMessage,
} from '../src/utils/helpAiChatBehavior';

test('new content follows only while the reader is near the bottom', () => {
  expect(isNearChatBottom(200, 400, 680)).toBe(true);
  expect(isNearChatBottom(199, 400, 680)).toBe(false);
  expect(isNearChatBottom(0, 400, 200)).toBe(true);
});

test('a fresh send adds one user message with trimmed text', () => {
  expect(planChatSend('  How do I reconnect?  ')).toEqual({
    outboundText: 'How do I reconnect?',
    appendUserMessage: true,
  });
});

test('retry resends the failed message without adding a second user bubble', () => {
  const threadAfterReturn: {
    failedMessageId: string;
    messages: Array<{ id: string; type: string; text: string }>;
  } = JSON.parse(
    JSON.stringify({
      failedMessageId: 'failed-1',
      messages: [
        { id: 'failed-1', type: 'user', text: 'Original failed message' },
        { id: 'ai-1', type: 'ai', text: 'Earlier answer' },
      ],
    })
  );
  const failedMessage = findRetryableChatMessage(
    threadAfterReturn.messages,
    threadAfterReturn.failedMessageId
  );
  expect(failedMessage).toEqual({ id: 'failed-1', text: 'Original failed message' });
  expect(planChatSend('draft typed after failure', failedMessage)).toEqual({
    outboundText: 'Original failed message',
    appendUserMessage: false,
  });
  expect(findRetryableChatMessage(threadAfterReturn.messages, 'ai-1')).toBeUndefined();
});

test('a failed bubble must be retried or discarded before sending a different message', () => {
  const messages = [
    { id: 'question-1', type: 'user', text: 'First question' },
    { id: 'reply-1', type: 'ai', text: 'First answer' },
    { id: 'failed-1', type: 'user', text: 'Unsent question' },
  ];

  expect(canSendChatMessage('failed-1')).toBe(false);
  expect(canSendChatMessage('failed-1', 'failed-1')).toBe(true);
  expect(canSendChatMessage('failed-1', 'question-1')).toBe(false);

  const afterDiscard = removeFailedChatMessage(messages, 'failed-1');
  expect(afterDiscard.map((message) => message.id)).toEqual(['question-1', 'reply-1']);
  expect(canSendChatMessage(null)).toBe(true);
});
