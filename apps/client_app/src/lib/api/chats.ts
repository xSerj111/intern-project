import type {
  IAddMembersRequest,
  IAttachmentUrl,
  ICreateGroupChatRequest,
  IConversationDetail,
  IConversationSummary,
  ICursorPage,
  IEditMessageRequest,
  IListChatsQuery,
  IListMessagesQuery,
  IMarkReadRequest,
  IMessage,
  IMessageChangesQuery,
  IRenameGroupRequest,
  IReadState,
  ISendMessageRequest,
} from '@repo/contracts';

import { coreApi } from './client';

/** TanStack Query key factories for chat data. */
export const chatKeys = {
  all: ['chats'] as const,
  list: () => [...chatKeys.all, 'list'] as const,
  detail: (id: string) => [...chatKeys.all, 'detail', id] as const,
  messages: (id: string) => [...chatKeys.all, 'messages', id] as const,
};

interface Auth {
  token?: string | null;
  signal?: AbortSignal;
}

/** Open (or fetch the existing) direct chat (`POST /chats/direct`, 201 new / 200 existing). */
export function createDirectChat(
  userId: string,
  { token, signal }: Auth = {},
): Promise<IConversationDetail> {
  return coreApi<IConversationDetail>('/chats/direct', {
    method: 'POST',
    token,
    signal,
    body: { userId },
  });
}

/** List the caller's conversations (`GET /chats`), cursor = `before`. */
export function listChats(
  query: IListChatsQuery = {},
  { token, signal }: Auth = {},
): Promise<ICursorPage<IConversationSummary>> {
  return coreApi<ICursorPage<IConversationSummary>>('/chats', {
    token,
    signal,
    query: { ...query },
  });
}

/** Fetch one conversation with participants (`GET /chats/:chatId`). */
export function getChat(
  chatId: string,
  { token, signal }: Auth = {},
): Promise<IConversationDetail> {
  return coreApi<IConversationDetail>(`/chats/${chatId}`, { token, signal });
}

/** Message history, newest first, paged by `beforeSeq`. */
export function listMessages(
  chatId: string,
  query: IListMessagesQuery = {},
  { token, signal }: Auth = {},
): Promise<ICursorPage<IMessage>> {
  return coreApi<ICursorPage<IMessage>>(`/chats/${chatId}/messages`, {
    token,
    signal,
    query: { ...query },
  });
}

/** Catch-up of created/edited/deleted messages after `afterChangeSeq`. */
export function getMessageChanges(
  chatId: string,
  query: IMessageChangesQuery,
  { token, signal }: Auth = {},
): Promise<ICursorPage<IMessage>> {
  return coreApi<ICursorPage<IMessage>>(`/chats/${chatId}/messages/changes`, {
    token,
    signal,
    query: { ...query },
  });
}

/** Send a message (201 new / 200 idempotent replay by `clientMessageId`). */
export function sendMessage(
  chatId: string,
  body: ISendMessageRequest,
  { token, signal }: Auth = {},
): Promise<IMessage> {
  return coreApi<IMessage>(`/chats/${chatId}/messages`, {
    method: 'POST',
    token,
    signal,
    body,
  });
}

/** Edit the caller's own message (`PATCH /chats/:chatId/messages/:messageId`). */
export function editMessage(
  chatId: string,
  messageId: string,
  content: IEditMessageRequest['content'],
  { token, signal }: Auth = {},
): Promise<IMessage> {
  return coreApi<IMessage>(`/chats/${chatId}/messages/${messageId}`, {
    method: 'PATCH',
    token,
    signal,
    body: { content } satisfies IEditMessageRequest,
  });
}

/** Delete the caller's own message (`DELETE /chats/:chatId/messages/:messageId`, 204). */
export function deleteMessage(
  chatId: string,
  messageId: string,
  { token, signal }: Auth = {},
): Promise<void> {
  return coreApi<void>(`/chats/${chatId}/messages/${messageId}`, {
    method: 'DELETE',
    token,
    signal,
  });
}

/** Advance the caller's read pointer (`POST /chats/:chatId/read`). */
export function markRead(
  chatId: string,
  seq: IMarkReadRequest['seq'],
  { token, signal }: Auth = {},
): Promise<IReadState> {
  return coreApi<IReadState>(`/chats/${chatId}/read`, {
    method: 'POST',
    token,
    signal,
    body: { seq } satisfies IMarkReadRequest,
  });
}

/** Create a group (`POST /chats/groups`, 201): `memberIds` 2-99, excluding the caller. */
export function createGroupChat(
  body: ICreateGroupChatRequest,
  { token, signal }: Auth = {},
): Promise<IConversationDetail> {
  return coreApi<IConversationDetail>('/chats/groups', {
    method: 'POST',
    token,
    signal,
    body,
  });
}

/** Rename a group (`PATCH /chats/:chatId`, admin only). */
export function renameGroup(
  chatId: string,
  title: IRenameGroupRequest['title'],
  { token, signal }: Auth = {},
): Promise<IConversationDetail> {
  return coreApi<IConversationDetail>(`/chats/${chatId}`, {
    method: 'PATCH',
    token,
    signal,
    body: { title } satisfies IRenameGroupRequest,
  });
}

/** Add members (`POST /chats/:chatId/members`, admin only, group total <= 100). */
export function addMembers(
  chatId: string,
  userIds: IAddMembersRequest['userIds'],
  { token, signal }: Auth = {},
): Promise<IConversationDetail> {
  return coreApi<IConversationDetail>(`/chats/${chatId}/members`, {
    method: 'POST',
    token,
    signal,
    body: { userIds } satisfies IAddMembersRequest,
  });
}

/** Remove another member (`DELETE /chats/:chatId/members/:userId`, 204, admin only). */
export function removeMember(
  chatId: string,
  userId: string,
  { token, signal }: Auth = {},
): Promise<void> {
  return coreApi<void>(`/chats/${chatId}/members/${userId}`, {
    method: 'DELETE',
    token,
    signal,
  });
}

/** Make a member an admin (`POST /chats/:chatId/members/:userId/promote`, admin only). */
export function promoteMember(
  chatId: string,
  userId: string,
  { token, signal }: Auth = {},
): Promise<IConversationDetail> {
  return coreApi<IConversationDetail>(
    `/chats/${chatId}/members/${userId}/promote`,
    { method: 'POST', token, signal },
  );
}

/** Leave a group (`POST /chats/:chatId/leave`, 204). */
export function leaveChat(
  chatId: string,
  { token, signal }: Auth = {},
): Promise<void> {
  return coreApi<void>(`/chats/${chatId}/leave`, {
    method: 'POST',
    token,
    signal,
  });
}

/** Fresh presigned download URL for a message attachment (404 when not visible). */
export function getAttachmentUrl(
  chatId: string,
  messageId: string,
  assetId: string,
  { token, signal }: Auth = {},
): Promise<IAttachmentUrl> {
  return coreApi<IAttachmentUrl>(
    `/chats/${chatId}/messages/${messageId}/attachments/${assetId}`,
    { token, signal },
  );
}
