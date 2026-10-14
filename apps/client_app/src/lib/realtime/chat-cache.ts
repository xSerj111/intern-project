import type {
  IAttachment,
  IConversationDetail,
  IConversationSummary,
  ICursorPage,
  IMessage,
  IReadState,
} from '@repo/contracts';
import {
  queryOptions,
  useQuery,
  type QueryClient,
} from '@tanstack/react-query';

import {
  chatKeys,
  getMessageChanges,
  listChats,
  listMessages,
} from '../api/chats';
import { useAuth } from '../auth/auth-context';
import { getAccessToken } from '../auth/refresh';
import type { RealtimeSocket } from './realtime-provider';

/*
 * Chat data in the TanStack Query cache, kept live by socket events and made
 * whole again after a reconnect by HTTP catch-up (research.md §5, FR-006).
 *
 * - `chatKeys.list()`       -> ConversationListData (newest activity first)
 * - `chatKeys.messages(id)` -> ChatMessagesData (ascending `seq`, pending last)
 * - `chatKeys.detail(id)`   -> IConversationDetail (summary fields patched live)
 *
 * Messages are upserted on `message.id` (a server echo also replaces the pending
 * item with the same `clientMessageId`), so an event that arrives both live and
 * through catch-up is applied once. Each loaded chat keeps `cursor`, the highest
 * `changeSeq` applied; it only moves forward.
 */

/** Client-side delivery state of an optimistic message; `undefined` = stored on the server. */
export type MessageDelivery = 'sending' | 'failed';

export type ChatMessage = IMessage & { delivery?: MessageDelivery };

export interface ChatMessagesData {
  /** Loaded window, ascending `seq`; pending (unsent) messages sort last. */
  items: ChatMessage[];
  /** True while older messages exist before the loaded window. */
  hasMore: boolean;
  /** Highest `changeSeq` applied to this chat (catch-up cursor). */
  cursor: number;
}

export interface ConversationListData {
  /** Loaded conversations, newest `lastActivityAt` first. */
  items: IConversationSummary[];
  /** True while older conversations exist beyond the loaded ones. */
  hasMore: boolean;
}

/** Passed to every handler; `userId` is the signed-in user's auth id (JWT `sub`). */
export interface ChatCacheContext {
  userId: string;
}

/** What `applyNewMessageToConversations` knows about a just-applied `message:new`. */
export interface NewMessageContext extends ChatCacheContext {
  /**
   * True when the message id was new to the chat's message cache, false when it
   * was already there (live + catch-up replay, or own send echo), `null` when
   * that chat's messages are not loaded.
   */
  insertedIntoMessages: boolean | null;
}

const CATCH_UP_PAGE_SIZE = 200;
/** Above this many change pages, reloading the latest page is cheaper than replaying. */
const MAX_CATCH_UP_PAGES = 10;
const PENDING_ID_PREFIX = 'pending:';

const messagesRootKey = [...chatKeys.all, 'messages'] as const;
const detailRootKey = [...chatKeys.all, 'detail'] as const;

// ---------------------------------------------------------------------------
// Per-QueryClient bookkeeping
// ---------------------------------------------------------------------------

interface ChatCacheState {
  /** Serialized catch-up per chat, so two runs never page the same range at once. */
  catchUps: Map<string, Promise<void>>;
  /** Chats that got a live event while their first page was still loading. */
  missedWhileLoading: Set<string>;
}

const states = new WeakMap<QueryClient, ChatCacheState>();

function stateOf(client: QueryClient): ChatCacheState {
  let state = states.get(client);
  if (!state) {
    state = { catchUps: new Map(), missedWhileLoading: new Set() };
    states.set(client, state);
  }
  return state;
}

