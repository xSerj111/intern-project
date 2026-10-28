import type { IConversationSummary } from '@repo/contracts';

/** Display name of a conversation: the group title or the other person's name. */
export function conversationTitle(
  chat: Pick<IConversationSummary, 'type' | 'title' | 'counterpart'>,
): string {
  if (chat.type === 'GROUP') {
    return chat.title ?? 'Group chat';
  }
  return chat.counterpart?.displayName ?? 'Conversation';
}

/** One-line preview of the latest message for the conversation list. */
export function previewText(
  chat: Pick<IConversationSummary, 'lastMessage'>,
  currentUserId?: string,
): string {
  const message = chat.lastMessage;
  if (!message) {
    return 'No messages yet';
  }
  if (message.deletedAt) {
    return 'Message deleted';
  }
  if (message.kind === 'SYSTEM') {
    return 'Group update';
  }
  const body =
    message.content ?? (message.attachments.length > 0 ? 'Attachment' : '');
  if (!body) {
    return '';
  }
  return message.authorId === currentUserId ? `You: ${body}` : body;
}
