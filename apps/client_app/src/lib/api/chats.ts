import type {
  IConversationDetail,
  IConversationSummary,
  ICursorPage,
  IListChatsQuery,
  IListMessagesQuery,
  IMarkReadRequest,
  IMessage,
  IMessageChangesQuery,
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