function auth(signal?: AbortSignal) {
  return { token: getAccessToken(), signal };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function isPendingMessage(message: ChatMessage): boolean {
  return message.delivery !== undefined;
}

function compareMessages(a: ChatMessage, b: ChatMessage): number {
  const aPending = isPendingMessage(a);
  const bPending = isPendingMessage(b);
  if (aPending !== bPending) {
    return aPending ? 1 : -1;
  }
  if (aPending) {
    return a.createdAt.localeCompare(b.createdAt);
  }
  return a.seq - b.seq;
}

function maxChangeSeq(messages: readonly IMessage[], floor = 0): number {
  return messages.reduce((max, m) => Math.max(max, m.changeSeq), floor);
}

/** Lowest `seq` of the stored (non-pending) messages, or `null` when there are none. */
function windowStart(items: readonly ChatMessage[]): number | null {
  const stored = items.find((m) => !isPendingMessage(m));
  return stored ? stored.seq : null;
}

interface MergeResult {
  items: ChatMessage[];
  /** Ids that were not in `items` before. */
  inserted: Set<string>;
}

/**
 * Upsert `incoming` into `items` by `message.id` (or replace the pending item with
 * the same author + `clientMessageId`), keeping the newer `changeSeq` on a tie-in.
 * With `clipToWindow`, messages older than the loaded window are skipped while
 * older history exists: they are loaded fresh when the user scrolls up.
 */
function mergeMessages(
  data: ChatMessagesData,
  incoming: readonly IMessage[],
  clipToWindow: boolean,
): MergeResult {
  const items = [...data.items];
  const inserted = new Set<string>();
  const start = windowStart(items);

  for (const message of incoming) {
    if (clipToWindow && data.hasMore && start !== null && message.seq < start) {
      continue;
    }
    const byId = items.findIndex((m) => m.id === message.id);
    if (byId >= 0) {
      if (items[byId].changeSeq <= message.changeSeq) {
        items[byId] = message;
      }
      continue;
    }
    const pending =
      message.clientMessageId === null
        ? -1
        : items.findIndex(
            (m) =>
              isPendingMessage(m) &&
              m.clientMessageId === message.clientMessageId &&
              m.authorId === message.authorId,
          );
    if (pending >= 0) {
      items[pending] = message;
    } else {
      items.push(message);
    }
    inserted.add(message.id);
  }

  items.sort(compareMessages);
  return { items, inserted };
}

function fromLatestPage(page: ICursorPage<IMessage>): ChatMessagesData {
  return {
    items: [...page.items].sort(compareMessages),
    hasMore: page.hasMore,
    cursor: maxChangeSeq(page.items),
  };
}

/** Newest activity first; ties broken by id so the order is stable. */
export function sortConversations(
  items: readonly IConversationSummary[],
): IConversationSummary[] {
  return [...items].sort(
    (a, b) =>
      b.lastActivityAt.localeCompare(a.lastActivityAt) ||
      a.id.localeCompare(b.id),
  );
}

/** Pick the fresher of two snapshots of one conversation (fresh wins a tie). */
function fresherSummary(
  current: IConversationSummary,
  fresh: IConversationSummary,
): IConversationSummary {
  return current.lastChangeSeq > fresh.lastChangeSeq ? current : fresh;
}

/**
 * Merge a page of `GET /chats` into the list. A first page (`isFirstPage`) also
 * drops loaded items that fall inside its range but are missing from it (the user
 * lost access while offline); when it has no more pages it is the whole list.
 */
function mergeConversationPage(
  existing: ConversationListData | undefined,
  page: ICursorPage<IConversationSummary>,
  isFirstPage: boolean,
): ConversationListData {
  if (!existing || (isFirstPage && !page.hasMore)) {
    return { items: sortConversations(page.items), hasMore: page.hasMore };
  }

  const byId = new Map(page.items.map((c) => [c.id, c]));
  const oldestInPage = page.items.at(-1)?.lastActivityAt;
  const kept: IConversationSummary[] = [];
  let keptBeyondPage = false;

  for (const item of existing.items) {
    const fresh = byId.get(item.id);
    if (fresh) {
      byId.set(item.id, fresherSummary(item, fresh));
      continue;
    }
    const insidePageRange =
      oldestInPage !== undefined && item.lastActivityAt >= oldestInPage;
    if (isFirstPage && insidePageRange) {
      continue;
    }
    kept.push(item);
    keptBeyondPage = true;
  }

  return {
    items: sortConversations([...kept, ...byId.values()]),
    hasMore: isFirstPage
      ? keptBeyondPage
        ? existing.hasMore
        : page.hasMore
      : page.hasMore,
  };
}

/** Summary after `message` arrived: preview, activity and change cursor move forward only. */
function withNewMessage(
  summary: IConversationSummary,
  message: IMessage,
): IConversationSummary {
  const isNewest = message.seq > (summary.lastMessage?.seq ?? -1);
  return {
    ...summary,
    lastMessage: isNewest ? message : summary.lastMessage,
    lastActivityAt:
      isNewest && message.createdAt > summary.lastActivityAt
        ? message.createdAt
        : summary.lastActivityAt,
    lastChangeSeq: Math.max(summary.lastChangeSeq, message.changeSeq),
  };
}

// ---------------------------------------------------------------------------
// Cache writers
// ---------------------------------------------------------------------------

/**
 * Patch one conversation in the list and in its detail cache (no-op where absent).
 * The list is not re-sorted here; callers that move activity sort themselves.
 */
function patchConversation(
  client: QueryClient,
  chatId: string,
  patch: (summary: IConversationSummary) => IConversationSummary,
): void {
  client.setQueryData<ConversationListData>(chatKeys.list(), (list) =>
    list
      ? {
          ...list,
          items: list.items.map((c) => (c.id === chatId ? patch(c) : c)),
        }
      : list,
  );
  client.setQueryData<IConversationDetail>(chatKeys.detail(chatId), (detail) =>
    detail ? { ...detail, ...patch(detail) } : detail,
  );
}

/**
 * Upsert messages into a loaded chat and advance its cursor to `cursorTo`
 * (defaults to the highest `changeSeq` among `messages`). Returns the inserted
 * ids, or `null` when the chat's messages are not loaded.
 */
function applyMessages(
  client: QueryClient,
  chatId: string,
  messages: readonly IMessage[],
  cursorTo = maxChangeSeq(messages),
): Set<string> | null {
  const key = chatKeys.messages(chatId);
  const data = client.getQueryData<ChatMessagesData>(key);
  if (!data) {
    if (client.getQueryState(key)?.fetchStatus === 'fetching') {
      stateOf(client).missedWhileLoading.add(chatId);
    }
    return null;
  }
  const { items, inserted } = mergeMessages(data, messages, true);
  client.setQueryData<ChatMessagesData>(key, {
    ...data,
    items,
    cursor: Math.max(data.cursor, cursorTo),
  });
  return inserted;
}

/** True while a page observes the chat's messages (the user is looking at it). */
function isChatOpen(client: QueryClient, chatId: string): boolean {
  const query = client
    .getQueryCache()
    .find({ queryKey: chatKeys.messages(chatId), exact: true });
  return (query?.getObserversCount() ?? 0) > 0;
}

/**
 * Conversation-list side of a new message: preview, activity time and
 * `lastChangeSeq` advance, `unreadCount` goes up by one, and the list is
 * re-sorted so the chat moves to the top.
 *
 * The unread bump needs a message that is new to the chat (`insertedIntoMessages`;
 * when that chat's messages are not loaded, a `seq` past the previous
 * `lastMessage`), written by someone else, in a chat that isn't open. That keeps
 * catch-up replays, own send echoes and the `chat:alert` toast from adding to it.
 */
export function applyNewMessageToConversations(
  client: QueryClient,
  message: IMessage,
  ctx: NewMessageContext,
): void {
  const chatOpen = isChatOpen(client, message.chatId);
  patchConversation(client, message.chatId, (summary) => {
    const next = withNewMessage(summary, message);
    const isNew =
      ctx.insertedIntoMessages ??
      message.seq > (summary.lastMessage?.seq ?? -1);
    if (!isNew || chatOpen || message.authorId === ctx.userId) {
      return next;
    }
    return { ...next, unreadCount: summary.unreadCount + 1 };
  });
  client.setQueryData<ConversationListData>(chatKeys.list(), (list) =>
    list ? { ...list, items: sortConversations(list.items) } : list,
  );
}

function applyNewMessage(
  client: QueryClient,
  message: IMessage,
  ctx: ChatCacheContext,
): void {
  const inserted = applyMessages(client, message.chatId, [message]);
  applyNewMessageToConversations(client, message, {
    ...ctx,
    insertedIntoMessages: inserted ? inserted.has(message.id) : null,
  });
}

// ---------------------------------------------------------------------------
// Socket event handlers
// ---------------------------------------------------------------------------

/** `message:new`: upsert into the chat (if loaded) and update its list entry. */
export function handleMessageNew(
  client: QueryClient,
  { message }: { message: IMessage },
  ctx: ChatCacheContext,
): void {
  applyNewMessage(client, message, ctx);
}

/** The tombstone a deleted message turns into (no text, no attachments). */
function toTombstone(
  message: ChatMessage,
  changeSeq: number,
  deletedAt?: string,
): ChatMessage {
  return {
    ...message,
    content: null,
    attachments: [],
    deletedAt: message.deletedAt ?? deletedAt ?? new Date().toISOString(),
    changeSeq,
  };
}

/**
 * Keep the list entry's preview in step with an edited or deleted message: only
 * when it is the preview, and only with a newer `changeSeq` than the preview's.
 */
function refreshPreview(
  client: QueryClient,
  chatId: string,
  messageId: string,
  changeSeq: number,
  update: (message: IMessage) => IMessage,
): void {
  patchConversation(client, chatId, (summary) => {
    const last = summary.lastMessage;
    if (!last || last.id !== messageId || last.changeSeq >= changeSeq) {
      return summary;
    }
    return {
      ...summary,
      lastMessage: update(last),
      lastChangeSeq: Math.max(summary.lastChangeSeq, changeSeq),
    };
  });
}

/** `message:updated` (an edit): upsert by id; an older `changeSeq` never overwrites. */
export function handleMessageUpdated(
  client: QueryClient,
  { message }: { message: IMessage },
): void {
  applyMessages(client, message.chatId, [message]);
  refreshPreview(
    client,
    message.chatId,
    message.id,
    message.changeSeq,
    () => message,
  );
}

/**
 * `message:deleted`: turn the message into a tombstone (when `changeSeq` is newer
 * than the cached one) and move the chat's cursor to `changeSeq`.
 */
export function handleMessageDeleted(
  client: QueryClient,
  {
    chatId,
    messageId,
    changeSeq,
    deletedAt,
  }: {
    chatId: string;
    messageId: string;
    changeSeq: number;
    deletedAt?: string;
  },
): void {
  const key = chatKeys.messages(chatId);
  const data = client.getQueryData<ChatMessagesData>(key);
  if (data) {
    client.setQueryData<ChatMessagesData>(key, {
      ...data,
      items: data.items.map((m) =>
        m.id === messageId && m.changeSeq < changeSeq
          ? toTombstone(m, changeSeq, deletedAt)
          : m,
      ),
      cursor: Math.max(data.cursor, changeSeq),
    });
  } else if (client.getQueryState(key)?.fetchStatus === 'fetching') {
    stateOf(client).missedWhileLoading.add(chatId);
  }
  refreshPreview(client, chatId, messageId, changeSeq, (m) =>
    toTombstone(m, changeSeq, deletedAt),
  );
}

/** Apply the server's response to an edit right away (the `message:updated` echo is then a no-op). */
export function applyEditedMessage(
  client: QueryClient,
  message: IMessage,
): void {
  handleMessageUpdated(client, { message });
}

/** `chat:upsert`: insert or refresh the list entry; participants may have changed. */
export function handleChatUpsert(
  client: QueryClient,
  { conversation }: { conversation: IConversationSummary },
): void {
  client.setQueryData<ConversationListData>(chatKeys.list(), (list) => {
    if (!list) {
      return list;
    }
    const current = list.items.find((c) => c.id === conversation.id);
    const next = current ? fresherSummary(current, conversation) : conversation;
    return {
      ...list,
      items: sortConversations([
        ...list.items.filter((c) => c.id !== conversation.id),
        next,
      ]),
    };
  });
  const detailKey = chatKeys.detail(conversation.id);
  client.setQueryData<IConversationDetail>(detailKey, (detail) =>
    detail ? { ...detail, ...conversation } : detail,
  );
  void client.invalidateQueries({ queryKey: detailKey, exact: true });
}

/**
 * `chat:removed`: the user lost access (removed, or left). Drops the chat from the
 * list and from the detail and messages caches. A page that still observes the chat
 * refetches it, gets the 404 a non-participant sees, and shows its not-found state.
 */
export function handleChatRemoved(
  client: QueryClient,
  { chatId }: { chatId: string; reason: 'removed' | 'left' },
): void {
  client.setQueryData<ConversationListData>(chatKeys.list(), (list) =>
    list ? { ...list, items: list.items.filter((c) => c.id !== chatId) } : list,
  );
  stateOf(client).missedWhileLoading.delete(chatId);
  for (const key of [chatKeys.detail(chatId), chatKeys.messages(chatId)]) {
    void client.cancelQueries({ queryKey: key, exact: true });
    client.removeQueries({ queryKey: key, exact: true, type: 'inactive' });
    // Observed queries stay until their page unmounts; refetching yields the 404.
    void client.invalidateQueries({ queryKey: key, exact: true });
  }
}

/** `chat:read`: the read pointer moved in some session; take its unread count. */
export function handleChatRead(client: QueryClient, state: IReadState): void {
  patchConversation(client, state.chatId, (summary) => ({
    ...summary,
    unreadCount: state.unreadCount,
  }));
}

// ---------------------------------------------------------------------------
// Catch-up
// ---------------------------------------------------------------------------

async function runCatchUp(
  client: QueryClient,
  chatId: string,
  from?: number,
): Promise<void> {
  const key = chatKeys.messages(chatId);
  const data = client.getQueryData<ChatMessagesData>(key);
  if (!data) {
    return;
  }

  let after = Math.min(from ?? data.cursor, data.cursor);
  for (let page = 0; page < MAX_CATCH_UP_PAGES; page += 1) {
    const res = await getMessageChanges(
      chatId,
      { afterChangeSeq: after, limit: CATCH_UP_PAGE_SIZE },
      auth(),
    );
    if (res.items.length === 0) {
      return;
    }
    const pageMax = maxChangeSeq(res.items, after);
    applyMessages(client, chatId, res.items, pageMax);
    // Stop on the last page, or if the server did not move the cursor (no loop).
    if (!res.hasMore || pageMax <= after) {
      return;
    }
    after = pageMax;
  }

  // Too far behind: replace the window with the latest page instead.
  const latest = fromLatestPage(await listMessages(chatId, {}, auth()));
  client.setQueryData<ChatMessagesData>(key, (current) => {
    const kept = current?.items ?? [];
    // Keep live events applied while the page loaded, and unsent messages.
    const { items } = mergeMessages(
      latest,
      kept.filter((m) => !isPendingMessage(m)),
      true,
    );
    return {
      ...latest,
      items: [...items, ...kept.filter(isPendingMessage)].sort(compareMessages),
    };
  });
}

/**
 * Page `GET /chats/:id/messages/changes` from the chat's cursor (or `from`, when
 * lower) until `hasMore` is false. Runs per chat are serialized. No-op when the
 * chat's messages are not loaded.
 */
export function catchUpChat(
  client: QueryClient,
  chatId: string,
  from?: number,
): Promise<void> {
  const { catchUps } = stateOf(client);
  const previous = catchUps.get(chatId) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(() => runCatchUp(client, chatId, from));
  catchUps.set(chatId, run);
  void run
    .catch(() => undefined)
    .finally(() => {
      if (catchUps.get(chatId) === run) {
        catchUps.delete(chatId);
      }
    });
  return run;
}

/**
 * Reconnect catch-up (research.md §5): refetch `GET /chats`, then catch up every
 * loaded chat whose `lastChangeSeq` is ahead of its cursor. Loaded chats missing
 * from the refetched page (or all of them, if it failed) catch up unconditionally;
 * an empty change page costs one request. Cursors are read before any await, so
 * live events arriving meanwhile can't hide a gap.
 */
export async function catchUpAllChats(client: QueryClient): Promise<void> {
  const cursors = new Map<string, number>();
  for (const [key, data] of client.getQueriesData<ChatMessagesData>({
    queryKey: messagesRootKey,
  })) {
    const chatId = key[2];
    if (data && typeof chatId === 'string') {
      cursors.set(chatId, data.cursor);
    }
  }
  const hasList = client.getQueryData(chatKeys.list()) !== undefined;
  if (!hasList && cursors.size === 0) {
    return;
  }

  let fresh: Map<string, IConversationSummary> | null = null;
  try {
    const page = await listChats({}, auth());
    fresh = new Map(page.items.map((c) => [c.id, c]));
    if (hasList) {
      client.setQueryData<ConversationListData>(chatKeys.list(), (list) =>
        mergeConversationPage(list, page, true),
      );
    }
  } catch {
    // Catch up every loaded chat below; the list query retries on its own.
  }
  void client.invalidateQueries({ queryKey: detailRootKey });

  await Promise.allSettled(
    [...cursors].map(([chatId, cursor]) => {
      const summary = fresh?.get(chatId);
      if (summary && summary.lastChangeSeq <= cursor) {
        return Promise.resolve();
      }
      return catchUpChat(client, chatId, cursor);
    }),
  );
}

// ---------------------------------------------------------------------------
// Registration (called by RealtimeProvider)
// ---------------------------------------------------------------------------

/**
 * Attach the chat-cache handlers to `socket`. Every `connect` (the first one
 * included: data fetched before it may have missed events) runs a catch-up.
 * Returns a function that detaches them.
 */
export function registerChatCacheHandlers(
  socket: RealtimeSocket,
  client: QueryClient,
  ctx: ChatCacheContext,
): () => void {
  const onMessageNew = (payload: { message: IMessage }) =>
    handleMessageNew(client, payload, ctx);
  const onMessageUpdated = (payload: { message: IMessage }) =>
    handleMessageUpdated(client, payload);
  const onMessageDeleted = (payload: {
    chatId: string;
    messageId: string;
    changeSeq: number;
    deletedAt: string;
  }) => handleMessageDeleted(client, payload);
  const onChatUpsert = (payload: { conversation: IConversationSummary }) =>
    handleChatUpsert(client, payload);
  const onChatRead = (state: IReadState) => handleChatRead(client, state);
  const onChatRemoved = (payload: {
    chatId: string;
    reason: 'removed' | 'left';
  }) => handleChatRemoved(client, payload);
  const onConnect = () => {
    void catchUpAllChats(client).catch(() => undefined);
  };

  socket.on('message:new', onMessageNew);
  socket.on('message:updated', onMessageUpdated);
  socket.on('message:deleted', onMessageDeleted);
  socket.on('chat:upsert', onChatUpsert);
  socket.on('chat:read', onChatRead);
  socket.on('chat:removed', onChatRemoved);
  socket.on('connect', onConnect);

  return () => {
    socket.off('message:new', onMessageNew);
    socket.off('message:updated', onMessageUpdated);
    socket.off('message:deleted', onMessageDeleted);
    socket.off('chat:upsert', onChatUpsert);
    socket.off('chat:read', onChatRead);
    socket.off('chat:removed', onChatRemoved);
    socket.off('connect', onConnect);
  };
}

// ---------------------------------------------------------------------------
// Queries and commands for the chat pages
// ---------------------------------------------------------------------------

/** Query options for the conversation list (first page, merged with loaded pages). */
export function conversationListQueryOptions() {
  return queryOptions({
    queryKey: chatKeys.list(),
    queryFn: async ({ client, signal }): Promise<ConversationListData> => {
      const page = await listChats({}, auth(signal));
      return mergeConversationPage(
        client.getQueryData<ConversationListData>(chatKeys.list()),
        page,
        true,
      );
    },
  });
}

/** Load the next (older) page of conversations into the list. */
export async function loadMoreConversations(
  client: QueryClient,
): Promise<void> {
  const list = client.getQueryData<ConversationListData>(chatKeys.list());
  const before = list?.items.at(-1)?.lastActivityAt;
  if (!list?.hasMore || !before) {
    return;
  }
  const page = await listChats({ before }, auth());
  client.setQueryData<ConversationListData>(chatKeys.list(), (current) =>
    mergeConversationPage(current, page, false),
  );
}

/**
 * Query options for one chat's messages. The first fetch loads the latest page;
 * a refetch of loaded data is a catch-up from the cursor, so live updates are
 * never overwritten.
 */
export function chatMessagesQueryOptions(chatId: string) {
  const key = chatKeys.messages(chatId);
  return queryOptions({
    queryKey: key,
    queryFn: async ({ client, signal }): Promise<ChatMessagesData> => {
      const { missedWhileLoading } = stateOf(client);
      const existing = client.getQueryData<ChatMessagesData>(key);
      if (existing) {
        await catchUpChat(client, chatId);
      } else {
        missedWhileLoading.delete(chatId);
        const page = await listMessages(chatId, {}, auth(signal));
        client.setQueryData<ChatMessagesData>(key, fromLatestPage(page));
        // A live event raced the first page: replay changes since the page.
        if (missedWhileLoading.delete(chatId)) {
          await catchUpChat(client, chatId);
        }
      }
      const result = client.getQueryData<ChatMessagesData>(key);
      if (!result) {
        throw new Error(
          `Messages of chat ${chatId} were removed while loading`,
        );
      }
      return result;
    },
  });
}

/** The conversation list, live. */
export function useConversationList() {
  const { accessToken, isHydrated } = useAuth();
  return useQuery({
    ...conversationListQueryOptions(),
    enabled: isHydrated && Boolean(accessToken),
  });
}

/** One chat's messages (ascending `seq`, pending last), live. */
export function useChatMessages(chatId: string | null | undefined) {
  const { accessToken, isHydrated } = useAuth();
  return useQuery({
    ...chatMessagesQueryOptions(chatId ?? ''),
    enabled: isHydrated && Boolean(accessToken) && Boolean(chatId),
  });
}

/** Load the page of messages before the loaded window (infinite scroll upward). */
export async function loadOlderMessages(
  client: QueryClient,
  chatId: string,
): Promise<void> {
  const key = chatKeys.messages(chatId);
  const data = client.getQueryData<ChatMessagesData>(key);
  const beforeSeq = data ? windowStart(data.items) : null;
  if (!data?.hasMore || beforeSeq === null) {
    return;
  }
  const page = await listMessages(chatId, { beforeSeq }, auth());
  client.setQueryData<ChatMessagesData>(key, (current) => {
    if (!current) {
      return current;
    }
    const { items } = mergeMessages(current, page.items, false);
    return { ...current, items, hasMore: page.hasMore };
  });
}

export interface PendingMessageInput {
  clientMessageId: string;
  authorId: string;
  content: string | null;
  attachments?: IAttachment[];
}

/** Show an optimistic message (state `sending`) at the end of a loaded chat. */
export function addPendingMessage(
  client: QueryClient,
  chatId: string,
  input: PendingMessageInput,
): void {
  const pending: ChatMessage = {
    id: `${PENDING_ID_PREFIX}${input.clientMessageId}`,
    chatId,
    authorId: input.authorId,
    kind: 'USER',
    seq: 0,
    changeSeq: 0,
    clientMessageId: input.clientMessageId,
    content: input.content,
    attachments: input.attachments ?? [],
    systemEvent: null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    delivery: 'sending',
  };
  client.setQueryData<ChatMessagesData>(chatKeys.messages(chatId), (data) =>
    data
      ? {
          ...data,
          items: [
            ...data.items.filter((m) => m.id !== pending.id),
            pending,
          ].sort(compareMessages),
        }
      : data,
  );
}

/** Set the delivery state of a pending message (e.g. `failed`, then `sending` on retry). */
export function setPendingMessageDelivery(
  client: QueryClient,
  chatId: string,
  clientMessageId: string,
  delivery: MessageDelivery,
): void {
  const id = `${PENDING_ID_PREFIX}${clientMessageId}`;
  client.setQueryData<ChatMessagesData>(chatKeys.messages(chatId), (data) =>
    data
      ? {
          ...data,
          items: data.items.map((m) => (m.id === id ? { ...m, delivery } : m)),
        }
      : data,
  );
}

/** Drop a pending message (the user discarded a failed send). */
export function removePendingMessage(
  client: QueryClient,
  chatId: string,
  clientMessageId: string,
): void {
  const id = `${PENDING_ID_PREFIX}${clientMessageId}`;
  client.setQueryData<ChatMessagesData>(chatKeys.messages(chatId), (data) =>
    data ? { ...data, items: data.items.filter((m) => m.id !== id) } : data,
  );
}

/**
 * Apply the server's response to `sendMessage` (201 or the 200 replay): replaces
 * the pending item, exactly like the `message:new` echo, whichever comes first.
 */
export function applySentMessage(client: QueryClient, message: IMessage): void {
  applyNewMessage(client, message, { userId: message.authorId });
}
